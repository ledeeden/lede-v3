import { api, esc, toast, statusText } from './api.mjs';
import { aggregateUsage } from '/shared/usage.mjs';

const state = { range:'today', projectId:'', botId:'', model:'', purpose:'', dimension:'project', incomplete:false, limit:50, detail:null, balance:null, prices:null, estimate:false };
const purposes = { execution:'执行', memory:'记忆整理', compression:'上下文压缩', summary:'知识摘要', embedding:'向量索引', 'connection-test':'连接测试', other:'其他调用' };
const num = v => v === null || v === undefined ? '未知' : v.toLocaleString('en-US');
const short = v => v === null ? '未知' : v >= 1e6 ? (v/1e6).toFixed(2)+'M' : v >= 1e4 ? (v/1e3).toFixed(1)+'k' : num(v);
const rate = v => v === null ? '—' : (100*v).toFixed(1)+'%';
const time = v => new Date(v).toLocaleTimeString('zh-CN',{hour12:false});
const icon = name => `<img class="usage-icon" src="/public/assets/usage-${name}.svg" alt="">`;
const action = (name,label,value='',extra='') => `<button type="button" data-usage="${name}" data-value="${esc(value)}" ${extra}>${label}</button>`;
const meter = (s,width=100) => `<span class="usage-meter" style="width:${width}%">${[['hit','hit'],['miss','miss'],['unclassified','unclassified'],['output','output']].map(([key,cls])=>`<i class="${cls}" style="width:${s.total ? 100*s[key]/s.total : 0}%"></i>`).join('')}</span>`;
const quality = x => `<span class="usage-badge ${x.completeness}"><i></i>${{complete:'用量完整',partial:'缓存拆分缺失',unknown:'用量未知'}[x.completeness]}</span>`;
const runStatus = x => statusText[x.runState ?? x.state] ?? ({historical:'历史记录'}[x.state] ?? x.state);
const dateValue = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
let current, available, paint, root;

