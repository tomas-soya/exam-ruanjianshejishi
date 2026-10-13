'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { decodeRecord } = require('../apps/exam-service/src/bank/record-codec.js');
const { sanitizeObjectiveQuestion } = require('../apps/exam-contracts/dist/index.js');
const { QuestionBankLoader } = require('../apps/exam-service/src/bank/question-loader.js');
const { ExamService } = require('../apps/exam-service/src/service/exam-service.js');
const { runMigrations } = require('../apps/exam-service/src/db/migrator.js');

test('F3: 13 registered questions have non-empty text or option images', () => {
  const f3Ids = [
    'oq-00bfbf5ca295e5b38bb1',
    'oq-16054a5a08d65ace89e1',
    'oq-454aa6b802941f8b2e03',
    'oq-630cea1c47915c051489',
    'oq-68b6a8d470efb4363b3f',
    'oq-8b7e087f7b39afee7d97',
    'oq-8dda4bd47087cec2517a',
    'oq-91d6e937ec92aecc8325',
    'oq-acb8808da965f624a33c',
    'oq-b84778d45f174ba63dc2',
    'oq-c9e89056f8fb3f870086',
    'oq-e3542590072f85d4bf9f',
    'oq-e8909f18fdf2118c58a9'
  ];

  for (const id of f3Ids) {
    const raw = JSON.parse(fs.readFileSync(path.join('题库/questions/objective', id + '.json'), 'utf8'));
    const q = decodeRecord(raw);
    assert.equal(q.options.length, 4, `Question ${id} should have 4 options`);
    for (const opt of q.options) {
      const hasText = typeof opt.text === 'string' && opt.text.trim().length > 0;
      const hasImage = Array.isArray(opt.images) && opt.images.length > 0;
      assert(hasText || hasImage, `Question ${id} option ${opt.key} must have text or images`);
    }

    // Verify sanitization contracts
    const sanitized = sanitizeObjectiveQuestion(q);
    assert.equal(sanitized.options.length, 4);
  }
});

test('F3: oq-c9e89056f8fb3f870086 restored with exact mathematical options', () => {
  const q = decodeRecord(JSON.parse(fs.readFileSync('题库/questions/objective/oq-c9e89056f8fb3f870086.json', 'utf8')));
  assert.equal(q.options[0].text, 'log₂m = log₂n');
  assert.equal(q.options[1].text, '⌊log₂m⌋ = ⌊log₂n⌋');
  assert.equal(q.options[2].text, '⌊log₂m⌋ + 1 = ⌊log₂n⌋');
  assert.equal(q.options[3].text, '⌊log₂m⌋ = ⌊log₂n⌋ + 1');
  assert.equal(q.answers.effective_answer, 'B');
  assert(q.analysis.includes('⌊log₂m⌋ = ⌊log₂n⌋'));
});

test('R2-F1: subnet options and shared analysis accurately restored to 2²⁴ and 2¹⁰', () => {
  const q66 = decodeRecord(JSON.parse(fs.readFileSync('题库/questions/objective/oq-fb9f96534bf180ef67e3.json', 'utf8')));
  assert.equal(q66.options[0].text, '2¹⁰');
  assert.equal(q66.options[1].text, '2¹²');
  assert.equal(q66.options[2].text, '2²⁰');
  assert.equal(q66.options[3].text, '2²⁴');
  assert.equal(q66.answers.platform_answer, 'D');
  assert.equal(q66.answers.effective_answer, 'D');
  assert.equal(q66.answers.curated_answer, null);
  assert.equal(q66.answers.correction_reason, null);
  assert(q66.analysis.includes('2²⁴个IP地址'));
  assert(q66.analysis.includes('2¹⁰个子网'));

  const q67 = decodeRecord(JSON.parse(fs.readFileSync('题库/questions/objective/oq-4592dc22b96717ee847c.json', 'utf8')));
  assert.equal(q67.answers.effective_answer, 'C');
  assert(q67.analysis.includes('2²⁴个IP地址'));
  assert(q67.analysis.includes('2¹⁰个子网'));
});

