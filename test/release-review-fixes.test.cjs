'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { DatabaseSync } = require('node:sqlite');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');

function request(port, urlPath, headers = {}, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: urlPath,
      method,
      headers
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks)
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

test('Review Fix 1: SingleExePackage verifies embedded ZIP SHA-256 marker, upgrades same-date folder, and migrates newest data', (t) => {
  const csSource = fs.readFileSync(path.join(root, 'scripts/portable/SingleExePackage.cs'), 'utf8');
  assert(!csSource.includes('Directory.CreateDirectory(targetFolder);\r\n                ZipFile.ExtractToDirectory(tempZip, currentDir);'),
    'Must not create empty folder before extracting zip to parent');
  assert(csSource.includes('entry.ExtractToFile(destinationPath, true)'),
    'Must use entry.ExtractToFile with overwrite flag');
  assert(csSource.includes('previousDataFolder') && csSource.includes('CopyDirectoryContent'),
    'Must support migrating previous user study data on upgrade');
  assert(csSource.includes('if (File.Exists(launcherExe))') && csSource.includes('LaunchTarget(launcherExe, args);'),
    'Must launch directly if package is verified up-to-date');
  assert(csSource.includes('ComputeStreamSha256') && csSource.includes('.package-sha256'),
    'Must verify embedded ZIP SHA-256 against .package-sha256 completion marker');

  const cscPath = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
  if (process.platform !== 'win32' || !fs.existsSync(cscPath)) {
    return;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ruankao-single-exe-test-'));
  try {
    // Prepare two previous portable directories with different timestamps; newest must win
    const olderDir = path.join(tmpDir, 'RuankaoExam-Portable-20261001', 'data');
    const newerDir = path.join(tmpDir, 'RuankaoExam-Portable-20261005', 'data');
    fs.mkdirSync(olderDir, { recursive: true });
    fs.mkdirSync(newerDir, { recursive: true });

    const olderDbPath = path.join(olderDir, 'app.db');
    const olderDb = new DatabaseSync(olderDbPath);
    olderDb.exec('CREATE TABLE user_progress(id INTEGER PRIMARY KEY, note TEXT);');
    olderDb.prepare('INSERT INTO user_progress(note) VALUES (?)').run('older-study-record');
    olderDb.close();
    const pastTime = new Date(Date.now() - 60000);
    fs.utimesSync(olderDbPath, pastTime, pastTime);

    const newerDbPath = path.join(newerDir, 'app.db');
    const newerDb = new DatabaseSync(newerDbPath);
    newerDb.exec('CREATE TABLE user_progress(id INTEGER PRIMARY KEY, note TEXT);');
    newerDb.prepare('INSERT INTO user_progress(note) VALUES (?)').run('newest-study-record');
    newerDb.close();

    // Pre-populate same-date folder with OLD launcher (no .package-sha256 or stale content)
    const targetFolder = path.join(tmpDir, 'RuankaoExam-Portable-20261012');
    fs.mkdirSync(targetFolder, { recursive: true });
    fs.writeFileSync(path.join(targetFolder, 'version.txt'), '1.0.2', 'utf8');

    const launcherCs = path.join(tmpDir, 'DummyLauncher.cs');
    const writeLauncherSource = (tag) => {
      fs.writeFileSync(launcherCs, [
        'using System;',
        'using System.IO;',
        'class P {',
        '  static void Main() {',
        '    string p = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "launch.log");',
        `    File.WriteAllText(p, "${tag}");`,
        '  }',
        '}'
      ].join('\n'), 'utf8');
    };

    writeLauncherSource('LAUNCH:OLD');
    execFileSync(cscPath, ['/nologo', '/target:exe', `/out:${path.join(targetFolder, '软件设计师刷题平台.exe')}`, launcherCs]);

    // Build embedded ZIP with NEW launcher for the same folder name RuankaoExam-Portable-20261012
    const stageRoot = path.join(tmpDir, 'stage');
    const stageFolder = path.join(stageRoot, 'RuankaoExam-Portable-20261012');
    fs.mkdirSync(path.join(stageFolder, 'data'), { recursive: true });
    fs.writeFileSync(path.join(stageFolder, 'version.txt'), '1.0.4', 'utf8');
    writeLauncherSource('LAUNCH:NEW');
    execFileSync(cscPath, ['/nologo', '/target:exe', `/out:${path.join(stageFolder, '软件设计师刷题平台.exe')}`, launcherCs]);

    const zipPath = path.join(tmpDir, 'embedded.zip');
    const literal = v => `'${v.replaceAll("'", "''")}'`;
    execFileSync('powershell', ['-NoProfile', '-Command',
      `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory(${literal(stageFolder)}, ${literal(zipPath)}, [System.IO.Compression.CompressionLevel]::Optimal, $true)`
    ]);

    const singleExePath = path.join(tmpDir, 'SingleExeTest.exe');
    execFileSync(cscPath, [
      '/nologo',
      '/optimize+',
      '/target:winexe',
      '/r:System.Windows.Forms.dll',
      '/r:System.IO.Compression.FileSystem.dll',
      '/r:System.IO.Compression.dll',
      `/resource:${zipPath}`,
      `/out:${singleExePath}`,
      path.join(root, 'scripts/portable/SingleExePackage.cs')
    ]);

    const waitLaunchLog = () => {
      const logFile = path.join(tmpDir, 'launch.log');
      if (fs.existsSync(logFile)) fs.unlinkSync(logFile);
      execFileSync(singleExePath, [], {
        cwd: tmpDir,
        env: { ...process.env, RUANKAO_SINGLE_EXE_NO_GUI: '1' }
      });
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        if (fs.existsSync(logFile)) {
          const text = fs.readFileSync(logFile, 'utf8').trim();
          if (text) {
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
            return text;
          }
        }
      }
      return null;
    };

    const firstOut = waitLaunchLog();
    assert.equal(firstOut, 'LAUNCH:NEW', 'Same-date stale folder must be upgraded to NEW package');
    assert.equal(fs.readFileSync(path.join(targetFolder, 'version.txt'), 'utf8').trim(), '1.0.4');
    assert(fs.existsSync(path.join(targetFolder, '.package-sha256')), 'Completion marker must be written');

    const secondOut = waitLaunchLog();
    assert.equal(secondOut, 'LAUNCH:NEW', 'Second launch must succeed directly');

    // Verify newest previous data was migrated into targetFolder/data/app.db
    const migratedDb = new DatabaseSync(path.join(targetFolder, 'data', 'app.db'), { readOnly: true });
    const migratedRow = migratedDb.prepare('SELECT note FROM user_progress').get();
    migratedDb.close();
    assert.equal(migratedRow.note, 'newest-study-record', 'Must deterministically migrate newest previous data');
  } finally {
    try {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      }
    } catch {}
  }
});

