'use strict';

const crypto = require('node:crypto');

/**
 * Records or updates a wrong question in the notebook.
 * @param {import('node:sqlite').DatabaseSync} db 
 * @param {object} param0 
 */
function recordWrongQuestion(db, { questionId, paperId, chapter, questionType }) {
  const id = crypto.randomUUID();
  const stmt = db.prepare(`
    INSERT INTO wrong_questions (
      id, question_id, paper_id, chapter, question_type,
      first_wrong_at, last_wrong_at, wrong_count, mastered, last_reviewed_at
    ) VALUES (
      ?, ?, ?, ?, ?,
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      1, 0, NULL
    )
    ON CONFLICT(question_id) DO UPDATE SET
      wrong_count = wrong_count + 1,
      last_wrong_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      mastered = 0
  `);
  stmt.run(id, questionId, paperId, chapter, questionType);
  return getWrongQuestion(db, questionId);
}

/**
 * Retrieves a wrong question record by questionId.
 * @param {import('node:sqlite').DatabaseSync} db 
 * @param {string} questionId 
 */
function getWrongQuestion(db, questionId) {
  const stmt = db.prepare(`
    SELECT
      id, question_id AS questionId, paper_id AS paperId,
      chapter, question_type AS questionType,
      first_wrong_at AS firstWrongAt, last_wrong_at AS lastWrongAt,
      wrong_count AS wrongCount, mastered,
      last_reviewed_at AS lastReviewedAt
    FROM wrong_questions
    WHERE question_id = ?
  `);
  const row = stmt.get(questionId);
  if (!row) return null;
  return {
    ...row,
    mastered: Boolean(row.mastered)
  };
}

/**
 * Toggles or updates mastered status.
 * @param {import('node:sqlite').DatabaseSync} db 
 * @param {string} questionId 
 * @param {boolean} mastered 
 */
function setMastered(db, questionId, mastered) {
  const masteredInt = mastered ? 1 : 0;
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    UPDATE wrong_questions
    SET
      mastered = ?,
      last_reviewed_at = ?
    WHERE question_id = ?
  `);
  stmt.run(masteredInt, now, questionId);
  return getWrongQuestion(db, questionId);
}

/**
 * Lists wrong questions with optional filtering.
 * Supports filtering by paperId, questionType, chapter, and mastery state.
 * Does not restrict maximum wrong questions unless explicit limit is provided.
 * @param {import('node:sqlite').DatabaseSync} db 
 * @param {object} [options]
 */
function listWrongQuestions(db, { paperId, questionType, chapter, mastered, limit = null, offset = 0 } = {}) {
  let sql = `
    SELECT
      id, question_id AS questionId, paper_id AS paperId,
      chapter, question_type AS questionType,
      first_wrong_at AS firstWrongAt, last_wrong_at AS lastWrongAt,
      wrong_count AS wrongCount, mastered,
      last_reviewed_at AS lastReviewedAt
    FROM wrong_questions
    WHERE 1=1
  `;
  const params = [];

  if (paperId) {
    sql += ' AND paper_id = ?';
    params.push(paperId);
  }
  if (questionType) {
    sql += ' AND question_type = ?';
    params.push(questionType);
  }
  if (chapter) {
    sql += ' AND chapter = ?';
    params.push(chapter);
  }
  if (typeof mastered === 'boolean') {
    sql += ' AND mastered = ?';
    params.push(mastered ? 1 : 0);
  }

  sql += ' ORDER BY mastered ASC, wrong_count DESC, last_wrong_at DESC';

  if (limit !== null && limit !== undefined && limit > 0) {
    sql += ' LIMIT ? OFFSET ?';
    params.push(limit, offset || 0);
  } else if (offset > 0) {
    sql += ' LIMIT -1 OFFSET ?';
    params.push(offset);
  }

  const rows = db.prepare(sql).all(...params);
  return rows.map((r) => ({
    ...r,
    mastered: Boolean(r.mastered)
  }));
}

/**
 * Removes a question from the wrong questions notebook.
 * Used when a question is overridden to pass or corrected.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} questionId
 */
function removeWrongQuestion(db, questionId) {
  const stmt = db.prepare(`
    DELETE FROM wrong_questions
    WHERE question_id = ?
  `);
  stmt.run(questionId);
}

module.exports = {
  recordWrongQuestion,
  getWrongQuestion,
  setMastered,
  listWrongQuestions,
  removeWrongQuestion
};