test('R2-F2: confirmed math powers and complex symbol degradations repaired', () => {
  const q61 = decodeRecord(JSON.parse(fs.readFileSync('题库/questions/objective/oq-53ba5582659ed52daddc.json', 'utf8')));
  assert.equal(q61.options.find(o => o.key === 'D').text, '2⁹⁶');
  assert(q61.analysis.includes('2¹²⁸ / 2³² = 2⁹⁶'));

  const q3 = decodeRecord(JSON.parse(fs.readFileSync('题库/questions/objective/oq-34103916161b5bf96194.json', 'utf8')));
  assert.equal(q3.options.find(o => o.key === 'B').text, '-2⁶³～(1-2⁻⁸)×2⁶³');
  assert(q3.analysis.includes('-2⁶³'));
  assert(q3.analysis.includes('1-2⁻⁸'));

  // cg-5652e36d0b8b8c0330c5 (2018上案例4)
  const cgCut = decodeRecord(JSON.parse(fs.readFileSync('题库/questions/case/cg-5652e36d0b8b8c0330c5.json', 'utf8')));
  assert(cgCut.solution_and_analysis.includes('A(n)=2ⁿ'));
  assert(cgCut.solution_and_analysis.includes('(6)为O(2ⁿ)'));
  assert(cgCut.solution_and_analysis.includes('(7)为O(n²)'));

  // oq-854275ec8bd51e31ca0a (2025上 #24)
  const qRec = decodeRecord(JSON.parse(fs.readFileSync('题库/questions/objective/oq-854275ec8bd51e31ca0a.json', 'utf8')));
  assert.equal(qRec.options.find(o => o.key === 'B').text, '⊙（n³）');
  assert.equal(qRec.options.find(o => o.key === 'C').text, '⊙（n²）');
  assert(qRec.analysis.includes('T(n)=Θ(n²)'));

  // oq-fdca6e1e7d5bd4a6506f (2026上 #16)
  const qMask = decodeRecord(JSON.parse(fs.readFileSync('题库/questions/objective/oq-fdca6e1e7d5bd4a6506f.json', 'utf8')));
  assert(qMask.analysis.includes('2ʰ−2'));
  assert(qMask.analysis.includes('2⁵−2 = 30'));
  assert(qMask.analysis.includes('255.255.255.224'));

  // oq-fb5946ee854d7a21ef37 (2022上 #36)
  const qPage = decodeRecord(JSON.parse(fs.readFileSync('题库/questions/objective/oq-fb5946ee854d7a21ef37.json', 'utf8')));
  assert(qPage.analysis.includes('2¹² = 4K'));

  // oq-1f170fe05704740e1d46 (2016下 #64)
  const qMatrix = decodeRecord(JSON.parse(fs.readFileSync('题库/questions/objective/oq-1f170fe05704740e1d46.json', 'utf8')));
  assert.equal(qMatrix.options.find(o => o.key === 'B').text, 'O(n²lgn)');
  assert.equal(qMatrix.options.find(o => o.key === 'D').text, 'O(n³lgn)');

  // oq-42d0670e250d8f3a6dc0 (2017下 #62)
  const q62 = decodeRecord(JSON.parse(fs.readFileSync('题库/questions/objective/oq-42d0670e250d8f3a6dc0.json', 'utf8')));
  assert.equal(q62.options[0].text, 'O(n²)');
  assert.equal(q62.options[1].text, 'O(n²lgn)');
  assert.equal(q62.options[2].text, 'O(n³)');
  assert.equal(q62.options[3].text, 'O(n·2ⁿ)');
  assert(q62.analysis.includes('2ⁿ 个子序列'));
  assert(q62.analysis.includes('O(n·2ⁿ)'));

  // oq-268b89704d1729d77d8c (2017下 #63)
  const q63 = decodeRecord(JSON.parse(fs.readFileSync('题库/questions/objective/oq-268b89704d1729d77d8c.json', 'utf8')));
  assert.equal(q63.options[2].text, 'O(n³)');
  assert.equal(q63.options[3].text, 'O(n·2ⁿ)');

  // oq-9e6cb2913da8cced9eff (2020下 #24)
  const q24 = decodeRecord(JSON.parse(fs.readFileSync('题库/questions/objective/oq-9e6cb2913da8cced9eff.json', 'utf8')));
  assert(q24.analysis.includes('4KB=2¹² B'));

  // oq-3838dcd20bd68bf98561 (2015上 #2)
  const q2015_2 = decodeRecord(JSON.parse(fs.readFileSync('题库/questions/objective/oq-3838dcd20bd68bf98561.json', 'utf8')));
  assert.equal(q2015_2.options[0].text, '2ⁿ');
  assert.equal(q2015_2.options[1].text, '2ⁿ⁻¹');
  assert.equal(q2015_2.options[2].text, '2ⁿ⁻¹-1');
  assert.equal(q2015_2.options[3].text, '2ⁿ⁻¹+1');
  assert.equal(q2015_2.answers.effective_answer, 'A');
  assert(q2015_2.analysis.includes('2ⁿ种编码'));
  assert(q2015_2.analysis.includes('2⁻⁽ⁿ⁻¹⁾'));

  // oq-c7300fe8d8d4b14cd11e (2018下 #3)
  const q2018_3 = decodeRecord(JSON.parse(fs.readFileSync('题库/questions/objective/oq-c7300fe8d8d4b14cd11e.json', 'utf8')));
  assert.equal(q2018_3.options[0].text, '2ⁿ');
  assert.equal(q2018_3.options[1].text, '-2ⁿ');
  assert.equal(q2018_3.options[2].text, '2ⁿ⁻¹');
  assert.equal(q2018_3.options[3].text, '-2ⁿ⁻¹');
  assert.equal(q2018_3.answers.effective_answer, 'D');
  assert(q2018_3.analysis.includes('−2ⁿ⁻¹～2ⁿ⁻¹−1'));
  assert(q2018_3.analysis.includes('最高位权重为−2ⁿ⁻¹'));
});

