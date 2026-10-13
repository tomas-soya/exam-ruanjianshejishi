'use strict';

const { sanitizeGeneratedMarkdown } = require('./materials-sanitizer');

// A score alone cannot establish a learning gap: drafts, empty answers and
// test placeholders are not evidence of a misconception.
function hasSubstantiveAnswer(answer) {
  if (answer && typeof answer === 'object') return Object.values(answer).some(hasSubstantiveAnswer);
  if (typeof answer !== 'string') return answer !== null && answer !== undefined;
  const text = answer.trim();
  return Boolean(text) && !/^(?:测试(?:回答|答案|文本)?|test(?: answer)?|占位(?:文本)?)[。.!！\s]*$/i.test(text);
}

function isLossEvidence(ev) {
  if (!ev || ev.status === 'unanswered' || ev.status === 'unselected' || ev.isElectiveUnselected ||
      !hasSubstantiveAnswer(ev.userAnswer)) return false;
  return ev.isCorrect === false ||
    (Number.isFinite(ev.points) && Number.isFinite(ev.maxPoints) && ev.points < ev.maxPoints) ||
    (Number.isFinite(ev.score) && Number.isFinite(ev.maxScore) && ev.score < ev.maxScore);
}

const CARD_FIELDS = ['topic', 'gap', 'memory', 'action', 'check'];

function parseReviewCards(content, expectedRefs, sources = []) {
  const text = String(content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let result;
  try { result = JSON.parse(text); } catch { throw new Error('复习卡片质量检查：必须返回完整 JSON'); }
  if (!Array.isArray(result.cards) || result.cards.length === 0) throw new Error('复习卡片质量检查：缺少有效卡片');
  const covered = new Set();
  const cards = result.cards.map(card => {
    for (const field of CARD_FIELDS) {
      if (typeof card[field] !== 'string' || !card[field].trim() || /[\r\n]/.test(card[field])) {
        throw new Error(`复习卡片质量检查：${field} 缺失或不是单行文本`);
      }
    }
    if (!Array.isArray(card.refs) || !card.refs.length || card.refs.some(ref => !expectedRefs.includes(ref))) {
      throw new Error('复习卡片质量检查：卡片缺少依据或引用了范围外证据');
    }
    card.refs.forEach(ref => covered.add(ref));
    // Reject copied explanation paragraphs, rather than chopping them into a
    // seemingly concise but incomplete version. Necessary formulas stay intact.
    for (const field of ['gap', 'memory', 'action', 'check']) {
      const value = card[field].replace(/\s/g, '');
      if (value.length >= 120 && sources.some(src => String(src || '').replace(/\s/g, '').includes(value))) {
        throw new Error('复习卡片质量检查：卡片照抄了解析段落，需要重新提炼');
      }
    }
    // Multiple source-specific numeric quantities in the rule/action are a
    // concrete sign of replaying the original calculation, not abstraction.
    const numericSource = sources.map(src => String(src || '').replace(/\s/g, '')).join(' ');
    for (const field of ['memory', 'action']) {
      const values = [...new Set((card[field].match(/\d+(?:\.\d+)?\s*(?:bit|MHz|KiB|MB\/s|MiB\/s|K×|片|周期)/gi) || [])
        .map(value => value.replace(/\s/g, '')))];
      const copied = values.filter(value => numericSource.includes(value));
      if (copied.length >= 2) {
        throw new Error(`复习卡片质量检查：【${card.topic}】的 ${field} 复述了原题数值 ${copied.join('、')}。请将该字段改成变量公式或单位判定规则，删除这些原题量值；具体新数值只能放入 check 自测`);
      }
    }
    const publicText = CARD_FIELDS.map(field => card[field]).join(' ');
    if (/(?:https?:\/\/|(?:oq|cg|job|malinkang|ruankao)-[a-z0-9_-]+|爬虫|对账日志|原页|截图已核实)/i.test(publicText)) {
      throw new Error('复习卡片质量检查：正文包含过程信息或内部标识');
    }
    if (/<(?:script|iframe|object|embed|img|svg|style)\b|<[A-Za-z][\w-]*\s+[A-Za-z][\w-]*\s*=/i.test(publicText)) {
      throw new Error('复习卡片质量检查：正文不能包含 HTML 或可执行标记');
    }
    if (/^(?:认真审题|多练习|加强理解|注意检查|检查答案|避免失分)[。！!]*$/.test(card.action.trim()) ||
        card.action.trim() === card.memory.trim()) {
      throw new Error('复习卡片质量检查：防错字段需要具体动作，不能使用套话或重复规则');
    }
    if (!/[（(].+[）)]/.test(card.check)) {
      throw new Error('复习卡片质量检查：自测须包含可核对的括号内答案');
    }
    return Object.fromEntries([...CARD_FIELDS.map(field => [field, card[field].trim()]), ['refs', [...new Set(card.refs)]]]);
  });
  if (expectedRefs.some(ref => !covered.has(ref))) throw new Error('复习卡片质量检查：遗漏了失分依据');
  return cards;
}

function renderReviewCards(cards, chapterName) {
  const raw = cards.map(card =>
    `- 【${card.topic}】待补：${card.gap}；记住：${card.memory}；防错：${card.action}；自测：${card.check}`
  ).join('\n');
  // Plain comparisons such as rear<front and C pointers such as p->next are
  // text, not tags. Protect their angle signs from the legacy HTML stripping
  // regex, which could otherwise swallow several whole cards across lines.
  const text = raw.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<\/?(?:script|iframe|object|embed|img|svg|style|div|span|p|a|button|input)\b(?:\s+[^<>]*)?\s*\/?>/gi, '')
    .replace(/</g, '\uE010').replace(/>/g, '\uE011');
  const result = sanitizeGeneratedMarkdown(text, chapterName);
  const restore = value => value.replace(/\uE010/g, '<').replace(/\uE011/g, '>');
  result.markdown = restore(result.markdown);
  result.points = result.points.map(restore);
  if (cards.length && !result.points.length) throw new Error('复习卡片质量检查：清理后没有有效卡片');
  const unique = new Set(raw.split('\n').map(line => line.replace(/[【】\[\]\s，。；、]/g, '').toLowerCase())).size;
  if (result.points.length !== unique) throw new Error('复习卡片质量检查：格式清理损失了有效卡片，已保留旧版');
  // Every card has a verified rule, action and self-check, so metrics no longer
  // depend on whether arbitrary keywords occur in a generated sentence.
  const count = result.points.length;
  result.summary = { weakPointsCount: count, misconceptionsCount: count, tipsCount: count, checklistsCount: count };
  return result;
}

module.exports = { hasSubstantiveAnswer, isLossEvidence, parseReviewCards, renderReviewCards };
