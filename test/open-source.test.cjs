'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { QuestionBankLoader } = require('../apps/exam-service/src/bank/question-loader');
const { encodeRecord, decodeRecord, readRecord } = require('../apps/exam-service/src/bank/record-codec');
const { assertStrictAnswerIsolation, sanitizeCaseQuestion, gradeObjectiveQuestion } = require('../apps/exam-contracts/dist');
const { createDatabase } = require('../apps/exam-service/src/db/connection');
const { runMigrations } = require('../apps/exam-service/src/db/migrator');
const { upgradeBankIdentifiers } = require('../apps/exam-service/src/db/bank-id-upgrade');
const root = path.resolve(__dirname,'..');
process.env.LLM_API_KEY = 'isolated-test-placeholder';
process.env.OPENAI_API_KEY = 'isolated-test-placeholder';
process.env.LLM_GATEWAY_URL = 'http://127.0.0.1:1/v1';
process.env.OPENAI_BASE_URL = 'http://127.0.0.1:1/v1';
const bank = new QuestionBankLoader(path.join(root,'题库'));

test('Complete packaged bank, neutral identifiers, valid answers and local image associations',()=>{
  assert.equal(bank.listVerifiedPapers().length,44);
  const p202411 = bank.listVerifiedPapers().filter(p => p.year === '2024' && p.season === '11' && p.subject === 'objective');
  assert.equal(p202411.length, 1);
  assert.equal(p202411[0].totalQuestions, 75);
  let counts={objective:0,case:0};
  let solutions=0;
  for(const subject of ['objective','case']) {
    for(const f of fs.readdirSync(path.join(root,'题库/questions',subject))) {
      if(!f.endsWith('.json'))continue;
      const raw=readRecord(path.join(root,'题库/questions',subject,f));
      assert.match(raw.id,subject==='case'?/^cg-[a-f0-9]{20}$/:/^oq-[a-f0-9]{20}$/);
      assert(raw.question_stem||raw.shared_stem);
      assert(raw.analysis||raw.solution_and_analysis);
      if(subject==='objective')assert(raw.options.some(o=>o.key===raw.answers.effective_answer));
      for(const im of raw.images||[]) {
        assert.match(im.local_path,/^题库\/assets\/[a-f0-9]{64}\./);
        assert(fs.existsSync(path.join(root,im.local_path)));
        if(im.type==='solution')solutions++;
      }
      assertStrictAnswerIsolation(bank.getSanitizedQuestion(raw.id));
      counts[subject]++;
    }
  }
  assert.deepEqual(counts,{objective:1560,case:162});
  assert(solutions>=44);
  for(const p of bank.listVerifiedPapers()) {
    const ids=bank.getPaperQuestionIds(p.id);
    assert(ids.length>0);
    assert.equal(bank.getSanitizedPaperQuestions(p.id).length,ids.length);
  }
  const chapters=bank.listChapters();
  const expected=bank.listVerifiedPapers().reduce((tot,p)=>{tot[p.subject]+=bank.getPaperQuestionIds(p.id).length;return tot;},{objective:0,case:0});
  assert.equal(chapters.reduce((n,c)=>n+c.objectiveCount,0),expected.objective);
  assert.equal(chapters.reduce((n,c)=>n+c.caseCount,0),expected.case);
  assert(bank.listVerifiedPapers().some(p=>String(p.year)==='2009'));
});

test('Record corruption fails checksum; old JSON remains readable',()=>{
  const raw={question_stem:'a',answers:{effective_answer:'A'}};
  assert.deepEqual(decodeRecord(encodeRecord(raw)),raw);
  assert.deepEqual(decodeRecord(raw),raw);
  assert.throws(()=>decodeRecord({...encodeRecord(raw),sha256:'0'.repeat(64)}));
});

