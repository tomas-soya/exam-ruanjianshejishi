'use strict';

const { GatewayAdapter } = require('../adapter/gateway');
const { detectPromptInjection } = require('../rubric/score-sanitizer');
const { buildPersonalMaterialsPrompt, buildConciseFallbackPrompt, buildReviewConsolidationPrompt } = require('./materials-prompt-builder');
const { isLossEvidence, parseReviewCards, renderReviewCards } = require('./review-cards');

/**
 * Personal Materials Synthesizer (AC-1, AC-2, AC-3)
 * Synthesis of personal concise wrong-question review key points (错题复习要点)
 * using the project's LLM gateway (gemini-3.8-flash-high / deepseek-flash).
 */
class PersonalMaterialsSynthesizer {
  constructor(options = {}) {
    this.gatewayAdapter = options.gatewayAdapter || new GatewayAdapter();
    this.timeoutMs = options.timeoutMs || 45000;
    this.maxRetries = options.maxRetries !== undefined ? options.maxRetries : 2;
    this.batchSize = (typeof options.batchSize === 'number' && options.batchSize > 0) ? options.batchSize : 2;
  }

  _chatCompletion(options) {
    // DeepSeek defaults to thinking mode, where reasoning can consume the
    // whole output budget before any card is emitted. Only material requests
    // opt out; other gateway consumers keep their existing behavior.
    const deepseek = /^deepseek-/i.test(this.gatewayAdapter.model || '');
    return this.gatewayAdapter.chatCompletion({ ...(deepseek ? {
      thinkingMode: 'disabled', responseFormat: { type: 'json_object' }
    } : {}), ...options });
  }

