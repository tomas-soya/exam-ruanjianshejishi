'use strict';

const { GatewayAdapter } = require('../adapter/gateway');
const { detectPromptInjection } = require('../rubric/score-sanitizer');
const { buildPersonalMaterialsPrompt, extractBulletPoints } = require('./materials-prompt-builder');
const { sanitizeGeneratedMarkdown } = require('./materials-sanitizer');

/**
 * Personal Materials Synthesizer (AC-1, AC-2, AC-3)
 * Synthesis of personal concise wrong-question review key points (错题复习要点)
 * using the project's LLM gateway (gemini-3.8-flash-high / deepseek-flash).
 */
class PersonalMaterialsSynthesizer {
  constructor(options = {}) {
    this.gatewayAdapter = options.gatewayAdapter || new GatewayAdapter();
    this.timeoutMs = options.timeoutMs || 45000;
    this.maxRetries = options.maxRetries !== undefined ? options.maxRetries : 2;
    this.batchSize = (typeof options.batchSize === 'number' && options.batchSize > 0) ? options.batchSize : 5;
  }

  /**
   * Computes next Ebbinghaus review interval based on mastery progression.
   */
  computeEbbinghausSchedule(currentSchedule = null, hasErrors = true) {
    const INTERVAL_DAYS = [1, 2, 4, 7, 15];
    const now = new Date();

    let stage = 1;
    if (!hasErrors && currentSchedule && typeof currentSchedule.stage === 'number') {
      stage = Math.min(currentSchedule.stage + 1, INTERVAL_DAYS.length);
    } else {
      stage = 1;
    }

    const intervalDays = INTERVAL_DAYS[stage - 1] || 1;
    const nextReview = new Date(now.getTime() + intervalDays * 24 * 60 * 60 * 1000);

    return {
      nextReviewAt: nextReview.toISOString(),
      stage,
      intervalDays,
      isDue: false
    };
  }

