'use strict';

const crypto = require('node:crypto');

/**
 * Creates a new exam session.
 * @param {import('node:sqlite').DatabaseSync} db 
 * @param {object} session
 */
/**
 * Creates a new exam session.
 * @param {import('node:sqlite').DatabaseSync} db 
 * @param {object} session
 */
function createSession(db, session) {
  const id = session.id || crypto.randomUUID();
  const sessionMode = session.sessionMode || session.mode || 'paper';
  const practiceMode = session.practiceMode || 'exam';
  const paperId = session.paperId || null;
  const chapter = session.chapter || null;
  const title = session.title || '专项模考';
  const totalQuestions = Number(session.totalQuestions || 0);
  const maxScore = Number(session.maxScore || totalQuestions);
  const currentPosition = Number(session.currentPosition || 0);
  const answersRevealed = session.answersRevealed ? 1 : 0;
  const assistanceUsed = session.assistanceUsed ? 1 : 0;

  const stmt = db.prepare(`
    INSERT INTO exam_sessions (
      id, session_mode, practice_mode, answers_revealed, assistance_used, current_position,
      paper_id, chapter, title, total_questions,
      answered_count, status, score, max_score
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'in_progress', NULL, ?)
  `);

  stmt.run(id, sessionMode, practiceMode, answersRevealed, assistanceUsed, currentPosition, paperId, chapter, title, totalQuestions, maxScore);

  return getSession(db, id);
}

/**
 * Retrieves a session by ID.
 * @param {import('node:sqlite').DatabaseSync} db 
 * @param {string} id 
 * @param {object} [options]
 * @param {boolean} [options.includeDeleted=false]
 */
function getSession(db, id, { includeDeleted = false } = {}) {
  let sql = `
    SELECT
      id, session_mode AS sessionMode,
      COALESCE(practice_mode, 'exam') AS practiceMode,
      COALESCE(answers_revealed, 0) AS answersRevealed,
      COALESCE(assistance_used, 0) AS assistanceUsed,
      COALESCE(current_position, 0) AS currentPosition,
      paper_id AS paperId,
      chapter, title, total_questions AS totalQuestions,
      answered_count AS answeredCount, status, score,
      max_score AS maxScore, created_at AS createdAt,
      updated_at AS updatedAt, submitted_at AS submittedAt,
    COALESCE(is_deleted, 0) AS isDeleted,
      deleted_at AS deletedAt
    FROM exam_sessions
    WHERE id = ?
  `;
  if (!includeDeleted) {
    sql += ' AND COALESCE(is_deleted, 0) = 0';
  }
  const stmt = db.prepare(sql);
  const row = stmt.get(id);
  if (!row) return null;
  return projectSessionRead(row);
}

function projectSessionRead(row) {
  if (!row) return null;
  const isCase = (row.paperId && row.paperId.includes('case')) ||
    (row.title && row.title.includes('案例')) ||
    (row.sessionMode === 'paper' && row.totalQuestions === 6 && (row.paperId && !row.paperId.includes('objective')));

  // Standard 6-question case paper: effective max score is 75 (4 compulsory + 1 elective)
  let effectiveMaxScore = row.maxScore;
  if (isCase && row.totalQuestions === 6) {
    effectiveMaxScore = 75;
  } else if (!effectiveMaxScore) {
    effectiveMaxScore = isCase ? row.totalQuestions * 15 : row.totalQuestions;
  }

  let accuracy = null;
  if (row.status === 'submitted' && typeof row.score === 'number') {
    if (effectiveMaxScore > 0) {
      accuracy = Math.min(1, Math.max(0, Math.round((row.score / effectiveMaxScore) * 1000) / 1000));
    } else {
      accuracy = 0;
    }
  }

  return {
    ...row,
    maxScore: effectiveMaxScore,
    accuracy,
    answersRevealed: Boolean(row.answersRevealed),
    assistanceUsed: Boolean(row.assistanceUsed),
    isDeleted: Boolean(row.isDeleted)
  };
}

/**
 * Updates session status, score, and submission timestamp.
 * @param {import('node:sqlite').DatabaseSync} db 
 * @param {string} id 
 * @param {object} updates 
 */
