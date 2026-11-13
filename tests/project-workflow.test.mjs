import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,settled} from './helpers.mjs';
import {createProject} from '../server/tools.mjs';
import {modelFixture} from './fixtures/model-server.mjs';

function setup(a){const p=createProject(a.r,{title:'项目运转测试'}),b=a.r.create('bot',{title:'研究成员',role:'worker',tools:['resource.read','knowledge.search']});a.r.update(p.id,{memberBotIds:[p.leadBotId,b.id]},{baseRevision:p.revision});const task=a.r.create('task',{title:'交付一份研究',projectId:p.id,assigneeBotId:b.id,acceptance:'保存研究正文与来源'});return {p,b,task};}
test('task dispatch is idempotent, submitted knowledge persists, and only lead accepts',async t=>{
 const a=await fixture(t);a.coordinator.kernel=null;const {p,b,task}=setup(a),w=a.coordinator.workflow;
 const args={projectId:p.id,fromBotId:p.leadBotId,toBotId:b.id,taskId:task.id,baseRevision:task.revision,message:'执行研究',request_id:'dispatch-1'};
 const sent=await a.coordinator.delegate(args),replay=await a.coordinator.delegate(args);assert.equal(replay.status,'replay');assert.equal(sent.receipt.workId,replay.receipt.workId);
 const workId=sent.receipt.workId;w.started(workId);assert.equal(a.r.get(task.id).state,'doing');
 assert.equal(a.tools.allowed('knowledge.create',b),false);assert.equal(a.tools.allowed('task.submit',b),true);
 const ctx={bot:b,projectId:p.id,workId,runId:'run_fixture',callKey:'test-submit'};
 assert.throws(()=>w.submit({taskId:task.id,baseRevision:1,summary:'结果',content:'测试内容'},ctx),/修改/);
 const result=w.submit({taskId:task.id,baseRevision:a.r.get(task.id).revision,summary:'研究已保存',content:'这是明确标记的测试交付',limitations:'仅测试'},ctx);
 assert.equal(result.state,'review');assert.equal(result.outputRefs.length,1);assert.equal(a.r.resolve(result.outputRefs[0]).content,'这是明确标记的测试交付');
 assert.throws(()=>w.review({taskId:task.id,baseRevision:result.revision,action:'accept',evidence:'验收'},b.id),/负责人/);
 w.finished(workId,'succeeded');assert.equal(a.r.get(task.id).state,'review');
 const done=w.review({taskId:task.id,baseRevision:result.revision,action:'accept',evidence:'已读取测试交付并核对要求'},p.leadBotId);assert.equal(done.state,'done');
 assert.equal(w.snapshot(p.id).results.length,1);
});
test('dispatch rejects unmet dependencies and a successful run without delivery remains blocked',async t=>{
 const a=await fixture(t);a.coordinator.kernel=null;const {p,b,task}=setup(a),w=a.coordinator.workflow;
 const dependent=a.r.create('task',{title:'后续',projectId:p.id,dependencies:[task.id]});
 await assert.rejects(a.coordinator.delegate({projectId:p.id,fromBotId:p.leadBotId,toBotId:b.id,taskId:dependent.id,baseRevision:1,message:'执行',request_id:'dependency'}),/依赖/);
 const sent=await a.coordinator.delegate({projectId:p.id,fromBotId:p.leadBotId,toBotId:b.id,taskId:task.id,baseRevision:1,message:'执行',request_id:'start'});
 w.started(sent.receipt.workId);w.finished(sent.receipt.workId,'succeeded');assert.equal(a.r.get(task.id).state,'blocked');assert.match(a.r.get(task.id).blockReason,/尚未提交/);
});
test('HTTP model loop submits despite narrow research tools and returns review URI to lead',async t=>{
 let p,b,task,a;
 const peer=await modelFixture(t,{respond:body=>{
  const bot=body.messages[0].content.match(/botId=([^;]+);/)[1];
  const called=n=>body.messages.some(m=>m.tool_calls?.some(c=>c.function.name===n));
  if(bot===b.id){if(!called('task__submit'))return {tools:[{name:'task__submit',args:{taskId:task.id,baseRevision:a.r.get(task.id).revision,summary:'测试报告已保存',content:'模型协议测试交付，非真实研究。'}}]};return {content:'报告已交付，等待负责人验收。'};}
  if(!called('task__dispatch'))return {tools:[{name:'task__dispatch',args:{taskId:task.id,baseRevision:a.r.get(task.id).revision,request_id:'protocol-dispatch'}}]};
  if(a.r.get(task.id).state==='review'&&!called('task__review'))return {tools:[{name:'task__review',args:{taskId:task.id,baseRevision:a.r.get(task.id).revision,action:'accept',evidence:'测试交付包含预期内容'}}]};
  return {content:a.r.get(task.id).state==='done'?'已验收。':'等待成员交回。'};
 }});
 a=await fixture(t,{providerConfig:peer.config});({p,b,task}=setup(a));
 await a.coordinator.userMessage({projectId:p.id,content:'开始任务并验收'});await settled(a);
 assert.equal(a.r.get(task.id).state,'done');assert.equal(a.r.list({kind:'object',projectId:p.id}).length,1);
 assert.ok(a.s.all('SELECT * FROM works').every(w=>w.state==='consumed'));
 assert.equal(a.coordinator.workflow.snapshot(p.id).state,'任务已结项');
});

