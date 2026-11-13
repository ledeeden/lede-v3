import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, call, settled } from './helpers.mjs';
import { createProject } from '../server/tools.mjs';
import { modelFixture } from './fixtures/model-server.mjs';
import { normalizeUsage, aggregateUsage, UsageLedger } from '../server/services/usage.mjs';
const usage={prompt_tokens:100,completion_tokens:20,total_tokens:120,prompt_cache_hit_tokens:80,prompt_cache_miss_tokens:20,prompt_tokens_details:{cached_tokens:80},completion_tokens_details:{reasoning_tokens:5}};

test('DeepSeek inclusive prompt cache normalization, unknown fields and contradictory samples',()=>{
    const s=normalizeUsage(usage);assert.equal(s.input,100);assert.equal(s.hit,80);assert.equal(s.total,120);
    assert.equal(normalizeUsage({prompt_tokens:100,completion_tokens:20,total_tokens:120}).completeness,'partial');
    assert.equal(normalizeUsage(null).total,null);
    assert.equal(normalizeUsage({...usage,total_tokens:200}).completeness,'unknown');
    assert.equal(normalizeUsage({...usage,prompt_cache_hit_tokens:101}).hit,null);
    assert.equal(normalizeUsage({...usage,prompt_tokens:'100'}).input,null);
    assert.equal(normalizeUsage({...usage,completion_tokens_details:{reasoning_tokens:21}}).reasoning,null);
    const t=aggregateUsage([s,normalizeUsage({...usage,prompt_tokens:900,prompt_cache_hit_tokens:90,prompt_cache_miss_tokens:810,total_tokens:920})]);
    assert.equal(t.rate,0.17);assert.equal(t.total,1040);
    assert.equal(aggregateUsage([s,normalizeUsage(null)]).rate,null);
});

test('Physical retries and repeated SSE usage samples are counted once per attempt',async t=>{
    const peer=await modelFixture(t,{respond:(_b,n)=>n===1?{httpError:503}:{content:'OK',usageSamples:[usage,usage],usage}});
    const app=await fixture(t,{providerConfig:peer.config});
    await app.providers.complete({messages:[{role:'user',content:'test'}],usageContext:{projectId:'p1',botId:'b1',purpose:'execution'}});
    const rows=app.usage.query().rows;assert.equal(rows.length,2);assert.equal(new Set(rows.map(x=>x.requestId)).size,1);
    assert.equal(rows.find(x=>x.attempt===1).total,null);assert.equal(rows.find(x=>x.attempt===2).total,120);
    assert.equal(app.usage.query().totals.total,120);assert.equal(peer.calls[0].body.stream_options.include_usage,true);
    const id=rows.find(x=>x.attempt===2).id;app.usage.finish(id,{raw:usage,state:'succeeded'});assert.equal(app.usage.query().totals.total,120);
});

test('Concurrent attribution, auxiliary calls, missing and interrupted usage survive in ledger',async t=>{
    const peer=await modelFixture(t,{respond:b=>b.messages[0].content==='cut'?{content:'partial',cut:true}:{content:'OK',usage:b.messages[0].content==='missing'?null:usage}});
    const app=await fixture(t,{providerConfig:peer.config});
    await Promise.all(['a','b'].map(projectId=>app.providers.withContext({projectId,botId:'shared-bot'},()=>app.providers.complete({messages:[{role:'user',content:'ok'}],usageContext:{purpose:'summary'}}))));
    await assert.rejects(app.providers.complete({messages:[{role:'user',content:'cut'}],usageContext:{projectId:'a'}}));
    await app.providers.complete({messages:[{role:'user',content:'missing'}],usageContext:{projectId:'a'}});
    assert.equal(app.usage.query({projectId:'a'}).rows.length,3);assert.equal(app.usage.query({projectId:'b'}).totals.total,120);
    assert.equal(app.usage.query({projectId:'a'}).totals.unknown,2);
    assert.equal(app.usage.query({projectId:'b'}).rows[0].purpose,'summary');
    assert.equal((await call(app,'usage?projectId=b')).body.rows.length,1);
    assert.equal((await call(app,'usage?start=invalid')).status,400);
    assert.equal((await call(app,'usage/detail?id=not-present')).status,404);
    assert.equal((await call(app,'usage/balance')).status,409);
    const id=app.usage.begin({},'restart-test',1,'fixture','chat');new UsageLedger(app.s);
    assert.equal(app.usage.detail(id).row.state,'interrupted');assert.equal(app.usage.detail(id).row.total,null);
});

