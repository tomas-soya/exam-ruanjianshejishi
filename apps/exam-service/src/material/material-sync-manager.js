'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  STANDARD_CHAPTERS,
  resolveStandardChapter
} = require('../../../exam-contracts/dist/index.js');
const matRepo = require('../db/personal-materials-repository');
const { PersonalMaterialsSynthesizer } = require('../../../exam-llm');
const { isLossEvidence } = require('../../../exam-llm/src/materials/review-cards');

function resolveReviewChapter(question) {
  // Legacy bank chapter names otherwise fall through to computer systems.
  // Keep the correction within the personal-material consumer.
  const chapter = question?.chapter || '';
  if (question?.subject !== 'case' && !question?.sharedStem && !question?.shared_stem &&
      /项目管理|系统开发基础|软件测试|软件维护/.test(chapter)) {
    return STANDARD_CHAPTERS.find(ch => ch.key === 'obj_05_software_eng');
  }
  return resolveStandardChapter(question);
}

function getMaterialsBaseDir() {
  if (process.env.EXAM_MATERIALS_DIR && fs.existsSync(process.env.EXAM_MATERIALS_DIR)) {
    return path.resolve(process.env.EXAM_MATERIALS_DIR);
  }

  const candidateDirs = [
    path.resolve(__dirname, '../../../../软件设计师复习材料'),
    path.resolve(__dirname, '../../../软件设计师复习材料'),
    path.resolve(__dirname, '../../../exam-llm/fixtures/materials'),
    path.resolve(__dirname, '../../exam-llm/fixtures/materials')
  ];

  for (const dir of candidateDirs) {
    try {
      if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0) {
        return dir;
      }
    } catch {
      // continue
    }
  }

  return candidateDirs[0];
}

const chapterHeadingsCache = new Map();

/**
 * Parses static chapter markdown file to extract the ordered knowledge point directory.
 * Extracts ## and ### headings, generating clean titles and search keywords.
 */
function getChapterKnowledgeSections(docPath) {
  if (!docPath) return [];
  if (chapterHeadingsCache.has(docPath)) {
    return chapterHeadingsCache.get(docPath);
  }

  const baseDir = getMaterialsBaseDir();
  const filePath = path.join(baseDir, docPath);
  if (!fs.existsSync(filePath)) {
    chapterHeadingsCache.set(docPath, []);
    return [];
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    const sections = [];
    let secIndex = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      const match = trimmed.match(/^##\s+(\d+[\.、\s]+)?(.+)$/);
      if (match) {
        const rawTitle = match[2].trim();
        const keywords = rawTitle
          .split(/[\s：:、\/，,（）\(\)\+—与及和·-]+/)
          .map(k => k.trim())
          .filter(k => k.length >= 2 && !['复习', '核心', '知识', '考点', '精要', '体系', '基础'].includes(k));

        sections.push({
          index: secIndex++,
          title: rawTitle,
          keywords
        });
      }
    }

    chapterHeadingsCache.set(docPath, sections);
    return sections;
  } catch {
    chapterHeadingsCache.set(docPath, []);
    return [];
  }
}

/**
 * Maps a single knowledge point to an ordered section in the chapter's knowledge point directory.
 * AC-05: Deterministic interpretable mapping, never raw lexicographical sorting on long text.
 */
function getPointSectionIndex(point, sections) {
  if (!sections || sections.length === 0) return Infinity;

  // Extract tag if present: e.g. 【海明码】
  let tag = '';
  const tagMatch = point.match(/^[【\[]([^】\]]+)[】\]]/);
  if (tagMatch) {
    tag = tagMatch[1].trim();
  }

  // 1. Tag direct match against section title or section keywords
  if (tag) {
    for (const sec of sections) {
      if (sec.title.includes(tag) || tag.includes(sec.title)) {
        return sec.index;
      }
      for (const kw of sec.keywords) {
        if (kw.includes(tag) || tag.includes(kw)) {
          return sec.index;
        }
      }
    }
  }

  // 2. Keyword matching on point content
  let bestIndex = Infinity;
  let maxScore = 0;

  for (const sec of sections) {
    let score = 0;
    if (point.includes(sec.title)) {
      score += 10;
    }
    for (const kw of sec.keywords) {
      if (point.includes(kw)) {
        score += kw.length;
      }
    }
    if (score > maxScore) {
      maxScore = score;
      bestIndex = sec.index;
    }
  }

  return maxScore > 0 ? bestIndex : Infinity;
}

/**
 * Sorts points within a chapter according to the chapter's static knowledge point directory.
 * Unmapped points have deterministic stable tail order (AC-05).
 */
function sortChapterPoints(points, stdChapter) {
  if (!Array.isArray(points) || points.length <= 1) return points || [];
  const sections = stdChapter ? getChapterKnowledgeSections(stdChapter.docPath) : [];

  const indexed = points.map((p, idx) => ({
    point: p,
    originalIdx: idx,
    mappedIdx: getPointSectionIndex(p, sections)
  }));

  indexed.sort((a, b) => {
    if (a.mappedIdx !== b.mappedIdx) {
      return a.mappedIdx - b.mappedIdx;
    }
    return a.originalIdx - b.originalIdx;
  });

  return indexed.map(item => item.point);
}

