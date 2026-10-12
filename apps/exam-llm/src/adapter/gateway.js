'use strict';

const { loadRuntimeConfig, maskApiKey, sanitizeLogMessage } = require('./env-loader');

/**
 * OpenAI-Compatible LLM Gateway Adapter
 * 
 * Supports:
 * - User-configured OpenAI-compatible endpoint and model
 * - Timeout handling and cancellation (AbortController)
 * - Transient error retries
 * - Structured JSON parsing and response schema extraction
 * - Redacted logging with zero credential leakage
 */
class GatewayAdapter {
  constructor(options = {}) {
    const runtimeConfig = loadRuntimeConfig();
    this.endpoint = options.endpoint || runtimeConfig.endpoint;
    this.model = options.model || runtimeConfig.model;
    this.apiKey = options.apiKey !== undefined ? options.apiKey : runtimeConfig.apiKey;
    this.timeoutMs = options.timeoutMs || runtimeConfig.timeoutMs;
    this.maxRetries = options.maxRetries !== undefined ? options.maxRetries : 2;
    this.fetchFn = options.fetchFn || globalThis.fetch;
  }

  /**
   * Dynamically updates runtime configuration on this adapter instance.
   * @param {object} config
   * @param {string} [config.endpoint]
   * @param {string} [config.apiKey]
   * @param {string} [config.model]
   * @param {number} [config.timeoutMs]
   */
  updateConfig(config = {}) {
    if (config.endpoint) {
      this.endpoint = config.endpoint.replace(/\/+$/, '');
    }
    if (config.apiKey !== undefined) {
      this.apiKey = config.apiKey;
    }
    if (config.model) {
      this.model = config.model;
    }
    if (typeof config.timeoutMs === 'number' && config.timeoutMs > 0) {
      this.timeoutMs = config.timeoutMs;
    }
  }

  /**
   * Health check to test if gateway is online and responding.
   * @param {number} [timeoutMs=3000]
   * @returns {Promise<boolean>}
   */
  async isAvailable(timeoutMs = 3000) {
    const res = await this.testConnection({ timeoutMs });
    return res.ok;
  }