test('Renamed records still support drafts, objective grading, case grading and reports',async()=>{
  const db=createDatabase();runMigrations(db);
  const {ExamService}=require('../apps/exam-service/src/service/exam-service');
  const {RuleBasedCaseEvaluator}=require('../apps/exam-service/src/scoring/case-evaluator');
  const service=new ExamService({db,bankLoader:bank,caseEvaluator:new RuleBasedCaseEvaluator(),autoStartSync:false});
  try {
    for(const subject of ['objective','case']) {
      const paper=bank.listVerifiedPapers().find(p=>p.subject===subject);
      const raw=bank.getRawPaperQuestions(paper.id)[0];
      const session=service.createSession({paperId:paper.id});
      service.saveAnswerDraft(session.id,{questionId:raw.id,questionType:subject,userAnswer:subject==='case'?{sub1:'作答测试'}:raw.answers.effective_answer});
      assert.equal(service.resumeSession(session.id).questions[0].id,raw.id);
      const report=await service.submitSession(session.id);
      assert.equal(report.questions[0].question.id,raw.id);
      assert(report.questions[0].analysis.length>0);
      if(subject==='objective')assert.equal(report.questions[0].isCorrect,true);
      else assert(report.questions[0].score>=0&&report.questions[0].score<=15);
    }
  }finally{service.materialSyncManager.shutdown();db.close();}
});

test('Case subquestions expose only prompts, never nested answers or analysis',()=>{
  const raw={id:'case-test',subject:'case',shared_stem:'背景',subquestions:[{stem:'（3分）给出实体名称',answer:'秘密答案',analysis:'秘密解析'}]};
  const safe=sanitizeCaseQuestion(raw);
  assert.equal(safe.subQuestions[0].stem,raw.subquestions[0].stem);
  assert(!JSON.stringify(safe).includes('秘密'));
  assertStrictAnswerIsolation(safe);
});

test('All 21 chapter files remain verbatim synchronized with their aggregate materials',()=>{
  let checked=0;
  for(const [dir,name]of [['选择题','软件设计师复习材料-选择题.md'],['案例题','软件设计师复习材料-案例题.md']]){
    const aggregate=fs.readFileSync(path.join(root,'软件设计师复习材料',name),'utf8');
    for(const f of fs.readdirSync(path.join(root,'软件设计师复习材料',dir)).filter(f=>/^\d{2}-.*\.md$/.test(f)&&!f.startsWith('00'))){
      const chapter=fs.readFileSync(path.join(root,'软件设计师复习材料',dir,f),'utf8').trim();
      assert(aggregate.includes(chapter),f);checked++;
    }
  }
  assert.equal(checked,21);
});

test('An unconfigured AI model fails before making any request',async()=>{
  const {GatewayAdapter}=require('../apps/exam-llm/src/adapter/gateway');
  let called=false;
  const gateway=new GatewayAdapter({model:'',apiKey:'fixture',fetchFn:async()=>{called=true;throw new Error('Unexpected external request');}});
  await assert.rejects(()=>gateway.chatCompletion({messages:[{role:'user',content:'test'}]}),/配置 AI/);
  assert.equal(called,false);
});

test('Identifier upgrade preserves every answer, grade, timestamp and API setting; repeat is a no-op',()=>{
  const db=createDatabase();runMigrations(db);
  try {
    db.prepare("INSERT INTO exam_sessions(id,session_mode,paper_id,title,score,status) VALUES('s','paper','old-paper','记录',23,'submitted')").run();
    db.prepare("INSERT INTO exam_answers(id,session_id,question_id,question_type,user_answer_json,score) VALUES('a','s','old-q','objective','\"A\"',1)").run();
    db.prepare("INSERT INTO wrong_questions(id,question_id,paper_id,chapter,question_type,wrong_count) VALUES('w','old-q','old-paper','章','objective',7)").run();
    db.prepare("INSERT INTO review_queue(id,question_id,next_review_at,repetitions) VALUES('r','old-q','2030-01-01',3)").run();
    db.prepare("INSERT INTO case_reviews(id,answer_id,session_id,question_id,evaluator_type,points,human_notes) VALUES('c','a','s','old-q','human',9,'原批注')").run();
    db.prepare("INSERT INTO app_settings(key,value) VALUES('llm','fixture-config')").run();
    const tables=['exam_sessions','exam_answers','wrong_questions','review_queue','case_reviews','app_settings'];
    const before=Object.fromEntries(tables.map(t=>[t,db.prepare(`SELECT * FROM ${t}`).all()]));
    const result=upgradeBankIdentifiers(db,{'old-q':'new-q','old-paper':'new-paper'});
    assert.equal(result.changed,6);
    for(const t of tables) {
      const expected=before[t].map(row=>({...row,...('question_id'in row?{question_id:'new-q'}:{}),...('paper_id'in row?{paper_id:'new-paper'}:{})}));
      assert.deepEqual(db.prepare(`SELECT * FROM ${t}`).all().map(r=>({...r})),expected.map(r=>({...r})));
    }
    assert.equal(upgradeBankIdentifiers(db,{'old-q':'new-q','old-paper':'new-paper'}).changed,0);
  } finally {db.close();}
});

