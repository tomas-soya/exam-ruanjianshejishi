'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createApp } = require('../apps/exam-service/src/server');
const { createDatabase } = require('../apps/exam-service/src/db/connection');
const { runMigrations } = require('../apps/exam-service/src/db/migrator');
const { MaterialSyncManager } = require('../apps/exam-service/src/material/material-sync-manager');
const { sanitizeCaseQuestion } = require('../apps/exam-contracts/dist');
const ExamApiClient = require('../apps/exam-web/src/api/client');
const { RuleBasedCaseEvaluator, PluggableCaseEvaluator } = require('../apps/exam-service/src/scoring/case-evaluator');
const { LlmCaseEvaluator } = require('../apps/exam-llm/src/rubric/case-evaluator');
const matRepo = require('../apps/exam-service/src/db/personal-materials-repository');

async function fixture(t, { legacy = false, count = 2 } = {}) {
  // Only synthetic answers/configuration and memory SQLite; never use the learning DB.
  const previousKey = process.env.LLM_API_KEY;
  process.env.LLM_API_KEY = 'synthetic-test-key';
  const db = createDatabase(':memory:');
  runMigrations(db);
  const raw = Array.from({ length: count }, (_, i) => ({ id: `case-fixture-${i + 1}`, subject: 'case',
    paper_id: 'fixture-paper', chapter: '结构化分析与设计', case_title: '结构化分析',
    shared_stem: '请描述数据流图中的实体与数据存储', solution_and_analysis: '实体连接数据流，数据存储保存记录。' }));
  const bank = { getPaper: () => ({ id: 'fixture-paper', subject: 'case', title: '合成案例' }),
    getRawPaperQuestions: () => raw, getSanitizedPaperQuestions: () => raw.map(sanitizeCaseQuestion),
    getRawQuestion: id => raw.find(q => q.id === id), getSanitizedQuestion: id => sanitizeCaseQuestion(raw.find(q => q.id === id)) };
  const state = { offline: true, points: 6, calls: [], invalid: false, failAt: null };
  const gateway = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    state.calls.push({ url: req.url, body: JSON.parse(body || '{}'), auth: req.headers.authorization });
    const failure = state.offline || state.calls.length === state.failAt;
    res.writeHead(failure ? 503 : 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(failure ? { error: 'synthetic outage' } : { choices: [{ message: { content: state.invalid ? '{}' :
      JSON.stringify({ points: state.points, feedback: '实体连接存在遗漏', needsHumanReview: false,
        breakdown: [{ subQuestionIndex: 1, subQuestionTitle: '数据流', points: state.points, maxPoints: 15, feedback: '需检查实体连接' }] }) } }] }));
  });
  await new Promise(resolve => gateway.listen(0, '127.0.0.1', resolve));
  const synthesized = [];
  const manager = new MaterialSyncManager({ db, autoStart: false, synthesizer: {
    async synthesizeChapterMaterial(params) {
      synthesized.push(params);
      return { markdownContent: '- 数据流图：检查实体与数据存储之间的数据流', metadata: { formatVersion: 'review-cards-v1' } };
    }
  } });
  manager.triggerProcessQueue = () => {}; // Explicitly drain real jobs in assertions.
  const server = createApp({ db, bankLoader: bank, materialSyncManager: manager,
    caseEvaluator: legacy ? new RuleBasedCaseEvaluator() : undefined, autoStartSync: false });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const service = server.examService;
  service.saveLlmConfig({ endpoint: `http://127.0.0.1:${gateway.address().port}/v1`, model: 'fixture-model', apiKey: 'fixture-key', timeoutMs: 75000 });
  if (!legacy) service.caseEvaluator.getEvaluator().gateway.maxRetries = 0;
  const client = new ExamApiClient({ baseUrl: `http://127.0.0.1:${server.address().port}/api/v1` });
  t.after(async () => {
    manager.shutdown();
    await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => gateway.close(resolve))]);
    db.close();
    if (previousKey === undefined) delete process.env.LLM_API_KEY; else process.env.LLM_API_KEY = previousKey;
  });
  const session = await client.createSession({ paperId: 'fixture-paper' });
  return { db, state, service, client, session, raw, manager, synthesized };
}

test('saved and hot-updated configuration reaches actual case gateway, including timeout', async t => {
  const f = await fixture(t);
  const evaluator = f.service.caseEvaluator.getEvaluator();
  assert.equal(evaluator.timeoutMs, 75000);
  f.service.caseEvaluator = new PluggableCaseEvaluator(new LlmCaseEvaluator());
  f.service.initLlmFromSettings();
  f.service.caseEvaluator.getEvaluator().gateway.maxRetries = 0;
  assert.equal(f.service.caseEvaluator.getEvaluator().timeoutMs, 75000);
  f.state.offline = false;
  await f.client.saveAnswerDraft(f.session.id, f.raw[0].id, 'case', { sub1: '数据存储保存记录' });
  const report = await f.client.submitSession(f.session.id);
  assert.equal(report.questions[0].caseReview.evaluatorType, 'llm');
  assert.equal(report.score, 6);
  assert.equal(f.state.calls[0].body.model, 'fixture-model');
  assert.equal(f.state.calls[0].auth, 'Bearer fixture-key');
  assert.equal(f.state.calls[0].url, '/v1/chat/completions');
});

