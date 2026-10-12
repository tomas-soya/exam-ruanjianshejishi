-- Migration: 002_performance_indexes.sql
-- Description: Composite indexes for study analysis, review queries, and automated timestamp triggers

CREATE INDEX IF NOT EXISTS idx_sessions_updated ON exam_sessions(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_wrong_questions_priority ON wrong_questions(mastered, wrong_count DESC, last_wrong_at DESC);

-- Automated updated_at triggers
CREATE TRIGGER IF NOT EXISTS trg_exam_sessions_updated_at
AFTER UPDATE ON exam_sessions
FOR EACH ROW
BEGIN
  UPDATE exam_sessions SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_exam_answers_updated_at
AFTER UPDATE ON exam_answers
FOR EACH ROW
BEGIN
  UPDATE exam_answers SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_review_queue_updated_at
AFTER UPDATE ON review_queue
FOR EACH ROW
BEGIN
  UPDATE review_queue SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = OLD.id;
END;