test('Identifier collision rolls back all changes and retains both records',()=>{
  const db=createDatabase();runMigrations(db);
  try {
    for(const id of ['old','new'])db.prepare("INSERT INTO wrong_questions(id,question_id,paper_id,chapter,question_type) VALUES(?,?,'p','c','objective')").run(id,id);
    const before=db.prepare('SELECT * FROM wrong_questions ORDER BY id').all();
    assert.throws(()=>upgradeBankIdentifiers(db,{old:'new'}),/原学习记录已保留/);
    assert.deepEqual(db.prepare('SELECT * FROM wrong_questions ORDER BY id').all(),before);
  } finally{db.close();}
});

test('Physical identifier upgrade creates a consistent private backup',()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ruankao-upgrade-'));
  const file=path.join(tmp,'test.db');const db=createDatabase(file);runMigrations(db);
  try{
    db.prepare("INSERT INTO exam_sessions(id,session_mode,paper_id,title) VALUES('s','paper','old','记录')").run();
    const result=upgradeBankIdentifiers(db,{old:'new'},file);
    assert(fs.existsSync(result.backupPath));
    const snapshot=createDatabase(result.backupPath);
    assert.equal(snapshot.prepare('SELECT paper_id FROM exam_sessions').get().paper_id,'old');
    snapshot.close();
  }finally{db.close();fs.rmSync(tmp,{recursive:true,force:true});}
});

test('Unified server serves all papers, actual assets and footer with an isolated database',async()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ruankao-service-'));
  const previous=Object.fromEntries(['DB_PATH','EXAM_DATA_DIR'].map(k=>[k,process.env[k]]));
  process.env.DB_PATH=path.join(tmp,'test.db');process.env.EXAM_DATA_DIR=tmp;
  let app;
  try {
    app=await require('../apps/exam-service/src/unified-server').startUnifiedServer({port:0,host:'127.0.0.1'});
    const base=`http://127.0.0.1:${app.server.address().port}`;
    const html=await(await fetch(base).catch(error => { throw new Error(`${error.message}: ${error.cause?.code || error.cause?.message || ''}`); })).text();
    assert.match(html,/该项目完全免费开源，如果你是花钱买到的，那么你被骗了/);
    assert.match(html,/对题目、刷题功能有任何建议，欢迎提交issue/);
    const catalog=await(await fetch(base+'/api/v1/papers')).json();
    assert.equal(catalog.data.length,44);
    assert.equal(catalog.data.filter(p=>p.year==='2024'&&p.season==='11'&&p.subject==='objective').length,1);
    const paper=catalog.data.find(p=>p.subject==='objective');
    const response=await(await fetch(base+'/api/v1/papers/'+paper.id)).json();
    assert.equal(response.success,true);
    assertStrictAnswerIsolation(response.data);
    const image=fs.readdirSync(path.join(root,'题库/assets')).find(f=>/^[a-f0-9]{64}\.(png|jpg)$/.test(f));
    const asset=await fetch(base+'/assets/'+image);
    assert.equal(asset.status,200);
    assert(Buffer.from(await asset.arrayBuffer()).equals(fs.readFileSync(path.join(root,'题库/assets',image))));
    assert.equal((await fetch(base+'/题库/questions/'+fs.readdirSync(path.join(root,'题库/questions/objective'))[0])).status,404);
    assert.equal((await fetch(base+'/project-info.js')).status,200);
  } finally {
    if(app)await app.close();
    for(const [k,v]of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
    fs.rmSync(tmp,{recursive:true,force:true});
  }
});
