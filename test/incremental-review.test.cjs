'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { runMigrations } = require('../apps/exam-service/src/db/migrator');
const repo = require('../apps/exam-service/src/db/personal-materials-repository');
const { MaterialSyncManager } = require('../apps/exam-service/src/material/material-sync-manager');
const { PersonalMaterialsSynthesizer } = require('../apps/exam-llm/src/materials/personal-materials-synthesizer');
const { lossUnits } = require('../apps/exam-llm/src/materials/incremental-review');
const { resolveStandardChapter } = require('../apps/exam-contracts');
const { buildPersonalMaterialsPrompt } = require('../apps/exam-llm/src/materials/materials-prompt-builder');
const ev = (id, extra = {}) => ({ questionId: id, userAnswer: 'A', standardAnswer: 'B', isCorrect: false, stem: 'synthetic', ...extra });
function gateway() {
  const state = { calls: 0, active: 0, max: 0, fail: null };
  return { state, model: 'synthetic', async chatCompletion({ messages }) {
    state.calls++; state.active++; state.max = Math.max(state.max, state.active);
    try {
      await new Promise(resolve => setTimeout(resolve, 2));
      const inputs = messages[1].content.split('\n').filter(line => line.startsWith('{')).map(JSON.parse).filter(row => row.ref);
      if (state.fail && inputs.some(row => row.userAnswer === state.fail)) throw new Error('synthetic failure');
      return { content: JSON.stringify({ cards: inputs.map(row => ({ topic: `规则${row.ref}`, gap: '选择了 A',
        memory: '先核对适用条件再判定', action: '逐一核对题设边界', check: '先检查什么？（适用条件）', refs: [row.ref] })) }), usage: { total_tokens: 10 } };
    } finally { state.active--; }
  } };
}

test('cache skips unchanged sources, invalidates only changed answers, and removes corrected losses', async () => {
  const g = gateway(), s = new PersonalMaterialsSynthesizer({ gatewayAdapter: g, batchSize: 1 });
  const input = { chapterKey: 'x', chapterName: '规则', answeredEvidences: [ev('a'), ev('b'), ev('c')] };
  const first = await s.synthesizeChapterMaterial(input);
  assert.equal(first.telemetry.generatedUnits, 3); assert.equal(g.state.calls, 6); assert.equal(g.state.max, 2);
  const same = await s.synthesizeChapterMaterial({ ...input, existingMetadata: first.metadata });
  assert.equal(same.unchanged, true); assert.equal(same.telemetry.calls, 0); assert.equal(same.markdown, first.markdown);
  const changed = await s.synthesizeChapterMaterial({ ...input, answeredEvidences: [ev('b', { userAnswer: 'C' })], existingMetadata: first.metadata });
  assert.equal(changed.telemetry.cachedUnits, 2); assert.equal(changed.telemetry.generatedUnits, 1);
  const corrected = await s.synthesizeChapterMaterial({ ...input, answeredEvidences: [ev('a', { isCorrect: true })], existingMetadata: first.metadata });
  assert.equal(corrected.telemetry.calls, 0); assert.equal(corrected.metadata.coverage.length, 2);
});

test('case coverage splits code blanks, keeps entity attributes and excludes full-score subquestions', () => {
  const units = lossUnits([ev('case', { points: 3, maxPoints: 15, breakdown: [
    { points: 3, maxPoints: 3, subQuestionIndex: 1, reason: '正确' },
    { points: 0, maxPoints: 6, subQuestionIndex: 2, reason: '（1）错误：缺接口签名；\n（2）错误：缺构造参数' },
    { points: 0, maxPoints: 6, subQuestionIndex: 3, reason: '未补充新增实体的属性' }
  ] })], 'case');
  assert.equal(units.length, 3);
  assert.ok(units.every(unit => unit.evidence.lossUnit.key !== 's1b1'));
  assert.match(units.at(-1).evidence.lossUnit.detail, /实体的属性/);
});

test('scoped case prompts share source context and reject whole-question expansion', () => {
  const units = lossUnits([ev('case', { stem: 'shared-source-marker', points: 0, maxPoints: 6, breakdown: [
    { points: 0, maxPoints: 6, reason: '（1）错误：抽象方法缺少返回类型；（2）错误：构造函数参数遗漏' }
  ] })], 'case').map(unit => unit.evidence);
  const prompt = buildPersonalMaterialsPrompt({ chapterName: '设计模式', subject: 'case', answeredEvidences: units });
  assert.equal(prompt.userPrompt.split('shared-source-marker').length - 1, 1);
  assert.match(prompt.userPrompt, /"context":"Q1"/);
  const synth = new PersonalMaterialsSynthesizer({ gatewayAdapter: gateway() });
  const cards = units.map(unit => ({ topic: unit.lossUnit.topicHint, refs: [unit._reviewRef] }));
  assert.doesNotThrow(() => synth._validateScopedCards(cards, units));
  assert.throws(() => synth._validateScopedCards([...cards, cards[0]], units), /一张完整卡/);
  assert.throws(() => synth._validateScopedCards([{ ...cards[0], topic: '整题错误' }, cards[1]], units), /topicHint/);
});

