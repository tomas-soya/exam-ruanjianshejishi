import fs from 'node:fs';
import path from 'node:path';
import { execSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const { publicFiles } = require('./public-files.cjs');
const allowedPublicFiles = new Set(publicFiles(workspaceRoot).map(f => f.replace(/\\/g, '/')));

const distRoot = path.join(workspaceRoot, 'dist', 'portable');
const buildDateTag = process.env.PORTABLE_DATE || '20261012';
if (!/^\d{8}(?:-[a-z0-9]+)*$/.test(buildDateTag)) throw new Error('Invalid portable build tag');
const portableAppDir = path.join(distRoot, `RuankaoExam-Portable-${buildDateTag}`);
const zipFile = path.join(distRoot, `RuankaoExam-Portable-${buildDateTag}.zip`);

console.log('======================================================================');
console.log(' [Ruankao Portable Builder] 正在构建独立便携式刷题程序...');
console.log('======================================================================');
console.log(`工作区根目录:   ${workspaceRoot}`);
console.log(`目标便携目录:   ${portableAppDir}`);

// 1. 清理并初始化目标目录
if (fs.existsSync(portableAppDir)) throw new Error('目标便携目录已存在；请设置新的 PORTABLE_DATE 构建标识，以保留已有包和学习记录。');
fs.mkdirSync(portableAppDir, { recursive: true });

const binDir = path.join(portableAppDir, 'bin');
const resourcesDir = path.join(portableAppDir, 'resources');
const dataDir = path.join(portableAppDir, 'data');
const backupsDir = path.join(dataDir, 'backups');

fs.mkdirSync(binDir, { recursive: true });
fs.mkdirSync(resourcesDir, { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(backupsDir, { recursive: true });

// 安全公共文件过滤规则（彻底杜绝敏感文件、私钥、数据库、凭据等进入发布包）
const FORBIDDEN_EXTENSIONS = new Set([
  '.db', '.db-wal', '.db-shm', '.db-journal', '.sqlite', '.sqlite3',
  '.pem', '.key', '.pfx', '.p12', '.crt', '.cer',
  '.cs', '.tmp', '.log', '.bak'
]);
const FORBIDDEN_DB_PATTERN = /\.(?:db|sqlite|sqlite3)(?:-[a-z0-9]+|\.[a-z0-9]+)*$/i;
const FORBIDDEN_DIR_OR_FILE_NAMES = new Set([
  'node_modules', '.git', 'test', 'data', 'backups',
  'workflow', 'browser-workbench', 'sources', 'quarantine',
  'calibration', '.tmp-export', '.tmp-import', 'README.md'
]);

function isSafePublicEntry(srcPath, entry) {
  const name = entry.name;
  if (FORBIDDEN_DIR_OR_FILE_NAMES.has(name)) return false;
  if (name.startsWith('.env') || name.startsWith('.tmp')) return false;
  if (FORBIDDEN_DB_PATTERN.test(name)) return false;
  if (entry.isFile()) {
    const ext = path.extname(name).toLowerCase();
    if (FORBIDDEN_EXTENSIONS.has(ext)) return false;
    const relToRoot = path.relative(workspaceRoot, srcPath).replace(/\\/g, '/');
    if (!relToRoot.startsWith('..') && !allowedPublicFiles.has(relToRoot)) {
      return false;
    }
  }
  return true;
}

// 辅助复制函数
function copyDirectoryRecursive(src, dest, filterFn = null) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (!isSafePublicEntry(srcPath, entry)) {
      continue;
    }

    if (filterFn && !filterFn(srcPath, entry)) {
      continue;
    }

    if (entry.isDirectory()) {
      copyDirectoryRecursive(srcPath, destPath, filterFn);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// 2. 复制免安装绿色运行时 (node.exe)
console.log('[2/8] 提取免安装绿色 Node.js 运行时...');
const currentExec = process.execPath;
fs.copyFileSync(currentExec, path.join(binDir, 'node.exe'));
const nodeLicense = path.join(workspaceRoot, 'scripts', 'portable', `NODE-LICENSE-${process.version}.txt`);
if (!fs.existsSync(nodeLicense)) throw new Error(`请先准备与 ${process.version} 匹配的 Node.js 许可证文件`);
fs.copyFileSync(nodeLicense, path.join(portableAppDir, 'NODE-LICENSE.txt'));
for (const name of ['LICENSE', 'CONTENT_NOTICE.md', 'THIRD_PARTY_NOTICES.md']) fs.copyFileSync(path.join(workspaceRoot,name),path.join(portableAppDir,name));

const pkgJson = JSON.parse(fs.readFileSync(path.join(workspaceRoot, 'package.json'), 'utf8'));
let gitCommit = 'unknown';
try {
  gitCommit = execSync('git rev-parse HEAD', { cwd: workspaceRoot, encoding: 'utf8' }).trim();
} catch {}
fs.writeFileSync(
  path.join(portableAppDir, '.package-meta.json'),
  JSON.stringify({
    name: pkgJson.name,
    version: pkgJson.version,
    buildDateTag,
    gitCommit,
    nodeVersion: process.version
  }, null, 2) + '\n',
  'utf8'
);

// 复制备份命令行工具
const backupCliSrc = path.join(workspaceRoot, 'scripts', 'portable', 'backup-cli.js');
if (fs.existsSync(backupCliSrc)) {
  fs.copyFileSync(backupCliSrc, path.join(binDir, 'backup-cli.js'));
}

// 3. 提取编译好的模块与服务核心
console.log('[3/8] 组装服务后端代码与依赖...');
const nodeModulesDir = path.join(binDir, 'node_modules');
fs.mkdirSync(nodeModulesDir, { recursive: true });

// 复制 exam-contracts (同时支持相对引用与 npm scope 规范解析)
const contractsDestRel = path.join(binDir, 'exam-contracts');
const contractsDestPkg = path.join(nodeModulesDir, '@ruankao', 'exam-contracts');
fs.mkdirSync(path.dirname(contractsDestPkg), { recursive: true });
copyDirectoryRecursive(
  path.join(workspaceRoot, 'apps', 'exam-contracts'),
  contractsDestRel
);
copyDirectoryRecursive(
  path.join(workspaceRoot, 'apps', 'exam-contracts'),
  contractsDestPkg
);

// 复制 exam-llm
const llmDest = path.join(binDir, 'exam-llm');
copyDirectoryRecursive(
  path.join(workspaceRoot, 'apps', 'exam-llm'),
  llmDest
);

// 复制 exam-service
const serviceDest = path.join(binDir, 'exam-service');
copyDirectoryRecursive(
  path.join(workspaceRoot, 'apps', 'exam-service'),
  serviceDest
);

// 生成统一入口 bin/app-unified.js
const appUnifiedEntryCode = `'use strict';
const { startUnifiedServer } = require('./exam-service/src/unified-server');

const port = parseInt(process.env.PORT || '3124', 10);
const host = process.env.HOST || '127.0.0.1';

startUnifiedServer({ port, host })
  .then(({ close }) => {
    let isExiting = false;
    const onSignal = (sig) => {
      if (isExiting) return;
      isExiting = true;
      close().finally(() => process.exit(0));
    };
    process.on('SIGINT', () => onSignal('SIGINT'));
    process.on('SIGTERM', () => onSignal('SIGTERM'));
  })
  .catch(err => {
    console.error('[UnifiedServer] 启动失败:', err);
    process.exit(1);
  });
`;
fs.writeFileSync(path.join(binDir, 'app-unified.js'), appUnifiedEntryCode, 'utf8');

// 4. 提取纯净题库资源（严格排除 quarantine 隔离区与未批准非标准题）
console.log('[4/8] 提取获批真题题库（纯净考生交付原则，隔离区已安全过滤）...');
const bankTarget = path.join(resourcesDir, 'bank');
fs.mkdirSync(bankTarget, { recursive: true });

// 复制 papers
copyDirectoryRecursive(path.join(workspaceRoot, '题库', 'papers'), path.join(bankTarget, 'papers'), (p,e)=>e.isFile() && /^sd-.+\.json$/.test(e.name));
// 复制 questions
copyDirectoryRecursive(path.join(workspaceRoot, '题库', 'questions'), path.join(bankTarget, 'questions'), (p,e)=>e.isDirectory() || /^(oq|cg)-[a-f0-9]{20}\.json$/.test(e.name));
// 复制 assets (题目插图)
copyDirectoryRecursive(path.join(workspaceRoot, '题库', 'assets'), path.join(bankTarget, 'assets'), (p,e)=>e.isFile() && /^[a-f0-9]{64}\.(png|jpg|jpeg|gif|webp|svg|bin)$/.test(e.name));
// 复制 manifest
if (fs.existsSync(path.join(workspaceRoot, '题库', 'manifest.reconciliation.json'))) {
  fs.copyFileSync(
    path.join(workspaceRoot, '题库', 'manifest.reconciliation.json'),
    path.join(bankTarget, 'manifest.reconciliation.json')
  );
}

// 5. 提取纯净复习材料 (Markdown 与相关配图)
console.log('[5/8] 提取复习材料 Markdown 知识库...');
const materialsTarget = path.join(resourcesDir, 'materials');
copyDirectoryRecursive(
  path.join(workspaceRoot, '软件设计师复习材料'),
  materialsTarget,
  (p, e) => !['.git', 'node_modules', '历年真题', 'README.md'].includes(e.name)
);

// 6. 提取前端静态界面 (React 离线运行 UI)
console.log('[6/8] 提取前端离线界面资产 (Web UI)...');
const webTarget = path.join(resourcesDir, 'web');
fs.mkdirSync(path.join(webTarget, 'public'), { recursive: true });
fs.mkdirSync(path.join(webTarget, 'src'), { recursive: true });

copyDirectoryRecursive(path.join(workspaceRoot, 'apps', 'exam-web', 'public'), path.join(webTarget, 'public'));
copyDirectoryRecursive(path.join(workspaceRoot, 'apps', 'exam-web', 'src'), path.join(webTarget, 'src'));

// 7. 编译生成原生 Windows 启动程序 (软件设计师刷题平台.exe)
console.log('[7/8] 编译原生 Windows 启动引导程序 (软件设计师刷题平台.exe)...');
const launcherCs = path.join(workspaceRoot, 'scripts', 'portable', 'Launcher.cs');
const launcherExe = path.join(portableAppDir, '软件设计师刷题平台.exe');
const cscPath = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';

if (fs.existsSync(cscPath)) {
  try {
    execSync(`"${cscPath}" /nologo /optimize+ /target:exe /out:"${launcherExe}" "${launcherCs}"`, { stdio: 'inherit' });
    console.log('   -> 原生启动程序编译完成 (< 50KB 原生 Win32 可执行文件)');
  } catch (err) {
    if (process.env.ALLOW_SKIP_EXE !== 'true') {
      throw new Error(`原生启动程序编译失败: ${err.message}`);
    }
  }
} else {
  if (process.env.ALLOW_SKIP_EXE !== 'true') {
    throw new Error('未检测到 C# 编译器 csc.exe，无法生成启动程序；如需跳过请设置 ALLOW_SKIP_EXE=true');
  }
  console.warn('   -> [警告] 未检测到 csc.exe，将使用批处理作为主启动入口');
}

// 写入控制台调试启动脚本
fs.writeFileSync(
  path.join(portableAppDir, '启动控制台调试模式.bat'),
  `@echo off\r\nchcp 65001 >nul\r\ncd /d "%~dp0"\r\necho ====================================================\r\necho  [调试控制台] 正在启动软考刷题平台...\r\necho ====================================================\r\nbin\\node.exe bin\\app-unified.js\r\npause\r\n`,
  'utf8'
);

// 写入一键备份脚本 (复用一致性备份工具，保证 WAL 模式下数据安全无丢失，失败明确退出非零)
fs.writeFileSync(
  path.join(portableAppDir, '一键备份做题记录.bat'),
  `@echo off\r\nchcp 65001 >nul\r\ncd /d "%~dp0"\r\nif exist "bin\\node.exe" if exist "bin\\backup-cli.js" (\r\n  "bin\\node.exe" "bin\\backup-cli.js"\r\n  if errorlevel 1 (\r\n    echo.\r\n    echo [错误] 备份做题记录失败，请检查文件权限或运行状态。\r\n    pause\r\n    exit /b 1\r\n  )\r\n  pause\r\n  exit /b 0\r\n)\r\nset TIMESTAMP=%date:~0,4%%date:~5,2%%date:~8,2%_%time:~0,2%%time:~3,2%%time:~6,2%\r\nset TIMESTAMP=%TIMESTAMP: =0%\r\nif not exist data\\backups mkdir data\\backups\r\nif exist data\\app.db (\r\n  copy data\\app.db "data\\backups\\app_backup_%TIMESTAMP%.db" >nul\r\n  if errorlevel 1 (\r\n    echo [错误] 复制数据库文件失败。\r\n    pause\r\n    exit /b 1\r\n  )\r\n  echo [成功] 做题记录已安全备份到: data\\backups\\app_backup_%TIMESTAMP%.db\r\n) else (\r\n  echo [提示] 尚未生成做题记录 (data\\app.db 暂不存在)\r\n)\r\npause\r\nexit /b 0\r\n`,
  'utf8'
);

// 写入考生说明文档
const readmeContent = `软件设计师刷题与智能复习工作台

作者：tomas-soya（https://github.com/tomas-soya）
仓库地址：https://github.com/tomas-soya/exam-ruanjianshejishi
该项目完全免费开源，如果你是花钱买到的，那么你被骗了
对题目、刷题功能有任何建议，欢迎提交issue

双击“软件设计师刷题平台.exe”启动，浏览器打开 http://127.0.0.1:3124。
保持控制台运行，输入 q 并回车退出。也可通过“启动控制台调试模式.bat”启动。

包含 1560 条客观题记录、162 组案例题；重复卷归并后可选择 44 份试卷。
支持考试、练习和记忆模式、错题本、智能复习队列、21 章复习资料。
在设置中配置自己的 OpenAI 兼容接口、模型和 API Key，可使用 AI 助教、案例判分和动态资料。
基础刷题不需要 AI。AI 请求会发送相关题目、作答与提问给你配置的服务商。
自动判分仅供自测；回忆卷、来源答案争议与规则评分请结合解析核对。

学习数据库位于 data/app.db，设置中可导出和导入备份。
API 密钥使用本机随机密钥文件（~/.ruankao-exam/vault.key）或 EXAM_APP_SECRET 加密存储；请妥善保管数据库备份，不要公开数据库或附到 issue。
旧题号升级前自动生成本地备份，保留作答、分数、时间戳和配置。

默认仅本机访问。在可信局域网中，启动前设置 HOST=0.0.0.0，可通过控制台的局域网地址访问。
此模式共享同一份记录，没有多用户鉴权，不应直接开放到公网。

代码许可证、第三方运行库及题库内容说明见随附 LICENSE、NODE-LICENSE.txt、CONTENT_NOTICE.md 和 THIRD_PARTY_NOTICES.md。
`;
fs.writeFileSync(path.join(portableAppDir, 'README_使用说明.txt'), readmeContent, 'utf8');

// 8. 打包为绿色免安装 Zip 压缩包
console.log('[8/8] 正在打包压缩为发布归档包 (RuankaoExam-Portable-v1.0.zip)...');
try {
  if (fs.existsSync(zipFile)) {
    fs.unlinkSync(zipFile);
  }
  // .NET archive API avoids a dependency on the optional PowerShell Archive module.
  const literal = value => `'${value.replaceAll("'", "''")}'`;
  execFileSync('powershell', ['-NoProfile', '-Command',
    `Add-Type -AssemblyName System.IO.Compression.FileSystem\n[System.IO.Compression.ZipFile]::CreateFromDirectory(${literal(portableAppDir)}, ${literal(zipFile)}, [System.IO.Compression.CompressionLevel]::Optimal, $true)`
  ], { stdio: 'inherit' });
  const zipStat = fs.statSync(zipFile);
  console.log(`   -> Zip 归档已生成: ${(zipStat.size / (1024 * 1024)).toFixed(2)} MB`);
} catch (e) {
  throw new Error(`Zip 归档未生成，便携目录已保留：${e.message}`);
}

// 9. 编译封装单文件独立 exe (软件设计师刷题平台_单文件免安装版.exe)
const singleExePath = path.join(distRoot, `软件设计师刷题平台_单文件免安装版_${buildDateTag}.exe`);
const singleExeCs = path.join(workspaceRoot, 'scripts', 'portable', 'SingleExePackage.cs');
if (fs.existsSync(cscPath) && fs.existsSync(singleExeCs) && fs.existsSync(zipFile)) {
  console.log(`[9/9] 正在封装单文件自运行程序 (${path.basename(singleExePath)})...`);
  try {
    execSync(
      `"${cscPath}" /nologo /optimize+ /target:winexe /r:System.Windows.Forms.dll /r:System.IO.Compression.FileSystem.dll /r:System.IO.Compression.dll /resource:"${zipFile}" /out:"${singleExePath}" "${singleExeCs}"`,
      { stdio: 'inherit' }
    );
    const exeStat = fs.statSync(singleExePath);
    const singleExeAsciiPath = path.join(distRoot, `RuankaoExam-SingleExe-${buildDateTag}.exe`);
    fs.copyFileSync(singleExePath, singleExeAsciiPath);
    console.log(`   -> 单文件 exe 封装完成: ${(exeStat.size / (1024 * 1024)).toFixed(2)} MB`);
  } catch (err) {
    if (process.env.ALLOW_SKIP_EXE !== 'true') {
      throw new Error(`单文件 exe 封装失败: ${err.message}`);
    }
    console.warn('   -> 单文件 exe 封装失败:', err.message);
  }
} else if (process.env.ALLOW_SKIP_EXE !== 'true') {
  throw new Error('缺少 C# 编译器或便携 Zip 归档，无法生成单文件 EXE');
}

console.log('======================================================================');
console.log(' [SUCCESS] 软考便携式独立程序全套产物构建完成！');
console.log(` 1. 便携文件夹 (解压即用): ${portableAppDir}`);
console.log(` 2. 便携压缩包 (Zip 归档):  ${zipFile}`);
if (fs.existsSync(singleExePath)) {
  console.log(` 3. 单文件可执行 (双击自运行): ${singleExePath}`);
}
console.log('======================================================================');