test('Review Fix 2: Server blocks untrusted origins, cross-port localhost origins, and forged Host headers', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ruankao-cors-test-'));
  const dbPath = path.join(tmpDir, 'test_cors.db');
  const fixtureDb = new DatabaseSync(dbPath);
  fixtureDb.exec('CREATE TABLE IF NOT EXISTS app_settings(key TEXT PRIMARY KEY, value TEXT);');
  fixtureDb.prepare('INSERT OR REPLACE INTO app_settings(key, value) VALUES (?, ?)').run('api_key', 'secret-audit-key-123');
  fixtureDb.close();

  process.env.DB_PATH = dbPath;
  process.env.EXAM_DATA_DIR = tmpDir;

  const { startUnifiedServer } = require('../apps/exam-service/src/unified-server');
  const app = await startUnifiedServer({ port: 0, host: '127.0.0.1' });
  const port = app.server.address().port;

  try {
    // 1. Untrusted external Origin cannot export database
    const untrustedRes = await request(port, '/api/v1/system/db-export', {
      Origin: 'https://untrusted-attacker.example'
    });
    assert.equal(untrustedRes.status, 403, 'Must return 403 for untrusted cross-origin db-export');
    assert.equal(untrustedRes.headers['access-control-allow-origin'], undefined);
    assert(!untrustedRes.body.includes(Buffer.from('secret-audit-key-123')));

    // 2. Different localhost port Origin (e.g. http://localhost:45678) is strictly rejected on db-export and shutdown
    const foreignLocalPortExport = await request(port, '/api/v1/system/db-export', {
      Origin: 'http://localhost:45678'
    });
    assert.equal(foreignLocalPortExport.status, 403, 'Must reject cross-port localhost Origin on db-export');
    assert.equal(foreignLocalPortExport.headers['access-control-allow-origin'], undefined);

    const foreignLocalPortShutdown = await request(port, '/api/v1/admin/shutdown', {
      Origin: 'http://localhost:45678'
    }, 'POST');
    assert.equal(foreignLocalPortShutdown.status, 403, 'Must reject cross-port localhost Origin on shutdown');

    // 3. Forged Host header (DNS rebinding simulation without Origin) is rejected
    const evilHostRes = await request(port, '/api/v1/system/db-export', {
      Host: 'attacker.example:80'
    });
    assert.equal(evilHostRes.status, 403, 'Must reject forged Host header');

    // 4. Untrusted Origin OPTIONS preflight is rejected
    const untrustedOptions = await request(port, '/api/v1/system/db-export', {
      Origin: 'http://localhost:45678'
    }, 'OPTIONS');
    assert.equal(untrustedOptions.status, 403, 'OPTIONS preflight must be 403 for cross-port origin');

    // 5. Same-origin local request is admitted and includes X-Ruankao-Db-Id
    const trustedRes = await request(port, '/api/v1/system/db-export', {
      Origin: `http://127.0.0.1:${port}`
    });
    assert.equal(trustedRes.status, 200, 'Must allow same-origin local request for db-export');
    assert.equal(trustedRes.headers['access-control-allow-origin'], `http://127.0.0.1:${port}`);
    assert.ok(trustedRes.headers['x-ruankao-db-id'], 'Must include X-Ruankao-Db-Id header');
    assert(trustedRes.body.includes(Buffer.from('secret-audit-key-123')));

    // 6. Regular browser direct download (valid Host, no Origin header) is permitted
    const directRes = await request(port, '/api/v1/system/db-export');
    assert.equal(directRes.status, 200, 'Must allow direct browser download without Origin header');
    assert.equal(directRes.headers['access-control-allow-origin'], undefined);
  } finally {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Review Fix 3: backup-cli captures WAL rows even when a concurrent reader holds an older snapshot', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ruankao-wal-backup-test-'));
  const appDir = path.join(tmpDir, 'app');
  const dataDir = path.join(appDir, 'data');
  const dbPath = path.join(dataDir, 'app.db');
  fs.mkdirSync(dataDir, { recursive: true });

  const writer = new DatabaseSync(dbPath);
  writer.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE study_records(id INTEGER PRIMARY KEY, q_id TEXT); PRAGMA wal_checkpoint(TRUNCATE);');

  const reader = new DatabaseSync(dbPath);
  reader.exec('BEGIN;');
  reader.prepare('SELECT COUNT(*) FROM study_records').get();

  // Writer commits a new row into WAL while reader holds an older read snapshot
  writer.prepare('INSERT INTO study_records(q_id) VALUES (?)').run('oq-wal-concurrent-reader-record');

  const { performBackup } = require('../scripts/portable/backup-cli');
  const prevPort = process.env.PORT;
  process.env.PORT = '65533'; // Ensure offline VACUUM INTO fallback is exercised
  try {
    const success = await performBackup(appDir);
    assert.equal(success, true, 'performBackup must return true under concurrent reader');

    const backupsDir = path.join(dataDir, 'backups');
    const backupFiles = fs.readdirSync(backupsDir).filter(f => f.endsWith('.db'));
    assert.equal(backupFiles.length, 1, 'Exactly one verified backup file should be generated');

    const backupDbPath = path.join(backupsDir, backupFiles[0]);
    const backupDb = new DatabaseSync(backupDbPath, { readOnly: true });
    const rowCount = backupDb.prepare('SELECT COUNT(*) AS count FROM study_records').get().count;
    backupDb.close();

    assert.equal(rowCount, 1, 'Backup database must include WAL rows even when concurrent reader blocks TRUNCATE checkpoint');
  } finally {
    if (prevPort === undefined) delete process.env.PORT;
    else process.env.PORT = prevPort;
    try { reader.exec('ROLLBACK;'); } catch {}
    reader.close();
    writer.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Review Fixes 4-6: Release workflow defines explicit steps, validates full semver tag and binds exact artifacts', (t) => {
  const workflowFile = path.join(root, '.github/workflows/release.yml');
  if (!fs.existsSync(workflowFile)) {
    return;
  }
  const workflowContent = fs.readFileSync(workflowFile, 'utf8');

  assert(workflowContent.includes('- name: Run test suite\n        shell: pwsh\n        run: |\n          npm test'),
    'Workflow must run test suite as an isolated step');
  assert(workflowContent.includes('- name: Verify release content and bank integrity\n        shell: pwsh\n        run: |\n          npm run verify'),
    'Workflow must run release verification as an isolated step');

  assert(workflowContent.includes('inputs:\n      tag:') && workflowContent.includes('Validated release tag'),
    'Workflow must validate tag input for workflow_dispatch');
  assert(workflowContent.includes('^v[0-9]+\\.[0-9]+\\.[0-9]+$'),
    'Workflow must enforce full anchored semver regex');

  assert(workflowContent.includes('fail_on_unmatched_files: true'),
    'Release action must set fail_on_unmatched_files: true');
  assert(workflowContent.includes('RuankaoExam-Portable-') && workflowContent.includes('RuankaoExam-SingleExe-'),
    'Must assert both ZIP and SingleExe artifacts');
});

