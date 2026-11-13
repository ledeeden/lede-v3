import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, settled } from './helpers.mjs';
import { modelFixture } from './fixtures/model-server.mjs';
import { createProject } from '../server/tools.mjs';
import { RequestContext, balancedCuts, selectRange, measure } from '../server/runtime/request-context.mjs';
import { COMPACTION_INSTRUCTION } from '../server/runtime/compaction.mjs';
import { providerErrorCode } from '../server/services/providers.mjs';
import { resolveConfig, resolveTargetPolicy, resolveCompactSpec } from '../server/runtime/compaction-policy.mjs';

test('real HTTP requests retain exact prior prefix across project mutations and turns',async t=>{
    let n=0;
    const peer=await modelFixture(t,{respond:body=>body.messages[0].content.startsWith('长期记忆整理')?{content:'{"changes":[]}'}:++n===1?{tools:[{name:'task__create',args:{title:'持久任务'}}]}:{content:'完成'}});
    const a=await fixture(t,{providerConfig:peer.config}),p=createProject(a.r,{title:'缓存'});
    await a.coordinator.userMessage({projectId:p.id,content:'创建任务'});await settled(a);
    const first=peer.calls[0].body,second=peer.calls[1].body;
    assert.deepEqual(second.messages.slice(0,first.messages.length),first.messages);
    assert.deepEqual(second.tools,first.tools);
    assert.ok(second.messages.at(-1).content.includes('持久任务'));
    assert.ok(second.messages.at(-1).content.includes('替代此前'));
    await a.coordinator.userMessage({projectId:p.id,content:'继续'});await settled(a);
    assert.deepEqual(peer.calls.filter(c=>c.body.tools?.length)[2].body.messages.slice(0,second.messages.length),second.messages);
    const ss=a.coordinator.session(p.leadBotId,p.id),fresh=new RequestContext(a.s);
    assert.deepEqual(fresh.messages(ss.id),a.kernel.requestContext.messages(ss.id));
    const before=fresh.messages(ss.id);
    const workId=a.s.all('SELECT work_id FROM runs WHERE session_id=? ORDER BY rowid',ss.id).at(-1).work_id;
    a.kernel.admitContext(a.r.get(p.leadBotId),ss,workId,{},2,1);
    assert.deepEqual(fresh.messages(ss.id),before,'unchanged context is not duplicated');
});

test('context removal, compaction supersession and header changes survive reconstruction',async t=>{
    const a=await fixture(t),ss=a.coordinator.session('bot_global','global'),c=new RequestContext(a.s);
    const h={system:'system',tools:[],provider:'test',model:'m',maxTokens:100,effort:null};
    c.admit(ss.id,h,[{name:'project',text:'old </system-reminder>'}]);
    assert.match(c.messages(ss.id)[1].content,/<\\\/system-reminder>/);
    const old=c.messages(ss.id);
    new RequestContext(a.s).admit(ss.id,h,[]);
    assert.deepEqual(c.messages(ss.id).slice(0,old.length),old);
    assert.match(c.messages(ss.id).at(-1).content,/清空/);
    const last=c.nodes(ss.id).at(-1).seq;
    a.s.run('UPDATE sessions SET checkpoint=?,checkpoint_seq=? WHERE id=?','summary',last,ss.id);
    c.admit(ss.id,{...h,system:'new system'},[]);
    assert.equal(c.messages(ss.id)[0].content,'new system');
    assert.match(c.messages(ss.id).at(-1).content,/清空/);
    assert.equal(a.s.sessionEvents(ss.id).filter(e=>e.type==='request/header').length,2);
});

async function historyFixture(t,respond) {
    const peer=await modelFixture(t,{respond}),a=await fixture(t,{providerConfig:peer.config});
    const ss=a.coordinator.session('bot_global','global'),c=a.kernel.requestContext;
    const header={system:'stable system',tools:[{type:'function',function:{name:'read',parameters:{type:'object'}}}],provider:peer.baseURL,model:'routed-model',effort:'high',maxTokens:4096};
    c.admit(ss.id,header,[{name:'project',text:'facts'}]);
    a.s.sessionEvent(ss.id,'user/message',{content:'用户约束：不要发广告',source:{kind:'user'}});
    for(let i=0;i<4;i++) {
        a.s.sessionEvent(ss.id,'assistant/message',{message:{role:'assistant',content:'',reasoning_content:'retained reasoning',tool_calls:[{id:'c'+i,type:'function',function:{name:'read',arguments:'{}'}}]}});
        a.s.sessionEvent(ss.id,'tool/result',{callId:'c'+i,result:{text:'source text '.repeat(600)}});
    }
    a.s.sessionEvent(ss.id,'user/message',{content:'下一步',source:{kind:'user'}});
    return {a,ss,c,peer,header};
}