test('Historical event import is idempotent, preserves unknown model and missing cache',async t=>{
    const app=await fixture(t);const session=app.coordinator.chat('global').session;
    app.s.sessionEvent(session.id,'assistant/message',{message:{role:'assistant',content:'old'},usage});
    app.s.setMeta('usageHistoryImported',false);new UsageLedger(app.s);new UsageLedger(app.s);
    const rows=app.usage.query().rows;assert.equal(rows.length,1);assert.equal(rows[0].total,120);
    assert.equal(rows[0].model,'历史模型未知');assert.equal(rows[0].projectId,'global');
});

test('Real kernel execution attributes persisted usage to project, Bot and Run',async t=>{
    const peer=await modelFixture(t,{respond:()=>({content:'done',usage})});
    const app=await fixture(t,{providerConfig:peer.config}),p=createProject(app.r,{title:'Usage test project',goal:'test only'});
    await app.coordinator.userMessage({projectId:p.id,content:'test'});await settled(app);
    const row=app.usage.query({projectId:p.id}).rows[0];assert.equal(row.botId,p.leadBotId);assert.equal(row.total,120);assert.ok(row.runId);assert.equal(row.runState,'succeeded');
});

test('Interrupted cumulative samples remain inspectable but are not final totals',async t=>{
    const peer=await modelFixture(t,{respond:()=>({content:'partial',usageSamples:[usage],cut:true})});
    const app=await fixture(t,{providerConfig:peer.config});
    await assert.rejects(app.providers.complete({messages:[{role:'user',content:'test'}]}));
    const row=app.usage.query().rows[0];assert.deepEqual(row.raw,usage);assert.equal(row.total,null);assert.equal(row.completeness,'unknown');
    const log=app.usage.detail(row.id).log;assert.equal(log.response.complete,false);assert.equal(log.response.message.content,'partial');
});

test('Per-request snapshots preserve sent content, redact configured keys and stay out of list payloads',async t=>{
    const peer=await modelFixture(t,{respond:()=>({content:'output secret-for-test',usage})});
    const app=await fixture(t,{providerConfig:peer.config});app.providers.config.chat.apiKey='secret-for-test';
    const messages=[{role:'system',content:'instructions secret-for-test'},{role:'user',content:'query'},{role:'tool',tool_call_id:'a',content:'long result '.repeat(100)}];
    await app.providers.complete({messages});
    const row=app.usage.query().rows[0],d=app.usage.detail(row.id);
    assert.equal(d.log.request.messages[0].content,'instructions [REDACTED]');
    assert.equal(d.log.response.message.content,'output [REDACTED]');
    assert.equal(d.log.analysis.messages.length,3);assert.equal(d.log.analysis.sections[0].name,'工具返回');
    assert.ok(!JSON.stringify(d).includes('secret-for-test'));
    assert.ok(!JSON.stringify(app.usage.query()).includes('long result'));
    assert.equal(d.log.request.stream_options.include_usage,true);
});

test('Request logs associate only tools emitted by that step, not the latest tools of a run',async t=>{
    const peer=await modelFixture(t,{respond:(_b,n)=>n===1?{tools:[{id:'specific-tool',name:'knowledge__create',args:{title:'request log test',content:'saved result'}}],usage}:{content:'finished',usage}});
    const app=await fixture(t,{providerConfig:peer.config}),p=createProject(app.r,{title:'Request log project',goal:'test'});
    await app.coordinator.userMessage({projectId:p.id,content:'test'});await settled(app);
    const rows=app.usage.query({projectId:p.id}).rows;
    const first=app.usage.detail(rows.find(x=>x.step===1).id),second=app.usage.detail(rows.find(x=>x.step===2).id);
    assert.equal(first.tools.length,1);assert.equal(first.tools[0].args.title,'request log test');assert.ok(first.tools[0].result);
    assert.equal(second.tools.length,0);assert.ok(second.log.request.messages.some(m=>m.role==='tool'));
    const old=rows[0];app.s.run('DELETE FROM usage_request_logs WHERE request_id=?',old.requestId);
    assert.equal(app.usage.detail(old.id).log.requestAvailable,false);
});
