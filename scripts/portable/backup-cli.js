'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { DatabaseSync } = require('node:sqlite');

function formatTimestamp(d = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  const yyyy = d.getFullYear();
  const MM = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `${yyyy}${MM}${dd}_${hh}${mm}${ss}`;
}

async function tryHttpExport(backupFile, port = 3124) {
  return new Promise((resolve) => {
    const req = http.get({
      host: '127.0.0.1',
      port,
      path: '/api/v1/system/db-export',
      timeout: 1500
    }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return resolve(false);
      }
      const fileStream = fs.createWriteStream(backupFile);
      res.pipe(fileStream);
      fileStream.on('finish', () => {
        fileStream.close(() => resolve(true));
      });
      fileStream.on('error', () => {
        try { fs.unlinkSync(backupFile); } catch {}
        resolve(false);
      });
    });

    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

function verifyBackupIntegrity(backupFile) {
  let db = null;
  try {
    db = new DatabaseSync(backupFile);
    db.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;');
    const check = db.prepare('PRAGMA integrity_check').get();
    if (!check || check.integrity_check !== 'ok') {
      throw new Error(`Integrity check failed: ${JSON.stringify(check)}`);
    }
    return true;
  } finally {
    if (db) {
      try { db.close(); } catch {}
    }
    try {
      if (fs.existsSync(backupFile + '-shm')) fs.unlinkSync(backupFile + '-shm');
      if (fs.existsSync(backupFile + '-wal')) fs.unlinkSync(backupFile + '-wal');
    } catch {}
  }
}

async function performBackup(appDir) {
  const dataDir = path.join(appDir, 'data');
  const dbPath = path.join(dataDir, 'app.db');
  const backupsDir = path.join(dataDir, 'backups');

  if (!fs.existsSync(dbPath)) {
    console.log('[提示] 尚未生成做题记录 (data/app.db 暂不存在)。');
    return true;
  }

  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }

  const timestamp = formatTimestamp();
  const backupFile = path.join(backupsDir, `app_backup_${timestamp}.db`);

  console.log('[Ruankao Backup] 正在执行做题记录一致性备份...');

  // 1. If unified-server is currently running, prefer hot export via local HTTP endpoint
  // This guarantees active WAL entries are fully flushed with 0 locking contention
  let success = await tryHttpExport(backupFile);

  // 2. If server is offline or HTTP is unavailable, perform direct SQLite WAL checkpoint + copy
  if (!success) {
    let localDb = null;
    try {
      localDb = new DatabaseSync(dbPath);
      // Flush WAL to the main database file
      localDb.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    } catch (e) {
      console.warn('[备份提示] 独占锁或断开重连:', e.message);
    } finally {
      if (localDb) {
        try { localDb.close(); } catch {}
      }
    }

    try {
      fs.copyFileSync(dbPath, backupFile);
      success = true;
    } catch (copyErr) {
      console.error('[备份错误] 复制数据库文件失败:', copyErr.message);
      return false;
    }
  }

  // 3. Verify backup file integrity
  try {
    verifyBackupIntegrity(backupFile);
  } catch (verifyErr) {
    console.error('[备份错误] 备份产物完整性校验失败:', verifyErr.message);
    try { fs.unlinkSync(backupFile); } catch {}
    return false;
  }

  const stat = fs.statSync(backupFile);
  console.log(`[成功] 做题记录已安全备份到: ${path.relative(appDir, backupFile)}`);
  console.log(`       文件大小: ${(stat.size / 1024).toFixed(1)} KB，SQLite 完整性校验: 通过`);
  return true;
}

if (require.main === module) {
  const appDir = path.resolve(__dirname, '..');
  performBackup(appDir)
    .then((ok) => {
      if (!ok) {
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error('[备份错误] 未捕获异常:', err);
      process.exit(1);
    });
}

module.exports = {
  performBackup,
  verifyBackupIntegrity
};
