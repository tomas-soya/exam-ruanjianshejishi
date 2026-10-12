'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

/**
 * Ensures the migration tracking table exists.
 * @param {import('node:sqlite').DatabaseSync} db 
 */
function ensureMigrationTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);
}

/**
 * Runs all pending migrations in ascending order.
 * @param {import('node:sqlite').DatabaseSync} db 
 * @param {string} [customMigrationsDir]
 * @returns {{ applied: string[], currentVersion: string | null }}
 */
function runMigrations(db, customMigrationsDir = MIGRATIONS_DIR) {
  ensureMigrationTable(db);

  const appliedQuery = db.prepare('SELECT version FROM schema_migrations ORDER BY version ASC');
  const appliedRows = appliedQuery.all();
  const appliedSet = new Set(appliedRows.map((r) => r.version));

  const files = fs.readdirSync(customMigrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const newlyApplied = [];

  for (const file of files) {
    const version = file.split('_')[0];
    if (appliedSet.has(version)) {
      continue;
    }

    const filePath = path.join(customMigrationsDir, file);
    const sql = fs.readFileSync(filePath, 'utf8');

    // Run migration inside transaction
    db.exec('BEGIN IMMEDIATE TRANSACTION;');
    try {
      db.exec(sql);
      const insertStmt = db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)');
      insertStmt.run(version, file);
      db.exec('COMMIT;');
      newlyApplied.push(file);
    } catch (err) {
      db.exec('ROLLBACK;');
      throw new Error(`Failed to apply migration ${file}: ${err.message}`);
    }
  }

  const latestRow = db.prepare('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1').get();
  return {
    applied: newlyApplied,
    currentVersion: latestRow ? latestRow.version : null
  };
}

/**
 * Gets list of applied migrations.
 * @param {import('node:sqlite').DatabaseSync} db 
 */
function getAppliedMigrations(db) {
  ensureMigrationTable(db);
  const stmt = db.prepare('SELECT id, version, name, applied_at FROM schema_migrations ORDER BY version ASC');
  return stmt.all();
}

module.exports = {
  ensureMigrationTable,
  runMigrations,
  getAppliedMigrations
};
