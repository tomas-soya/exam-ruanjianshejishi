'use strict';

const crypto = require('node:crypto');

/**
 * SuperMemo-2 inspired Spaced Repetition calculation.
 */
function calculateNextReview(current, isCorrect) {
  let repetitions = current ? current.repetitions : 0;
  let intervalDays = current ? current.interval_days : 1.0;
  let easeFactor = current ? current.ease_factor : 2.5;
  let priorityScore = current ? current.priority_score : 1.0;
  let state = current ? current.state : 'learning';

  if (isCorrect) {
    repetitions += 1;
    if (repetitions === 1) {
      intervalDays = 1.0;
    } else if (repetitions === 2) {
      intervalDays = 3.0;
    } else {
      intervalDays = Math.round(intervalDays * easeFactor * 10) / 10;
    }

    easeFactor = Math.min(3.0, easeFactor + 0.1);
    priorityScore = Math.max(0.1, priorityScore * 0.7);
    state = repetitions >= 4 ? 'mastered' : 'reviewing';
  } else {
    repetitions = 0;
    intervalDays = 1.0;
    easeFactor = Math.max(1.3, easeFactor - 0.2);
    priorityScore = priorityScore + 1.5;
    state = 'learning';
  }

  const nextReviewAt = new Date(Date.now() + intervalDays * 24 * 60 * 60 * 1000).toISOString();

  return {
    repetitions,
    intervalDays,
    easeFactor,
    priorityScore,
    state,
    nextReviewAt
  };
}

/**
 * Records a review attempt and schedules next review.
 * @param {import('node:sqlite').DatabaseSync} db 
 * @param {string} questionId 
 * @param {boolean} isCorrect 
 */
function recordReviewResult(db, questionId, isCorrect) {
  const currentStmt = db.prepare(`
    SELECT
      id, question_id, priority_score, next_review_at,
      interval_days, repetitions, ease_factor, state
    FROM review_queue
    WHERE question_id = ?
  `);
  const current = currentStmt.get(questionId);
  const next = calculateNextReview(current, isCorrect);
  const id = current ? current.id : crypto.randomUUID();

  const upsertStmt = db.prepare(`
    INSERT INTO review_queue (
      id, question_id, priority_score, next_review_at,
      interval_days, repetitions, ease_factor, state, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ON CONFLICT(question_id) DO UPDATE SET
      priority_score = excluded.priority_score,
      next_review_at = excluded.next_review_at,
      interval_days = excluded.interval_days,
      repetitions = excluded.repetitions,
      ease_factor = excluded.ease_factor,
      state = excluded.state,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  `);

  upsertStmt.run(
    id,
    questionId,
    next.priorityScore,
    next.nextReviewAt,
    next.intervalDays,
    next.repetitions,
    next.easeFactor,
    next.state
  );

  return getReviewQueueItem(db, questionId);
}

/**
 * Gets a review item by questionId.
 * @param {import('node:sqlite').DatabaseSync} db 
 * @param {string} questionId 
 */
function getReviewQueueItem(db, questionId) {
  const stmt = db.prepare(`
    SELECT
      id, question_id AS questionId, priority_score AS priorityScore,
      next_review_at AS nextReviewAt, interval_days AS intervalDays,
      repetitions, ease_factor AS easeFactor, state, updated_at AS updatedAt
    FROM review_queue
    WHERE question_id = ?
  `);
  return stmt.get(questionId) || null;
}

/**
 * Gets questions due for review, ordered by priority score descending.
 * @param {import('node:sqlite').DatabaseSync} db 
 * @param {number} [limit] 
 */
function getDueReviewQuestions(db, limit = 20) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    SELECT
      id, question_id AS questionId, priority_score AS priorityScore,
      next_review_at AS nextReviewAt, interval_days AS intervalDays,
      repetitions, ease_factor AS easeFactor, state, updated_at AS updatedAt
    FROM review_queue
    WHERE next_review_at <= ? AND state != 'mastered'
    ORDER BY priority_score DESC, next_review_at ASC
    LIMIT ?
  `);
  return stmt.all(now, limit);
}

/**
 * Lists review queue items sorted by priority descending.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {object} [options]
 */
function listReviewQueue(db, { limit = 20, state } = {}) {
  let sql = `
    SELECT
      id, question_id AS questionId, priority_score AS priorityScore,
      next_review_at AS nextReviewAt, interval_days AS intervalDays,
      repetitions, ease_factor AS easeFactor, state, updated_at AS updatedAt
    FROM review_queue
    WHERE 1=1
  `;
  const params = [];
  if (state) {
    sql += ' AND state = ?';
    params.push(state);
  }
  sql += ' ORDER BY priority_score DESC, next_review_at ASC LIMIT ?';
  params.push(limit);

  const stmt = db.prepare(sql);
  return stmt.all(...params);
}

module.exports = {
  calculateNextReview,
  recordReviewResult,
  getReviewQueueItem,
  getDueReviewQuestions,
  listReviewQueue
};