/**
 * Extracts concise review points from either newly formatted or legacy materials Markdown.
 * Safe read-time projection adhering to AC-1, AC-2, AC-4, and AC-5:
 * - Cancels 5-point and 90-char caps (AC-1, AC-4)
 * - Complete coverage of all valid points without artificial truncation (AC-1)
 * - Deduplicated and filtered from placeholders
 * - Does not chop formulas or sentences
 */
function extractConcisePointsFromMarkdown(markdownContent, chapterName = '') {
  if (!markdownContent || typeof markdownContent !== 'string') return [];
  const text = markdownContent.trim();
  if (text.length === 0) return [];

  const lines = text.split('\n');
  const rawPoints = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Detect list items or numbered items
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ') || /^\d+[\.、）\)]/.test(trimmed)) {
      let pt = trimmed
        .replace(/^[-*•]\s*/, '')
        .replace(/^\d+[\.、）\)]\s*/, '')
        .replace(/^\[[ x]\]\s*/i, '')
        .trim();

      // Skip placeholders and empty notices
      if (
        !pt ||
        pt.includes('待后续练习积累更多答题实测证据进行细化') ||
        pt.includes('暂无') ||
        pt.includes('本次作答全部正确') ||
        pt === '无'
      ) {
        continue;
      }

      // Strip markdown bold markers from points
      pt = pt.replace(/\*\*/g, '');

      // Normalize tag format if separated by colon
      if (!pt.startsWith('【') && !pt.startsWith('[')) {
        const colonIdx = pt.indexOf('：') !== -1 ? pt.indexOf('：') : pt.indexOf(':');
        if (colonIdx > 0 && colonIdx <= 20) {
          const tag = pt.slice(0, colonIdx).trim();
          const rest = pt.slice(colonIdx + 1).trim();
          pt = `【${tag}】${rest}`;
        }
      }

      // AC-1 & AC-4: Keep complete points; never discard valid points due to length exceeding 90 chars
      if (pt.length >= 3) {
        rawPoints.push(pt);
      }
    }
  }

  // Deduplicate points
  const seen = new Set();
  const deduped = [];
  for (const p of rawPoints) {
    const key = p.replace(/[【】\[\]\s，。；、]/g, '').toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(p);
    }
  }

  // AC-1: Do not slice to 5 points; return all valid deduplicated points
  return deduped;
}

/**
 * Determines whether an answered question is a real wrong question or score-loss item (AC-1).
 */
function isWrongOrLostPointQuestion(q) {
  return isLossEvidence(q);
}

/**
 * Distinguishes output length truncation vs quota/rate-limiting vs auth vs network timeout errors,
 * producing clear, user-understandable Chinese descriptions (AC-03).
 */
function formatUserFriendlyError(err) {
  const rawMsg = err?.message || 'LLM synthesis failed';
  if (/finish_reason:\s*(?:length|max_tokens)/i.test(rawMsg)) {
    if (!rawMsg.includes('大模型单次生成长度达到上限') && !rawMsg.includes('输出长度超出')) {
      return `${rawMsg}（大模型单次生成长度达到上限，已中止以保护已有资料）`;
    }
    return rawMsg;
  }
  if (/HTTP 429/i.test(rawMsg) || /429 Too Many Requests/i.test(rawMsg) || /rate limit/i.test(rawMsg)) {
    return `大模型 API 访问频控或调用额度受限 (HTTP 429 Too Many Requests)，已保留上一版本复习资料。原始信息: ${rawMsg}`;
  }
  if (/HTTP 401/i.test(rawMsg) || /HTTP 403/i.test(rawMsg) || /认证失败/i.test(rawMsg) || /unauthorized/i.test(rawMsg)) {
    return `大模型 API 认证失败 (HTTP 401/403)：请检查大模型 API 密钥是否有效。原始信息: ${rawMsg}`;
  }
  if (/timed out/i.test(rawMsg) || /ETIMEDOUT/i.test(rawMsg) || /ECONNREFUSED/i.test(rawMsg) || /fetch failed/i.test(rawMsg)) {
    return `大模型网络连接超时或网关不可达，已保留上一版本复习资料。原始信息: ${rawMsg}`;
  }
  return rawMsg;
}

/**
 * Material Sync Manager (AC-1..AC-6)
 * Asynchronous background worker for maintaining personal chapter review materials (错题复习要点).
 */
class MaterialSyncManager {
  /**
   * @param {object} options
   * @param {import('node:sqlite').DatabaseSync} options.db
   * @param {PersonalMaterialsSynthesizer} [options.synthesizer]
   * @param {boolean} [options.autoStart=true]
   * @param {object} [options.llmConfig]
   */
  constructor({ db, synthesizer, autoStart = true, llmConfig = null }) {
    this.db = db;
    this.synthesizer = synthesizer || new PersonalMaterialsSynthesizer();
    this.activeChapters = new Set(); // Concurrency lock per chapterKey
    this.isProcessing = false;
    this.isShuttingDown = false;

    this._ensureLlmConfig(llmConfig);

    if (autoStart) {
      this.initialize();
    }
  }

