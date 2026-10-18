/**
 * Exam Service API Client
 * Browser requests use the page origin so local and LAN access share the same API proxy.
 * Features automatic offline local caching, retry handling, and mock fallback.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ExamApiClient = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  class ExamApiClient {
    constructor(options = {}) {
      this.baseUrl = options.baseUrl || (typeof window !== 'undefined' ? `${window.location.origin}/api/v1` : 'http://127.0.0.1:3000/api/v1');
      this.timeout = options.timeout || 8000;
      this.isOnline = true;
      this.onNetworkStatusChange = options.onNetworkStatusChange || null;
      this._inFlightSubmits = new Map();
    }

    setOnlineStatus(online) {
      if (this.isOnline !== online) {
        this.isOnline = online;
        if (typeof this.onNetworkStatusChange === 'function') {
          this.onNetworkStatusChange(online);
        }
      }
    }

    async _request(path, method = 'GET', body = null, options = {}) {
      const url = `${this.baseUrl}${path}`;
      const timeout = typeof options.timeout === 'number' ? options.timeout : this.timeout;
      const externalSignal = options.signal || null;

      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      let isLocalTimeout = false;
      let timer = null;

      if (controller && timeout > 0) {
        timer = setTimeout(() => {
          isLocalTimeout = true;
          try {
            controller.abort(new Error('REQUEST_TIMEOUT'));
          } catch (e) {
            controller.abort();
          }
        }, timeout);
      }

      let removeExternalAbortListener = null;
      if (controller && externalSignal) {
        if (externalSignal.aborted) {
          controller.abort(externalSignal.reason);
        } else {
          const handleExternalAbort = () => {
            try {
              controller.abort(externalSignal.reason);
            } catch (e) {
              controller.abort();
            }
          };
          externalSignal.addEventListener('abort', handleExternalAbort, { once: true });
          removeExternalAbortListener = () => {
            externalSignal.removeEventListener('abort', handleExternalAbort);
          };
        }
      }

      const headers = {
        'Accept': 'application/json'
      };
      if (body) {
        headers['Content-Type'] = 'application/json';
      }

      try {
        const fetchOptions = {
          method,
          headers,
          signal: controller ? controller.signal : (externalSignal || undefined)
        };
        if (body) {
          fetchOptions.body = JSON.stringify(body);
        }

        const res = await fetch(url, fetchOptions);

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          const message = (errData && errData.error && errData.error.message) || `HTTP error ${res.status}`;
          const error = new Error(message);
          error.status = res.status;
          error.code = (errData && errData.error && errData.error.code) || 'API_ERROR';
          error.details = errData && errData.error;
          throw error;
        }

        // Reading response body remains under timer protection for ordinary requests
        const json = await res.json();
        this.setOnlineStatus(true);
        return json.data !== undefined ? json.data : json;
      } catch (err) {
        if (isLocalTimeout) {
          const timeoutSeconds = Math.round(timeout / 1000);
          const timeoutErr = new Error(`请求超时（已等待超过 ${timeoutSeconds} 秒未响应）。建议检查服务运行状态或稍后重试。`);
          timeoutErr.name = 'TimeoutError';
          timeoutErr.code = 'REQUEST_TIMEOUT';
          timeoutErr.status = 408;
          timeoutErr.isTimeout = true;
          throw timeoutErr;
        }

        if (err.name === 'AbortError' || (controller && controller.signal && controller.signal.aborted)) {
          if (externalSignal && externalSignal.aborted) {
            const userAbortErr = new Error('操作已由用户主动取消。');
            userAbortErr.name = 'AbortError';
            userAbortErr.code = 'REQUEST_ABORTED';
            throw userAbortErr;
          }
          const abortErr = new Error('请求已取消或中断。');
          abortErr.name = 'AbortError';
          abortErr.code = 'REQUEST_ABORTED';
          throw abortErr;
        }

        const isNetworkErr = err.name === 'TypeError' ||
          (err.message && (
            err.message.includes('fetch failed') ||
            err.message.includes('Failed to fetch') ||
            err.message.includes('network') ||
            err.message.includes('ECONNREFUSED') ||
            err.message.includes('ENOTFOUND') ||
            err.message.includes('ECONNRESET')
          ));

        if (isNetworkErr) {
          this.setOnlineStatus(false);
          const netErr = new Error('网络连接不可达，无法访问服务端。请检查本地网络或后端服务运行状态。');
          netErr.name = 'NetworkError';
          netErr.code = 'NETWORK_UNREACHABLE';
          throw netErr;
        }

        if (err.status) {
          this.setOnlineStatus(true);
        }

        throw err;
      } finally {
        if (timer) clearTimeout(timer);
        if (removeExternalAbortListener) removeExternalAbortListener();
      }
    }

    // 1. Papers & Catalogs
    async listPapers(subject) {
      const query = subject ? `?subject=${encodeURIComponent(subject)}` : '';
      return this._request(`/papers${query}`);
    }

    async getPaper(paperId) {
      return this._request(`/papers/${encodeURIComponent(paperId)}`);
    }

    async listChapters() {
      return this._request('/chapters');
    }

    // 2. Sessions & Drafts
    async listSessions(params = {}) {
      const query = new URLSearchParams();
      if (params.status) query.set('status', params.status);
      if (params.mode) query.set('mode', params.mode);
      if (params.practiceMode) query.set('practiceMode', params.practiceMode);
      if (params.limit) query.set('limit', String(params.limit));
      if (params.offset) query.set('offset', String(params.offset));
      const qs = query.toString() ? `?${query.toString()}` : '';
      return this._request(`/sessions${qs}`);
    }

    async createSession({ mode, paperId, chapter, questionIds, title, practiceMode }) {
      return this._request('/sessions', 'POST', {
        mode,
        paperId,
        chapter,
        questionIds,
        title,
        practiceMode: practiceMode || 'exam'
      });
    }

    async getSession(sessionId) {
      return this._request(`/sessions/${encodeURIComponent(sessionId)}`);
    }

    async updateSessionState(sessionId, updates = {}) {
      return this._request(`/sessions/${encodeURIComponent(sessionId)}`, 'PATCH', updates);
    }

    async checkQuestion(sessionId, questionId, userAnswer) {
      return this._request(`/sessions/${encodeURIComponent(sessionId)}/check-question`, 'POST', {
        questionId,
        userAnswer
      });
    }

    async getSessionSolutions(sessionId) {
      return this._request(`/sessions/${encodeURIComponent(sessionId)}/solutions`);
    }

    async saveAnswerDraft(sessionId, questionId, questionType, userAnswer) {
      return this._request(`/sessions/${encodeURIComponent(sessionId)}/answers`, 'POST', {
        sessionId,
        questionId,
        questionType,
        userAnswer
      });
    }

    submitSession(sessionId, options = {}) {
      if (!this._inFlightSubmits) {
        this._inFlightSubmits = new Map();
      }
      if (this._inFlightSubmits.has(sessionId)) {
        return this._inFlightSubmits.get(sessionId);
      }

      const submitPromise = (async () => {
        try {
          return await this._request(`/sessions/${encodeURIComponent(sessionId)}/submit`, 'POST', {
            sessionId,
            clientTimestamp: new Date().toISOString()
          }, {
            timeout: 0,
            isSubmit: true,
            ...options
          });
        } catch (err) {
          const rawMsg = err.message || '未知异常';
          let userFriendlyMessage = `交卷请求未成功完成（${rawMsg}）。您的答卷和草稿已在本地安全保留，未产生重复记录。请检查网络或后端状态后再次点击提交。`;
          if (err.code === 'NETWORK_UNREACHABLE') {
            userFriendlyMessage = '网络连接不可达，无法完成交卷。答题进度已在本地妥善保存，请在服务恢复后重新点击“确认交卷”。';
          }
          err.userFriendlyMessage = userFriendlyMessage;
          throw err;
        } finally {
          this._inFlightSubmits.delete(sessionId);
        }
      })();

      this._inFlightSubmits.set(sessionId, submitPromise);
      return submitPromise;
    }

    async regradeSession(sessionId) {
      return this._request(`/sessions/${encodeURIComponent(sessionId)}/regrade`, 'POST', null, { timeout: 0 });
    }

    async deleteSession(sessionId) {
      return this._request(`/sessions/${encodeURIComponent(sessionId)}`, 'DELETE');
    }

    async getSessionReport(sessionId) {
      return this._request(`/sessions/${encodeURIComponent(sessionId)}/report`);
    }

    async overrideCaseScore(sessionId, questionId, { points, notes }) {
      return this._request(`/sessions/${encodeURIComponent(sessionId)}/case-scores`, 'POST', {
        questionId,
        points,
        notes
      });
    }

    // 3. Wrong Questions & Review Queue
    async listWrongQuestions(params = {}) {
      const query = new URLSearchParams();
      if (params.paperId) query.set('paperId', params.paperId);
      if (params.questionType) query.set('questionType', params.questionType);
      if (params.chapter) query.set('chapter', params.chapter);
      if (params.mastered !== undefined) query.set('mastered', String(params.mastered));
      if (params.limit !== undefined && params.limit !== null) query.set('limit', String(params.limit));
      if (params.offset !== undefined && params.offset !== null) query.set('offset', String(params.offset));
      const qs = query.toString() ? `?${query.toString()}` : '';
      return this._request(`/wrong-questions${qs}`);
    }

    async toggleWrongQuestionMastered(id, mastered) {
      return this._request(`/wrong-questions/${encodeURIComponent(id)}/mastered`, 'POST', {
        mastered
      });
    }

    async getReviewQueue(limit = 20) {
      return this._request(`/review-queue?limit=${limit}`);
    }

    // 4. Revision Material Anchors & Static Materials (AC-1)
    async getMaterialDoc(relativeDocPath, subject = null) {
      const subQuery = subject ? `&subject=${encodeURIComponent(subject)}` : '';
      return this._request(`/materials?doc=${encodeURIComponent(relativeDocPath)}${subQuery}`);
    }

    async listStaticMaterials() {
      return this._request('/static-materials');
    }

    async getStaticMaterial(docPath, subject = null) {
      const subQuery = subject ? `&subject=${encodeURIComponent(subject)}` : '';
      return this._request(`/materials?doc=${encodeURIComponent(docPath)}${subQuery}`);
    }

    // 5. Dynamic Wrong Questions Materials (2 summary items: objective & case) (AC-2)
    async listDynamicMaterials() {
      return this._request('/dynamic-materials');
    }

    async getDynamicMaterial(subject) {
      return this._request(`/dynamic-materials/${encodeURIComponent(subject)}`);
    }

    async retryDynamicMaterial(subject) {
      return this._request(`/dynamic-materials/${encodeURIComponent(subject)}/retry`, 'POST');
    }

    // 5.1 Legacy Personal Chapter Materials (AC-B1..B5 compatibility)
    async listPersonalMaterials() {
      return this._request('/personal-materials');
    }

    async getPersonalMaterial(chapterKey) {
      return this._request(`/personal-materials/${encodeURIComponent(chapterKey)}`);
    }

    async retryPersonalMaterial(chapterKey) {
      return this._request(`/personal-materials/${encodeURIComponent(chapterKey)}/retry`, 'POST');
    }

    // 6. AI Chat Assistant & Mode Exit (AC-Q1..Q5)
    async chat({ context, userMessage, history }, externalSignal = null) {
      const url = `${this.baseUrl}/chat`;
      const headers = {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      };

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          context,
          userMessage,
          history: history || []
        }),
        signal: externalSignal || undefined
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const message = (errData && errData.error && errData.error.message) || `HTTP error ${res.status}`;
        const error = new Error(message);
        error.status = res.status;
        error.code = (errData && errData.error && errData.error.code) || 'API_ERROR';
        error.details = errData && errData.error;
        throw error;
      }

      const json = await res.json();
      return json.data !== undefined ? json.data : json;
    }

    async exitExamMode(sessionId) {
      return this._request(`/sessions/${encodeURIComponent(sessionId)}/exit-exam-mode`, 'POST');
    }

    // 7. System Settings & Database Migration
    async getLlmConfig() {
      return this._request('/system/llm-config');
    }

    async saveLlmConfig(config) {
      return this._request('/system/llm-config', 'PUT', config);
    }

    async testLlmConnection(options = {}) {
      return this._request('/system/llm-test', 'POST', options);
    }

    async listLlmModels(options = {}) {
      const data = await this._request('/system/llm-models', 'POST', options);
      return data && data.models ? data.models : [];
    }

    async getDatabaseInfo() {
      return this._request('/system/db-info');
    }

    exportDatabaseUrl() {
      return `${this.baseUrl}/system/db-export`;
    }

    async importDatabase(file) {
      const url = `${this.baseUrl}/system/db-import`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream'
        },
        body: file
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const message = (errData && errData.error && errData.error.message) || `HTTP error ${res.status}`;
        const error = new Error(message);
        error.status = res.status;
        throw error;
      }

      const json = await res.json();
      return json.data !== undefined ? json.data : json;
    }
  }

  return ExamApiClient;
});
