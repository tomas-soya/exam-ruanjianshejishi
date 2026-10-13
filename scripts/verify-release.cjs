'use strict';
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..');
const {publicFiles}=require('./public-files.cjs');
const {verifyPublicContent}=require('./verify-public-content.cjs');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'release-manifest.json'),'utf8'));
const expected=new Set(manifest.files.map(f=>f.path));
assert.equal(expected.size,manifest.files.length,'Duplicate paths in release manifest');
assert.deepEqual([...expected].sort(),publicFiles(root),'Public files differ from manifest');
verifyPublicContent(root,[...expected]);
function prohibited(f){return /(?:^|\/)(?:workflow|workflow-snapshot|browser-workbench|artifacts|quarantine|sources|data|backups|node_modules|\.browser-profile)(?:\/|$)/.test(f)||/(?:^|\/)\.env(?:\.|$)|\.(?:db|sqlite3?|pem|key|pfx|p12)(?:-|$)/.test(f)||/^(?:AGENTS\.md|UPSTREAM_SYNC\.md)$/.test(f);}
for(const file of manifest.files){
  assert(!path.isAbsolute(file.path)&&!file.path.split(/[\\/]/).includes('..'),`Unsafe manifest path: ${file.path}`);
  assert(!prohibited(file.path),`Private path in manifest: ${file.path}`);
  const bytes=fs.readFileSync(path.join(root,file.path));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256,`Resource changed: ${file.path}; regenerate the public resource manifest.`);
}
if(fs.existsSync(path.join(root,'.git'))&&!fs.existsSync(path.join(root,'workflow','project.json'))){
  const tracked=execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
  for(const file of tracked){assert(!prohibited(file),`Private file still tracked: ${file}`);assert(expected.has(file)||file==='release-manifest.json',`Tracked file outside public allowlist: ${file}`);}
}
console.log(`Verified ${manifest.files.length} public resources; no tracked private paths.`);
