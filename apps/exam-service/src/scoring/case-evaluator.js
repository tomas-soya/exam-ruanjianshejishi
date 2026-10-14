'use strict';

const {
  validateCaseScoreResult
} = require('../../../exam-contracts/dist/index.js');

/**
 * Pluggable Case Evaluation Architecture
 * 
 * Defines the contract for grading subjective case questions.
 * Supports rule-based heuristics, mock evaluators, and full W3C LLM evaluation adapters.
 */

class BaseCaseEvaluator {
  /**
   * @param {object} params
   * @param {string} params.sessionId
   * @param {string} params.questionId
   * @param {string|Record<string, string>} params.userAnswer
   * @param {string} params.sharedStem
   * @param {string} params.solutionAndAnalysis
   * @param {number} [params.maxPoints=15]
   * @param {object} [params.rubric]
   * @returns {Promise<import('@ruankao/exam-contracts').CaseScoringResult>}
   */
  async evaluateCaseQuestion(params) {
    throw new Error('evaluateCaseQuestion must be implemented by subclass');
  }
}

/**
 * Deterministic Rule-Based Case Evaluator (explicit legacy use only)
 * 
 * Provides automated preliminary scoring using structural subquestion parsing
 * and reference keyword presence, strictly bounding scores and marking
 * ambiguous cases as requiring human review.
 */
class RuleBasedCaseEvaluator extends BaseCaseEvaluator {
  constructor(options = {}) {
    super();
    this.options = options;
  }

  async evaluateCaseQuestion({
    sessionId,
    questionId,
    userAnswer,
    sharedStem = '',
    solutionAndAnalysis = '',
    maxPoints = 15,
    rubric
  }) {
    // 1. If blank answer
    const rawAnswerText = typeof userAnswer === 'string'
      ? userAnswer.trim()
      : Object.values(userAnswer || {}).join(' ').trim();

    if (!rawAnswerText || rawAnswerText.length === 0) {
      return validateCaseScoreResult({
        questionId,
        evaluatorType: 'rule',
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

    // 2. Parse subquestions if user answer is a map
    const breakdown = [];
    let totalPoints = 0;

    if (typeof userAnswer === 'object' && !Array.isArray(userAnswer)) {
      const keys = Object.keys(userAnswer);
      const subMax = Math.max(1, Math.floor(maxPoints / (keys.length || 1)));

      let idx = 1;
      for (const key of keys) {
        const subAns = String(userAnswer[key] || '').trim();
        const subPoints = this._scoreSubText(subAns, solutionAndAnalysis, subMax);
        totalPoints += subPoints;

        breakdown.push({
          subQuestionIndex: idx,
          subQuestionTitle: key,
          points: subPoints,
          maxPoints: subMax,
          feedback: subPoints > 0 ? `部分要点匹配（得分: ${subPoints}/${subMax}）` : '未匹配到关键要点',
          reason: `匹配参考答案关键词对比`
        });
        idx++;
      }
    } else {
      // Plain text answer: split into sentences or evaluate as unified answer
      const points = this._scoreSubText(rawAnswerText, solutionAndAnalysis, maxPoints);
      totalPoints = points;
      breakdown.push({
        subQuestionIndex: 1,
        subQuestionTitle: '综合问答',
        points,
        maxPoints,
        feedback: points > 0 ? `答案与参考解答存在关键知识点重合（得分: ${points}/${maxPoints}）` : '关键术语未命中',
        reason: '规则关键词匹配'
      });
    }

    totalPoints = Math.min(maxPoints, Math.max(0, totalPoints));

    // Case questions always require human confirmation if score is non-zero in rule-based mode
    const needsHumanReview = totalPoints > 0 && totalPoints < maxPoints;

    return validateCaseScoreResult({
      questionId,
      evaluatorType: 'rule',
      points: totalPoints,
      maxPoints,
      feedback: `规则评分初步判定得分: ${totalPoints} / ${maxPoints}。${needsHumanReview ? '（包含主观分析题，建议人工核验）' : ''}`,
      breakdown,
      needsHumanReview,
      humanOverridePoints: null,
      humanNotes: null
    }, maxPoints);
  }

  _scoreSubText(userText, referenceText, maxPoints) {
    if (!userText || !referenceText) return 0;
    
    // Extract non-trivial Chinese terms and alphanumeric tokens (length >= 2)
    const tokens = (referenceText.match(/[\u4e00-\u9fa5]{2,6}|[a-zA-Z0-9_]{2,10}/g) || []);
    const uniqueTokens = Array.from(new Set(tokens.filter(t => t.length >= 2 && !['根据', '说明', '回答', '下列', '图中', '问题', '给出'].includes(t))));

    if (uniqueTokens.length === 0) {
      return Math.round(maxPoints * 0.5);
    }

    let matchCount = 0;
    for (const token of uniqueTokens) {
      if (userText.includes(token)) {
        matchCount++;
      }
    }

    const ratio = matchCount / Math.min(uniqueTokens.length, 10);
    const score = Math.min(maxPoints, Math.round(ratio * maxPoints));
    return score;
  }
}

/**
 * Adapter Registry for Pluggable Evaluators
 */
class PluggableCaseEvaluator extends BaseCaseEvaluator {
  constructor(customEvaluator = null) {
    super();
    this.defaultEvaluator = null;
    this.customEvaluator = customEvaluator;
  }

  setEvaluator(evaluator) {
    this.customEvaluator = evaluator;
  }

  getEvaluator() {
    if (this.customEvaluator) return this.customEvaluator;
    if (!this.defaultEvaluator) {
      const { LlmCaseEvaluator } = require('../../../exam-llm');
      this.defaultEvaluator = new LlmCaseEvaluator();
    }
    return this.defaultEvaluator;
  }

  updateConfig(config = {}) {
    const evaluator = this.getEvaluator();
    if (typeof evaluator.updateConfig === 'function') evaluator.updateConfig(config);
    else if (evaluator.gateway?.updateConfig) {
      evaluator.gateway.updateConfig(config);
      if (config.timeoutMs > 0) evaluator.timeoutMs = config.timeoutMs;
    }
  }

  async evaluateCaseQuestion(params) {
    try {
      const evaluator = this.getEvaluator();
      const result = await evaluator.evaluateCaseQuestion(params);
      return validateCaseScoreResult(result, params.maxPoints || 15);
    } catch (err) {
      const unavailable = new Error('LLM 暂不可用或评分响应无效，未进行评分。答案已保留，可稍后重新评分。');
      unavailable.code = 'CASE_SCORING_UNAVAILABLE';
      unavailable.statusCode = 503;
      throw unavailable;
    }
  }
}

module.exports = {
  BaseCaseEvaluator,
  RuleBasedCaseEvaluator,
  PluggableCaseEvaluator
};
