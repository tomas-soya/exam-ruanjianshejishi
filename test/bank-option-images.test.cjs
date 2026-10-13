'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {sanitizeObjectiveQuestion,assertStrictAnswerIsolation}=require('../apps/exam-contracts/dist/index.js');
test('option assets survive actual contracts while solution, wrong-owner and avatar assets are removed',()=>{
  const q=sanitizeObjectiveQuestion({id:'synthetic',subject:'objective',options:[{key:'A',text:'',images:[{type:'stem',owner:'option:A',local_path:'assets/a.png',sha256:'a'},{type:'stem',owner:'option:A',local_path:'assets/a2.png',sha256:'a2'},{type:'solution',local_path:'assets/answer.png'},{type:'stem',owner:'option:B',local_path:'assets/b.png'},{type:'stem',local_path:'assets/avatar.png',source_url:'https://avatars.githubusercontent.com/u/1'}],answers:{effective_answer:'A'}}]});
  assert.equal(q.options[0].images.length,2);assert.equal(q.options[0].images[0].localPath,'assets/a.png');assert.equal(q.options[0].images[1].localPath,'assets/a2.png');assert(!q.options[0].answers);assertStrictAnswerIsolation(q);
});
