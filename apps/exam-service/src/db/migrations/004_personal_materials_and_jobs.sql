-- Migration: 004_personal_materials_and_jobs.sql
-- Description: Personal chapter materials, version history, and async sync jobs (AC-B1..B5)

CREATE TABLE IF NOT EXISTS personal_chapter_materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chapter_key TEXT NOT NULL UNIQUE,
  chapter_name TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT 'objective',
  status TEXT NOT NULL DEFAULT 'empty',
  version INTEGER NOT NULL DEFAULT 0,
  markdown_content TEXT,
  metadata_json TEXT,
  last_job_id TEXT,
  last_error TEXT,
  next_review_at TEXT,
  review_stage INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_mat_chapter_key ON personal_chapter_materials(chapter_key);
CREATE INDEX IF NOT EXISTS idx_mat_status ON personal_chapter_materials(status);
CREATE INDEX IF NOT EXISTS idx_mat_next_review ON personal_chapter_materials(next_review_at);

CREATE TABLE IF NOT EXISTS personal_material_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chapter_key TEXT NOT NULL,
  version INTEGER NOT NULL,
  markdown_content TEXT NOT NULL,
  metadata_json TEXT,
  job_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_mat_hist_key_ver ON personal_material_history(chapter_key, version DESC);

CREATE TABLE IF NOT EXISTS material_sync_jobs (
  id TEXT PRIMARY KEY,
  chapter_key TEXT NOT NULL,
  session_id TEXT,
  trigger_type TEXT NOT NULL DEFAULT 'exam_submission',
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  started_at TEXT,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_jobs_status ON material_sync_jobs(status);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_chapter ON material_sync_jobs(chapter_key, status);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_session_chapter ON material_sync_jobs(session_id, chapter_key);
