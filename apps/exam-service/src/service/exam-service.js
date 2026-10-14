'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const {
  gradeObjectiveQuestion,
  assertStrictAnswerIsolation,
  sanitizeCaseQuestion,
  validateCaseScoreResult,
  calculateEffectiveMaxScore,
  resolveCaseElectiveSelection
} = require('../../../exam-contracts/dist/index.js');

const { VERIFIED_PAPER_IDS } = require('../bank/question-loader');
const { resolveMaterialAnchor } = require('../material/material-anchor');
const { PluggableCaseEvaluator } = require('../scoring/case-evaluator');
const { MaterialSyncManager } = require('../material/material-sync-manager');

const sessionRepo = require('../db/session-repository');
const answerRepo = require('../db/answer-repository');
const wrongQuestionsRepo = require('../db/wrong-questions-repository');
const reviewQueueRepo = require('../db/review-queue-repository');
const caseReviewRepo = require('../db/case-review-repository');
const settingsRepo = require('../db/settings-repository');
const { createDatabase, closeDatabase } = require('../db/connection');
const { runMigrations } = require('../db/migrator');

const STATIC_OBJECTIVE_CHAPTERS = [
  { id: '01-计算机系统知识', title: '01-计算机系统知识', doc: '选择题/01-计算机系统知识.md', subject: 'objective' },
  { id: '02-程序设计语言基础知识', title: '02-程序设计语言基础知识', doc: '选择题/02-程序设计语言基础知识.md', subject: 'objective' },
  { id: '03-数据结构', title: '03-数据结构', doc: '选择题/03-数据结构.md', subject: 'objective' },
  { id: '04-操作系统知识', title: '04-操作系统知识', doc: '选择题/04-操作系统知识.md', subject: 'objective' },
  { id: '05-软件工程基础知识', title: '05-软件工程基础知识', doc: '选择题/05-软件工程基础知识.md', subject: 'objective' },
  { id: '06-结构化开发方法', title: '06-结构化开发方法', doc: '选择题/06-结构化开发方法.md', subject: 'objective' },
  { id: '07-面向对象技术', title: '07-面向对象技术', doc: '选择题/07-面向对象技术.md', subject: 'objective' },
  { id: '08-算法设计与分析', title: '08-算法设计与分析', doc: '选择题/08-算法设计与分析.md', subject: 'objective' },
  { id: '09-数据库技术基础', title: '09-数据库技术基础', doc: '选择题/09-数据库技术基础.md', subject: 'objective' },
  { id: '10-网络与信息安全基础知识', title: '10-网络与信息安全基础知识', doc: '选择题/10-网络与信息安全基础知识.md', subject: 'objective' },
  { id: '11-标准化和软件知识产权基础知识', title: '11-标准化和软件知识产权基础知识', doc: '选择题/11-标准化和软件知识产权基础知识.md', subject: 'objective' },
  { id: '12-软件系统分析与设计', title: '12-软件系统分析与设计', doc: '选择题/12-软件系统分析与设计.md', subject: 'objective' },
  { id: '13-英语', title: '13-英语', doc: '选择题/13-英语.md', subject: 'objective' }
];

const STATIC_CASE_TOPICS = [
  { id: '01-结构化分析与设计', title: '01-结构化分析与设计', doc: '案例题/01-结构化分析与设计.md', subject: 'case' },
  { id: '02-面向对象设计模式与Java实现', title: '02-面向对象设计模式与Java实现', doc: '案例题/02-面向对象设计模式与Java实现.md', subject: 'case' },
  { id: '03-UML类图与面向对象分析', title: '03-UML类图与面向对象分析', doc: '案例题/03-UML类图与面向对象分析.md', subject: 'case' },
  { id: '04-数据库设计与关系模式', title: '04-数据库设计与关系模式', doc: '案例题/04-数据库设计与关系模式.md', subject: 'case' },
  { id: '05-UML用例图与活动图', title: '05-UML用例图与活动图', doc: '案例题/05-UML用例图与活动图.md', subject: 'case' },
  { id: '06-UML序列图与关系', title: '06-UML序列图与关系', doc: '案例题/06-UML序列图与关系.md', subject: 'case' },
  { id: '07-UML状态图与状态转换', title: '07-UML状态图与状态转换', doc: '案例题/07-UML状态图与状态转换.md', subject: 'case' },
  { id: '08-算法设计与分析', title: '08-算法设计与分析', doc: '案例题/08-算法设计与分析.md', subject: 'case' }
];

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


function isAnswerObjectPopulated(val) {
  if (val === null || val === undefined) return false;
  if (typeof val === 'string') return val.trim().length > 0;
  if (typeof val === 'object') {
    return Object.values(val).some(v => isAnswerObjectPopulated(v));
  }
  return Boolean(val);
}

/**
 * Read-side safe projection for candidate analysis.
 * Cleans internal crawl / dedup audit metadata (e.g. "同题对照：标准题", "来源选项→标准题选项")
 * ensuring student UI receives only clean teaching explanations.
 */
function projectCleanAnalysis(analysisText) {
  if (!analysisText || typeof analysisText !== 'string') return '';
  let cleaned = analysisText;

  cleaned = cleaned.replace(/^整理解析（来源第\s*\d+\s*题）/g, '整理解析');

  if (cleaned.includes('同题对照：标准题') || cleaned.includes('来源选项→标准题选项')) {
    const parts = cleaned.split(/(?:同题对照：标准题|重复判断依据|映射后平台答案)/);
    const teachingParts = parts.filter(p => {
      const trimmed = p.trim();
      if (!trimmed) return false;
      if (/^[A-D]\s*→\s*[A-D]/.test(trimmed)) return false;
      if (/^来源选项→标准题选项/.test(trimmed)) return false;
      if (/^[:：]\s*[A-D]/.test(trimmed)) return false;
      if (/都问.*别名链/.test(trimmed)) return false;
      return true;
    });
    if (teachingParts.length > 0) {
      cleaned = teachingParts.join('\n\n').trim();
    }
  }

  return cleaned.trim();
}

class ExamService {
  /**
   * @param {object} options
   * @param {import('node:sqlite').DatabaseSync} options.db
   * @param {import('../bank/question-loader').QuestionBankLoader} options.bankLoader
   * @param {import('../scoring/case-evaluator').BaseCaseEvaluator} [options.caseEvaluator]
   * @param {MaterialSyncManager} [options.materialSyncManager]
   * @param {import('../../../exam-llm').ExamChatService} [options.chatService]
   * @param {number} [options.chatTimeoutMs] Server-side configured chat timeout budget (default 30000ms)
   * @param {string} [options.dbPath] Absolute/relative path to SQLite database file
   */
  constructor({ db, bankLoader, caseEvaluator, materialSyncManager, autoStartSync = true, chatService, chatTimeoutMs, dbPath } = {}) {
    if (!db) throw new Error('ExamService requires a database instance');
    if (!bankLoader) throw new Error('ExamService requires a QuestionBankLoader instance');

    this.db = db;
    this.dbPath = dbPath || null;
    this.bankLoader = bankLoader;
    const { upgradeBankIdentifiers } = require('../db/bank-id-upgrade');
    upgradeBankIdentifiers(this.db, bankLoader.reconciliationManifest?.legacy_id_map, this.dbPath);
    this.caseEvaluator = caseEvaluator || new PluggableCaseEvaluator();
    this.materialSyncManager = materialSyncManager || new MaterialSyncManager({
      db: this.db,
      autoStart: autoStartSync
    });

    // P2-W7-01: Server-side configurable chat timeout budget (default 30s aligned with 23.3s empirical measurement)
    // Safe fallback on invalid/out-of-range configuration (valid range: 1000ms - 120000ms)
    let resolvedChatTimeout = 30000;
    try {
      const { resolveChatTimeoutMs } = require('../../../exam-llm');
      resolvedChatTimeout = resolveChatTimeoutMs(chatTimeoutMs !== undefined ? chatTimeoutMs : process.env.CHAT_TIMEOUT_MS);
    } catch {
      const rawVal = chatTimeoutMs !== undefined ? chatTimeoutMs : process.env.CHAT_TIMEOUT_MS;
      const parsed = typeof rawVal === 'number' ? rawVal : parseInt(rawVal, 10);
      resolvedChatTimeout = (Number.isFinite(parsed) && parsed >= 1000 && parsed <= 120000) ? parsed : 30000;
    }
    this.chatTimeoutMs = resolvedChatTimeout;

    let chatSvc = chatService;
    if (!chatSvc) {
      try {
        const { ExamChatService } = require('../../../exam-llm');
        chatSvc = new ExamChatService({ timeoutMs: this.chatTimeoutMs });
      } catch (e) {
        chatSvc = null;
      }
    }
    this.chatService = chatSvc;
    this.inFlightSubmissions = new Map();

    // Hot-load persistent LLM configuration from database
    this.initLlmFromSettings();
  }

  /**
   * Lists available verified papers with completion status.
   * AC-02: Preserves sort order.
   * AC-03: Exposes accurate isCompleted status.
   */
  listPapers(subject) {
    const papers = this.bankLoader.listVerifiedPapers();
    const filtered = subject ? papers.filter(p => p.subject === subject) : papers;
    return filtered.map(p => {
      const isCompleted = this.isPaperCompleted(p);
      return {
        ...p,
        isCompleted,
        completed: isCompleted
      };
    });
  }

