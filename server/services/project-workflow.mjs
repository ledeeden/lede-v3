import {assert} from '../../shared/schema.mjs';
import {hash,now} from '../db.mjs';
import {parseURI} from '../../shared/uri.mjs';

// A Work executes a Task; the identities and their independent lifecycles stay separate.
export class ProjectWorkflow {
 constructor(s,r,coordinator){Object.assign(this,{s,r,coordinator});s.db.exec(`CREATE TABLE IF NOT EXISTS task_work_links(work_id TEXT PRIMARY KEY REFERENCES works(id),task_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,created_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS task_work_task ON task_work_links(task_id);`);}
 taskFor(workId){const row=this.s.get('SELECT task_id FROM task_work_links WHERE work_id=?',workId??'');return row&&this.r.maybe(row.task_id);}
 validateDispatch({taskId,baseRevision,projectId,toBotId,fromBotId}){
  const task=this.r.get(taskId),p=this.r.get(projectId);
  assert(task.kind==='task'&&task.projectId===projectId,'任务不属于本项目');
  assert(fromBotId==='@user'||fromBotId===p.leadBotId,'由负责人派发项目任务',403);
  assert(task.revision===baseRevision,'任务已修改，请刷新后派发',409,'REVISION_CONFLICT');
  assert(['queued','blocked'].includes(task.state),'只可派发排队或受阻任务');
  assert(task.dependencies.every(id=>this.r.get(id).state==='done'),'依赖任务尚未完成');
  assert(p.memberBotIds.includes(toBotId),'执行者不属于项目');
  const bot=this.r.get(toBotId),missing=(task.requiredTools??[]).filter(name=>!this.coordinator.kernel?.tools.allowed(name,bot));assert(!missing.length,'执行成员缺少所需工具：'+missing.join('、')+'。请调整任务或配置成员。',409,'CAPABILITY_MISMATCH');
  assert(!this.s.get("SELECT l.work_id FROM task_work_links l JOIN works w ON w.id=l.work_id WHERE l.task_id=? AND w.state IN ('open','waiting','delivered')",taskId),'该任务仍有未交回的工作',409);
  return task;
 }
 attach(workId,task,toBotId){this.s.run('INSERT INTO task_work_links VALUES(?,?,?)',workId,task.id,now());return this.r.update(task.id,{assigneeBotId:toBotId,state:'queued',workId,blockReason:null},{baseRevision:task.revision,actor:'workflow'});}
 started(workId){const task=this.taskFor(workId);if(task&&task.workId===workId&&task.state==='queued')this.r.update(task.id,{state:'doing'},{baseRevision:task.revision,actor:'workflow'});}
 finished(workId,outcome){const task=this.taskFor(workId);if(!task||task.workId!==workId||!['queued','doing'].includes(task.state)||['waiting','waiting_input'].includes(outcome))return;
  const reason=outcome==='succeeded'?'本轮执行结束，但尚未提交任务成果。':`执行未完成（${outcome}），需检查记录后继续。`;
  this.r.update(task.id,{state:'blocked',blockReason:reason},{baseRevision:task.revision,actor:'workflow'});
  return reason;
 }
 submit(a,c){return this.s.transaction(()=>{
  const task=this.taskFor(c.workId);assert(task&&task.id===a.taskId&&task.projectId===c.projectId&&task.assigneeBotId===c.bot.id&&task.workId===c.workId,'只能提交当前派活对应的本人任务',403);
  assert(task.revision===a.baseRevision,'任务已修改，请先读取当前任务',409,'REVISION_CONFLICT');assert(['doing','blocked'].includes(task.state),'任务不在可提交状态');
  assert(typeof a.summary==='string'&&a.summary.trim(),'请说明本次交付');
  const refs=[...new Set(a.outputRefs??[])];
  for(const ref of refs){const obj=this.r.resolve(ref);assert(['object','view'].includes(obj.kind)&&this.s.get('SELECT 1 FROM project_links WHERE project_id=? AND resource_id=?',c.projectId,obj.id),'交付物必须已关联本项目');}
  if(a.content?.trim()){
   const saved=this.r.create('object',{title:a.title||task.title,content:a.content,category:'report',projectId:c.projectId,taskIds:[task.id],producedBy:c.runId,deliveryState:'draft'},{id:'object_'+hash([c.callKey,'delivery']).slice(0,32),projectId:c.projectId,actor:c.bot.id});refs.push(saved.uri);
  }
  assert(refs.length,'请提交正文或已保存的成果 URI');
  const updated=this.r.update(task.id,{state:'review',outputRefs:refs,submission:{summary:a.summary,limitations:a.limitations??'',runId:c.runId,workId:c.workId,submittedAt:now()},blockReason:null},{baseRevision:task.revision,actor:c.bot.id});
  this.s.event('task.submitted',task.id,{projectId:c.projectId,outputRefs:refs});return updated;
 });}
 review(a,actor){return this.s.transaction(()=>{
  const task=this.r.get(a.taskId),p=this.r.get(task.projectId);assert(task.kind==='task'&&(actor==='user'||actor===p.leadBotId),'只有负责人或用户可验收',403);
  assert(task.state==='review','任务未提交验收');assert(a.evidence?.trim(),'请记录验收结论或退回原因');
  const accepted=a.action==='accept';assert(accepted||a.action==='rework','无效验收操作');
  if(accepted){assert(task.outputRefs?.length,'任务没有交付物');for(const ref of task.outputRefs){const output=this.r.resolve(ref);assert(output.status==='active'&&this.s.get('SELECT 1 FROM project_links WHERE project_id=? AND resource_id=?',p.id,output.id),'交付物已删除、归档或移出项目，请重新提交');}}
  const result=this.r.update(task.id,{state:accepted?'done':'queued',evidence:accepted?a.evidence:task.evidence,review:{action:a.action,note:a.evidence,actor,at:now()},blockReason:null},{baseRevision:a.baseRevision,actor});
  this.s.event('task.reviewed',task.id,{projectId:p.id,action:a.action});return result;
 });}
 snapshot(projectId){
  const ctx=this.r.projectContext(projectId),{project,tasks,resources}=ctx;
  const runs=this.s.all('SELECT id,session_id,bot_id,work_id,state,step,error,started_at,ended_at FROM runs WHERE project_id=? ORDER BY started_at DESC,id DESC',projectId);
  const works=this.s.all('SELECT w.id,w.sender,w.recipient,w.parent_id,w.state,w.created_at,w.updated_at,l.task_id FROM works w LEFT JOIN task_work_links l ON w.id=l.work_id WHERE w.project_id=? ORDER BY w.created_at DESC',projectId);
  const latest=[...new Map([...runs].reverse().map(r=>[r.bot_id,r])).values()];
  const pending=this.s.all("SELECT id,title,bot_id,created_at FROM confirmations WHERE project_id=? AND state='pending'",projectId);
  const outputs=new Set(tasks.flatMap(t=>(t.outputRefs??[]).flatMap(u=>{try{return[parseURI(u).id];}catch{return[];}})));
  const results=resources.filter(r=>r.kind==='view'||r.kind==='object'&&(r.producedBy||outputs.has(r.id)||['report','material','deliverable'].includes(r.category?.split('/').at(-1))));
  const active=runs.filter(r=>r.state==='running');
  const failures=latest.filter(r=>['failed','blocked','interrupted','truncated'].includes(r.state));
  const state=pending.length?'等待确认':active.length?'推进中':tasks.some(t=>t.state==='review')?'待验收':tasks.some(t=>t.state==='blocked')||failures.length?'受阻':works.some(w=>['open','waiting','delivered'].includes(w.state))?'等待回传':tasks.some(t=>['queued','doing'].includes(t.state))?'待推进':tasks.length&&tasks.every(t=>['done','canceled'].includes(t.state))?'任务已结项':results.length?'已有成果':runs.length?'等待新请求':'未开始';
  const focus=tasks.find(t=>['doing','review','blocked'].includes(t.state))?.title??tasks.find(t=>t.state==='queued')?.title??(results.length?'查看最新成果，确定下一步':project.goal);
  const members=ctx.members.map(b=>{const current=active.find(r=>r.bot_id===b.id),work=works.find(w=>w.recipient===b.id&&['open','waiting'].includes(w.state)),task=tasks.find(t=>t.assigneeBotId===b.id&&['doing','review','blocked','queued'].includes(t.state)),last=latest.find(r=>r.bot_id===b.id);return {...b,currentRun:current,currentTask:task,lastRun:last,runtimeLabel:current?(task?.title??'正在处理'):task?.state==='review'?'待验收':task?.state==='blocked'?'受阻':work?.state==='waiting'?'等成员结果':work?'已排队':last?.state==='succeeded'?'等待新请求':last&&['failed','blocked','truncated','interrupted'].includes(last.state)?'需检查':'空闲'};});
  return {...ctx,members,runs:latest,works,pending,results,state,focus,failures,completedTasks:tasks.filter(t=>t.state==='done').length};
 }
}
