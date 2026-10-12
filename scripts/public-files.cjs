'use strict';
const fs=require('node:fs');
const path=require('node:path');

function publicFiles(root){
  const result=[];
  function add(f){if(fs.existsSync(path.join(root,f)))result.push(f);}
  function tree(dir,filter=()=>true){
    if(!fs.existsSync(path.join(root,dir)))return;
    for(const e of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){
      if(e.isSymbolicLink())throw new Error(`Symlink outside release allowlist: ${dir}/${e.name}`);
      const f=`${dir}/${e.name}`;
      if(!filter(f,e))continue;
      if(e.isDirectory())tree(f,filter);else add(f);
    }
  }
  for(const f of ['README.md','LICENSE','CONTENT_NOTICE.md','THIRD_PARTY_NOTICES.md','CONTRIBUTING.md','.gitignore','.gitattributes','package.json','package-lock.json'])add(f);
  tree('.github');tree('test',(_,e)=>e.isDirectory()||/\.test\.cjs$/.test(e.name));
  for(const app of ['exam-contracts','exam-service','exam-llm','exam-web']){
    add(`apps/${app}/package.json`);
    tree(`apps/${app}/src`,(_,e)=>!['calibration'].includes(e.name)&&(e.isDirectory()||/\.(js|ts|mjs|sql)$/.test(e.name)));
  }
  tree('apps/exam-contracts/dist');tree('apps/exam-web/public');add('apps/exam-web/server.js');
  for(const dir of ['题库/papers','题库/questions/objective','题库/questions/case']){
    for(const name of fs.readdirSync(path.join(root,dir)))if(/^(?:sd-|oq-|cg-).+\.json$/.test(name))add(`${dir}/${name}`);
  }
  add('题库/manifest.reconciliation.json');
  for(const name of fs.readdirSync(path.join(root,'题库/assets')))if(/^[a-f0-9]{64}\.(png|jpg|jpeg|gif|webp|svg|bin)$/.test(name))add(`题库/assets/${name}`);
  for(const dir of ['选择题','案例题']){
    for(const name of fs.readdirSync(path.join(root,'软件设计师复习材料',dir)))if(name.endsWith('.md'))add(`软件设计师复习材料/${dir}/${name}`);
    tree(`软件设计师复习材料/${dir}/assets`);
  }
  for(const name of ['软件设计师复习材料-选择题.md','软件设计师复习材料-案例题.md'])add(`软件设计师复习材料/${name}`);
  for(const f of ['scripts/verify-public-content.cjs','scripts/verify-release.cjs','scripts/update-release-manifest.cjs','scripts/public-files.cjs','scripts/build-portable.mjs','scripts/portable/Launcher.cs','scripts/portable/SingleExePackage.cs','scripts/portable/verify-portable.mjs'])add(f);
  for(const name of fs.readdirSync(path.join(root,'scripts/portable')))if(/^NODE-LICENSE-v[\d.]+\.txt$/.test(name))add(`scripts/portable/${name}`);
  return result.sort();
}
module.exports={publicFiles};