function bounds() {
    const end=new Date();end.setHours(24,0,0,0);
    const start=new Date(end);start.setDate(start.getDate()-(state.range==='7'?7:state.range==='30'?30:1));
    if(state.range==='custom' && state.start && state.end) {
        const a=new Date(state.start+'T00:00:00'),b=new Date(state.end+'T00:00:00');b.setDate(b.getDate()+1);
        return {start:a.toISOString(),end:b.toISOString()};
    }
    return {start:start.toISOString(),end:end.toISOString()};
}
function selectFilter(key,label,entries) {
    return `<select aria-label="${label}" data-usage-filter="${key}"><option value="">全部${label}</option>${entries.map(([id,title])=>`<option value="${esc(id)}" ${state[key]===id?'selected':''}>${esc(title)}</option>`).join('')}</select>`;
}
function estimate(rows) {
    if(!state.estimate || !state.prices) return '';
    let amount=0,missing=0;
    for(const row of rows) {
        const p=state.prices[row.model];
        if(!p || row.hit===null || row.miss===null || row.output===null || row.kind==='embedding') { missing++;continue; }
        amount+=(row.hit*p.hit+row.miss*p.miss+row.output*p.output)/1e6;
    }
    return `<div class="usage-cost">估算 ¥ ${amount.toFixed(4)}${missing ? ` · ${missing} 次未计价` : ''}</div><small>自定义价格 · ${esc(state.priceDate)} ${action('prices','调整价格')}</small>`;
}
function rowsKnown(key) { return !current.rows.length || current.rows.some(x=>x[key]!==null); }
function summary() {
    const t=current.totals, partial=t.unknown>0||t.partial>0;
    const value=key => t.calls && !current.rows.some(x=>x[key]!==null) ? null : t[key];
    return `<div class="usage-metrics">
        <section class="card"><label>${partial?'已记录 Token':'总 Token'}</label><div class="usage-number">${short(value('total'))}<small>${num(value('total'))}</small></div><small>${t.calls} 次调用${t.unknown?` · ${t.unknown} 次未知`:''}</small>${estimate(current.rows)}</section>
        <section class="card"><label>${partial?'已记录输入':'输入 Token'}</label><div class="usage-number">${short(value('input'))}<small>${num(value('input'))}</small></div>${meter({...t,total:t.input,output:0})}<small>命中 ${rowsKnown('hit')?short(t.hit):'未知'}　未命中 ${rowsKnown('miss')?short(t.miss):'未知'}${t.unclassified?` · 未分类 ${short(t.unclassified)}`:''}</small></section>
        <section class="card"><label>${partial?'已记录输出':'输出 Token'}</label><div class="usage-number">${short(value('output'))}<small>${num(value('output'))}</small></div><small>${t.reasoning!==null?`含推理 ${short(t.reasoning)}，不另计`:'推理细分未提供'}</small></section>
        <section class="card"><label>输入缓存命中率</label><div class="usage-number">${rate(t.rate)}</div><small>${t.unknown||t.partial?'部分数据缺失，无法计算完整命中率':t.input?'命中合计 ÷ 输入合计':'还没有输入'}</small></section>
    </div>`;
}
function chart() {
    const b=bounds(),start=new Date(b.start),end=new Date(b.end),days=Math.round((end-start)/86400000),hourly=days===1;
    const n=hourly?24:Math.min(days,366),buckets=Array.from({length:n},(_,i)=>({label:hourly?String(i).padStart(2,'0'):new Date(+start+i*86400000).toLocaleDateString('zh-CN',{month:'2-digit',day:'2-digit'}),rows:[]}));
    for(const x of current.rows) {const d=new Date(x.createdAt),i=hourly?d.getHours():Math.floor((d-start)/86400000);buckets[i]?.rows.push(x);}
    const stats=buckets.map(x=>aggregateUsage(x.rows)),max=Math.max(1,...stats.map(x=>x.total));
    return `<section class="card usage-trend"><div class="usage-section-head"><span>用量趋势 <small>${hourly?'按小时':'按天'}</small></span><div class="usage-legend">${[['hit','输入 · 缓存命中'],['miss','输入 · 未命中'],['output','输出'],...(current.totals.unclassified?[['unclassified','输入未分类']]:[])].map(([cls,label])=>`<span><i class="${cls}"></i>${label}</span>`).join('')}</div></div>
    <div class="usage-chart" aria-label="Token 用量趋势">${buckets.map((b,i)=>{const s=stats[i],label=`${b.label} · ${s.calls} 次调用\n缓存命中 ${num(s.hit)}\n未命中 ${num(s.miss)}\n输出 ${num(s.output)}\n总量 ${num(s.total)}${s.unknown?'\n'+s.unknown+' 次未知':''}`;return `<div class="usage-column" tabindex="0" aria-label="${esc(label)}"><div class="usage-column-stack" style="height:${100*s.total/max}%">${['output','unclassified','miss','hit'].map(k=>`<i class="${k}" style="height:${s.total?100*s[k]/s.total:0}%"></i>`).join('')}</div><span class="usage-tooltip">${esc(label)}</span><small>${i===0||i===n-1||i%Math.max(1,Math.floor(n/4))===0?b.label:''}</small>${s.unknown?`<em>+${s.unknown} 未知</em>`:''}</div>`;}).join('')}</div></section>`;
}
function distribution() {
    const dim=state.dimension, groups=new Map();
    for(const x of current.rows) {
        const id=dim==='project'?x.projectId:dim==='bot'?`${x.projectId}\u0000${x.botId??''}`:dim==='model'?x.model:x.purpose;
        if(!groups.has(id)) groups.set(id,{id,rows:[],label:dim==='project'?x.projectTitle:dim==='bot'?x.botTitle:dim==='model'?x.model:purposes[x.purpose]??x.purpose,projectId:x.projectId,projectTitle:x.projectTitle,botId:x.botId});
        groups.get(id).rows.push(x);
    }
    const list=[...groups.values()].map(g=>({...g,s:aggregateUsage(g.rows)}));
    list.sort((a,b)=>dim==='bot'?a.projectTitle.localeCompare(b.projectTitle)||a.projectId.localeCompare(b.projectId)||b.s.total-a.s.total:b.s.total-a.s.total);
    const max=Math.max(1,...list.map(x=>x.s.total));let prev=null;
    return `<section class="card usage-distribution"><div class="usage-section-head"><span>${dim==='bot'?'成员消耗':'消耗分布'}</span><div class="usage-segment">${[['project','项目'],['bot','Bot'],['model','模型'],['purpose','调用用途']].map(([k,l])=>action('dimension',l,k,`aria-pressed="${dim===k}"`)).join('')}</div></div><div class="usage-table-scroll"><table><thead><tr><th></th><th>分布</th><th>总量</th><th>输入</th><th>输出</th><th>命中率</th><th>调用</th></tr></thead><tbody>${list.map(g=>{let heading='';if(dim==='bot'&&g.projectId!==prev){prev=g.projectId;heading=`<tr class="usage-group"><th colspan="7">${esc(g.projectTitle)}</th></tr>`;}const val=dim==='bot'?JSON.stringify({projectId:g.projectId,botId:g.botId??''}):g.id;
    return heading+`<tr><td>${action('drill',`${icon(g.projectId==='global'?'spark1':'dot')}<span>${esc(g.label)}</span>`,val)}</td><td>${meter(g.s,100*g.s.total/max)}</td><td>${g.s.recorded?num(g.s.total):'未知'}</td><td>${g.rows.some(x=>x.input!==null)?num(g.s.input):'未知'}</td><td>${g.rows.some(x=>x.output!==null)?num(g.s.output):'未知'}</td><td>${rate(g.s.rate)}</td><td>${g.s.calls}</td></tr>`;}).join('')}</tbody></table></div><small>点击一行查看对应调用</small></section>`;
}
function calls() {
    const rows=current.rows.filter(x=>!state.incomplete||x.completeness!=='complete');
    return `<section class="card usage-calls"><div class="usage-section-head"><span>${state.incomplete?'不完整的调用':'调用明细'} <small>最新在前</small></span>${state.incomplete?action('incomplete','显示全部'):''}</div><div class="usage-table-scroll"><table><thead><tr><th>时间</th><th>项目 / Bot</th><th class="usage-wide">模型</th><th class="usage-wide">用途</th><th class="usage-wide">输入</th><th class="usage-wide">缓存命中</th><th class="usage-wide">输出</th><th>总量</th><th>状态</th><th></th></tr></thead><tbody>${rows.slice(0,state.limit).map(x=>`<tr class="${state.detail===x.id?'selected':''}"><td><button data-usage="detail" data-value="${esc(x.id)}">${time(x.createdAt)}</button></td><td>${esc(x.projectTitle)}${x.projectId==='global'?'':' · '+esc(x.botTitle)}</td><td class="usage-wide mono">${esc(x.model)}</td><td class="usage-wide">${esc(purposes[x.purpose]??x.purpose)}</td><td class="usage-wide">${num(x.input)}</td><td class="usage-wide">${num(x.hit)}</td><td class="usage-wide">${num(x.output)}</td><td>${num(x.total)}</td><td><span class="usage-badge">${esc(runStatus(x))}</span> ${quality(x)}</td><td>${action('detail',icon('chev1'),x.id,'aria-label="查看调用详情"')}</td></tr>`).join('')}</tbody></table></div>${!rows.length?'<div class="empty">没有符合筛选条件的调用</div>':''}${rows.length>state.limit?action('more',`加载更多（${state.limit} / ${rows.length}）`):''}</section>`;
}
function requestLogHTML(d) {
    const log=d.log;if(!log)return '';
    const analysis=log.analysis, response=log.response;
    const block=(label,value,extra='')=>`<details class="usage-log-block" ${extra}><summary>${esc(label)}</summary><pre>${esc(typeof value==='string'?value:JSON.stringify(value,null,2))}</pre></details>`;
    return `<section class="usage-request-log"><div class="usage-section-head"><span>单次请求日志</span>${action('copy-log',icon('copy')+'复制日志')}</div>
        <div class="usage-value"><span>${log.durationMs!==null?'耗时 '+(log.durationMs/1000).toFixed(2)+' 秒':'历史耗时未记录'}</span><small>本机保存 · 已过滤配置密钥</small></div>
        ${analysis?`<section class="card"><div class="usage-section-head"><span>输入构成</span><small>${num(analysis.bodyChars)} JSON 字符</small></div>${analysis.sections.map(x=>`<div class="usage-value"><span>${esc(x.name)}</span><span class="mono">${num(x.chars)} 字符</span></div><div class="usage-size-track"><i style="width:${100*x.chars/Math.max(1,analysis.contentChars)}%"></i></div>`).join('')}<small>按存储快照的 JSON 字符计量，不是分段 Token；服务商仅返回请求级 Token 总量。</small></section>
        <details class="usage-log-block" open><summary>输入消息 · ${analysis.messages.length} 条</summary><input class="usage-log-search" type="search" aria-label="搜索请求消息" placeholder="搜索这次请求的消息…">${analysis.messages.map(m=>`<details class="usage-message-log"><summary><span>${m.index+1}. ${esc(m.category)} · ${esc(m.role)}</span><small>${num(m.chars)} 字符</small></summary><pre>${esc(JSON.stringify(m.message,null,2))}</pre></details>`).join('')}</details>
        ${log.request.tools?.length?block('工具定义 · '+log.request.tools.length+' 个',log.request.tools):''}
        ${log.request.input!==undefined?block('向量输入',log.request.input):''}
        ${block('请求参数',Object.fromEntries(Object.entries(log.request).filter(([k])=>!['messages','tools','input'].includes(k))))}
        ${block('完整请求 JSON（已过滤配置密钥）',log.request)}
        <details class="usage-log-block" open><summary>可检查的优化方向</summary><ul>${analysis.findings.map(x=>`<li>${esc(x)}</li>`).join('')}</ul><small>只提供基于本次日志的检查建议，不自动删减上下文或修改执行策略。</small></details>`:'<p class="usage-log-missing">这次调用没有保存原始请求，无法还原当时的系统指令、工具定义与完整上下文。新调用会自动记录。</p>'}
        ${response?block(response.source==='historical-event'?'已保存的历史输出（非原始响应）':response.complete?'模型响应':'已收到的响应片段（未完成）',response):'<p class="usage-log-missing">未保存模型响应；失败原因见调用状态。</p>'}
        ${d.tools.length?`<details class="usage-log-block" open><summary>本次输出触发的工具 · ${d.tools.length} 个</summary>${d.tools.map(t=>block(t.name+' · '+(statusText[t.state]??t.state),{arguments:t.args,result:t.result})).join('')}<small>这些结果在模型响应之后产生，尚未计入本次输入；如被继续发送，会计入后续请求。</small></details>`:''}
    </section>`;
}
function detailHTML(d) {
    const x=d.row,s=aggregateUsage([x]);
    return `<aside class="usage-detail" aria-label="调用详情"><div class="usage-section-head"><span>调用 <small>${time(x.createdAt)}</small></span>${action('close',icon('x'),'','aria-label="关闭调用详情"')}</div><dl><dt>归属</dt><dd>${esc(x.projectTitle)} · ${esc(x.botTitle)}</dd><dt>模型</dt><dd class="mono">${esc(x.model)}</dd><dt>用途</dt><dd>${esc(purposes[x.purpose]??x.purpose)}</dd><dt>状态</dt><dd>${esc(runStatus(x))} ${quality(x)}</dd><dt>请求</dt><dd class="mono">${esc(x.requestId)} · 第 ${x.attempt} 次尝试</dd></dl>${x.error||x.runError?`<p class="usage-warning">${esc(x.error??x.runError)}</p>`:''}<section class="card"><label>Token</label>${meter(s)}${[['input','输入'],['hit','输入 · 缓存命中'],['miss','输入 · 未命中'],['output','输出'],['reasoning','其中推理，不另计'],['total','总量']].map(([k,l])=>`<div class="usage-value"><span>${l}</span><span class="mono">${num(x[k])}</span></div>`).join('')}</section>${requestLogHTML(d)}<div class="usage-raw"><div class="usage-section-head"><small>服务商返回</small>${action('copy',icon('copy'),'','aria-label="复制用量数据"')}</div><pre>${esc(JSON.stringify(x.raw,null,2)??'未收到用量')}</pre><small>缓存命中包含在输入中，不重复计入</small></div><section><div class="usage-section-head"><span>${icon('retry')} 同一请求的尝试</span></div>${d.attempts.map(a=>`<div class="usage-value">${action('detail',`${time(a.createdAt)}　第 ${a.attempt} 次 · ${a.id===x.id?'本次':esc(runStatus(a))}`,a.id)}<span class="mono">${num(a.total)}</span></div>`).join('')}<small>重试是新的实际调用，分别计量</small></section>${x.runId?`<section class="card"><div class="usage-section-head"><span>${icon('chart')} 执行记录</span><small>Turn ${x.turn??'—'} · Step ${x.step??'—'}</small></div>${d.tools.map(t=>`<div class="usage-value"><small>${time(t.started_at)}</small><span>${esc(t.name)} · ${esc(statusText[t.state]??t.state)}</span></div>`).join('')}<button data-action="run" data-id="${esc(x.runId)}">查看执行记录 ${icon('arrow')}</button></section>`:'<small>这次调用没有关联执行记录</small>'}${x.historical?'<small>历史记录回填；模型与尝试边界可能未保存</small>':''}</aside>`;
}

