// Opt-in real-provider smoke test. Isolated database, no network research or real project changes.
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server/index.mjs';
import {createProject} from '../server/tools.mjs';
import assert from 'node:assert/strict';
assert.ok(process.argv[2],'Pass a provider configuration path explicitly');
const config=JSON.parse(readFileSync(process.argv[2],'utf8'));
config.chat={...config.chat,maxTokens:1400,timeoutMs:45000};config.allowNetwork=false;config.allowShell=false;
const home=mkdtempSync(join(tmpdir(),'lede-live-workflow-')),app=createApp({home,port:0,providerConfig:config});
try{
 await app.listen();const p=createProject(app.r,{title:'任务交付实测（临时）'}),b=app.r.create('bot',{title:'交付测试成员',role:'worker',tools:[],instructions:'这是一次明确授权的工具协议实测。不要联网，不要研究。使用 task.submit 保存指定测试文本，完成后结束回合。'});app.r.update(p.id,{memberBotIds:[p.leadBotId,b.id]},{baseRevision:1});
 const task=app.r.create('task',{title:'保存工具协议测试文本',projectId:p.id,assigneeBotId:b.id,acceptance:'保存正文：这是一份用于测试任务交付链路的临时资料。'});
 await app.coordinator.delegate({projectId:p.id,fromBotId:'@user',toBotId:b.id,taskId:task.id,baseRevision:1,request_id:'live-submit',message:'请立即调用 task.submit 一次：taskId 使用 assignedTask.id，baseRevision 使用 assignedTask.revision，summary 为“测试交付已保存”，content 为“这是一份用于测试任务交付链路的临时资料。”。不要等待批准，不要调用其他工具，提交后用一句话结束。'});
 const deadline=Date.now()+60000;while(Date.now()<deadline&&(app.kernel.active.size||app.kernel.ready.size||app.s.get('SELECT id FROM inbox LIMIT 1')))await new Promise(r=>setTimeout(r,250));
 const saved=app.r.get(task.id);assert.equal(saved.state,'review','Real model did not submit task');assert.ok(saved.outputRefs.length);assert.ok(app.r.resolve(saved.outputRefs[0]).content.includes('临时资料'));
 const runs=app.s.all('SELECT state,step FROM runs');assert.ok(runs.every(r=>r.state==='succeeded'));
 console.log(JSON.stringify({realProvider:true,model:config.chat.model,taskState:saved.state,savedOutputs:saved.outputRefs.length,runs}));
}finally{await app.close();rmSync(home,{recursive:true,force:true});}
