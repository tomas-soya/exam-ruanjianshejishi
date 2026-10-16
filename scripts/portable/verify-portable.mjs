import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const portableRoot = path.join(root, 'dist', 'portable');

const latest = fs.existsSync(portableRoot)
  ? fs.readdirSync(portableRoot)
      .filter(n => /^RuankaoExam-Portable-/.test(n) && fs.statSync(path.join(portableRoot, n)).isDirectory())
      .sort()
      .at(-1)
  : null;

const target = process.argv[2] ? path.resolve(root, process.argv[2]) : (latest && path.join(portableRoot, latest));
assert(target && target.startsWith(portableRoot + path.sep), 'Provide a built portable directory under dist/portable');

const folderName = path.basename(target);
const tagMatch = folderName.match(/^RuankaoExam-Portable-(.+)$/);
assert(tagMatch, `Invalid portable folder name: ${folderName}`);
const buildTag = tagMatch[1];

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

// 1. 展开目录关键文件与运行时许可证完整性检查
const requiredFiles = [
  '.package-meta.json',
  'bin/node.exe',
  'bin/app-unified.js',
  'bin/backup-cli.js',
  '软件设计师刷题平台.exe',
  '启动控制台调试模式.bat',
  '一键备份做题记录.bat',
  'LICENSE',
  'NODE-LICENSE.txt',
  'CONTENT_NOTICE.md',
  'THIRD_PARTY_NOTICES.md',
  'README_使用说明.txt',
  'resources/web/public/index.html',
  'resources/web/public/project-info.js',
  'resources/materials/软件设计师复习材料-选择题.md',
  'resources/materials/软件设计师复习材料-案例题.md'
];

for (const f of requiredFiles) {
  assert(fs.existsSync(path.join(target, f)), `Missing required file: ${f}`);
}

const pkgJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const packageMeta = JSON.parse(fs.readFileSync(path.join(target, '.package-meta.json'), 'utf8'));
assert.equal(packageMeta.version, pkgJson.version, `.package-meta.json version (${packageMeta.version}) must match package.json (${pkgJson.version})`);
assert.equal(packageMeta.buildDateTag, buildTag, `.package-meta.json buildDateTag (${packageMeta.buildDateTag}) must match folder tag (${buildTag})`);

// 检查 README 中的开源仓库声明
const readmeText = fs.readFileSync(path.join(target, 'README_使用说明.txt'), 'utf8');
assert(!readmeText.includes('仓库地址：待公布'), 'README contains placeholder repo URL');
assert(readmeText.includes('github.com/tomas-soya/exam-ruanjianshejishi'), 'README missing repo URL');

// 2. 核验 Zip 发布归档与逐文件 SHA-256 对齐
const zipFile = path.join(portableRoot, `${folderName}.zip`);
assert(fs.existsSync(zipFile), `Missing portable zip archive: ${zipFile}`);
const zipStat = fs.statSync(zipFile);
assert(zipStat.size > 5 * 1024 * 1024, `Portable zip archive too small: ${zipStat.size} bytes`);
const zipSha256 = sha256File(zipFile);

