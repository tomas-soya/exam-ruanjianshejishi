'use strict';

const http = require('node:http');
const url = require('node:url');
const fs = require('node:fs');
const path = require('node:path');
const { EXAM_OPENAPI_SPEC } = require('../../exam-contracts/dist/index.js');
const { ExamService } = require('./service/exam-service');
const { QuestionBankLoader } = require('./bank/question-loader');
const { createDatabase, closeDatabase } = require('./db/connection');
const { runMigrations } = require('./db/migrator');

const LOCAL_HOSTS = new Set([
  '127.0.0.1',
  'localhost',
  '::1',
  '::ffff:127.0.0.1'
]);

function isLocalAddress(addr) {
  if (!addr) return false;
  return LOCAL_HOSTS.has(addr);
}

// LAN mode admits private IPv4 peers; loopback mode retains the existing guard.
function isLanAddress(addr) {
  const normalized = (addr || '').replace(/^::ffff:/, '');
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalized)) return false;
  const parts = normalized.split('.').map(Number);
  if (parts.some(n => n > 255)) return false;
  const [a, b] = parts;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 169 && b === 254);
}

function isAllowedOrigin(origin, { allowLanAccess = false } = {}) {
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    const hostname = parsed.hostname;
    if (isLocalAddress(hostname)) return true;
    if (allowLanAccess && isLanAddress(hostname)) return true;
    return false;
  } catch {
    return false;
  }
}

function getCorsHeaders(req, { allowLanAccess = false, isSensitive = false } = {}) {
  const origin = req && req.headers ? req.headers.origin : null;
  if (!origin) return {};
  if (!isAllowedOrigin(origin, { allowLanAccess })) return {};

  if (isSensitive) {
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
      'Vary': 'Origin'
    };
  }

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

const SENSITIVE_ROUTES = new Set([
  '/api/v1/system/db-export',
  '/api/v1/system/db-import',
  '/api/v1/system/reset',
  '/api/v1/admin/shutdown',
  '/api/v1/settings'
]);

function isSensitiveRoute(pathname) {
  if (SENSITIVE_ROUTES.has(pathname)) return true;
  if (pathname.startsWith('/api/v1/system/')) return true;
  return false;
}

function parseJsonBody(req, maxSizeBytes = 1048576) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let totalBytes = 0;

    req.on('data', chunk => {
      totalBytes += chunk.length;
      if (totalBytes > maxSizeBytes) {
        const err = new Error('Payload Too Large');
        err.code = 'PAYLOAD_TOO_LARGE';
        err.statusCode = 413;
        reject(err);
        req.destroy();
        return;
      }
      raw += chunk;
    });

    req.on('end', () => {
      if (!raw || raw.trim().length === 0) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        resolve(parsed);
      } catch (e) {
        const err = new Error('Malformed JSON payload');
        err.code = 'INVALID_JSON';
        err.statusCode = 400;
        reject(err);
      }
    });

    req.on('error', reject);
  });
}

function parseRawBody(req, maxSizeBytes = 200 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;

    req.on('data', chunk => {
      totalBytes += chunk.length;
      if (totalBytes > maxSizeBytes) {
        const err = new Error('Payload Too Large');
        err.code = 'PAYLOAD_TOO_LARGE';
        err.statusCode = 413;
        reject(err);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      resolve(Buffer.concat(chunks));
    });

    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload) {
  const jsonStr = JSON.stringify(payload);
  const cors = res.__corsHeaders || {};
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(jsonStr, 'utf8'),
    ...cors
  });
  res.end(jsonStr);
}

function sendSuccess(res, data, statusCode = 200) {
  sendJson(res, statusCode, {
    success: true,
    data
  });
}

function sendError(res, code, message, statusCode = 400, details = null) {
  sendJson(res, statusCode, {
    success: false,
    error: {
      code,
      message,
      ...(details ? { details } : {})
    }
  });
}

/**
 * Creates the HTTP application server.
 * @param {object} options
 * @param {import('node:sqlite').DatabaseSync} [options.db]
 * @param {import('./bank/question-loader').QuestionBankLoader} [options.bankLoader]
 * @param {import('./scoring/case-evaluator').BaseCaseEvaluator} [options.caseEvaluator]
 * @param {string} [options.dbPath]
 * @param {boolean} [options.allowLanAccess=false]
 * @param {number} [options.chatTimeoutMs]
 * @returns {http.Server & { examService: ExamService, db: import('node:sqlite').DatabaseSync }}
 */
