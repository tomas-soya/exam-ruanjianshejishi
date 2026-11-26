'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const { createApp } = require('../apps/exam-service/src/server');
const { createDatabase } = require('../apps/exam-service/src/db/connection');
const { runMigrations } = require('../apps/exam-service/src/db/migrator');
const { sanitizeQuestion } = require('../apps/exam-contracts/dist');
const { RuleBasedCaseEvaluator } = require('../apps/exam-service/src/scoring/case-evaluator');
const { exportAgentTask } = require('../apps/exam-service/src/material/agent-task-export');
const { MAX_MARKDOWN_BYTES } = require('../apps/exam-service/src/material/personal-documents');
const ExamApiClient = require('../apps/exam-web/src/api/client');

// Read the central directory, rather than relying on the writer's local records.
function unzip(bytes) {
  const end = bytes.length - 22;
  assert.equal(bytes.readUInt32LE(end), 0x06054b50);
  let cursor = bytes.readUInt32LE(end + 16);
  const files = new Map();
  for (let n = 0; n < bytes.readUInt16LE(end + 10); n++) {
    assert.equal(bytes.readUInt32LE(cursor), 0x02014b50);
    assert.equal(bytes.readUInt16LE(cursor + 10), 0);
    assert.equal(bytes.readUInt16LE(cursor + 8) & 0x800, 0x800);
    const nameLength = bytes.readUInt16LE(cursor + 28), extra = bytes.readUInt16LE(cursor + 30), comment = bytes.readUInt16LE(cursor + 32);
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    const local = bytes.readUInt32LE(cursor + 42);
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    files.set(name, bytes.subarray(start, start + bytes.readUInt32LE(cursor + 24)));
    cursor += 46 + nameLength + extra + comment;
  }
  return files;
}

