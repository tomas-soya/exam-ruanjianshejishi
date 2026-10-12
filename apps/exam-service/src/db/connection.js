'use strict';

const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Initializes and configures an SQLite database connection.
 * @param {string} [dbPath] - Absolute/relative path to database file, or ':memory:'.
 * @returns {DatabaseSync} Configured SQLite database instance.
 */
function createDatabase(dbPath = ':memory:') {
  if (dbPath !== ':memory:') {
    const dir = path.dirname(path.resolve(dbPath));
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new DatabaseSync(dbPath);

  // Configure SQLite performance and integrity Pragmas
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');

  if (dbPath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA synchronous = NORMAL;');
  }

  return db;
}

/**
 * Safely closes an SQLite database connection.
 * @param {DatabaseSync} db 
 */
function closeDatabase(db) {
  if (db) {
    try {
      db.close();
    } catch (err) {
      // Ignore if already closed
    }
  }
}

module.exports = {
  createDatabase,
  closeDatabase
};