export async function usageHTML(resources=[]) {
    const params=new URLSearchParams(location.hash.split('?')[1]??'');
    const routeProject=params.get('projectId')??'';
    if(state.routeProject!==routeProject) {state.projectId=routeProject;state.botId='';state.dimension=routeProject?'bot':'project';state.routeProject=routeProject;state.detail=null;}
    const allData=await api.call('usage?'+new URLSearchParams(bounds()));available=allData.rows;
    const rows=available.filter(x=>(!state.projectId||x.projectId===state.projectId)&&(!state.botId||x.botId===state.botId)&&(!state.model||x.model===state.model)&&(!state.purpose||x.purpose===state.purpose));
    current={...allData,rows,totals:aggregateUsage(rows)};
    const projects=[...new Map([...resources.filter(x=>x.kind==='project').map(x=>[x.id,x.title]),['global','总助'],...available.map(x=>[x.projectId,x.projectTitle])])],bots=[...new Map(available.filter(x=>!state.projectId||x.projectId===state.projectId).filter(x=>x.botId).map(x=>[x.botId,x.botTitle]))],models=[...new Set(available.map(x=>x.model))].map(x=>[x,x]);
    const partial=current.totals.unknown+current.totals.partial;
    let detail='';if(state.detail) {state.detailData=await api.call('usage/detail?id='+encodeURIComponent(state.detail));detail=detailHTML(state.detailData);}
    return `<main class="main usage-page ${state.detail?'has-detail':''}"><div class="usage-header"><div class="row">${action('menu',icon('menu'),'','class="usage-mobile-menu" aria-label="切换导航"')}<a href="#settings">设置</a>${icon('chev')}<span>用量</span></div><div class="usage-balance"><span>账户余额</span><strong>${state.balance?state.balance.balances.map(x=>esc(x.currency)+' '+esc(x.total)).join(' / '):'—'}</strong><small>${state.balance?time(state.balance.checkedAt):'未查询'}</small>${action('balance',icon('refresh'),'','aria-label="刷新账户余额"')}</div></div>
        <div class="usage-filters"><div class="usage-segment">${[['today','今天'],['7','近 7 天'],['30','近 30 天'],['custom','自定义']].map(([k,l])=>action('range',(k==='custom'?icon('cal'):'')+l,k,`aria-pressed="${state.range===k}"`)).join('')}</div>${selectFilter('projectId','项目',projects)}${selectFilter('botId','Bot',bots)}${selectFilter('model','模型',models)}<label class="usage-estimate"><input type="checkbox" data-usage-estimate ${state.estimate?'checked':''}>估算费用</label></div>
        ${state.range==='custom'?`<form class="usage-dates"><label>开始 <input type="date" name="start" value="${state.start??dateValue(new Date())}" required></label><label>结束 <input type="date" name="end" value="${state.end??dateValue(new Date())}" required></label><button>应用</button></form>`:''}
        ${state.projectId||state.botId||state.model||state.purpose?`<div class="usage-filter-summary">${action('reset',icon('back')+'回到全部')}<span>${esc([projects.find(x=>x[0]===state.projectId)?.[1],bots.find(x=>x[0]===state.botId)?.[1],state.model,purposes[state.purpose]].filter(Boolean).join(' / '))}</span></div>`:''}
        ${partial?`<div class="usage-warning">${icon('warn')}<span>${partial} 次调用用量不完整：${current.totals.unknown} 次未知，${current.totals.partial} 次缓存拆分缺失。未知部分不计为 0。</span>${action('incomplete',state.incomplete?'显示全部':'只看不完整')}</div>`:''}
        ${state.detail?'':summary()}
        ${rows.length?`${state.detail?'':chart()+distribution()}${calls()}`:`<section class="card usage-empty">${icon('chart')}<strong>还没有调用记录</strong><p>项目里的成员或总助开始工作后，这里记录每一次用量</p><small>未保存的历史用量不在这里，也不会显示为 0</small></section>`}
        <small class="usage-history">完整采集自 ${new Date(current.startedAt).toLocaleString('zh-CN')} 开始；更早记录仅回填已保存的响应，不代表全部历史用量。</small>
        ${detail}
    </main>`;
}

