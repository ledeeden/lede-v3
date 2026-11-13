import {esc} from '../api.mjs';
// Explicitly labelled illustration data; never persisted as knowledge or usage.
const definitions=[
 ['tldr','一句话结论','概览','把长内容压成一句结论与要点','长内容、研究报告','109-10762','Spark'],
 ['kpi','关键数字','数据','集中呈现指标与说明','指标、周报','109-10807','Chart'],
 ['compare','对比表','比较','同一组维度横向比较','多个同类对象','109-10854','Table'],
 ['claim','观点与引用','引用','观点旁保留引用，随时回到来源','带有引用的内容','109-10934','Scale'],
 ['quote','原文摘录','引用','关键原话与来源锚点','需要保留原话的内容','109-10990','Quote'],
 ['agree','来源汇集','引用','并列查看不同来源中的内容','多来源资料','109-11025','Agree'],
 ['ladder','递进列表','概览','按顺序展开内容与数值','分层要点、步骤','109-11082','Layers'],
 ['heatmap','热力图','数据','用颜色呈现两个维度交叉的数值','两个分类维度','109-11130','Grid'],
 ['graph','关系图','关系','呈现对象之间的引用关联','有引用关系的对象','109-11238','Graph'],
 ['timeline','时间线','时间','沿时间顺序串联事件','事件、项目进展'],
 ['proscons','利弊','比较','并列整理有利与不利因素','方案取舍'],
 ['matrix','矩阵','比较','在统一维度中整理信息','多维度资料'],
 ['rank','排序','数据','按顺序展示条目与数值','排名、统计'],
 ['funnel','漏斗','数据','逐层展示阶段与数值','流程、转化'],
 ['diff','差异','比较','并排查看变更前后的内容','版本比较'],
 ['terms','术语','概览','集中查看术语及其解释','领域词汇']
];
const asset=(id,name)=>`/public/assets/library/${id}-img${name}.svg`;
const rows=items=>items.map(([a,b])=>`<div class="mini-row"><span>${a}</span><small>${b??''}</small></div>`).join('');
function preview(type){
 if(type==='tldr')return '<strong>建议年付 $59.99 + 7 天试用</strong><p class="mini-muted">定价研究 · 关联 3 份资料</p>'+rows([['竞品年付集中在 $89–$99','3 源'],['试用时长影响产品体验','2 源'],['地区价格需要进一步研究','1 源']]);
 if(type==='kpi')return '<div class="mini-kpis">'+[['试用 → 付费','2.2%','+0.4','Sparkline'],['7 日留存','31%','−3','Sparkline1'],['ARPU','$4.1','+0.3','Sparkline2']].map(([n,v,d,a])=>`<div><small>${n}</small><p>${v}<em>${d}</em></p><img src="${asset('109-10807',a)}" alt=""></div>`).join('')+'</div><p class="mini-muted">对比上周 · 指标示例</p>';
 if(['compare','matrix'].includes(type))return '<table><thead><tr><th>产品</th><th>年付</th><th>试用</th><th>反馈</th></tr></thead><tbody>'+[['产品 A','$99.99','7 天','逐音素'],['产品 B','$89.99','3 天','整句'],['产品 C','$99.00','7 天','整句'],['方案','$59.99','7 天','逐音素']].map(r=>'<tr>'+r.map(c=>`<td>${c}</td>`).join('')+'</tr>').join('')+'</tbody></table>';
 if(type==='claim')return '<strong>试用时长如何影响付费转化</strong><p class="mini-muted">研究过程中的引用</p>'+rows([['学习类订阅报告中的试用数据','report#p4'],['竞品的试用方案','compare'],['第一轮实验观察','ab-01']]);
 if(type==='quote')return '<blockquote>“年付用户中，部分用户是在试用第 5–7 天转付费的，需要结合完整体验周期观察。”</blockquote><p class="mini-muted">— 研究笔记中的原文摘录</p><div class="mini-anchor">lede://app/research#paragraph-5 <span>跳到原文 →</span></div>';
 if(type==='agree')return '<strong>学习类 App 的年付方案</strong><p class="mini-muted">4 份来源 · 引用内容并列呈现</p>'+rows([['行业订阅报告','研究摘要'],['产品发布说明','定价方案'],['试运营记录','用户反馈'],['开发者论坛','讨论摘录']]);
 if(type==='heatmap')return '<p class="mini-muted">各市场 × 用户在意点（提及率）</p><table class="mini-heat"><thead><tr>'+['','发音','价格','口音','课程','离线'].map(x=>`<th>${x}</th>`).join('')+'</tr></thead><tbody>'+['美国','印度','巴西','日本','德国'].map((n,i)=>'<tr><th>'+n+'</th>'+[90,50,30,60,20].map((v,j)=>{const k=(v+i*20+j*10)%90+10;return `<td style="--heat:${k/120}">${k}</td>`;}).join('')+'</tr>').join('')+'</tbody></table>';
 if(type==='graph')return `<div class="mini-network"><img src="${asset('109-11238','Frame')}" alt="">${[["定价方案",52.7,48.3],["竞品定价对比",15.8,17.8],["试用时长",78.3,17],["首批付费用户",81,79],["定价页文案",22,83],["A/B 实验 01",53,90]].map(([label,x,y],i)=>`<span class="mini-node ${i===0?"central":""}" style="left:${x}%;top:${y}%">${label}</span>`).join('')}</div>`;
 if(type==='terms')return rows([['ARPU','每用户平均收入'],['留存率','一段时间后继续使用的比例'],['转化率','完成目标行为的用户比例']]);
 if(type==='diff')return '<div class="mini-columns"><div><small>变更前</small><p>月付方案</p><p>3 天试用</p></div><div><small>变更后</small><p>年付方案</p><p>7 天试用</p></div></div>';
 if(type==='proscons')return '<div class="mini-columns"><div><small>有利因素</small><p>完整体验周期</p><p>更低的年付价格</p></div><div><small>不利因素</small><p>更长的决策周期</p><p>需要持续跟进</p></div></div>';
 return rows((type==='timeline'?[['11.10','收集竞品资料'],['11.11','整理试用方案'],['11.12','形成定价建议']]:[['01','整理已有资料'],['02','比较关键维度'],['03','形成研究要点'],['04','追踪后续变化']]).map(([a,b])=>[`${a}　${b}`,'']));
}
export function libraryHTML(filter='全部',query='',views=[],widgets=[]){
 const categories=['全部','概览','比较','引用','数据','时间','关系'];
 const items=definitions.filter(x=>(filter==='全部'||x[2]===filter)&&(!query||x.slice(0,5).join(' ').toLowerCase().includes(query.trim().toLowerCase())));
 return `<main class="main library"><header class="library-header"><h1>视图插件</h1><span class="library-count">${definitions.length} 个内置组件${widgets.length?` · ${widgets.length} 个代码插件`:''}</span><form id="catalog-search"><input name="query" aria-label="搜索组件" placeholder="找插件，或描述你想怎么看" value="${esc(query)}"><button aria-label="搜索">搜索</button></form><button class="primary library-create" data-action="new-widget">＋ 新建代码插件</button></header><div class="library-tabs" role="group" aria-label="组件分类">${categories.map(c=>`<button data-action="catalog-filter" data-id="${c}" class="${filter===c?'active':''}" aria-pressed="${filter===c}">${c} <span>${c==='全部'?definitions.length:definitions.filter(x=>x[2]===c).length}</span></button>`).join('')}</div><div class="catalog-grid">${items.map(([type,title,category,description,suitable,id,icon])=>`<button type="button" class="catalog-card" data-action="catalog-use" data-id="${type}" aria-label="添加${title}到视图"><div class="catalog-preview" aria-hidden="true"><div class="mini-component"><div class="mini-heading">${id?`<img src="${asset(id,'Icon'+icon)}" alt="">`:''}<span>${title}</span><small>示例预览</small></div>${preview(type)}</div></div><div class="catalog-meta"><strong>${title}</strong><span class="catalog-version">${type}@1</span><span class="catalog-usage">${views.filter(v=>v.blocks?.some(b=>b.type===type)).length} 个视图</span></div><p class="catalog-description">${description}</p><div class="catalog-suitable"><img src="${asset('109-10762','IconSpark1')}" alt="">适合：${suitable}<span class="catalog-add">添加到视图 →</span></div></button>`).join('')}</div>${!items.length?'<div class="empty">没有匹配的组件，试试其他关键词或分类。</div>':''}${widgets.length?`<section class="library-custom"><h2>代码插件</h2>${widgets.map(w=>`<a class="plugin-row" href="#plugins/${encodeURIComponent(w.key)}">${esc(w.manifest.name)} <span class="muted">${esc(w.state)}</span></a>`).join('')}</section>`:''}</main>`;
}
