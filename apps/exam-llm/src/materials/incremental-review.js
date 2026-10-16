'use strict';

const { createHash } = require('node:crypto');
const { isLossEvidence, parseReviewCards, renderReviewCards } = require('./review-cards');
const ENGINE_VERSION = 'loss-units-v2-20261014';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function topicHint(detail) {
  if (/abstract|抽象方法|返回(?:值)?类型/.test(detail)) return '抽象方法声明与签名';
  if (/List<|ArrayList<|泛型|容器/.test(detail)) return '组合模式子构件容器声明';
  if (/构造(?:方法|函数)|new CompositeGraphic/.test(detail)) return '带参构造方法与对象实例化';
  if (/radius/.test(detail)) return '组合模式公共属性声明';
  if (/签证.*属性|实体所包含的属性/.test(detail)) return '新增实体的概念模型属性补齐';
  if (/主键|主码|外键|外码/.test(detail)) return '关系模式主外键的完整表达';
  if (/extend|扩展用例/.test(detail)) return '用例扩展关系与可选功能识别';
  return null;
}

// Keep every scored subquestion (and every explicitly scored code blank) separate.
// A group-level E reference must never stand in for several independent losses.
function lossUnits(evidences, subject) {
  const units = [];
  for (const ev of evidences) {
    if (!isLossEvidence(ev)) continue;
    const parts = [];
    if (subject === 'case' && Array.isArray(ev.breakdown) && ev.breakdown.length) {
      ev.breakdown.forEach((row, index) => {
        const points = row.points ?? row.score;
        const max = row.maxPoints ?? row.max_points ?? row.maxScore;
        if (Number.isFinite(points) && Number.isFinite(max) && points >= max) return;
        const reason = String(row.reason || row.feedback || '');
        const blanks = reason.split(/(?:^|\n|[；;])\s*(?=(?:空\s*)?[（(](?:\d+|[a-z])[）)])/).filter(Boolean);
        const fullBlank = text => /^(?:空\s*)?[（(](?:\d+|[a-z])[）)]\s*正确/.test(text) ||
          (/(?:正确|等价)[^；;。]*(?:得\s*\d|满分)/.test(text) && !/错误|部分正确|扣|不得分|未|遗漏|缺/.test(text));
        const fragments = blanks.length > 1 ? blanks.filter(text => !fullBlank(text)) : [reason];
        fragments.forEach((text, blank) => parts.push({ key: `s${row.subQuestionIndex ?? index + 1}b${blank + 1}`,
          title: row.subQuestionTitle || `小问 ${index + 1}`, detail: text, points, maxPoints: max }));
      });
    } else if (subject === 'case' && ev.feedback) {
      // Older grades may have only feedback. Do not invent psychological diagnoses
      // or infer a loss from the reference explanation's neighbouring knowledge.
      String(ev.feedback).split(/[。；;]/).filter(text => /错误|误判|误答|遗漏|漏写|未能|未明确|未使用|缺少|欠缺|不足|不完整/.test(text))
        .forEach((text, index) => parts.push({ key: `f${index + 1}`, title: '评分指出的待补项', detail: text }));
    }
    if (!parts.length) {
      // Explicitly full-score subquestions cannot become a new learning gap.
      if (subject === 'case' && Array.isArray(ev.breakdown) && ev.breakdown.length) continue;
      parts.push({ key: 'answer', title: '作答差异', detail: ev.feedback || '' });
    }
    for (const part of parts) {
      if (subject === 'case') part.topicHint = topicHint(part.detail);
      const unit = { ...ev, lossUnit: part, breakdown: undefined, _reviewRef: `E${units.length + 1}`,
        ...(subject === 'case' ? { reviewScope: 'scoring-unit', feedback: part.detail } : {}) };
      const key = `${ev.questionId || hash(ev)}:${part.key}`;
      units.push({ key, evidence: unit });
    }
  }
  return units;
}

async function mapLimited(items, limit, fn) {
  const results = new Array(items.length);
  let index = 0;
  // Wait for active workers even when one fails: never leave background writes
  // running after the caller has closed its database or reported failure.
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const i = index++;
      try { results[i] = { value: await fn(items[i], i) }; }
      catch (error) { results[i] = { error }; }
    }
  });
  await Promise.all(workers);
  const failed = results.find(result => result.error);
  if (failed) throw failed.error;
  return results.map(result => result.value);
}

function mergeIdentical(cards) {
  const result = new Map();
  for (const card of cards) {
    const key = JSON.stringify(['topic', 'gap', 'memory', 'action', 'check'].map(field => card[field]));
    if (!result.has(key)) result.set(key, { ...card, refs: [] });
    result.get(key).refs.push(...card.refs);
  }
  return [...result.values()].map(card => ({ ...card, refs: [...new Set(card.refs)] }));
}

