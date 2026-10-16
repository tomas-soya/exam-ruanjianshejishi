-- Intermediate, source-reviewed cards survive a failed chapter update.
CREATE TABLE IF NOT EXISTS material_review_checkpoints (
  chapter_key TEXT NOT NULL,
  unit_key TEXT NOT NULL,
  cache_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (chapter_key, unit_key)
);
