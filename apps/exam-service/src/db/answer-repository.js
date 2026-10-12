'use strict';

const crypto = require('node:crypto');

function isAnswerObjectPopulated(val) {
  if (val === null || val === undefined) return false;
  if (typeof val === 'string') return val.trim().length > 0;
  if (typeof val === 'object') {
    return Object.values(val).some(v => isAnswerObjectPopulated(v));
  }
  return Boolean(val);
}

function isAnswerPopulated(rawJson) {
  if (!rawJson) return false;
  if (typeof rawJson === 'string') {
    const trimmed = rawJson.trim();
    if (!trimmed || trimmed === '""' || trimmed === '{}') return false;
    try {
      const parsed = JSON.parse(rawJson);
      return isAnswerObjectPopulated(parsed);
    } catch {
      return trimmed.length > 0;
    }
  }
  return isAnswerObjectPopulated(rawJson);
}

/**
 * Idempotently saves or updates a user answer draft.
 * @param {import('node:sqlite').DatabaseSync} db 
 * @param {object} param0 
 */
function saveAnswerDraft(db, { sessionId, questionId, questionType, userAnswer, maxScore = 1.0 }) {
  const id = crypto.randomUUID();
  const rawAnswer = typeof userAnswer === 'string' ? userAnswer : JSON.stringify(userAnswer);

  db.exec('BEGIN IMMEDIATE TRANSACTION;');
  try {
    const upsertStmt = db.prepare(`
      INSERT INTO exam_answers (
        id, session_id, question_id, question_type, user_answer_json,
        is_correct, score, max_score, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ON CONFLICT(session_id, question_id) DO UPDATE SET
        user_answer_json = excluded.user_answer_json,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    `);
    upsertStmt.run(id, sessionId, questionId, questionType, rawAnswer, maxScore);

    // Sync answered count in session with accurate whitespace and case subquestion inspection
    const allAnswers = db.prepare('SELECT user_answer_json FROM exam_answers WHERE session_id = ?').all(sessionId);
    const populatedCount = allAnswers.filter(a => isAnswerPopulated(a.user_answer_json)).length;

    const countStmt = db.prepare(`
      UPDATE exam_sessions
      SET
        answered_count = ?,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?
    `);
    countStmt.run(populatedCount, sessionId);

    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }

  return getAnswer(db, sessionId, questionId);
}

/**
 * Retrieves a single answer record.
 * @param {import('node:sqlite').DatabaseSync} db 
 * @param {string} sessionId 
 * @param {string} questionId 
 */
function getAnswer(db, sessionId, questionId) {
  const stmt = db.prepare(`
    SELECT
      id, session_id AS sessionId, question_id AS questionId,
      question_type AS questionType, user_answer_json AS rawAnswer,
      is_correct AS isCorrect, score, max_score AS maxScore,
      score_breakdown_json AS rawBreakdown, reviewed_at AS reviewedAt,
      created_at AS createdAt, updated_at AS updatedAt
    FROM exam_answers
    WHERE session_id = ? AND question_id = ?
  `);
  const row = stmt.get(sessionId, questionId);
  if (!row) return null;

  return parseAnswerRow(row);
}

/**
 * Retrieves all answers for a session.
 * @param {import('node:sqlite').DatabaseSync} db 
 * @param {string} sessionId 
 */
function getAnswersForSession(db, sessionId) {
  const stmt = db.prepare(`
    SELECT
      id, session_id AS sessionId, question_id AS questionId,
      question_type AS questionType, user_answer_json AS rawAnswer,
      is_correct AS isCorrect, score, max_score AS maxScore,
      score_breakdown_json AS rawBreakdown, reviewed_at AS reviewedAt,
      created_at AS createdAt, updated_at AS updatedAt
    FROM exam_answers
    WHERE session_id = ?
    ORDER BY created_at ASC
  `);
  const rows = stmt.all(sessionId);
  return rows.map(parseAnswerRow);
}

/**
 * Updates grading result for an answer.
 * @param {import('node:sqlite').DatabaseSync} db 
 * @param {string} id 
 * @param {object} grading
 */
function updateAnswerGrading(db, id, { isCorrect, score, breakdown }) {
  const reviewedAt = new Date().toISOString();
  const breakdownJson = breakdown ? JSON.stringify(breakdown) : null;
  const isCorrectInt = isCorrect === null || isCorrect === undefined ? null : (isCorrect ? 1 : 0);

  const stmt = db.prepare(`
    UPDATE exam_answers
    SET
      is_correct = ?,
      score = ?,
      score_breakdown_json = ?,
      reviewed_at = ?,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ?
  `);
  stmt.run(isCorrectInt, score, breakdownJson, reviewedAt, id);
}

function parseAnswerRow(row) {
  let userAnswer = row.rawAnswer;
  try {
    userAnswer = JSON.parse(row.rawAnswer);
  } catch {
    // Keep as string
  }

  let scoreBreakdown = null;
  if (row.rawBreakdown) {
    try {
      scoreBreakdown = JSON.parse(row.rawBreakdown);
    } catch {
      scoreBreakdown = row.rawBreakdown;
    }
  }

  return {
    id: row.id,
    sessionId: row.sessionId,
    questionId: row.questionId,
    questionType: row.questionType,
    userAnswer,
    isCorrect: row.isCorrect === null ? null : Boolean(row.isCorrect),
    score: row.score,
    maxScore: row.maxScore,
    scoreBreakdown,
    reviewedAt: row.reviewedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

module.exports = {
  saveAnswerDraft,
  getAnswer,
  getAnswersForSession,
  updateAnswerGrading
};
