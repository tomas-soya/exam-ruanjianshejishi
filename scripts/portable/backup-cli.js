'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
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

function computeDbIdentity(dbPath) {
  return crypto.createHash('sha256').update(path.resolve(dbPath)).digest('hex');
}

async function tryHttpExport(backupFile, port = 3124, expectedDbPath = null) {
  const expectedDbId = expectedDbPath ? computeDbIdentity(expectedDbPath) : null;
  return new Promise((resolve) => {
    const req = http.get({
      host: '127.0.0.1',
      port,
      path: '/api/v1/system/db-export',
      headers: {
        Host: `127.0.0.1:${port}`
      },
      timeout: 1500
    }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return resolve(false);
      }
      if (expectedDbId && res.headers['x-ruankao-db-id'] !== expectedDbId) {
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

function verifyBackupIntegrity(backupFile, sourceDbPath = null) {
  let db = null;
  let srcDb = null;
  try {
    db = new DatabaseSync(backupFile);
    db.exec('PRAGMA busy_timeout = 3000; PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;');
    const check = db.prepare('PRAGMA integrity_check').get();
    if (!check || check.integrity_check !== 'ok') {
      throw new Error(`Integrity check failed: ${JSON.stringify(check)}`);
    }

    if (sourceDbPath && fs.existsSync(sourceDbPath)) {
      srcDb = new DatabaseSync(sourceDbPath, { readOnly: true });
      srcDb.exec('PRAGMA busy_timeout = 3000;');
      const tables = srcDb.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      ).all();
      for (const { name } of tables) {
        if (!/^[A-Za-z0-9_]+$/.test(name)) continue;
        const srcCount = srcDb.prepare(`SELECT COUNT(*) AS count FROM "${name}"`).get().count;
        const bakCount = db.prepare(`SELECT COUNT(*) AS count FROM "${name}"`).get().count;
        if (bakCount !== srcCount) {
          throw new Error(`Table ${name} row count mismatch: source=${srcCount}, backup=${bakCount}`);
        }
      }
    }
    return true;
  } finally {
    if (srcDb) {
      try { srcDb.close(); } catch {}
    }
    if (db) {
      try { db.close(); } catch {}
    }
    try {
      if (fs.existsSync(backupFile + '-shm')) fs.unlinkSync(backupFile + '-shm');
      if (fs.existsSync(backupFile + '-wal')) fs.unlinkSync(backupFile + '-wal');
    } catch {}
  }
}

async function performBackup(appDir, options = {}) {
  const dataDir = path.join(appDir, 'data');
  const dbPath = path.join(dataDir, 'app.db');
  const backupsDir = path.join(dataDir, 'backups');
  const busyTimeoutMs = Number.isFinite(options.busyTimeoutMs) ? options.busyTimeoutMs : 3000;

  if (!fs.existsSync(dbPath)) {
    console.log('[提示] 尚未生成做题记录 (data/app.db 暂不存在)。');
    return true;
  }

  try {
    if (!fs.existsSync(backupsDir)) {
      fs.mkdirSync(backupsDir, { recursive: true });
    }
  } catch (dirErr) {
    console.error('[备份错误] 创建备份目录失败:', dirErr.message);
    return false;
  }

  const timestamp = formatTimestamp();
  const suffix = String(process.pid) + '_' + Math.random().toString(36).slice(2, 6);
  const backupFile = options.targetFile || path.join(backupsDir, `app_backup_${timestamp}.db`);
  const tempBackupFile = `${backupFile}.${suffix}.tmp`;

  console.log('[Ruankao Backup] 正在执行做题记录一致性备份...');

  // 1. Prefer verified same-instance HTTP export when the local server is running
  let success = await tryHttpExport(tempBackupFile, options.port, dbPath);

  // 2. Otherwise use SQLite VACUUM INTO to create a consistent snapshot including all committed WAL rows
  if (!success) {
    let localDb = null;
    try {
      if (fs.existsSync(tempBackupFile)) {
        fs.unlinkSync(tempBackupFile);
      }
      localDb = new DatabaseSync(dbPath);
      localDb.exec(`PRAGMA busy_timeout = ${Math.max(0, Math.floor(busyTimeoutMs))};`);
      const escapedTarget = tempBackupFile.replace(/'/g, "''");
      localDb.exec(`VACUUM INTO '${escapedTarget}';`);
      success = true;
    } catch (snapshotErr) {
      console.error('[备份错误] 创建 SQLite 一致性快照失败:', snapshotErr.message);
      try {
        if (fs.existsSync(tempBackupFile)) fs.unlinkSync(tempBackupFile);
      } catch {}
      return false;
    } finally {
      if (localDb) {
        try { localDb.close(); } catch {}
      }
    }
  }

  // 3. Verify backup integrity and row consistency before promoting temp file
  try {
    verifyBackupIntegrity(tempBackupFile, dbPath);
    if (fs.existsSync(backupFile)) {
      fs.unlinkSync(backupFile);
    }
    fs.renameSync(tempBackupFile, backupFile);
  } catch (verifyErr) {
    console.error('[备份错误] 备份产物完整性校验失败:', verifyErr.message);
    try {
      if (fs.existsSync(tempBackupFile)) fs.unlinkSync(tempBackupFile);
    } catch {}
    return false;
  }

  const stat = fs.statSync(backupFile);
  console.log(`[成功] 做题记录已安全备份到: ${path.relative(appDir, backupFile)}`);
  console.log(`       文件大小: ${(stat.size / 1024).toFixed(1)} KB，SQLite 完整性校验: 通过`);
  return true;
}

if (require.main === module) {
  const appDir = process.env.RUANKAO_APP_DIR
    ? path.resolve(process.env.RUANKAO_APP_DIR)
    : path.resolve(__dirname, '..');
  const targetFile = process.env.RUANKAO_BACKUP_TARGET
    ? path.resolve(process.env.RUANKAO_BACKUP_TARGET)
    : undefined;
  performBackup(appDir, { targetFile })
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
  verifyBackupIntegrity,
  computeDbIdentity
};
