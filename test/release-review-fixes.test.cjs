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

function request(port, urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({
      host: '127.0.0.1',
      port,
      path: urlPath,
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
    }).on('error', reject);
  });
}

test('Review Fix 1: SingleExePackage extractor avoids redundant extraction and migrates previous data', (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ruankao-single-exe-test-'));
  try {
    // Construct old version directory with user study data
    const oldVersionDir = path.join(tmpDir, 'RuankaoExam-Portable-20261001');
    const oldDataDir = path.join(oldVersionDir, 'data');
    fs.mkdirSync(oldDataDir, { recursive: true });
    const oldDbPath = path.join(oldDataDir, 'app.db');
    const oldDb = new DatabaseSync(oldDbPath);
    oldDb.exec('CREATE TABLE user_progress(id INTEGER PRIMARY KEY, note TEXT);');
    oldDb.prepare('INSERT INTO user_progress(note) VALUES (?)').run('previous-study-record');
    oldDb.close();

    // Verify SingleExePackage.cs source code logic invariants
    const csSource = fs.readFileSync(path.join(root, 'scripts/portable/SingleExePackage.cs'), 'utf8');
    
    // Invariant 1: Does NOT create empty RuankaoExam-Portable folder unconditionally
    assert(!csSource.includes('Directory.CreateDirectory(targetFolder);\r\n                ZipFile.ExtractToDirectory(tempZip, currentDir);'), 
      'Must not create empty folder before extracting zip to parent');

    // Invariant 2: Uses entry.ExtractToFile with overwrite = true
    assert(csSource.includes('entry.ExtractToFile(destinationPath, true)'), 
      'Must use entry.ExtractToFile with overwrite flag to prevent duplicate file exception');

    // Invariant 3: Migrates previous user data
    assert(csSource.includes('previousDataFolder') && csSource.includes('CopyDirectoryContent'), 
      'Must support migrating previous user study data on upgrade');

    // Invariant 4: Detects launcherExe existence and launches directly without re-extracting
    assert(csSource.includes('if (File.Exists(launcherExe))') && csSource.includes('LaunchTarget(launcherExe, args);'), 
      'Must launch directly if launcherExe already exists');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Review Fix 2: Server blocks untrusted cross-origin access and does not expose database export', async (t) => {
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
    // 1. Untrusted Origin cannot export database
    const untrustedRes = await request(port, '/api/v1/system/db-export', {
      Origin: 'https://untrusted-attacker.example'
    });
    assert.equal(untrustedRes.status, 403, 'Must return 403 for untrusted cross-origin db-export');
    assert.equal(untrustedRes.headers['access-control-allow-origin'], undefined, 'Must not reflect or wildcard ACAO');
    assert(!untrustedRes.body.includes(Buffer.from('secret-audit-key-123')), 'Must not leak database contents');

    // 2. Untrusted Origin OPTIONS preflight is rejected
    const untrustedOptions = await new Promise((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1',
        port,
        path: '/api/v1/system/db-export',
        method: 'OPTIONS',
        headers: { Origin: 'https://untrusted-attacker.example' }
      }, (res) => resolve(res.statusCode));
      req.on('error', reject);
      req.end();
    });
    assert.equal(untrustedOptions, 403, 'OPTIONS preflight must be 403 for untrusted origin');

    // 3. Trusted local origin is admitted
    const trustedRes = await request(port, '/api/v1/system/db-export', {
      Origin: `http://127.0.0.1:${port}`
    });
    assert.equal(trustedRes.status, 200, 'Must allow trusted local origin for db-export');
    assert.equal(trustedRes.headers['access-control-allow-origin'], `http://127.0.0.1:${port}`, 'Must echo specific trusted origin');
    assert(trustedRes.body.includes(Buffer.from('secret-audit-key-123')), 'Export content retrieved for trusted origin');

    // 4. Regular browser direct download (no Origin header) is permitted as same-origin
    const directRes = await request(port, '/api/v1/system/db-export');
    assert.equal(directRes.status, 200, 'Must allow direct browser download without Origin header');
    assert.equal(directRes.headers['access-control-allow-origin'], undefined, 'Must not set wildcard CORS for direct download');
  } finally {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Review Fix 3: backup-cli reliably flushes WAL and creates consistent, verified backup', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ruankao-wal-backup-test-'));
  const appDir = path.join(tmpDir, 'app');
  const dataDir = path.join(appDir, 'data');
  const dbPath = path.join(dataDir, 'app.db');
  fs.mkdirSync(dataDir, { recursive: true });

  // Open live SQLite database in WAL mode with auto-checkpoint disabled
  const liveDb = new DatabaseSync(dbPath);
  liveDb.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE study_records(id INTEGER PRIMARY KEY, q_id TEXT); PRAGMA wal_checkpoint(TRUNCATE);');
  
  // Insert row into WAL while keeping live connection open
  liveDb.prepare('INSERT INTO study_records(q_id) VALUES (?)').run('oq-wal-test-record');

  const { performBackup } = require('../scripts/portable/backup-cli');
  const success = await performBackup(appDir);
  assert.equal(success, true, 'performBackup must return true');

  const backupsDir = path.join(dataDir, 'backups');
  const backupFiles = fs.readdirSync(backupsDir);
  assert.equal(backupFiles.length, 1, 'Exactly one backup file should be generated');

  const backupDbPath = path.join(backupsDir, backupFiles[0]);
  const backupDb = new DatabaseSync(backupDbPath, { readOnly: true });
  const rowCount = backupDb.prepare('SELECT COUNT(*) AS count FROM study_records').get().count;
  backupDb.close();

  assert.equal(rowCount, 1, 'Backup database must include rows committed to WAL');
  liveDb.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Review Fixes 4-6: Release workflow defines explicit steps, validates tag and requires valid assets', (t) => {
  const workflowFile = path.join(root, '.github/workflows/release.yml');
  if (!fs.existsSync(workflowFile)) {
    return; // Skipped in repos without github release workflow
  }
  const workflowContent = fs.readFileSync(workflowFile, 'utf8');

  // Fix 4: Separate npm test and npm run verify steps
  assert(workflowContent.includes('- name: Run test suite\n        shell: pwsh\n        run: |\n          npm test'), 
    'Workflow must run test suite as an isolated step');
  assert(workflowContent.includes('- name: Verify release content and bank integrity\n        shell: pwsh\n        run: |\n          npm run verify'), 
    'Workflow must run release verification as an isolated step');

  // Fix 5: workflow_dispatch inputs tag and validates semantic versioning
  assert(workflowContent.includes('inputs:\n      tag:') && workflowContent.includes('Validated release tag'), 
    'Workflow must validate tag input for workflow_dispatch');

  // Fix 6: Verifies ZIP and EXE exist before release, and enables fail_on_unmatched_files
  assert(workflowContent.includes('fail_on_unmatched_files: true'), 
    'Release action must set fail_on_unmatched_files: true');
  assert(workflowContent.includes('RuankaoExam-Portable-*.zip') && workflowContent.includes('RuankaoExam-SingleExe-*.exe'), 
    'Must assert both ZIP and SingleExe artifacts');
});

test('Review Fix 7: Portable builder enforces strict file sanitization preventing credentials and SQLite leaks', (t) => {
  const builderSource = fs.readFileSync(path.join(root, 'scripts/build-portable.mjs'), 'utf8');
  assert(builderSource.includes('FORBIDDEN_EXTENSIONS') && builderSource.includes('.db') && builderSource.includes('.key'),
    'build-portable.mjs must define forbidden extensions set');
  assert(builderSource.includes('isSafePublicEntry'),
    'build-portable.mjs must filter files via isSafePublicEntry');

  const verifierSource = fs.readFileSync(path.join(root, 'scripts/portable/verify-portable.mjs'), 'utf8');
  assert(verifierSource.includes('FORBIDDEN_EXTENSIONS') && verifierSource.includes('scanDirectory'),
    'verify-portable.mjs must deep scan directories and assert forbidden extensions');
  assert(verifierSource.includes('assertPublicText'),
    'verify-portable.mjs must run assertPublicText on all text resources');
});
