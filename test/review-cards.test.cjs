'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PersonalMaterialsSynthesizer } = require('../apps/exam-llm/src/materials/personal-materials-synthesizer');
const { isLossEvidence, parseReviewCards, renderReviewCards } = require('../apps/exam-llm/src/materials/review-cards');
const { buildPersonalMaterialsPrompt } = require('../apps/exam-llm/src/materials/materials-prompt-builder');
const { MaterialSyncManager } = require('../apps/exam-service/src/material/material-sync-manager');
const { DatabaseSync } = require('node:sqlite');
const { runMigrations } = require('../apps/exam-service/src/db/migrator');
const repo = require('../apps/exam-service/src/db/personal-materials-repository');
const { GatewayAdapter } = require('../apps/exam-llm/src/adapter/gateway');

const card = (refs, extra = {}) => ({ topic: '子网容量', gap: '待巩固可用主机数', memory: '常规 IPv4 子网可用主机数为 2^h−2',
  action: '先扣网络地址和广播地址，再比较主机需求', check: 'h=4 有几个可用地址？（14 个）', refs, ...extra });
const loss = (id, extra = {}) => ({ questionId: id, stem: '常规 IPv4 子网需要14个可用地址', userAnswer: 'A',
  standardAnswer: 'B', isCorrect: false, ...extra });

test('only substantive graded loss is evidence; partial case scores survive null correctness', () => {
  for (const userAnswer of ['', ' ', {}, { sub1: '', sub2: ' ' }, '测试回答', { sub1: '测试回答' }]) {
    assert.equal(isLossEvidence(loss('q', { userAnswer })), false);
  }
  assert.equal(isLossEvidence(loss('q', { status: 'unselected' })), false);
  assert.equal(isLossEvidence(loss('q', { userAnswer: { sub1: '不知道' }, isCorrect: null, points: 2, maxPoints: 15 })), true);
  assert.equal(isLossEvidence(loss('q', { isCorrect: true, points: 15, maxPoints: 15 })), false);
});

test('prompt has option text, serializes answers and preserves case scoring detail without old prose', () => {
  const prompt = buildPersonalMaterialsPrompt({ chapterName: '网络', existingMarkdown: '- 旧教材复述', answeredEvidences: [loss('q', {
    options: [{ key: 'A', text: '16' }, { key: 'B', text: '14' }], standardAnswer: { effective_answer: 'B' },
    breakdown: [{ subQuestionId: 'sub1', points: 2, maxPoints: 2 }]
  })] });
  assert.ok(prompt.userPrompt.includes('"standardAnswer":"B"'));
  assert.ok(prompt.userPrompt.includes('"text":"16"'));
  assert.ok(prompt.userPrompt.includes('"breakdown"'));
  assert.ok(!prompt.userPrompt.includes('旧教材复述'));
  assert.ok(!prompt.userPrompt.includes('[object Object]'));
  assert.match(prompt.systemPrompt, /不能断言心理原因/);
});

test('card gate rejects missing steps, invented evidence and dropped evidence without length clipping', () => {
  assert.throws(() => parseReviewCards(JSON.stringify({ cards: [card(['E1'], { action: '' })] }), ['E1']));
  assert.throws(() => parseReviewCards(JSON.stringify({ cards: [card(['E9'])] }), ['E1']));
  assert.throws(() => parseReviewCards(JSON.stringify({ cards: [card(['E1'])] }), ['E1', 'E2']));
  assert.throws(() => parseReviewCards(JSON.stringify({ cards: [card(['E1'], { action: '认真审题' })] }), ['E1']), /具体动作/);
  assert.throws(() => parseReviewCards(JSON.stringify({ cards: [card(['E1'], { check: '是否掌握？' })] }), ['E1']), /自测/);
  assert.throws(() => parseReviewCards(JSON.stringify({ cards: [card(['E1'], { memory: '32bit、200MHz、每5周期，所以160MB/s' })] }),
    ['E1'], ['32bit，200MHz，每5周期传输']), /原题数值/);
  const memory = '不同地址类型须区别处理；'.repeat(30) + '保留必要条件。';
  assert.equal(parseReviewCards(JSON.stringify({ cards: [card(['E1'], { memory })] }), ['E1'])[0].memory, memory);
  assert.throws(() => parseReviewCards(JSON.stringify({ cards: [card(['E1'], { memory })] }), ['E1'], [memory]), /照抄/);
});

