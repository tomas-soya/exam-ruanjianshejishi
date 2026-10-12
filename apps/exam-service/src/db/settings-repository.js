'use strict';

/**
 * Settings Repository
 * Key-value persistence in the app_settings table.
 */

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
  try {
    return JSON.parse(row.value);
  } catch {
    return row.value;
  }
}

function setSetting(db, key, value) {
  if (!db || !key) return;
  ensureSettingsTable(db);
  const serialized = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
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
    try {
      result[r.key] = JSON.parse(r.value);
    } catch {
      result[r.key] = r.value;
    }
  }
  return result;
}

module.exports = {
  getSetting,
  setSetting,
  deleteSetting,
  getAllSettings
};
