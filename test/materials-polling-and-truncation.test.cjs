'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const root = path.resolve(__dirname, '..');
const { PersonalMaterialsSynthesizer } = require(path.join(root, 'apps/exam-llm/src/materials/personal-materials-synthesizer'));
const { MaterialSyncManager } = require(path.join(root, 'apps/exam-service/src/material/material-sync-manager'));
const settingsRepo = require(path.join(root, 'apps/exam-service/src/db/settings-repository'));
const matRepo = require(path.join(root, 'apps/exam-service/src/db/personal-materials-repository'));

test('Fix 1: PersonalMaterialsSynthesizer recovers from length truncation via adaptive subdivision and concise fallback', async () => {
  let callCount = 0;
  const mockGateway = {
    chatCompletion: async (opts) => {
      callCount++;
      const userPrompt = opts.messages[1].content;
      // When batch contains multiple items (共 2 题), simulate LLM finish_reason: length truncation
      if (userPrompt.includes('共 2 题')) {
        return {
          content: '- 【考点名称】截断无法闭合...',
          raw: { choices: [{ finish_reason: 'length' }] }
        };
      }
      // When subdivided into single item, return a complete review card.
      if (opts.messages[0].content.includes('统一归并阶段')) {
        return { content: JSON.stringify({ cards: [{ topic: '自适应细分考点', gap: '待补判定', memory: '按条件判定', action: '先检查条件', check: '条件不满足怎么办？（另选分支）', refs: ['C1', 'C2'] }] }) };
      }
      const ref = JSON.parse(userPrompt.split('\n').find(line => line.startsWith('{'))).ref;
      return {
        content: JSON.stringify({ cards: [{ topic: '自适应细分考点', gap: '待补判定', memory: '按条件判定', action: '先检查条件', check: '条件不满足怎么办？（另选分支）', refs: [ref] }] }),
        raw: { choices: [{ finish_reason: 'stop' }] }
      };
    }
  };

  const synthesizer = new PersonalMaterialsSynthesizer({
    gatewayAdapter: mockGateway,
    batchSize: 2
  });

  const evidences = [
    { questionId: 'q-test-1', stem: '题目一题干', userAnswer: 'A', standardAnswer: 'B', isCorrect: false },
    { questionId: 'q-test-2', stem: '题目二题干', userAnswer: 'C', standardAnswer: 'D', isCorrect: false }
  ];

  const result = await synthesizer.synthesizeChapterMaterial({
    chapterKey: 'obj_03_data_structure',
    chapterName: '数据结构',
    subject: 'objective',
    answeredEvidences: evidences
  });

  assert.ok(callCount > 1, 'Must have attempted subdivision after receiving finish_reason: length');
  assert.ok(result.summary.weakPointsCount >= 1, 'Must have successfully recovered points from subdivided batches');
  assert.match(result.markdown, /自适应细分考点/, 'Result markdown must contain recovered point');
});

test('Fix 2: MaterialSyncManager automatically retrieves and applies LLM config from app_settings', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ruankao-mat-sync-test-'));
  const dbPath = path.join(tmpDir, 'test.db');
  const db = new DatabaseSync(dbPath);

  try {
    // Seed encrypted settings
    settingsRepo.setSetting(db, 'llm_config', {
      endpoint: 'https://mock.api.endpoint/v1',
      apiKey: 'test-secret-key-123',
      model: 'mock-deepseek-model',
      timeoutMs: 35000
    });

    const syncManager = new MaterialSyncManager({
      db,
      autoStart: false
    });

    // Verify synthesizer gatewayAdapter was automatically hydrated
    const gw = syncManager.synthesizer.gatewayAdapter;
    assert.equal(gw.endpoint, 'https://mock.api.endpoint/v1');
    assert.equal(gw.apiKey, 'test-secret-key-123');
    assert.equal(gw.model, 'mock-deepseek-model');
    assert.equal(gw.timeoutMs, 35000);
  } finally {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Fix 3: PersonalMaterialsView contains active polling and renders failure reason without page refresh', () => {
  const viewPath = path.join(root, 'apps/exam-web/src/components/PersonalMaterialsView.js');
  const viewContent = fs.readFileSync(viewPath, 'utf8');

  // Verify auto-polling hook exists and checks processing states
  assert.ok(viewContent.includes('isAnyJobProcessing'), 'Must define isAnyJobProcessing check');
  assert.ok(viewContent.includes('setInterval('), 'Must set up interval polling');
  assert.ok(viewContent.includes('clearInterval('), 'Must clean up interval polling on unmount');

  // Verify optimistic status update triggers polling immediately on retry
  assert.ok(viewContent.includes("status: 'processing'"), 'Must mark processing state on retry click');

  // Verify failure banner immediately displays error reason without refresh
  assert.ok(viewContent.includes('item.lastError'), 'Must render item.lastError in warning banner');
  assert.ok(viewContent.includes('isFailed &&'), 'Must render failure banner when failed');
});
