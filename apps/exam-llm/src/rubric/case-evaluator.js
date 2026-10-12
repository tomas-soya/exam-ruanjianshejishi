'use strict';

const { GatewayAdapter } = require('../adapter/gateway');
const { buildCaseGradingPrompt } = require('./prompt-builder');
const { sanitizeCaseScoreResult } = require('./score-sanitizer');
const { validateCaseScoreResult } = require('../contracts');

/**
 * Deterministic Local Fallback Evaluator (Used during gateway offline/error degradation)
 */
class RuleBasedFallbackEvaluator {
  evaluate({ questionId, userAnswer, solutionAndAnalysis, maxPoints = 15 }) {
    const rawAnswerText = typeof userAnswer === 'string'
      ? userAnswer.trim()
      : Object.values(userAnswer || {}).join(' ').trim();

    if (!rawAnswerText) {
      return validateCaseScoreResult({
        questionId,
        evaluatorType: 'rule',
        points: 0,
        maxPoints,
        feedback: '[离线降级] 考生未作答，本题得 0 分。',
        breakdown: [
          {
            subQuestionIndex: 1,
            subQuestionTitle: '未作答',
            points: 0,
            maxPoints,
            feedback: '未作答'
          }
        ],
        needsHumanReview: false
      }, maxPoints);
    }

    // Extract significant keywords from solution (Chinese phrases >= 2 chars, English words >= 2 chars)
    const tokens = (solutionAndAnalysis.match(/[\u4e00-\u9fa5]{2,6}|[a-zA-Z0-9_]{2,12}/g) || []);
    const stopWords = new Set(['根据', '说明', '回答', '下列', '图中', '问题', '给出', '实体', '系统', '数据', '方法', '流程']);
    const uniqueTokens = Array.from(new Set(tokens.filter(t => t.length >= 2 && !stopWords.has(t))));

    let matchedCount = 0;
    for (const tok of uniqueTokens) {
      if (rawAnswerText.includes(tok)) {
        matchedCount++;
      }
    }

    const ratio = uniqueTokens.length > 0 ? Math.min(1.0, matchedCount / Math.min(uniqueTokens.length, 12)) : 0.5;
    const score = Math.min(maxPoints, Math.max(0, Math.round(ratio * maxPoints)));

    return validateCaseScoreResult({
      questionId,
      evaluatorType: 'rule',
      points: score,
      maxPoints,
      feedback: `[离线降级] LLM网关离线，已采用本地规则评定得分: ${score}/${maxPoints}，已标记待人工覆核。`,
      breakdown: [
        {
          subQuestionIndex: 1,
          subQuestionTitle: '综合问答',
          points: score,
          maxPoints,
          feedback: `关键词匹配度: ${Math.round(ratio * 100)}%`,
          reason: '网关离线降级本地关键词匹配'
        }
      ],
      needsHumanReview: true,
      humanOverridePoints: null,
      humanNotes: null
    }, maxPoints);
  }
}

/**
 * Intelligent LLM Case Evaluator
 * 
 * Features:
 * - Adapts to local OpenAI-compatible gateway (127.0.0.1:8045/v1)
 * - Model: gemini-3.8-flash-high (default)
 * - Structured itemized scoring conforming to @ruankao/exam-contracts
 * - Anti-injection safeguards & score bounds validation
 * - Instant zero-score handling for empty submissions
 * - Automatic offline/error degradation fallback
 */
class LlmCaseEvaluator {
  constructor(options = {}) {
    this.gateway = options.gateway || new GatewayAdapter(options.gatewayOptions || {});
    this.fallbackEvaluator = options.fallbackEvaluator || new RuleBasedFallbackEvaluator();
    this.timeoutMs = options.timeoutMs || 30000;
  }

  /**
   * Evaluates a subjective case question.
   * 
   * @param {object} params
   * @param {string} params.sessionId
   * @param {string} params.questionId
   * @param {string|Record<string, string>} params.userAnswer
   * @param {string} [params.caseTitle]
   * @param {string} params.sharedStem
   * @param {string} params.solutionAndAnalysis
   * @param {number} [params.maxPoints=15]
   * @param {object} [params.rubric]
   * @param {AbortSignal} [params.signal]
   * @returns {Promise<import('@ruankao/exam-contracts').CaseScoringResult>}
   */
  async evaluateCaseQuestion({
    sessionId = '',
    questionId,
    userAnswer,
    caseTitle = '',
    sharedStem = '',
    solutionAndAnalysis = '',
    maxPoints = 15,
    rubric = null,
    signal = null
  }) {
    if (!questionId) {
      throw new Error('LlmCaseEvaluator: questionId is required');
    }

    // 1. Fast path for empty or blank submissions
    const rawAnswerText = typeof userAnswer === 'string'
      ? userAnswer.trim()
      : Object.values(userAnswer || {}).join('').trim();

    if (!rawAnswerText || rawAnswerText.length === 0) {
      return validateCaseScoreResult({
        questionId,
        evaluatorType: 'llm',
        points: 0,
        maxPoints,
        feedback: '考生未作答，本题得 0 分。',
        breakdown: [
          {
            subQuestionIndex: 1,
            subQuestionTitle: '未作答',
            points: 0,
            maxPoints,
            feedback: '未作答'
          }
        ],
        needsHumanReview: false
      }, maxPoints);
    }

    // 2. Build prompt with anti-injection framing
    const { messages } = buildCaseGradingPrompt({
      questionId,
      caseTitle,
      sharedStem,
      solutionAndAnalysis,
      userAnswer,
      maxPoints,
      rubric
    });

    // 3. Call LLM Gateway with fallback on failure
    try {
      const response = await this.gateway.chatCompletion({
        messages,
        timeoutMs: this.timeoutMs,
        signal
      });

      const parsedJson = this.gateway.parseStructuredJson(response.content);

      // 4. Sanitize and bound the returned score
      const result = sanitizeCaseScoreResult(parsedJson, {
        questionId,
        maxPoints,
        userAnswer
      });

      return result;
    } catch (gatewayErr) {
      // 5. Graceful offline/error degradation
      const degradedResult = this.fallbackEvaluator.evaluate({
        questionId,
        userAnswer,
        solutionAndAnalysis,
        maxPoints
      });

      return degradedResult;
    }
  }
}

module.exports = {
  LlmCaseEvaluator,
  RuleBasedFallbackEvaluator
};