  /**
   * Tests connectivity and authentication to the target endpoint.
   * @param {object} [options]
   * @param {string} [options.endpoint]
   * @param {string} [options.apiKey]
   * @param {string} [options.model]
   * @param {number} [options.timeoutMs=5000]
   * @returns {Promise<{ ok: boolean, latencyMs: number, status?: number, message: string, error?: string, modelCount?: number }>}
   */
  async testConnection(options = {}) {
    const endpoint = (options.endpoint || this.endpoint || '').replace(/\/+$/, '');
    const apiKey = options.apiKey !== undefined ? options.apiKey : this.apiKey;
    const model = options.model || this.model || '';
    const timeoutMs = options.timeoutMs || 5000;

    if (!endpoint) {
      return { ok: false, latencyMs: 0, message: '未配置 API 接口地址', error: 'Endpoint URL is required' };
    }

    const startTime = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`Connection test timed out after ${timeoutMs}ms`)), timeoutMs);

    try {
      // 1. First probe GET /models
      const modelsUrl = `${endpoint}/models`;
      const headers = { 'Accept': 'application/json' };
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      const res = await this.fetchFn(modelsUrl, {
        method: 'GET',
        headers,
        signal: controller.signal
      });

      const latencyMs = Date.now() - startTime;

      if (res.status >= 200 && res.status < 300) {
        let modelCount = 0;
        try {
          const body = await res.json();
          const list = Array.isArray(body) ? body : (Array.isArray(body.data) ? body.data : []);
          modelCount = list.length;
        } catch {
          // ignore parse error if 200 OK
        }
        return {
          ok: true,
          latencyMs,
          status: res.status,
          modelCount,
          message: `连接成功 (耗时 ${latencyMs}ms${modelCount > 0 ? `，已发现 ${modelCount} 个可用模型` : ''})`
        };
      }

      if (res.status === 401 || res.status === 403) {
        const errText = await res.text().catch(() => '');
        return {
          ok: false,
          latencyMs,
          status: res.status,
          error: `认证失败 (HTTP ${res.status}): API 密钥无效或未授权。${sanitizeLogMessage(errText).slice(0, 150)}`,
          message: `认证失败 (HTTP ${res.status})`
        };
      }

      // If /models returned 404, some custom proxies only route /chat/completions. Try lightweight completion test.
      if (res.status === 404) {
        const chatUrl = `${endpoint}/chat/completions`;
        const testRes = await this.fetchFn(chatUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {})
          },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: 'hi' }],
            max_tokens: 1
          }),
          signal: controller.signal
        });

        const chatLatencyMs = Date.now() - startTime;
        if (testRes.status >= 200 && testRes.status < 300) {
          return {
            ok: true,
            latencyMs: chatLatencyMs,
            status: testRes.status,
            message: `连接成功 (耗时 ${chatLatencyMs}ms，/chat/completions 通畅)`
          };
        }

        const chatErrText = await testRes.text().catch(() => '');
        return {
          ok: false,
          latencyMs: chatLatencyMs,
          status: testRes.status,
          error: `网关响应异常 (HTTP ${testRes.status}): ${sanitizeLogMessage(chatErrText).slice(0, 200)}`,
          message: `网关响应异常 (HTTP ${testRes.status})`
        };
      }

      const errText = await res.text().catch(() => '');
      return {
        ok: false,
        latencyMs,
        status: res.status,
        error: `网关返回 HTTP ${res.status}: ${sanitizeLogMessage(errText).slice(0, 200)}`,
        message: `HTTP ${res.status}`
      };
    } catch (err) {
      const latencyMs = Date.now() - startTime;
      const isTimeout = err.name === 'AbortError' || (err.message && err.message.includes('timed out'));
      const cleanMsg = isTimeout ? `连接超时 (超过 ${timeoutMs}ms 未响应)` : sanitizeLogMessage(err.message || '网络连接失败');
      return {
        ok: false,
        latencyMs,
        error: cleanMsg,
        message: cleanMsg
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Fetches available model IDs from the endpoint /models.
   * @param {object} [options]
   * @param {string} [options.endpoint]
   * @param {string} [options.apiKey]
   * @param {number} [options.timeoutMs=8000]
   * @returns {Promise<Array<string>>}
   */
  async listModels(options = {}) {
    const endpoint = (options.endpoint || this.endpoint || '').replace(/\/+$/, '');
    const apiKey = options.apiKey !== undefined ? options.apiKey : this.apiKey;
    const timeoutMs = options.timeoutMs || 8000;

    if (!endpoint) {
      throw new Error('未配置 API 接口地址');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`Model query timed out after ${timeoutMs}ms`)), timeoutMs);

    try {
      const url = `${endpoint}/models`;
      const headers = { 'Accept': 'application/json' };
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      const res = await this.fetchFn(url, {
        method: 'GET',
        headers,
        signal: controller.signal
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`查询模型列表失败 (HTTP ${res.status}): ${sanitizeLogMessage(errText).slice(0, 200)}`);
      }

      const data = await res.json();
      const rawList = Array.isArray(data) ? data : (Array.isArray(data.data) ? data.data : []);

      const modelIds = rawList
        .map(item => (typeof item === 'string' ? item : item.id))
        .filter(id => Boolean(id) && typeof id === 'string')
        .sort((a, b) => a.localeCompare(b));

      return modelIds;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Executes a chat completion request with timeout and retries.
   * 
   * @param {object} params
   * @param {Array<{role: string, content: string}>} params.messages
   * @param {string} [params.model]
   * @param {number} [params.temperature=0.1]
   * @param {number} [params.maxTokens=4096]
   * @param {number} [params.timeoutMs]
   * @param {object} [params.responseFormat]
   * @param {AbortSignal} [params.signal]
   * @returns {Promise<{content: string, raw: object, usage?: object}>}
   */
  async chatCompletion({
    messages,
    model = this.model,
    temperature = 0.1,
    maxTokens = 4096,
    timeoutMs = this.timeoutMs,
    responseFormat = null,
    signal = null
  }) {
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error('GatewayAdapter: messages array must not be empty');
    }
    if (!this.endpoint || !model) throw new Error('请先在设置中配置 AI 接口地址和模型名称');

    const requestBody = {
      model,
      messages,
      temperature,
      max_tokens: maxTokens
    };

    if (responseFormat) {
      requestBody.response_format = responseFormat;
    }

    let lastError = null;
    const attempts = Math.max(1, this.maxRetries + 1);

    for (let attempt = 1; attempt <= attempts; attempt++) {
      const controller = new AbortController();
      let timer = null;

      const combinedSignal = signal ? this._combineSignals(signal, controller.signal) : controller.signal;

      if (timeoutMs > 0) {
        timer = setTimeout(() => controller.abort(new Error(`Gateway request timed out after ${timeoutMs}ms`)), timeoutMs);
      }

      try {
        const url = `${this.endpoint}/chat/completions`;
        const headers = {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        };

        if (this.apiKey) {
          headers['Authorization'] = `Bearer ${this.apiKey}`;
        }

        const res = await this.fetchFn(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(requestBody),
          signal: combinedSignal
        });

        if (!res.ok) {
          const status = res.status;
          const errText = await res.text().catch(() => '');
          const sanitizedErr = sanitizeLogMessage(errText);

          // Retry on 5xx or 429
          if ((status >= 500 || status === 429) && attempt < attempts) {
            await new Promise(r => setTimeout(r, attempt * 500));
            continue;
          }

          throw new Error(`Gateway returned HTTP ${status}: ${sanitizedErr.slice(0, 300)}`);
        }

        const data = await res.json();
        const choice = data.choices && data.choices[0];
        const content = choice?.message?.content || '';

        return {
          content,
          raw: data,
          usage: data.usage || null
        };
      } catch (err) {
        lastError = err;
        // Do not retry on explicit cancellation
        if (signal?.aborted) {
          throw err;
        }

        if (attempt < attempts) {
          await new Promise(r => setTimeout(r, attempt * 500));
          continue;
        }
      } finally {
        if (timer) clearTimeout(timer);
      }
    }

    const safeMessage = sanitizeLogMessage(lastError ? lastError.message : 'Unknown gateway error');
    throw new Error(`GatewayAdapter request failed: ${safeMessage}`);
  }

  /**
   * Safely extracts and parses JSON from model output.
   * Handles markdown code fences and cleans whitespace.
   * 
   * @param {string} rawText
   * @returns {any}
   */
  parseStructuredJson(rawText) {
    if (!rawText || typeof rawText !== 'string') {
      throw new Error('Cannot parse empty or non-string response as JSON');
    }

    let cleaned = rawText.trim();

    // Check for markdown code fence
    const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (codeBlockMatch && codeBlockMatch[1]) {
      cleaned = codeBlockMatch[1].trim();
    } else {
      // Find outermost JSON object or array
      const firstCurly = cleaned.indexOf('{');
      const lastCurly = cleaned.lastIndexOf('}');
      if (firstCurly !== -1 && lastCurly > firstCurly) {
        cleaned = cleaned.slice(firstCurly, lastCurly + 1);
      }
    }

    try {
      return JSON.parse(cleaned);
    } catch (parseErr) {
      throw new Error(`Failed to parse structured JSON: ${parseErr.message}. Output was: ${cleaned.slice(0, 150)}...`);
    }
  }

  _combineSignals(sig1, sig2) {
    const controller = new AbortController();
    const onAbort = () => controller.abort(sig1.reason || sig2.reason);
    if (sig1.aborted || sig2.aborted) {
      controller.abort(sig1.reason || sig2.reason);
      return controller.signal;
    }
    sig1.addEventListener('abort', onAbort, { once: true });
    sig2.addEventListener('abort', onAbort, { once: true });
    return controller.signal;
  }
}

module.exports = {
  GatewayAdapter
};
