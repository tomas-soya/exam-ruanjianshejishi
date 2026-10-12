/**
 * @ruankao/exam-contracts - Scoring Rules & Evaluation Engine Interfaces
 */

import { ObjectiveScoreItem, CaseScoringResult, CaseSubScore } from './types';

/**
 * Deterministically grades an objective question.
 * Invariant: Score is 1 if normalized user answer matches effective answer, else 0.
 */
export function gradeObjectiveQuestion(
  questionId: string,
  userAnswer: string | null | undefined,
  effectiveAnswer: string,
  pointWeight = 1
): ObjectiveScoreItem {
  const normUser = (userAnswer || '').trim().toUpperCase();
  const normTarget = (effectiveAnswer || '').trim().toUpperCase();

  if (normUser.length === 0) {
    return {
      questionId,
      userAnswer: '',
      effectiveAnswer: normTarget,
      isCorrect: null,
      score: null,
      maxScore: pointWeight,
      status: 'unanswered'
    };
  }

  const isCorrect = normUser === normTarget;
  const score = isCorrect ? pointWeight : 0;

  return {
    questionId,
    userAnswer: normUser,
    effectiveAnswer: normTarget,
    isCorrect,
    score,
    maxScore: pointWeight,
    status: isCorrect ? 'correct' : 'wrong'
  };
}

/**
 * Validates a case question scoring result.
 * Ensures points are bounded and detects anomalies requiring human review.
 */
export function validateCaseScoreResult(
  result: Partial<CaseScoringResult>,
  defaultMaxPoints = 15
): CaseScoringResult {
  const maxPoints = typeof result.maxPoints === 'number' && result.maxPoints > 0
    ? result.maxPoints
    : defaultMaxPoints;

  let points = typeof result.points === 'number' ? result.points : 0;
  let needsHumanReview = Boolean(result.needsHumanReview);

  // Bounds enforcement
  if (points < 0) {
    points = 0;
    needsHumanReview = true;
  }
  if (points > maxPoints) {
    points = maxPoints;
    needsHumanReview = true;
  }

  const breakdown: CaseSubScore[] = Array.isArray(result.breakdown)
    ? result.breakdown.map((b, idx) => ({
        subQuestionIndex: b.subQuestionIndex ?? idx + 1,
        subQuestionTitle: b.subQuestionTitle || `问题${idx + 1}`,
        points: Math.max(0, Math.min(b.points ?? 0, b.maxPoints ?? 4)),
        maxPoints: b.maxPoints ?? 4,
        feedback: b.feedback || '',
        reason: b.reason
      }))
    : [];

  return {
    questionId: result.questionId || 'unknown',
    evaluatorType: result.evaluatorType || 'rule',
    points,
    maxPoints,
    feedback: result.feedback || '评分完成',
    breakdown,
    needsHumanReview,
    humanOverridePoints: result.humanOverridePoints ?? null,
    humanNotes: result.humanNotes ?? null
  };
}

/**
 * Calculates effective max score for an exam session.
 * In Software Designer exams, standard 6-question case papers have
 * 4 compulsory (15 pts each) + 1 elective (15 pts, 2-choose-1) = 75 points.
 */
export function calculateEffectiveMaxScore(
  totalQuestions: number,
  subject = 'objective',
  isFullPaper = true
): number {
  if (subject === 'case') {
    if (isFullPaper && totalQuestions === 6) {
      return 75;
    }
    return totalQuestions * 15;
  }
  return totalQuestions;
}

/**
 * Resolves elective question selection for standard 6-question case papers.
 * Questions 1..4 (group 1..4) are compulsory.
 * Questions 5..6 (group 5..6) are 2-choose-1 elective.
 */
export function resolveCaseElectiveSelection<T extends { id: string }>(
  q5: T,
  q6: T,
  answersMap: Map<string, any> | Record<string, any>,
  explicitSelectedId?: string | null
): {
  selectedId: string;
  unselectedId: string;
  hasBothAnswered: boolean;
  hasNeitherAnswered: boolean;
  selectedReason: string;
} {
  const getAns = (id: string) => {
    if (answersMap instanceof Map) return answersMap.get(id);
    return answersMap ? answersMap[id] : undefined;
  };

  const isPopulated = (val: any) => {
    if (val === null || val === undefined) return false;
    const ans = val && typeof val === 'object' && 'userAnswer' in val ? val.userAnswer : val;
    if (typeof ans === 'string') return ans.trim().length > 0;
    if (typeof ans === 'object') {
      return Object.values(ans).some((v: any) => v && String(v).trim().length > 0);
    }
    return Boolean(ans);
  };

  const ans5Populated = isPopulated(getAns(q5.id));
  const ans6Populated = isPopulated(getAns(q6.id));
  const hasBothAnswered = ans5Populated && ans6Populated;
  const hasNeitherAnswered = !ans5Populated && !ans6Populated;

  if (explicitSelectedId === q5.id) {
    return {
      selectedId: q5.id,
      unselectedId: q6.id,
      hasBothAnswered,
      hasNeitherAnswered,
      selectedReason: 'explicit_selection_q5'
    };
  }
  if (explicitSelectedId === q6.id) {
    return {
      selectedId: q6.id,
      unselectedId: q5.id,
      hasBothAnswered,
      hasNeitherAnswered,
      selectedReason: 'explicit_selection_q6'
    };
  }

  if (ans5Populated && !ans6Populated) {
    return {
      selectedId: q5.id,
      unselectedId: q6.id,
      hasBothAnswered,
      hasNeitherAnswered,
      selectedReason: 'single_answered_q5'
    };
  }
  if (!ans5Populated && ans6Populated) {
    return {
      selectedId: q6.id,
      unselectedId: q5.id,
      hasBothAnswered,
      hasNeitherAnswered,
      selectedReason: 'single_answered_q6'
    };
  }

  // If both answered, default to Q5 (first in paper order, never silently taking highest score)
  if (hasBothAnswered) {
    return {
      selectedId: q5.id,
      unselectedId: q6.id,
      hasBothAnswered: true,
      hasNeitherAnswered: false,
      selectedReason: 'both_answered_default_q5'
    };
  }

  // Neither answered, default to Q5 as standard tracked slot
  return {
    selectedId: q5.id,
    unselectedId: q6.id,
    hasBothAnswered: false,
    hasNeitherAnswered: true,
    selectedReason: 'neither_answered_default_q5'
  };
}