test('summary uses exact conversation prefix, tools, routed model and effort; paired history shrinks',async t=>{
    const {a,ss,c,peer,header}=await historyFixture(t,()=>({content:'保持约束，继续未完成任务'}));
    const before=c.messages(ss.id);
    await a.kernel.compaction.run(ss.id,{force:true});
    const body=peer.calls[0].body;
    assert.deepEqual(body.messages.slice(0,-1),before.slice(0,-1));
    assert.equal(body.messages.at(-1).content,COMPACTION_INSTRUCTION);
    assert.deepEqual(body.tools,header.tools);assert.equal(body.model,'routed-model');assert.equal(body.reasoning_effort,'high');
    assert.ok(c.messages(ss.id).length<before.length);assert.match(c.messages(ss.id)[1].content,/不要发广告/);
    assert.equal(balancedCuts(c.nodes(ss.id)).at(-1),true);
    assert.equal(a.s.sessionEvents(ss.id).at(-1).type,'compaction/end');
});

for(const [name,response] of [
    ['truncation',{content:'incomplete',finish:'length'}],
    ['empty',{content:''}],
    ['tool response',{tools:[{name:'read',args:{}}]}],
    ['larger summary',{content:'larger '.repeat(15000)}],
]) test('failed compaction preserves history: '+name,async t=>{
    const {a,ss,c}=await historyFixture(t,()=>response),before=c.messages(ss.id);
    await assert.rejects(()=>a.kernel.compaction.run(ss.id,{force:true}));
    assert.deepEqual(c.messages(ss.id),before);
    assert.equal(a.s.get('SELECT checkpoint FROM sessions WHERE id=?',ss.id).checkpoint,null);
    assert.equal(a.s.sessionEvents(ss.id).at(-1).type,'compaction/end');
    assert.equal(a.s.all('SELECT * FROM tool_calls').length,0);
});

test('concurrent history change and cancellation cannot commit a stale checkpoint',async t=>{
    let mutate;
    const {a,ss,c}=await historyFixture(t,()=>{mutate();return {content:'valid short summary'};});
    mutate=()=>a.s.sessionEvent(ss.id,'user/message',{content:'new input',source:{kind:'user'}});
    await assert.rejects(()=>a.kernel.compaction.run(ss.id,{force:true}),/会话已变化/);
    assert.equal(a.s.get('SELECT checkpoint FROM sessions WHERE id=?',ss.id).checkpoint,null);
    const abort=new AbortController();mutate=()=>abort.abort(Error('cancel'));
    await assert.rejects(()=>a.kernel.compaction.run(ss.id,{force:true,signal:abort.signal}));
    assert.equal(a.s.get('SELECT checkpoint FROM sessions WHERE id=?',ss.id).checkpoint,null);
    a.s.sessionEvent(ss.id,'compaction/start',{compactionId:'interrupted'});
    const before=c.messages(ss.id);a.kernel.compaction.recover();
    assert.deepEqual(c.messages(ss.id),before);
    assert.match(a.s.sessionEvents(ss.id).at(-1).data.error,/未自动重放/);
});

test('token retention never splits multi-tool batches; policies reject invalid budgets',()=>{
    const nodes=[{seq:1,message:{role:'user',content:'x'},tokens:20},{seq:2,message:{role:'assistant',tool_calls:[{id:'a'},{id:'b'}]},tokens:20},{seq:3,message:{role:'tool',tool_call_id:'a'},tokens:20},{seq:4,message:{role:'tool',tool_call_id:'b'},tokens:20}];
    assert.deepEqual(selectRange(nodes,20).map(n=>n.seq),[1]);
    assert.throws(()=>balancedCuts([{message:{role:'tool',tool_call_id:'orphan'}}]));
    assert.throws(()=>resolveConfig({retainRatio:.9,thresholdRatio:.8}));
    const config=resolveConfig({headroomTokens:100,maxTokens:100,modelPolicies:[{provider:'p',model:'m',retainTokens:100}]});
    const policy=resolveTargetPolicy(config,{provider:'p',model:'m'});
    assert.equal(resolveCompactSpec(policy,1000,100).thresholdTokens,800);
    assert.throws(()=>resolveCompactSpec(policy,100,100));
    assert.equal(providerErrorCode(400,'{"error":{"code":"context_length_exceeded"}}'),'CONTEXT_OVERFLOW');
    assert.equal(providerErrorCode(429,'context length exceeded'),'PROVIDER_ERROR');
    assert.equal(providerErrorCode(400,'invalid tool parameters'),'PROVIDER_ERROR');
});

