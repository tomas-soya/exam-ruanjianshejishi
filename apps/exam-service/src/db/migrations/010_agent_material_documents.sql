-- Imported personal Markdown is separate from generated cards and formal study data.
CREATE TABLE personal_documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  current_version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE personal_document_versions (
  document_id TEXT NOT NULL REFERENCES personal_documents(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  title TEXT NOT NULL,
  markdown TEXT NOT NULL,
  restored_from INTEGER,
  created_at TEXT NOT NULL,
  PRIMARY KEY (document_id, version)
);
