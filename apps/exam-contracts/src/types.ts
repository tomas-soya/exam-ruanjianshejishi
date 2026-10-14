/**
 * @ruankao/exam-contracts - Shared Interface Definitions
 * 
 * Boundary & Security Principles:
 * 1. Strict Answer Isolation: Pre-submit questions MUST NOT leak answers, analysis,
 *    solution images, or solution code blocks.
 * 2. Deterministic Objective Scoring: Automated grading directly matches user choices
 *    against effective_answer.
 * 3. Pluggable Case Evaluation: Case questions support manual review, rule-based grading,
 *    or LLM evaluation (W3C adapter).
 * 4. Local-Only Binding: 127.0.0.1 bound service with local token authorization.
 */

// ==========================================
// 1. Paper and Question Contracts
// ==========================================

export type SubjectType = 'objective' | 'case';

export interface QuestionOption {
  key: string;  // e.g. "A", "B", "C", "D"
  text: string;
  images?: QuestionAsset[]; // Stem assets belonging to this option, never solutions
}

export type AssetType = 'stem' | 'solution';

export interface QuestionAsset {
  type: AssetType;
  localPath: string;
  sha256: string;
  sourceUrl?: string;
}

export interface QuestionCodeBlock {
  type: AssetType;
  code: string;
  language?: string;
}

export interface QuestionAnswers {
  platform_answer: string;
  curated_answer: string | null;
  effective_answer: string;
  correction_reason: string | null;
}

/**
 * Sanitized Objective Question: Safe to send to client BEFORE submission.
 * Completely excludes answers, analysis, solution images, and solution code blocks.
 */
export interface SanitizedObjectiveQuestion {
  id: string;             // e.g. "oq-735cd504c67854131204"
  standardId: string;     // e.g. "ref-2d8c4c5813dcda83f725"
  paperId: string;        // e.g. "sd-2023-05-objective-928ba3c677"
  paperOrder: number;
  subject: 'objective';
  chapter: string;
  sourceAnchor: string;
  questionStem: string;
  options: QuestionOption[];
  codeBlocks: QuestionCodeBlock[]; // Only type === 'stem'
  images: QuestionAsset[];         // Only type === 'stem'
}

export interface SanitizedSubQuestion {
  id: string;
  title: string;
  stem: string;
  images?: QuestionAsset[];
  codeBlocks?: QuestionCodeBlock[];
}

/**
 * Sanitized Case Question: Safe to send to client BEFORE submission.
 * Completely excludes solution_and_analysis, solution code blocks, and solution images.
 */
export interface SanitizedCaseQuestion {
  id: string;             // e.g. "cg-6190ad4dcace361eadae"
  standardId: string;     // e.g. "ref-1168c6e2f539b17713e9"
  paperId: string;        // e.g. "sd-2023-05-case-918de312c1"
  groupOrder: number;
  subject: 'case';
  caseTitle: string;
  chapter: string;
  sourceAnchor: string;
  sharedStem: string;
  subQuestions?: SanitizedSubQuestion[];
  codeBlocks: QuestionCodeBlock[]; // Only type === 'stem'
  images: QuestionAsset[];         // Only type === 'stem'
}

export type SanitizedQuestion = SanitizedObjectiveQuestion | SanitizedCaseQuestion;

/**
 * Full Objective Question with answers and analysis.
 * NEVER send to client before submission.
 */
export interface FullObjectiveQuestion extends SanitizedObjectiveQuestion {
  answers: QuestionAnswers;
  analysis: string;
}

/**
 * Full Case Question with solution and analysis.
 * NEVER send to client before submission.
 */
export interface FullCaseQuestion extends SanitizedCaseQuestion {
  solution_and_analysis: string;
  solutionCodeBlocks: QuestionCodeBlock[];
  solutionImages: QuestionAsset[];
}

export type FullQuestion = FullObjectiveQuestion | FullCaseQuestion;

export interface PaperSummary {
  id: string;
  title: string;
  year: number;
  season: string; // "05" | "11"
  subject: SubjectType;
  totalQuestions: number;
  standardQuestionGroups?: number;
  sourceUrl: string;
}

export interface PaperDetail extends PaperSummary {
  questions: SanitizedQuestion[];
}

// ==========================================
// 2. Exam Session & Persistence Contracts
// ==========================================

