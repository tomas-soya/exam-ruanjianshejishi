'use strict';

/**
 * Ruankao Exam Platform - Unified All-in-One Server
 * Integrates Backend REST APIs, SQLite Persistence, Question Bank, 
 * Materials Synchronization, and Web Client Static Frontend in a Single High-Performance HTTP Engine.
 * Supports LAN access (0.0.0.0) and Zero-Configuration Portable App Mode.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { createApp, isAllowedOrigin, getCorsHeaders } = require('./server');
const { QuestionBankLoader } = require('./bank/question-loader');
const { MaterialSyncManager } = require('./material/material-sync-manager');
const { createDatabase, closeDatabase } = require('./db/connection');
const { runMigrations } = require('./db/migrator');

// MIME types mapping
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

function findPortableRoot(startDir) {
  let curr = path.resolve(startDir);
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(curr, 'resources', 'bank')) &&
        fs.existsSync(path.join(curr, 'resources', 'web'))) {
      return curr;
    }
    const parent = path.dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }
  return null;
}

function findWorkspaceRoot(startDir) {
  let curr = path.resolve(startDir);
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(curr, '题库')) &&
        fs.existsSync(path.join(curr, '软件设计师复习材料'))) {
      return curr;
    }
    const parent = path.dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }
  return null;
}

/**
 * Resolves configuration paths dynamically:
 * Supports both Portable Directory Layout and Workspace Development Layout.
 */
function resolveAppPaths() {
  const currentDir = __dirname;
  const portableRoot = findPortableRoot(currentDir);
  const isPortable = Boolean(portableRoot);
  const workspaceRoot = findWorkspaceRoot(currentDir) || path.resolve(currentDir, '../../..');

  let bankDir, materialsDir, webDir, dataDir, dbPath;

  if (isPortable) {
    bankDir = process.env.EXAM_BANK_DIR || path.join(portableRoot, 'resources', 'bank');
    materialsDir = process.env.EXAM_MATERIALS_DIR || path.join(portableRoot, 'resources', 'materials');
    webDir = process.env.EXAM_WEB_DIR || path.join(portableRoot, 'resources', 'web');
    dataDir = process.env.EXAM_DATA_DIR || path.join(portableRoot, 'data');
    dbPath = process.env.DB_PATH || path.join(dataDir, 'app.db');
  } else {
    bankDir = process.env.EXAM_BANK_DIR || path.join(workspaceRoot, '题库');
    materialsDir = process.env.EXAM_MATERIALS_DIR || path.join(workspaceRoot, '软件设计师复习材料');
    webDir = process.env.EXAM_WEB_DIR || path.join(workspaceRoot, 'apps', 'exam-web');
    dataDir = process.env.EXAM_DATA_DIR || path.join(workspaceRoot, 'apps', 'exam-service', 'data');
    dbPath = process.env.DB_PATH || path.join(dataDir, 'app.db');
  }

  return {
    isPortable,
    portableRoot,
    workspaceRoot,
    bankDir: path.resolve(bankDir),
    materialsDir: path.resolve(materialsDir),
    webDir: path.resolve(webDir),
    dataDir: path.resolve(dataDir),
    dbPath: path.resolve(dbPath)
  };
}

/**
 * Enumerate all active IPv4 non-loopback network interfaces for LAN display.
 */
function getLanAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];

  for (const [name, netList] of Object.entries(interfaces)) {
    if (!netList) continue;
    for (const net of netList) {
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push({ name, address: net.address });
      }
    }
  }

  return addresses;
}

/**
 * Safely stream a static file with correct MIME type and caching headers.
 */
function serveStaticFile(req, res, filePath) {
  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    return;
  }

  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME_TYPES[ext] || 'application/octet-stream';
  const cors = getCorsHeaders(req, { allowLanAccess: true });
  res.writeHead(200, {
    'Content-Type': mime,
    'Content-Length': stat.size,
    'Cache-Control': ['.html', '.js', '.css'].includes(ext) ? 'no-cache' : 'public, max-age=86400',
    ...cors
  });
  fs.createReadStream(filePath).pipe(res);
}