function createApp({ db, bankLoader, caseEvaluator, dbPath, materialSyncManager, autoStartSync, chatService, chatTimeoutMs, allowLanAccess = false, exitOnShutdown = true, onShutdown } = {}) {
  const isExternalDb = Boolean(db);
  let isShuttingDown = false;

  let activeDb = db;
  if (!activeDb) {
    activeDb = createDatabase(dbPath || ':memory:');
    runMigrations(activeDb);
  }

  let activeCaseEvaluator = caseEvaluator;
  if (!activeCaseEvaluator) {
    try {
      const { LlmCaseEvaluator } = require('../../exam-llm');
      const { PluggableCaseEvaluator } = require('./scoring/case-evaluator');
      activeCaseEvaluator = new PluggableCaseEvaluator(new LlmCaseEvaluator());
    } catch (e) {
      const { PluggableCaseEvaluator } = require('./scoring/case-evaluator');
      activeCaseEvaluator = new PluggableCaseEvaluator();
    }
  }

  const activeLoader = bankLoader || new QuestionBankLoader();
  const examService = new ExamService({
    db: activeDb,
    dbPath: dbPath || ':memory:',
    bankLoader: activeLoader,
    caseEvaluator: activeCaseEvaluator,
    materialSyncManager,
    autoStartSync: autoStartSync !== undefined ? autoStartSync : !materialSyncManager,
    chatService,
    chatTimeoutMs
  });

  const server = http.createServer(async (req, res) => {
    // 1. Explicit LAN mode permits private peers; default mode remains local.
    const remote = req.socket.remoteAddress;
    if (remote && !isLocalAddress(remote) && !(allowLanAccess && isLanAddress(remote))) {
      sendError(res, 'FORBIDDEN_REMOTE_ACCESS', allowLanAccess ? '仅允许本机或局域网地址访问' : '仅允许本机地址访问', 403);
      return;
    }

    const origin = req.headers ? req.headers.origin : null;
    const isOriginAllowed = isAllowedOrigin(origin, { allowLanAccess });
    const parsedUrl = url.parse(req.url, true);
    const pathname = (parsedUrl.pathname || '').replace(/\/+$/, '') || '/';
    const query = parsedUrl.query || {};
    const method = (req.method || 'GET').toUpperCase();

    const isSensitive = isSensitiveRoute(pathname);
    const corsHeaders = getCorsHeaders(req, { allowLanAccess, isSensitive });
    res.__corsHeaders = corsHeaders;

    // 2. CORS Preflight
    if (req.method === 'OPTIONS') {
      if (origin && !isOriginAllowed) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Forbidden: Untrusted cross-origin request');
        return;
      }
      res.writeHead(204, corsHeaders);
      res.end();
      return;
    }

    // 3. Block untrusted cross-origin requests on sensitive endpoints
    if (origin && !isOriginAllowed && isSensitive) {
      sendError(res, 'FORBIDDEN_CROSS_ORIGIN', '禁止不可信的跨站来源访问敏感接口', 403);
      return;
    }

    try {
      // Route 0: Admin Graceful Shutdown (AC-SHUTDOWN)
      // Strict Security: Strictly limited to local loopback (127.0.0.1 / ::1), never open to LAN/remote
      if (pathname === '/api/v1/admin/shutdown' && method === 'POST') {
        if (!isLocalAddress(remote)) {
          sendError(res, 'FORBIDDEN_REMOTE_ACCESS', 'Shutdown command is strictly restricted to local loopback interface', 403);
          return;
        }

        if (isShuttingDown) {
          sendJson(res, 200, {
            success: true,
            data: {
              status: 'already_shutting_down',
              pid: process.pid,
              message: 'ExamService graceful shutdown is already in progress'
            }
          });
          return;
        }

        isShuttingDown = true;
        server.isShuttingDown = true;

        sendJson(res, 200, {
          success: true,
          data: {
            status: 'shutting_down',
            pid: process.pid,
            message: 'ExamService graceful shutdown initiated successfully'
          }
        });

        // Trigger asynchronous graceful shutdown after response flush
        setTimeout(async () => {
          try {
            await server.gracefulShutdown();
            if (typeof onShutdown === 'function') {
              try { onShutdown(); } catch {}
            }
          } catch (err) {
            console.error('[ExamService] Error during graceful shutdown:', err);
          } finally {
            if (exitOnShutdown) {
              process.exit(0);
            }
          }
        }, 50).unref?.();
        return;
      }

      // Check if server is currently shutting down
      if (isShuttingDown && pathname !== '/api/v1/health') {
        sendError(res, 'SERVER_SHUTTING_DOWN', 'Server is shutting down and cannot accept new requests', 503);
        return;
      }

      // Route 1: Health check
      if (pathname === '/api/v1/health' && method === 'GET') {
        sendJson(res, 200, {
          status: isShuttingDown ? 'shutting_down' : 'ok',
          boundAddress: server.address()?.address || null,
          uptime: Math.floor(process.uptime()),
          db: isShuttingDown ? 'closing' : 'connected',
          verifiedPapersCount: examService.bankLoader.listVerifiedPapers().length
        });
        return;
      }

      // Route 2: OpenAPI Spec
      if (pathname === '/api/v1/openapi.json' && method === 'GET') {
        sendJson(res, 200, EXAM_OPENAPI_SPEC);
        return;
      }

      // Route 3: List papers
      if (pathname === '/api/v1/papers' && method === 'GET') {
        const subject = query.subject;
        const papers = examService.listPapers(subject);
        sendSuccess(res, papers);
        return;
      }

      // Route 4: Get paper detail
      const paperMatch = pathname.match(/^\/api\/v1\/papers\/([a-zA-Z0-9_-]+)$/);
      if (paperMatch && method === 'GET') {
        const paperId = paperMatch[1];
        const detail = examService.getPaperDetail(paperId);
        if (!detail) {
          sendError(res, 'PAPER_NOT_FOUND', `Paper ${paperId} not found or unverified`, 404);
          return;
        }
        sendSuccess(res, detail);
        return;
      }

      // Route 5: List chapters
      if (pathname === '/api/v1/chapters' && method === 'GET') {
        const chapters = examService.listChapters();
        sendSuccess(res, chapters);
        return;
      }

      // Route 6.0: List sessions (history)
      if (pathname === '/api/v1/sessions' && method === 'GET') {
        const status = query.status;
        const mode = query.mode;
        const limit = query.limit ? parseInt(query.limit, 10) : 50;
        const offset = query.offset ? parseInt(query.offset, 10) : 0;
        const sessions = examService.listSessions({ status, mode, limit, offset });
        sendSuccess(res, sessions);
        return;
      }

      // Route 6.1: Create session
      if (pathname === '/api/v1/sessions' && method === 'POST') {
        const body = await parseJsonBody(req);
        const session = examService.createSession(body);
        sendSuccess(res, session, 201);
        return;
      }

      // Route 6.2: Delete session (AC-3, AC-4)
      const sessionDeleteMatch = pathname.match(/^\/api\/v1\/sessions\/([0-9a-fA-F-]+)$/);
      if (sessionDeleteMatch && method === 'DELETE') {
        const sessionId = sessionDeleteMatch[1];
        try {
          const result = examService.deleteSession(sessionId);
          sendSuccess(res, result);
        } catch (err) {
          sendError(res, err.code || 'SESSION_DELETE_FAILED', err.message, err.statusCode || 404);
        }
        return;
      }

      // Route 7.0: Resume session
      const sessionMatch = pathname.match(/^\/api\/v1\/sessions\/([0-9a-fA-F-]+)$/);
      if (sessionMatch && method === 'GET') {
        const sessionId = sessionMatch[1];
        const sessionData = examService.resumeSession(sessionId);
        if (!sessionData) {
          sendError(res, 'SESSION_NOT_FOUND', `Session ${sessionId} not found`, 404);
          return;
        }
        sendSuccess(res, sessionData);
        return;
      }

      // Route 7.1: Update session state (practice mode, position, answers revealed)
      if (sessionMatch && method === 'PATCH') {
        const sessionId = sessionMatch[1];
        const body = await parseJsonBody(req);
        const updated = examService.updateSessionState(sessionId, body);
        sendSuccess(res, updated);
        return;
      }

      // Route 7.1b: Exit exam mode and switch to assisted practice mode (AC-Q2)
      const exitExamMatch = pathname.match(/^\/api\/v1\/sessions\/([0-9a-fA-F-]+)\/exit-exam-mode$/);
      if (exitExamMatch && method === 'POST') {
        const sessionId = exitExamMatch[1];
        try {
          const updated = examService.exitExamMode(sessionId);
          sendSuccess(res, updated);
        } catch (err) {
          sendError(res, err.code || 'EXIT_EXAM_FAILED', err.message, err.statusCode || 400);
        }
        return;
      }

      // Route 7.2: Check single question solution/grading in practice/memorize mode
      const checkMatch = pathname.match(/^\/api\/v1\/sessions\/([0-9a-fA-F-]+)\/check-question$/);
      if (checkMatch && method === 'POST') {
        const sessionId = checkMatch[1];
        const body = await parseJsonBody(req);
        if (!body.questionId) {
          sendError(res, 'MISSING_FIELD', 'questionId is required', 400);
          return;
        }
        const result = await examService.checkQuestion(sessionId, body.questionId, body.userAnswer);
        sendSuccess(res, result);
        return;
      }

      // Route 7.3: Get all solutions for session (practice/memorize mode only)
      const solutionsMatch = pathname.match(/^\/api\/v1\/sessions\/([0-9a-fA-F-]+)\/solutions$/);
      if (solutionsMatch && method === 'GET') {
        const sessionId = solutionsMatch[1];
        const solutions = examService.getSessionSolutions(sessionId);
        sendSuccess(res, { sessionId, solutions });
        return;
      }

      // Route 8: Save answer draft
      const answersMatch = pathname.match(/^\/api\/v1\/sessions\/([0-9a-fA-F-]+)\/answers$/);
      if (answersMatch && method === 'POST') {
        const sessionId = answersMatch[1];
        const body = await parseJsonBody(req);
        if (!body.questionId) {
          sendError(res, 'MISSING_FIELD', 'questionId is required', 400);
          return;
        }
        const record = examService.saveAnswerDraft(sessionId, body);
        sendSuccess(res, record);
        return;
      }

      // Route 9: Submit session
      const submitMatch = pathname.match(/^\/api\/v1\/sessions\/([0-9a-fA-F-]+)\/submit$/);
      if (submitMatch && method === 'POST') {
        const sessionId = submitMatch[1];
        const report = await examService.submitSession(sessionId);
        sendSuccess(res, report);
        return;
      }

      // Route 10: Get session report
      const reportMatch = pathname.match(/^\/api\/v1\/sessions\/([0-9a-fA-F-]+)\/report$/);
      if (reportMatch && method === 'GET') {
        const sessionId = reportMatch[1];
        const report = examService.getSessionReport(sessionId);
        if (!report) {
          sendError(res, 'REPORT_NOT_FOUND', `Report for session ${sessionId} not found`, 404);
          return;
        }
        sendSuccess(res, report);
        return;
      }

      // Route 11: Case review human override
      const caseOverrideMatch = pathname.match(/^\/api\/v1\/sessions\/([0-9a-fA-F-]+)\/(?:case-scores|case-review)$/);
      if (caseOverrideMatch && method === 'POST') {
        const sessionId = caseOverrideMatch[1];
        const body = await parseJsonBody(req);
        if (!body.questionId || typeof body.points !== 'number' || !Number.isFinite(body.points)) {
          sendError(res, 'INVALID_PAYLOAD', 'questionId and finite points (number) are required', 400);
          return;
        }
        try {
          const updated = examService.overrideCaseReview(sessionId, body.questionId, body);
          sendSuccess(res, updated);
        } catch (err) {
          sendError(res, err.code || 'OVERRIDE_FAILED', err.message, err.statusCode || 400);
        }
        return;
      }

      // Route 12: List wrong questions
      if (pathname === '/api/v1/wrong-questions' && method === 'GET') {
        const chapter = query.chapter;
        let mastered = undefined;
        if (query.mastered === 'true') mastered = true;
        if (query.mastered === 'false') mastered = false;
        const limit = query.limit ? parseInt(query.limit, 10) : 50;
        const offset = query.offset ? parseInt(query.offset, 10) : 0;

        const list = examService.listWrongQuestions({ chapter, mastered, limit, offset });
        sendSuccess(res, list);
        return;
      }

      // Route 13: Toggle wrong question mastered
      const masteredMatch = pathname.match(/^\/api\/v1\/wrong-questions\/([a-zA-Z0-9_-]+)\/mastered$/);
      if (masteredMatch && method === 'POST') {
        const questionId = masteredMatch[1];
        const body = await parseJsonBody(req);
        if (typeof body.mastered !== 'boolean') {
          sendError(res, 'INVALID_PAYLOAD', 'mastered (boolean) is required', 400);
          return;
        }
        const updated = examService.toggleWrongQuestionMastered(questionId, body.mastered);
        if (!updated) {
          sendError(res, 'NOT_FOUND', `Wrong question ${questionId} not found`, 404);
          return;
        }
        sendSuccess(res, updated);
        return;
      }

      // Route 14: Review queue
      if (pathname === '/api/v1/review-queue' && method === 'GET') {
        const limit = query.limit ? parseInt(query.limit, 10) : 20;
        const state = query.state;
        const queue = examService.getReviewQueue(limit);
        sendSuccess(res, queue);
        return;
      }

      // Route 14.1: Personal Chapter Materials Catalog (AC-B1)
      if (pathname === '/api/v1/personal-materials' && method === 'GET') {
        const list = examService.listPersonalMaterials();
        sendSuccess(res, list);
        return;
      }

      // Route 14.2: Personal Chapter Material Detail (AC-B1..B4)
      const personalMatMatch = pathname.match(/^\/api\/v1\/personal-materials\/([^\/]+)$/);
      if (personalMatMatch && method === 'GET') {
        const chapterKey = decodeURIComponent(personalMatMatch[1]);
        const detail = examService.getPersonalMaterial(chapterKey);
        if (!detail) {
          sendError(res, 'CHAPTER_NOT_FOUND', `Chapter material for ${chapterKey} not found`, 404);
          return;
        }
        sendSuccess(res, detail);
        return;
      }

      // Route 14.3: Retry Failed Material Sync (AC-B3)
      const retryMatch = pathname.match(/^\/api\/v1\/personal-materials\/([^\/]+)\/retry$/);
      if (retryMatch && method === 'POST') {
        const chapterKey = decodeURIComponent(retryMatch[1]);
        const jobId = examService.retryPersonalMaterialSync(chapterKey);
        sendSuccess(res, { jobId, chapterKey, status: 'pending' }, 202);
        return;
      }

      // Route 14.4: Dynamic Review Materials (2 aggregated items: objective & case) (AC-2)
      if (pathname === '/api/v1/dynamic-materials' && method === 'GET') {
        const dynamicMaterials = examService.getDynamicMaterials();
        sendSuccess(res, dynamicMaterials);
        return;
      }

      // Route 14.5: Dynamic Review Material Detail by Subject (AC-2)
      const dynamicDetailMatch = pathname.match(/^\/api\/v1\/dynamic-materials\/(objective|case)$/);
      if (dynamicDetailMatch && method === 'GET') {
        const subject = dynamicDetailMatch[1];
        const detail = examService.getDynamicMaterial(subject);
        sendSuccess(res, detail);
        return;
      }

      // Route 14.6: Dynamic Review Material Retry by Subject (AC-2)
      const dynamicRetryMatch = pathname.match(/^\/api\/v1\/dynamic-materials\/(objective|case)\/retry$/);
      if (dynamicRetryMatch && method === 'POST') {
        const subject = dynamicRetryMatch[1];
        try {
          const result = examService.retryDynamicMaterial(subject);
          sendSuccess(res, result, 202);
        } catch (err) {
          sendError(res, err.code || 'RETRY_FAILED', err.message, err.statusCode || 400);
        }
        return;
      }

      // Route 15.0: Static Materials Catalog (13 objective + 8 case) (AC-1)
      if ((pathname === '/api/v1/static-materials' || pathname === '/api/v1/materials/catalog') && method === 'GET') {
        const catalog = examService.listStaticMaterials();
        sendSuccess(res, catalog);
        return;
      }

      // Route 15: Revision Materials Anchor / Static Markdown Content (AC-1)
      if (pathname === '/api/v1/materials' && method === 'GET') {
        const docParam = query.doc || '';
        if (!docParam) {
          // If no doc parameter is provided, return full static catalog
          const catalog = examService.listStaticMaterials();
          sendSuccess(res, catalog);
          return;
        }
        try {
          const result = examService.getStaticMaterial({ doc: docParam, subject: query.subject });
          sendSuccess(res, result);
          return;
        } catch (err) {
          sendError(res, err.code || 'MATERIAL_NOT_FOUND', err.message, err.statusCode || 404);
          return;
        }
      }

      // Route 16: Question Bank Asset Images (AC-A4)
      const decodedPathname = decodeURIComponent(pathname);
      const assetMatch = decodedPathname.match(/^\/(?:api\/v1\/assets|题库\/assets|assets)\/(.+)$/);
      if (assetMatch && method === 'GET') {
        const rawRelative = decodeURIComponent(assetMatch[1]);
        const bankAssetsRoot = activeLoader?.bankDir ? path.join(activeLoader.bankDir, 'assets') : path.resolve(__dirname, '../../../题库/assets');
        const resolvedPath = path.resolve(bankAssetsRoot, rawRelative);

        // Security Invariant: Strict Path Traversal Protection
        if (!resolvedPath.startsWith(bankAssetsRoot + path.sep) && resolvedPath !== bankAssetsRoot) {
          sendError(res, 'FORBIDDEN_PATH_TRAVERSAL', 'Path traversal outside bank assets is prohibited', 403);
          return;
        }

        if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
          sendError(res, 'ASSET_NOT_FOUND', `Asset ${rawRelative} not found`, 404);
          return;
        }

        const ext = path.extname(resolvedPath).toLowerCase();
        const MIME_MAP = {
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.svg': 'image/svg+xml',
          '.gif': 'image/gif',
          '.webp': 'image/webp',
          '.ico': 'image/x-icon'
        };
        const contentType = MIME_MAP[ext] || 'application/octet-stream';

        res.writeHead(200, {
          'Content-Type': contentType,
          'Content-Length': fs.statSync(resolvedPath).size,
          'Cache-Control': 'public, max-age=86400',
          ...corsHeaders
        });
        fs.createReadStream(resolvedPath).pipe(res);
        return;
      }

      // Route 17: AI Chat Assistant (AC-Q1..Q5)
      if (pathname === '/api/v1/chat' && method === 'POST') {
        const clientAbortController = new AbortController();
        res.on('close', () => {
          if (!res.writableEnded) {
            clientAbortController.abort();
          }
        });

        try {
          const body = await parseJsonBody(req);
          const chatRes = await examService.chat({
            context: body.context,
            userMessage: body.userMessage,
            history: body.history,
            signal: clientAbortController.signal
          });
          if (!res.writableEnded) {
            sendSuccess(res, chatRes);
          }
        } catch (err) {
          if (res.writableEnded || res.destroyed) {
            return;
          }
          if (err.name === 'AbortError' || err.message.includes('Chat request cancelled')) {
            return;
          }
          sendError(res, err.code || 'CHAT_FAILED', err.message, err.statusCode || 400, err.details || null);
        }
        return;
      }

      // Route 18: System LLM Configuration (GET / PUT /api/v1/system/llm-config)
      if (pathname === '/api/v1/system/llm-config' && method === 'GET') {
        const config = examService.getLlmConfig();
        sendSuccess(res, config);
        return;
      }

      if (pathname === '/api/v1/system/llm-config' && method === 'PUT') {
        const body = await parseJsonBody(req);
        const updated = examService.saveLlmConfig(body);
        sendSuccess(res, updated);
        return;
      }

      // Route 19: System LLM Test Connection (POST /api/v1/system/llm-test)
      if (pathname === '/api/v1/system/llm-test' && method === 'POST') {
        const body = await parseJsonBody(req);
        const testRes = await examService.testLlmConnection(body);
        sendSuccess(res, testRes);
        return;
      }

      // Route 20: System LLM Available Models (GET / POST /api/v1/system/llm-models)
      if (pathname === '/api/v1/system/llm-models' && (method === 'GET' || method === 'POST')) {
        let params = {};
        if (method === 'POST') {
          params = await parseJsonBody(req);
        } else {
          params = query;
        }
        try {
          const models = await examService.listLlmModels(params);
          sendSuccess(res, { models });
        } catch (err) {
          sendError(res, 'FETCH_MODELS_FAILED', err.message, 400);
        }
        return;
      }

      // Route 21: System Database Information (GET /api/v1/system/db-info)
      if (pathname === '/api/v1/system/db-info' && method === 'GET') {
        const info = examService.getDatabaseInfo();
        sendSuccess(res, info);
        return;
      }

      // Route 22: System Database Export (GET /api/v1/system/db-export)
      if (pathname === '/api/v1/system/db-export' && method === 'GET') {
        const tmpDir = path.resolve(__dirname, '../../.tmp-export');
        if (!fs.existsSync(tmpDir)) {
          fs.mkdirSync(tmpDir, { recursive: true });
        }
        const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
        const tmpFile = path.join(tmpDir, `ruankao_backup_${timestamp}_${Date.now()}.db`);

        try {
          examService.exportDatabaseToBackup(tmpFile);
          const stat = fs.statSync(tmpFile);
          const exportCorsHeaders = getCorsHeaders(req, { allowLanAccess, isSensitive: true });
          res.writeHead(200, {
            'Content-Type': 'application/vnd.sqlite3',
            'Content-Disposition': `attachment; filename="ruankao_app_${timestamp}.db"`,
            'Content-Length': stat.size,
            ...exportCorsHeaders
          });

          const stream = fs.createReadStream(tmpFile);
          stream.pipe(res);
          stream.on('close', () => {
            try { fs.unlinkSync(tmpFile); } catch {}
          });
        } catch (err) {
          try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch {}
          sendError(res, 'DB_EXPORT_FAILED', `导出数据库失败: ${err.message}`, 500);
        }
        return;
      }

      // Route 23: System Database Import (POST /api/v1/system/db-import)
      if (pathname === '/api/v1/system/db-import' && method === 'POST') {
        const tmpDir = path.resolve(__dirname, '../../.tmp-import');
        if (!fs.existsSync(tmpDir)) {
          fs.mkdirSync(tmpDir, { recursive: true });
        }
        const tmpUploadFile = path.join(tmpDir, `upload_${Date.now()}.db`);

        try {
          const rawBuffer = await parseRawBody(req);
          if (!rawBuffer || rawBuffer.length === 0) {
            sendError(res, 'INVALID_DB_FILE', '上传的数据库文件内容为空', 400);
            return;
          }

          fs.writeFileSync(tmpUploadFile, rawBuffer);
          const importResult = examService.importDatabaseFile(tmpUploadFile);
          sendSuccess(res, importResult);
        } catch (err) {
          sendError(res, 'DB_IMPORT_FAILED', err.message, 400);
        } finally {
          try {
            if (fs.existsSync(tmpUploadFile)) fs.unlinkSync(tmpUploadFile);
          } catch {}
        }
        return;
      }

      // Route not found
      sendError(res, 'ROUTE_NOT_FOUND', `Cannot ${method} ${pathname}`, 404);

    } catch (err) {
      let statusCode = err.statusCode;
      if (!statusCode) {
        if (err.code === 'EXAM_MODE_ISOLATION' || err.code === 'EXAM_MODE_CHAT_DISABLED' || err.code === 'FORBIDDEN_PATH_TRAVERSAL' || err.code === 'FORBIDDEN_REMOTE_ACCESS') {
          statusCode = 403;
        } else if (err.code === 'CHAT_SERVICE_UNAVAILABLE') {
          statusCode = 503;
        } else if (err.code === 'SESSION_NOT_FOUND' || err.code === 'PAPER_NOT_FOUND' || err.code === 'NOT_FOUND' || err.code === 'REPORT_NOT_FOUND' || err.code === 'ASSET_NOT_FOUND' || err.code === 'MATERIAL_NOT_FOUND') {
          statusCode = 404;
        } else if (
          err.code === 'INVALID_JSON' ||
          err.code === 'INVALID_MODE' ||
          err.code === 'INVALID_PAPER_ID' ||
          err.code === 'MISSING_FIELD' ||
          err.code === 'INVALID_PAYLOAD' ||
          err.code === 'SESSION_ALREADY_SUBMITTED' ||
          (err.message && (err.message.includes('Invalid') || err.message.includes('required') || err.message.includes('unverified')))
        ) {
          statusCode = 400;
        } else {
          statusCode = 500;
        }
      }
      sendError(res, err.code || 'INTERNAL_ERROR', err.message, statusCode);
    }
  });

  server.examService = examService;
  server.db = activeDb;
  server.isShuttingDown = false;

  const originalClose = server.close.bind(server);

  server.close = function(cb) {
    if (examService && examService.materialSyncManager && typeof examService.materialSyncManager.shutdown === 'function') {
      try { examService.materialSyncManager.shutdown(); } catch {}
    }
    return originalClose((err) => {
      if (!isExternalDb && activeDb) {
        try { closeDatabase(activeDb); } catch {}
      }
      if (cb) cb(err);
    });
  };

  server.gracefulShutdown = function() {
    return new Promise((resolve) => {
      isShuttingDown = true;
      server.isShuttingDown = true;

      // 1. Close idle connections if supported
      if (typeof server.closeIdleConnections === 'function') {
        try { server.closeIdleConnections(); } catch {}
      }

      // 2. Shut down material sync manager
      if (examService && examService.materialSyncManager && typeof examService.materialSyncManager.shutdown === 'function') {
        try { examService.materialSyncManager.shutdown(); } catch {}
      }

      // 3. Close HTTP listener and cleanup database
      originalClose((closeErr) => {
        if (!isExternalDb && activeDb) {
          try { closeDatabase(activeDb); } catch {}
        }
        resolve();
      });

      // 4. Fallback timeout: force terminate lingering sockets after 2s
      setTimeout(() => {
        if (typeof server.closeAllConnections === 'function') {
          try { server.closeAllConnections(); } catch {}
        }
        if (!isExternalDb && activeDb) {
          try { closeDatabase(activeDb); } catch {}
        }
        resolve();
      }, 2000).unref?.();
    });
  };

  return server;
}

