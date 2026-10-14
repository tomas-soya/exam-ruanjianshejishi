'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { sanitizeCaseQuestion, assertStrictAnswerIsolation } = require('../apps/exam-contracts/dist');
const { QuestionBankLoader } = require('../apps/exam-service/src/bank/question-loader');
const { ExamService } = require('../apps/exam-service/src/service/exam-service');
const { createDatabase } = require('../apps/exam-service/src/db/connection');
const { runMigrations } = require('../apps/exam-service/src/db/migrator');
const root = path.resolve(__dirname, '..');
const bank = new QuestionBankLoader(path.join(root, '题库'));
const paperId = 'sd-2024-11-case-6d522ac639';

test('2024下半年整卷六个案例的分问为4/2/3/3/1/1，保留每问题面及资产', () => {
  const questions = bank.getSanitizedPaperQuestions(paperId);
  assert.deepEqual(questions.map(q => q.subQuestions.length), [4, 2, 3, 3, 1, 1]);
  for (const q of questions) {
    const raw = bank.getRawQuestion(q.id);
    assert.equal(q.sharedStem, raw.shared_stem);
    assert.equal(q.images.length, raw.images.filter(im => im.type === 'stem').length);
    for (const [index, sub] of q.subQuestions.entries()) {
      assert.equal(sub.id, `sub${index + 1}`);
      assert.match(sub.title, new RegExp(`^0${index + 1}（\\d+分）$`));
      assert.ok(sub.stem.trim());
      assert.ok(raw.shared_stem.includes(sub.stem));
    }
    assertStrictAnswerIsolation(q);
  }
  const first = questions[0].subQuestions;
  assert.match(first[0].stem, /实体E1~E10/);
  assert.match(first[1].stem, /数据存储D1～D2/);
  assert.match(first[2].stem, /可视化数据/);
  assert.match(first[3].stem, /结构化设计的步骤/);
});

test('全库案例均提供答题分问，已有结构化分问的标识与内容保持不变', () => {
  const files = fs.readdirSync(path.join(root, '题库/questions/case'));
  assert.equal(files.length, 162);
  let structured = 0;
  let extracted = 0;
  for (const file of files) {
    const raw = bank.getRawQuestion(file.replace(/\.json$/, ''));
    const safe = sanitizeCaseQuestion(raw);
    assert.ok(safe.subQuestions.length, raw.id);
    assert.equal(new Set(safe.subQuestions.map(sub => sub.id)).size, safe.subQuestions.length);
    assertStrictAnswerIsolation(safe);
    if (raw.subquestions?.length) {
      structured++;
      assert.equal(safe.subQuestions.length, raw.subquestions.length);
      raw.subquestions.forEach((sub, index) => {
        assert.equal(safe.subQuestions[index].id, sub.id || `sub${index + 1}`);
        assert.equal(safe.subQuestions[index].stem, sub.stem.trim() === raw.shared_stem.trim() ? '' : sub.stem);
      });
    } else if (safe.subQuestions.some(sub => sub.stem)) extracted++;
  }
  assert.equal(structured, 66);
  assert.equal(extracted, 65);
});

test('分问识别兼容全角及中文编号，排除需求条目、代码和问内引用', () => {
  const raw = { shared_stem: '背景\n（1）需求\n（2）需求\n```c\n01（5分）\n```\n【问题 一】（ ５ 分 ）\n第一问\n引用【问题二】\n【问题二】中给出的表\n【问题 二】(10分)\n第二问', solution_and_analysis: '秘密答案' };
  const safe = sanitizeCaseQuestion(raw);
  assert.equal(safe.subQuestions.length, 2);
  assert.equal(safe.subQuestions[0].stem, '第一问\n引用【问题二】\n【问题二】中给出的表');
  assert.equal(safe.subQuestions[1].stem, '第二问');
  assertStrictAnswerIsolation(safe);
  assert.equal(sanitizeCaseQuestion({ sharedStem: '背景\n０１（１０分）\n甲\n０２（５分）\n乙' }).subQuestions.length, 2);
  assert.equal(sanitizeCaseQuestion({ shared_stem: '填写（1）～（5）\n（1）;\n（2）;' }).subQuestions.length, 1);
  assert.equal(sanitizeCaseQuestion({ shared_stem: '01（5分）\n甲\n03（10分）\n乙' }).subQuestions.length, 1);
  assert.equal(sanitizeCaseQuestion({ shared_stem: '背景', subquestions_count: 3 }).subQuestions.length, 3);
  assert.deepEqual(sanitizeCaseQuestion({ sharedStem: '背景', subQuestions: [{ id: 'custom', stem: '问', analysis: '秘密' }] }).subQuestions.map(sub => sub.id), ['custom']);
});

