import {esc,md} from '../api.mjs';
import {blockCatalog} from '/shared/blocks.mjs';
export {blockCatalog};
const text=x=>typeof x==='string'?x:x?.text??x?.content??x?.description??'';
const label=x=>x?.label??x?.title??x?.name??'';
const pick=(i,html)=>`<button class="builtin-row" data-select-row="${i}">${html}</button>`;
export function catalogBlock(block){
 const p=block.props??{},value=block.resolvedData??block.data??[],rows=Array.isArray(value)?value:[value],type=block.type;
 if(!blockCatalog.some(x=>x.type===type))return null;
 if(!rows.length&&!Object.keys(p).length)return '<div class="empty">绑定知识或填写组件数据</div>';
 if(type==='tldr')return `<div class="builtin-tldr markdown">${md(p.text??rows.map(x=>x.summary?.abstract??text(x)).join('\n\n'))}</div>`;
 if(type==='kpi')return `<div class="builtin-kpis">${rows.map((x,i)=>pick(i,`<small>${esc(label(x))}</small><strong>${esc(x.value??'—')}</strong><small>${esc(x.caption??'')}</small>`)).join('')}</div>`;
 if(['compare','matrix','heatmap'].includes(type)){
  const columns=p.columns??[{key:'title',label:'名称'},{key:'content',label:'内容'}];const numeric=rows.flatMap(x=>columns.map(c=>Number(x[c.key]))).filter(Number.isFinite),max=Math.max(1,...numeric.map(Math.abs));
  return `<div class="table-scroll"><table class="builtin-${type}"><thead><tr>${columns.map(c=>`<th>${esc(c.label??c.key)}</th>`).join('')}</tr></thead><tbody>${rows.map((x,i)=>`<tr data-select-row="${i}" tabindex="0">${columns.map(c=>`<td ${type==='heatmap'&&typeof x[c.key]==='number'?`style="background:rgba(105,173,148,${Math.min(.7,Math.abs(x[c.key])/max*.7)})"`:''}>${esc(x[c.key]??'—')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
 }
 if(['quote','claim','agree'].includes(type))return `<div class="builtin-${type}">${rows.map((x,i)=>pick(i,`<blockquote>${esc(text(x))}</blockquote><small>${esc(x.author??label(x))}</small>${x.uri?`<span class="mono muted">${esc(x.uri)}</span>`:''}`)).join('')}</div>`;
 if(type==='proscons')return `<div class="grid2">${[['pros','有利因素'],['cons','不利因素']].map(([k,title])=>`<section><h4>${title}</h4>${rows.map((x,i)=>pick(i,`<strong>${esc(label(x))}</strong><p>${esc(Array.isArray(x[k])?x[k].join('；'):x[k]??'未记录')}</p>`)).join('')}</section>`).join('')}</div>`;
 if(['rank','funnel','ladder'].includes(type)) {const max=Math.max(1,...rows.map(x=>Math.abs(Number(x.value)||0)));return `<div class="builtin-${type}">${rows.map((x,i)=>pick(i,`<span class="mono">${i+1}</span><strong>${esc(label(x))}</strong><span>${esc(x.value??text(x))}</span>${typeof x.value==='number'?`<i class="builtin-bar" style="width:${Math.abs(x.value)/max*100}%"></i>`:''}`)).join('')}</div>`;}
 if(type==='diff')return rows.map((x,i)=>pick(i,`<strong>${esc(label(x))}</strong><div class="grid2"><pre>${esc(x.before??'')}</pre><pre>${esc(x.after??'')}</pre></div>`)).join('');
 if(type==='terms')return `<dl>${rows.map((x,i)=>`<div data-select-row="${i}" tabindex="0"><dt>${esc(x.term??label(x))}</dt><dd>${esc(x.definition??text(x))}</dd></div>`).join('')}</dl>`;
 if(type==='graph') {const edges=rows.map((x,i)=>({source:String(x.sourceResource?.title??x.source??label(x)),target:String(x.targetResource?.title??x.target??''),i})).filter(e=>e.source&&e.target),names=[...new Set(edges.flatMap(e=>[e.source,e.target]))],positions=new Map(names.map((n,i)=>[n,{x:90+(i%3)*180,y:35+Math.floor(i/3)*90}]));return `<svg class="builtin-network" viewBox="0 0 540 ${Math.max(100,Math.ceil(names.length/3)*90)}" role="img" aria-label="知识关系图">${edges.map(e=>{const a=positions.get(e.source),b=positions.get(e.target);return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="currentColor" opacity=".35"/>`;}).join('')}${names.map(n=>{const a=positions.get(n),i=edges.find(e=>e.source===n||e.target===n)?.i??0;return `<g data-select-row="${i}" tabindex="0" role="button"><rect x="${a.x-72}" y="${a.y-20}" width="144" height="40" rx="8" fill="var(--surface2)" stroke="var(--line)"/><text x="${a.x}" y="${a.y+4}" text-anchor="middle" fill="currentColor" font-size="11">${esc(n.length>12?n.slice(0,12)+'…':n)}</text><title>${esc(n)}</title></g>`;}).join('')}</svg>`;}

 return null; // timeline keeps the existing renderer
}
export {libraryHTML as catalogHTML} from './library.mjs';