test('provider-confirmed overflow retries only after durable shrink, without replaying tools',async t=>{
    let failed=false,executions=0;
    const peer=await modelFixture(t,{respond:body=>{
        if(body.messages.at(-1).content===COMPACTION_INSTRUCTION) return {content:'用户要求继续，保留工具结果引用。'};
        if(body.messages[0].content.startsWith('长期记忆整理')) return {content:'{"changes":[]}'};
        executions++;
        if(!failed) {failed=true;return {httpError:400,errorCode:'context_length_exceeded'};}
        return {content:'恢复完成'};
    }});
    const a=await fixture(t,{providerConfig:peer.config}),p=createProject(a.r,{title:'overflow'}),ss=a.coordinator.session(p.leadBotId,p.id);
    a.s.sessionEvent(ss.id,'user/message',{content:'此前资料 '+ 'data '.repeat(3000),source:{kind:'bot'}});
    a.s.sessionEvent(ss.id,'assistant/message',{message:{role:'assistant',content:'已读资料'}});
    await a.coordinator.userMessage({projectId:p.id,content:'继续'});await settled(a);
    assert.equal(executions,2);
    assert.equal(a.s.get('SELECT state FROM runs').state,'succeeded');
    assert.ok(a.s.get('SELECT checkpoint FROM sessions WHERE id=?',ss.id).checkpoint);
    assert.equal(a.s.all('SELECT * FROM tool_calls').length,0);
    assert.equal(a.usage.query({purpose:'execution'}).rows.length,2);
});

test('Harness pressure failure continues but explicit overflow without reduction fails',async t=>{
 const a=await fixture(t),p=createProject(a.r,{title:'pressure failure'}),bot=a.r.get(p.leadBotId),ss=a.coordinator.session(bot.id,p.id);
 a.kernel.admitContext(bot,ss,undefined,{},0,0);
 a.kernel.compaction.run=async()=>{throw Object.assign(Error('truncated summary'),{code:'MAX_TOKENS'});};
 assert.equal(await a.kernel.compact(ss,bot,new AbortController().signal,'test'),null);
 assert.equal(a.s.sessionEvents(ss.id).at(-1).type,'compaction/warning');
 await assert.rejects(a.kernel.compact(ss,bot,new AbortController().signal,'test',true),/truncated/);
 const abort=new AbortController();abort.abort(Error('cancel'));
 await assert.rejects(a.kernel.compact(ss,bot,abort.signal,'test'),/cancel/);
});

test('tool pruning preserves pairs and original evidence, survives reconstruction and is idempotent',async t=>{
 const a=await fixture(t),ss=a.coordinator.session('bot_global','global'),c=a.kernel.requestContext;
 a.s.sessionEvent(ss.id,'assistant/message',{message:{role:'assistant',content:'',tool_calls:[{id:'prune_call',type:'function',function:{name:'web__fetch',arguments:'{}'}}]}});
 const e=a.s.sessionEvent(ss.id,'tool/result',{callId:'prune_call',result:{text:'😀'.repeat(15000)}});
 const before=a.s.sessionEvents(ss.id).findLast(e=>e.type==='tool/result');
 assert.equal(c.pruneToolResults(ss.id),1);assert.equal(c.pruneToolResults(ss.id),0);
 assert.deepEqual(a.s.sessionEvents(ss.id).findLast(e=>e.type==='tool/result'),before);
 assert.match(c.nodes(ss.id).at(-1).message.content,/full original: lede:\/\/session/);
 assert.equal(balancedCuts(c.nodes(ss.id)).at(-1),true);
 assert.deepEqual(new RequestContext(a.s).messages(ss.id),c.messages(ss.id));
});

test('summary output cap is independent of normal completion cap',async t=>{
 const a=await fixture(t);a.providers.config.chat.contextWindow=65536;a.providers.config.chat.maxTokens=4096;
 const policy=a.kernel.compaction.policy({provider:'test',model:'test',maxTokens:4096});
 assert.equal(policy.spec.maxTokens,6553);
 a.providers.config.chat.compaction={maxTokens:8192};
 assert.equal(a.kernel.compaction.policy({provider:'test',model:'test',maxTokens:4096}).spec.maxTokens,8192);
});

test('provider length with partial tool JSON reaches truncated terminal and never executes',async t=>{
 const peer=await modelFixture(t,{respond:()=>({finish:'length',tools:[{name:'knowledge__create',args:'{"title":"partial","content":"unfinished'}]})});
 const a=await fixture(t,{providerConfig:peer.config}),p=createProject(a.r,{title:'partial JSON'});
 await a.coordinator.userMessage({projectId:p.id,content:'保存成果'});await settled(a);
 const run=a.s.get('SELECT * FROM runs');assert.equal(run.state,'truncated');assert.match(run.error,/输出上限/);
 assert.equal(a.r.list({kind:'object'}).length,0);
 assert.equal(a.s.all('SELECT * FROM tool_calls').length,0);
 assert.ok(a.s.sessionEvents(run.session_id).some(e=>e.type==='tool/result'&&e.data.result?.error?.code==='MAX_TOKENS'));
});
