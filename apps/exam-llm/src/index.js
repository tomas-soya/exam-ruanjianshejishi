'use strict';

const { GatewayAdapter } = require('./adapter/gateway');
const { loadRuntimeConfig, maskApiKey, sanitizeLogMessage } = require('./adapter/env-loader');
const { LlmCaseEvaluator, RuleBasedFallbackEvaluator } = require('./rubric/case-evaluator');
const { buildCaseGradingPrompt } = require('./rubric/prompt-builder');
const { sanitizeCaseScoreResult, detectPromptInjection } = require('./rubric/score-sanitizer');
const { PriorityEngine } = require('./priority/priority-engine');
const { calculateQuestionPriority, WEIGHT_LOSS_RATE, WEIGHT_RECENCY, WEIGHT_CYCLE } = require('./priority/algorithm');
const { PersonalMaterialsSynthesizer } = require('./materials/personal-materials-synthesizer');
const { buildPersonalMaterialsPrompt } = require('./materials/materials-prompt-builder');
const { sanitizeGeneratedMarkdown } = require('./materials/materials-sanitizer');
const { LocalMaterialRetriever } = require('./chat/retriever');
const {
  ExamChatService,
  resolveChatTimeoutMs,
  DEFAULT_CHAT_TIMEOUT_MS,
  MIN_CHAT_TIMEOUT_MS,
  MAX_CHAT_TIMEOUT_MS
} = require('./chat/chat-service');

module.exports = {
  // Adapter
  GatewayAdapter,
  loadRuntimeConfig,
  maskApiKey,
  sanitizeLogMessage,

  // Case Scoring Rubric
  LlmCaseEvaluator,
  RuleBasedFallbackEvaluator,
  buildCaseGradingPrompt,
  sanitizeCaseScoreResult,
  detectPromptInjection,

  // Review Priority Engine
  PriorityEngine,
  calculateQuestionPriority,
  WEIGHT_LOSS_RATE,
  WEIGHT_RECENCY,
  WEIGHT_CYCLE,

  // Personal Chapter Materials Synthesizer (AC-B1..B5)
  PersonalMaterialsSynthesizer,
  buildPersonalMaterialsPrompt,
  sanitizeGeneratedMarkdown,

  // AI Chat Assistant & Local Material Retriever (AC-Q1..Q5)
  LocalMaterialRetriever,
  ExamChatService,
  resolveChatTimeoutMs,
  DEFAULT_CHAT_TIMEOUT_MS,
  MIN_CHAT_TIMEOUT_MS,
  MAX_CHAT_TIMEOUT_MS
};


