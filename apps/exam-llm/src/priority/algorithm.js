'use strict';

/**
 * Dynamic Review Priority Mathematical Engine
 * 
 * Combines:
 * 1. Historical Loss Rate (失分率) - 45% weight
 * 2. Recency of Failure (近期失分衰减) - 35% weight
 * 3. Spaced Repetition Review Urgency (复习周期遗忘度) - 20% weight
 */

const WEIGHT_LOSS_RATE = 0.45;
const WEIGHT_RECENCY = 0.35;
const WEIGHT_CYCLE = 0.20;

/**
 * Calculates the review priority score for a single question.
 * 
 * @param {object} item
 * @param {string} item.questionId
 * @param {number} [item.wrongCount=0]
 * @param {number} [item.totalAttempts]
 * @param {string|number|Date} [item.firstWrongAt]
 * @param {string|number|Date} [item.lastWrongAt]
 * @param {string|number|Date|null} [item.lastReviewedAt]
 * @param {number} [item.intervalDays=1]
 * @param {number} [item.repetitions=0]
 * @param {number} [item.easeFactor=2.5]
 * @param {boolean} [item.mastered=false]
 * @param {Date|number} [now=Date.now()]
 * @returns {{priorityScore: number, breakdown: object, explainSummary: string}}
 */
function calculateQuestionPriority(item, now = Date.now()) {
  const currentTime = typeof now === 'number' ? now : (now instanceof Date ? now.getTime() : Date.now());

  const wrongCount = Math.max(0, Number(item.wrongCount) || 0);
  const totalAttempts = Math.max(wrongCount, Number(item.totalAttempts) || wrongCount || 1);
  const intervalDays = Math.max(1, Number(item.intervalDays) || 1);
  const mastered = Boolean(item.mastered);

  // 1. Loss Rate Factor (0 - 100)
  let lossRateScore = 0;
  if (wrongCount > 0) {
    const rawRate = wrongCount / totalAttempts;
    // Base rate up to 80 points, plus error repetition severity up to 20 points
    lossRateScore = Math.min(100, (rawRate * 80) + Math.min(20, wrongCount * 4));
  }

  // 2. Recency of Failure Factor (0 - 100)
  let recencyScore = 0;
  let daysSinceWrong = 0;
  if (item.lastWrongAt) {
    const wrongTimestamp = new Date(item.lastWrongAt).getTime();
    if (!isNaN(wrongTimestamp)) {
      // Guard against future timestamps
      const diffMs = Math.max(0, currentTime - wrongTimestamp);
      daysSinceWrong = diffMs / (1000 * 60 * 60 * 24);
      // Half-life decay with half-life = 7 days
      recencyScore = Math.min(100, Math.max(0, 100 * Math.pow(2, -daysSinceWrong / 7)));
    }
  }

  // 3. Spaced Repetition / Review Cycle Urgency (0 - 100)
  let cycleScore = 0;
  let daysSinceActivity = 0;
  const lastActivityDate = item.lastReviewedAt || item.lastWrongAt;
  if (lastActivityDate) {
    const activityTimestamp = new Date(lastActivityDate).getTime();
    if (!isNaN(activityTimestamp)) {
      const diffMs = Math.max(0, currentTime - activityTimestamp);
      daysSinceActivity = diffMs / (1000 * 60 * 60 * 24);
      const overdueRatio = daysSinceActivity / intervalDays;

      if (overdueRatio <= 1.0) {
        cycleScore = overdueRatio * 50;
      } else {
        cycleScore = Math.min(100, 50 + (overdueRatio - 1.0) * 25);
      }
    }
  } else {
    // If no history exists at all, assign modest default urgency
    cycleScore = 50;
  }

  // Composite Score
  let compositeScore = (WEIGHT_LOSS_RATE * lossRateScore) +
                       (WEIGHT_RECENCY * recencyScore) +
                       (WEIGHT_CYCLE * cycleScore);

  // If already mastered, discount priority significantly
  if (mastered) {
    compositeScore *= 0.3;
  }

  // Clamp and round
  const priorityScore = Math.round(Math.min(100, Math.max(0, compositeScore)) * 10) / 10;

  const explainSummary = `优先级 ${priorityScore} 分 [失分率: ${lossRateScore.toFixed(1)} * 45% + 近期失分: ${recencyScore.toFixed(1)} * 35% + 周期紧迫度: ${cycleScore.toFixed(1)} * 20%]${mastered ? ' (已掌握折减)' : ''}`;

  return {
    priorityScore,
    breakdown: {
      lossRateScore: Math.round(lossRateScore * 10) / 10,
      recencyScore: Math.round(recencyScore * 10) / 10,
      cycleScore: Math.round(cycleScore * 10) / 10,
      daysSinceWrong: Math.round(daysSinceWrong * 10) / 10,
      daysSinceActivity: Math.round(daysSinceActivity * 10) / 10,
      mastered
    },
    explainSummary
  };
}

module.exports = {
  WEIGHT_LOSS_RATE,
  WEIGHT_RECENCY,
  WEIGHT_CYCLE,
  calculateQuestionPriority
};
