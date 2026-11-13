// User communication is a projection of durable events, not a Bot group chat.
export function conversation(s, session) {
 const events=s.sessionEvents(session.id),runs=s.all('SELECT * FROM runs WHERE session_id=? ORDER BY rowid',session.id);
 const messages=events.filter(e=>e.type==='user/message'&&e.data.source?.kind==='user'&&!e.data.source?.recoveryOf).map(e=>({seq:e.seq,role:'user',text:e.data.content,at:e.created_at}));
 for(const e of events.filter(e=>e.type==='communication/message')) messages.push({seq:e.seq,role:'assistant',text:e.data.text,kind:e.data.kind,at:e.created_at});
 for(const run of runs) {
  if(!['succeeded','waiting','waiting_input'].includes(run.state))continue;
  const inputs=events.filter(e=>e.turn===run.turn&&e.type==='user/message');
  if(!inputs.some(e=>e.data.source?.kind==='user'&&!e.data.source?.recoveryOf))continue;
  if(events.some(e=>e.type==='communication/message'&&e.data.runId===run.id))continue;
  const last=events.filter(e=>e.type==='assistant/message'&&e.data.runId===run.id&&e.data.message?.content?.trim()).at(-1);
  if(last) messages.push({seq:last.seq,role:'assistant',text:last.data.message.content,at:last.created_at});
 }
 const pending=s.all("SELECT * FROM confirmations WHERE session_id=? AND state='pending'",session.id).map(x=>({...x,data:JSON.parse(x.data)}));
 return {sessionId:session.id,messages:messages.sort((a,b)=>a.seq-b.seq),pending,active:runs.findLast(r=>r.state==='running')??null,lastRun:runs.at(-1)??null};
}
export function communicationList(s,r) {
 const list=[];
 for(const session of s.all("SELECT * FROM sessions WHERE thread='main'")) {
  const bot=r.maybe(session.bot_id),project=r.maybe(session.project_id);
  if(!bot||bot.status!=='active'||session.project_id!=='global'&&(!project||project.status!=='active'))continue;
  const chat=conversation(s,session),lead=project?.leadBotId===bot.id;
  if(session.project_id!=='global'&&!lead&&!chat.messages.length&&!chat.pending.length)continue;
  const read=s.getMeta('communication-read:'+session.id,0);
  list.push({id:session.id,projectId:session.project_id,projectTitle:project?.title??'全局',botId:bot.id,title:bot.title,avatar:bot.avatar,lead,...chat,unread:chat.messages.filter(m=>m.role==='assistant'&&m.seq>read).length});
 }
 return list.sort((a,b)=>Number(!!b.pending.length)-Number(!!a.pending.length)||Number(!!b.unread)-Number(!!a.unread)||(b.messages.at(-1)?.seq??0)-(a.messages.at(-1)?.seq??0));
}