  /**
   * AC-03: Determines if a paper has an undeleted, fully-answered, submitted whole-paper session.
   * - Objective: all paper questions must have valid non-empty answer.
   * - Case: all paper question groups must have ALL required subquestions validly answered
   *   (never consider complete if only partial subquestions answered).
   * - Excludes partial submissions, unsubmitted in-progress, chapter/wrong sessions, deleted sessions.
   * - Later in-progress session does not erase prior valid completion.
   * - Score/passing does not determine completion.
   */
  isPaperCompleted(paper) {
    if (!paper || !paper.id || !this.db) return false;

    // 1. Query undeleted submitted paper sessions for this paper and any of its aliases
    const canonicalId = this.bankLoader.getCanonicalPaperId ? this.bankLoader.getCanonicalPaperId(paper.id) : paper.id;
    const aliasIds = this.bankLoader.getPaperAliasIds ? this.bankLoader.getPaperAliasIds(canonicalId) : [canonicalId];
    const placeholders = aliasIds.map(() => '?').join(', ');

    const stmt = this.db.prepare(`
      SELECT id, answered_count AS answeredCount, total_questions AS totalQuestions
      FROM exam_sessions
      WHERE paper_id IN (${placeholders})
        AND session_mode = 'paper'
        AND status = 'submitted'
        AND COALESCE(is_deleted, 0) = 0
    `);
    const sessions = stmt.all(...aliasIds);
    if (!sessions || sessions.length === 0) {
      return false;
    }

    const expectedQids = this.bankLoader.getPaperQuestionIds(canonicalId) || this.bankLoader.getPaperQuestionIds(paper.id);
    if (!expectedQids || expectedQids.length === 0) {
      return false;
    }

    const answerStmt = this.db.prepare(`
      SELECT question_id AS questionId, user_answer_json AS rawAnswer
      FROM exam_answers
      WHERE session_id = ?
    `);

    for (const session of sessions) {
      const answerRows = answerStmt.all(session.id);
      const answerMap = new Map();
      for (const row of answerRows) {
        answerMap.set(row.questionId, row.rawAnswer);
      }

      // Check every expected question in paper
      let allAnswered = true;
      for (const qid of expectedQids) {
        const rawAns = answerMap.get(qid);
        if (!rawAns) {
          allAnswered = false;
          break;
        }

        if (paper.subject === 'case') {
          const rawQ = this.bankLoader.getRawQuestion(qid);
          if (!this._isCaseQuestionFullyAnswered(rawQ, rawAns)) {
            allAnswered = false;
            break;
          }
        } else {
          // Objective question
          let isPopulated = false;
          if (typeof rawAns === 'string') {
            const trimmed = rawAns.trim();
            if (trimmed.length > 0 && trimmed !== '""' && trimmed !== '{}') {
              try {
                const parsed = JSON.parse(trimmed);
                isPopulated = typeof parsed === 'string' ? parsed.trim().length > 0 : Boolean(parsed);
              } catch {
                isPopulated = true;
              }
            }
          } else if (rawAns !== null && rawAns !== undefined) {
            isPopulated = true;
          }
          if (!isPopulated) {
            allAnswered = false;
            break;
          }
        }
      }

      if (allAnswered) {
        return true;
      }
    }

    return false;
  }

  _isCaseQuestionFullyAnswered(rawQ, rawAns) {
    if (!rawAns) return false;
    const expectedSubs = sanitizeCaseQuestion(rawQ || {}).subQuestions;
    let parsed = rawAns;
    if (typeof rawAns === 'string') {
      const trimmed = rawAns.trim();
      if (!trimmed || trimmed === '""' || trimmed === '{}') return false;
      try {
        parsed = JSON.parse(rawAns);
      } catch {
        parsed = trimmed;
      }
    }
    if (typeof parsed === 'string') {
      return expectedSubs.length === 1 && parsed.trim().length > 0;
    }
    if (typeof parsed !== 'object' || parsed === null) {
      return false;
    }

    // Use the same IDs and boundaries as the displayed answer fields.
    return expectedSubs.every(sub => isAnswerObjectPopulated(parsed[sub.id]));
  }

  /**
   * Retrieves paper detail with sanitized questions (answers strictly stripped).
   */
  getPaperDetail(paperId) {
    if (!paperId) return null;
    const canonicalPaperId = this.bankLoader.getCanonicalPaperId ? this.bankLoader.getCanonicalPaperId(paperId) : paperId;
    const isAllowed = this.bankLoader.allowedPaperIds
      ? (this.bankLoader.allowedPaperIds.includes(paperId) || this.bankLoader.allowedPaperIds.includes(canonicalPaperId) || this.bankLoader.getAllPaperIds().includes(canonicalPaperId))
      : true;
    if (!isAllowed) {
      return null;
    }
    const paper = this.bankLoader.getPaper(canonicalPaperId) || this.bankLoader.getPaper(paperId);
    if (!paper) return null;

    const questions = this.bankLoader.getSanitizedPaperQuestions(canonicalPaperId) || this.bankLoader.getSanitizedPaperQuestions(paperId);
    assertStrictAnswerIsolation(questions);

    let totalQuestions = questions.length;
    const isCompleted = this.isPaperCompleted(paper);
    return {
      id: paper.id,
      title: paper.title,
      year: paper.year,
      season: paper.season,
      rawYear: paper.rawYear,
      rawSeason: paper.rawSeason,
      subject: paper.subject,
      isCompleted,
      completed: isCompleted,
      totalQuestions,
      standardQuestionGroups: paper.standard_question_groups,
      sourceUrl: paper.source_url,
      questions
    };
  }

  /**
   * Lists chapters with question distribution.
   */
  listChapters() {
    return this.bankLoader.listChapters();
  }

  /**
   * Lists all sessions (history).
   */
  listSessions(options) {
    return sessionRepo.listSessions(this.db, options);
  }