test('F6: 2015-05 Q65 dispute explanation clearly expressed without changing effective answer', () => {
  const q65 = decodeRecord(JSON.parse(fs.readFileSync('题库/questions/objective/oq-acb3c4c68cf711649613.json', 'utf8')));
  assert.equal(q65.answers.effective_answer, 'C');
  assert(q65.analysis.includes('【评分参考与算法理论争议说明】'));
  assert(q65.analysis.includes('最坏时间复杂度为 Θ(n)（即 A 项 O(n)）'));
});

test('R2-F3 & F7: 14 collection declarations removed from real solution_and_analysis and runtime service', async () => {
  const checkIds = [
    '题库/questions/objective/oq-1504212f7d150baf83ba.json',
    '题库/questions/objective/oq-343e5de4303915561847.json',
    '题库/questions/objective/oq-44fde8987427c79cf6be.json',
    '题库/questions/objective/oq-96b00c6ba486725a502c.json',
    '题库/questions/objective/oq-b14f4b4e0f4f421c3aca.json',
    '题库/questions/objective/oq-d0d8e3ffca81937bbf92.json',
    '题库/questions/case/cg-02d5e3ec9def7b2ae6d7.json',
    '题库/questions/case/cg-1acf6c4e60f10573811a.json',
    '题库/questions/case/cg-3c8068312fea74e370d9.json',
    '题库/questions/case/cg-40f4af174b175d947e9e.json',
    '题库/questions/case/cg-4bd299875a085ed6d189.json',
    '题库/questions/case/cg-761d92dd8c17e145c589.json',
    '题库/questions/case/cg-79454f0c0bbfff297d22.json',
    '题库/questions/case/cg-98c105e39bc9bbbdf8e1.json'
  ];

  for (const f of checkIds) {
    const q = decodeRecord(JSON.parse(fs.readFileSync(f, 'utf8')));
    const text = q.solution_and_analysis || q.analysis || '';
    assert(!text.includes('原站可见页面已核实'), `${f} still has collection declaration`);
    assert(!text.includes('同材料解析参照来源第68题'), `${f} still has cross-source declaration`);
    assert(!text.includes('仅整理语法的版本已对n=2..8全部46,232个排列'), `${f} still has raw exhaustive test notes`);
  }

  // Runtime verification with ExamService
  const db = new DatabaseSync(':memory:');
  runMigrations(db);
  const loader = new QuestionBankLoader(path.join(process.cwd(), '题库'));
  const service = new ExamService({ db, bankLoader: loader, autoStartSync: false, chatService: {} });
  const caseIds = [
    'cg-02d5e3ec9def7b2ae6d7', 'cg-1acf6c4e60f10573811a', 'cg-3c8068312fea74e370d9',
    'cg-40f4af174b175d947e9e', 'cg-4bd299875a085ed6d189', 'cg-761d92dd8c17e145c589',
    'cg-79454f0c0bbfff297d22', 'cg-98c105e39bc9bbbdf8e1'
  ];
  const session = service.createSession({ mode: 'wrong_questions', practiceMode: 'memorize', questionIds: caseIds, title: 'Case verify' });
  for (const id of caseIds) {
    const sol = await service.checkQuestion(session.id, id, {});
    assert(!sol.solutionAndAnalysis.includes('原站可见页面已核实'), `${id} runtime still returned declaration`);
  }
  db.close();
});