test('cross-batch consolidation merges repeated concepts while covering every source and ignores old text', async () => {
  let calls = 0;
  const synth = new PersonalMaterialsSynthesizer({ batchSize: 1, gatewayAdapter: { chatCompletion: async ({ messages }) => {
    calls++;
    const prompt = messages[1].content;
    assert.ok(!prompt.includes('旧稿过时知识'));
    if (messages[0].content.includes('统一归并阶段')) return { content: JSON.stringify({ cards: [card(['C1', 'C2'])] }) };
    const ref = JSON.parse(prompt.split('\n').find(line => line.startsWith('{'))).ref;
    return { content: JSON.stringify({ cards: [card([ref])] }) };
  } } });
  const result = await synth.synthesizeChapterMaterial({ chapterKey: 'obj_10_network_security', chapterName: '网络',
    answeredEvidences: [loss('q1'), loss('q2')], existingMarkdown: '- 【旧稿过时知识】无关内容' });
  assert.equal(calls, 3);
  assert.equal(result.summary.weakPointsCount, 1);
  assert.deepEqual(result.metadata.reviewCards[0].refs, ['E1', 'E2']);
  for (const label of ['待补：', '记住：', '防错：', '自测：']) assert.ok(result.markdown.includes(label));
  assert.ok(!result.markdown.includes('E1'));
});

test('malformed or truncated output never overwrites a valid version; format repair can succeed', async () => {
  let calls = 0;
  const synth = new PersonalMaterialsSynthesizer({ gatewayAdapter: { chatCompletion: async () => {
    calls++;
    return { content: calls === 1 ? '- 解析复述' : JSON.stringify({ cards: [card(['E1'])] }) };
  } } });
  const result = await synth.synthesizeChapterMaterial({ chapterKey: 'x', chapterName: '网络', answeredEvidences: [loss('q1')] });
  assert.equal(calls, 2);
  assert.equal(result.metadata.formatVersion, 'review-cards-v1');
  const bad = new PersonalMaterialsSynthesizer({ gatewayAdapter: { chatCompletion: async () => ({ content: '半个 JSON', finishReason: 'length' }) } });
  await assert.rejects(() => bad.synthesizeChapterMaterial({ chapterKey: 'x', chapterName: '网络', answeredEvidences: [loss('q1')] }), /finish_reason: length/);
});

test('obsolete placeholder evidence clears chapter atomically, archives old version and completes its job', async () => {
  const db = new DatabaseSync(':memory:');
  runMigrations(db);
  try {
    const key = 'case_08_algorithm_case';
    repo.saveChapterMaterial(db, { chapterKey: key, chapterName: '算法', subject: 'case', version: 2,
      markdownContent: '- 【旧盲区】无依据', metadataJson: JSON.stringify({ retainedEvidences: [loss('q', { userAnswer: '' })] }) });
    repo.createSyncJob(db, { id: 'job1', chapterKey: key, payloadJson: '{}' });
    const mgr = new MaterialSyncManager({ db, autoStart: false, synthesizer: { synthesizeChapterMaterial: () => { throw new Error('must not call'); } } });
    await mgr.processQueue();
    assert.equal(repo.getChapterMaterial(db, key).status, 'empty');
    assert.equal(repo.getChapterMaterial(db, key).version, 3);
    assert.equal(repo.getMaterialHistory(db, key)[0].version, 2);
    assert.equal(repo.getSyncJob(db, 'job1').status, 'done');
  } finally { db.close(); }
});

test('retained partial-score case evidence is not lost because it is absent from wrong notebook', async () => {
  const db = new DatabaseSync(':memory:');
  runMigrations(db);
  try {
    const key = 'case_01_dfd';
    const ev = loss('partial', { userAnswer: { sub1: '学生卡' }, isCorrect: true, points: 10, maxPoints: 15 });
    repo.saveChapterMaterial(db, { chapterKey: key, chapterName: 'DFD', subject: 'case', version: 1,
      markdownContent: '- 【实体】旧资料', metadataJson: JSON.stringify({ retainedEvidences: [ev] }) });
    db.prepare('INSERT INTO wrong_questions(id,question_id,paper_id,chapter,question_type) VALUES(?,?,?,?,?)')
      .run('other', 'other-question', 'paper', 'other', 'objective');
    repo.createSyncJob(db, { id: 'partial-job', chapterKey: key, payloadJson: '{}' });
    let captured;
    const mgr = new MaterialSyncManager({ db, autoStart: false, synthesizer: {
      synthesizeChapterMaterial: async params => {
        captured = params.answeredEvidences;
        return { markdown: '- 【实体】待补实体命名', metadata: {}, summary: { weakPointsCount: 1 } };
      }
    } });
    await mgr.processQueue();
    assert.equal(captured.length, 1);
    assert.equal(captured[0].questionId, 'partial');
    assert.equal(repo.getChapterMaterial(db, key).status, 'updated');
  } finally { db.close(); }
});