test('offline submit keeps answers pending, no grades/weakness/jobs; concurrent retry scores once and refreshes materials', async t => {
  const f = await fixture(t);
  const answer = { sub1: '外部实体发送数据给处理模块' };
  await f.client.saveAnswerDraft(f.session.id, f.raw[0].id, 'case', answer);
  const report = await f.client.submitSession(f.session.id);
  assert.equal(report.status, 'submitted');
  assert.equal(report.score, null);
  assert.equal(report.accuracy, null);
  assert.equal(report.pendingScoringCount, 1);
  assert.equal(report.answeredCount, 1);
  assert.equal(report.unansweredCount, 1);
  assert.equal(report.questions[0].status, 'pending_scoring');
  assert.equal(report.questions[0].caseReview, undefined);
  assert.deepEqual(report.questions[0].userAnswer, answer);
  for (const table of ['wrong_questions', 'review_queue', 'material_sync_jobs']) {
    assert.equal(f.db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0);
  }
  assert.equal(f.db.prepare('SELECT score FROM exam_sessions WHERE id=?').get(f.session.id).score, null);
  assert.equal((await f.client.submitSession(f.session.id)).pendingScoringCount, 1);
  await assert.rejects(f.client.regradeSession(f.session.id), { code: 'CASE_SCORING_UNAVAILABLE' });
  assert.equal(f.service.getSessionReport(f.session.id).score, null);
  f.state.offline = false;
  const beforeCalls = f.state.calls.length;
  const reports = await Promise.all([f.client.regradeSession(f.session.id), f.client.regradeSession(f.session.id)]);
  assert.equal(f.state.calls.length - beforeCalls, 1);
  assert.equal(reports[0].score, 6);
  assert.equal(reports[1].score, 6);
  assert.equal(reports[0].submittedAt, report.submittedAt);
  assert.equal(reports[0].pendingScoringCount, 0);
  assert.equal(f.db.prepare('SELECT wrong_count FROM wrong_questions').get().wrong_count, 1);
  const job = f.db.prepare('SELECT * FROM material_sync_jobs').get();
  assert.equal(job.trigger_type, 'case_regrade');
  await f.manager._executeJob(job);
  assert.equal(matRepo.getChapterMaterial(f.db, job.chapter_key).version, 1);
  assert.equal(f.synthesized[0].answeredEvidences[0].points, 6);
  await f.client.regradeSession(f.session.id);
  assert.equal(f.state.calls.length - beforeCalls, 1);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM material_sync_jobs').get().n, 1);
});

test('invalid LLM output defers scoring and failed multi-question retry writes no partial scores', async t => {
  const f = await fixture(t);
  for (const raw of f.raw) await f.client.saveAnswerDraft(f.session.id, raw.id, 'case', '处理模块接收实体输入并写入数据存储');
  f.state.offline = false;
  f.state.invalid = true;
  assert.equal((await f.client.submitSession(f.session.id)).pendingScoringCount, 2);
  f.state.invalid = false;
  f.state.failAt = f.state.calls.length + 2;
  await assert.rejects(f.client.regradeSession(f.session.id), { code: 'CASE_SCORING_UNAVAILABLE' });
  assert.equal(f.service.getSessionReport(f.session.id).pendingScoringCount, 2);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM case_reviews').get().n, 0);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM wrong_questions').get().n, 0);
});

test('legacy fallback can be rescored, replaces old evidence even for full marks; human overrides remain intact', async t => {
  const f = await fixture(t, { legacy: true });
  for (const raw of f.raw) await f.client.saveAnswerDraft(f.session.id, raw.id, 'case', '不知道如何识别数据流');
  const old = await f.client.submitSession(f.session.id);
  assert.equal(old.canRegrade, true);
  const oldJob = f.db.prepare('SELECT * FROM material_sync_jobs').get();
  await f.manager._executeJob(oldJob);
  f.service.overrideCaseReview(f.session.id, f.raw[1].id, { points: 10, notes: '保留人工结果' });
  f.service.caseEvaluator = new PluggableCaseEvaluator(new LlmCaseEvaluator());
  f.service.initLlmFromSettings();
  f.service.caseEvaluator.getEvaluator().gateway.maxRetries = 0;
  f.state.offline = false;
  f.state.points = 15;
  const report = await f.client.regradeSession(f.session.id);
  assert.equal(report.score, 25);
  assert.equal(report.questions[0].caseReview.evaluatorType, 'llm');
  assert.equal(report.questions[1].caseReview.humanOverridePoints, 10);
  assert.equal(f.state.calls.length, 1);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM case_reviews').get().n, 2);
  const job = f.db.prepare("SELECT * FROM material_sync_jobs WHERE trigger_type='case_regrade'").get();
  assert.ok(job, 'fresh job bypasses submission deduplication');
  await f.manager._executeJob(job);
  const material = matRepo.getChapterMaterial(f.db, job.chapter_key);
  assert.ok(!JSON.parse(material.metadata_json).retainedEvidences.some(ev => ev.questionId === f.raw[0].id));
  assert.equal(material.version, 2);
});

