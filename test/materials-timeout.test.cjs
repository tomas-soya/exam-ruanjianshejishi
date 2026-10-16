'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { DatabaseSync } = require('node:sqlite');
const { PersonalMaterialsSynthesizer } = require('../apps/exam-llm/src/materials/personal-materials-synthesizer');
const { MaterialSyncManager } = require('../apps/exam-service/src/material/material-sync-manager');
const { ExamService } = require('../apps/exam-service/src/service/exam-service');
const { runMigrations } = require('../apps/exam-service/src/db/migrator');
const settings = require('../apps/exam-service/src/db/settings-repository');
const materials = require('../apps/exam-service/src/db/personal-materials-repository');

const evidence = { questionId: 'synthetic-case', stem: '实体向系统提交数据',
  userAnswer: { sub1: '数据存储' }, standardAnswer: '外部实体', isCorrect: false,
  points: 0, maxPoints: 15 };
const card = { topic: '系统边界', gap: '把外部实体写成数据存储', memory: '按系统边界区分实体和内部存储',
  action: '先画系统边界，再检查数据来自哪里', check: '系统外部提交数据的是哪类元素？（外部实体）', refs: ['E1'] };
const request = { messages: [{ role: 'user', content: 'synthetic' }] };

test('materials request budget survives short settings, covers review overrides and preserves longer budgets', async () => {
  const calls = [];
  const synth = new PersonalMaterialsSynthesizer({ timeoutMs: 30000, gatewayAdapter: {
    chatCompletion: async options => { calls.push(options); return { content: 'ok' }; }
  } });
  assert.equal(synth.timeoutMs, 120000);
  synth.timeoutMs = 30000; // Startup/configuration hot reload uses the shared setting.
  await synth._chatCompletion(request);
  await synth._chatCompletion({ ...request, timeoutMs: 90000 }); // Evidence review.
  await synth._chatCompletion({ ...request, timeoutMs: 180000 });
  await synth._chatCompletion({ ...request, timeoutMs: NaN });
  assert.deepEqual(calls.map(call => call.timeoutMs), [120000, 120000, 180000, 120000]);
});

test('saved 30s configuration and hot reload allow a real 31s HTTP material response to complete', { timeout: 45000 }, async t => {
  const db = new DatabaseSync(':memory:');
  runMigrations(db);
  let calls = 0;
  let delayedResponse;
  const gateway = http.createServer(async (req, res) => {
    for await (const chunk of req) { /* Consume synthetic request body. */ }
    calls++;
    const respond = () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ cards: [card] }) }, finish_reason: 'stop' }] }));
    };
    if (calls === 1) delayedResponse = setTimeout(respond, 31000);
    else respond();
  });
  t.after(async () => {
    clearTimeout(delayedResponse);
    gateway.closeAllConnections();
    await new Promise(resolve => gateway.close(resolve));
    db.close();
  });
  await new Promise(resolve => gateway.listen(0, '127.0.0.1', resolve));
  settings.setSetting(db, 'llm_config', { endpoint: `http://127.0.0.1:${gateway.address().port}/v1`,
    model: 'synthetic-model', apiKey: 'synthetic-key', timeoutMs: 30000 });
  const manager = new MaterialSyncManager({ db, autoStart: false });
  manager.synthesizer.gatewayAdapter.maxRetries = 0; // Success must not depend on retry.
  assert.equal(manager.synthesizer.timeoutMs, 30000);
  const service = new ExamService({ db, bankLoader: {}, materialSyncManager: manager, autoStartSync: false });
  service.applyLlmConfig({ timeoutMs: 30000 });
  assert.equal(service.chatTimeoutMs, 30000);
  assert.equal(service.caseEvaluator.getEvaluator().timeoutMs, 30000);
  const key = 'case_01_dfd';
  materials.saveChapterMaterial(db, { chapterKey: key, chapterName: '结构化分析', subject: 'case', version: 1,
    markdownContent: '- 旧资料', metadataJson: JSON.stringify({ retainedEvidences: [evidence] }) });
  materials.createSyncJob(db, { id: 'slow-materials', chapterKey: key, payloadJson: '{}' });
  await manager.processQueue();
  assert.equal(calls, 2, materials.getSyncJob(db, 'slow-materials').error_message || 'Extraction and evidence review must both complete');
  assert.equal(materials.getSyncJob(db, 'slow-materials').status, 'done');
  const saved = materials.getChapterMaterial(db, key);
  assert.equal(saved.status, 'updated');
  assert.equal(saved.version, 2);
  assert.match(saved.markdown_content, /系统边界/);
  assert.equal(materials.getMaterialHistory(db, key)[0].markdown_content, '- 旧资料');
});

test('material gateway failure preserves current version and leaves a failed job for retry', async () => {
  const db = new DatabaseSync(':memory:');
  runMigrations(db);
  try {
    const synth = new PersonalMaterialsSynthesizer({ gatewayAdapter: { chatCompletion: async options => {
      assert.equal(options.timeoutMs, 120000);
      throw new Error(`Gateway request timed out after ${options.timeoutMs}ms`);
    } } });
    const manager = new MaterialSyncManager({ db, autoStart: false, synthesizer: synth });
    const key = 'case_01_dfd';
    materials.saveChapterMaterial(db, { chapterKey: key, chapterName: '结构化分析', subject: 'case', version: 3,
      markdownContent: '- 保留的复习资料', metadataJson: JSON.stringify({ retainedEvidences: [evidence] }) });
    materials.createSyncJob(db, { id: 'failed-materials', chapterKey: key, payloadJson: '{}' });
    await manager.processQueue();
    assert.equal(materials.getSyncJob(db, 'failed-materials').status, 'failed');
    const saved = materials.getChapterMaterial(db, key);
    assert.equal(saved.version, 3);
    assert.equal(saved.markdown_content, '- 保留的复习资料');
    assert.match(saved.last_error, /保留上一版本/);
    assert.equal(materials.getMaterialHistory(db, key).length, 0);
  } finally { db.close(); }
});
