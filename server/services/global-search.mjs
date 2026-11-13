import { assert } from '../../shared/schema.mjs';
import { uri } from '../../shared/uri.mjs';
const types = {知识:'knowledge',集合:'collection',项目:'project',事项:'project',动态:'activity',视图:'view',决策:'decision',报告:'report'};
export function parseSearch(query) {
 const filters={}; const text=query.replace(/\b(type|project):(?:"([^"]+)"|([^\s]+))/g,(_,key,quoted,value)=>{filters[key]=quoted??value;return '';}).trim();
 return {text, ...filters, terms:[...new Intl.Segmenter('zh',{granularity:'word'}).segment(text.toLowerCase())].filter(x=>x.isWordLike).map(x=>x.segment)};
}
export function globalSearch(s,r,{query='',type='all',projectId='',time='all',saved='all',sort='relevance',offset=0,limit=50}={}) {
 assert(typeof query==='string'&&query.length<=2000,'查询最多 2000 字符');
 const started=performance.now(), parsed=parseSearch(query), resources=r.all(), byId=new Map(resources.map(x=>[x.id,x]));
 const projects=resources.filter(x=>x.kind==='project');
 const scopes=new Map(projects.map(p=>{const ids=new Set(r.all({projectId:p.id}).map(x=>x.id));for(const c of r.all({kind:'collection',projectId:p.id}))for(const m of r.collectionMembers(c.id,{recursive:true}))ids.add(m.id);return [p.id,ids];}));
 const collections=new Map(); for(const c of resources.filter(x=>x.kind==='collection'))for(const m of r.collectionMembers(c.id,{recursive:true})){const list=collections.get(m.id)??[];list.push({id:c.id,title:c.title});collections.set(m.id,list);}
 let candidates=[];
 for(const x of resources){if(!['object','collection','project','task','view'].includes(x.kind))continue;
 const category=x.category?.split('/').at(-1);
 const group=x.kind==='object'?(category==='decision'?'decision':category==='milestone'?'project':'knowledge'):['task','project'].includes(x.kind)?'project':x.kind;
 const summary=x.summary&&!x.summary.stale?x.summary.abstract:'';
 const chunks=s.all('SELECT anchor,content,level FROM chunks WHERE resource_id=? AND revision=?',x.id,x.revision);
 const fallback=[x.content,x.description,x.goal,x.kind==='view'?(x.blocks??[]).flatMap(b=>[b.title,b.props?.title,b.props?.text,b.props?.caption,...(b.props?.columns??[]).map(c=>c.label),typeof b.data==='string'?b.data:'']).filter(Boolean).join('\n'):''].filter(Boolean).join('\n');
 const segments=chunks.length?chunks:[{content:fallback,anchor:null,level:2}];
 const ranked=segments.map(c=>({...c,matches:parsed.terms.filter(t=>(x.title+' '+c.content).toLowerCase().includes(t)).length})).sort((a,b)=>b.matches-a.matches);
 const hit=ranked[0], text=[x.title,fallback,summary,...chunks.map(c=>c.content)].join('\n');
 const projectIds=projects.filter(p=>scopes.get(p.id).has(x.id)||x.projectId===p.id).map(p=>p.id);
 candidates.push({id:x.id,resourceId:x.id,kind:x.kind,type:group,category,title:x.title,text,snippet:hit?.content??'',anchor:hit?.anchor,level:hit?.level,summary,summaryStale:!!x.summary?.stale,uri:uri(x.kind,x.id,{rev:x.revision,anchor:x.kind==='object'&&hit?.level===2?hit.anchor:undefined}),updatedAt:x.updatedAt,projectIds,collections:collections.get(x.id)??[],source:x.source??null});
 }
 // Only committed user/assistant messages; never stream deltas or unpaired tool projections.
 for(const e of s.all("SELECT e.*,ss.project_id,ss.bot_id FROM session_events e JOIN sessions ss ON ss.id=e.session_id JOIN resources p ON p.id=ss.project_id WHERE p.status='active' AND e.type IN ('user/message','assistant/message')")){
 const d=JSON.parse(e.data);if(e.type==='user/message'&&!(['user','user-correction'].includes(d.source?.kind)||d.source?.role==='request'))continue;d.content=e.type==='assistant/message'?d.message?.content:d.content;if(typeof d.content!=='string'||!d.content.trim())continue;
 candidates.push({id:'event:'+e.seq,kind:'activity',type:'activity',title:e.type==='user/message'?'你':byId.get(e.bot_id)?.title??'成员',text:d.content,snippet:d.content,uri:uri('project',e.project_id),projectIds:[e.project_id],collections:[],updatedAt:e.created_at,eventSeq:e.seq});
 }
 let cutoff=0;if(time==='week'||time==='month'){const d=new Date();d.setHours(0,0,0,0);if(time==='week')d.setDate(d.getDate()-(d.getDay()+6)%7);else d.setDate(1);cutoff=d.getTime();}
 candidates=candidates.filter(x=>(!projectId||x.projectIds.includes(projectId))&&(!parsed.project||x.projectIds.some(id=>byId.get(id)?.title.toLowerCase().includes(parsed.project.toLowerCase())))&&(!cutoff||Date.parse(x.updatedAt)>=cutoff)&&(saved==='all'||(saved==='yes'?x.collections.length>0:x.collections.length===0)));
 for(const x of candidates){const lower=x.text.toLowerCase();x.matches=parsed.terms.filter(t=>lower.includes(t)).length;x.score=x.matches+(parsed.text&&x.title.toLowerCase().includes(parsed.text.toLowerCase())?10:0);const pos=parsed.terms.map(t=>x.snippet.toLowerCase().indexOf(t)).filter(n=>n>=0).sort((a,b)=>a-b)[0]??0;x.snippet=x.snippet.slice(Math.max(0,pos-70),Math.max(0,pos-70)+700);delete x.text;}
 const matches=candidates.filter(x=>!parsed.terms.length||x.matches===parsed.terms.length);
 const counts=Object.fromEntries(['all','knowledge','collection','project','activity','view','decision'].map(k=>[k,k==='all'?matches.length:matches.filter(x=>x.type===k).length]));
 const wanted=types[parsed.type]??parsed.type??type;
 const filtered=matches.filter(x=>wanted==='all'||x.type===wanted||x.category===wanted).sort((a,b)=>sort==='updated'?b.updatedAt.localeCompare(a.updatedAt):b.score-a.score||(a.type==='activity')-(b.type==='activity')||b.updatedAt.localeCompare(a.updatedAt));
 offset=Math.max(0,Number(offset)||0);limit=Math.max(1,Math.min(100,Number(limit)||50));
 const clean=x=>({...x,projects:x.projectIds.map(id=>({id,title:byId.get(id)?.title??id}))});
 return {query:parsed.text,terms:parsed.terms,counts,total:filtered.length,results:filtered.slice(offset,offset+limit).map(clean),related:filtered.length?[]:candidates.filter(x=>x.matches>0&&x.matches<parsed.terms.length&&(wanted==='all'||x.type===wanted||x.category===wanted)).sort((a,b)=>b.score-a.score).slice(0,3).map(clean),elapsedMs:Math.round(performance.now()-started),mode:'local-text',offset};
}