test('rework requires a fresh dispatch; deleted outputs cannot be accepted',async t=>{
 const a=await fixture(t);a.coordinator.kernel=null;const {p,b,task}=setup(a),w=a.coordinator.workflow;
 const sent=await a.coordinator.delegate({projectId:p.id,fromBotId:p.leadBotId,toBotId:b.id,taskId:task.id,baseRevision:1,message:'研究',request_id:'first'}),workId=sent.receipt.workId;
 w.started(workId);let saved=w.submit({taskId:task.id,baseRevision:a.r.get(task.id).revision,content:'测试草稿',summary:'交付'}, {bot:b,projectId:p.id,workId,runId:'r',callKey:'first-submit'});
 const output=a.r.resolve(saved.outputRefs[0]);a.r.status(output.id,'archived');assert.throws(()=>w.review({taskId:task.id,baseRevision:saved.revision,action:'accept',evidence:'核对'},p.leadBotId),/归档/);
 saved=w.review({taskId:task.id,baseRevision:saved.revision,action:'rework',evidence:'补充来源'},p.leadBotId);assert.equal(saved.state,'queued');assert.equal(saved.review.note,'补充来源');
 assert.throws(()=>w.submit({taskId:task.id,baseRevision:saved.revision,content:'重复交付',summary:'交付'}, {bot:b,projectId:p.id,workId,runId:'r',callKey:'second-submit'}),/可提交/);
});

test('current project projection ignores superseded errors and includes namespaced reports',async t=>{
 const a=await fixture(t),{p,b}=setup(a),ss=a.coordinator.session(b.id,p.id);
 for(const [id,state,at] of [['old','blocked','2026-01-01'],['new','succeeded','2026-01-02']])a.s.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',id,ss.id,p.id,b.id,null,state,1,24,'[]',null,state==='blocked'?'旧的步数限制':null,at,at);
 a.r.create('object',{title:'分类报告',content:'明确的测试内容',category:'research/report'},{projectId:p.id});
 const snap=a.coordinator.workflow.snapshot(p.id);assert.equal(snap.failures.length,0);assert.equal(snap.results.length,1);assert.equal(snap.members.find(x=>x.id===b.id).lastRun.id,'new');assert.notEqual(snap.state,'未开始');
});

test('retry preserves task identity and returns the resumed delivery to the project lead',async t=>{
 const a=await fixture(t);a.coordinator.kernel=null;const {p,b,task}=setup(a),w=a.coordinator.workflow;
 const sent=await a.coordinator.delegate({projectId:p.id,fromBotId:p.leadBotId,toBotId:b.id,taskId:task.id,baseRevision:1,message:'执行',request_id:'retry-fixture'}),workId=sent.receipt.workId;
 w.started(workId);w.finished(workId,'failed');a.s.run("UPDATE works SET state='consumed' WHERE id=?",workId);
 const ss=a.coordinator.session(b.id,p.id);a.s.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)','retry_run',ss.id,p.id,b.id,workId,'failed',1,1,'[]',null,'测试故障','2026-01-01','2026-01-01');
 a.coordinator.retry('retry_run');const updated=a.r.get(task.id);assert.equal(updated.state,'queued');assert.notEqual(updated.workId,workId);assert.equal(w.taskFor(updated.workId).id,task.id);assert.equal(a.coordinator.handoffs.get(updated.workId).sender,p.leadBotId);
});