async function fixture(t) {
  const db = createDatabase(); runMigrations(db);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-materials-test-'));
  fs.mkdirSync(path.join(temp, 'assets'));
  const image = Buffer.from('synthetic diagram bytes');
  const filename = createHash('sha256').update(image).digest('hex') + '.png';
  fs.writeFileSync(path.join(temp, 'assets', filename), image);
  const asset = { type: 'stem', local_path: `题库/assets/${filename}`, source_url: 'https://private.invalid/source' };
  const raw = [
    ...['loss', 'correct', 'pending-objective', 'draft', 'memorize', 'deleted'].map(id => ({ id, subject: 'objective', chapter: '计算机系统知识',
      question_stem: `合成题面 ${id}`, options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙', images: [asset] }],
      answers: { effective_answer: 'A' }, analysis: '合成解析', images: [asset] })),
    ...['case-loss', 'case-pending', 'case-review', 'case-full', 'case-empty', 'case-rule', 'case-human'].map(id => ({ id,
      subject: 'case', chapter: '结构化分析与设计', shared_stem: `合成案例 ${id}`,
      subquestions: [{ title: '小问一', stem: '判断输入' }, { title: '小问二', stem: '补充输出' }],
      code_blocks: [{ type: 'stem', language: 'cpp', code: 'if (a<b) p->next();' },
        { type: 'solution', language: 'cpp', code: 'return 42;' }],
      solution_and_analysis: '合成参考解析，满分部分不扩写为盲区。', images: [asset] }))
  ];
  const bank = { bankDir: temp, getRawQuestion: id => raw.find(q => q.id === id),
    getSanitizedQuestion: id => sanitizeQuestion(raw.find(q => q.id === id)), listVerifiedPapers: () => [] };
  const manager = { shutdown() {}, enqueueSessionSubmission() { throw new Error('export must not enqueue'); } };
  const server = createApp({ db, bankLoader: bank, materialSyncManager: manager, autoStartSync: false,
    chatService: {}, caseEvaluator: new RuleBasedCaseEvaluator() });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const client = new ExamApiClient({ baseUrl: `http://127.0.0.1:${server.address().port}/api/v1` });
  t.after(async () => {
    await new Promise(resolve => server.close(resolve)); db.close();
    fs.rmSync(temp, { recursive: true, force: true });
  });
  function session(id, values = {}) {
    db.prepare(`INSERT INTO exam_sessions(id,session_mode,title,status,practice_mode,is_deleted,submitted_at)
      VALUES(?,'wrong_questions','合成练习',?,?,?,?)`).run(id, values.status || 'submitted', values.mode || 'exam', values.deleted || 0, values.time || '2026-10-30T01:00:00Z');
  }
  function answer(sessionId, id, score = 0, values = {}) {
    const kind = id.startsWith('case-') ? 'case' : 'objective';
    db.prepare(`INSERT INTO exam_answers(id,session_id,question_id,question_type,user_answer_json,is_correct,score,max_score,score_breakdown_json)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(sessionId + id, sessionId, id, kind, JSON.stringify(values.answer ?? (kind === 'case' ? { sub1: '已完成', sub2: '遗漏输出' } : 'B')),
      score === null ? null : Number(score >= (kind === 'case' ? 15 : 1)), score, kind === 'case' ? 15 : 1,
      values.pending ? '{"status":"pending_scoring"}' : null);
    if (kind === 'case' && score !== null) db.prepare(`INSERT INTO case_reviews(id,answer_id,session_id,question_id,evaluator_type,points,max_points,feedback,breakdown_json,needs_human_review,human_override_points)
      VALUES(?,?,?,?,?,?,15,'第二小问遗漏输出',?,?,?)`).run(sessionId + id, sessionId + id, sessionId, id, values.rule ? 'rule' : 'llm', score,
      JSON.stringify([{ subQuestionIndex: 1, points: 5, maxPoints: 5 }, { subQuestionIndex: 2, points: Math.max(0, score - 5), maxPoints: 10 }]),
      values.review ? 1 : 0, values.human ? score : null);
  }
  return { db, server, client, session, answer, image, filename };
}

function studySnapshot(db) {
  return JSON.stringify(['exam_sessions','exam_answers','case_reviews','wrong_questions','review_queue',
    'personal_chapter_materials','material_sync_jobs','app_settings'].map(table => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()));
}

test('task export uses submitted, latest substantive evidence, separates uncertainty and packages real context without settings', async t => {
  const f = await fixture(t);
  f.session('older', { time: '2026-10-29T01:00:00Z' }); f.answer('older', 'correct');
  f.session('recent');
  for (const id of ['loss','correct','case-loss','case-pending','case-review','case-full','case-empty','case-rule','case-human']) {
    const options = { pending: id === 'case-pending', review: id === 'case-review', rule: /rule|human/.test(id),
      human: id === 'case-human', ...(id === 'case-empty' ? { answer: '  ' } : {}) };
    f.answer('recent', id, id === 'case-pending' ? null : id === 'correct' ? 1 : id === 'case-full' ? 15 : id.startsWith('case-') ? 9 : 0, options);
  }
  f.session('draft-session', { status: 'in_progress' }); f.answer('draft-session', 'draft');
  f.session('memory-session', { mode: 'memorize' }); f.answer('memory-session', 'memorize');
  f.session('deleted-session', { deleted: 1 }); f.answer('deleted-session', 'deleted');
  f.db.prepare("INSERT INTO app_settings(key,value) VALUES('fixture-secret','never-export-configuration')").run();
  const before = studySnapshot(f.db);
  const prepare = f.db.prepare.bind(f.db);
  f.db.prepare = sql => { assert.doesNotMatch(sql, /app_settings|llm_config|personal_documents/i); return prepare(sql); };
  let blob;
  try { blob = await f.client.exportAgentTask({ limit: 10, subject: 'all' }); } finally { f.db.prepare = prepare; }
  const zip = Buffer.from(await blob.arrayBuffer());
  const files = unzip(zip), ev = JSON.parse(files.get('evidence.json'));
  assert.deepEqual(ev.losses.map(e => e.questionId).sort(), ['case-human','case-loss','loss']);
  assert.deepEqual(ev.excluded.map(e => e.reason).sort(), ['needs_human_review','needs_human_review','pending_scoring','unanswered']);
  assert.equal(ev.losses.find(e => e.questionId === 'case-loss').caseReview.breakdown[0].points, 5);
  assert.equal(ev.losses.find(e => e.questionId === 'case-loss').solutionCodeBlocks[0].code, 'return 42;');
  assert(files.get('references/选择题/01-计算机系统知识.md').length > 100);
  assert(files.get('references/案例题/01-结构化分析与设计.md').length > 100);
  assert.deepEqual(files.get(`assets/${f.filename}`), f.image);
  assert.equal(ev.losses.find(e => e.questionId === 'loss').options[1].images[0].available, true);
  assert(!zip.includes(Buffer.from('never-export-configuration')));
  assert(!zip.includes(Buffer.from('private.invalid')));
  const manifest = JSON.parse(files.get('manifest.json'));
  for (const file of manifest.files) assert.equal(createHash('sha256').update(files.get(file.path)).digest('hex'), file.sha256);
  assert.equal(studySnapshot(f.db), before);
  const cases = JSON.parse(unzip(Buffer.from(await (await f.client.exportAgentTask({ subject: 'case' })).arrayBuffer())).get('evidence.json'));
  assert(cases.losses.every(e => e.subject === 'case'));
  for (const scope of [{ limit: 0 }, { limit: 101 }, { subject: 'unknown' }]) await assert.rejects(f.client.exportAgentTask(scope), e => e.status === 400);
});

test('export reports empty scopes, missing references and unsafe assets explicitly', async t => {
  const f = await fixture(t);
  await assert.rejects(f.client.exportAgentTask({}), e => e.status === 400);
  f.session('s'); f.answer('s', 'loss');
  f.server.examService.getStaticMaterial = () => { throw new Error('fixture missing'); };
  fs.unlinkSync(path.join(f.server.examService.bankLoader.bankDir, 'assets', f.filename));
  f.server.examService.bankLoader.getRawQuestion('loss').images.push({ type: 'stem', local_path: '../outside.png' });
  const ev = JSON.parse(unzip(exportAgentTask(f.server.examService)).get('evidence.json'));
  assert.equal(ev.losses[0].images[0].available, false);
  assert.equal(ev.losses[0].images[1].path, null);
  assert.equal(ev.warnings.length, 3);
});

test('task export never diagnoses the unselected elective from a submitted standard case paper', async t => {
  const f = await fixture(t);
  const bank = f.server.examService.bankLoader;
  const ids = ['case-loss','case-pending','case-review','case-full','case-empty','case-human'];
  bank.getRawPaperQuestions = () => ids.map(id => bank.getRawQuestion(id));
  f.session('paper');
  f.db.prepare("UPDATE exam_sessions SET session_mode = 'paper', paper_id = 'synthetic-case-paper' WHERE id = 'paper'").run();
  for (const id of ids) f.answer('paper', id, 6, { human: true });
  const report = f.server.examService.getSessionReport('paper');
  const unselected = report.questions.find(q => q.isElectiveUnselected).question.id;
  const ev = JSON.parse(unzip(exportAgentTask(f.server.examService)).get('evidence.json'));
  assert(ev.excluded.some(q => q.questionId === unselected && q.reason === 'unselected'));
  assert(!ev.losses.some(q => q.questionId === unselected));
  assert.equal(ev.losses.length, 5);
});

test('Markdown import, comparison history, conflict protection and restore preserve all study data', async t => {
  const f = await fixture(t);
  f.session('s'); f.answer('s', 'loss');
  const before = studySnapshot(f.db);
  const original = '# 原理\n\n```cpp\nif (a<b) return 1;\n```\n\n## 自测\n独立问题\n\n## 答案\n独立答案';
  const first = await f.client.savePersonalDocument({ title: '个人专题', markdown: '\uFEFF' + original.replace(/\n/g, '\r\n') });
  assert.equal(first.markdown, original); assert.equal(first.version, 1);
  const second = await f.client.savePersonalDocument({ id: first.id, title: '新版标题', markdown: '# 新版\n必要条件完整', baseVersion: 1 });
  assert.equal(second.version, 2);
  assert.equal((await f.client.getPersonalDocument(first.id, 1)).markdown, original);
  await assert.rejects(f.client.savePersonalDocument({ id: first.id, title: '冲突', markdown: '旧页面', baseVersion: 1 }), e => e.status === 409);
  await assert.rejects(f.client.restorePersonalDocument(first.id, 1, 1), e => e.status === 409);
  const restored = await f.client.restorePersonalDocument(first.id, 1, 2);
  assert.equal(restored.version, 3); assert.equal(restored.restoredFrom, 1); assert.equal(restored.title, '个人专题');
  assert.equal(restored.markdown, original); assert.equal(restored.versions.length, 3);
  assert.equal((await f.client.listPersonalDocuments()).length, 1);
  assert.equal((await f.client.getPersonalDocument(first.id, 2)).markdown, second.markdown);
  assert.equal(studySnapshot(f.db), before);
  assert.deepEqual(runMigrations(f.db).applied, []);
  for (const markdown of ['', '$x^2$', '<script>alert(1)</script>', '\0', '中'.repeat(Math.ceil(MAX_MARKDOWN_BYTES / 3) + 1)]) {
    await assert.rejects(f.client.savePersonalDocument({ title: '无效', markdown }), e => [400, 413].includes(e.status));
  }
  await assert.rejects(f.client.getPersonalDocument(first.id, -1), e => e.status === 400);
  await assert.rejects(f.client.getPersonalDocument('missing'), e => e.status === 404);
  await assert.rejects(f.client.restorePersonalDocument(first.id, 500, 3), e => e.status === 404);
  assert.equal((await f.client.getPersonalDocument(first.id)).version, 3);
  const backupPath = path.join(f.server.examService.bankLoader.bankDir, 'personal-backup.db');
  f.server.examService.exportDatabaseToBackup(backupPath);
  const { DatabaseSync } = require('node:sqlite');
  const backup = new DatabaseSync(backupPath, { readOnly: true });
  try {
    assert.equal(backup.prepare('SELECT current_version FROM personal_documents').get().current_version, 3);
    assert.equal(backup.prepare('SELECT count(*) AS n FROM personal_document_versions').get().n, 3);
    assert.equal(backup.prepare('SELECT markdown FROM personal_document_versions WHERE version = 1').get().markdown, original);
  } finally { backup.close(); }
});

test('new personal endpoints reject untrusted browser origins and UTF-8 JSON survives split network chunks', async t => {
  const f = await fixture(t);
  const root = f.client.baseUrl;
  for (const [route, method] of [['/agent-materials/documents','GET'],['/agent-materials/export','POST']]) {
    assert.equal((await fetch(root + route, { method, headers: { Origin: 'https://untrusted.invalid' } })).status, 403);
    assert.equal((await fetch(root + route, { method, headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  }
  const bytes = Buffer.from(JSON.stringify({ title: '中文标题', markdown: '# 分块中文\n\n字节不能损坏' }));
  const result = await new Promise((resolve, reject) => {
    const req = http.request(root + '/agent-materials/documents', { method: 'POST' }, res => {
      let body = ''; res.setEncoding('utf8'); res.on('data', text => { body += text; }); res.on('end', () => resolve(JSON.parse(body)));
    });
    req.on('error', reject);
    // Every Chinese codepoint is split over multiple writes.
    for (let i = 0; i < bytes.length; i++) req.write(bytes.subarray(i, i + 1));
    req.end();
  });
  assert.equal(result.data.title, '中文标题'); assert.equal(result.data.markdown, '# 分块中文\n\n字节不能损坏');
});

test('personal Markdown UI previews without a write, then saves versions and restores explicit history', async () => {
  const state = [], refs = []; let cursor = 0, refCursor = 0, effectRan = false;
  let rerender;
  const calls = [];
  const context = { Blob, setTimeout, URL, React: {
    createElement: (tag, props, ...children) => ({ tag, props: props || {}, children }),
    // The bundled React runtime renders each async state change separately.
    useState: initial => { const i = cursor++; if (!(i in state)) state[i] = initial; return [state[i], value => { state[i] = value; if (rerender) rerender(); }]; },
    useRef: initial => { const i = refCursor++; return refs[i] ||= { current: initial }; },
    useEffect: callback => { if (!effectRan) { effectRan = true; callback(); } }
  } };
  context.self = context;
  vm.runInNewContext(fs.readFileSync('apps/exam-web/src/components/AgentMaterialsView.js', 'utf8'), context);
  let current = { id: 'doc', title: '个人专题', version: 2, currentVersion: 2, markdown: '# 当前', versions: [{ version: 2 }, { version: 1 }] };
  const apiClient = {
    listPersonalDocuments: async () => [{ ...current, updatedAt: '2026-10-30' }],
    // A concurrent save between the current/history requests must not advance
    // the write baseline beyond the current content actually previewed.
    getPersonalDocument: async (id, version) => version ? { ...current, version, currentVersion: 99, markdown: '# 历史' } : current,
    savePersonalDocument: async draft => { calls.push(['save', draft]); current = { ...current, ...draft, version: 3, currentVersion: 3 }; return current; },
    restorePersonalDocument: async (...args) => { calls.push(['restore', ...args]); return { ...current, version: 4, currentVersion: 4 }; }
  };
  const render = () => { cursor = 0; refCursor = 0; return context.AgentMaterialsView({ apiClient, renderMarkdown: text => text }); };
  rerender = render;
  const nodes = value => !value || typeof value !== 'object' ? [] : Array.isArray(value) ? value.flatMap(nodes) : [value, ...nodes(value.children)];
  const find = (tree, predicate) => nodes(tree).find(predicate);
  const button = (tree, label) => find(tree, n => n.tag === 'button' && n.children.includes(label));
  render(); await Promise.resolve();
  await find(render(), n => n.props.className?.includes('agent-document-button')).props.onClick();
  const input = find(render(), n => n.tag === 'input' && n.props.type === 'file');
  await input.props.onChange({ target: { files: [{ name: '新稿.md', size: 20, text: async () => '# 新稿' }], value: 'file' } });
  assert.equal(calls.length, 0); // Importing and rendering preview are read-only.
  assert(nodes(render()).some(n => n.tag === 'h3' && n.children.includes('待保存内容')));
  await button(render(), '保存个人资料').props.onClick();
  assert.equal(calls[0][1].baseVersion, 2); assert.equal(calls[0][1].id, 'doc');
  const versions = find(render(), n => n.tag === 'select' && n.props.value === 3);
  await versions.props.onChange({ target: { value: '1' } });
  await button(render(), '恢复此版本（保留全部历史）').props.onClick();
  assert.deepEqual(calls[1], ['restore', 'doc', 1, 3]);
});