  /**
   * Ensures synthesizer's gatewayAdapter is configured with the latest LLM settings.
   * Dynamically loads from DB if not explicitly supplied.
   * @param {object} [explicitConfig]
   */
  _ensureLlmConfig(explicitConfig) {
    let cfg = explicitConfig;
    if (!cfg && this.db) {
      try {
        const settingsRepo = require('../db/settings-repository');
        cfg = settingsRepo.getSetting(this.db, 'llm_config');
      } catch {}
    }
    if (cfg && typeof cfg === 'object' && this.synthesizer?.gatewayAdapter?.updateConfig) {
      this.synthesizer.gatewayAdapter.updateConfig({
        endpoint: cfg.endpoint,
        apiKey: cfg.apiKey,
        model: cfg.model,
        timeoutMs: cfg.timeoutMs
      });
      if (typeof cfg.timeoutMs === 'number' && cfg.timeoutMs > 0) {
        this.synthesizer.timeoutMs = cfg.timeoutMs;
      }
    }
  }

  /**
   * Initializes background worker and performs restart recovery.
   */
  initialize() {
    try {
      matRepo.resetProcessingJobsToPending(this.db);
    } catch (e) {
      console.warn('[MaterialSyncManager] Failed to reset processing jobs on start:', e.message);
    }

    this.triggerProcessQueue();
  }

  /**
   * Gracefully shuts down queue processing.
   */
  shutdown() {
    this.isShuttingDown = true;
  }