test('R2-F4: past exam markdowns synchronized with option images, formulas and zero process traces', (t) => {
  if (!fs.existsSync('软件设计师复习材料/历年真题')) {
    t.skip('Past exam markdowns are only present in development environment');
    return;
  }
  // 1. 2011下 #60 options in markdown
  const md2011 = fs.readFileSync('软件设计师复习材料/历年真题/xisai-paper_58_201111_objective_59.md', 'utf8');
  assert(md2011.includes('- **A**：log₂m = log₂n'));
  assert(md2011.includes('- **B**：⌊log₂m⌋ = ⌊log₂n⌋'));
  assert(md2011.includes('- **D**：2²⁴'));

  // 2. 12 image option questions have images embedded in markdown options
  const md2018_11 = fs.readFileSync('软件设计师复习材料/历年真题/malinkang-2018-11-objective.md', 'utf8');
  assert(md2018_11.includes('- **A.** ![选项 A 配图]'));

  const md2015_05 = fs.readFileSync('软件设计师复习材料/历年真题/malinkang-2015-05-objective.md', 'utf8');
  assert(md2015_05.includes('- **A.** ![选项 A 配图]'));
  assert(md2015_05.includes('【评分参考与算法理论争议说明】'));

  // 3. 0 "原站可见页面已核实" across all markdown files in 软件设计师复习材料/历年真题/
  const mdDir = '软件设计师复习材料/历年真题';
  const files = fs.readdirSync(mdDir).filter(f => f.endsWith('.md'));
  for (const f of files) {
    const content = fs.readFileSync(path.join(mdDir, f), 'utf8');
    assert(!content.includes('原站可见页面已核实'), `${f} still contains 原站可见页面已核实`);
    assert(!content.includes('同材料解析参照来源第68题'), `${f} still contains 同材料解析参照来源第68题`);
  }

  // 4. Zero exhaustive test traces in 2016-05 case
  const md2016Case = fs.readFileSync('软件设计师复习材料/历年真题/malinkang-2016-05-case.md', 'utf8');
  assert(!md2016Case.includes('46,232个排列'), 'malinkang-2016-05-case.md still contains exhaustive test notes');

  // 5. R3-F2 specific markdown syncs verified
  const md2018Case = fs.readFileSync('软件设计师复习材料/历年真题/malinkang-2018-05-case.md', 'utf8');
  assert(md2018Case.includes('A(n)=2ⁿ'));
  assert(md2018Case.includes('O(2ⁿ)'));
  assert(md2018Case.includes('O(n²)'));

  const md2025Obj = fs.readFileSync('软件设计师复习材料/历年真题/malinkang-2025-05-objective.md', 'utf8');
  assert(md2025Obj.includes('- **B.** ⊙（n³）'));
  assert(md2025Obj.includes('- **C.** ⊙（n²）'));
  assert(md2025Obj.includes('T(n)=Θ(n²)'));

  const md2026Obj = fs.readFileSync('软件设计师复习材料/历年真题/malinkang-2026-05-objective.md', 'utf8');
  assert(md2026Obj.includes('2ʰ−2'));
  assert(md2026Obj.includes('2⁵−2 = 30'));

  const md2016Obj = fs.readFileSync('软件设计师复习材料/历年真题/malinkang-2016-11-objective.md', 'utf8');
  assert(md2016Obj.includes('- **A.** O(n²)'));
  assert(md2016Obj.includes('- **C.** O(n³)'));
  assert(md2016Obj.includes('Θ(n³)'));

  // 6. R3-F1 & R3-F2 additional markdown syncs verified
  const md2015Obj = fs.readFileSync('软件设计师复习材料/历年真题/malinkang-2015-05-objective.md', 'utf8');
  assert(md2015Obj.includes('- **A.** 2ⁿ'));
  assert(md2015Obj.includes('- **B.** 2ⁿ⁻¹'));
  assert(md2015Obj.includes('- **C.** 2ⁿ⁻¹-1'));
  assert(md2015Obj.includes('- **D.** 2ⁿ⁻¹+1'));
  assert(md2015Obj.includes('2⁻⁽ⁿ⁻¹⁾'));

  const md2018Obj3 = fs.readFileSync('软件设计师复习材料/历年真题/malinkang-2018-11-objective.md', 'utf8');
  assert(md2018Obj3.includes('- **A.** 2ⁿ'));
  assert(md2018Obj3.includes('- **B.** -2ⁿ'));
  assert(md2018Obj3.includes('- **C.** 2ⁿ⁻¹'));
  assert(md2018Obj3.includes('- **D.** -2ⁿ⁻¹'));
  assert(md2018Obj3.includes('−2ⁿ⁻¹～2ⁿ⁻¹−1'));
  assert(md2018Obj3.includes('- **D.** Θ(n²)'));

  const md2017Obj = fs.readFileSync('软件设计师复习材料/历年真题/malinkang-2017-11-objective.md', 'utf8');
  assert(md2017Obj.includes('- **C.** O(n²)'));
  assert(md2017Obj.includes('- **D.** O(n²lgn)'));
  assert(md2017Obj.includes('最坏为 Θ(n²)'));

  const md2023Obj = fs.readFileSync('软件设计师复习材料/历年真题/malinkang-2023-05-objective.md', 'utf8');
  assert(md2023Obj.includes('- **C.** O(e²)'));

  const md2018Obj = fs.readFileSync('软件设计师复习材料/历年真题/malinkang-2018-05-objective.md', 'utf8');
  assert(md2018Obj.includes('普通实现最坏可退化到 Θ(n²)'));
  assert(md2018Obj.includes('- **D.** Θ(n²)'));
  assert(md2018Obj.includes('0+1+…+(n−1)=Θ(n²)；加上前面的快排，最坏仍为 Θ(n²)'));

  const md2021Obj = fs.readFileSync('软件设计师复习材料/历年真题/malinkang-2021-11-objective.md', 'utf8');
  assert(md2021Obj.includes('- **B.** Θ(n)和Θ(n²)'));
  assert(md2021Obj.includes('- **D.** Θ(n lg n)和Θ(n²)'));
});