/**
 * Starts the server on the requested address (loopback by default).
 * @param {object} options
 * @param {number} [options.port=3000]
 * @param {string} [options.host='127.0.0.1']
 * @param {string} [options.dbPath]
 * @param {boolean} [options.exitOnShutdown=true]
 * @param {function} [options.onShutdown]
 */
function startServer({ port = 3000, host = '127.0.0.1', dbPath, exitOnShutdown = true, onShutdown } = {}) {
  const app = createApp({ dbPath, allowLanAccess: !isLocalAddress(host), exitOnShutdown, onShutdown });

  return new Promise((resolve, reject) => {
    app.listen(port, host, () => {
      const address = app.address();
      resolve({
        server: app,
        port: address.port,
        host: address.address,
        close: () => app.gracefulShutdown()
      });
    });
    app.on('error', reject);
  });
}

module.exports = {
  createApp,
  startServer,
  isAllowedOrigin,
  getCorsHeaders
};

if (require.main === module) {
  const port = parseInt(process.env.PORT || '3000', 10);
  const host = process.env.HOST || '127.0.0.1';
  const dbPath = process.env.DB_PATH;
  startServer({ port, host, dbPath })
    .then(({ port, host, close }) => {
      console.log(`[ExamService] Server listening on http://${host}:${port}`);
      const handleSignal = (signal) => {
        console.log(`[ExamService] Received ${signal}, starting graceful shutdown...`);
        close()
          .catch(err => {
            console.error('[ExamService] Graceful shutdown error:', err);
          })
          .finally(() => {
            process.exit(0);
          });
      };
      process.on('SIGINT', () => handleSignal('SIGINT'));
      process.on('SIGTERM', () => handleSignal('SIGTERM'));
    })
    .catch(err => {
      console.error('[ExamService] Startup failed:', err);
      process.exit(1);
    });
}