test('new submission supplies options and case breakdown, and maps legacy software topics correctly', async () => {
  const db = new DatabaseSync(':memory:');
  runMigrations(db);
  try {
    const mgr = new MaterialSyncManager({ db, autoStart: false, synthesizer: {} });
    mgr.triggerProcessQueue = () => {};
    mgr.enqueueSessionSubmission({ sessionId: 's', reportQuestions: [
      { question: { id: 'risk', subject: 'objective', chapter: '项目管理', questionStem: '风险排序', options: [{ key: 'A', text: '影响' }] },
        userAnswer: 'A', effectiveAnswer: 'B', isCorrect: false, score: 0, maxScore: 1, status: 'wrong' },
      { question: { id: 'partial', subject: 'case', sharedStem: '数据流图', chapter: '结构化分析' },
        userAnswer: { sub1: '实体' }, isCorrect: true, score: 10, maxScore: 15, status: 'correct',
        caseReview: { feedback: '部分得分', breakdown: [{ points: 1, maxPoints: 3 }] } }
    ] });
    const jobs = repo.findPendingJobs(db);
    assert.equal(jobs.length, 2);
    const objective = jobs.find(job => job.chapter_key === 'obj_05_software_eng');
    assert.equal(JSON.parse(objective.payload_json).evidences[0].options[0].text, '影响');
    const cases = jobs.find(job => job.chapter_key === 'case_01_dfd');
    assert.equal(JSON.parse(cases.payload_json).evidences[0].breakdown[0].maxPoints, 3);
  } finally { db.close(); }
});

test('only DeepSeek material calls disable thinking; ordinary gateway callers omit provider fields', async () => {
  const requests = [];
  const gateway = new GatewayAdapter({ endpoint: 'https://example.test/v1', model: 'deepseek-flash', apiKey: '',
    fetchFn: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ cards: [card(['E1'])] }) }, finish_reason: 'stop' }] }) };
    }
  });
  const synth = new PersonalMaterialsSynthesizer({ gatewayAdapter: gateway });
  await synth.synthesizeChapterMaterial({ chapterKey: 'network', chapterName: '网络', answeredEvidences: [loss('q')] });
  assert.deepEqual(requests[0].thinking, { type: 'disabled' });
  assert.deepEqual(requests[0].response_format, { type: 'json_object' });
  await gateway.chatCompletion({ messages: [{ role: 'user', content: 'ordinary' }] });
  assert.deepEqual(requests[1].thinking, { type: 'enabled' });
  assert.equal(requests[1].reasoning_effort, 'low');
  assert.equal(requests[1].max_tokens, 8192);
  assert.equal(requests.at(-1).thinking, undefined);
  assert.equal(requests.at(-1).response_format, undefined);
});

test('comparison and C pointer signs survive rendering without swallowing other cards', () => {
  const result = renderReviewCards([card(['E1'], { memory: 'rear<front 时需按模处理', topic: '循环队列' }),
    card(['E2'], { memory: '先保存 p->next，再更新指针', topic: '链表' })], '数据结构');
  assert.equal(result.points.length, 2);
  assert.ok(result.markdown.includes('rear<front'));
  assert.ok(result.markdown.includes('p->next'));
  assert.throws(() => parseReviewCards(JSON.stringify({ cards: [card(['E1'], { memory: '<script>alert(1)</script>' })] }), ['E1']), /HTML/);
});

test('same-topic merge preserves a checked self-test and evidence refs, and rejects newly invented checks', async () => {
  const input = [card(['E1']), card(['E2'], { action: '先识别是否为常规子网，再扣除保留地址' })];
  let invent = false;
  const synth = new PersonalMaterialsSynthesizer({ gatewayAdapter: { chatCompletion: async () => ({
    content: JSON.stringify({ cards: [card(['C1', 'C2'], invent ? { check: 'h=5 有几个可用地址？（30 个）' } : {})] })
  }) } });
  const merged = await synth._mergeExactTopics('网络', input);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].refs, ['E1', 'E2']);
  assert.equal(merged[0].check, input[0].check);
  invent = true;
  await assert.rejects(synth._mergeExactTopics('网络', input), /未经核对的自测/);
});

test('grounded check subdivides a truncated evidence group and keeps every reference', async () => {
  const sizes = [];
  const gateway = { model: 'deepseek-flash', chatCompletion: async options => {
    const evidence = options.messages[1].content.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line)).filter(row => row.ref);
    sizes.push(evidence.length);
    assert.equal(options.thinkingMode, 'enabled');
    assert.equal(options.reasoningEffort, 'low');
    if (evidence.length === 3) return { content: '', raw: { choices: [{ finish_reason: 'length' }] } };
    return { content: JSON.stringify({ cards: evidence.map(ev => card([ev.ref])) }), raw: { choices: [{ finish_reason: 'stop' }] } };
  } };
  const synth = new PersonalMaterialsSynthesizer({ gatewayAdapter: gateway });
  const evidence = [1, 2, 3, 4].map(index => loss(`q${index}`, { _reviewRef: `E${index}` }));
  const reviewed = await synth._reviewAgainstEvidence('网络', 'objective', evidence.map(ev => card([ev._reviewRef])), evidence, null);
  assert.deepEqual(sizes, [3, 2, 1, 1]);
  assert.deepEqual([...new Set(reviewed.flatMap(item => item.refs))], ['E1', 'E2', 'E3', 'E4']);
});