function priceForm() {
    const models=[...new Set(available.map(x=>x.model))].filter(x=>x!=='历史模型未知');
    const dialog=document.createElement('dialog');dialog.className='usage-price-dialog';
    dialog.innerHTML=`<form><h3>估算单价</h3><p>人民币 / 百万 Token · 使用你实际适用的价格</p>${models.map((m,i)=>`<fieldset><legend>${esc(m)}</legend>${[['hit','缓存命中'],['miss','未命中'],['output','输出']].map(([k,l])=>`<label>${l}<input type="number" step="any" min="0" name="${i}-${k}" value="${state.prices?.[m]?.[k]??''}" required></label>`).join('')}</fieldset>`).join('')}<div class="row"><button type="button" data-cancel>取消</button><button type="submit" ${models.length?'':'disabled'}>应用估算</button></div></form>`;
    document.body.append(dialog);dialog.showModal();dialog.querySelector('[data-cancel]').onclick=()=>dialog.close();dialog.onclose=()=>{dialog.remove();paint();};
    dialog.querySelector('form').onsubmit=e=>{e.preventDefault();const f=new FormData(e.target);state.prices=Object.fromEntries(models.map((m,i)=>[m,Object.fromEntries(['hit','miss','output'].map(k=>[k,Number(f.get(`${i}-${k}`))]))]));state.priceDate=dateValue(new Date());state.estimate=true;dialog.close();};
}
export function wireUsage(rerender) {
    root=document.querySelector('.usage-page');paint=rerender;if(!root)return;
    root.onclick=async e=>{const el=e.target.closest('[data-usage]');if(!el)return;e.preventDefault();const {usage:a,value:v}=el.dataset;try {
        if(a==='menu'){document.querySelector('.usage-shell')?.classList.toggle('mobile-nav');return;}
        if(a==='range'){state.range=v;state.limit=50;}
        if(a==='dimension') state.dimension=v;
        if(a==='incomplete') state.incomplete=!state.incomplete;
        if(a==='more')state.limit+=50;
        if(a==='detail')state.detail=v;
        if(a==='close')state.detail=null;
        if(a==='reset'){Object.assign(state,{projectId:'',botId:'',model:'',purpose:'',dimension:'project',detail:null});if(location.hash.includes('?'))location.hash='#usage';}
        if(a==='drill'){if(state.dimension==='bot')Object.assign(state,JSON.parse(v));else{state[state.dimension==='project'?'projectId':state.dimension]=v;if(state.dimension==='project')state.dimension='bot';}state.limit=50;}
        if(a==='balance'){el.disabled=true;state.balance=await api.call('usage/balance');}
        if(a==='prices')return priceForm();
        if(a==='copy-log'){await navigator.clipboard.writeText(JSON.stringify({call:state.detailData.row,log:state.detailData.log,tools:state.detailData.tools},null,2));toast('已复制单次请求日志');return;}
        if(a==='copy'){await navigator.clipboard.writeText(JSON.stringify(state.detailData.row.raw,null,2));toast('已复制用量数据');return;}
        await paint();
    }catch(error){el.disabled=false;toast(error.message,true);}};
    const search=root.querySelector('.usage-log-search');if(search) search.oninput=()=>{const q=search.value.toLowerCase();root.querySelectorAll('.usage-message-log').forEach(el=>{el.hidden=!el.textContent.toLowerCase().includes(q);});};
    root.querySelectorAll('[data-usage-filter]').forEach(el=>el.onchange=()=>{state[el.dataset.usageFilter]=el.value;state.limit=50;state.detail=null;if(el.dataset.usageFilter==='projectId'){state.botId='';state.dimension=el.value?'bot':'project';}paint();});
    root.querySelector('[data-usage-estimate]').onchange=e=>{if(e.target.checked&&!state.prices)return priceForm();state.estimate=e.target.checked;paint();};
    const form=root.querySelector('.usage-dates');if(form)form.onsubmit=e=>{e.preventDefault();const f=new FormData(form);if(f.get('start')>f.get('end'))return toast('结束日期不能早于开始日期',true);if((new Date(f.get('end'))-new Date(f.get('start')))/86400000>365)return toast('单次最多查看一年',true);state.start=f.get('start');state.end=f.get('end');paint();};
}