test('R3-F6: 7 internal paper markdowns have zero broken image links and zero ./assets/../assets/ paths', (t) => {
  if (!fs.existsSync('题库/papers/malinkang-2016-05-case.md')) {
    t.skip('Internal paper markdowns are only present in development environment');
    return;
  }
  const paperFiles = [
    '题库/papers/malinkang-2016-05-case.md',
    '题库/papers/malinkang-2016-11-objective.md',
    '题库/papers/malinkang-2017-05-case.md',
    '题库/papers/malinkang-2021-05-objective.md',
    '题库/papers/malinkang-2021-11-objective.md',
    '题库/papers/malinkang-2022-05-objective.md',
    '题库/papers/malinkang-2022-11-case.md'
  ];
  for (const pf of paperFiles) {
    const text = fs.readFileSync(pf, 'utf8');
    assert(!text.includes('./assets/../assets/'), `${pf} still has ./assets/../assets/`);
    const dir = path.dirname(pf);
    const matches = [...text.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)];
    for (const m of matches) {
      const target = path.resolve(dir, m[1]);
      assert(fs.existsSync(target), `Broken image link in ${pf}: ${m[1]}`);
    }
  }
});

test('R3-F4: Q60 evidence file accurately registers source gap without false claim', (t) => {
  if (!fs.existsSync('artifacts/bank-quality-repair-20261013/evidence/r2-f5-q60-evidence.json')) {
    t.skip('Evidence files are only present in development environment');
    return;
  }
  const ev = JSON.parse(fs.readFileSync('artifacts/bank-quality-repair-20261013/evidence/r2-f5-q60-evidence.json', 'utf8'));
  assert.equal(ev.evidence_status, 'content_gap_registered_mathematically_curated');
  assert(ev.source_record);
  assert.equal(ev.source_record.capture_sha256, 'e69680b5801d4b151675c196c6f967a4ae690e938d2e305658d0bbb0be235e52');
  assert(ev.gap_explanation.includes('内容缺口'));
});