test('Review Fix 7: Portable builder enforces publicFiles allowlist and memorize mode displays AnswerSheet stats', (t) => {
  const builderSource = fs.readFileSync(path.join(root, 'scripts/build-portable.mjs'), 'utf8');
  assert(builderSource.includes('FORBIDDEN_EXTENSIONS') && builderSource.includes('.db') && builderSource.includes('.key'),
    'build-portable.mjs must define forbidden extensions set');
  assert(builderSource.includes('isSafePublicEntry') && builderSource.includes('allowedPublicFiles'),
    'build-portable.mjs must filter files via isSafePublicEntry and allowedPublicFiles');

  const verifierSource = fs.readFileSync(path.join(root, 'scripts/portable/verify-portable.mjs'), 'utf8');
  assert(verifierSource.includes('FORBIDDEN_EXTENSIONS') && verifierSource.includes('scanDirectory'),
    'verify-portable.mjs must deep scan directories and assert forbidden extensions');
  assert(verifierSource.includes('assertPublicText') && verifierSource.includes('embeddedZipSha256'),
    'verify-portable.mjs must run assertPublicText and verify SingleExe embedded ZIP SHA-256');

  const answerSheetSource = fs.readFileSync(path.join(root, 'apps/exam-web/src/components/AnswerSheet.js'), 'utf8');
  assert(answerSheetSource.includes("practiceMode === 'practice' || practiceMode === 'memorize'"),
    'AnswerSheet must enable real-time stats and colors in both practice and memorize modes');
});