async function synthesizeIncremental(synth, params) {
  const { chapterKey, chapterName, subject, evidences, existingMetadata, signal, onCheckpoint, ebbinghaus,
    referencedQuestionIds, promptInjectionDetected } = params;
  const started = Date.now();
  const telemetry = { calls: 0, requestMs: 0, usage: null, cachedUnits: 0, generatedUnits: 0, stages: {} };
  return synth.requestContext.run({ telemetry }, async () => {
    const units = lossUnits(evidences, subject);
    const model = synth.gatewayAdapter.model || 'custom';
    const oldCache = existingMetadata?.evidenceCache || {};
    const cache = {};
    const changed = [];
    for (const unit of units) {
      const { _reviewRef, ...input } = unit.evidence;
      unit.fingerprint = hash({ version: ENGINE_VERSION, scope: subject === 'case' ? 'scoped-v3' : undefined, chapterKey, model, input });
    }
    const fingerprints = new Map(units.map(unit => [unit.key, unit.fingerprint]));
    for (const unit of units) {
      const saved = oldCache[unit.key];
      if (saved?.fingerprint === unit.fingerprint && saved.dependencies &&
          Object.entries(saved.dependencies).every(([key, fingerprint]) => fingerprints.get(key) === fingerprint)) {
        // Check even persisted caches against the current card contract.
        parseReviewCards(JSON.stringify({ cards: saved.cards.map(card => ({ ...card, refs: ['E1'] })) }), ['E1']);
        cache[unit.key] = saved;
        telemetry.cachedUnits++;
      } else changed.push(unit);
    }
    const batches = [];
    for (const unit of changed) {
      let last = batches.at(-1);
      const source = unit.evidence.questionId || unit.key;
      const contextSize = JSON.stringify(unit.evidence).length;
      const unitSize = JSON.stringify(unit.evidence.lossUnit).length + 200;
      const size = subject === 'case' && last?.sources.has(source) ? unitSize : contextSize;
      const batchLimit = subject === 'case' ? Math.max(3, synth.batchSize) : synth.batchSize;
      if (!last || last.units.length >= batchLimit || last.size + size > 18000) {
        last = { units: [], size: 0, sources: new Set() }; batches.push(last);
      }
      last.units.push(unit); last.size += last.sources.has(source) && subject === 'case' ? unitSize : contextSize;
      last.sources.add(source);
    }
    await mapLimited(batches, synth.concurrency, async batch => {
      if (signal?.aborted) throw signal.reason || new Error('Material synthesis cancelled');
      const batchEvidence = batch.units.map(unit => unit.evidence);
      const draft = await synth.requestContext.run({ telemetry, stage: 'extract' }, () => synth._executeBatchWithSubdivision({
        chapterName, subject, evidences: batchEvidence, accumulatedBulletPoints: [], signal, isFirstBatch: true
      }));
      const cards = await synth.requestContext.run({ telemetry, stage: 'sourceReview' }, () =>
        synth._reviewAgainstEvidence(chapterName, subject, draft.cards, batchEvidence, signal));
      parseReviewCards(JSON.stringify({ cards }), batchEvidence.map(ev => ev._reviewRef));
      for (const unit of batch.units) {
        const ownCards = cards.filter(card => card.refs.includes(unit.evidence._reviewRef));
        const refs = new Set(ownCards.flatMap(card => card.refs));
        const item = { fingerprint: unit.fingerprint,
          dependencies: Object.fromEntries(batch.units.filter(peer => refs.has(peer.evidence._reviewRef)).map(peer => [peer.key, peer.fingerprint])),
          cards: ownCards
          .map(card => ({ ...card, refs: ['E1'] })) };
        cache[unit.key] = item;
        telemetry.generatedUnits++;
        if (onCheckpoint) await onCheckpoint(unit.key, item);
      }
    });
    let cards = mergeIdentical(units.flatMap(unit => cache[unit.key].cards.map(card => ({ ...card, refs: [unit.evidence._reviewRef] }))));
    // Only topics affected by changed input need semantic merging. Exact matches
    // are deterministic; re-running an unchanged chapter makes zero requests.
    if (changed.length) cards = await synth.requestContext.run({ telemetry, stage: 'topicMerge' }, () =>
      synth._mergeExactTopics(chapterName, cards, signal));
    if (units.length) parseReviewCards(JSON.stringify({ cards }), units.map(unit => unit.evidence._reviewRef));
    const rendered = renderReviewCards(cards, chapterName);
    telemetry.wallMs = Date.now() - started;
    const unchanged = changed.length === 0 && existingMetadata?.engineVersion === ENGINE_VERSION &&
      hash(existingMetadata.coverage?.map(item => item.key) || []) === hash(units.map(unit => unit.key));
    // Reuse the already checked merged prose, not just its source-level pieces.
    if (unchanged && existingMetadata.reviewCards) {
      cards = existingMetadata.reviewCards;
      Object.assign(rendered, renderReviewCards(cards, chapterName));
    }
    return { markdown: rendered.markdown, summary: rendered.summary, ebbinghaus, unchanged, telemetry,
      metadata: { chapterKey, chapterName, subject, referencedQuestionIds, totalQuestionsAnalyzed: referencedQuestionIds.length,
        lastEvidenceCount: evidences.length, hasErrorsInLastSession: units.length > 0,
        retainedEvidences: evidences, reviewCards: cards, evidenceCache: cache, formatVersion: 'review-cards-v1',
        engineVersion: ENGINE_VERSION, coverage: units.map(unit => ({ key: unit.key, ref: unit.evidence._reviewRef,
          questionId: unit.evidence.questionId, lossUnit: unit.evidence.lossUnit })),
        telemetry, ebbinghaus, promptInjectionDetected, summary: rendered.summary, synthesizedAt: new Date().toISOString() } };
  });
}

module.exports = { ENGINE_VERSION, lossUnits, mapLimited, synthesizeIncremental };
