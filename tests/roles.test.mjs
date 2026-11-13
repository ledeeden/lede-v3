import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, settled } from './helpers.mjs';
import { createProject } from '../server/tools.mjs';
import { modelFixture } from './fixtures/model-server.mjs';

test('existing wildcard global assistant has routing tools but cannot execute project work', async t => {
 const a=await fixture(t), bot=a.r.get('bot_global');
 const names=a.tools.definitions(bot,'global').map(x=>x.function.name);
 for(const name of ['project__create','project__delegate','knowledge__search']) assert.ok(names.includes(name));
 for(const name of ['web.fetch','shell.run','file.read','knowledge.create','task.update','task.submit','bot.create','bot.message','project.report']) {
  assert.equal(a.tools.allowed(name,bot,'global'),false,name);
  await assert.rejects(a.tools.execute(name,{}, {bot,projectId:'global'}),/not enabled/);
 }
});

test('roles follow project identity, retain worker delivery and reserve management for lead',async t=>{
 const a=await fixture(t),p=createProject(a.r,{title:'Agent 调研'}),lead=a.r.get(p.leadBotId);
 const worker=a.r.create('bot',{title:'研究员',role:'lead',tools:['*']});
 a.r.update(p.id,{memberBotIds:[lead.id,worker.id]},{baseRevision:p.revision});
 for(const name of ['task.create','task.dispatch','task.review','project.update','bot.create','project.report']) {
  assert.equal(a.tools.allowed(name,worker,p.id),false,name);
  assert.equal(a.tools.allowed(name,lead,p.id),true,name);
 }
 for(const name of ['task.submit','knowledge.create','web.fetch']) assert.equal(a.tools.allowed(name,worker,p.id),true);
 const task=a.r.create('task',{title:'尚未派发的任务',projectId:p.id,assigneeBotId:worker.id});
 await assert.rejects(a.tools.execute('task.update',{id:task.id,baseRevision:task.revision,patch:{state:'done',evidence:'成员自述完成'}},{bot:worker,projectId:p.id}),/负责人验收/);
 const global=a.kernel.prompt(a.r.get('bot_global'),a.coordinator.session('bot_global','global'));
 assert.match(global.system,/不先抓网页/);assert.match(global.system,/恢复须有用户新授权/);
 const prompt=a.kernel.prompt(worker,a.coordinator.session(worker.id,p.id));
 assert.match(prompt.system,/专业执行 Bot/);assert.match(prompt.system,/不能自行宣称验收完成/);
});

test('global routing creates project then wakes lead; forbidden research produces paired failed ledger',async t=>{
 let project;
 const peer=await modelFixture(t,{respond:body=>{
  const system=body.messages[0].content;
  if(!system.includes('projectId=global'))return {content:'负责人已接手；测试 fixture。'};
  const results=body.messages.filter(m=>m.role==='tool');
  if(!results.length)return {tools:[{name:'web__fetch',args:{url:'https://example.com'}}]};
  if(results.length===1)return {tools:[{name:'project__create',args:{title:'Agent 调研',goal:'以 agent 为主题，先研究 https://github.com/kkkkhazix/agent-autoloop'}}]};
  if(results.length===2){project=JSON.parse(results[1].content);return {tools:[{name:'project__delegate',args:{projectId:project.id,message:'开一个新项目，以 agent 作为主题调研，先看 https://github.com/kkkkhazix/agent-autoloop',request_id:'agent-first-source'}}]};}
  return {content:'已创建并交给负责人；测试 fixture。'};
 }});
 const a=await fixture(t,{providerConfig:peer.config});
 await a.coordinator.userMessage({projectId:'global',content:'开一个新项目，以 agent 作为主题调研，先看 https://github.com/kkkkhazix/agent-autoloop'});
 await settled(a);
 assert.equal(a.r.list({kind:'project'}).length,1);
 assert.ok(a.s.all('SELECT * FROM runs').some(r=>r.bot_id===project.leadBotId));
 const denied=a.s.get("SELECT * FROM tool_calls WHERE name='web.fetch'");
 assert.equal(denied.state,'failed');
 assert.ok(a.s.sessionEvents(a.coordinator.session('bot_global','global').id).some(e=>e.type==='tool/result'&&e.data.result?.error));
});
