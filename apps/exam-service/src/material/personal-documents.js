'use strict';

const { randomUUID } = require('node:crypto');
const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;

function fail(message, statusCode = 400) {
  throw Object.assign(new Error(message), { code: 'PERSONAL_DOCUMENT_ERROR', statusCode });
}

function validateDocument({ title, markdown } = {}) {
  if (typeof title !== 'string' || !title.trim() || title.trim().length > 120) fail('标题须为 1–120 个字符');
  if (typeof markdown !== 'string' || !markdown.trim()) fail('Markdown 内容不能为空');
  if (Buffer.byteLength(markdown, 'utf8') > MAX_MARKDOWN_BYTES) fail('Markdown 文件不能超过 2 MB', 413);
  if (markdown.includes('\0') || /<(?:script|iframe|object|embed|style)\b/i.test(markdown)) fail('Markdown 包含不支持的控制字符或可执行 HTML');
  // Mathematical notation in actual code is preserved. Prose must work offline.
  const prose = markdown.replace(/^([ \t]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\2[ \t]*$/gm, '').replace(/`[^`\n]*`/g, '');
  if (/\$\$|\$[^\n$]+\$|\\[([]|\\(?:begin|frac|sqrt|sum|int)\b/.test(prose)) fail('公式请使用纯文本或 Unicode，不支持 LaTeX 数学渲染');
  return { title: title.trim(), markdown: markdown.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n') };
}

function listDocuments(db) {
  return db.prepare(`SELECT id, title, current_version AS currentVersion, created_at AS createdAt,
    updated_at AS updatedAt FROM personal_documents ORDER BY updated_at DESC, id`).all();
}

function getDocument(db, id, version) {
  const doc = db.prepare('SELECT id, current_version AS currentVersion FROM personal_documents WHERE id = ?').get(id);
  if (!doc) fail('个人资料不存在', 404);
  const selected = version === undefined ? doc.currentVersion : Number(version);
  if (!Number.isSafeInteger(selected) || selected < 1) fail('版本号无效');
  const row = db.prepare(`SELECT title, version, markdown, restored_from AS restoredFrom, created_at AS createdAt
    FROM personal_document_versions WHERE document_id = ? AND version = ?`).get(id, selected);
  if (!row) fail('资料版本不存在', 404);
  const versions = db.prepare(`SELECT version, title, restored_from AS restoredFrom, created_at AS createdAt
    FROM personal_document_versions WHERE document_id = ? ORDER BY version DESC`).all(id);
  return { ...doc, ...row, versions };
}

function saveDocument(db, payload, restoredFrom = null) {
  const content = validateDocument(payload);
  const id = payload.id || randomUUID();
  if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(id)) fail('资料编号无效');
  db.exec('BEGIN IMMEDIATE');
  try {
    const previous = db.prepare('SELECT current_version AS version FROM personal_documents WHERE id = ?').get(id);
    if (payload.id && !previous) fail('个人资料不存在', 404);
    if (previous && payload.baseVersion !== previous.version) fail('资料已有新版本，请刷新后重新预览再保存', 409);
    const version = (previous?.version || 0) + 1;
    const now = new Date().toISOString();
    if (!previous) db.prepare('INSERT INTO personal_documents(id,title,current_version,created_at,updated_at) VALUES(?,?,?,?,?)')
      .run(id, content.title, version, now, now);
    else db.prepare('UPDATE personal_documents SET title = ?, current_version = ?, updated_at = ? WHERE id = ?')
      .run(content.title, version, now, id);
    db.prepare(`INSERT INTO personal_document_versions(document_id,version,title,markdown,restored_from,created_at)
      VALUES(?,?,?,?,?,?)`).run(id, version, content.title, content.markdown, restoredFrom, now);
    db.exec('COMMIT');
    return getDocument(db, id);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function restoreDocument(db, id, { version, baseVersion } = {}) {
  if (version === undefined) fail('请选择要恢复的历史版本');
  const old = getDocument(db, id, version);
  return saveDocument(db, { id, title: old.title, markdown: old.markdown, baseVersion }, old.version);
}

module.exports = { MAX_MARKDOWN_BYTES, validateDocument, listDocuments, getDocument, saveDocument, restoreDocument };