  /**
   * Soft deletes an exam session.
   * Restricts reading, resuming, reporting, drafting, and checking.
   * Does NOT affect wrong_questions, review_queue, personal materials or version history.
   * @param {string} sessionId
   */
  deleteSession(sessionId) {
    const session = sessionRepo.getSession(this.db, sessionId);
    if (!session) {
      const err = new Error(`Session ${sessionId} not found`);
      err.code = 'SESSION_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    const deleted = sessionRepo.deleteSession(this.db, sessionId);
    if (!deleted) {
      const err = new Error(`Session ${sessionId} not found or already deleted`);
      err.code = 'SESSION_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    return { id: sessionId, deleted: true };
  }

  /**
   * Updates interactive session state (practice mode, current position, answers revealed).
   */
  updateSessionState(sessionId, updates) {
    const session = sessionRepo.getSession(this.db, sessionId);
    if (!session) {
      const err = new Error(`Session ${sessionId} not found`);
      err.code = 'SESSION_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }
    return sessionRepo.updateSessionState(this.db, sessionId, updates);
  }

  /**
   * Creates a new exam session with independent practice mode.
   */
  createSession({ mode = 'paper', practiceMode = 'exam', paperId, chapter, questionIds, title }) {
    paperId = this.bankLoader.resolveLegacyId?.(paperId) || paperId;
    if (Array.isArray(questionIds)) questionIds = questionIds.map(id => this.bankLoader.resolveLegacyId?.(id) || id);
    if (!['paper', 'chapter', 'wrong_questions'].includes(mode)) {
      const err = new Error(`Invalid session mode: ${mode}`);
      err.statusCode = 400;
      err.code = 'INVALID_MODE';
      throw err;
    }

    const safePracticeMode = ['exam', 'practice', 'memorize'].includes(practiceMode) ? practiceMode : 'exam';

    if (mode === 'paper') {
      const canonicalPaperId = this.bankLoader.getCanonicalPaperId ? this.bankLoader.getCanonicalPaperId(paperId) : paperId;
      const isAllowed = this.bankLoader.allowedPaperIds
        ? (this.bankLoader.allowedPaperIds.includes(paperId) || this.bankLoader.allowedPaperIds.includes(canonicalPaperId) || this.bankLoader.getAllPaperIds().includes(canonicalPaperId))
        : true;
      if (!paperId || !isAllowed) {
        const err = new Error(`Invalid or unverified paperId: ${paperId}`);
        err.statusCode = 400;
        err.code = 'INVALID_PAPER_ID';
        throw err;
      }
      const paper = this.bankLoader.getPaper(canonicalPaperId) || this.bankLoader.getPaper(paperId);
      if (!paper) {
        const err = new Error(`Paper not found: ${paperId}`);
        err.statusCode = 404;
        err.code = 'PAPER_NOT_FOUND';
        throw err;
      }

      const questions = this.bankLoader.getSanitizedPaperQuestions(canonicalPaperId) || this.bankLoader.getSanitizedPaperQuestions(paperId);
      const totalQuestions = questions.length;
      const maxScore = calculateEffectiveMaxScore(totalQuestions, paper.subject, true);

      return sessionRepo.createSession(this.db, {
        sessionMode: 'paper',
        practiceMode: safePracticeMode,
        paperId: canonicalPaperId,
        chapter: null,
        title: (title || paper.title || '').replace('（希赛对账版）', ''),
        totalQuestions,
        maxScore
      });
    }

    if (mode === 'chapter') {
      if (!chapter) {
        const err = new Error('Chapter is required for chapter mode');
        err.statusCode = 400;
        err.code = 'MISSING_FIELD';
        throw err;
      }
      const questions = this.bankLoader.getQuestionsByChapter(chapter);
      const totalQuestions = questions.length;
      const isCaseChapter = questions.length > 0 && (questions[0].subject === 'case' || Boolean(questions[0].sharedStem));
      const maxScore = isCaseChapter ? totalQuestions * 15 : totalQuestions;

      return sessionRepo.createSession(this.db, {
        sessionMode: 'chapter',
        practiceMode: safePracticeMode,
        paperId: null,
        chapter,
        title: title || `${chapter} 专项训练`,
        totalQuestions,
        maxScore
      });
    }

    if (mode === 'wrong_questions') {
      let qids = questionIds;
      if (!Array.isArray(qids) || qids.length === 0) {
        const wrongList = wrongQuestionsRepo.listWrongQuestions(this.db, { mastered: false });
        qids = wrongList.map(w => w.questionId);
      }

      const totalQuestions = qids.length;
      return sessionRepo.createSession(this.db, {
        sessionMode: 'wrong_questions',
        practiceMode: safePracticeMode,
        paperId: null,
        chapter: null,
        title: title || '错题强化训练',
        totalQuestions,
        maxScore: totalQuestions
      });
    }
  }

  /**
   * Resumes an existing exam session, returning session, sanitized questions, and saved drafts.
   */
  resumeSession(sessionId) {
    const session = sessionRepo.getSession(this.db, sessionId);
    if (!session) return null;

    let questions = [];
    if (session.sessionMode === 'paper' && session.paperId) {
      questions = this.bankLoader.getSanitizedPaperQuestions(session.paperId);
    } else if (session.sessionMode === 'chapter' && session.chapter) {
      questions = this.bankLoader.getQuestionsByChapter(session.chapter);
    } else {
      // Wrong questions or custom set: load from answers or wrong list
      const savedAnswers = answerRepo.getAnswersForSession(this.db, sessionId);
      if (savedAnswers.length > 0) {
        for (const ans of savedAnswers) {
          const q = this.bankLoader.getSanitizedQuestion(ans.questionId);
          if (q) questions.push(q);
        }
      } else {
        const wrongList = wrongQuestionsRepo.listWrongQuestions(this.db, { mastered: false });
        for (const w of wrongList) {
          const q = this.bankLoader.getSanitizedQuestion(w.questionId);
          if (q) questions.push(q);
        }
      }
    }

    // Strict security check: ensure pre-submit questions NEVER leak answers
    assertStrictAnswerIsolation(questions);

    // Load saved drafts map
    const answerRecords = answerRepo.getAnswersForSession(this.db, sessionId);
    const answers = {};
    for (const record of answerRecords) {
      answers[record.questionId] = record.userAnswer;
    }

    return {
      session,
      questions,
      answers
    };
  }

  /**
   * Saves or updates an answer draft idempotently.
   */
  saveAnswerDraft(sessionId, { questionId, questionType, userAnswer, maxScore = 1 }) {
    questionId = this.bankLoader.resolveLegacyId?.(questionId) || questionId;
    const session = sessionRepo.getSession(this.db, sessionId);
    if (!session) {
      const err = new Error(`Session ${sessionId} not found`);
      err.code = 'SESSION_NOT_FOUND';
      throw err;
    }

    if (session.status === 'submitted') {
      const err = new Error('Cannot save answers for an already submitted exam session');
      err.code = 'SESSION_ALREADY_SUBMITTED';
      throw err;
    }

    return answerRepo.saveAnswerDraft(this.db, {
      sessionId,
      questionId,
      questionType: questionType || 'objective',
      userAnswer,
      maxScore
    });
  }

  async evaluateCaseOrDefer(params) {
    try {
      return await this.caseEvaluator.evaluateCaseQuestion(params);
    } catch (err) {
      if (err.code !== 'CASE_SCORING_UNAVAILABLE') throw err;
      return null;
    }
  }

  deferCaseScoring(answerId, isElectiveUnselected = false) {
    answerRepo.updateAnswerGrading(this.db, answerId, {
      isCorrect: null,
      score: null,
      breakdown: { status: 'pending_scoring', isElectiveUnselected }
    });
  }

  async regradeSession(sessionId) {
    const report = this.getSessionReport(sessionId);
    if (!report) {
      const err = new Error('答题记录不存在');
      err.code = 'SESSION_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }
    if (!this.inFlightRegrades) this.inFlightRegrades = new Map();
    if (this.inFlightRegrades.has(sessionId)) return this.inFlightRegrades.get(sessionId);
    if (!report.canRegrade) return report;

    const work = (async () => {
      try {
        const results = [];
        // Complete all LLM calls before writing: a failed retry preserves every saved result.
        for (const item of report.questions.filter(q => q.canRegrade)) {
          const raw = this.bankLoader.getRawQuestion(item.question.id);
          const result = await this.caseEvaluator.evaluateCaseQuestion({
            sessionId, questionId: raw.id, userAnswer: item.userAnswer,
            caseTitle: raw.case_title || raw.caseTitle || '',
            sharedStem: raw.shared_stem || raw.sharedStem || '',
            solutionAndAnalysis: raw.solution_and_analysis || '', maxPoints: 15
          });
          if (result.evaluatorType !== 'llm') {
            const err = new Error('LLM 评分不可用，原答卷与评分已保留。');
            err.code = 'CASE_SCORING_UNAVAILABLE';
            err.statusCode = 503;
            throw err;
          }
          results.push({ item, raw, result });
        }
        const session = sessionRepo.getSession(this.db, sessionId);
        if (!session) throw new Error('答题记录已删除');
        const appliedIds = new Set();
        this.db.exec('BEGIN IMMEDIATE');
        try {
          for (const { item, raw, result } of results) {
            const humanReview = this.db.prepare(`SELECT id FROM case_reviews
              WHERE session_id = ? AND question_id = ? AND human_override_points IS NOT NULL`).get(sessionId, raw.id);
            if (humanReview) continue;
            const answer = answerRepo.getAnswersForSession(this.db, sessionId).find(a => a.questionId === raw.id);
            const isPass = result.points >= 9;
            const unselected = item.isElectiveUnselected;
            answerRepo.updateAnswerGrading(this.db, answer.id, {
              isCorrect: unselected ? null : isPass,
              score: unselected ? null : result.points,
              breakdown: unselected ? { status: 'unselected', evalPoints: result.points } : result.breakdown
            });
            this.db.prepare('DELETE FROM case_reviews WHERE session_id = ? AND question_id = ?').run(sessionId, raw.id);
            caseReviewRepo.saveCaseReview(this.db, {
              ...result, answerId: answer.id, sessionId, questionId: raw.id
            });
            appliedIds.add(raw.id);
            if (!unselected) {
              if (!isPass && item.isCorrect !== false) {
                wrongQuestionsRepo.recordWrongQuestion(this.db, {
                  questionId: raw.id, paperId: raw.paper_id || raw.paperId || session.paperId || 'unknown',
                  chapter: raw.chapter || '未分类', questionType: 'case'
                });
              } else if (isPass && item.isCorrect === false) {
                // Remove only this attempt's obsolete contribution; retain other attempts.
                this.db.prepare(`DELETE FROM wrong_questions WHERE question_id = ? AND wrong_count = 1
                  AND NOT EXISTS (SELECT 1 FROM exam_answers WHERE question_id = ? AND is_correct = 0)`).run(raw.id, raw.id);
                this.db.prepare('UPDATE wrong_questions SET wrong_count = wrong_count - 1 WHERE question_id = ? AND wrong_count > 1').run(raw.id);
              }
              if (item.pendingScoring || item.score == null) {
                reviewQueueRepo.recordReviewResult(this.db, raw.id, isPass);
              }
            }
          }
          const updated = this.getSessionReport(sessionId);
          const total = updated.questions.reduce((sum, q) => sum + (q.isElectiveUnselected ? 0 : (q.score || 0)), 0);
          this.db.prepare(`UPDATE exam_sessions SET score = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`)
            .run(updated.pendingScoringCount ? null : total, sessionId);
          this.materialSyncManager?.enqueueSessionSubmission({
            sessionId, practiceMode: session.practiceMode || 'exam', triggerType: 'case_regrade', processQueue: false,
            reportQuestions: updated.questions.filter(q => appliedIds.has(q.question.id))
          });
          this.db.exec('COMMIT');
        } catch (err) {
          this.db.exec('ROLLBACK');
          throw err;
        }
        const updatedReport = this.getSessionReport(sessionId);
        this.materialSyncManager?.triggerProcessQueue?.();
        return updatedReport;
      } finally {
        this.inFlightRegrades.delete(sessionId);
      }
    })();
    this.inFlightRegrades.set(sessionId, work);
    return work;
  }

  /** Submit once; unavailable case scoring keeps the submitted answers pending. */
  async submitSession(sessionId) {
    const session = sessionRepo.getSession(this.db, sessionId);
    if (!session) {
      const err = new Error(`Session ${sessionId} not found`);
      err.code = 'SESSION_NOT_FOUND';
      throw err;
    }

    // Idempotent submit: if already submitted, return existing report
    if (session.status === 'submitted') {
      return this.getSessionReport(sessionId);
    }

    if (!this.inFlightSubmissions) {
      this.inFlightSubmissions = new Map();
    }
    if (this.inFlightSubmissions.has(sessionId)) {
      return await this.inFlightSubmissions.get(sessionId);
    }

    const submitPromise = (async () => {
      try {
        // 1. Collect all raw questions for this session
    let rawQuestions = [];
    if (session.sessionMode === 'paper' && session.paperId) {
      rawQuestions = this.bankLoader.getRawPaperQuestions(session.paperId);
    } else if (session.sessionMode === 'chapter' && session.chapter) {
      const sanitized = this.bankLoader.getQuestionsByChapter(session.chapter);
      rawQuestions = sanitized.map(q => this.bankLoader.getRawQuestion(q.id)).filter(Boolean);
    } else {
      // Wrong questions mode: collect from saved answers or wrong list
      const savedAnswers = answerRepo.getAnswersForSession(this.db, sessionId);
      if (savedAnswers.length > 0) {
        rawQuestions = savedAnswers.map(ans => this.bankLoader.getRawQuestion(ans.questionId)).filter(Boolean);
      } else {
        const wrongList = wrongQuestionsRepo.listWrongQuestions(this.db, { mastered: false });
        rawQuestions = wrongList.map(w => this.bankLoader.getRawQuestion(w.questionId)).filter(Boolean);
      }
    }

    // 2. Fetch existing user answers
    const savedAnswerRecords = answerRepo.getAnswersForSession(this.db, sessionId);
    const answerMap = new Map();
    for (const rec of savedAnswerRecords) {
      answerMap.set(rec.questionId, rec);
    }

    let totalScore = 0;
    let computedMaxScore = 0;
    let answeredMaxScore = 0;
    let correctCount = 0;
    let wrongCount = 0;
    let answeredCount = 0;
    let unansweredCount = 0;

    const isStandard6Case = (session.sessionMode === 'paper') &&
      rawQuestions.length === 6 &&
      rawQuestions.some(q => q.subject === 'case' || Boolean(q.shared_stem || q.sharedStem));

    let electiveResolution = null;
    if (isStandard6Case) {
      electiveResolution = resolveCaseElectiveSelection(rawQuestions[4], rawQuestions[5], answerMap);
    }

    for (const rawQ of rawQuestions) {
      const isCase = rawQ.subject === 'case' || Boolean(rawQ.shared_stem || rawQ.sharedStem);
      const answerRecord = answerMap.get(rawQ.id);
      const userAnswer = answerRecord ? answerRecord.userAnswer : null;
      
      const hasAnswered = isCase
        ? isAnswerObjectPopulated(userAnswer)
        : (userAnswer !== null && userAnswer !== undefined && String(userAnswer).trim().length > 0);

      const isUnselectedElective = Boolean(isStandard6Case && electiveResolution && rawQ.id === electiveResolution.unselectedId);

      if (!isUnselectedElective) {
        if (hasAnswered) {
          answeredCount++;
        } else {
          unansweredCount++;
        }
      }

      if (!isCase) {
        // Objective deterministic grading
        const pointWeight = 1;
        computedMaxScore += pointWeight;

        let currentRecordId = answerRecord ? answerRecord.id : null;
        if (!currentRecordId) {
          const draft = answerRepo.saveAnswerDraft(this.db, {
            sessionId,
            questionId: rawQ.id,
            questionType: 'objective',
            userAnswer: '',
            maxScore: pointWeight
          });
          currentRecordId = draft.id;
        }

        if (hasAnswered) {
          answeredMaxScore += pointWeight;
          const effectiveAnswer = (rawQ.answers && rawQ.answers.effective_answer) || '';
          const graded = gradeObjectiveQuestion(rawQ.id, userAnswer, effectiveAnswer, pointWeight);

          if (graded.isCorrect === true) {
            correctCount++;
            totalScore += graded.score;
          } else {
            wrongCount++;
            // Record in wrong questions if candidate attempted and answered wrong
            wrongQuestionsRepo.recordWrongQuestion(this.db, {
              questionId: rawQ.id,
              paperId: rawQ.paper_id || rawQ.paperId || (session.paperId || 'unknown'),
              chapter: rawQ.chapter || '未分类',
              questionType: 'objective'
            });
          }

          answerRepo.updateAnswerGrading(this.db, currentRecordId, {
            isCorrect: graded.isCorrect,
            score: graded.score,
            breakdown: graded
          });

          // Update SM-2 review queue if candidate attempted question
          reviewQueueRepo.recordReviewResult(this.db, rawQ.id, graded.isCorrect);
        } else {
          // AC-A3: 未作答独立为 unanswered/skipped，正确性与得分为 null，不计 wrongCount/已答准确率/个人薄弱点/错题队列
          answerRepo.updateAnswerGrading(this.db, currentRecordId, {
            isCorrect: null,
            score: null,
            breakdown: { status: 'unanswered' }
          });
        }

      } else {
        // Case question evaluation via pluggable evaluator
        const maxPoints = 15;
        if (!isUnselectedElective) {
          computedMaxScore += maxPoints;
        }

        let currentRecordId = answerRecord ? answerRecord.id : null;
        if (!currentRecordId) {
          const draft = answerRepo.saveAnswerDraft(this.db, {
            sessionId,
            questionId: rawQ.id,
            questionType: 'case',
            userAnswer: userAnswer || '',
            maxScore: maxPoints
          });
          currentRecordId = draft.id;
        }

        if (isUnselectedElective) {
          // Unselected elective question: do NOT add points to totalScore, do NOT count in wrongCount or queue
          if (hasAnswered) {
            const evalResult = await this.evaluateCaseOrDefer({
              sessionId,
              questionId: rawQ.id,
              userAnswer,
              caseTitle: rawQ.case_title || rawQ.caseTitle || '',
              sharedStem: rawQ.shared_stem || rawQ.sharedStem || '',
              solutionAndAnalysis: rawQ.solution_and_analysis || '',
              maxPoints
            });
            if (!evalResult) {
              this.deferCaseScoring(currentRecordId, true);
              continue;
            }

            answerRepo.updateAnswerGrading(this.db, currentRecordId, {
              isCorrect: null,
              score: null,
              breakdown: {
                ...evalResult.breakdown,
                status: 'unselected',
                isElective: true,
                isSelected: false,
                evalPoints: evalResult.points
              }
            });

            caseReviewRepo.saveCaseReview(this.db, {
              answerId: currentRecordId,
              sessionId,
              questionId: rawQ.id,
              evaluatorType: evalResult.evaluatorType,
              points: evalResult.points,
              maxPoints,
              feedback: (evalResult.feedback || '') + '（注：此题为二选一选做题中未计分题目，仅供对照复习，不计入试卷总分及错题本）',
              breakdown: evalResult.breakdown,
              needsHumanReview: false
            });
          } else {
            answerRepo.updateAnswerGrading(this.db, currentRecordId, {
              isCorrect: null,
              score: null,
              breakdown: { status: 'unselected', isElective: true, isSelected: false }
            });

            caseReviewRepo.saveCaseReview(this.db, {
              answerId: currentRecordId,
              sessionId,
              questionId: rawQ.id,
              evaluatorType: 'rule',
              points: 0,
              maxPoints,
              feedback: '选做未选题（不计入总分与错题）。',
              breakdown: [],
              needsHumanReview: false
            });
          }
        } else if (hasAnswered) {
          answeredMaxScore += maxPoints;
          const evalResult = await this.evaluateCaseOrDefer({
            sessionId,
            questionId: rawQ.id,
            userAnswer,
            caseTitle: rawQ.case_title || rawQ.caseTitle || '',
            sharedStem: rawQ.shared_stem || rawQ.sharedStem || '',
            solutionAndAnalysis: rawQ.solution_and_analysis || '',
            maxPoints
          });
          if (!evalResult) {
            this.deferCaseScoring(currentRecordId);
            continue;
          }

          totalScore += evalResult.points;
          const isPass = evalResult.points >= Math.round(maxPoints * 0.6);
          if (isPass) {
            correctCount++;
          } else {
            wrongCount++;
            wrongQuestionsRepo.recordWrongQuestion(this.db, {
              questionId: rawQ.id,
              paperId: rawQ.paper_id || rawQ.paperId || (session.paperId || 'unknown'),
              chapter: rawQ.chapter || '未分类',
              questionType: 'case'
            });
          }

          answerRepo.updateAnswerGrading(this.db, currentRecordId, {
            isCorrect: isPass,
            score: evalResult.points,
            breakdown: evalResult.breakdown
          });

          caseReviewRepo.saveCaseReview(this.db, {
            answerId: currentRecordId,
            sessionId,
            questionId: rawQ.id,
            evaluatorType: evalResult.evaluatorType,
            points: evalResult.points,
            maxPoints,
            feedback: evalResult.feedback,
            breakdown: evalResult.breakdown,
            needsHumanReview: evalResult.needsHumanReview
          });

          reviewQueueRepo.recordReviewResult(this.db, rawQ.id, isPass);
        } else {
          // AC-A3: 案例全为空或全空白的对象视为未作答；正确性与得分为 null，不计 wrongCount/已答准确率/个人薄弱点/错题队列，不调用案例评分 LLM
          answerRepo.updateAnswerGrading(this.db, currentRecordId, {
            isCorrect: null,
            score: null,
            breakdown: { status: 'unanswered' }
          });

          caseReviewRepo.saveCaseReview(this.db, {
            answerId: currentRecordId,
            sessionId,
            questionId: rawQ.id,
            evaluatorType: 'rule',
            points: 0,
            maxPoints,
            feedback: '未作答（不调用大模型评分，不计入错题与扣分）。',
            breakdown: [],
            needsHumanReview: false
          });
        }
      }
    }

    // 3. Finalize session submission
    sessionRepo.updateSessionSubmission(this.db, sessionId, {
      score: answerRepo.getAnswersForSession(this.db, sessionId).some(a =>
        a.scoreBreakdown?.status === 'pending_scoring' && !a.scoreBreakdown?.isElectiveUnselected
      ) ? null : totalScore,
      maxScore: computedMaxScore,
      answeredCount,
      status: 'submitted'
    });

    const report = this.getSessionReport(sessionId);

    // AC-B2 & AC-B3: Non-blocking asynchronous personal material maintenance
    if (this.materialSyncManager) {
      try {
        this.materialSyncManager.enqueueSessionSubmission({
          sessionId,
          practiceMode: session.practiceMode || 'exam',
          reportQuestions: report.questions
        });
      } catch (syncErr) {
        console.warn('[ExamService] Background material sync enqueue failed:', syncErr.message);
      }
    }

        return report;
      } finally {
        this.inFlightSubmissions.delete(sessionId);
      }
    })();

    this.inFlightSubmissions.set(sessionId, submitPromise);
    return await submitPromise;
  }

  /**
   * Retrieves full report of a submitted session, including explanations,
   * solution code blocks/images, and material anchors.
   */
  getSessionReport(sessionId) {
    const session = sessionRepo.getSession(this.db, sessionId);
    if (!session) return null;

    if (session.status !== 'submitted') {
      const err = new Error('Session has not been submitted yet');
      err.code = 'SESSION_NOT_SUBMITTED';
      throw err;
    }

    // Load answers
    const answerRecords = answerRepo.getAnswersForSession(this.db, sessionId);
    const answerMap = new Map();
    for (const rec of answerRecords) {
      answerMap.set(rec.questionId, rec);
    }

    // Load raw questions
    let rawQuestions = [];
    if (session.sessionMode === 'paper' && session.paperId) {
      rawQuestions = this.bankLoader.getRawPaperQuestions(session.paperId);
    } else if (session.sessionMode === 'chapter' && session.chapter) {
      const sanitized = this.bankLoader.getQuestionsByChapter(session.chapter);
      rawQuestions = sanitized.map(q => this.bankLoader.getRawQuestion(q.id)).filter(Boolean);
    } else {
      for (const rec of answerRecords) {
        const raw = this.bankLoader.getRawQuestion(rec.questionId);
        if (raw) rawQuestions.push(raw);
      }
    }

    let correctCount = 0;
    let wrongCount = 0;
    let unansweredCount = 0;
    let pendingScoringCount = 0;
    let regradableCount = 0;
    let answeredMaxScore = 0;
    const reportQuestions = [];

    const isStandard6Case = (session.sessionMode === 'paper') &&
      rawQuestions.length === 6 &&
      rawQuestions.some(q => q.subject === 'case' || Boolean(q.shared_stem || q.sharedStem));

    let electiveResolution = null;
    if (isStandard6Case) {
      electiveResolution = resolveCaseElectiveSelection(rawQuestions[4], rawQuestions[5], answerMap);
    }

    for (const rawQ of rawQuestions) {
      const ansRec = answerMap.get(rawQ.id);
      const isCase = rawQ.subject === 'case' || Boolean(rawQ.shared_stem || rawQ.sharedStem);
      const sanitized = this.bankLoader.getSanitizedQuestion(rawQ.id);

      const isUnselectedElective = Boolean(isStandard6Case && electiveResolution && rawQ.id === electiveResolution.unselectedId);

      const isCorrect = isUnselectedElective ? null : (ansRec ? ansRec.isCorrect : null);
      const score = isUnselectedElective ? null : (ansRec ? ansRec.score : null);
      const maxScore = isCase ? 15 : 1;
      const pendingScoring = isCase && ansRec?.scoreBreakdown?.status === 'pending_scoring';

      if (!isUnselectedElective) {
        if (isCorrect === true) {
          correctCount++;
          answeredMaxScore += maxScore;
        } else if (isCorrect === false) {
          wrongCount++;
          answeredMaxScore += maxScore;
        } else if (pendingScoring) {
          pendingScoringCount++;
          answeredMaxScore += maxScore;
        } else {
          unansweredCount++;
        }
      }

      // Extract solution assets (permitted in post-submit report)
      const solutionCodeBlocks = Array.isArray(rawQ.code_blocks)
        ? rawQ.code_blocks.filter(cb => cb.type === 'solution').map(cb => ({
            type: 'solution',
            code: cb.code,
            language: cb.language
          }))
        : [];

      const solutionImages = Array.isArray(rawQ.images)
        ? rawQ.images.filter(img => img.type === 'solution').map(img => ({
            type: 'solution',
            localPath: img.local_path || img.localPath,
            sha256: img.sha256,
            sourceUrl: img.source_url || img.sourceUrl
          }))
        : [];

      // Case review info if applicable
      let caseReview = undefined;
      if (isCase) {
        // Find in case_reviews
        const stmt = this.db.prepare(`
          SELECT * FROM case_reviews WHERE session_id = ? AND question_id = ?
        `);
        const row = stmt.get(sessionId, rawQ.id);
        if (row) {
          let bd = [];
          if (row.breakdown_json) {
            try { bd = JSON.parse(row.breakdown_json); } catch {}
          }
          caseReview = {
            questionId: rawQ.id,
            evaluatorType: row.evaluator_type,
            points: row.points,
            maxPoints: row.max_points,
            feedback: row.feedback,
            breakdown: bd,
            needsHumanReview: Boolean(row.needs_human_review),
            humanOverridePoints: row.human_override_points,
            humanNotes: row.human_notes
          };
        }
      }

      let status;
      if (isUnselectedElective) {
        status = 'unselected';
      } else if (pendingScoring) {
        status = 'pending_scoring';
      } else if (isCorrect === true) {
        status = 'correct';
      } else if (isCorrect === false) {
        status = 'wrong';
      } else if (isCase && ansRec && ansRec.userAnswer) {
        status = 'case';
      } else {
        status = 'unanswered';
      }

      const canRegrade = isCase && isAnswerObjectPopulated(ansRec?.userAnswer) &&
        caseReview?.humanOverridePoints == null &&
        (pendingScoring || !caseReview || caseReview.evaluatorType === 'rule');
      if (canRegrade) regradableCount++;
      reportQuestions.push({
        question: sanitized,
        userAnswer: ansRec ? ansRec.userAnswer : null,
        effectiveAnswer: isCase ? undefined : (rawQ.answers ? rawQ.answers.effective_answer : ''),
        isCorrect,
        score,
        maxScore,
        status,
        pendingScoring,
        canRegrade,
        scoringMessage: pendingScoring ? 'LLM 暂不可用，未进行评分。答案已保留，可稍后重新评分。' : undefined,
        isElective: isStandard6Case && (rawQ.id === rawQuestions[4].id || rawQ.id === rawQuestions[5].id),
        isSelected: isStandard6Case ? (rawQ.id === electiveResolution?.selectedId) : undefined,
        isElectiveUnselected: isUnselectedElective,
        analysis: isCase ? projectCleanAnalysis(rawQ.solution_and_analysis || '') : projectCleanAnalysis(rawQ.analysis || ''),
        solutionCodeBlocks,
        solutionImages,
        caseReview,
        materialAnchor: resolveMaterialAnchor(rawQ)
      });
    }

    const totalQuestions = rawQuestions.length;
    const answeredCount = correctCount + wrongCount + pendingScoringCount;

    let effectiveMaxScore = session.maxScore || totalQuestions;
    let effectiveScore = session.score || 0;
    if (isStandard6Case) {
      effectiveMaxScore = 75;
      effectiveScore = 0;
      for (const rq of reportQuestions) {
        if (!rq.isElectiveUnselected && typeof rq.score === 'number') {
          effectiveScore += rq.score;
        }
      }
    }

    let accuracy = 0;
    if (isStandard6Case) {
      // 案例题按有效满分75分计算得分率，0..100%
      accuracy = effectiveMaxScore > 0 ? Math.min(1, Math.max(0, Math.round((effectiveScore / effectiveMaxScore) * 1000) / 1000)) : 0;
    } else {
      accuracy = answeredCount > 0 ? Math.round((correctCount / answeredCount) * 1000) / 1000 : 0;
    }

    return {
      sessionId: session.id,
      sessionMode: session.sessionMode,
      practiceMode: session.practiceMode || 'exam',
      answersRevealed: Boolean(session.answersRevealed),
      assistanceUsed: Boolean(session.assistanceUsed),
      paperId: session.paperId,
      chapter: session.chapter,
      title: session.title,
      status: session.status,
      score: pendingScoringCount > 0 ? null : effectiveScore,
      maxScore: effectiveMaxScore,
      accuracy: pendingScoringCount > 0 ? null : accuracy,
      totalQuestions,
      answeredCount,
      unansweredCount,
      answeredMaxScore: isStandard6Case ? Math.min(75, answeredMaxScore) : answeredMaxScore,
      correctCount,
      wrongCount,
      pendingScoringCount,
      canRegrade: regradableCount > 0,
      submittedAt: session.submittedAt || new Date().toISOString(),
      questions: reportQuestions
    };
  }

  /**
   * Overrides case question review with human teacher adjustments.
   */
  overrideCaseReview(sessionId, questionId, { points, notes = '' }) {
    if (typeof points !== 'number' || !Number.isFinite(points)) {
      const err = new Error('Points must be a valid finite number');
      err.code = 'INVALID_POINTS';
      err.statusCode = 400;
      throw err;
    }

    const session = sessionRepo.getSession(this.db, sessionId);
    if (!session) {
      const err = new Error(`Session ${sessionId} not found`);
      err.code = 'SESSION_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    const stmt = this.db.prepare(`
      SELECT id, answer_id, session_id, question_id, max_points, points AS original_points FROM case_reviews WHERE session_id = ? AND question_id = ?
    `);
    const existing = stmt.get(sessionId, questionId);
    if (!existing) {
      const err = new Error(`Case review record not found for session ${sessionId} and question ${questionId}`);
      err.code = 'CASE_REVIEW_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    const maxPoints = existing.max_points || 15;
    if (points < 0 || points > maxPoints) {
      const err = new Error(`Points must be between 0 and ${maxPoints}, got: ${points}`);
      err.code = 'POINTS_OUT_OF_BOUNDS';
      err.statusCode = 400;
      throw err;
    }

    const cleanNotes = typeof notes === 'string' ? notes.trim() : '';
    const updated = caseReviewRepo.setHumanOverride(this.db, existing.id, points, cleanNotes);

    const isPass = points >= Math.round(maxPoints * 0.6);

    // Synchronize to exam_answers
    answerRepo.updateAnswerGrading(this.db, existing.answer_id, {
      isCorrect: isPass,
      score: points,
      breakdown: updated.breakdown
    });

    // Recalculate session total score respecting elective policy
    let newTotal = 0;
    if (session.sessionMode === 'paper' && session.paperId) {
      const rawQs = this.bankLoader.getRawPaperQuestions(session.paperId);
      if (rawQs.length === 6 && rawQs.some(q => q.subject === 'case' || Boolean(q.shared_stem || q.sharedStem))) {
        const answerRecords = answerRepo.getAnswersForSession(this.db, sessionId);
        const ansMap = new Map(answerRecords.map(a => [a.questionId, a]));
        const elective = resolveCaseElectiveSelection(rawQs[4], rawQs[5], ansMap);
        for (const rq of rawQs) {
          if (rq.id !== elective.unselectedId) {
            const a = ansMap.get(rq.id);
            if (a && typeof a.score === 'number') newTotal += a.score;
          }
        }
      } else {
        const sumStmt = this.db.prepare(`
          SELECT SUM(score) AS totalScore FROM exam_answers WHERE session_id = ?
        `);
        const sumRow = sumStmt.get(sessionId);
        newTotal = sumRow ? sumRow.totalScore : 0;
      }
    } else {
      const sumStmt = this.db.prepare(`
        SELECT SUM(score) AS totalScore FROM exam_answers WHERE session_id = ?
      `);
      const sumRow = sumStmt.get(sessionId);
      newTotal = sumRow ? sumRow.totalScore : 0;
    }

    this.db.prepare(`
      UPDATE exam_sessions SET score = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?
    `).run(newTotal, sessionId);

    // Synchronize wrong questions & review queue state
    const rawQ = this.bankLoader.getRawQuestion(questionId);
    if (isPass) {
      wrongQuestionsRepo.removeWrongQuestion(this.db, questionId);
      reviewQueueRepo.recordReviewResult(this.db, questionId, true);
    } else {
      wrongQuestionsRepo.recordWrongQuestion(this.db, {
        questionId,
        paperId: (rawQ && (rawQ.paper_id || rawQ.paperId)) || (session && session.paperId) || 'unknown',
        chapter: (rawQ && rawQ.chapter) || '未分类',
        questionType: 'case'
      });
      reviewQueueRepo.recordReviewResult(this.db, questionId, false);
    }

    // AC-B3: Trigger personal material update upon teacher case review override
    if (this.materialSyncManager) {
      try {
        this.materialSyncManager.enqueueCaseOverride({
          sessionId,
          question: rawQ || { id: questionId },
          points,
          notes: cleanNotes
        });
      } catch (syncErr) {
        console.warn('[ExamService] Background case override material sync enqueue failed:', syncErr.message);
      }
    }

    return updated;
  }

  /**
   * Lists wrong questions notebook.
   */
  listWrongQuestions(query) {
    return wrongQuestionsRepo.listWrongQuestions(this.db, query);
  }

  /**
   * Toggles wrong question mastered state.
   */
  toggleWrongQuestionMastered(questionId, mastered) {
    return wrongQuestionsRepo.setMastered(this.db, questionId, mastered);
  }

  /**
   * Retrieves items from the spaced repetition review queue.
   */
  getReviewQueue(limit = 20) {
    return reviewQueueRepo.listReviewQueue(this.db, { limit });
  }

  /**
   * Checks a single question's solution/grading in practice or memorize mode.
   * STRICT ANSWER ISOLATION: Rejected with 403 in exam mode before submission.
   */
  async checkQuestion(sessionId, questionId, userAnswer) {
    const session = sessionRepo.getSession(this.db, sessionId);
    if (!session) {
      const err = new Error(`Session ${sessionId} not found`);
      err.code = 'SESSION_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    // AC-A2: 考试模式交卷前服务端不泄露答案/解析
    if (session.practiceMode === 'exam' && session.status !== 'submitted') {
      const err = new Error('考试模式交卷前严禁获取答案或解析，请先切换至练习或记忆模式');
      err.code = 'EXAM_MODE_ISOLATION';
      err.statusCode = 403;
      throw err;
    }

    // Mark answers revealed on session (sticky flag)
    sessionRepo.updateSessionState(this.db, sessionId, { answersRevealed: true });

    const rawQ = this.bankLoader.getRawQuestion(questionId);
    if (!rawQ) {
      const err = new Error(`Question ${questionId} not found`);
      err.code = 'QUESTION_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    const isCase = rawQ.subject === 'case' || Boolean(rawQ.shared_stem || rawQ.sharedStem);

    const solutionCodeBlocks = Array.isArray(rawQ.code_blocks)
      ? rawQ.code_blocks.filter(cb => cb.type === 'solution').map(cb => ({
          type: 'solution',
          code: cb.code,
          language: cb.language
        }))
      : [];

    const solutionImages = Array.isArray(rawQ.images)
      ? rawQ.images.filter(img => img.type === 'solution').map(img => ({
          type: 'solution',
          localPath: img.local_path || img.localPath,
          sha256: img.sha256,
          sourceUrl: img.source_url || img.sourceUrl
        }))
      : [];

    if (!isCase) {
      const effectiveAnswer = (rawQ.answers && rawQ.answers.effective_answer) || '';
      const graded = gradeObjectiveQuestion(questionId, userAnswer, effectiveAnswer, 1);
      return {
        questionId,
        isCorrect: graded.isCorrect,
        score: graded.score,
        status: graded.status,
        effectiveAnswer,
        analysis: projectCleanAnalysis(rawQ.analysis || ''),
        solutionCodeBlocks,
        solutionImages
      };
    } else {
      const maxPoints = 15;
      let caseReview = null;
      const hasPopulated = isAnswerObjectPopulated(userAnswer);
      if (hasPopulated) {
        caseReview = await this.caseEvaluator.evaluateCaseQuestion({
          sessionId,
          questionId,
          userAnswer,
          caseTitle: rawQ.case_title || rawQ.caseTitle || '',
          sharedStem: rawQ.shared_stem || rawQ.sharedStem || '',
          solutionAndAnalysis: rawQ.solution_and_analysis || '',
          maxPoints
        });
      }
      return {
        questionId,
        isCorrect: caseReview ? (caseReview.points >= Math.round(maxPoints * 0.6)) : null,
        score: caseReview ? caseReview.points : null,
        solutionAndAnalysis: projectCleanAnalysis(rawQ.solution_and_analysis || ''),
        solutionCodeBlocks,
        solutionImages,
        caseReview
      };
    }
  }

  /**
   * Retrieves all reference solutions for a session.
   * Strictly forbidden in exam mode before submission.
   */
  getSessionSolutions(sessionId) {
    const session = sessionRepo.getSession(this.db, sessionId);
    if (!session) {
      const err = new Error(`Session ${sessionId} not found`);
      err.code = 'SESSION_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    if (session.practiceMode === 'exam' && session.status !== 'submitted') {
      const err = new Error('考试模式交卷前严禁获取答案或解析');
      err.code = 'EXAM_MODE_ISOLATION';
      err.statusCode = 403;
      throw err;
    }

    sessionRepo.updateSessionState(this.db, sessionId, { answersRevealed: true });

    let rawQuestions = [];
    if (session.sessionMode === 'paper' && session.paperId) {
      rawQuestions = this.bankLoader.getRawPaperQuestions(session.paperId);
    } else if (session.sessionMode === 'chapter' && session.chapter) {
      const sanitized = this.bankLoader.getQuestionsByChapter(session.chapter);
      rawQuestions = sanitized.map(q => this.bankLoader.getRawQuestion(q.id)).filter(Boolean);
    } else {
      const savedAnswers = answerRepo.getAnswersForSession(this.db, sessionId);
      rawQuestions = savedAnswers.map(ans => this.bankLoader.getRawQuestion(ans.questionId)).filter(Boolean);
    }

    const solutions = {};
    for (const rawQ of rawQuestions) {
      const isCase = rawQ.subject === 'case' || Boolean(rawQ.shared_stem || rawQ.sharedStem);
      const solutionCodeBlocks = Array.isArray(rawQ.code_blocks)
        ? rawQ.code_blocks.filter(cb => cb.type === 'solution').map(cb => ({
            type: 'solution',
            code: cb.code,
            language: cb.language
          }))
        : [];

      const solutionImages = Array.isArray(rawQ.images)
        ? rawQ.images.filter(img => img.type === 'solution').map(img => ({
            type: 'solution',
            localPath: img.local_path || img.localPath,
            sha256: img.sha256,
            sourceUrl: img.source_url || img.sourceUrl
          }))
        : [];

      solutions[rawQ.id] = {
        questionId: rawQ.id,
        effectiveAnswer: isCase ? undefined : (rawQ.answers ? rawQ.answers.effective_answer : ''),
        analysis: isCase ? undefined : projectCleanAnalysis(rawQ.analysis || ''),
        solutionAndAnalysis: isCase ? projectCleanAnalysis(rawQ.solution_and_analysis || '') : undefined,
        solutionCodeBlocks,
        solutionImages
      };
    }
    return solutions;
  }

  /**
   * Lists all 21 standard chapters and personal review materials status (AC-B1).
   */
  /**
   * Lists all 21 standard chapters and personal review materials status (AC-B1).
   */
  listPersonalMaterials() {
    return this.materialSyncManager ? this.materialSyncManager.getAllChaptersMaterialList() : [];
  }

  /**
   * Retrieves full personal material detail for a specific chapter (AC-B1..B4).
   */
  getPersonalMaterial(chapterKey) {
    return this.materialSyncManager ? this.materialSyncManager.getChapterMaterialDetail(chapterKey) : null;
  }

  /**
   * Retries a failed personal material background sync (AC-B3).
   */
  retryPersonalMaterialSync(chapterKey) {
    if (!this.materialSyncManager) {
      throw new Error('Material sync manager is not available');
    }
    return this.materialSyncManager.retryChapterSync(chapterKey);
  }

  /**
   * Lists static review materials catalog (13 objective chapters + 8 case topics) (AC-1).
   */
  listStaticMaterials() {
    return {
      objective: STATIC_OBJECTIVE_CHAPTERS,
      case: STATIC_CASE_TOPICS,
      totalCount: STATIC_OBJECTIVE_CHAPTERS.length + STATIC_CASE_TOPICS.length
    };
  }

  /**
   * Retrieves raw static review material content directly from Markdown files (AC-1).
   * Unprocessed by LLM, does not modify original files.
   * @param {object} params
   * @param {string} params.doc
   * @param {'objective' | 'case'} [params.subject]
   */
  getStaticMaterial({ doc, subject } = {}) {
    if (!doc) {
      const err = new Error('doc query parameter is required');
      err.code = 'MISSING_PARAM';
      err.statusCode = 400;
      throw err;
    }

    const baseDir = getMaterialsBaseDir();
    const rawDoc = decodeURIComponent(doc).trim();
    const normalizedRaw = rawDoc.replace(/\\/g, '/');
    const strippedDoc = normalizedRaw.replace(/^\/+/, '').replace(/^软件设计师复习材料\//i, '');
    const baseName = path.basename(strippedDoc);

    const ALIAS_MAP = {
      '01_计算机系统与体系结构.md': '选择题/01-计算机系统知识.md',
      '02_程序设计语言基础.md': '选择题/02-程序设计语言基础知识.md',
      '03_数据结构与算法.md': '选择题/03-数据结构.md',
      '04_操作系统.md': '选择题/04-操作系统知识.md',
      '05_软件工程与系统开发.md': '选择题/05-软件工程基础知识.md',
      '06_面向对象技术.md': '选择题/07-面向对象技术.md',
      '07_数据库系统.md': '选择题/09-数据库技术基础.md',
      '08_网络与信息安全.md': '选择题/10-网络与信息安全基础知识.md',
      '09_知识产权与标准化.md': '选择题/11-标准化和软件知识产权基础知识.md',
      '10_多媒体技术.md': '软件设计师复习材料-选择题.md',
      '11_项目管理与专业英语.md': '选择题/13-英语.md',
      '案例_专题1_数据流图DFD.md': '案例题/01-结构化分析与设计.md',
      '案例_专题2_数据库分析与设计.md': '案例题/04-数据库设计与关系模式.md',
      '案例_专题3_UML建模.md': '案例题/03-UML类图与面向对象分析.md',
      '案例_专题4_算法设计与分析.md': '案例题/08-算法设计与分析.md',
      '案例_专题5_设计模式与面向对象编程.md': '案例题/02-面向对象设计模式与Java实现.md'
    };

    let targetDoc = ALIAS_MAP[strippedDoc] || ALIAS_MAP[baseName] || ALIAS_MAP[normalizedRaw] || strippedDoc;

    const candidates = [
      path.join(baseDir, targetDoc),
      path.join(baseDir, strippedDoc)
    ];

    const isCase = subject === 'case' || strippedDoc.includes('案例') || targetDoc.includes('案例');
    const isObjective = subject === 'objective' || strippedDoc.includes('选择') || targetDoc.includes('选择');

    if (isCase) {
      candidates.push(path.join(baseDir, '案例题', path.basename(targetDoc)));
      candidates.push(path.join(baseDir, '案例题', path.basename(strippedDoc)));
      candidates.push(path.join(baseDir, '案例题', targetDoc));
      candidates.push(path.join(baseDir, '案例题', strippedDoc));
      candidates.push(path.join(baseDir, '软件设计师复习材料-案例题.md'));
    } else if (isObjective) {
      candidates.push(path.join(baseDir, '选择题', path.basename(targetDoc)));
      candidates.push(path.join(baseDir, '选择题', path.basename(strippedDoc)));
      candidates.push(path.join(baseDir, '选择题', targetDoc));
      candidates.push(path.join(baseDir, '选择题', strippedDoc));
      candidates.push(path.join(baseDir, '软件设计师复习材料-选择题.md'));
    } else {
      candidates.push(path.join(baseDir, '案例题', path.basename(targetDoc)));
      candidates.push(path.join(baseDir, '选择题', path.basename(targetDoc)));
      candidates.push(path.join(baseDir, '案例题', path.basename(strippedDoc)));
      candidates.push(path.join(baseDir, '选择题', path.basename(strippedDoc)));
    }

    let targetPath = null;
    for (const cand of candidates) {
      try {
        const resolved = path.resolve(cand);
        if (!resolved.startsWith(baseDir + path.sep) && resolved !== baseDir) {
          continue;
        }
        if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
          targetPath = resolved;
          break;
        }
      } catch (e) {
        // Continue searching
      }
    }

    if (!targetPath) {
      const err = new Error(`Material document ${rawDoc} not found or inaccessible`);
      err.code = 'MATERIAL_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    try {
      const markdown = fs.readFileSync(targetPath, 'utf8');
      return {
        doc: rawDoc,
        resolvedPath: path.relative(baseDir, targetPath).replace(/\\/g, '/'),
        markdown
      };
    } catch (readErr) {
      const err = new Error(`Failed to read material document ${rawDoc}: ${readErr.message}`);
      err.code = 'MATERIAL_READ_ERROR';
      err.statusCode = 500;
      throw err;
    }
  }

  /**
   * Retrieves the 2 aggregated dynamic review materials (objective and case) (AC-2).
   */
  getDynamicMaterials() {
    if (!this.materialSyncManager) return [];
    return [
      this.materialSyncManager.getDynamicMaterialsSummary('objective'),
      this.materialSyncManager.getDynamicMaterialsSummary('case')
    ];
  }

  /**
   * Retrieves single aggregated dynamic review material by subject (AC-2).
   * @param {'objective' | 'case'} subject
   */
  getDynamicMaterial(subject) {
    if (!this.materialSyncManager) return null;
    return this.materialSyncManager.getDynamicMaterialsSummary(subject);
  }

  /**
   * Retries dynamic material generation for a subject (AC-2).
   * @param {'objective' | 'case'} subject
   */
  retryDynamicMaterial(subject) {
    if (!this.materialSyncManager) {
      throw new Error('Material sync manager is not available');
    }
    return this.materialSyncManager.retrySubjectSync(subject);
  }

  /**
   * Exits strict exam mode, switching permanently to assisted practice mode (AC-Q2).
   * Persists practiceMode='practice', answersRevealed=true, and assistanceUsed=true to SQLite.
   * 
   * @param {string} sessionId 
   * @returns {import('@ruankao/exam-contracts').ExamSession}
   */
  exitExamMode(sessionId) {
    const session = sessionRepo.getSession(this.db, sessionId);
    if (!session) {
      const err = new Error(`Session ${sessionId} not found`);
      err.code = 'SESSION_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    return sessionRepo.updateSessionState(this.db, sessionId, {
      practiceMode: 'practice',
      answersRevealed: true,
      assistanceUsed: true
    });
  }

  /**
   * Executes AI chat assistant query with strict session qualification (AC-Q1..Q5).
   * 
   * @param {object} params
   * @param {import('@ruankao/exam-contracts').ExamChatContext} params.context
   * @param {string} params.userMessage
   * @param {Array<import('@ruankao/exam-contracts').ExamChatMessage>} [params.history]
   * @param {AbortSignal} [params.signal]
   * @returns {Promise<import('@ruankao/exam-contracts').ExamChatResponse>}
   */
  async chat({ context, userMessage, history = [], signal = null }) {
    if (!context || typeof context !== 'object') {
      const err = new Error('Context is required');
      err.statusCode = 400;
      err.code = 'INVALID_CONTEXT';
      throw err;
    }

    // AC-Q2: Server-side qualification check based on SQLite persisted state
    const sessionId = context.sessionId;
    let associatedSession = null;
    if (sessionId) {
      associatedSession = sessionRepo.getSession(this.db, sessionId);
      if (!associatedSession) {
        const err = new Error(`Session ${sessionId} not found`);
        err.statusCode = 404;
        err.code = 'SESSION_NOT_FOUND';
        throw err;
      }

      // If active session is in strict exam mode and unsubmitted -> STRICTLY FORBIDDEN!
      if (associatedSession.practiceMode === 'exam' && associatedSession.status !== 'submitted') {
        const err = new Error('严格考试模式下已禁用AI助教问答。请确认退出严格模考并切换至辅助练习模式。');
        err.statusCode = 403;
        err.code = 'EXAM_MODE_CHAT_DISABLED';
        err.details = {
          sessionId,
          practiceMode: 'exam',
          message: '可在前端界面确认退出严格模考以启用AI助教'
        };
        throw err;
      }
    }

    // If context is a question, also protect against bypassing by omitting sessionId
    if (context.type === 'question' && context.targetId && !sessionId) {
      const inProgressSessions = sessionRepo.listSessions(this.db, { status: 'in_progress', limit: 10 });
      for (const s of inProgressSessions) {
        if (s.practiceMode === 'exam') {
          if (s.paperId) {
            const paperQIds = this.bankLoader.getSanitizedPaperQuestions(s.paperId).map(q => q.id);
            if (paperQIds.includes(context.targetId)) {
              const err = new Error('检测到当前试题处于活跃的严格模考中，已禁用AI助教问答。');
              err.statusCode = 403;
              err.code = 'EXAM_MODE_CHAT_DISABLED';
              err.details = { sessionId: s.id, practiceMode: 'exam' };
              throw err;
            }
          }
        }
      }
    }

    if (!this.chatService) {
      const err = new Error('Chat service is not initialized or unavailable');
      err.statusCode = 503;
      err.code = 'CHAT_SERVICE_UNAVAILABLE';
      throw err;
    }

    // Qualification passed:
    // If session is associated and unsubmitted, mark assistanceUsed and answersRevealed
    if (associatedSession && associatedSession.status !== 'submitted') {
      sessionRepo.updateSessionState(this.db, sessionId, {
        answersRevealed: true,
        assistanceUsed: true
      });
    }

    const chatResponse = await this.chatService.chat({
      context,
      userMessage,
      history,
      signal,
      timeoutMs: this.chatTimeoutMs
    });

    return {
      ...chatResponse,
      assistanceUsed: Boolean(associatedSession)
    };
  }

  /**
   * Initializes LLM options from persistent database settings if present.
   */
  initLlmFromSettings() {
    if (!this.db) return;
    try {
      // Auto-migrate legacy unencrypted llm_config in SQLite to encrypted storage
      try {
        const rawRow = this.db.prepare('SELECT value FROM app_settings WHERE key = ?').get('llm_config');
        if (rawRow && typeof rawRow.value === 'string' && !rawRow.value.startsWith('enc:v1:')) {
          const parsed = JSON.parse(rawRow.value);
          if (parsed && typeof parsed === 'object') {
            settingsRepo.setSetting(this.db, 'llm_config', parsed);
          }
        }
      } catch {}

      const saved = settingsRepo.getSetting(this.db, 'llm_config');
      if (saved && typeof saved === 'object') {
        this.applyLlmConfig(saved);
      }
    } catch {
      // ignore
    }
  }

  /**
   * Hot-reloads runtime configurations across all dependent LLM services.
   * @param {object} config
   */
  applyLlmConfig({ endpoint, apiKey, model, timeoutMs } = {}) {
    const configUpdate = {};
    if (endpoint) configUpdate.endpoint = endpoint;
    if (apiKey !== undefined) configUpdate.apiKey = apiKey;
    if (model) configUpdate.model = model;
    if (typeof timeoutMs === 'number' && timeoutMs > 0) configUpdate.timeoutMs = timeoutMs;

    // 1. Update ChatService
    if (this.chatService) {
      if (typeof timeoutMs === 'number' && timeoutMs > 0) {
        this.chatService.timeoutMs = timeoutMs;
        this.chatTimeoutMs = timeoutMs;
      }
      if (this.chatService.gateway && typeof this.chatService.gateway.updateConfig === 'function') {
        this.chatService.gateway.updateConfig(configUpdate);
      }
    }

    // 2. Update CaseEvaluator
    if (this.caseEvaluator) {
      if (typeof this.caseEvaluator.updateConfig === 'function') {
        this.caseEvaluator.updateConfig(configUpdate);
      } else if (this.caseEvaluator.evaluator?.gateway?.updateConfig) {
        this.caseEvaluator.evaluator.gateway.updateConfig(configUpdate);
      }
    }

    // 3. Update MaterialSyncManager Synthesizer
    if (this.materialSyncManager?.synthesizer) {
      if (typeof timeoutMs === 'number' && timeoutMs > 0) {
        this.materialSyncManager.synthesizer.timeoutMs = timeoutMs;
      }
      if (this.materialSyncManager.synthesizer.gatewayAdapter?.updateConfig) {
        this.materialSyncManager.synthesizer.gatewayAdapter.updateConfig(configUpdate);
      }
    }
  }

  /**
   * Gets effective LLM runtime configuration with masked API key for security.
   * @returns {{ endpoint: string, model: string, timeoutMs: number, hasApiKey: boolean, maskedApiKey: string, source: string }}
   */
  getLlmConfig() {
    let saved = null;
    if (this.db) {
      saved = settingsRepo.getSetting(this.db, 'llm_config');
    }

    let runtime = { endpoint: '', model: '', timeoutMs: 30000, apiKey: '' };
    try {
      const { loadRuntimeConfig } = require('../../../exam-llm');
      runtime = loadRuntimeConfig();
    } catch {}

    const effectiveEndpoint = (saved && saved.endpoint) || runtime.endpoint || 'https://api.deepseek.com/v1';
    const effectiveModel = (saved && saved.model) || runtime.model || 'deepseek-chat';
    const effectiveTimeoutMs = (saved && saved.timeoutMs) || runtime.timeoutMs || 30000;
    const effectiveApiKey = (saved && saved.apiKey !== undefined && saved.apiKey !== '') ? saved.apiKey : (runtime.apiKey || '');

    let maskFn = (k) => (!k ? '[NONE]' : '***');
    try {
      const { maskApiKey } = require('../../../exam-llm');
      maskFn = maskApiKey;
    } catch {}

    return {
      endpoint: effectiveEndpoint,
      model: effectiveModel,
      timeoutMs: effectiveTimeoutMs,
      hasApiKey: Boolean(effectiveApiKey && effectiveApiKey.length > 0),
      maskedApiKey: maskFn(effectiveApiKey),
      source: saved ? 'database' : (runtime.hasApiKey ? 'environment' : 'default')
    };
  }

  /**
   * Persists LLM configuration to database settings and hot-updates runtime instances.
   * @param {object} params
   * @param {string} params.endpoint
   * @param {string} [params.apiKey]
   * @param {string} [params.model]
   * @param {number} [params.timeoutMs]
   */
  saveLlmConfig({ endpoint, apiKey, model, timeoutMs } = {}) {
    if (!this.db) throw new Error('Database is required to save LLM configuration');
    if (!endpoint || typeof endpoint !== 'string' || !endpoint.trim()) {
      throw new Error('API 接口地址 (endpoint) 为必填项');
    }

    let oldSaved = settingsRepo.getSetting(this.db, 'llm_config') || {};

    let targetApiKey = oldSaved.apiKey;
    if (targetApiKey === undefined || targetApiKey === '') {
      try {
        const { loadRuntimeConfig } = require('../../../exam-llm');
        targetApiKey = loadRuntimeConfig().apiKey;
      } catch {}
    }

    if (apiKey !== undefined && apiKey !== null && apiKey.trim() !== '') {
      targetApiKey = apiKey.trim();
    } else if (apiKey === null || apiKey === '[REMOVE]') {
      targetApiKey = '';
    }

    const parsedTimeout = typeof timeoutMs === 'number' ? timeoutMs : parseInt(timeoutMs, 10);
    const safeTimeout = Number.isFinite(parsedTimeout) && parsedTimeout >= 1000 && parsedTimeout <= 120000 ? parsedTimeout : 30000;
    const safeModel = (model && typeof model === 'string' && model.trim()) ? model.trim() : (oldSaved.model || '');

    const newSetting = {
      endpoint: endpoint.trim().replace(/\/+$/, ''),
      apiKey: targetApiKey || '',
      model: safeModel,
      timeoutMs: safeTimeout
    };

    settingsRepo.setSetting(this.db, 'llm_config', newSetting);
    this.applyLlmConfig(newSetting);

    return this.getLlmConfig();
  }

  /**
   * Tests connectivity to an LLM endpoint.
   * @param {object} [options]
   */
  async testLlmConnection(options = {}) {
    try {
      const { GatewayAdapter } = require('../../../exam-llm');
      let apiKey = options.apiKey;
      if (!apiKey) {
        const saved = this.db ? settingsRepo.getSetting(this.db, 'llm_config') : null;
        if (saved && saved.apiKey) {
          apiKey = saved.apiKey;
        } else {
          try {
            const { loadRuntimeConfig } = require('../../../exam-llm');
            apiKey = loadRuntimeConfig().apiKey;
          } catch {}
        }
      }

      const current = this.getLlmConfig();
      const endpoint = options.endpoint || current.endpoint;
      const model = options.model || current.model;
      const timeoutMs = options.timeoutMs || 6000;

      const adapter = new GatewayAdapter({
        endpoint,
        apiKey,
        model,
        timeoutMs
      });

      return await adapter.testConnection({
        endpoint,
        apiKey,
        model,
        timeoutMs
      });
    } catch (e) {
      return { ok: false, latencyMs: 0, error: e.message || '测试连接异常', message: e.message || '测试连接异常' };
    }
  }

  /**
   * Queries list of models available on the endpoint.
   * @param {object} [options]
   */
  async listLlmModels(options = {}) {
    const { GatewayAdapter } = require('../../../exam-llm');
    let apiKey = options.apiKey;
    let endpoint = options.endpoint;
    if (!endpoint || !apiKey) {
      const saved = this.db ? settingsRepo.getSetting(this.db, 'llm_config') : null;
      if (!endpoint) endpoint = saved?.endpoint || this.getLlmConfig().endpoint;
      if (!apiKey) apiKey = saved?.apiKey;
      if (!apiKey) {
        try {
          const { loadRuntimeConfig } = require('../../../exam-llm');
          apiKey = loadRuntimeConfig().apiKey;
        } catch {}
      }
    }
    const adapter = new GatewayAdapter({ endpoint, apiKey });
    return await adapter.listModels({ endpoint, apiKey, timeoutMs: options.timeoutMs || 8000 });
  }

  /**
   * Retrieves current database file metadata and statistics.
   */
  getDatabaseInfo() {
    const resolvedPath = this.dbPath ? path.resolve(this.dbPath) : null;
    let exists = false;
    let sizeBytes = 0;
    let sizeFormatted = '0 B';
    let dirPath = null;

    if (resolvedPath && fs.existsSync(resolvedPath)) {
      exists = true;
      dirPath = path.dirname(resolvedPath);
      const stat = fs.statSync(resolvedPath);
      sizeBytes = stat.size;
      if (sizeBytes < 1024) {
        sizeFormatted = `${sizeBytes} B`;
      } else if (sizeBytes < 1024 * 1024) {
        sizeFormatted = `${(sizeBytes / 1024).toFixed(1)} KB`;
      } else {
        sizeFormatted = `${(sizeBytes / (1024 * 1024)).toFixed(2)} MB`;
      }
    }

    const stats = {
      totalSessions: 0,
      submittedSessions: 0,
      totalAnswers: 0,
      wrongQuestions: 0
    };

    if (this.db) {
      try {
        const sRow = this.db.prepare("SELECT count(*) as count FROM exam_sessions WHERE COALESCE(is_deleted, 0) = 0").get();
        if (sRow) stats.totalSessions = sRow.count;
        const subRow = this.db.prepare("SELECT count(*) as count FROM exam_sessions WHERE status = 'submitted' AND COALESCE(is_deleted, 0) = 0").get();
        if (subRow) stats.submittedSessions = subRow.count;
        const ansRow = this.db.prepare("SELECT count(*) as count FROM exam_answers").get();
        if (ansRow) stats.totalAnswers = ansRow.count;
        const wRow = this.db.prepare("SELECT count(*) as count FROM wrong_questions").get();
        if (wRow) stats.wrongQuestions = wRow.count;
      } catch {}
    }

    return {
      dbPath: resolvedPath || ':memory:',
      dbDir: dirPath,
      exists,
      sizeBytes,
      sizeFormatted,
      stats
    };
  }

  /**
   * Exports an atomic consistent snapshot of current database using VACUUM INTO.
   * @param {string} targetBackupPath
   * @returns {string}
   */
  exportDatabaseToBackup(targetBackupPath) {
    if (!this.db) throw new Error('Database is not initialized');
    const destDir = path.dirname(path.resolve(targetBackupPath));
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    if (fs.existsSync(targetBackupPath)) {
      try { fs.unlinkSync(targetBackupPath); } catch {}
    }

    // Force checkpoint to flush WAL before copy/vacuum
    try {
      this.db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    } catch {}

    const safeDest = targetBackupPath.replace(/\\/g, '/');
    try {
      this.db.exec(`VACUUM INTO '${safeDest}';`);
    } catch {
      if (this.dbPath && fs.existsSync(this.dbPath)) {
        fs.copyFileSync(this.dbPath, targetBackupPath);
      } else {
        throw new Error('VACUUM INTO failed and physical db file is not accessible');
      }
    }

    // Verify backup integrity
    const testDb = new DatabaseSync(targetBackupPath, { readOnly: true });
    const checkRow = testDb.prepare('PRAGMA integrity_check;').get();
    testDb.close();
    if (!checkRow || checkRow.integrity_check !== 'ok') {
      try { fs.unlinkSync(targetBackupPath); } catch {}
      throw new Error('Exported database snapshot failed integrity_check');
    }

    return targetBackupPath;
  }

  /**
   * Imports an external database file into the current active database location.
   * Performs magic header check, integrity validation, and creates an automatic rollback backup.
   * @param {string} sourceTempPath
   * @returns {{ success: boolean, message: string }}
   */
  importDatabaseFile(sourceTempPath) {
    if (!this.dbPath || this.dbPath === ':memory:') {
      throw new Error('当前运行在内存数据库模式，不支持直接导入物理文件覆盖');
    }
    if (!fs.existsSync(sourceTempPath)) {
      throw new Error('待导入的备份文件不存在');
    }

    // 1. Verify SQLite header (16 bytes: "SQLite format 3\0")
    const fd = fs.openSync(sourceTempPath, 'r');
    const headerBuf = Buffer.alloc(16);
    fs.readSync(fd, headerBuf, 0, 16, 0);
    fs.closeSync(fd);
    const magicHeader = headerBuf.toString('utf8', 0, 15);
    if (!magicHeader.startsWith('SQLite format 3')) {
      throw new Error('导入失败：该文件不是有效的 SQLite 数据库文件 (Header 不匹配)');
    }

    // 2. Verify integrity
    const verifyDb = new DatabaseSync(sourceTempPath, { readOnly: true });
    const checkRow = verifyDb.prepare('PRAGMA integrity_check;').get();
    verifyDb.close();
    if (!checkRow || checkRow.integrity_check !== 'ok') {
      throw new Error('导入失败：数据库物理完整性校验未通过 (PRAGMA integrity_check 失败)');
    }

    // 3. Create safety pre-restore backup if current active db exists
    const resolvedDbPath = path.resolve(this.dbPath);
    if (fs.existsSync(resolvedDbPath)) {
      const backupDir = path.join(path.dirname(resolvedDbPath), 'backups');
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }
      const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
      const preRestorePath = path.join(backupDir, `app_pre_import_bak_${timestamp}.db`);
      try {
        this.exportDatabaseToBackup(preRestorePath);
      } catch {
        fs.copyFileSync(resolvedDbPath, preRestorePath);
      }
    }

    // 4. Safely close current connection
    closeDatabase(this.db);

    // 5. Replace database file and clean up WAL logs
    fs.copyFileSync(sourceTempPath, resolvedDbPath);
    try { if (fs.existsSync(`${resolvedDbPath}-wal`)) fs.unlinkSync(`${resolvedDbPath}-wal`); } catch {}
    try { if (fs.existsSync(`${resolvedDbPath}-shm`)) fs.unlinkSync(`${resolvedDbPath}-shm`); } catch {}

    // 6. Reopen connection & run migrations to ensure schema is fully upgraded
    const newDb = createDatabase(resolvedDbPath);
    runMigrations(newDb);
    require('../db/bank-id-upgrade').upgradeBankIdentifiers(newDb, this.bankLoader.reconciliationManifest?.legacy_id_map, resolvedDbPath);

    // 7. Update service instances
    this.db = newDb;
    if (this.materialSyncManager) {
      this.materialSyncManager.db = newDb;
    }
    this.initLlmFromSettings();

    return {
      success: true,
      message: '学习历史数据库恢复成功，架构已自动升级到最新版本'
    };
  }
}

module.exports = {
  ExamService
};

