'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { GatewayAdapter } = require('../apps/exam-llm/src/adapter/gateway');
const { PersonalMaterialsSynthesizer } = require('../apps/exam-llm/src/materials/personal-materials-synthesizer');
const evidence = { questionId:'synthetic', stem:'依赖保持的判断依据？', userAnswer:'A', standardAnswer:'B',
  analysis:'所有子模式投影依赖的并集能推出原依赖。', isCorrect:false, _reviewRef:'E1' };
const card = refs => ({topic:'依赖保持',gap:'选了 A',memory:'投影依赖的并集应能推出原依赖',
  action:'逐条计算原依赖左侧在投影依赖并集下的闭包',check:'AB、BC 分解能推出 A→C 吗？（在 A→B、B→C 下能）',refs});

test('Gemini runs evidence review without DeepSeek thinking fields, and ordinary chat is unchanged', async () => {
  const requests=[];
  const gw=new GatewayAdapter({endpoint:'https://synthetic.test/v1',model:'gemini-3.8-flash-high',apiKey:'',maxRetries:0,
    fetchFn:async (_url,opts)=>{
      const body=JSON.parse(opts.body); requests.push(body);
      return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({cards:[card(['E1'])]})},finish_reason:'stop'}]})};
    }});
  const out=await new PersonalMaterialsSynthesizer({gatewayAdapter:gw}).synthesizeChapterMaterial({
    chapterKey:'db',chapterName:'数据库',answeredEvidences:[evidence]});
  assert.equal(requests.length,2);
  assert.match(requests[1].messages[0].content,/最终的来源校验/);
  assert.match(requests[1].messages[1].content,/投影依赖/);
  assert.match(requests[1].messages[0].content,/每条非平凡依赖/);
  assert.deepEqual(out.metadata.reviewCards[0].refs,['E1']);
  for(const request of requests){
    assert.equal(request.thinking,undefined); assert.equal(request.reasoning_effort,undefined);
    assert.equal(request.response_format,undefined);
  }
  await gw.chatCompletion({messages:[{role:'user',content:'普通问答'}]});
  assert.equal(requests.at(-1).max_tokens,4096);
  assert.equal(requests.at(-1).thinking,undefined);
});

test('Gemini source review subdivides truncated batches and preserves every evidence reference', async () => {
  const sizes=[];
  const gw={model:'gemini-3.8-flash-high',chatCompletion:async opts=>{
    assert.equal(opts.thinkingMode,undefined); assert.equal(opts.reasoningEffort,undefined);
    const refs=opts.messages[1].content.split('\n').filter(line=>line.startsWith('{')).map(JSON.parse).filter(row=>row.ref).map(row=>row.ref);
    sizes.push(refs.length);
    return refs.length>1 ? {content:'{"cards":[',raw:{choices:[{finish_reason:'length'}]}} :
      {content:JSON.stringify({cards:[card(refs)]}),raw:{choices:[{finish_reason:'stop'}]}};
  }};
  const synth=new PersonalMaterialsSynthesizer({gatewayAdapter:gw});
  const evs=[evidence,{...evidence,questionId:'synthetic2',_reviewRef:'E2'}];
  const cards=await synth._reviewAgainstEvidence('数据库','objective',evs.map(ev=>card([ev._reviewRef])),evs,null);
  assert.deepEqual(sizes,[2,1,1]);
  assert.deepEqual(cards.flatMap(c=>c.refs),['E1','E2']);
});

test('Gemini final review rejects persistent truncation or missing evidence instead of yielding partial material', async () => {
  for(const invalid of ['truncated','missing']){
    const requests=[];
    const gw={model:'gemini-3.8-flash-high',chatCompletion:async opts=>{
      requests.push(opts);
      if(requests.length===1)return {content:JSON.stringify({cards:[card(['E1'])]})};
      return invalid==='truncated' ? {content:'{"cards":[',raw:{choices:[{finish_reason:'length'}]}} :
        {content:JSON.stringify({cards:[card(['E99'])]})};
    }};
    await assert.rejects(new PersonalMaterialsSynthesizer({gatewayAdapter:gw}).synthesizeChapterMaterial({
      chapterKey:'db',chapterName:'数据库',answeredEvidences:[evidence],existingMarkdown:'已有完整资料'}),
    invalid==='truncated'?/保留上一版本/:/范围外证据/);
    if(invalid==='truncated')assert.equal(requests.at(-1).maxTokens,16384);
  }
});
