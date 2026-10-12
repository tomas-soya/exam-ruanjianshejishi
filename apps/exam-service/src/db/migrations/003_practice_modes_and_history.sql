-- Migration: 003_practice_modes_and_history.sql
-- Description: Adds practice_mode, answers_revealed, and current_position to exam_sessions for three-mode switching and history resumption

ALTER TABLE exam_sessions ADD COLUMN practice_mode TEXT NOT NULL DEFAULT 'exam';
ALTER TABLE exam_sessions ADD COLUMN answers_revealed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE exam_sessions ADD COLUMN current_position INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_sessions_updated ON exam_sessions(updated_at DESC);