function updateSessionSubmission(db, id, { score, maxScore, answeredCount, status = 'submitted' }) {
  const submittedAt = new Date().toISOString();
  const stmt = db.prepare(`
    UPDATE exam_sessions
    SET
      status = ?,
      score = ?,
      max_score = COALESCE(?, max_score),
      answered_count = COALESCE(?, answered_count),
      submitted_at = ?,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ? AND COALESCE(is_deleted, 0) = 0
  `);
  stmt.run(status, score, maxScore, answeredCount, submittedAt, id);
  return getSession(db, id);
}

/**
 * Updates session interactive state (practice mode, current position, answers revealed).
 * @param {import('node:sqlite').DatabaseSync} db 
 * @param {string} id 
 * @param {object} updates 
 */
function updateSessionState(db, id, { practiceMode, answersRevealed, assistanceUsed, currentPosition }) {
  const updates = [];
  const params = [];

  if (practiceMode && ['exam', 'practice', 'memorize'].includes(practiceMode)) {
    updates.push('practice_mode = ?');
    params.push(practiceMode);
  }
  if (typeof answersRevealed === 'boolean' || typeof answersRevealed === 'number') {
    // Sticky: once answers are revealed, always stays revealed (1)
    updates.push('answers_revealed = MAX(COALESCE(answers_revealed, 0), ?)');
    params.push(answersRevealed ? 1 : 0);
  }
  if (typeof assistanceUsed === 'boolean' || typeof assistanceUsed === 'number') {
    // Sticky: once assistance is used, always stays 1
    updates.push('assistance_used = MAX(COALESCE(assistance_used, 0), ?)');
    params.push(assistanceUsed ? 1 : 0);
  }
  if (typeof currentPosition === 'number' && Number.isFinite(currentPosition)) {
    updates.push('current_position = ?');
    params.push(Math.max(0, Math.floor(currentPosition)));
  }

  if (updates.length === 0) return getSession(db, id);

  updates.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')");
  params.push(id);

  const sql = `UPDATE exam_sessions SET ${updates.join(', ')} WHERE id = ? AND COALESCE(is_deleted, 0) = 0`;
  db.prepare(sql).run(...params);
  return getSession(db, id);
}

/**
 * Lists sessions with pagination and filtering.
 * @param {import('node:sqlite').DatabaseSync} db 
 * @param {object} [options]
 */
function listSessions(db, { limit = 20, offset = 0, status, mode, includeDeleted = false } = {}) {
  let sql = `
    SELECT
      id, session_mode AS sessionMode,
      COALESCE(practice_mode, 'exam') AS practiceMode,
      COALESCE(answers_revealed, 0) AS answersRevealed,
      COALESCE(assistance_used, 0) AS assistanceUsed,
      COALESCE(current_position, 0) AS currentPosition,
      paper_id AS paperId,
      chapter, title, total_questions AS totalQuestions,
      answered_count AS answeredCount, status, score,
      max_score AS maxScore, created_at AS createdAt,
      updated_at AS updatedAt, submitted_at AS submittedAt,
      COALESCE(is_deleted, 0) AS isDeleted,
      deleted_at AS deletedAt
    FROM exam_sessions
    WHERE 1=1
  `;
  const params = [];

  if (!includeDeleted) {
    sql += ' AND COALESCE(is_deleted, 0) = 0';
  }

  if (status) {
    sql += ' AND status = ?';
    params.push(status);
  }
  if (mode) {
    sql += ' AND session_mode = ?';
    params.push(mode);
  }

  sql += ' ORDER BY updated_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = db.prepare(sql).all(...params);
  return rows.map(r => projectSessionRead(r));
}

/**
 * Soft deletes an exam session.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} id
 * @returns {boolean} true if session was found and deleted, false if not found or already deleted
 */
function deleteSession(db, id) {
  const existing = getSession(db, id);
  if (!existing) {
    return false;
  }
  const stmt = db.prepare(`
    UPDATE exam_sessions
    SET
      is_deleted = 1,
      deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ? AND COALESCE(is_deleted, 0) = 0
  `);
  const result = stmt.run(id);
  return result && result.changes > 0;
}

module.exports = {
  createSession,
  getSession,
  updateSessionSubmission,
  updateSessionState,
  listSessions,
  deleteSession
};