export type SessionMode = 'paper' | 'chapter' | 'wrong_questions';
export type PracticeMode = 'exam' | 'practice' | 'memorize';
export type SessionStatus = 'in_progress' | 'submitted';

export interface ExamSession {
  id: string;                       // UUID
  sessionMode: SessionMode;
  practiceMode: PracticeMode;
  answersRevealed: boolean;
  assistanceUsed?: boolean;
  currentPosition: number;
  paperId: string | null;           // null if chapter or wrong_questions mode
  chapter: string | null;
  title: string;
  totalQuestions: number;
  answeredCount: number;
  status: SessionStatus;
  score: number | null;
  maxScore: number;
  createdAt: string;                // ISO 8601
  updatedAt: string;                // ISO 8601
  submittedAt: string | null;       // ISO 8601
}

export interface CreateSessionRequest {
  mode: SessionMode;
  practiceMode?: PracticeMode;
  paperId?: string;
  chapter?: string;
  questionIds?: string[];           // Custom subset or wrong question IDs
  title?: string;
}

export interface UpdateSessionStateRequest {
  practiceMode?: PracticeMode;
  answersRevealed?: boolean;
  assistanceUsed?: boolean;
  currentPosition?: number;
}

export interface SaveAnswerDraftRequest {
  sessionId: string;
  questionId: string;
  questionType: SubjectType;
  userAnswer: string | Record<string, string>; // "A" for objective, or subquestion key-value map for case
}

export interface ExamAnswerRecord {
  id: string;
  sessionId: string;
  questionId: string;
  questionType: SubjectType;
  userAnswer: string | Record<string, string>;
  isCorrect: boolean | null;
  score: number | null;
  maxScore: number;
  scoreBreakdown?: any;
  reviewedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SubmitSessionRequest {
  sessionId: string;
  clientTimestamp?: string;
}

// ==========================================
// 3. Scoring & Case Evaluation Contracts
// ==========================================

export interface ObjectiveScoreItem {
  questionId: string;
  userAnswer: string;
  effectiveAnswer: string;
  isCorrect: boolean | null;
  score: number | null;
  maxScore: number;
  status?: 'correct' | 'wrong' | 'unanswered';
}

export interface CaseSubScore {
  subQuestionIndex: number;
  subQuestionTitle?: string;
  points: number;
  maxPoints: number;
  feedback: string;
  reason?: string;
  status?: 'answered' | 'unanswered';
}

export interface CaseScoringRequest {
  sessionId: string;
  questionId: string;
  userAnswer: Record<string, string> | string;
  sharedStem: string;
  solutionAndAnalysis: string;
  rubric?: Record<string, any>;
}

export interface CaseScoringResult {
  questionId: string;
  evaluatorType: 'llm' | 'rule' | 'human';
  points: number;
  maxPoints: number;
  feedback: string;
  breakdown: CaseSubScore[];
  needsHumanReview: boolean;
  humanOverridePoints?: number | null;
  humanNotes?: string | null;
}

// ==========================================
// 4. Report & Material Anchors
// ==========================================

export interface MaterialAnchor {
  chapter: string;
  topic?: string;
  relativeDocPath: string; // Relative path to 软件设计师复习材料/*.md
  anchorHeading: string;
}

export interface QuestionReportItem {
  question: SanitizedQuestion;
  userAnswer: string | Record<string, string> | null;
  effectiveAnswer?: string;
  isCorrect: boolean | null;
  score: number | null;
  maxScore: number;
  status?: 'correct' | 'wrong' | 'unanswered' | 'case' | 'unselected' | 'pending_scoring';
  pendingScoring?: boolean;
  canRegrade?: boolean;
  scoringMessage?: string;
  analysis?: string;
  solutionCodeBlocks?: QuestionCodeBlock[];
  solutionImages?: QuestionAsset[];
  caseReview?: CaseScoringResult;
  materialAnchor?: MaterialAnchor;
}

export interface SessionReport {
  sessionId: string;
  sessionMode: SessionMode;
  practiceMode: PracticeMode;
  answersRevealed: boolean;
  paperId: string | null;
  chapter: string | null;
  title: string;
  status: SessionStatus;
  score: number | null;
  maxScore: number;
  accuracy: number | null; // null while case scoring is pending
  pendingScoringCount?: number;
  canRegrade?: boolean;
  totalQuestions: number;
  answeredCount: number;
  unansweredCount: number;
  answeredMaxScore: number;
  correctCount: number;
  wrongCount: number;
  submittedAt: string;
  questions: QuestionReportItem[];
}

export interface QuestionSolution {
  questionId: string;
  effectiveAnswer?: string;
  analysis?: string;
  solutionCodeBlocks?: QuestionCodeBlock[];
  solutionImages?: QuestionAsset[];
  solutionAndAnalysis?: string;
}

export interface CheckQuestionResult {
  questionId: string;
  isCorrect: boolean | null;
  score: number | null;
  effectiveAnswer?: string;
  analysis?: string;
  solutionCodeBlocks?: QuestionCodeBlock[];
  solutionImages?: QuestionAsset[];
  solutionAndAnalysis?: string;
  caseReview?: CaseScoringResult;
}

// ==========================================
// 5. Wrong Questions & Review Queue
// ==========================================

export interface WrongQuestionRecord {
  id: string;
  questionId: string;
  paperId: string;
  chapter: string;
  questionType: SubjectType;
  firstWrongAt: string;
  lastWrongAt: string;
  wrongCount: number;
  mastered: boolean;
  lastReviewedAt: string | null;
}

export type ReviewState = 'learning' | 'reviewing' | 'mastered';

export interface ReviewQueueRecord {
  id: string;
  questionId: string;
  priorityScore: number;
  nextReviewAt: string;
  intervalDays: number;
  repetitions: number;
  easeFactor: number;
  state: ReviewState;
  updatedAt: string;
}

// ==========================================
// 6. Generic API Response & Error Wrapper
// ==========================================

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
}

