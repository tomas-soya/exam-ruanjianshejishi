'use strict';

const { GatewayAdapter } = require('../adapter/gateway');
const { LocalMaterialRetriever } = require('./retriever');
const { buildChatSystemPrompt, buildUserContextMessage } = require('./prompt-builder');
const {
  validateChatRequest,
  sanitizeMarkdownContent,
  ensurePureUnicodeFormulas
} = require('../contracts');

const DEFAULT_CHAT_TIMEOUT_MS = 30000;
const MIN_CHAT_TIMEOUT_MS = 1000;
const MAX_CHAT_TIMEOUT_MS = 120000;

function resolveChatTimeoutMs(val) {
  if (val === undefined || val === null || val === '') {
    val = process.env.CHAT_TIMEOUT_MS;
  }
  const parsed = typeof val === 'number' ? val : parseInt(val, 10);
  if (Number.isFinite(parsed) && parsed >= MIN_CHAT_TIMEOUT_MS && parsed <= MAX_CHAT_TIMEOUT_MS) {
    return parsed;
  }
  return DEFAULT_CHAT_TIMEOUT_MS;
}

/**
 * Ruankao Exam AI Chat Assistant Service (AC-Q1..Q5)
 */
class ExamChatService {
  /**
   * @param {object} [options]
   * @param {GatewayAdapter} [options.gateway]
   * @param {LocalMaterialRetriever} [options.retriever]
   * @param {number} [options.timeoutMs=30000] Default application timeout budget (30s empirical budget based on 23.3s measurement)
   */
  constructor(options = {}) {
    this.gateway = options.gateway || new GatewayAdapter();
    this.retriever = options.retriever || new LocalMaterialRetriever();
    this.timeoutMs = resolveChatTimeoutMs(options.timeoutMs !== undefined ? options.timeoutMs : process.env.CHAT_TIMEOUT_MS);
  }

  /**
   * Executes AI chat assistant completion.
   * 
   * @param {object} params
   * @param {import('../contracts').ExamChatContext} params.context
   * @param {string} params.userMessage
   * @param {Array<import('../contracts').ExamChatMessage>} [params.history]
   * @param {AbortSignal} [params.signal] Cascade cancellation signal
   * @param {number} [params.timeoutMs]
   * @returns {Promise<import('../contracts').ExamChatResponse>}
   */
  async chat({
    context,
    userMessage,
    history = [],
    signal = null,
    timeoutMs = this.timeoutMs
  }) {
    const effectiveTimeoutMs = resolveChatTimeoutMs(timeoutMs);
    // 1. Validate request contracts and limits (500 chars limit) (AC-Q4)
    validateChatRequest({ context, userMessage, history });

    // Check cancellation before initiating work
    if (signal?.aborted) {
      const abortErr = new Error('Chat request cancelled by user');
      abortErr.name = 'AbortError';
      throw abortErr;
    }

    // 2. Local Keyword & Anchor Retrieval across 21 Canonical Chapters (AC-Q3)
    const { citedAnchors, contextSnippet, isSufficient } = this.retriever.retrieve({
      query: userMessage,
      context
    });

    // 3. Assemble Prompt & History (AC-Q4)
    const messages = [
      {
        role: 'system',
        content: buildChatSystemPrompt()
      }
    ];

    // Include recent history (max 10 items)
    if (Array.isArray(history)) {
      const recentHistory = history.slice(-10);
      for (const msg of recentHistory) {
        if (msg && typeof msg.content === 'string' && (msg.role === 'user' || msg.role === 'assistant')) {
          messages.push({
            role: msg.role,
            content: msg.content.slice(0, 1000)
          });
        }
      }
    }

    // Current turn user message with isolated context and retrieval snippets
    messages.push({
      role: 'user',
      content: buildUserContextMessage(context, userMessage, contextSnippet)
    });

    // 4. Invoke LLM Gateway with cancellation signal & 30s timeout budget (AC-Q5)
    let completion;
    try {
      completion = await this.gateway.chatCompletion({
        messages,
        timeoutMs: effectiveTimeoutMs,
        signal,
        temperature: 0.2,
        maxTokens: 2048
      });
    } catch (err) {
      // Propagate AbortError cleanly without modification
      if (signal?.aborted || err.name === 'AbortError' || err.message.includes('abort') || err.message.includes('cancelled')) {
        const abortErr = new Error('Chat request cancelled by user');
        abortErr.name = 'AbortError';
        throw abortErr;
      }
      throw err;
    }

    // 5. Sanitize Model Output (No XSS, Pure Unicode Formulas) (AC-Q4)
    const rawContent = completion.content || '';
    let cleanReply = sanitizeMarkdownContent(rawContent);
    cleanReply = ensurePureUnicodeFormulas(cleanReply);

    // If local materials did not have direct matches, clarify with notice
    if (!isSufficient && cleanReply.length > 0) {
      cleanReply = `> 💡 **考点索引说明**：本地复习资料未检索到完全匹配的考点小节，以下根据国家软考大纲知识回答：\n\n${cleanReply}`;
    }

    // 6. Verify and filter valid anchors (AC-Q3)
    const verifiedAnchors = citedAnchors.filter(a => this.retriever.isValidAnchor(a.docPath, a.heading));

    return {
      replyText: cleanReply,
      citedAnchors: verifiedAnchors,
      tokenUsage: completion.usage || null,
      isSufficient
    };
  }
}

module.exports = {
  ExamChatService,
  resolveChatTimeoutMs,
  DEFAULT_CHAT_TIMEOUT_MS,
  MIN_CHAT_TIMEOUT_MS,
  MAX_CHAT_TIMEOUT_MS
};