  /**
   * Synthesizes personal chapter concise review key points from actual exam answers.
   * 
   * @param {object} params
   * @param {string} params.chapterKey
   * @param {string} params.chapterName
   * @param {'objective' | 'case'} [params.subject='objective']
   * @param {Array<object>} params.answeredEvidences
   * @param {string} [params.existingMarkdown]
   * @param {object} [params.existingMetadata]
   * @param {string} [params.referenceTopics]
   * @returns {Promise<{ markdown: string, summary: object, ebbinghaus: object, metadata: object }>}
   */
  async synthesizeChapterMaterial({
    chapterKey,
    chapterName,
    subject = 'objective',
    answeredEvidences = [],
    existingMarkdown = null,
    existingMetadata = null,
    referenceTopics = '',
    signal = null
  }) {
    if (!chapterKey || !chapterName) {
      throw new Error('Chapter key and name are required for personal material synthesis');
    }

    if (!Array.isArray(answeredEvidences) || answeredEvidences.length === 0) {
      throw new Error('No answered question evidences provided for chapter material synthesis');
    }

    // Check for adversarial prompt injection in student answers
    let promptInjectionDetected = false;
    const cleanEvidences = answeredEvidences.map(ev => {
      let ansStr = '';
      if (typeof ev.userAnswer === 'object' && ev.userAnswer !== null) {
        ansStr = JSON.stringify(ev.userAnswer);
      } else {
        ansStr = String(ev.userAnswer || '');
      }

      const injectionCheck = detectPromptInjection(ansStr);
      if (injectionCheck && injectionCheck.isInjection) {
        promptInjectionDetected = true;
        return {
          ...ev,
          userAnswer: '[系统检测到异常注入指令，已安全脱敏]'
        };
      }
      return ev;
    });

    // AC-1, AC-3: Filter only real wrong questions and lost-point case questions
    const wrongEvidences = cleanEvidences.filter(e => {
      if (e.isCorrect === false) return true;
      if (typeof e.points === 'number' && typeof e.maxPoints === 'number' && e.points < e.maxPoints) return true;
      if (typeof e.score === 'number' && typeof e.maxScore === 'number' && e.score < e.maxScore) return true;
      return false;
    });

    // AC-3: Accumulate and merge with historical wrong question evidences to prevent newer payload from overwriting previous points
    const existingRetained = Array.isArray(existingMetadata?.retainedEvidences) ? existingMetadata.retainedEvidences : [];
    const evidenceMap = new Map();
    for (const ev of existingRetained) {
      if (ev && ev.questionId) {
        evidenceMap.set(ev.questionId, ev);
      }
    }
    for (const ev of wrongEvidences) {
      if (ev && ev.questionId) {
        evidenceMap.set(ev.questionId, ev);
      } else if (ev) {
        evidenceMap.set(`ev_${evidenceMap.size}`, ev);
      }
    }
    // AC-F2: Corrected or full-score items in answered evidences must not remain as loss evidence
    for (const ev of cleanEvidences) {
      if (ev && ev.questionId) {
        const isWrong = (ev.isCorrect === false) ||
          (typeof ev.points === 'number' && typeof ev.maxPoints === 'number' && ev.points < ev.maxPoints) ||
          (typeof ev.score === 'number' && typeof ev.maxScore === 'number' && ev.score < ev.maxScore);
        if (!isWrong) {
          evidenceMap.delete(ev.questionId);
        }
      }
    }
    const allWrongEvidences = Array.from(evidenceMap.values());

    const hasErrors = allWrongEvidences.length > 0;
    const ebbinghaus = this.computeEbbinghausSchedule(existingMetadata?.ebbinghaus, hasErrors);

    const referencedQuestionIds = Array.from(new Set([
      ...(existingMetadata?.referencedQuestionIds || []),
      ...answeredEvidences.map(e => e.questionId).filter(Boolean)
    ]));

    // AC-1, AC-3: If 100% correct and no retained wrong points, do NOT create new weak points
    if (!hasErrors) {
      const emptyTitle = `# 【错题复习要点】${chapterName}`;
      const emptyMarkdown = existingMarkdown && existingMarkdown.trim().length > 0
        ? existingMarkdown
        : `${emptyTitle}\n\n（本次作答全部正确，暂无新增薄弱考点）`;
      const existingSummary = existingMetadata?.summary || {
        weakPointsCount: 0,
        misconceptionsCount: 0,
        tipsCount: 0,
        checklistsCount: 0
      };

      const metadata = {
        chapterKey,
        chapterName,
        subject,
        referencedQuestionIds,
        totalQuestionsAnalyzed: referencedQuestionIds.length,
        lastEvidenceCount: answeredEvidences.length,
        hasErrorsInLastSession: false,
        promptInjectionDetected,
        ebbinghaus,
        summary: existingSummary,
        retainedEvidences: [],
        synthesizedAt: new Date().toISOString()
      };

      return {
        markdown: emptyMarkdown,
        summary: existingSummary,
        ebbinghaus,
        metadata
      };
    }

    const batchSize = this.batchSize || 5;
    const batches = [];
    for (let i = 0; i < allWrongEvidences.length; i += batchSize) {
      batches.push(allWrongEvidences.slice(i, i + batchSize));
    }

    const collectedRawOutputs = [];
    const accumulatedBulletPoints = [];

    if (existingMarkdown) {
      const initialPoints = extractBulletPoints(existingMarkdown);
      accumulatedBulletPoints.push(...initialPoints);
    }

    for (let bIndex = 0; bIndex < batches.length; bIndex++) {
      if (signal?.aborted) {
        const abortErr = new Error('Material synthesis cancelled by user');
        abortErr.name = 'AbortError';
        throw abortErr;
      }

      const currentBatchEvidences = batches[bIndex];
      const { systemPrompt, userPrompt } = buildPersonalMaterialsPrompt({
        chapterName,
        subject,
        answeredEvidences: currentBatchEvidences,
        existingKeyPoints: accumulatedBulletPoints,
        existingMarkdown: bIndex === 0 ? existingMarkdown : null,
        referenceTopics
      });

      // AC-4: Provide standard 4096 request budget; batching (batchSize <= 5) keeps typical wrong question batches within reasonable token budget for models like deepseek-flash.
      // Note: batchSize=5 significantly mitigates single-call output size but cannot guarantee arbitrary models or arbitrarily long single items will never truncate; finish_reason: length is strictly rejected and aborted below.
      const response = await this.gatewayAdapter.chatCompletion({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.2,
        maxTokens: 4096,
        timeoutMs: this.timeoutMs,
        signal
      });

      // AC-4, DS-03: Handle truncated responses (finish_reason === 'length' / 'max_tokens')
      const choice = response?.raw?.choices?.[0];
      const finishReason = response?.finishReason || response?.finish_reason || choice?.finish_reason || choice?.finishReason;
      if (finishReason === 'length' || finishReason === 'max_tokens') {
        throw new Error(`LLM output truncated due to finish_reason: ${finishReason}; aborted to preserve previous version without writing truncated points (AC-4)（大模型单次生成长度达到上限，已中止以保护已有资料）`);
      }

      const rawContent = response && response.content ? response.content : '';
      if (!rawContent || rawContent.trim().length === 0) {
        throw new Error('LLM Gateway returned empty content for personal material synthesis');
      }

      collectedRawOutputs.push(rawContent);

      const newPoints = extractBulletPoints(rawContent);
      accumulatedBulletPoints.push(...newPoints);
    }

    const combinedRawContent = collectedRawOutputs.join('\n\n');

    // AC-1, AC-2: Sanitize and enforce clean point structure (no artificial 5-point, 600-char or 90-char limits)
    const { markdown, summary } = sanitizeGeneratedMarkdown(combinedRawContent, chapterName);

    const metadata = {
      chapterKey,
      chapterName,
      subject,
      referencedQuestionIds,
      totalQuestionsAnalyzed: referencedQuestionIds.length,
      lastEvidenceCount: answeredEvidences.length,
      hasErrorsInLastSession: true,
      promptInjectionDetected,
      ebbinghaus,
      summary,
      retainedEvidences: allWrongEvidences,
      synthesizedAt: new Date().toISOString()
    };

    return {
      markdown,
      summary,
      ebbinghaus,
      metadata
    };
  }
}

module.exports = {
  PersonalMaterialsSynthesizer
};
