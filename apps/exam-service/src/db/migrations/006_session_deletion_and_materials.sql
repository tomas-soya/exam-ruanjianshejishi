-- Migration: 006_session_deletion_and_materials.sql
-- Description: Adds is_deleted and deleted_at to exam_sessions for safe session deletion (AC-3, AC-4)

ALTER TABLE exam_sessions ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE exam_sessions ADD COLUMN deleted_at TEXT;

CREATE INDEX IF NOT EXISTS idx_sessions_is_deleted ON exam_sessions(is_deleted);
