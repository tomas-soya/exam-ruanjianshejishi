'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Secure Runtime Environment & Credential Loader
 * 
 * Invariants:
 * 1. Strictly in-memory credential loading at runtime.
 * 2. Never displays, logs, or exports raw API keys.
 * 3. Never reads original root .env or browser profile data.
 * 4. Only reads runtime process.env or an explicitly designated, git-ignored local .env.llm.
 */

function maskApiKey(key) {
  if (!key || typeof key !== 'string') return '[NONE]';
  const trimmed = key.trim();
  if (trimmed.length <= 8) return '***';
  return `${trimmed.slice(0, 3)}***${trimmed.slice(-3)}`;
}

function sanitizeLogMessage(message) {
  if (typeof message !== 'string') return message;
  // Mask Bearer tokens and api keys
  return message
    .replace(/(Bearer\s+)[A-Za-z0-9_\-\.]{6,}/gi, '$1[REDACTED]')
    .replace(/(api[_-]?key[:=]\s*)[A-Za-z0-9_\-\.]{6,}/gi, '$1[REDACTED]');
}

function loadRuntimeConfig() {
  const endpoint = process.env.LLM_GATEWAY_URL || process.env.OPENAI_BASE_URL || '';
  const model = process.env.LLM_MODEL || '';
  const timeoutMs = parseInt(process.env.LLM_TIMEOUT_MS || '30000', 10);

  let apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || '';

  // Optional local ignored .env.llm loader (strictly local, never reading root .env)
  if (!apiKey) {
    const localEnvPath = path.resolve(__dirname, '../../.env.llm');
    if (fs.existsSync(localEnvPath)) {
      try {
        const content = fs.readFileSync(localEnvPath, 'utf8');
        const match = content.match(/^\s*(?:LLM_API_KEY|OPENAI_API_KEY)\s*=\s*(.+)$/m);
        if (match && match[1]) {
          apiKey = match[1].trim().replace(/^["']|["']$/g, '');
        }
      } catch {
        // Silently ignore file read errors
      }
    }
  }

  return {
    endpoint: endpoint.replace(/\/+$/, ''),
    model,
    timeoutMs: isNaN(timeoutMs) || timeoutMs <= 0 ? 30000 : timeoutMs,
    apiKey,
    hasApiKey: Boolean(apiKey && apiKey.length > 0)
  };
}

module.exports = {
  loadRuntimeConfig,
  maskApiKey,
  sanitizeLogMessage
};
