'use strict';

/**
 * Personal Chapter Materials & Sync Jobs Repository (AC-B1..B5)
 * Idempotent, transaction-safe SQLite operations for personal review documents.
 */

function getChapterMaterial(db, chapterKey) {
  if (!chapterKey) return null;
  const stmt = db.prepare(`
    SELECT * FROM personal_chapter_materials WHERE chapter_key = ?
  `);
  return stmt.get(chapterKey) || null;
}

function listChapterMaterials(db) {
  const stmt = db.prepare(`
    SELECT * FROM personal_chapter_materials ORDER BY id ASC
  `);
  return stmt.all() || [];
}

function saveChapterMaterial(db, {
  chapterKey,
  chapterName,
  subject = 'objective',
  status = 'updated',
  version = 1,
  markdownContent = '',
  metadataJson = '{}',
  lastJobId = null,
  lastError = null,
  nextReviewAt = null,
  reviewStage = 1
}) {
  const now = new Date().toISOString();
  const existing = getChapterMaterial(db, chapterKey);

  if (existing) {
    const stmt = db.prepare(`
      UPDATE personal_chapter_materials
      SET chapter_name = ?,
          subject = ?,
          status = ?,
          version = ?,
          markdown_content = ?,
          metadata_json = ?,
          last_job_id = ?,
          last_error = ?,
          next_review_at = ?,
          review_stage = ?,
          updated_at = ?
      WHERE chapter_key = ?
    `);
    stmt.run(
      chapterName,
      subject,
      status,
      version,
      markdownContent,
      metadataJson,
      lastJobId,
      lastError,
      nextReviewAt,
      reviewStage,
      now,
      chapterKey
    );
  } else {
    const stmt = db.prepare(`
      INSERT INTO personal_chapter_materials (
        chapter_key, chapter_name, subject, status, version,
        markdown_content, metadata_json, last_job_id, last_error,
        next_review_at, review_stage, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      chapterKey,
      chapterName,
      subject,
      status,
      version,
      markdownContent,
      metadataJson,
      lastJobId,
      lastError,
      nextReviewAt,
      reviewStage,
      now,
      now
    );
  }

  return getChapterMaterial(db, chapterKey);
}

function updateChapterStatus(db, chapterKey, { status, lastJobId = null, lastError = null }) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    UPDATE personal_chapter_materials
    SET status = ?,
        last_job_id = COALESCE(?, last_job_id),
        last_error = ?,
        updated_at = ?
    WHERE chapter_key = ?
  `);
  stmt.run(status, lastJobId, lastError, now, chapterKey);
  return getChapterMaterial(db, chapterKey);
}

function saveMaterialHistory(db, { chapterKey, version, markdownContent, metadataJson = '{}', jobId = null }) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO personal_material_history (
      chapter_key, version, markdown_content, metadata_json, job_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(chapterKey, version, markdownContent, metadataJson, jobId, now);
}

function getMaterialHistory(db, chapterKey) {
  const stmt = db.prepare(`
    SELECT * FROM personal_material_history WHERE chapter_key = ? ORDER BY version DESC
  `);
  return stmt.all(chapterKey) || [];
}

function createSyncJob(db, {
  id,
  chapterKey,
  sessionId = null,
  triggerType = 'exam_submission',
  payloadJson = '{}'
}) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO material_sync_jobs (
      id, chapter_key, session_id, trigger_type, status,
      attempt_count, error_message, payload_json, created_at
    ) VALUES (?, ?, ?, ?, 'pending', 0, NULL, ?, ?)
  `);
  stmt.run(id, chapterKey, sessionId, triggerType, payloadJson, now);
  return getSyncJob(db, id);
}

function getSyncJob(db, jobId) {
  const stmt = db.prepare(`
    SELECT * FROM material_sync_jobs WHERE id = ?
  `);
  return stmt.get(jobId) || null;
}

function findJobBySessionAndChapter(db, sessionId, chapterKey) {
  if (!sessionId || !chapterKey) return null;
  const stmt = db.prepare(`
    SELECT * FROM material_sync_jobs
    WHERE session_id = ? AND chapter_key = ? AND status IN ('pending', 'processing', 'done')
    ORDER BY created_at DESC LIMIT 1
  `);
  return stmt.get(sessionId, chapterKey) || null;
}

function findPendingJobs(db) {
  const stmt = db.prepare(`
    SELECT * FROM material_sync_jobs WHERE status = 'pending' ORDER BY created_at ASC
  `);
  return stmt.all() || [];
}

function findProcessingJobs(db) {
  const stmt = db.prepare(`
    SELECT * FROM material_sync_jobs WHERE status = 'processing' ORDER BY created_at ASC
  `);
  return stmt.all() || [];
}

function updateJobStatus(db, jobId, {
  status,
  errorMessage = null,
  startedAt = null,
  completedAt = null
}) {
  const stmt = db.prepare(`
    UPDATE material_sync_jobs
    SET status = ?,
        attempt_count = attempt_count + (CASE WHEN ? = 'processing' THEN 1 ELSE 0 END),
        error_message = ?,
        started_at = COALESCE(?, started_at),
        completed_at = COALESCE(?, completed_at)
    WHERE id = ?
  `);
  stmt.run(status, status, errorMessage, startedAt, completedAt, jobId);
  return getSyncJob(db, jobId);
}

function resetProcessingJobsToPending(db) {
  const stmt = db.prepare(`
    UPDATE material_sync_jobs
    SET status = 'pending',
        started_at = NULL
    WHERE status = 'processing'
  `);
  return stmt.run();
}

function loadReviewCheckpoints(db, chapterKey) {
  const result = {};
  for (const row of db.prepare('SELECT unit_key,cache_json FROM material_review_checkpoints WHERE chapter_key=?').all(chapterKey)) {
    try { result[row.unit_key] = JSON.parse(row.cache_json); } catch {}
  }
  return result;
}

function saveReviewCheckpoint(db, chapterKey, unitKey, item) {
  db.prepare(`INSERT INTO material_review_checkpoints(chapter_key,unit_key,cache_json,updated_at) VALUES(?,?,?,?)
    ON CONFLICT(chapter_key,unit_key) DO UPDATE SET cache_json=excluded.cache_json,updated_at=excluded.updated_at`)
    .run(chapterKey, unitKey, JSON.stringify(item), new Date().toISOString());
}

module.exports = {
  getChapterMaterial,
  listChapterMaterials,
  saveChapterMaterial,
  updateChapterStatus,
  saveMaterialHistory,
  getMaterialHistory,
  createSyncJob,
  getSyncJob,
  findJobBySessionAndChapter,
  findPendingJobs,
  findProcessingJobs,
  updateJobStatus,
  resetProcessingJobsToPending,
  loadReviewCheckpoints,
  saveReviewCheckpoint
};