  /**
   * Enqueues background sync jobs for an exam submission.
   * Decoupled and non-blocking: returns immediately with enqueued job IDs.
   * 
   * AC-1 Invariants:
   * - Memorize mode never infers weaknesses or enqueues jobs.
   * - Only real wrong questions and lost-point case questions are enqueued.
   * - Fully correct questions never create new weak points or sync jobs.
   * 
   * @param {object} params
   * @param {string} params.sessionId
   * @param {string} params.practiceMode - 'exam' | 'practice' | 'memorize'
   * @param {Array<object>} params.reportQuestions - Graded question objects
   * @returns {string[]} Array of created job IDs
   */
  enqueueSessionSubmission({ sessionId, practiceMode = 'exam', reportQuestions = [], triggerType = 'exam_submission', processQueue = true }) {
    // AC-1: Memorize mode skips weak point creation
    if (practiceMode === 'memorize') {
      return [];
    }

    // Regrading also passes full marks so obsolete loss evidence can be removed.
    const wrongQuestions = (reportQuestions || []).filter(q => triggerType === 'case_regrade'
      ? !q.pendingScoring && !q.isElectiveUnselected && q.status !== 'unanswered'
      : isWrongOrLostPointQuestion(q));
    if (wrongQuestions.length === 0) {
      return [];
    }

    // Group only wrong questions by chapter
    const chapterMap = new Map();
    for (const q of wrongQuestions) {
      const stdChapter = resolveReviewChapter(q.question);
      if (!chapterMap.has(stdChapter.key)) {
        chapterMap.set(stdChapter.key, {
          chapter: stdChapter,
          evidences: []
        });
      }

      chapterMap.get(stdChapter.key).evidences.push({
        questionId: q.question.id,
        stem: q.question.questionStem || q.question.sharedStem || '',
        options: q.question.options || [],
        userAnswer: q.userAnswer,
        standardAnswer: q.effectiveAnswer || (q.solutionCodeBlocks ? '参考解答见解析' : '无'),
        analysis: q.analysis || '',
        isCorrect: q.isCorrect,
        points: q.score,
        maxPoints: q.maxScore,
        feedback: q.caseReview ? q.caseReview.feedback : '',
        breakdown: q.caseReview ? q.caseReview.breakdown : [],
        status: q.status
      });
    }

    const createdJobIds = [];

    for (const [chapterKey, group] of chapterMap.entries()) {
      // Skip if identical job already exists
      const existingJob = matRepo.findJobBySessionAndChapter(this.db, sessionId, chapterKey);
      if (existingJob && triggerType === 'exam_submission') {
        continue;
      }

      const jobId = `job_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      const payloadJson = JSON.stringify({
        chapterKey,
        chapterName: group.chapter.name,
        subject: group.chapter.subject,
        evidences: group.evidences
      });

      matRepo.createSyncJob(this.db, {
        id: jobId,
        chapterKey,
        sessionId,
        triggerType,
        payloadJson
      });

      // Update chapter material record to 'pending' if it was empty or failed
      const existingMat = matRepo.getChapterMaterial(this.db, chapterKey);
      if (!existingMat) {
        matRepo.saveChapterMaterial(this.db, {
          chapterKey,
          chapterName: group.chapter.name,
          subject: group.chapter.subject,
          status: 'pending',
          version: 0,
          markdownContent: null,
          lastJobId: jobId
        });
      } else if (existingMat.status === 'empty' || existingMat.status === 'failed') {
        matRepo.updateChapterStatus(this.db, chapterKey, {
          status: 'pending',
          lastJobId: jobId,
          lastError: null
        });
      }

      createdJobIds.push(jobId);
    }

    if (processQueue) this.triggerProcessQueue();
    return createdJobIds;
  }

  /**
   * Enqueues background sync update triggered by teacher case override.
   */
  enqueueCaseOverride({ sessionId, question, points, notes }) {
    const stdChapter = resolveStandardChapter(question);
    const chapterKey = stdChapter.key;

    // AC-1: Teacher case override represents score adjustment
    const jobId = `job_override_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const payloadJson = JSON.stringify({
      chapterKey,
      chapterName: stdChapter.name,
      subject: stdChapter.subject,
      evidences: [
        {
          questionId: question.id,
          stem: question.caseTitle || question.sharedStem || '',
          userAnswer: '[教师覆核题组]',
          standardAnswer: '参考评分细则',
          analysis: '已完成人工覆核',
          isCorrect: points >= 9,
          points,
          maxPoints: 15,
          feedback: `教师覆核调整：${notes || '分数已更新'}`,
          humanOverride: { points, notes }
        }
      ]
    });

    matRepo.createSyncJob(this.db, {
      id: jobId,
      chapterKey,
      sessionId,
      triggerType: 'case_override',
      payloadJson
    });

    matRepo.updateChapterStatus(this.db, chapterKey, {
      status: 'pending',
      lastJobId: jobId,
      lastError: null
    });

    this.triggerProcessQueue();
    return jobId;
  }

  /**
   * Retries a failed sync job for a specific chapter.
   */
  retryChapterSync(chapterKey) {
    const stdChapter = STANDARD_CHAPTERS.find(c => c.key === chapterKey) || resolveStandardChapter(chapterKey);

    const stmt = this.db.prepare(`
      SELECT * FROM material_sync_jobs WHERE chapter_key = ? ORDER BY created_at DESC LIMIT 1
    `);
    const lastJob = stmt.get(chapterKey);

    let payloadJson = lastJob ? lastJob.payload_json : '{}';
    if (!lastJob || !payloadJson || payloadJson === '{}') {
      payloadJson = JSON.stringify({
        chapterKey: stdChapter.key,
        chapterName: stdChapter.name,
        subject: stdChapter.subject,
        evidences: []
      });
    }

    const jobId = `job_retry_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    matRepo.createSyncJob(this.db, {
      id: jobId,
      chapterKey: stdChapter.key,
      sessionId: lastJob ? lastJob.session_id : null,
      triggerType: 'manual_retry',
      payloadJson
    });

    matRepo.updateChapterStatus(this.db, stdChapter.key, {
      status: 'pending',
      lastJobId: jobId,
      lastError: null
    });

    this.triggerProcessQueue();
    return jobId;
  }

  /**
   * Triggers queue execution asynchronously without blocking.
   */
  triggerProcessQueue() {
    setImmediate(() => {
      this.processQueue().catch(err => {
        console.warn('[MaterialSyncManager] processQueue error:', err.message);
      });
    });
  }

  /**
   * Waits until all pending and processing jobs are completely finished.
   * @param {number} [timeoutMs=60000]
   */
  async waitForIdle(timeoutMs = 60000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (this.isShuttingDown) return;
      let pending = [];
      let processing = [];
      try {
        pending = matRepo.findPendingJobs(this.db);
        processing = matRepo.findProcessingJobs(this.db);
      } catch {
        return;
      }
      if (pending.length === 0 && processing.length === 0 && this.activeChapters.size === 0) {
        return true;
      }
      await new Promise(r => setTimeout(r, 200));
    }
    throw new Error(`Timed out waiting for material sync queue to become idle after ${timeoutMs}ms`);
  }

  /**
   * Processes all pending jobs with per-chapter serial concurrency locks.
   */
  async processQueue() {
    if (this.isProcessing || this.isShuttingDown) return;
    this.isProcessing = true;

    try {
      const pendingJobs = matRepo.findPendingJobs(this.db);

      for (const job of pendingJobs) {
        if (this.isShuttingDown) break;

        const chapterKey = job.chapter_key;
        if (this.activeChapters.has(chapterKey)) {
          continue;
        }

        this.activeChapters.add(chapterKey);

        try {
          await this._executeJob(job);
        } catch (e) {
          console.warn(`[MaterialSyncManager] Job ${job.id} execution failed:`, e.message);
        } finally {
          this.activeChapters.delete(chapterKey);
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Executes a single sync job.
   */
  async _executeJob(job) {
    if (this.isShuttingDown) return;
    try {
      this.db.prepare('SELECT 1').get();
    } catch {
      return;
    }

    this._ensureLlmConfig();

    const startedAt = new Date().toISOString();
    matRepo.updateJobStatus(this.db, job.id, {
      status: 'processing',
      startedAt
    });

    matRepo.updateChapterStatus(this.db, job.chapter_key, {
      status: 'processing',
      lastJobId: job.id
    });

    let payload = {};
    try {
      payload = JSON.parse(job.payload_json || '{}');
    } catch {
      payload = {};
    }

    const chapterKey = job.chapter_key;
    const stdChapter = STANDARD_CHAPTERS.find(c => c.key === chapterKey) || resolveStandardChapter(chapterKey);
    const existingMat = matRepo.getChapterMaterial(this.db, chapterKey);

    let existingMetadata = null;
    if (existingMat && existingMat.metadata_json) {
      try {
        existingMetadata = JSON.parse(existingMat.metadata_json);
      } catch {}
    }

    const evidences = Array.isArray(payload.evidences) && payload.evidences.length > 0
      ? payload.evidences
      : [];

    // AC-3: Merge with historical wrong evidences retained in chapter metadata
    const existingRetained = Array.isArray(existingMetadata?.retainedEvidences) ? existingMetadata.retainedEvidences : [];
    const evidenceMap = new Map();

    const masteredIds = new Set();
    try {
      const allWrongRows = this.db.prepare('SELECT question_id, mastered FROM wrong_questions').all();
      allWrongRows.filter(r => Number(r.mastered) === 1).forEach(r => masteredIds.add(r.question_id));
    } catch {}

    for (const ev of existingRetained) {
      if (ev && ev.questionId && isWrongOrLostPointQuestion(ev)) {
        // Partial-score case items can have isCorrect=true and never enter the
        // wrong notebook. Absence from that table does not establish mastery.
        if (masteredIds.has(ev.questionId)) continue;
        evidenceMap.set(ev.questionId, ev);
      }
    }

    for (const ev of evidences) {
      if (ev && ev.questionId) {
        if (!isWrongOrLostPointQuestion(ev)) {
          evidenceMap.delete(ev.questionId);
        } else {
          evidenceMap.set(ev.questionId, ev);
        }
      } else if (ev && isWrongOrLostPointQuestion(ev)) {
        evidenceMap.set(`ev_${evidenceMap.size}`, ev);
      }
    }

    const mergedEvidences = Array.from(evidenceMap.values());

    if (mergedEvidences.length === 0) {
      // Empty evidence must clear obsolete cards and finish the chapter state;
      // the previous implementation left it stuck as processing with old text.
      this.db.exec('BEGIN IMMEDIATE');
      try {
        if (existingMat?.markdown_content) {
          matRepo.saveMaterialHistory(this.db, { chapterKey, version: existingMat.version,
            markdownContent: existingMat.markdown_content, metadataJson: existingMat.metadata_json, jobId: job.id });
        }
        matRepo.saveChapterMaterial(this.db, { chapterKey, chapterName: stdChapter.name, subject: stdChapter.subject,
          status: 'empty', version: (existingMat?.version || 0) + 1,
          markdownContent: null, metadataJson: JSON.stringify({ retainedEvidences: [], reviewCards: [],
            formatVersion: 'review-cards-v1', summary: { weakPointsCount: 0, misconceptionsCount: 0, tipsCount: 0, checklistsCount: 0 } }),
          lastJobId: job.id });
        matRepo.updateJobStatus(this.db, job.id, {
          status: 'done',
          completedAt: new Date().toISOString()
        });
        this.db.exec('COMMIT');
      } catch (error) { this.db.exec('ROLLBACK'); throw error; }
      return;
    }

    try {
      // Call LLM Synthesizer with sanitized metadata to prevent stale retained cache reflux
      const sanitizedExistingMetadata = existingMetadata ? {
        ...existingMetadata,
        retainedEvidences: mergedEvidences
      } : {
        retainedEvidences: mergedEvidences
      };

      const synthResult = await this.synthesizer.synthesizeChapterMaterial({
        chapterKey,
        chapterName: payload.chapterName || stdChapter.name,
        subject: payload.subject || stdChapter.subject,
        answeredEvidences: mergedEvidences,
        existingMarkdown: existingMat ? existingMat.markdown_content : null,
        existingMetadata: sanitizedExistingMetadata
      });

      const currentVersion = existingMat ? existingMat.version : 0;
      const nextVersion = currentVersion + 1;

      // 1. Save history version for audit and rollback
      if (existingMat && existingMat.markdown_content) {
        matRepo.saveMaterialHistory(this.db, {
          chapterKey,
          version: currentVersion,
          markdownContent: existingMat.markdown_content,
          metadataJson: existingMat.metadata_json,
          jobId: job.id
        });
      }

      // 2. Update current active chapter material
      const metaToSave = {
        ...(synthResult.metadata || {}),
        summary: synthResult.summary || (synthResult.metadata && synthResult.metadata.summary),
        ebbinghaus: synthResult.ebbinghaus || (synthResult.metadata && synthResult.metadata.ebbinghaus),
        retainedEvidences: mergedEvidences
      };

      matRepo.saveChapterMaterial(this.db, {
        chapterKey,
        chapterName: payload.chapterName || stdChapter.name,
        subject: payload.subject || stdChapter.subject,
        status: 'updated',
        version: nextVersion,
        markdownContent: synthResult.markdown,
        metadataJson: JSON.stringify(metaToSave),
        lastJobId: job.id,
        lastError: null,
        nextReviewAt: synthResult.ebbinghaus?.nextReviewAt || null,
        reviewStage: synthResult.ebbinghaus?.stage || 1
      });

      // 3. Complete job
      matRepo.updateJobStatus(this.db, job.id, {
        status: 'done',
        completedAt: new Date().toISOString()
      });

    } catch (err) {
      // AC-3: Failure preservation - preserve previous version of markdown!
      const errorMsg = formatUserFriendlyError(err);
      matRepo.updateJobStatus(this.db, job.id, {
        status: 'failed',
        errorMessage: errorMsg,
        completedAt: new Date().toISOString()
      });

      matRepo.updateChapterStatus(this.db, chapterKey, {
        status: 'failed',
        lastJobId: job.id,
        lastError: errorMsg
      });
    }
  }

  /**
   * Retrieves all 21 standard chapters merged with their personal material state.
   */
  getAllChaptersMaterialList() {
    const savedMaterials = matRepo.listChapterMaterials(this.db);
    const materialMap = new Map();
    for (const m of savedMaterials) {
      materialMap.set(m.chapter_key, m);
    }

    const now = new Date();

    const result = STANDARD_CHAPTERS.map(ch => {
      const saved = materialMap.get(ch.key);
      if (!saved || saved.status === 'empty') {
        return {
          chapterKey: ch.key,
          chapterName: ch.name,
          subject: ch.subject,
          docPath: ch.docPath,
          order: ch.order,
          status: 'empty',
          version: 0,
          markdownContent: null,
          summary: {
            weakPointsCount: 0,
            misconceptionsCount: 0,
            tipsCount: 0,
            checklistsCount: 0
          },
          ebbinghaus: {
            nextReviewAt: null,
            stage: 0,
            intervalDays: 0,
            isDue: false
          },
          lastUpdatedAt: null,
          lastJobId: null,
          lastError: null
        };
      }

      let meta = {};
      try {
        meta = JSON.parse(saved.metadata_json || '{}');
      } catch {}

      const nextReview = saved.next_review_at ? new Date(saved.next_review_at) : null;
      const isDue = nextReview ? nextReview <= now : false;

      // Extract points for projection
      const pts = extractConcisePointsFromMarkdown(saved.markdown_content, ch.name);
      let content = saved.markdown_content;
      if (content && !content.startsWith('# 【错题复习要点】') && pts.length > 0) {
        content = `# 【错题复习要点】${ch.name}\n\n${pts.map(p => `- ${p}`).join('\n')}`;
      }

      const summary = meta.summary || {
        weakPointsCount: pts.length,
        misconceptionsCount: pts.length,
        tipsCount: pts.filter(p => /口诀|技巧|Tips|注意|建议|应当/.test(p)).length || 1,
        checklistsCount: pts.filter(p => /检查|自查|步骤|核对|清单/.test(p)).length || 1
      };

      return {
        chapterKey: ch.key,
        chapterName: ch.name,
        subject: ch.subject,
        docPath: ch.docPath,
        order: ch.order,
        status: saved.status,
        version: saved.version,
        markdownContent: content,
        summary,
        ebbinghaus: {
          nextReviewAt: saved.next_review_at,
          stage: saved.review_stage,
          intervalDays: meta.ebbinghaus?.intervalDays || 1,
          isDue
        },
        lastUpdatedAt: saved.updated_at,
        lastJobId: saved.last_job_id,
        lastError: saved.last_error
      };
    });

    const standardKeys = new Set(STANDARD_CHAPTERS.map(c => c.key));
    for (const saved of savedMaterials) {
      if (!standardKeys.has(saved.chapter_key)) {
        let meta = {};
        try {
          meta = JSON.parse(saved.metadata_json || '{}');
        } catch {}

        const nextReview = saved.next_review_at ? new Date(saved.next_review_at) : null;
        const isDue = nextReview ? nextReview <= now : false;

        const pts = extractConcisePointsFromMarkdown(saved.markdown_content, saved.chapter_name);
        let content = saved.markdown_content;
        if (content && !content.startsWith('# 【错题复习要点】') && pts.length > 0) {
          content = `# 【错题复习要点】${saved.chapter_name}\n\n${pts.map(p => `- ${p}`).join('\n')}`;
        }

        const summary = meta.summary || {
          weakPointsCount: pts.length,
          misconceptionsCount: pts.length,
          tipsCount: pts.filter(p => /口诀|技巧|Tips|注意|建议|应当/.test(p)).length || 1,
          checklistsCount: pts.filter(p => /检查|自查|步骤|核对|清单/.test(p)).length || 1
        };

        result.push({
          chapterKey: saved.chapter_key,
          chapterName: saved.chapter_name,
          subject: saved.subject,
          docPath: '',
          order: 999,
          status: saved.status,
          version: saved.version,
          markdownContent: content,
          summary,
          ebbinghaus: {
            nextReviewAt: saved.next_review_at,
            stage: saved.review_stage,
            intervalDays: meta.ebbinghaus?.intervalDays || 1,
            isDue
          },
          lastUpdatedAt: saved.updated_at,
          lastJobId: saved.last_job_id,
          lastError: saved.last_error
        });
      }
    }

    return result;
  }

  /**
   * Retrieves full chapter material detail including versions history.
   * Safe read-time projection of concise points without mutating DB (AC-3).
   */
  getChapterMaterialDetail(chapterKey) {
    if (!chapterKey) return null;
    const stdChapter = STANDARD_CHAPTERS.find(c => c.key === chapterKey || c.name === chapterKey);
    if (!stdChapter) {
      return null;
    }
    const saved = matRepo.getChapterMaterial(this.db, stdChapter.key);
    const history = matRepo.getMaterialHistory(this.db, stdChapter.key);

    let meta = {};
    if (saved && saved.metadata_json) {
      try {
        meta = JSON.parse(saved.metadata_json);
      } catch {}
    }

    const now = new Date();
    const nextReview = saved?.next_review_at ? new Date(saved.next_review_at) : null;
    const isDue = nextReview ? nextReview <= now : false;

    let displayedMarkdown = saved ? saved.markdown_content : null;
    let points = [];
    if (displayedMarkdown) {
      points = extractConcisePointsFromMarkdown(displayedMarkdown, stdChapter.name);
      points = sortChapterPoints(points, stdChapter);
      if (displayedMarkdown.startsWith('# 【错题复习要点】')) {
        displayedMarkdown = `# 【错题复习要点】${stdChapter.name}\n\n${points.map(p => `- ${p}`).join('\n')}`;
      } else if (points.length > 0) {
        displayedMarkdown = `# 【错题复习要点】${stdChapter.name}\n\n${points.map(p => `- ${p}`).join('\n')}`;
      } else if (saved.status === 'updated') {
        displayedMarkdown = `# 【错题复习要点】${stdChapter.name}\n\n（暂无有效错题复习要点）`;
      }
    }

    const count = points.length;
    const summary = meta.summary || {
      weakPointsCount: count,
      misconceptionsCount: count,
      tipsCount: count > 0 ? (points.filter(p => /口诀|技巧|Tips|注意|建议|应当/.test(p)).length || 1) : 0,
      checklistsCount: count > 0 ? (points.filter(p => /检查|自查|步骤|核对|清单/.test(p)).length || 1) : 0
    };

    return {
      chapterKey: stdChapter.key,
      chapterName: stdChapter.name,
      subject: stdChapter.subject,
      docPath: stdChapter.docPath,
      order: stdChapter.order,
      status: saved ? saved.status : 'empty',
      version: saved ? saved.version : 0,
      markdownContent: displayedMarkdown,
      summary,
      ebbinghaus: {
        nextReviewAt: saved?.next_review_at || null,
        stage: saved?.review_stage || 0,
        intervalDays: meta.ebbinghaus?.intervalDays || 1,
        isDue
      },
      lastUpdatedAt: saved?.updated_at || null,
      lastJobId: saved?.last_job_id || null,
      lastError: saved?.last_error || null,
      metadata: meta,
      history: history.map(h => ({
        version: h.version,
        createdAt: h.created_at,
        jobId: h.job_id
      }))
    };
  }

  /**
   * Retrieves aggregated dynamic review key points for a specific subject ('objective' or 'case').
   * AC-1, AC-2, AC-3, AC-4, AC-5:
   * - Unified name: 错题复习要点
   * - Exactly TWO aggregated materials exist (objective & case)
   * - Complete coverage of all distinct points without 12-point or 1200-char caps (AC-1)
   * - Grouped by natural 13/8 chapter sequence, ordered by chapter knowledge directory (AC-05)
   * - Deduplicated across chapters, unmapped points have stable tail order
   * - Old format handled via safe projection without DB write or GET LLM calls
   * - Empty state if no valid points exist
   * @param {'objective' | 'case'} subject
   */
  getDynamicMaterialsSummary(subject = 'objective') {
    const safeSubject = subject === 'case' ? 'case' : 'objective';

    // 1. Check wrong questions count
    let wrongCount = 0;
    try {
      const wrongRow = this.db.prepare(
        'SELECT COUNT(*) as cnt FROM wrong_questions WHERE question_type = ? AND mastered = 0'
      ).get(safeSubject);
      wrongCount = wrongRow ? Number(wrongRow.cnt || 0) : 0;
    } catch {
      wrongCount = 0;
    }
    const hasWrongQuestions = wrongCount > 0;

    // 2. Check pending/processing jobs
    let pendingJobsCount = 0;
    try {
      const pendingRow = this.db.prepare(`
        SELECT COUNT(*) as cnt FROM material_sync_jobs j
        JOIN personal_chapter_materials m ON j.chapter_key = m.chapter_key
        WHERE m.subject = ? AND j.status IN ('pending', 'processing')
      `).get(safeSubject);
      pendingJobsCount = pendingRow ? Number(pendingRow.cnt || 0) : 0;
    } catch {
      pendingJobsCount = 0;
    }

    // 3. Get all chapters belonging to this subject in natural 13 / 8 order
    const allChapters = this.getAllChaptersMaterialList().filter(ch => ch.subject === safeSubject);
    const failedChapters = allChapters.filter(ch => ch.status === 'failed');

    // 4. Extract concise points per chapter and sort by chapter's knowledge point directory (AC-05)
    const chapterPointsMap = new Map();
    const chaptersWithData = [];

    for (const ch of allChapters) {
      if (ch.markdownContent && ch.markdownContent.trim().length > 0) {
        const rawPts = extractConcisePointsFromMarkdown(ch.markdownContent, ch.chapterName);
        if (rawPts.length > 0) {
          const std = STANDARD_CHAPTERS.find(c => c.key === ch.chapterKey || c.name === ch.chapterName);
          const sortedPts = sortChapterPoints(rawPts, std);
          chapterPointsMap.set(ch.chapterKey, sortedPts);
          chaptersWithData.push(ch);
        }
      }
    }

    // 5. Aggregate and deduplicate points across chapters in natural chapter order (AC-05)
    const allExtractedPoints = [];
    const seenPointKeys = new Set();
    const chapterSortedPointsMap = new Map();

    for (const ch of chaptersWithData) {
      const pts = chapterPointsMap.get(ch.chapterKey) || [];
      const distinctChapterPts = [];
      for (const p of pts) {
        const normKey = p.replace(/[【】\[\]\s，。；、]/g, '').toLowerCase();
        if (!seenPointKeys.has(normKey)) {
          seenPointKeys.add(normKey);
          distinctChapterPts.push(p);
          allExtractedPoints.push(p);
        }
      }
      if (distinctChapterPts.length > 0) {
        chapterSortedPointsMap.set(ch.chapterKey, distinctChapterPts);
      }
    }

    // AC-1, AC-05: Cancel artificial 12-point limit; summarize all distinct points
    const candidatePoints = allExtractedPoints;

    let status = 'empty';
    if (pendingJobsCount > 0) {
      status = 'processing';
    } else if (chaptersWithData.length > 0 && candidatePoints.length > 0) {
      status = failedChapters.length > 0 ? 'failed' : 'updated';
    } else if (failedChapters.length > 0) {
      status = 'failed';
    } else {
      status = 'empty';
    }

    let combinedMarkdown = null;
    let selectedPoints = [];
    let maxVersion = 0;
    let latestUpdatedAt = null;
    let latestError = null;
    let totalWeakPoints = 0;
    let totalTips = 0;
    let totalChecklists = 0;

    if (candidatePoints.length > 0 && status !== 'empty') {
      const headerTitle = safeSubject === 'objective'
        ? '# 软件设计师选择题错题复习要点'
        : '# 软件设计师案例题错题复习要点';
      const headerIntro = '> 先看“待补”定位薄弱点，再记规则、执行防错动作；自测先独立思考，再核对答案，能解释理由后再练同类题。';

      selectedPoints = candidatePoints;

      // Group by chapters in natural 13 / 8 order (AC-05)
      const sections = [headerTitle, '', headerIntro, ''];
      for (const ch of chaptersWithData) {
        const chPts = chapterSortedPointsMap.get(ch.chapterKey) || [];
        if (chPts.length > 0) {
          const std = STANDARD_CHAPTERS.find(c => c.key === ch.chapterKey || c.name === ch.chapterName);
          let headingTitle = ch.chapterName;
          if (std && std.docPath) {
            headingTitle = path.basename(std.docPath, '.md');
          }
          sections.push(`## ${headingTitle}`);
          sections.push(chPts.map(p => `- ${p}`).join('\n'));
          sections.push('');
        }
      }
      combinedMarkdown = sections.join('\n').trim();

      for (const c of chaptersWithData) {
        if (c.summary) {
          totalWeakPoints += Number(c.summary.weakPointsCount || 0);
          totalTips += Number(c.summary.tipsCount || 0);
          totalChecklists += Number(c.summary.checklistsCount || 0);
        }
        if (c.version > maxVersion) maxVersion = c.version;
        if (c.lastUpdatedAt && (!latestUpdatedAt || new Date(c.lastUpdatedAt) > new Date(latestUpdatedAt))) {
          latestUpdatedAt = c.lastUpdatedAt;
        }
      }
    }

    if (totalWeakPoints === 0 && selectedPoints.length > 0) {
      totalWeakPoints = selectedPoints.length;
      totalTips = selectedPoints.filter(p => /口诀|技巧|Tips|注意|建议|应当|公式|规则/.test(p)).length || Math.min(totalWeakPoints, 1);
      totalChecklists = selectedPoints.filter(p => /检查|自查|步骤|核对|清单|确认/.test(p)).length || Math.min(totalWeakPoints, 1);
    }

    if (failedChapters.length > 0) {
      latestError = failedChapters[0].lastError || '部分章节要点生成失败，请点击重试';
    }

    return {
      subject: safeSubject,
      title: safeSubject === 'objective' ? '选择题错题复习要点' : '案例题错题复习要点',
      status,
      version: maxVersion || (status === 'updated' ? 1 : 0),
      markdownContent: combinedMarkdown,
      lastUpdatedAt: latestUpdatedAt,
      lastError: latestError,
      hasWrongQuestions,
      wrongQuestionsCount: wrongCount,
      summary: {
        weakPointsCount: totalWeakPoints,
        tipsCount: totalTips,
        checklistsCount: totalChecklists,
        chaptersWithDataCount: chaptersWithData.length,
        totalChaptersCount: allChapters.length
      }
    };
  }

  /**
   * Retries dynamic material generation for a subject.
   * @param {'objective' | 'case'} subject
   */
  retrySubjectSync(subject = 'objective') {
    const safeSubject = subject === 'case' ? 'case' : 'objective';
    const chapters = this.getAllChaptersMaterialList().filter(ch => ch.subject === safeSubject);
    const toRetry = chapters.filter(ch => ch.status === 'failed' || ch.status === 'empty');
    const targetChapters = toRetry.length > 0 ? toRetry : chapters;

    const jobIds = [];
    for (const ch of targetChapters) {
      try {
        const jid = this.retryChapterSync(ch.chapterKey);
        jobIds.push(jid);
      } catch (err) {
        console.warn(`[MaterialSyncManager] Failed to retry chapter ${ch.chapterKey}:`, err.message);
      }
    }
    return {
      subject: safeSubject,
      jobIds,
      retriedChaptersCount: jobIds.length,
      status: 'pending'
    };
  }
}

module.exports = {
  MaterialSyncManager,
  extractConcisePointsFromMarkdown,
  isWrongOrLostPointQuestion,
  sortChapterPoints,
  getChapterKnowledgeSections,
  getPointSectionIndex
};
