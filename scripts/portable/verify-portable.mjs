import fs from 'node:fs';
import path from 'node:path';
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

// 1. 展开目录关键文件与运行时许可证完整性检查
const requiredFiles = [
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

// 检查 README 中的开源仓库声明
const readmeText = fs.readFileSync(path.join(target, 'README_使用说明.txt'), 'utf8');
assert(!readmeText.includes('仓库地址：待公布'), 'README contains placeholder repo URL');
assert(readmeText.includes('github.com/tomas-soya/exam-ruanjianshejishi'), 'README missing repo URL');

// 2. 核验 Zip 发布归档
const zipFile = path.join(portableRoot, `${folderName}.zip`);
assert(fs.existsSync(zipFile), `Missing portable zip archive: ${zipFile}`);
const zipStat = fs.statSync(zipFile);
assert(zipStat.size > 5 * 1024 * 1024, `Portable zip archive too small: ${zipStat.size} bytes`);

// 检查 Zip 内部条目（防止敏感文件泄漏进压缩包）
const literal = value => `'${value.replaceAll("'", "''")}'`;
const zipListOutput = execFileSync('powershell', ['-NoProfile', '-Command',
  `Add-Type -AssemblyName System.IO.Compression.FileSystem\n$zip = [System.IO.Compression.ZipFile]::OpenRead(${literal(zipFile)})\n$zip.Entries | ForEach-Object { $_.FullName }\n$zip.Dispose()`
], { encoding: 'utf8' });

const zipEntries = zipListOutput.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
assert(zipEntries.length > 50, 'Portable zip contains too few entries');

const FORBIDDEN_EXTENSIONS = new Set([
  '.db', '.db-wal', '.db-shm', '.sqlite', '.sqlite3',
  '.pem', '.key', '.pfx', '.p12', '.crt', '.cer',
  '.cs', '.tmp', '.log'
]);

const FORBIDDEN_PATHS = [
  'workflow', 'browser-workbench', 'quarantine', 'sources', '历年真题'
];

for (const entry of zipEntries) {
  const norm = entry.replace(/\\/g, '/');
  for (const fp of FORBIDDEN_PATHS) {
    assert(!norm.includes(`/${fp}/`) && !norm.startsWith(`${fp}/`), `Forbidden directory in zip: ${entry}`);
  }
  const ext = path.extname(entry).toLowerCase();
  assert(!FORBIDDEN_EXTENSIONS.has(ext), `Forbidden extension in zip: ${entry}`);
  assert(!path.basename(entry).startsWith('.env'), `Credential file in zip: ${entry}`);
}

// 3. 核验单文件独立 EXE
const singleExePath = path.join(portableRoot, `RuankaoExam-SingleExe-${buildTag}.exe`);
const singleExeCnPath = path.join(portableRoot, `软件设计师刷题平台_单文件免安装版_${buildTag}.exe`);
if (process.env.ALLOW_SKIP_EXE !== 'true') {
  assert(fs.existsSync(singleExePath), `Missing single-file EXE: ${singleExePath}`);
  assert(fs.existsSync(singleExeCnPath), `Missing single-file Chinese named EXE: ${singleExeCnPath}`);
  const exeStat = fs.statSync(singleExePath);
  assert(exeStat.size > zipStat.size, `Single-file EXE size (${exeStat.size}) must exceed embedded zip size (${zipStat.size})`);
}

// 4. 深度扫描展开目录的所有文件及内容安全
const guard = require(path.join(root, 'scripts/verify-public-content.cjs'));

function scanDirectory(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const fullPath = path.join(dir, e.name);
    const rel = path.relative(target, fullPath).replace(/\\/g, '/');

    for (const fp of FORBIDDEN_PATHS) {
      assert(e.name !== fp, `Forbidden directory: ${rel}`);
    }
    assert(!e.name.startsWith('.env'), `Credential file: ${rel}`);

    if (e.isDirectory()) {
      scanDirectory(fullPath);
    } else if (e.isFile()) {
      const ext = path.extname(e.name).toLowerCase();
      assert(!FORBIDDEN_EXTENSIONS.has(ext), `Forbidden file extension in portable package: ${rel}`);

      // 文本文件隐私与凭据签名扫描
      if (/\.(?:json|js|ts|cjs|mjs|md|html|css|txt|bat)$/i.test(e.name)) {
        const text = fs.readFileSync(fullPath, 'utf8');
        guard.assertPublicText(text, rel);
      }
    }
  }
}

scanDirectory(path.join(target, 'resources'));
scanDirectory(path.join(target, 'bin'));

// 5. 题库完整性核验
const { QuestionBankLoader } = require(path.join(target, 'bin/exam-service/src/bank/question-loader.js'));
const { readRecord } = require(path.join(target, 'bin/exam-service/src/bank/record-codec.js'));
const bankRoot = path.join(target, 'resources/bank');
const bank = new QuestionBankLoader(bankRoot);
assert.equal(bank.listVerifiedPapers().length, 45, 'Must have 45 verified papers');

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
  zipSizeMb: (zipStat.size / (1024 * 1024)).toFixed(2),
  papers: 52,
  visiblePapers: 45,
  ...counts,
  images: 587,
  zipEntriesCount: zipEntries.length,
  status: 'passed'
}, null, 2));