test('lettered full-score fragments are excluded without losing later constraint errors', () => {
  const units = lossUnits([ev('case', { points: 2.5, maxPoints: 4, breakdown: [
    { points: 2.5, maxPoints: 4, reason: '（a）“所属公司代码”正确，得1分；（b）“投资方编号”正确，得1分。完整性约束未标注主外键，得0分。' }
  ] })], 'case');
  assert.equal(units.length, 1);
  assert.match(units[0].evidence.lossUnit.detail, /完整性约束未/);
});

test('a combined card cannot survive removal of one of its supporting losses through a sibling cache', async () => {
  let combined = true;
  const g = gateway(), normal = g.chatCompletion;
  g.chatCompletion = async function(options) {
    const result = await normal.call(this, options);
    const payload = JSON.parse(result.content);
    if (combined && payload.cards.length > 1) payload.cards = [{ ...payload.cards[0], refs: payload.cards.flatMap(card => card.refs) }];
    return { ...result, content: JSON.stringify(payload) };
  };
  const s = new PersonalMaterialsSynthesizer({ gatewayAdapter: g });
  const first = await s.synthesizeChapterMaterial({ chapterKey: 'x', chapterName: '规则', answeredEvidences: [ev('a'), ev('b')] });
  combined = false;
  const next = await s.synthesizeChapterMaterial({ chapterKey: 'x', chapterName: '规则',
    answeredEvidences: [ev('a', { isCorrect: true })], existingMetadata: first.metadata });
  assert.equal(next.telemetry.generatedUnits, 1); assert.equal(next.telemetry.cachedUnits, 0);
  assert.equal(next.metadata.coverage.length, 1);
});

test('persisted checkpoint resumes after failure without regenerating a completed source', async () => {
  const g = gateway(), s = new PersonalMaterialsSynthesizer({ gatewayAdapter: g, batchSize: 1, concurrency: 1 });
  const cache = {}; g.state.fail = 'FAIL';
  const input = { chapterKey: 'x', chapterName: '规则', answeredEvidences: [ev('a'), ev('b', { userAnswer: 'FAIL' })],
    onCheckpoint: (key, item) => { cache[key] = item; } };
  await assert.rejects(s.synthesizeChapterMaterial(input), /synthetic failure/);
  assert.ok(cache['a:answer']); assert.equal(g.state.active, 0);
  g.state.fail = null;
  const restored = await s.synthesizeChapterMaterial({ ...input, existingMetadata: { evidenceCache: cache } });
  assert.equal(restored.telemetry.cachedUnits, 1); assert.equal(restored.telemetry.generatedUnits, 1);
});

test('queue overlaps different chapters, serializes same chapter and drains jobs arriving during a request', async () => {
  const db = new DatabaseSync(':memory:'); runMigrations(db);
  let active = 0, peak = 0; const seen = new Set(); const versions = [];
  const manager = new MaterialSyncManager({ db, autoStart: false, synthesizer: { async synthesizeChapterMaterial(p) {
    assert.ok(!seen.has(p.chapterKey)); seen.add(p.chapterKey); peak = Math.max(peak, ++active);
    if (p.chapterKey === 'obj_01_computer_system') repo.createSyncJob(db, { id: 'arrived', chapterKey: 'obj_03_data_structure', payloadJson: JSON.stringify({ evidences: [ev('c')] }) });
    await new Promise(resolve => setTimeout(resolve, 5));
    active--; seen.delete(p.chapterKey); versions.push(p.chapterKey);
    return { markdown: '- 规则', metadata: {}, summary: {} };
  } } });
  for (const [id, key] of [['a', 'obj_01_computer_system'], ['b', 'obj_02_pl_basics'], ['d', 'obj_02_pl_basics']]) {
    repo.saveChapterMaterial(db, { chapterKey: key, chapterName: key, metadataJson: JSON.stringify({ retainedEvidences: [ev(id)] }) });
    repo.createSyncJob(db, { id, chapterKey: key, payloadJson: '{}' });
  }
  try { await manager.processQueue(); assert.equal(peak, 2); assert.equal(repo.findPendingJobs(db).length, 0);
    assert.equal(repo.getSyncJob(db, 'arrived').status, 'done'); assert.equal(versions.length, 4);
  } finally { db.close(); }
});

test('strong code title beats a stale design-pattern chapter and incidental UML branch wording', () => {
  assert.equal(resolveStandardChapter({ subject: 'case', chapter: '设计模式', caseTitle: 'n皇后的C程序填空' }).key, 'case_08_algorithm_case');
  assert.equal(resolveStandardChapter({ subject: 'case', caseTitle: 'C++ 组合模式程序', sharedStem: '分支类图' }).key, 'case_02_design_patterns');
});

test('retrying an already empty chapter completes without a duplicate material version', async () => {
  const db = new DatabaseSync(':memory:'); runMigrations(db);
  try {
    repo.saveChapterMaterial(db, { chapterKey: 'case_07_uml_state', chapterName: '状态图', subject: 'case',
      version: 3, status: 'empty', markdownContent: null, metadataJson: '{"retainedEvidences":[]}' });
    repo.createSyncJob(db, { id: 'empty', chapterKey: 'case_07_uml_state' });
    await new MaterialSyncManager({ db, autoStart: false, synthesizer: {} }).processQueue();
    assert.equal(repo.getChapterMaterial(db, 'case_07_uml_state').version, 3);
    assert.equal(repo.getSyncJob(db, 'empty').status, 'done');
  } finally { db.close(); }
});
