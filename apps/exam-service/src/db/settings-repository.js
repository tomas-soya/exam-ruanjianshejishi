'use strict';

/**
 * Settings Repository
 * Key-value persistence in the app_settings table.
 */

const { encryptJson, decryptJson, isEncrypted, decrypt } = require('../utils/crypto-vault');

const SENSITIVE_KEYS = new Set(['llm_config']);

function ensureSettingsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);
}

function getSetting(db, key) {
  if (!db || !key) return null;
  ensureSettingsTable(db);
  const stmt = db.prepare('SELECT value FROM app_settings WHERE key = ?');
  const row = stmt.get(key);
  if (!row) return null;

  if (isEncrypted(row.value)) {
    return decryptJson(row.value);
  }

  try {
    const parsed = JSON.parse(row.value);
    // Backward compatibility: in case apiKey was encrypted individually
    if (parsed && typeof parsed === 'object' && isEncrypted(parsed.apiKey)) {
      parsed.apiKey = decrypt(parsed.apiKey);
    }
    return parsed;
  } catch {
    return row.value;
  }
}

function setSetting(db, key, value, options = {}) {
  if (!db || !key) return;
  ensureSettingsTable(db);

  const shouldEncrypt = options?.encrypted === true || SENSITIVE_KEYS.has(key);
  let serialized;
  if (shouldEncrypt) {
    serialized = encryptJson(value);
  } else {
    serialized = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
  }

  const stmt = db.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `);
  stmt.run(key, serialized);
}

function deleteSetting(db, key) {
  if (!db || !key) return;
  ensureSettingsTable(db);
  const stmt = db.prepare('DELETE FROM app_settings WHERE key = ?');
  stmt.run(key);
}

function getAllSettings(db) {
  if (!db) return {};
  ensureSettingsTable(db);
  const stmt = db.prepare('SELECT key, value, updated_at FROM app_settings');
  const rows = stmt.all();
  const result = {};
  for (const r of rows) {
    if (isEncrypted(r.value)) {
      result[r.key] = decryptJson(r.value);
    } else {
      try {
        result[r.key] = JSON.parse(r.value);
      } catch {
        result[r.key] = r.value;
      }
    }
  }
  return result;
}

function isSettingEncryptedInDb(db, key) {
  if (!db || !key) return false;
  ensureSettingsTable(db);
  const stmt = db.prepare('SELECT value FROM app_settings WHERE key = ?');
  const row = stmt.get(key);
  return Boolean(row && isEncrypted(row.value));
}

module.exports = {
  getSetting,
  setSetting,
  deleteSetting,
  getAllSettings,
  isSettingEncryptedInDb
};