const literal = value => `'${value.replaceAll("'", "''")}'`;
const zipHashOutput = execFileSync('powershell', ['-NoProfile', '-Command', `
  $OutputEncoding = [System.Text.Encoding]::UTF8
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $zip = [System.IO.Compression.ZipFile]::OpenRead(${literal(zipFile)})
  try {
    foreach ($entry in $zip.Entries) {
      if ([string]::IsNullOrEmpty($entry.Name)) {
        Write-Output ("DIR\`t" + $entry.FullName)
      } else {
        $stream = $entry.Open()
        try {
          $hashBytes = $sha.ComputeHash($stream)
          $hex = -join ($hashBytes | ForEach-Object { $_.ToString('x2') })
          Write-Output ("FILE\`t" + $entry.FullName + "\`t" + $hex)
        } finally {
          $stream.Dispose()
        }
      }
    }
  } finally {
    $zip.Dispose()
    $sha.Dispose()
  }
`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const zipLines = zipHashOutput.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
const zipEntries = [];
const zipFileHashes = new Map();

for (const line of zipLines) {
  const parts = line.split('\t');
  if (parts[0] === 'DIR') {
    zipEntries.push(parts[1]);
  } else if (parts[0] === 'FILE') {
    zipEntries.push(parts[1]);
    zipFileHashes.set(parts[1].replace(/\\/g, '/'), parts[2]);
  }
}

assert(zipEntries.length > 50, 'Portable zip contains too few entries');

const FORBIDDEN_EXTENSIONS = new Set([
  '.db', '.db-wal', '.db-shm', '.db-journal', '.sqlite', '.sqlite3',
  '.pem', '.key', '.pfx', '.p12', '.crt', '.cer',
  '.cs', '.tmp', '.log', '.bak'
]);
const FORBIDDEN_DB_PATTERN = /\.(?:db|sqlite|sqlite3)(?:-[a-z0-9]+|\.[a-z0-9]+)*$/i;

const FORBIDDEN_PATHS = [
  'workflow', 'browser-workbench', 'quarantine', 'sources', '历年真题'
];

for (const entry of zipEntries) {
  const norm = entry.replace(/\\/g, '/');
  assert(norm.startsWith(`${folderName}/`), `Zip entry must be rooted under ${folderName}/: ${entry}`);
  for (const fp of FORBIDDEN_PATHS) {
    assert(!norm.includes(`/${fp}/`) && !norm.startsWith(`${fp}/`), `Forbidden directory in zip: ${entry}`);
  }
  const base = path.basename(norm);
  const ext = path.extname(base).toLowerCase();
  assert(!FORBIDDEN_EXTENSIONS.has(ext) && !FORBIDDEN_DB_PATTERN.test(base), `Forbidden extension in zip: ${entry}`);
  assert(!base.startsWith('.env') && !base.startsWith('.tmp'), `Credential or temp file in zip: ${entry}`);
}

// 3. 核验单文件独立 EXE 及内嵌 ZIP 资源 SHA-256 一致性
const singleExePath = path.join(portableRoot, `RuankaoExam-SingleExe-${buildTag}.exe`);
const singleExeCnPath = path.join(portableRoot, `软件设计师刷题平台_单文件免安装版_${buildTag}.exe`);
if (process.env.ALLOW_SKIP_EXE !== 'true') {
  assert(fs.existsSync(singleExePath), `Missing single-file EXE: ${singleExePath}`);
  assert(fs.existsSync(singleExeCnPath), `Missing single-file Chinese named EXE: ${singleExeCnPath}`);
  const exeStat = fs.statSync(singleExePath);
  assert(exeStat.size > zipStat.size, `Single-file EXE size (${exeStat.size}) must exceed embedded zip size (${zipStat.size})`);

  const singleExeSha256 = sha256File(singleExePath);
  const singleExeCnSha256 = sha256File(singleExeCnPath);
  assert.equal(singleExeSha256, singleExeCnSha256, 'ASCII and Chinese SingleExe files must have identical SHA-256');

  const embeddedZipSha256 = execFileSync('powershell', ['-NoProfile', '-Command', `
    $asm = [System.Reflection.Assembly]::Load([System.IO.File]::ReadAllBytes(${literal(singleExePath)}))
    $resName = $asm.GetManifestResourceNames() | Where-Object { $_ -like '*.zip' } | Select-Object -First 1
    if (-not $resName) { throw 'No embedded .zip resource found in SingleExe' }
    $stream = $asm.GetManifestResourceStream($resName)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
      $hashBytes = $sha.ComputeHash($stream)
      -join ($hashBytes | ForEach-Object { $_.ToString('x2') })
    } finally {
      $stream.Dispose()
      $sha.Dispose()
    }
  `], { encoding: 'utf8' }).trim();

  assert.equal(embeddedZipSha256, zipSha256, `Embedded ZIP SHA-256 in SingleExe (${embeddedZipSha256}) must match portable ZIP SHA-256 (${zipSha256})`);
}

// 4. 深度扫描展开目录的所有文件、内容安全及与 ZIP 的逐文件 SHA-256 一致性
const guard = require(path.join(root, 'scripts/verify-public-content.cjs'));
const expandedFileHashes = new Map();

function scanDirectory(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const fullPath = path.join(dir, e.name);
    const rel = path.relative(target, fullPath).replace(/\\/g, '/');

    for (const fp of FORBIDDEN_PATHS) {
      assert(e.name !== fp, `Forbidden directory: ${rel}`);
    }
    assert(!e.name.startsWith('.env') && !e.name.startsWith('.tmp'), `Credential or temp file: ${rel}`);

    if (e.isDirectory()) {
      scanDirectory(fullPath);
    } else if (e.isFile()) {
      const ext = path.extname(e.name).toLowerCase();
      assert(!FORBIDDEN_EXTENSIONS.has(ext) && !FORBIDDEN_DB_PATTERN.test(e.name), `Forbidden file extension in portable package: ${rel}`);

      const zipRelKey = `${folderName}/${rel}`;
      const fileHash = sha256File(fullPath);
      expandedFileHashes.set(zipRelKey, fileHash);
      assert.equal(zipFileHashes.get(zipRelKey), fileHash, `Expanded file SHA-256 mismatch against ZIP entry: ${zipRelKey}`);

      // 文本文件隐私与凭据签名扫描
      if (/\.(?:json|js|ts|cjs|mjs|md|html|css|txt|bat)$/i.test(e.name)) {
        const text = fs.readFileSync(fullPath, 'utf8');
        guard.assertPublicText(text, rel);
      }
    }
  }
}

scanDirectory(target);
assert.equal(expandedFileHashes.size, zipFileHashes.size, `Expanded file count (${expandedFileHashes.size}) must equal ZIP file entry count (${zipFileHashes.size})`);

// 5. 题库完整性核验
const { QuestionBankLoader } = require(path.join(target, 'bin/exam-service/src/bank/question-loader.js'));
const { readRecord } = require(path.join(target, 'bin/exam-service/src/bank/record-codec.js'));
const bankRoot = path.join(target, 'resources/bank');
const bank = new QuestionBankLoader(bankRoot);
assert.equal(bank.listVerifiedPapers().length, 44, 'Must have 44 verified papers');
const p202411 = bank.listVerifiedPapers().filter(p => p.year === '2024' && p.season === '11' && p.subject === 'objective');
assert.equal(p202411.length, 1, 'Must have exactly 1 2024-11 objective paper');
assert.equal(p202411[0].totalQuestions, 75, '2024-11 objective paper must have 75 questions');

const counts = {};
for (const subject of ['objective', 'case']) {
  const dir = path.join(bankRoot, 'questions', subject);
  const files = fs.readdirSync(dir);
  counts[subject] = files.length;
  assert.equal(files.length, subject === 'case' ? 162 : 1560);
  for (const f of files) {
    const q = readRecord(path.join(dir, f));
    for (const im of q.images || []) {
      const imgPath = path.join(bankRoot, im.local_path.replace(/^题库\//, ''));
      assert(fs.existsSync(imgPath), `Missing question asset: ${im.local_path}`);
    }
  }
}
assert.equal(fs.readdirSync(path.join(bankRoot, 'papers')).length, 52);
assert.equal(fs.readdirSync(path.join(bankRoot, 'assets')).length, 587);

console.log(JSON.stringify({
  target,
  tag: buildTag,
  version: packageMeta.version,
  zipSha256,
  zipSizeMb: (zipStat.size / (1024 * 1024)).toFixed(2),
  papers: 52,
  visiblePapers: bank.listVerifiedPapers().length,
  ...counts,
  images: 587,
  zipEntriesCount: zipEntries.length,
  verifiedFileHashes: expandedFileHashes.size,
  status: 'passed'
}, null, 2));
