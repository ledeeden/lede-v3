import {api,esc,md,date,toast} from './api.mjs';
import {avatarHTML} from './avatars.mjs';
const drafts=new Map();let rows=[],selected=null;
const href=row=>'#communication/'+encodeURIComponent(row.id);
export async function communicationHTML(id) {
 rows=await api.call('communication');selected=rows.find(r=>r.id===id)??null;
 const rowHTML=row=>`<a class="conversation-row ${row.id===selected?.id?'selected':''}" href="${href(row)}">${avatarHTML(row,36,rows)}<span class="conversation-copy"><strong>${esc(row.title)}</strong><small>${esc(row.projectTitle)}${row.pending.length?' · 等你决定':''}</small><span>${esc((row.pending[0]?.title??row.messages.at(-1)?.text??'开始对话').slice(0,70))}</span></span>${row.pending.length||row.unread?'<i class="conversation-unread" aria-label="有新消息"></i>':''}</a>`;
 return `<main class="communication-page ${selected?'has-conversation':''}"><nav class="conversation-list" aria-label="沟通列表"><div class="conversation-list-head"><span>沟通</span><span class="muted small">${rows.filter(r=>r.pending.length).length?rows.filter(r=>r.pending.length).length+' 个待决定':''}</span></div>${rows.map(rowHTML).join('')}</nav><section class="conversation-detail" aria-label="对话内容">${selected?detailHTML(selected):'<div class="conversation-empty">选择一个对话</div>'}</section></main>`;
}
function detailHTML(r) {
 const failure=r.lastRun&&['failed','blocked','truncated','interrupted'].includes(r.lastRun.state);
 return `<header class="conversation-header"><a class="conversation-back" href="#communication" aria-label="返回对话列表">‹</a>${avatarHTML(r,32,rows)}<div class="grow"><strong>${esc(r.title)}</strong><small>${esc(r.projectTitle)}</small></div>${r.projectId!=='global'?`<a class="small" href="#project/${r.projectId}/overview">项目 ↗</a>`:''}<button class="small ghost" id="conversation-records">工作记录</button></header><div class="conversation-messages" data-session="${r.id}">${r.messages.map(m=>`<article class="communication-message ${m.role}"><time>${date(m.at)}</time>${m.text.length>1200?`<details><summary><span>${esc(m.text.slice(0,180))}…</span><small>展开长消息</small></summary><div class="markdown">${md(m.text)}</div></details>`:`<div class="markdown">${md(m.text)}</div>`}</article>`).join('')||(r.pending.length?'':'<div class="conversation-empty">有什么需要一起推进的？</div>')}${r.pending.map(c=>`<section class="confirm-card"><h4>${esc(c.title)}</h4><p>${esc(c.data.do??'')}</p>${c.data.scope?`<p class="small muted">${esc(c.data.scope)}</p>`:''}<div class="row"><button data-action="confirm-yes" data-id="${c.id}" class="primary">确认，继续</button><button data-action="confirm-no" data-id="${c.id}">调整</button></div></section>`).join('')}${failure?`<div class="communication-status">本次工作未完成。<button class="small ghost" data-action="run" data-id="${r.lastRun.id}">查看原因</button></div>`:''}</div><details class="conversation-records" hidden><summary>工作记录</summary><div></div></details><div class="communication-status">${r.active?'正在处理；有关键结果时会在这里告诉你。':''}</div><form id="communication-compose"><textarea name="message" rows="2" aria-label="沟通消息" placeholder="说说你的想法…">${esc(drafts.get(r.id)??'')}</textarea><button type="submit" class="primary" aria-label="发送沟通消息">↑</button></form>`;
}
export function wireCommunication(refresh) {
 const r=selected;if(!r)return;
 const feed=document.querySelector('.conversation-messages');feed.scrollTop=feed.scrollHeight;
 const form=document.querySelector('#communication-compose'),input=form.elements.message;
 input.oninput=()=>drafts.set(r.id,input.value);
 input.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();form.requestSubmit();}};
 form.onsubmit=async e=>{e.preventDefault();const content=input.value.trim();if(!content)return;const button=form.querySelector('button');button.disabled=true;try{await api.call('chat',{projectId:r.projectId,targetBotId:r.botId,content,requestId:crypto.randomUUID(),options:{mode:'execute'}});drafts.delete(r.id);await refresh();}catch(e){toast(e.message,true);}finally{button.disabled=false;}};
 const last=r.messages.at(-1)?.seq??0;
 if(r.unread)api.call('communication/read',{sessionId:r.id,seq:last}).then(()=>{if(!r.pending.length)document.querySelector('.conversation-row.selected .conversation-unread')?.remove();}).catch(e=>toast(e.message,true));
 document.querySelector('#conversation-records').onclick=async()=>{
  const box=document.querySelector('.conversation-records');if(!box.hidden){box.hidden=true;return;}
  const data=await api.call('chat?projectId='+encodeURIComponent(r.projectId)+'&botId='+encodeURIComponent(r.botId));
  box.querySelector('div').innerHTML=data.events.filter(e=>e.type==='assistant/message'&&e.data.message?.content).map(e=>`<article><time>${date(e.created_at)}</time><div class="markdown">${md(e.data.message.content)}</div></article>`).join('')||'<p>暂无工作记录</p>';box.hidden=false;box.open=true;
 };

}