/**
 * Main launcher for Unified Server.
 */
async function startUnifiedServer(options = {}) {
  const paths = resolveAppPaths();
  const port = parseInt(options.port ?? process.env.PORT ?? '3124', 10);
  const host = options.host || process.env.HOST || '127.0.0.1';

  // Ensure data directory exists
  if (!fs.existsSync(paths.dataDir)) {
    fs.mkdirSync(paths.dataDir, { recursive: true });
  }

  // Initialize SQLite persistence
  const db = createDatabase(paths.dbPath);
  runMigrations(db);

  // Expose materials dir to material sync subsystem
  process.env.EXAM_MATERIALS_DIR = paths.materialsDir;

  // Initialize QuestionBankLoader
  const loadAll = options.loadAllPapers !== undefined ? options.loadAllPapers : (process.env.EXAM_LOAD_ALL_PAPERS !== 'false');
  const bankLoader = new QuestionBankLoader(paths.bankDir, { includeAll: loadAll });

  // Initialize MaterialSyncManager
  const materialSyncManager = new MaterialSyncManager({
    db,
    autoStart: true,
    materialsBaseDir: paths.materialsDir
  });

  let unifiedServerInstance = null;
  let isShuttingDown = false;

  const performGracefulShutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log('\n[UnifiedServer] 正在执行优雅停机，刷新并持久化 SQLite WAL...');
    
    try {
      if (materialSyncManager) {
        materialSyncManager.shutdown();
      }
    } catch {}

    try {
      if (db) {
        db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
        closeDatabase(db);
      }
    } catch (e) {
      console.error('[UnifiedServer] SQLite 关闭异常:', e.message);
    }

    if (unifiedServerInstance) {
      await new Promise(resolve => {
        try {
          if (typeof unifiedServerInstance.closeAllConnections === 'function') {
            unifiedServerInstance.closeAllConnections();
          }
        } catch {}
        unifiedServerInstance.close(() => resolve());
        setTimeout(resolve, 1000);
      });
    }

    console.log('[UnifiedServer] 服务已安全关闭。');
  };

  // Build API application handler from exam-service core
  const apiServer = createApp({
    db,
    dbPath: paths.dbPath,
    bankLoader,
    materialSyncManager,
    autoStartSync: false,
    allowLanAccess: true,
    exitOnShutdown: false,
    onShutdown: performGracefulShutdown
  });

  const webPublicDir = fs.existsSync(path.join(paths.webDir, 'public')) 
    ? path.join(paths.webDir, 'public') 
    : paths.webDir;
  const webSrcDir = fs.existsSync(path.join(paths.webDir, 'src')) 
    ? path.join(paths.webDir, 'src') 
    : paths.webDir;
  const bankAssetsDir = path.join(paths.bankDir, 'assets');

  // Master Unified Server dispatcher
  const server = http.createServer(async (req, res) => {
    const rawUrl = req.url || '/';
    const parsedUrl = new URL(rawUrl, `http://${host}:${port}`);
    const pathname = parsedUrl.pathname;

    const origin = req.headers ? req.headers.origin : null;
    const isOriginAllowed = isAllowedOrigin(origin, { allowLanAccess: true });
    const corsHeaders = getCorsHeaders(req, { allowLanAccess: true });

    // 1. CORS Preflight
    if (req.method === 'OPTIONS') {
      if (origin && !isOriginAllowed) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Forbidden: Cross-origin request not allowed');
        return;
      }
      res.writeHead(204, corsHeaders);
      res.end();
      return;
    }

    // 2. Web Health Check Endpoint
    if (pathname === '/api/v1/web-health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders });
      res.end(JSON.stringify({
        status: 'ok',
        boundAddress: server.address()?.address || null,
        mode: paths.isPortable ? 'portable-unified' : 'workspace-unified',
        port
      }));
      return;
    }

    // 3. Question Bank Asset Serving (/assets/*, /api/v1/assets/*, /题库/assets/*)
    const rawDecodedUrl = decodeURIComponent(rawUrl.split('?')[0]);
    const assetMatch = rawDecodedUrl.match(/^\/(?:api\/v1\/assets|题库\/assets|assets)\/(.+)$/);
    if (assetMatch && req.method === 'GET') {
      const assetRelative = assetMatch[1];
      const resolvedAssetPath = path.resolve(bankAssetsDir, assetRelative);

      // Guard against directory traversal
      if (!resolvedAssetPath.startsWith(bankAssetsDir + path.sep) && resolvedAssetPath !== bankAssetsDir) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Forbidden: Path traversal outside bank assets');
        return;
      }

      return serveStaticFile(req, res, resolvedAssetPath);
    }

    // 4. API Endpoints Dispatch (/api/v1/*)
    if (pathname.startsWith('/api/v1/')) {
      return apiServer.emit('request', req, res);
    }

    // 5. Frontend Static Files Dispatch
    let targetFilePath;
    if (pathname.startsWith('/src/')) {
      targetFilePath = path.join(webSrcDir, pathname.replace(/^\/src\//, ''));
    } else if (pathname === '/' || pathname === '/index.html') {
      targetFilePath = path.join(webPublicDir, 'index.html');
    } else {
      targetFilePath = path.join(webPublicDir, pathname.replace(/^\//, ''));
    }

    // Fallback to index.html if file does not exist but request is text/html navigation
    if (!fs.existsSync(targetFilePath) && !path.extname(pathname)) {
      targetFilePath = path.join(webPublicDir, 'index.html');
    }

    serveStaticFile(req, res, targetFilePath);
  });

  unifiedServerInstance = server;

  return new Promise((resolve, reject) => {
    server.listen(port, host, () => {
      const lanList = getLanAddresses();
      console.log('======================================================================');
      console.log(' [Ruankao Exam Platform] 软考本地刷题与备考平台 (一体化便携版)');
      console.log('======================================================================');
      console.log(` 运行模式:   ${paths.isPortable ? '独立便携式免安装版 (Portable)' : '工作区一体化模式 (Workspace)'}`);
      console.log(` 数据持久化: ${paths.dbPath}`);
      console.log(` 题库根目录: ${paths.bankDir}`);
      console.log(` 材料根目录: ${paths.materialsDir}`);
      console.log('----------------------------------------------------------------------');
      console.log(` 本机访问入口:     http://127.0.0.1:${port}`);
      if (host === '0.0.0.0' && lanList.length > 0) {
        for (const lan of lanList) {
          console.log(` 局域网平板/手机:  http://${lan.address}:${port}  (${lan.name})`);
        }
      } else if (host !== '127.0.0.1') {
        console.log(` 访问入口:         http://${host}:${port}`);
      }
      console.log('======================================================================');

      resolve({
        server,
        port,
        host,
        paths,
        close: performGracefulShutdown
      });
    });

    server.on('error', reject);
  });
}

// Support direct execution via CLI
if (require.main === module) {
  const port = parseInt(process.env.PORT || '3124', 10);
  const host = process.env.HOST || '127.0.0.1';

  startUnifiedServer({ port, host })
    .then(({ close }) => {
      let isExiting = false;
      const onSignal = (sig) => {
        if (isExiting) return;
        isExiting = true;
        close().finally(() => process.exit(0));
      };
      process.on('SIGINT', () => onSignal('SIGINT'));
      process.on('SIGTERM', () => onSignal('SIGTERM'));
    })
    .catch(err => {
      console.error('[UnifiedServer] 启动失败:', err);
      process.exit(1);
    });
}

module.exports = {
  startUnifiedServer,
  resolveAppPaths
};
