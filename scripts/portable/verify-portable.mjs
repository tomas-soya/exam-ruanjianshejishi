import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const require=createRequire(import.meta.url);
const portableRoot=path.join(root,'dist','portable');
const latest=fs.existsSync(portableRoot)?fs.readdirSync(portableRoot).filter(n=>/^RuankaoExam-Portable-/.test(n)&&fs.statSync(path.join(portableRoot,n)).isDirectory()).sort().at(-1):null;
const target=process.argv[2]?path.resolve(root,process.argv[2]):latest&&path.join(portableRoot,latest);
assert(target&&target.startsWith(portableRoot+path.sep),'Provide a built portable directory under dist/portable');
for(const f of ['bin/node.exe','bin/app-unified.js','resources/web/public/index.html','resources/web/public/project-info.js','resources/materials/软件设计师复习材料-选择题.md','resources/materials/软件设计师复习材料-案例题.md'])assert(fs.existsSync(path.join(target,f)),f);
const {QuestionBankLoader}=require(path.join(target,'bin/exam-service/src/bank/question-loader.js'));
const {readRecord}=require(path.join(target,'bin/exam-service/src/bank/record-codec.js'));
const bankRoot=path.join(target,'resources/bank');
const bank=new QuestionBankLoader(bankRoot);
assert.equal(bank.listVerifiedPapers().length,45);
const counts={};
for(const subject of ['objective','case']){
  const dir=path.join(bankRoot,'questions',subject);
  const files=fs.readdirSync(dir);counts[subject]=files.length;
  assert.equal(files.length,subject==='case'?162:1560);
  for(const f of files){
    const q=readRecord(path.join(dir,f));
    for(const im of q.images||[])assert(fs.existsSync(path.join(bankRoot,im.local_path.replace(/^题库\//,''))),im.local_path);
  }
}
assert.equal(fs.readdirSync(path.join(bankRoot,'papers')).length,52);
assert.equal(fs.readdirSync(path.join(bankRoot,'assets')).length,587);
function verifyPaths(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){
  assert(!['workflow','browser-workbench','quarantine','sources','历年真题'].includes(e.name),`Private/raw directory: ${e.name}`);
  assert(!e.name.startsWith('.env'),`Credential file: ${e.name}`);
  if(e.isDirectory())verifyPaths(path.join(dir,e.name));
}}
verifyPaths(path.join(target,'resources'));verifyPaths(path.join(target,'bin'));
console.log(JSON.stringify({target,papers:52,visiblePapers:45,...counts,images:587,status:'passed'},null,2));
