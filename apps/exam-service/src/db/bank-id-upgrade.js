'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { resolveMappedIdentifier } = require('../bank/identifier-map');

// Update identifiers only. Never rewrite answers, scores, API settings or user prose.
function upgradeBankIdentifiers(db, mapping = {}, dbPath) {
  const pairs = Object.entries(mapping).filter(([a,b]) => a !== b);
  if (!pairs.length) return { changed: 0, backupPath: null };
  const targets = [
    ['exam_sessions','paper_id'], ['exam_answers','question_id'],
    ['wrong_questions','question_id'], ['wrong_questions','paper_id'],
    ['review_queue','question_id'], ['case_reviews','question_id']
  ];
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r=>r.name));
  const updates = [];
  for (const [table,column] of targets) {
    if (!tables.has(table)) continue;
    for (const row of db.prepare(`SELECT rowid, ${column} AS value FROM ${table}`).all()) {
      const next = resolveMappedIdentifier(mapping, row.value);
      if (next && next !== row.value) updates.push({table,column,rowid:row.rowid,next});
    }
  }
  // Pending material jobs carry structural question IDs; only designated ID fields change.
  function rewrite(value, key = '') {
    if (typeof value === 'string' && ['questionId','question_id','paperId','paper_id','canonicalId'].includes(key)) return resolveMappedIdentifier(mapping, value);
    if (Array.isArray(value)) return value.map(v=>rewrite(v,key));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,rewrite(v,k)]));
    return value;
  }
  for (const [table,column] of [['material_sync_jobs','payload_json'],['personal_chapter_materials','metadata_json'],['personal_material_history','metadata_json']]) {
    if (!tables.has(table)) continue;
    for (const row of db.prepare(`SELECT rowid, ${column} AS value FROM ${table} WHERE ${column} IS NOT NULL`).all()) {
      let parsed;
      try { parsed = JSON.parse(row.value); } catch { continue; }
      const next = rewrite(parsed);
      if (JSON.stringify(next) !== JSON.stringify(parsed)) updates.push({table,column,rowid:row.rowid,next:JSON.stringify(next)});
    }
  }
  if (!updates.length) return { changed: 0, backupPath: null };
  let backupPath = null;
  if (dbPath && dbPath !== ':memory:') {
    const backupDir = path.join(path.dirname(path.resolve(dbPath)), 'backups');
    fs.mkdirSync(backupDir,{recursive:true});
    backupPath = path.join(backupDir, `before-bank-id-upgrade-${randomUUID()}.db`);
    db.prepare('VACUUM INTO ?').run(backupPath);
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    // These application triggers otherwise change study recency during a structural upgrade.
    // DDL is transactional: rollback restores them if an identifier collision occurs.
    const triggers = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND name IN ('trg_exam_sessions_updated_at','trg_exam_answers_updated_at','trg_review_queue_updated_at')").all();
    for (const trigger of triggers) db.exec(`DROP TRIGGER ${trigger.name}`);
    for (const u of updates) db.prepare(`UPDATE ${u.table} SET ${u.column} = ? WHERE rowid = ?`).run(u.next,u.rowid);
    for (const trigger of triggers) db.exec(trigger.sql);
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Foreign key validation failed');
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw new Error(`题号升级失败，原学习记录已保留：${error.message}`);
  }
  return { changed: updates.length, backupPath };
}
module.exports = { upgradeBankIdentifiers };
