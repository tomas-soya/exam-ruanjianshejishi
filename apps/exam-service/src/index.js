'use strict';

const { createDatabase, closeDatabase } = require('./db/connection');
const { runMigrations, getAppliedMigrations, ensureMigrationTable } = require('./db/migrator');
const sessionRepo = require('./db/session-repository');
const answerRepo = require('./db/answer-repository');
const wrongQuestionsRepo = require('./db/wrong-questions-repository');
const reviewQueueRepo = require('./db/review-queue-repository');
const caseReviewRepo = require('./db/case-review-repository');
const settingsRepo = require('./db/settings-repository');
const {
  QuestionBankLoader,
  VERIFIED_PAPER_IDS,
  PAPER_CANONICAL_MAP,
  PAPER_ALIAS_MAP,
  getCanonicalPaperId,
  getPaperAliasIds,
  isCanonicalPaper
} = require('./bank/question-loader');
const { resolveMaterialAnchor } = require('./material/material-anchor');
const {
  BaseCaseEvaluator,
  RuleBasedCaseEvaluator,
  PluggableCaseEvaluator
} = require('./scoring/case-evaluator');
const { ExamService } = require('./service/exam-service');
const { createApp, startServer } = require('./server');

module.exports = {
  createDatabase,
  closeDatabase,
  runMigrations,
  getAppliedMigrations,
  ensureMigrationTable,
  sessionRepo,
  answerRepo,
  wrongQuestionsRepo,
  reviewQueueRepo,
  caseReviewRepo,
  settingsRepo,
  QuestionBankLoader,
  VERIFIED_PAPER_IDS,
  PAPER_CANONICAL_MAP,
  PAPER_ALIAS_MAP,
  getCanonicalPaperId,
  getPaperAliasIds,
  isCanonicalPaper,
  resolveMaterialAnchor,
  BaseCaseEvaluator,
  RuleBasedCaseEvaluator,
  PluggableCaseEvaluator,
  ExamService,
  createApp,
  startServer
};