test('elective pending questions never enter total, wrong notebook or material evidence', async t => {
  const f = await fixture(t, { count: 6 });
  for (const raw of f.raw) await f.client.saveAnswerDraft(f.session.id, raw.id, 'case', '实体接收输入并存储记录');
  const pending = await f.client.submitSession(f.session.id);
  assert.equal(pending.pendingScoringCount, 5);
  f.state.offline = false;
  const report = await f.client.regradeSession(f.session.id);
  assert.equal(report.score, 30);
  assert.equal(report.maxScore, 75);
  assert.equal(report.questions.filter(q => q.isElectiveUnselected).length, 1);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM wrong_questions').get().n, 5);
  const evidence = JSON.parse(f.db.prepare('SELECT payload_json FROM material_sync_jobs').get().payload_json).evidences;
  assert.equal(evidence.length, 5);
});

test('failed material enqueue rolls back scores and statistics so retry remains available', async t => {
  const f = await fixture(t);
  await f.client.saveAnswerDraft(f.session.id, f.raw[0].id, 'case', '实体发送业务数据到处理模块');
  await f.client.submitSession(f.session.id);
  f.state.offline = false;
  const tables = ['case_reviews', 'wrong_questions', 'review_queue', 'material_sync_jobs'];
  const before = Object.fromEntries(tables.map(table => [table, f.db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n]));
  const enqueue = f.manager.enqueueSessionSubmission;
  f.manager.enqueueSessionSubmission = () => { throw new Error('synthetic material write failure'); };
  await assert.rejects(f.client.regradeSession(f.session.id));
  assert.equal(f.service.getSessionReport(f.session.id).pendingScoringCount, 1);
  for (const table of tables) {
    assert.equal(f.db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, before[table], table);
  }
  f.manager.enqueueSessionSubmission = enqueue;
  assert.equal((await f.client.regradeSession(f.session.id)).score, 6);
});

test('pending report displays no score/fail verdict, retry shows progress/error/success', async () => {
  const element = (tag, props, ...children) => ({ tag, props: props || {}, children: children.flat(Infinity).filter(v => v !== false && v != null) });
  const states = []; let cursor = 0;
  const ctx = { React: { useState(value) { const i = cursor++; if (!(i in states)) states[i] = value;
    return [states[i], next => { states[i] = typeof next === 'function' ? next(states[i]) : next; }]; }, createElement: element },
    DOM: Object.fromEntries(['div', 'span', 'button', 'h2', 'h3', 'h4', 'p', 'strong', 'input', 'textarea', 'label', 'img']
      .map(tag => [tag, (props, ...children) => element(tag, props, ...children)])), CodeBlock: 'CodeBlock', ImageModal: 'ImageModal', MaterialModal: 'MaterialModal' };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../apps/exam-web/src/components/ReportView.js'), 'utf8'), ctx);
  const report = { sessionId: 'synthetic', score: null, maxScore: 15, totalQuestions: 1, answeredCount: 1,
    unansweredCount: 0, correctCount: 0, wrongCount: 0, pendingScoringCount: 1, canRegrade: true,
    questions: [{ question: { id: 'case', subject: 'case' }, userAnswer: '数据流图', score: null, maxScore: 15,
      isCorrect: null, pendingScoring: true, status: 'pending_scoring', scoringMessage: 'LLM 暂不可用' }] };
  let fail = true;
  const render = () => { cursor = 0; return ctx.ReportView({ report, onRegradeSession: async () => {
    if (fail) throw Object.assign(new Error('outage'), { code: 'CASE_SCORING_UNAVAILABLE' });
  } }); };
  const flatten = node => typeof node !== 'object' || !node ? [] : [node, ...node.children.flatMap(flatten)];
  let nodes = flatten(render());
  assert.equal(nodes.find(n => n.props.className === 'score-val').children[0], '待评分');
  assert.ok(!nodes.some(n => n.props.className?.startsWith('pass-tag')));
  const retry = nodes.find(n => n.tag === 'button' && n.children.includes('重新进行 LLM 评分'));
  const pending = retry.props.onClick();
  assert.equal(flatten(render()).find(n => n.children.includes('正在评分…')).props.disabled, true);
  await pending;
  assert.match(JSON.stringify(render()), /答案?卷已保留/);
  fail = false;
  await flatten(render()).find(n => n.children.includes('重新进行 LLM 评分')).props.onClick();
  assert.match(JSON.stringify(render()), /复习资料将在后台同步/);
});
