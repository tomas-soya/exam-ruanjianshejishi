-- Migration: 001_initial_schema.sql
-- Description: Core tables for session persistence, answers, wrong questions, spaced review, and case grading

CREATE TABLE IF NOT EXISTS schema_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS exam_sessions (
  id TEXT PRIMARY KEY,
  session_mode TEXT NOT NULL CHECK(session_mode IN ('paper', 'chapter', 'wrong_questions')),
  paper_id TEXT,
  chapter TEXT,
  title TEXT NOT NULL,
  total_questions INTEGER NOT NULL DEFAULT 0,
  answered_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK(status IN ('in_progress', 'submitted')),
  score REAL,
  max_score REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  submitted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_status ON exam_sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_paper ON exam_sessions(paper_id);

CREATE TABLE IF NOT EXISTS exam_answers (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL,
  question_type TEXT NOT NULL CHECK(question_type IN ('objective', 'case')),
  user_answer_json TEXT NOT NULL,
  is_correct INTEGER, -- 1 for true, 0 for false, NULL if pending/draft
  score REAL,
  max_score REAL NOT NULL DEFAULT 1.0,
  score_breakdown_json TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(session_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_answers_session ON exam_answers(session_id);
CREATE INDEX IF NOT EXISTS idx_answers_question ON exam_answers(question_id);

CREATE TABLE IF NOT EXISTS wrong_questions (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL UNIQUE,
  paper_id TEXT NOT NULL,
  chapter TEXT NOT NULL,
  question_type TEXT NOT NULL CHECK(question_type IN ('objective', 'case')),
  first_wrong_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_wrong_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  wrong_count INTEGER NOT NULL DEFAULT 1,
  mastered INTEGER NOT NULL DEFAULT 0 CHECK(mastered IN (0, 1)),
  last_reviewed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_wrong_questions_chapter ON wrong_questions(chapter);
CREATE INDEX IF NOT EXISTS idx_wrong_questions_mastered ON wrong_questions(mastered);

CREATE TABLE IF NOT EXISTS review_queue (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL UNIQUE,
  priority_score REAL NOT NULL DEFAULT 1.0,
  next_review_at TEXT NOT NULL,
  interval_days REAL NOT NULL DEFAULT 1.0,
  repetitions INTEGER NOT NULL DEFAULT 0,
  ease_factor REAL NOT NULL DEFAULT 2.5,
  state TEXT NOT NULL DEFAULT 'learning' CHECK(state IN ('learning', 'reviewing', 'mastered')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_review_queue_next ON review_queue(next_review_at);
CREATE INDEX IF NOT EXISTS idx_review_queue_priority ON review_queue(priority_score DESC);

CREATE TABLE IF NOT EXISTS case_reviews (
  id TEXT PRIMARY KEY,
  answer_id TEXT NOT NULL REFERENCES exam_answers(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL,
  evaluator_type TEXT NOT NULL CHECK(evaluator_type IN ('llm', 'rule', 'human')),
  points REAL NOT NULL DEFAULT 0,
  max_points REAL NOT NULL DEFAULT 15,
  feedback TEXT,
  breakdown_json TEXT,
  needs_human_review INTEGER NOT NULL DEFAULT 0 CHECK(needs_human_review IN (0, 1)),
  human_override_points REAL,
  human_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_case_reviews_session ON case_reviews(session_id);
CREATE INDEX IF NOT EXISTS idx_case_reviews_question ON case_reviews(question_id);
