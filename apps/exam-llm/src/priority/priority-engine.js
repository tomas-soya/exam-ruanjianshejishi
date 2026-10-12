'use strict';

const { calculateQuestionPriority } = require('./algorithm');

/**
 * Dynamic Review Priority Engine
 * 
 * Provides:
 * 1. Multi-factor prioritization combining error rate, recency, and spacing cycle.
 * 2. Deterministic and stable multi-level tie-breaking sorting.
 * 3. SM-2 Spaced Repetition interval calculation.
 * 4. 100% offline local computation with graceful boundary handling.
 */
class PriorityEngine {
  constructor(options = {}) {
    this.options = options;
  }

  /**
   * Prioritizes and ranks a list of review candidates.
   * 
   * @param {Array<object>} items
   * @param {object} [options]
   * @param {Date|number} [options.now=Date.now()]
   * @param {boolean} [options.excludeMastered=false]
   * @param {string} [options.chapter]
   * @param {'objective'|'case'} [options.questionType]
   * @param {number} [options.limit]
   * @param {number} [options.offset=0]
   * @returns {Array<object>}
   */
  rankQueue(items, options = {}) {
    if (!Array.isArray(items) || items.length === 0) {
      return [];
    }

    const now = options.now || Date.now();
    const excludeMastered = Boolean(options.excludeMastered);

    // 1. Filter candidates
    let candidates = items.filter(item => {
      if (!item || !item.questionId) return false;
      if (excludeMastered && item.mastered) return false;
      if (options.chapter && item.chapter !== options.chapter) return false;
      if (options.questionType && item.questionType !== options.questionType) return false;
      return true;
    });

    // 2. Score each candidate
    const scoredList = candidates.map(item => {
      const evaluation = calculateQuestionPriority(item, now);
      return {
        ...item,
        priorityScore: evaluation.priorityScore,
        breakdown: evaluation.breakdown,
        explainSummary: evaluation.explainSummary
      };
    });

    // 3. Deterministic Stable Sorting
    // Primary: priorityScore (desc)
    // Secondary: lastWrongAt (desc)
    // Tertiary: questionId (asc)
    scoredList.sort((a, b) => {
      if (b.priorityScore !== a.priorityScore) {
        return b.priorityScore - a.priorityScore;
      }

      const timeA = a.lastWrongAt ? new Date(a.lastWrongAt).getTime() : 0;
      const timeB = b.lastWrongAt ? new Date(b.lastWrongAt).getTime() : 0;
      if (timeB !== timeA) {
        return timeB - timeA;
      }

      return String(a.questionId).localeCompare(String(b.questionId));
    });

    // 4. Pagination / Slicing
    const offset = Math.max(0, options.offset || 0);
    if (typeof options.limit === 'number' && options.limit > 0) {
      return scoredList.slice(offset, offset + options.limit);
    }

    return scoredList.slice(offset);
  }

  /**
   * Calculates next spaced repetition interval using the SM-2 algorithm.
   * 
   * @param {object} params
   * @param {number} [params.repetitions=0] Previous consecutive correct reviews
   * @param {number} [params.intervalDays=1] Previous interval in days
   * @param {number} [params.easeFactor=2.5] Previous SM-2 ease factor (>= 1.3)
   * @param {number} params.quality Response rating (0-5, where >=3 is passing/correct)
   * @param {Date|number} [params.now=Date.now()]
   * @returns {{repetitions: number, intervalDays: number, easeFactor: number, nextReviewAt: string}}
   */
  calculateNextInterval({
    repetitions = 0,
    intervalDays = 1,
    easeFactor = 2.5,
    quality = 4,
    now = Date.now()
  }) {
    const q = Math.max(0, Math.min(5, Math.round(Number(quality) || 0)));
    let rep = Math.max(0, Number(repetitions) || 0);
    let interval = Math.max(1, Number(intervalDays) || 1);
    let ef = Math.max(1.3, Number(easeFactor) || 2.5);

    if (q >= 3) {
      // Correct response
      if (rep === 0) {
        interval = 1;
      } else if (rep === 1) {
        interval = 6;
      } else {
        interval = Math.round(interval * ef);
      }
      rep += 1;
    } else {
      // Incorrect response: reset review streak
      rep = 0;
      interval = 1;
    }

    // Update Ease Factor (EF' = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)))
    ef = ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
    if (ef < 1.3) ef = 1.3;
    ef = Math.round(ef * 100) / 100;

    const baseTime = typeof now === 'number' ? now : (now instanceof Date ? now.getTime() : Date.now());
    const nextReviewTimestamp = baseTime + (interval * 24 * 60 * 60 * 1000);
    const nextReviewAt = new Date(nextReviewTimestamp).toISOString();

    return {
      repetitions: rep,
      intervalDays: interval,
      easeFactor: ef,
      nextReviewAt
    };
  }
}

module.exports = {
  PriorityEngine
};
