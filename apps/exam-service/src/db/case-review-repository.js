'use strict';

const crypto = require('node:crypto');

/**
 * Saves a case question review record.
 * @param {import('node:sqlite').DatabaseSync} db 
 * @param {object} review 
 */
function saveCaseReview(db, review) {
  const id = review.id || crypto.randomUUID();
  const breakdownJson = review.breakdown ? JSON.stringify(review.breakdown) : null;
  const needsHumanReviewInt = review.needsHumanReview ? 1 : 0;

  const stmt = db.prepare(`
    INSERT INTO case_reviews (
      id, answer_id, session_id, question_id, evaluator_type,
      points, max_points, feedback, breakdown_json, needs_human_review,
      human_override_points, human_notes, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    )
  `);

  stmt.run(
    id,
    review.answerId,
    review.sessionId,
    review.questionId,
    review.evaluatorType || 'rule',
    review.points,
    review.maxPoints || 15,
    review.feedback || '',
    breakdownJson,
    needsHumanReviewInt,
    review.humanOverridePoints ?? null,
    review.humanNotes ?? null
  );

  return getCaseReview(db, id);
}

/**
 * Retrieves a case review by ID.
 * @param {import('node:sqlite').DatabaseSync} db 
 * @param {string} id 
 */
function getCaseReview(db, id) {
  const stmt = db.prepare(`
    SELECT
      id, answer_id AS answerId, session_id AS sessionId,
      question_id AS questionId, evaluator_type AS evaluatorType,
      points, max_points AS maxPoints, feedback,
      breakdown_json AS rawBreakdown, needs_human_review AS needsHumanReview,
      human_override_points AS humanOverridePoints, human_notes AS humanNotes,
      created_at AS createdAt, updated_at AS updatedAt
    FROM case_reviews
    WHERE id = ?
  `);
  const row = stmt.get(id);
  if (!row) return null;

  let breakdown = null;
  if (row.rawBreakdown) {
    try {
      breakdown = JSON.parse(row.rawBreakdown);
    } catch {
      breakdown = row.rawBreakdown;
    }
  }

  return {
    ...row,
    needsHumanReview: Boolean(row.needsHumanReview),
    breakdown
  };
}

/**
 * Updates human review override points and notes.
 * @param {import('node:sqlite').DatabaseSync} db 
 * @param {string} id 
 * @param {number} points 
 * @param {string} [notes] 
 */
function setHumanOverride(db, id, points, notes = '') {
  const stmt = db.prepare(`
    UPDATE case_reviews
    SET
      human_override_points = ?,
      human_notes = ?,
      needs_human_review = 0,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ?
  `);
  stmt.run(points, notes, id);
  return getCaseReview(db, id);
}

module.exports = {
  saveCaseReview,
  getCaseReview,
  setHumanOverride
};
