'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ALGORITHM = 'aes-256-gcm';
const PREFIX = 'enc:v1:gcm:';
const KEY_DERIVATION_CONTEXT = 'ruankao-vault-kdf-v2';

let cachedMachineSecret = null;

function resolveMachineKeyPath() {
  if (process.env.EXAM_VAULT_KEY_FILE) {
    return path.resolve(process.env.EXAM_VAULT_KEY_FILE);
  }
  return path.join(os.homedir(), '.ruankao-exam', 'vault.key');
}

function getOrCreateMachineSecret() {
  if (cachedMachineSecret) return cachedMachineSecret;
  const keyFile = resolveMachineKeyPath();
  try {
    if (fs.existsSync(keyFile)) {
      const existing = fs.readFileSync(keyFile, 'utf8').trim();
      if (existing.length >= 32) {
        cachedMachineSecret = existing;
        return cachedMachineSecret;
      }
    }
    const dir = path.dirname(keyFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    const generated = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(keyFile, `${generated}\n`, { encoding: 'utf8', mode: 0o600 });
    cachedMachineSecret = generated;
    return cachedMachineSecret;
  } catch {
    // Fallback to ephemeral process secret if filesystem is strictly read-only
    if (!cachedMachineSecret) {
      cachedMachineSecret = crypto.randomBytes(32).toString('hex');
    }
    return cachedMachineSecret;
  }
}

/**
 * Derives a 32-byte cryptographic key from custom secret, EXAM_APP_SECRET, or per-machine random vault key.
 * @param {string} [customSecret]
 * @returns {Buffer}
 */
function getDerivedKey(customSecret) {
  const secret = customSecret || process.env.EXAM_APP_SECRET || getOrCreateMachineSecret();
  return crypto.scryptSync(secret, KEY_DERIVATION_CONTEXT, 32);
}

function getLegacyMigrationKey() {
  const legacySecret = ['ruankao', 'exam', 'app', 'secret', '20261012'].join('-');
  const legacySalt = ['ruankao', 'vault', 'salt', 'v1'].join('-');
  return crypto.scryptSync(legacySecret, legacySalt, 32);
}

/**
 * Checks whether a given string is an encrypted envelope.
 * @param {*} val
 * @returns {boolean}
 */
function isEncrypted(val) {
  return typeof val === 'string' && val.startsWith(PREFIX);
}

/**
 * Encrypts a plaintext string into envelope format: enc:v1:gcm:<ivHex>:<tagHex>:<cipherHex>
 * @param {string} plainText
 * @param {string} [secret]
 * @returns {string}
 */
function encrypt(plainText, secret) {
  if (plainText === null || plainText === undefined) return plainText;
  const str = typeof plainText === 'string' ? plainText : String(plainText);
  if (!str) return str;
  if (isEncrypted(str)) return str;

  const key = getDerivedKey(secret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(str, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');

  return `${PREFIX}${iv.toString('hex')}:${tag}:${encrypted}`;
}

function decryptWithKey(ivHex, tagHex, encryptedHex, key) {
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Decrypts an envelope enc:v1:gcm:<ivHex>:<tagHex>:<cipherHex> back to plaintext string.
 * Gracefully returns original text if not encrypted (backward compatibility).
 * @param {string} cipherEnvelope
 * @param {string} [secret]
 * @returns {string|null}
 */
function decrypt(cipherEnvelope, secret) {
  if (typeof cipherEnvelope !== 'string') return cipherEnvelope;
  if (!isEncrypted(cipherEnvelope)) return cipherEnvelope;

  const parts = cipherEnvelope.slice(PREFIX.length).split(':');
  if (parts.length !== 3) return cipherEnvelope;
  const [ivHex, tagHex, encryptedHex] = parts;

  try {
    return decryptWithKey(ivHex, tagHex, encryptedHex, getDerivedKey(secret));
  } catch (primaryErr) {
    if (!secret && !process.env.EXAM_APP_SECRET) {
      try {
        return decryptWithKey(ivHex, tagHex, encryptedHex, getLegacyMigrationKey());
      } catch {}
    }
    console.warn('[CryptoVault] Decryption failed:', primaryErr.message);
    return null;
  }
}

/**
 * Encrypts any JSON-serializable value into an encrypted envelope string.
 * @param {*} value
 * @param {string} [secret]
 * @returns {string}
 */
function encryptJson(value, secret) {
  if (value === null || value === undefined) return value;
  const jsonStr = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return encrypt(jsonStr, secret);
}

/**
 * Decrypts an encrypted envelope string and parses it as JSON if possible.
 * Backward compatible: if input is plain JSON string or already parsed object, returns it.
 * @param {*} data
 * @param {string} [secret]
 * @returns {*}
 */
function decryptJson(data, secret) {
  if (data === null || data === undefined) return data;
  if (typeof data === 'string') {
    if (isEncrypted(data)) {
      const decryptedStr = decrypt(data, secret);
      if (!decryptedStr) return null;
      try {
        return JSON.parse(decryptedStr);
      } catch {
        return decryptedStr;
      }
    }
    try {
      return JSON.parse(data);
    } catch {
      return data;
    }
  }
  return data;
}

module.exports = {
  isEncrypted,
  encrypt,
  decrypt,
  encryptJson,
  decryptJson,
  getDerivedKey,
  PREFIX
};