  /**
   * Internal recursive execution of a batch with adaptive subdivision on length truncation.
   * If a batch triggers finish_reason: 'length' / 'max_tokens':
   * 1. If batch contains >= 2 items, recursively bisects the batch into two halves.
   * 2. If batch contains 1 item, falls back to ultra-concise single-item prompt.
   * 3. If the single-item retry still truncates, fail and preserve the previous
   *    version. Partial cards cannot prove complete evidence coverage.
   * @private
   */
  async _executeBatchWithSubdivision({
    chapterName,
    subject,
    evidences,
    accumulatedBulletPoints,
    existingMarkdown,
    referenceTopics,
    signal,
    isFirstBatch,
    depth = 0
  }) {
    if (!evidences || evidences.length === 0) return { rawContent: '', points: [] };
    if (signal?.aborted) {
      const abortErr = new Error('Material synthesis cancelled by user');
      abortErr.name = 'AbortError';
      throw abortErr;
    }

    const { systemPrompt, userPrompt } = buildPersonalMaterialsPrompt({
      chapterName,
      subject,
      answeredEvidences: evidences,
      existingKeyPoints: accumulatedBulletPoints,
      existingMarkdown: isFirstBatch ? existingMarkdown : null,
      referenceTopics,
      batchMode: true
    });

    let response;
    let finishReason;
    try {
      response = await this._chatCompletion({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.2,
        maxTokens: 4096,
        timeoutMs: this.timeoutMs,
        signal
      });

      const choice = response?.raw?.choices?.[0];
      finishReason = response?.finishReason || response?.finish_reason || choice?.finish_reason || choice?.finishReason;
    } catch (callErr) {
      if (callErr.message && /length|max_tokens|truncated/i.test(callErr.message)) {
        finishReason = 'length';
      } else {
        throw callErr;
      }
    }

    const isLengthTruncated = finishReason === 'length' || finishReason === 'max_tokens';

    if (isLengthTruncated) {
      // Strategy 1: If batch contains >= 2 evidences, bisect and process recursively
      if (evidences.length > 1) {
        const mid = Math.ceil(evidences.length / 2);
        const firstHalf = evidences.slice(0, mid);
        const secondHalf = evidences.slice(mid);

        const res1 = await this._executeBatchWithSubdivision({
          chapterName,
          subject,
          evidences: firstHalf,
          accumulatedBulletPoints,
          existingMarkdown,
          referenceTopics,
          signal,
          isFirstBatch,
          depth: depth + 1
        });

        const newPointsFrom1 = res1.points || [];
        const updatedPoints = [...accumulatedBulletPoints, ...newPointsFrom1];

        const res2 = await this._executeBatchWithSubdivision({
          chapterName,
          subject,
          evidences: secondHalf,
          accumulatedBulletPoints: updatedPoints,
          existingMarkdown,
          referenceTopics,
          signal,
          isFirstBatch: false,
          depth: depth + 1
        });

        const combinedRaw = [res1.rawContent, res2.rawContent].filter(Boolean).join('\n\n');
        const allPoints = [...(res1.points || []), ...(res2.points || [])];
        return { rawContent: combinedRaw, points: allPoints, cards: [...res1.cards, ...res2.cards] };
      }

      // Strategy 2: Single evidence truncated -> Fallback to ultra-concise prompt
      const singleEvidence = evidences[0];
      const { systemPrompt: fallbackSys, userPrompt: fallbackUser } = buildConciseFallbackPrompt({
        chapterName,
        evidence: singleEvidence
      });

      const fallbackResponse = await this._chatCompletion({
        messages: [
          { role: 'system', content: fallbackSys },
          { role: 'user', content: fallbackUser }
        ],
        temperature: 0.1,
        maxTokens: 2048,
        timeoutMs: this.timeoutMs,
        signal
      });

      const fbChoice = fallbackResponse?.raw?.choices?.[0];
      const fbFinish = fallbackResponse?.finishReason || fallbackResponse?.finish_reason || fbChoice?.finish_reason || fbChoice?.finishReason;
      const fbContent = fallbackResponse?.content || '';

      if (fbFinish === 'length' || fbFinish === 'max_tokens') {
        throw new Error(`LLM output truncated due to finish_reason: length; aborted to preserve previous version without writing truncated points (AC-4)（大模型单次生成长度达到上限，已中止以保护已有资料）`);
      }

      return this._validateBatchCards(fbContent, evidences, chapterName, fallbackSys, fallbackUser, signal);
    }

    const rawContent = response && response.content ? response.content : '';
    if (!rawContent || rawContent.trim().length === 0) {
      throw new Error('LLM Gateway returned empty content for personal material synthesis');
    }

    return this._validateBatchCards(rawContent, evidences, chapterName, systemPrompt, userPrompt, signal);
  }

