'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { identifierDigest, resolveMappedIdentifier } = require('../apps/exam-service/src/bank/identifier-map');
const { upgradeBankIdentifiers } = require('../apps/exam-service/src/db/bank-id-upgrade');
const { createDatabase } = require('../apps/exam-service/src/db/connection');
const { runMigrations } = require('../apps/exam-service/src/db/migrator');
const { assertPublicRecord, assertPublicText } = require('../scripts/verify-public-content.cjs');
const root = path.resolve(__dirname, '..');

test('Hashed compatibility maps migrate saved identifiers without changing study prose or API settings', () => {
  const db = createDatabase(); runMigrations(db);
  try {
    const mapping = { [identifierDigest('old-question')]: 'oq-' + '1'.repeat(20), [identifierDigest('old-paper')]: 'sd-2025-05-objective-' + '2'.repeat(10) };
    assert.equal(resolveMappedIdentifier(mapping, 'old-question'), mapping[identifierDigest('old-question')]);
    assert.equal(resolveMappedIdentifier(mapping, 'unchanged'), 'unchanged');
    assert.equal(resolveMappedIdentifier(mapping, 'toString'), 'toString');
    db.prepare("INSERT INTO exam_sessions(id,session_mode,paper_id,title,score,status) VALUES('s','paper','old-paper','保留原学习标题',23,'submitted')").run();
    db.prepare("INSERT INTO exam_answers(id,session_id,question_id,question_type,user_answer_json,score) VALUES('a','s','old-question','objective','\"old-question\"',1)").run();
    db.prepare("INSERT INTO app_settings(key,value) VALUES('llm','private-fixture-config')").run();
    const payload = { questions: [{ questionId: 'old-question', paper_id: 'old-paper', note: 'old-question' }] };
    db.prepare("INSERT INTO material_sync_jobs(id,chapter_key,payload_json) VALUES('job','chapter',?)").run(JSON.stringify(payload));
    const before = db.prepare('SELECT * FROM exam_answers').get();
    assert.equal(upgradeBankIdentifiers(db, mapping).changed, 3);
    assert.deepEqual({...db.prepare('SELECT * FROM exam_answers').get()}, {...before, question_id: mapping[identifierDigest('old-question')]});
    assert.equal(db.prepare('SELECT title FROM exam_sessions').get().title, '保留原学习标题');
    assert.equal(db.prepare('SELECT value FROM app_settings').get().value, 'private-fixture-config');
    assert.deepEqual(JSON.parse(db.prepare('SELECT payload_json FROM material_sync_jobs').get().payload_json), { questions: [{ questionId: mapping[identifierDigest('old-question')], paper_id: mapping[identifierDigest('old-paper')], note: 'old-question' }] });
    assert.equal(upgradeBankIdentifiers(db, mapping).changed, 0);
  } finally { db.close(); }
});

test('Release guard examines decoded records and rejects provenance, raw maps, URLs and credential signatures', () => {
  assert.throws(() => assertPublicRecord({source_aliases: []}, 'fixture'), /Private metadata/);
  assert.throws(() => assertPublicRecord({analysis: 'https://example.com/question'}, 'fixture'), /External URL/);
  assert.throws(() => assertPublicRecord({legacy_id_map: {'old-id': 'oq-'+'1'.repeat(20)}, legacy_id_map_format: 'sha256-v1'}, 'fixture'), /compatibility identifier/);
  assert.throws(() => assertPublicText('sk-' + 'a'.repeat(24), 'fixture'), /credential/);
  assert.throws(() => assertPublicRecord({analysis: 'sk-' + 'a'.repeat(24)}, 'fixture'), /credential/);
  assertPublicRecord({id: 'oq-'+'1'.repeat(20), analysis: '正常参考解析'}, 'fixture');
});

test('Public footer links work without scripts and project-info sets the same repository and issues', () => {
  const url = 'https://github.com/tomas-soya/exam-ruanjianshejishi';
  const html = fs.readFileSync(path.join(root, 'apps/exam-web/public/index.html'), 'utf8');
  assert(html.includes(`id="project-repository" href="${url}"`));
  assert(html.includes(`id="project-issues" href="${url}/issues"`));
  assert.match(html, /免费开源/); assert.match(html, /MIT 许可证/); assert.match(html, /仅供学习参考/);
  const nodes = Object.fromEntries(['project-author','project-repository','project-issues'].map(id => [id, {}]));
  const context = { window: {}, URL, document: {getElementById: id => nodes[id], addEventListener: (_, callback) => callback()} };
  vm.runInNewContext(fs.readFileSync(path.join(root,'apps/exam-web/public/project-info.js'),'utf8'),context);
  assert.equal(nodes['project-repository'].href, url);
  assert.equal(nodes['project-issues'].href, url+'/issues');
  for (const file of ['LICENSE','CONTENT_NOTICE.md','THIRD_PARTY_NOTICES.md']) assert(fs.existsSync(path.join(root,file)));
  assert.match(fs.readFileSync(path.join(root,'LICENSE'),'utf8'), /WITHOUT WARRANTY OF ANY KIND/);
});

test('Generated materials remove neutral question identifiers while preserving similar code names', () => {
  const { sanitizeGeneratedMarkdown } = require('../apps/exam-llm/src/materials/materials-sanitizer');
  const id = 'oq-' + '1'.repeat(20);
  const result = sanitizeGeneratedMarkdown('- 检查 ' + id + ' 的边界条件，并保留 ref-count 变量。', '算法');
  assert(!result.markdown.includes(id));
  assert(result.markdown.includes('ref-count'));
});