test('R2-F6: case subquestions losslessly preserved in cleanCapture and sanitized contracts', async (t) => {
  const cleanScript = path.resolve(__dirname, '../scripts/local/bank-pipeline/clean.mjs');
  if (!fs.existsSync(cleanScript)) {
    t.skip('Pipeline clean script is only present in development environment');
    return;
  }
  const { cleanCapture } = await import('../scripts/local/bank-pipeline/clean.mjs');
  const { sanitizeCaseQuestion } = require('../apps/exam-contracts/dist/index.js');
  const block = text => ({ text, raw_html: `<p>${text}</p>`, images: [], unsupported: [] });
  const capture = {
    id: 'case-test',
    source_ref: 'case-test',
    subject: 'case',
    year: 2026,
    year_verified: true,
    complete: true,
    identity_verified: true,
    fields: { stem: block('案例总干'), analysis: block('总解析') },
    subquestions: [{ stem: '【问题1】小问1' }, { stem: '【问题2】小问2' }]
  };
  const cleaned = cleanCapture(capture);
  assert.equal(cleaned.question.subquestions.length, 2);
  const sanitized = sanitizeCaseQuestion(cleaned.question);
  assert.equal(sanitized.subQuestions.length, 2);
  assert.equal(sanitized.subQuestions[0].stem, '【问题1】小问1');
});

test('R3-F3: CaseQuestion component renders subquestion images and code blocks while isolating solutions', () => {
  const vm = require('node:vm');
  const { sanitizeCaseQuestion } = require('../apps/exam-contracts/dist/index.js');

  const question = {
    id: 'test-case-render',
    subject: 'case',
    caseTitle: '测试案例',
    sharedStem: '案例总说明',
    subquestions: [
      {
        id: 'sub1',
        title: '【问题 1】',
        stem: '请根据附图和代码回答问题1',
        images: [{ type: 'stem', owner: 'subquestion:sub1', local_path: 'test-sub-img.png', sha256: 'a'.repeat(64) }],
        code_blocks: [{ type: 'stem', language: 'c', content: 'int sub_var = 42;' }]
      }
    ],
    images: [],
    code_blocks: [],
    solution_and_analysis: '私密解析不可泄露'
  };

  const sanitized = sanitizeCaseQuestion(question);
  assert.equal(sanitized.subQuestions.length, 1);
  assert.equal(sanitized.subQuestions[0].images.length, 1);
  assert.equal(sanitized.subQuestions[0].codeBlocks.length, 1);
  assert.equal(sanitized.solution_and_analysis, undefined);

  // Render CaseQuestion component in headless DOM context
  const treeElement = (tag, props, ...children) => ({ tag, props: props || {}, children: children.flat(Infinity).filter(v => v !== false && v != null) });
  const ReactMock = { useState: v => [v, () => {}], createElement: treeElement };
  const DOM = Object.fromEntries(['div', 'span', 'button', 'p', 'textarea', 'h3', 'h4', 'img', 'strong'].map(tag => [tag, (props, ...children) => treeElement(tag, props, ...children)]));
  const ctx = { React: ReactMock, DOM, CodeBlock: 'CodeBlock', ImageModal: 'ImageModal' };
  vm.runInNewContext(fs.readFileSync('apps/exam-web/src/components/CaseQuestion.js', 'utf8'), ctx);

  const tree = ctx.CaseQuestion({
    question: sanitized,
    currentIndex: 0,
    totalQuestions: 1,
    userAnswer: {},
    onAnswerChange: () => {},
    practiceMode: 'exam'
  });

  const nodes = [];
  function visit(n) {
    if (!n || typeof n !== 'object') return;
    nodes.push(n);
    for (const c of n.children || []) visit(c);
  }
  visit(tree);

  const renderedImgs = nodes.filter(n => n.tag === 'img').map(n => n.props.src);
  const renderedCodeBlocks = nodes.filter(n => n.tag === 'CodeBlock').map(n => n.props.code);

  assert(renderedImgs.some(src => src.includes('test-sub-img.png')), 'Subquestion image must be rendered in UI');
  assert(renderedCodeBlocks.includes('int sub_var = 42;'), 'Subquestion code block must be rendered in UI');
  assert(!JSON.stringify(tree).includes('私密解析不可泄露'), 'Solution must never leak into rendered UI');
});