// ==========================================
// 7. Personal Chapter Materials & Sync Jobs (AC-B1..B5)
// ==========================================

export type MaterialStatus = 'empty' | 'pending' | 'processing' | 'updated' | 'failed';

export interface StandardChapter {
  key: string;
  name: string;
  subject: SubjectType;
  docPath: string;
  order: number;
}

export interface PersonalMaterialSummary {
  weakPointsCount: number;
  misconceptionsCount: number;
  tipsCount: number;
  checklistsCount: number;
}

export interface EbbinghausSchedule {
  nextReviewAt: string | null;
  stage: number;
  intervalDays: number;
  isDue: boolean;
}

export interface PersonalChapterMaterial {
  chapterKey: string;
  chapterName: string;
  subject: SubjectType;
  status: MaterialStatus;
  version: number;
  markdownContent: string | null;
  summary: PersonalMaterialSummary;
  ebbinghaus: EbbinghausSchedule;
  lastUpdatedAt: string | null;
  lastJobId: string | null;
  lastError: string | null;
  metadata?: Record<string, any>;
}

export interface MaterialSyncJob {
  id: string;
  chapterKey: string;
  sessionId?: string | null;
  triggerType: 'exam_submission' | 'manual_retry' | 'case_override' | 'manual_refresh';
  status: 'pending' | 'processing' | 'done' | 'failed';
  attemptCount: number;
  errorMessage?: string | null;
  payload: Record<string, any>;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
}

// ==========================================
// 8. Page AI Chat Assistant Contracts (AC-Q1..Q7)
// ==========================================

export type ExamChatContextType = 'question' | 'material' | 'report' | 'general';

export interface ExamChatContext {
  type: ExamChatContextType;
  title: string;
  targetId?: string;       // questionId, chapterKey, or sessionId
  sessionId?: string;      // associated active session if any
  questionStem?: string;
  options?: QuestionOption[];
  sharedStem?: string;
  userAnswer?: string | Record<string, string>;
  chapter?: string;
  scoreSummary?: { score: number; maxScore: number; accuracy: number };
}

export interface ExamChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
}

export interface CitedAnchor {
  chapter: string;
  heading: string;
  docPath: string;
  excerpt?: string;
}

export interface ExamChatRequest {
  context: ExamChatContext;
  userMessage: string;
  history?: ExamChatMessage[];
}

export interface ExamChatResponse {
  replyText: string;
  citedAnchors: CitedAnchor[];
  tokenUsage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  assistanceUsed?: boolean;
}