  async _validateBatchCards(content, evidences, chapterName, systemPrompt, userPrompt, signal) {
    const refs = evidences.map((ev, index) => ev._reviewRef || `E${index + 1}`);
    const sources = evidences.flatMap(ev => [ev.stem, ev.analysis, ev.feedback]);
    let cards;
    try {
      cards = parseReviewCards(content, refs, sources);
    } catch (error) {
      const response = await this._chatCompletion({
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt },
          { role: 'assistant', content }, { role: 'user', content: `${error.message}。请重新提炼并返回完整 JSON，保留全部失分知识问题和条件。` }],
        temperature: 0.1, maxTokens: 4096, timeoutMs: this.timeoutMs, signal
      });
      this._assertComplete(response);
      cards = parseReviewCards(response.content, refs, sources);
    }
    const rendered = renderReviewCards(cards, chapterName);
    return { cards, rawContent: rendered.markdown, points: rendered.points };
  }

  _assertComplete(response) {
    const reason = response?.finishReason || response?.finish_reason || response?.raw?.choices?.[0]?.finish_reason;
    if (reason === 'length' || reason === 'max_tokens') throw new Error('LLM output truncated due to finish_reason: length; 已保留上一版本资料');
  }

  async _consolidateCards(chapterName, cards, signal) {
    if (cards.length <= 1) return cards;
    const { systemPrompt, userPrompt } = buildReviewConsolidationPrompt({ chapterName, cards });
    let response;
    let merged;
    const refs = cards.map((_, index) => `C${index + 1}`);
    for (let attempt = 0; attempt < 2; attempt++) {
      response = await this._chatCompletion({
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt },
          ...(attempt ? [{ role: 'user', content: '上一轮格式或覆盖检查未通过，请严格返回完整卡片 JSON 并覆盖全部输入 refs。' }] : [])],
        temperature: 0.1, maxTokens: 4096, timeoutMs: this.timeoutMs, signal
      });
      const reason = response?.finishReason || response?.finish_reason || response?.raw?.choices?.[0]?.finish_reason;
      if (reason === 'length' || reason === 'max_tokens') {
        // Preserve complete coverage on large chapters. Both halves already
        // contain complete cards; never salvage a partial JSON response.
        if (cards.length <= 2) this._assertComplete(response);
        const mid = Math.ceil(cards.length / 2);
        return [...await this._consolidateCards(chapterName, cards.slice(0, mid), signal),
          ...await this._consolidateCards(chapterName, cards.slice(mid), signal)];
      }
      try { merged = parseReviewCards(response.content, refs); break; }
      catch (error) { if (attempt === 1) throw error; }
    }
    return merged.map(card => ({ ...card, refs: [...new Set(card.refs.flatMap(ref => cards[Number(ref.slice(1)) - 1].refs))] }));
  }

  async _reviewAgainstEvidence(chapterName, subject, cards, evidences, signal) {
    // Every configured model needs the same source and self-test check.
    // Provider-specific thinking controls stay limited to DeepSeek.
    if (!this.gatewayAdapter.model) return cards;
    const deepseek = /^deepseek-/i.test(this.gatewayAdapter.model);
    if (evidences.length > 3) {
      const reviewed = [];
      for (let index = 0; index < evidences.length; index += 3) {
        const group = evidences.slice(index, index + 3);
        const refs = new Set(group.map(ev => ev._reviewRef));
        const relevant = cards.filter(card => card.refs.some(ref => refs.has(ref)))
          .map(card => ({ ...card, refs: card.refs.filter(ref => refs.has(ref)) }));
        reviewed.push(...await this._reviewAgainstEvidence(chapterName, subject, relevant, group, signal));
      }
      return this._mergeExactTopics(chapterName, reviewed, signal);
    }
    const prompt = buildPersonalMaterialsPrompt({ chapterName, subject, answeredEvidences: evidences });
    const request = {
      messages: [{ role: 'system', content: prompt.systemPrompt + `\n这是最终的来源校验与重写阶段。
把初稿当作待检查材料，不能把它当作事实依据。按原始作答和评分逐项核对：
1. 案例评分明细中 points=maxPoints 的部分必须排除；若一个小问部分得分，只保留明确失分的细节，答对部分不得伪造新盲区。
2. gap 只写实际选答或实际遗漏；解析额外介绍的邻近知识或纠错说明不能独立推断为个人已发生的误解。
3. 每个 check 的答案必须重新推演或计算。排序逐趟模拟并追踪相等元素身份；范式先列全部依赖和候选键；先检查自测条件足以唯一确定答案。
4. 自测不要造与 memory 相矛盾的例子。条件不充分时换成可确定的题，不补造条件。
5. 来源指出题目缺项、参考答案不严谨或条件有争议时，提炼可用规则与适用边界，不机械服从答案字母、不把缺前提的结论说成通用规律。
6. 把同一知识点的重复卡片合并，保留必要的不同条件。整段题解改写为通用记忆规则；只能覆盖真实失分依据，可以删除初稿中无依据卡片。
7. 核对常见定义边界：中文本课程的满二叉树要求每层均满（高度h、结点2^h−1），仅每个非叶结点有两孩子不足；环路复杂度判定数+1仅限均为二分判定；依赖保持看所有子模式投影依赖的合并能否推出原依赖，并不要求每条原依赖在某个单一子模式成立。
8. DFD外部实体按题设系统边界判定，设备也可能是外部实体，不可写成“外部实体永远不能是设备”；类名按业务职责及题设术语确定，不能一律禁止“信息”后缀。按每个空/名称的细分得分判断是否失分，核心意思正确且得满分的表述差异不得列为盲区。
9. 通用规则必须保留量词：3NF 要求每条非平凡依赖 X→A 均满足 X 为超键或 A 为主属性，不能只检查一条依赖就断言满足3NF。gap 不用“认为/混淆/漏乘”等心理或推导诊断代替实际选答。计算规则保留来源中必要的 MB/MiB 等单位边界。
输出仍为完整卡片 JSON，refs 使用证据的 E 编号，不使用 C 编号。` },
        { role: 'user', content: prompt.userPrompt + `\n待核验初稿（不是事实依据）：\n${JSON.stringify({ cards })}` }],
      ...(deepseek ? { thinkingMode: 'enabled', reasoningEffort: 'low', responseFormat: { type: 'json_object' } } : {}),
      temperature: 0.1, maxTokens: 8192, timeoutMs: Math.max(this.timeoutMs, 90000), signal
    };
    let response = await this._chatCompletion(request);
    const reason = response?.finishReason || response?.finish_reason || response?.raw?.choices?.[0]?.finish_reason;
    if (reason === 'length' || reason === 'max_tokens') {
      if (evidences.length > 1) {
        const mid = Math.ceil(evidences.length / 2);
        const reviewed = [];
        for (const group of [evidences.slice(0, mid), evidences.slice(mid)]) {
          const refs = new Set(group.map(ev => ev._reviewRef));
          const relevant = cards.filter(card => card.refs.some(ref => refs.has(ref)))
            .map(card => ({ ...card, refs: card.refs.filter(ref => refs.has(ref)) }));
          reviewed.push(...await this._reviewAgainstEvidence(chapterName, subject, relevant, group, signal));
        }
        return reviewed;
      }
      response = await this._chatCompletion({ ...request, maxTokens: 16384 });
    }
    this._assertComplete(response);
    return parseReviewCards(response.content, evidences.map(ev => ev._reviewRef), evidences.flatMap(ev => [ev.stem, ev.analysis, ev.feedback]));
  }

  /**
   * Merges repeated topics while retaining a verified self-test and all evidence refs.
   */
  async _mergeExactTopics(chapterName, cards, signal) {
    const groups = new Map();
    for (const card of cards) {
      const key = card.topic.replace(/[\s【】（）()]/g, '').toLowerCase();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(card);
    }
    const merged = [];
    for (const group of groups.values()) {
      if (group.length === 1) { merged.push(group[0]); continue; }
      const signature = card => JSON.stringify(['gap', 'memory', 'action', 'check'].map(field => card[field]));
      if (group.every(card => signature(card) === signature(group[0]))) {
        merged.push({ ...group[0], refs: [...new Set(group.flatMap(card => card.refs))] });
        continue;
      }
      const prompt = buildReviewConsolidationPrompt({ chapterName, cards: group });
      const response = await this._chatCompletion({
        messages: [{ role: 'system', content: prompt.systemPrompt + `\n只合并这个相同知识点，完整保留不同适用条件和检查动作；必须输出一张卡片。
自测必须从输入任选一个，check 字段逐字保留，不改题目和答案、不新造算例。
规则边界不得弱化；环路复杂度“判定数+1”仅在判定均为二分分支时成立。` },
          { role: 'user', content: prompt.userPrompt }],
        temperature: 0.1, maxTokens: 4096, timeoutMs: this.timeoutMs, signal
      });
      this._assertComplete(response);
      const result = parseReviewCards(response.content, group.map((_, index) => `C${index + 1}`));
      if (result.length !== 1 || !group.some(card => card.check === result[0].check)) {
        throw new Error('复习卡片质量检查：同考点归并不能新增未经核对的自测');
      }
      merged.push({ ...result[0], refs: [...new Set(group.flatMap(card => card.refs))] });
    }
    return merged;
  }

  /** Computes next Ebbinghaus review interval based on mastery progression. */
  computeEbbinghausSchedule(currentSchedule = null, hasErrors = true) {
    const INTERVAL_DAYS = [1, 2, 4, 7, 15];
    const now = new Date();

    let stage = 1;
    if (!hasErrors && currentSchedule && typeof currentSchedule.stage === 'number') {
      stage = Math.min(currentSchedule.stage + 1, INTERVAL_DAYS.length);
    } else {
      stage = 1;
    }

    const intervalDays = INTERVAL_DAYS[stage - 1] || 1;
    const nextReview = new Date(now.getTime() + intervalDays * 24 * 60 * 60 * 1000);

    return {
      nextReviewAt: nextReview.toISOString(),
      stage,
      intervalDays,
      isDue: false
    };
  }

  /**
   * Synthesizes personal chapter concise review key points from actual exam answers.
   * 
   * @param {object} params
   * @param {string} params.chapterKey
   * @param {string} params.chapterName
   * @param {'objective' | 'case'} [params.subject='objective']
   * @param {Array<object>} params.answeredEvidences
   * @param {string} [params.existingMarkdown]
   * @param {object} [params.existingMetadata]
   * @param {string} [params.referenceTopics]
   * @returns {Promise<{ markdown: string, summary: object, ebbinghaus: object, metadata: object }>}
   */
  async synthesizeChapterMaterial({
    chapterKey,
    chapterName,
    subject = 'objective',
    answeredEvidences = [],
    existingMarkdown = null,
    existingMetadata = null,
    referenceTopics = '',
    signal = null
  }) {
    if (!chapterKey || !chapterName) {
      throw new Error('Chapter key and name are required for personal material synthesis');
    }

    if (!Array.isArray(answeredEvidences) || answeredEvidences.length === 0) {
      throw new Error('No answered question evidences provided for chapter material synthesis');
    }
    if (signal?.aborted) {
      const error = new Error('Material synthesis cancelled by user');
      error.name = 'AbortError';
      throw error;
    }

    // Check for adversarial prompt injection in student answers
    let promptInjectionDetected = false;
    const cleanEvidences = answeredEvidences.map(ev => {
      let ansStr = '';
      if (typeof ev.userAnswer === 'object' && ev.userAnswer !== null) {
        ansStr = JSON.stringify(ev.userAnswer);
      } else {
        ansStr = String(ev.userAnswer || '');
      }

      const injectionCheck = detectPromptInjection(ansStr);
      if (injectionCheck && injectionCheck.isInjection) {
        promptInjectionDetected = true;
        return {
          ...ev,
          userAnswer: '[系统检测到异常注入指令，已安全脱敏]'
        };
      }
      return ev;
    });

    // AC-1, AC-3: Filter only real wrong questions and lost-point case questions
    const wrongEvidences = cleanEvidences.filter(isLossEvidence);

    // AC-3: Accumulate and merge with historical wrong question evidences to prevent newer payload from overwriting previous points
    const existingRetained = Array.isArray(existingMetadata?.retainedEvidences) ? existingMetadata.retainedEvidences : [];
    const evidenceMap = new Map();
    for (const ev of existingRetained) {
      if (ev && ev.questionId && isLossEvidence(ev)) {
        evidenceMap.set(ev.questionId, ev);
      }
    }
    for (const ev of wrongEvidences) {
      if (ev && ev.questionId) {
        evidenceMap.set(ev.questionId, ev);
      } else if (ev) {
        evidenceMap.set(`ev_${evidenceMap.size}`, ev);
      }
    }
    // AC-F2: Corrected or full-score items in answered evidences must not remain as loss evidence
    for (const ev of cleanEvidences) {
      if (ev && ev.questionId) {
        const isWrong = isLossEvidence(ev);
        if (!isWrong) {
          evidenceMap.delete(ev.questionId);
        }
      }
    }
    const allWrongEvidences = Array.from(evidenceMap.values()).map((ev, index) => ({ ...ev, _reviewRef: `E${index + 1}` }));

    const hasErrors = allWrongEvidences.length > 0;
    const ebbinghaus = this.computeEbbinghausSchedule(existingMetadata?.ebbinghaus, hasErrors);

    const referencedQuestionIds = Array.from(new Set([
      ...(existingMetadata?.referencedQuestionIds || []),
      ...answeredEvidences.map(e => e.questionId).filter(Boolean)
    ]));

    // AC-1, AC-3: If 100% correct and no retained wrong points, do NOT create new weak points
    if (!hasErrors) {
      const emptyTitle = `# 【错题复习要点】${chapterName}`;
      const emptyMarkdown = `${emptyTitle}\n\n（暂无有实质作答依据的待巩固知识点）`;
      const existingSummary = {
        weakPointsCount: 0,
        misconceptionsCount: 0,
        tipsCount: 0,
        checklistsCount: 0
      };

      const metadata = {
        chapterKey,
        chapterName,
        subject,
        referencedQuestionIds,
        totalQuestionsAnalyzed: referencedQuestionIds.length,
        lastEvidenceCount: answeredEvidences.length,
        hasErrorsInLastSession: false,
        promptInjectionDetected,
        ebbinghaus,
        summary: existingSummary,
        retainedEvidences: [],
        synthesizedAt: new Date().toISOString()
      };

      return {
        markdown: emptyMarkdown,
        summary: existingSummary,
        ebbinghaus,
        metadata
      };
    }

    const batchSize = (typeof this.batchSize === 'number' && this.batchSize > 0) ? this.batchSize : 2;
    const batches = [];
    for (let i = 0; i < allWrongEvidences.length; i += batchSize) {
      batches.push(allWrongEvidences.slice(i, i + batchSize));
    }

    const collectedCards = [];
    const accumulatedBulletPoints = [];

    for (let bIndex = 0; bIndex < batches.length; bIndex++) {
      if (signal?.aborted) {
        const abortErr = new Error('Material synthesis cancelled by user');
        abortErr.name = 'AbortError';
        throw abortErr;
      }

      const batchResult = await this._executeBatchWithSubdivision({
        chapterName,
        subject,
        evidences: batches[bIndex],
        accumulatedBulletPoints,
        existingMarkdown,
        referenceTopics,
        signal,
        isFirstBatch: bIndex === 0
      });

      collectedCards.push(...batchResult.cards);
      accumulatedBulletPoints.push(...batchResult.points);
    }

    let reviewCards = await this._consolidateCards(chapterName, collectedCards, signal);
    reviewCards = await this._reviewAgainstEvidence(chapterName, subject, reviewCards, allWrongEvidences, signal);
    reviewCards = await this._mergeExactTopics(chapterName, reviewCards, signal);
    const { markdown, summary } = renderReviewCards(reviewCards, chapterName);

    const metadata = {
      chapterKey,
      chapterName,
      subject,
      referencedQuestionIds,
      totalQuestionsAnalyzed: referencedQuestionIds.length,
      lastEvidenceCount: answeredEvidences.length,
      hasErrorsInLastSession: true,
      promptInjectionDetected,
      ebbinghaus,
      summary,
      retainedEvidences: allWrongEvidences,
      reviewCards,
      formatVersion: 'review-cards-v1',
      synthesizedAt: new Date().toISOString()
    };

    return {
      markdown,
      summary,
      ebbinghaus,
      metadata
    };
  }
}

module.exports = {
  PersonalMaterialsSynthesizer
};