test('旧草稿原样恢复，每问分别保存；只答一问或无关键不能算整卷完成', () => {
  const db = createDatabase();
  runMigrations(db);
  // Disable optional AI/config initialization: this test uses only synthetic records.
  const service = Object.assign(Object.create(ExamService.prototype), { db, bankLoader: bank });
  try {
    const session = service.createSession({ paperId });
    const questions = bank.getSanitizedPaperQuestions(paperId);
    const first = questions[0];
    const oldAnswer = { sub1: '原来的整题草稿，原样保留' };
    service.saveAnswerDraft(session.id, { questionId: first.id, questionType: 'case', userAnswer: oldAnswer });
    assert.deepEqual(service.resumeSession(session.id).answers[first.id], oldAnswer);
    assert.equal(service._isCaseQuestionFullyAnswered(bank.getRawQuestion(first.id), JSON.stringify(oldAnswer)), false);
    assert.equal(service._isCaseQuestionFullyAnswered(bank.getRawQuestion(first.id), JSON.stringify({ ...oldAnswer, extra1: 'x', extra2: 'x', extra3: 'x' })), false);
    assert.equal(service._isCaseQuestionFullyAnswered(bank.getRawQuestion(first.id), '旧单一文本'), false);
    for (const q of questions) {
      const answer = Object.fromEntries(q.subQuestions.map(sub => [sub.id, `合成草稿 ${sub.id}`]));
      service.saveAnswerDraft(session.id, { questionId: q.id, questionType: 'case', userAnswer: answer });
      assert.deepEqual(service.resumeSession(session.id).answers[q.id], answer);
      assert.equal(service._isCaseQuestionFullyAnswered(bank.getRawQuestion(q.id), JSON.stringify(answer)), true);
    }
    db.prepare("UPDATE exam_sessions SET status='submitted' WHERE id=?").run(session.id);
    assert.equal(service.isPaperCompleted(bank.getPaper(paperId)), true);
    db.prepare("UPDATE exam_sessions SET status='in_progress' WHERE id=?").run(session.id);
    service.saveAnswerDraft(session.id, { questionId: first.id, questionType: 'case', userAnswer: oldAnswer });
    db.prepare("UPDATE exam_sessions SET status='submitted' WHERE id=?").run(session.id);
    assert.equal(service.isPaperCompleted(bank.getPaper(paperId)), false);
  } finally { db.close(); }
});

test('整卷界面能切换每问，输入更新对应键并保留其余草稿', () => {
  const element = (tag, props, ...children) => ({ tag, props: props || {}, children: children.flat(Infinity).filter(v => v !== false && v != null) });
  let states = [];
  let cursor = 0;
  const react = {
    useState(value) { const index = cursor++; if (!(index in states)) states[index] = value; return [states[index], next => { states[index] = next; }]; },
    createElement: element
  };
  const DOM = Object.fromEntries(['div', 'span', 'button', 'p', 'textarea', 'h3', 'h4', 'img', 'strong'].map(tag => [tag, (props, ...children) => element(tag, props, ...children)]));
  const ctx = { React: react, DOM, CodeBlock: 'CodeBlock', ImageModal: 'ImageModal' };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'apps/exam-web/src/components/CaseQuestion.js'), 'utf8'), ctx);
  const flatten = node => typeof node !== 'object' || !node ? [] : [node, ...(node.children || []).flatMap(flatten)];
  for (const q of bank.getSanitizedPaperQuestions(paperId)) {
    states = [];
    let answer = { sub1: '旧草稿', stale: '无关草稿' };
    const render = () => { cursor = 0; return flatten(ctx.CaseQuestion({ question: q, currentIndex: 0, totalQuestions: 6, userAnswer: answer, onAnswerChange: next => { answer = next; } })); };
    assert.equal(render().filter(n => n.props.className?.startsWith('subquestion-tab-btn')).length, q.subQuestions.length);
    assert.equal(render().find(n => n.props.className === 'subquestions-stat').children[0], `已作答：1 / ${q.subQuestions.length} 个子问`);
    for (const [index, sub] of q.subQuestions.entries()) {
      render().filter(n => n.props.className?.startsWith('subquestion-tab-btn'))[index].props.onClick();
      const nodes = render();
      assert.equal(nodes.find(n => n.props.className === 'subquestion-stem').children[0], sub.stem);
      const input = nodes.find(n => n.tag === 'textarea');
      input.props.onChange({ target: { value: `输入 ${sub.id}` } });
      assert.equal(answer[sub.id], `输入 ${sub.id}`);
      assert.equal(answer.stale, '无关草稿');
      assert.equal(render().find(n => n.tag === 'textarea').props.value, `输入 ${sub.id}`);
    }
  }
});
