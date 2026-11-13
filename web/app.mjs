import { usageHTML, wireUsage } from './usage.mjs';
import { api, esc, qs, qsa, toast, date, badge, icon, md, resourceRoute, download, statusText } from './api.mjs';
import { sandbox, clearSandboxes, blockHTML, wireBlocks } from './components/widgets.mjs';
import { parseURI, uri } from '/shared/uri.mjs';
const app = { data: null, route: null, global: false, chatHidden: false, selection: null, drafts: {}, search: '', filter: 'all', team: null, teamBot: null, pluginTab: 'manifest', pluginDirty: false, viewLayout: 'grid', renderSeq: 0, streams: new Map(), lastProject: null };
const all = (kind) => app.data.resources.filter(r => r.kind === kind && r.status === 'active');
const get = id => app.data.resources.find(r => r.id === id);
const btn = (action, label, { id = '', cls = '', extra = '' } = {}) => `<button data-action="${action}" data-id="${esc(id)}" class="${cls}" ${extra}>${label}</button>`;
const botIcon = (bot, large = false) => `<span class="bot-icon${large ? ' large' : ''}">${icon(bot?.role === 'research' ? 'search' : bot?.role === 'maker' ? 'puzzle' : bot?.role === 'analyst' ? 'view' : bot?.role === 'reviewer' ? 'flag' : 'compass', large ? 15 : 11)}</span>`;
const empty = (text, action = '') => `<div class="empty">${text}${action ? '<div>' + action + '</div>' : ''}</div>`;
const cardHead = (name, text, count = '') => `<div class="card-head">${icon(name, 14)}<span>${text}</span>${count !== '' ? `<span class="count">${count}</span>` : ''}</div>`;
const projectHref = id => '#project/' + id + '/overview';
function route() { const parts = location.hash.slice(1).split('?')[0].split('/'); if (parts[0] === 'project')
    return { type: 'project', id: parts[1], tab: parts[2] ?? 'overview' }; if (parts[0] === 'collection')
    return { type: 'collection', id: parts[1] }; if (parts[0] === 'resource')
    return { type: 'resource', uri: decodeURIComponent(parts.slice(1).join('/')) }; if (parts[0] === 'plugins')
    return { type: 'plugins', key: decodeURIComponent(parts.slice(1).join('/')) }; if (parts[0] === 'view')
    return { type: 'view', id: parts[1], projectId: parts[2] }; return { type: ['knowledge', 'collections', 'settings', 'usage'].includes(parts[0]) ? parts[0] : 'home' }; }
function sidebar() { const counts = { object: all('object').length, collection: all('collection').length, widget: app.data.widgets.length }; const nav = [['home', 'home', '首页', ''], ['knowledge', 'search', '知识', counts.object], ['collections', 'stack', '集合', counts.collection], ['plugins', 'puzzle', '视图插件', counts.widget], ['usage', 'usage-chart', '用量', '']]; const projects = all('project').sort((a, b) => a.createdAt.localeCompare(b.createdAt)); return `<aside class="sidebar" aria-label="主导航"><a href="#home" class="brand"><span class="brand-mark">${icon('orbit')}</span><span>Lede</span></a>${nav.map(([type, i, text, c]) => `<a class="nav-link ${app.route.type === type ? 'active' : ''}" href="#${type}" title="${text}">${i === 'usage-chart' ? '<img class="usage-icon" src="/public/assets/usage-chart.svg" alt="">' : icon(i)}<span class="label">${text}</span><span class="count">${c}</span></a>`).join('')}<div class="nav-section">项目</div>${projects.map((p, i) => `<a class="nav-link project-nav ${app.route.id === p.id ? 'active' : ''}" href="${projectHref(p.id)}" title="${esc(p.title)}"><span class="project-dot" style="background:${['#8fceaf', '#9db8ff', '#686c74'][i % 3]}"></span><span class="label">${esc(p.title)}</span><span class="count">${all('task').filter(t => t.projectId === p.id && t.state === 'doing').length || ''}</span></a>`).join('')}<a href="#" class="nav-link" data-action="new-project">${icon('plus', 14)}<span class="label">新项目</span></a><div class="nav-section">固定</div>${app.data.mounts.filter(m => m.pinned && get(m.view_id)).map(m => `<a class="nav-link" href="#view/${m.view_id}/${m.project_id}">${icon('view', 14)}<span class="label">${esc(get(m.view_id).title)}</span></a>`).join('')}${all('collection').slice(0, 1).map(c => `<a class="nav-link" href="#collection/${c.id}">${icon('stack', 14)}<span class="label">${esc(c.title)}</span></a>`).join('')}<div class="sidebar-bottom"><button class="assistant-nav" data-action="global" title="总助 ⌘J"><span class="spark-circle">${icon('spark', 12)}</span><span class="label grow">总助</span><span class="mono muted">⌘J</span></button><div class="user-line"><span class="avatar-letter">R</span><span class="grow">Rambo</span><a class="icon-btn" href="#settings" aria-label="设置">${icon('settings', 15)}</a></div></div></aside>`; }
function homeHTML() { const projects = all('project').sort((a, b) => a.createdAt.localeCompare(b.createdAt)); return `<main class="main home"><div class="page-header"><h1>项目</h1>${btn('new-project', icon('plus', 14) + '新项目', { cls: 'primary' })}</div>${app.data.demo ? '<div class="demo-notice">示例空间 · 指标、资料与任务状态用于展示；不代表 Agent 已完成研究。</div>' : ''}${projects.length ? `<div class="grid3">${projects.map(p => { const tasks = all('task').filter(t => t.projectId === p.id), done = tasks.filter(t => t.state === 'done').length; return `<article class="card project-card"><a href="${projectHref(p.id)}"><div class="row between"><h2>${esc(p.title)}</h2>${badge(p.phase)}</div></a><p class="goal-text">${esc(p.goal)}</p><div class="row lead">${botIcon(get(p.leadBotId))}<span>${esc(get(p.leadBotId)?.title ?? '尚未设置负责人')}</span></div><div><div class="row between small muted"><span>任务进展</span><span class="mono">${done} / ${tasks.length}</span></div><div class="progress"><i style="width:${tasks.length ? done / tasks.length * 100 : 0}%"></i></div></div><div class="foot row"><a class="grow" href="${projectHref(p.id)}">进入项目 →</a><div class="bot-stack">${p.memberBotIds.slice(0, 4).map(id => botIcon(get(id))).join('')}</div></div></article>`; }).join('')}</div>` : empty('把一个目标变成可持续推进的项目。', btn('new-project', '创建第一个项目', { cls: 'primary' }))}<div class="grid2 section-gap" style="margin-top:30px"><section class="card">${cardHead('flag', '等待你的决定')}${all('object').filter(x => x.category === 'decision' && x.decisionState === 'pending').map(x => `<div class="list-line"><a class="grow" href="${resourceRoute(x.uri)}">${esc(x.title)}</a>${btn('accept-decision', '确认', { id: x.id, cls: 'small' })}</div>`).join('') || empty('目前没有待确认的决策')}</section><section class="card">${cardHead('stack', '最近沉淀的集合')}${all('collection').slice(0, 3).map(c => `<div class="list-line"><div class="grow"><a href="#collection/${c.id}">${esc(c.title)}</a><p class="small muted">${esc(c.summary?.abstract ?? c.description)}</p></div></div>`).join('') || empty('把资料、方法与经验放在集合里')}</section></div><button class="home-bottom" data-action="global"><span class="spark-circle">${icon('spark')}</span><span class="grow" style="text-align:left">和总助说，或找一份资料…</span><span class="mono">⌘J</span></button></main>`; }
function projectHeader(p, ctx) { const mounted = ctx.mounts.map(m => get(m.view_id)).filter(Boolean); return `<div class="page-header"><h1>${esc(p.title)}</h1>${badge(p.phase)}<button class="team-trigger row" data-action="team" data-id="${p.id}"><span>执行团队</span><span class="bot-stack">${ctx.members.slice(0, 4).map(b => botIcon(b)).join('')}</span></button><a class="usage-entry" href="#usage?projectId=${p.id}">用量</a>${btn('project-memory', '记忆', { id: p.id, cls: 'small ghost' })}${btn('project-goal', '目标', { id: p.id, cls: 'small ghost' })}${btn('project-handoff', '交接', { id: p.id, cls: 'small ghost' })}${btn('edit-project', '···', { id: p.id, cls: 'ghost', extra: 'aria-label="编辑项目"' })}</div><nav class="tabs" aria-label="项目视图">${[['overview', '总览'], ['materials', '资料'], ['progress', '进展'], ['results', '成果']].map(([tab, label]) => `<a class="tab ${app.route.tab === tab ? 'active' : ''}" href="#project/${p.id}/${tab}">${label}</a>`).join('')}${mounted.map(v => `<a class="tab" href="#view/${v.id}/${p.id}">${esc(v.title)}</a>`).join('')}${btn('new-view', icon('plus', 14), { id: p.id, cls: 'ghost', extra: 'aria-label="创建视图"' })}${app.chatHidden ? btn('toggle-chat', '负责人', { cls: 'small' }) : ''}</nav>`; }
function projectOverview(ctx) { const { project: p, tasks, resources, collections, members } = ctx; const doing = tasks.filter(t => t.state !== 'done' && t.state !== 'canceled'), decisions = resources.filter(r => r.category === 'decision'), results = resources.filter(r => r.kind === 'view' || ['report', 'material'].includes(r.category)); return `<section class="card">${cardHead('target', '当前重点')}<div class="focus-metrics"><div class="goal"><strong>${esc(p.goal || '和负责人一起明确目标')}</strong><span class="small muted">${p.demo ? '示例目标 · 可以编辑或建立真实项目' : '最近更新 ' + date(p.updatedAt)}</span></div>${(p.metrics ?? []).map(m => `<div class="metric"><strong>${esc(m.value)}</strong><span>${esc(m.label)}</span></div>`).join('')}</div></section><div class="grid2 section-gap"><section class="card">${cardHead('clock', '进行中', doing.length)}${doing.slice(0, 6).map(t => `<div><div class="list-line">${botIcon(get(t.assigneeBotId))}<button class="ghost grow" data-action="task" data-id="${t.id}" style="padding:0;text-align:left;justify-content:flex-start;color:var(--text)">${esc(t.title)}</button>${badge(t.state)}</div>${t.progress && t.state === 'doing' ? `<div class="progress"><i style="width:${t.progress}%"></i></div>` : ''}</div>`).join('') || empty('还没有执行任务', btn('new-task', '创建任务', { id: p.id, cls: 'small' }))}</section><section class="card">${cardHead('flag', '关键决策')}${decisions.slice(0, 5).map(d => `<div class="decision ${d.decisionState === 'pending' ? 'pending' : ''}"><a href="${resourceRoute(d.uri)}"><p>${esc(d.title)}</p></a><div class="small muted">${d.decisionState === 'pending' ? '待你确认' : date(d.updatedAt) + ' · 已记录'} ${d.decisionState === 'pending' ? btn('accept-decision', '确认', { id: d.id, cls: 'small ghost' }) : ''}</div></div>`).join('') || empty('关键判断沉淀为知识对象')}</section></div><div class="grid2 section-gap"><section class="card">${cardHead('file', '最近成果')}${results.slice(0, 5).map(d => `<div class="list-line">${icon(d.kind === 'view' ? 'view' : 'file', 13)}<a class="grow" href="${resourceRoute(d.uri)}">${esc(d.title)}</a><span class="mono muted" title="${esc(d.uri)}">${esc(d.id.slice(0, 7))}</span></div>`).join('') || empty('执行结果会回到项目里')}</section><section class="card">${cardHead('stack', '参考集合', collections.length)}${collections.map(c => `<div class="decision"><a href="#collection/${c.id}"><p>${esc(c.title)}</p></a><p class="small muted">${c.summary && !c.summary.stale ? 'L0 · ' : ''}${esc(c.summary && !c.summary.stale ? c.summary.abstract : c.description)}</p></div>`).join('') || empty('关联可复用的资料与方法集合', btn('project-reference', '关联资料', { id: p.id, cls: 'small' }))}</section></div>`; }
function taskBoard(tasks) { return `<div class="kanban">${[['queued', '排队'], ['doing', '进行中'], ['review', '待审查'], ['done', '已完成']].map(([state, title]) => { const group = tasks.filter(t => t.state === state || (state === 'queued' && t.state === 'blocked')); return `<section class="kanban-col" data-column="${state}"><div class="kanban-title"><span>${title}</span><span class="mono">${group.length}</span></div>${group.map(t => `<article class="task-card" draggable="true" data-task-drag="${t.id}" data-action="task" data-id="${t.id}"><p>${esc(t.title)}</p><div class="row between"><span class="small muted">${esc(get(t.assigneeBotId)?.title ?? '未分配')}</span><span class="mono muted">${t.progress ?? 0}%</span></div></article>`).join('') || '<div class="empty small">暂无任务</div>'}</section>`; }).join('')}</div>`; }
function workTree(works, parent = null, seen = new Set()) { return works.filter(w => w.parent_id === parent).map(w => { if (seen.has(w.id))
    return ''; seen.add(w.id); return `<div class="tree-work"><div class="row"><span>${esc(w.sender === '@user' ? '你' : get(w.sender)?.title ?? w.sender)}</span><span class="muted">→</span><span class="grow">${esc(get(w.recipient)?.title ?? w.recipient)}</span>${badge(w.state)}${['open', 'waiting'].includes(w.state) ? btn('abandon-work', '结束等待', { id: w.id, cls: 'small ghost' }) : ''}</div><p class="small muted">${esc(w.request.slice(0, 100))}</p><span class="mono muted">${esc(w.id.slice(0, 18))}</span>${workTree(works, w.id, seen)}</div>`; }).join(''); }
async function projectHTML() { const ctx = await api.call('project?id=' + app.route.id); app.projectContext = ctx; app.lastProject = ctx.project.id; const p = ctx.project; let body = ''; if (app.route.tab === 'overview')
    body = projectOverview(ctx);
else if (app.route.tab === 'materials')
    body = `<div class="row between" style="margin-bottom:16px"><span class="muted">项目关联的资料与集合</span><div class="row">${btn('project-reference', '关联已有资料', { id: p.id })}${btn('new-knowledge', '新建资料', { id: p.id, cls: 'primary' })}</div></div>${knowledgeRows(ctx.resources.filter(x => ['object', 'collection'].includes(x.kind)))}`;
else if (app.route.tab === 'progress') {
    const [works, runs] = await Promise.all([api.call('works?projectId=' + p.id), api.call('runs?projectId=' + p.id)]);
    body = `<div class="row between" style="margin-bottom:16px"><span class="muted small">任务状态是实际记录，不从聊天摘要推断</span>${btn('new-task', '＋ 新任务', { id: p.id })}</div>${taskBoard(ctx.tasks)}<section class="card">${cardHead('view', '派活与回传', works.length)}${works.length ? workTree(works) : empty('还没有发生 Bot 委派。配置模型后，负责人可通过工具发起。')}</section><section class="card section-gap">${cardHead('clock', '执行记录', runs.length)}${runs.length ? `<div class="event-log">${runs.map(run => `<div class="event-line"><span>${date(run.started_at)}</span><span class="grow">${esc(get(run.bot_id)?.title ?? run.bot_id)} · ${badge(run.state)} · ${run.step} steps${run.error ? '<div>' + esc(run.error) + '</div>' : ''}</span>${btn('run', '详情', { id: run.id, cls: 'small' })}</div>`).join('')}</div>` : empty('没有真实运行记录')}</section>`;
}
else if (app.route.tab === 'results') {
    const items = ctx.resources.filter(x => x.kind === 'view' || x.kind === 'object');
    body = `<div class="filters">${[['all', '全部'], ['report', '报告'], ['view', '视图'], ['material', '素材'], ['decision', '决策']].map(([k, text]) => btn('filter', text, { id: k, cls: 'tab ' + (app.filter === k ? 'active' : '') })).join('')}</div><div class="grid2">${items.filter(x => app.filter === 'all' || x.category === app.filter || x.kind === app.filter).map(resultCard).join('')}</div>`;
} return `<main class="main project-main">${projectHeader(p, ctx)}${p.demo ? '<div class="demo-notice">示例项目 · 可修改资料和任务；后台执行以真实运行日志为准。</div>' : ''}${body}</main>`; }
function resultCard(x) { return `<article class="card result-card"><div class="row">${icon(x.kind === 'view' ? 'view' : 'file', 14)}<span class="small muted">${esc(x.kind === 'view' ? '动态视图' : x.category ?? '知识')}</span><span class="grow"></span><span class="mono muted">${x.summary ? 'L0 / L1' : '原文'}</span></div><a href="${resourceRoute(x.uri)}"><h3>${esc(x.title)}</h3></a><p>${esc(x.summary?.abstract ?? x.content?.replace(/[#>]/g, '').slice(0, 90) ?? (x.mode === 'snapshot' ? '固定快照' : '实时数据绑定'))}</p><span class="mono muted">${esc(x.uri)}</span><div class="actions">${btn('add-to-collection', '沉淀到集合', { id: x.id, cls: 'small' })}${btn('copy-uri', '复制引用', { id: x.uri, cls: 'small ghost' })}</div></article>`; }
function knowledgeRows(rows) { return rows.length ? rows.map(x => `<div class="knowledge-row">${icon(x.kind === 'collection' ? 'stack' : 'file', 15)}<div class="grow"><a href="${resourceRoute(x.uri)}"><h3>${esc(x.title)}</h3></a><p>${esc(x.snippet ?? x.summary?.abstract ?? x.description ?? x.content?.replace(/[#>]/g, '').slice(0, 120) ?? '')}</p><span class="mono">${esc(x.uri)}</span></div><span class="pill">${esc(x.kind === 'collection' ? '集合' : x.category ?? '资料')}</span>${x.channels ? `<span class="pill">${x.channels.join(' + ')}</span>` : ''}${btn('copy-uri', '↗', { id: x.uri, cls: 'small ghost', extra: 'aria-label="复制引用"' })}</div>`).join('') : empty('没有找到内容。可以换关键词或导入资料。'); }
async function knowledgeHTML() { let rows = all('object'); let hint = '全文索引已就绪'; if (app.search) {
    const result = await api.call('search', { query: app.search, scope: app.searchScope ? { projectId: app.searchScope } : undefined, limit: 30 });
    rows = result.results;
    hint = `${result.mode === 'hybrid-rrf' ? '全文 + 向量融合' : '全文检索'} · ${rows.length} 条结果${result.vectorStatus === 'not-configured' ? ' · 未配置向量模型' : ''}`;
} if (app.filter !== 'all')
    rows = rows.filter(x => (x.category ?? get(x.resourceId)?.category) === app.filter); return `<main class="main"><div class="page-header"><h1>知识</h1>${btn('import', '导入文件')}${btn('new-knowledge', '＋ 新建知识', { cls: 'primary' })}</div><form id="search-form" class="searchbar">${icon('search')}<input name="query" placeholder="搜索标题、内容、方法或直接粘贴 lede:// URI…" value="${esc(app.search)}" aria-label="搜索知识"><select name="scope" aria-label="检索范围"><option value="">全局知识</option>${all('project').map(p => `<option value="${p.id}" ${app.searchScope === p.id ? 'selected' : ''}>${esc(p.title)}</option>`).join('')}</select><button type="submit" class="ghost small">搜索</button></form><div class="row between"><div class="filters">${[['all', '全部'], ['report', '研究报告'], ['method', '方法与经验'], ['decision', '决策'], ['material', '素材']].map(([k, v]) => btn('filter', v, { id: k, cls: 'tab ' + (app.filter === k ? 'active' : '') })).join('')}</div><span class="small muted">${hint}</span></div>${knowledgeRows(rows)}</main>`; }
function collectionsHTML() { return `<main class="main"><div class="page-header"><h1>集合</h1>${btn('new-collection', '＋ 新集合', { cls: 'primary' })}</div><p class="secondary" style="margin-bottom:24px">把资料、方法和案例放在一起。引用同一个对象，不复制知识。</p><div class="grid3">${all('collection').map(c => `<article class="card result-card"><div class="row">${icon('stack', 18)}<span class="grow"></span><span class="pill">${c.mode === 'dynamic' ? '动态集合' : '静态集合'}</span></div><a href="#collection/${c.id}"><h2>${esc(c.title)}</h2></a><p>${esc(c.summary && !c.summary.stale ? c.summary.abstract : c.description)}</p><div class="row small muted">${c.summary ? (c.summary.stale ? '概览待更新' : 'L0 / L1 已生成') : '按需生成概览'}</div></article>`).join('')}</div>${!all('collection').length ? empty('方法论也可以只是一个集合，不需要独立的执行引擎。') : ''}</main>`; }
async function collectionHTML() { const data = await api.call('collection?id=' + app.route.id), c = data.collection; app.currentCollection = data; return `<main class="main"><div class="breadcrumb"><a href="#collections">集合</a> / ${esc(c.title)}</div><div class="page-header"><h1>${esc(c.title)}</h1><span class="pill">${c.mode === 'dynamic' ? '动态集合' : '静态集合'}</span><span class="small muted">${data.members.length} 项</span>${btn('edit-collection', '编辑', { id: c.id })}${btn('copy-uri', '复制 URI', { id: c.uri })}</div><div class="collection-layout"><section class="card">${cardHead('stack', '集合概览')}<div class="row between" style="margin-bottom:16px"><span class="mono muted">${c.summary ? 'L1 · ' + (c.summary.stale ? '已过期，不能作为当前结论' : '当前概览') : '尚未生成 L0 / L1'}</span>${btn('summary', '更新概览', { id: c.id, cls: 'small' })}</div>${c.summary ? `<div class="abstract"><span class="level-label">L0 · ${esc(c.summary.method)}</span><p>${esc(c.summary.abstract)}</p></div><div class="markdown collection-overview">${md(c.summary.overview)}</div><p class="small muted" style="margin-top:18px">生成于 ${date(c.summary.generatedAt)} · 源版本 ${c.summary.sourceRevision}</p>` : empty('概览是可选的派生表示，不影响全文检索或原文读取。')}</section><div class="stack"><section class="card">${cardHead('view', '被这些项目引用')}${data.projects.map(p => `<a class="list-line" href="${projectHref(p.id)}">${icon('target', 14)}${esc(p.title)}</a>`).join('') || '<p class="small muted">尚未关联到项目</p>'}</section><section class="card">${cardHead('file', '概览怎么来')}<p class="small secondary">读取成员资料 → 模型生成 L1 → 从简介提取 L0。保存时核对成员版本；内容变化后明确标记过期。</p><div class="divider"></div><p class="small muted">不会自动改写引用这些资料的判断，也不会把集合概览当作搜索的必经路径。</p></section>${c.mode === 'dynamic' ? `<section class="card"><h4>查询条件</h4><pre class="build-log">${esc(JSON.stringify(c.query, null, 2))}</pre></section>` : ''}</div></div><section class="card section-gap"><div class="row between">${cardHead('file', '集合成员', data.members.length)}${c.mode === 'static' ? btn('collection-add', '＋ 添加资料', { id: c.id, cls: 'small' }) : '<span class="small muted">根据查询自动更新</span>'}</div>${data.members.map(x => `<div class="member-row">${icon(x.kind === 'collection' ? 'stack' : 'file', 15)}<div class="grow"><a href="${resourceRoute(x.uri)}">${esc(x.title)}</a><div class="small muted">${esc(x.category ?? x.kind)} · ${x.summary ? 'L0 / L1' : '原文'} · ${date(x.updatedAt)}</div></div>${c.mode === 'static' ? btn('collection-remove', '移除关联', { id: x.id, cls: 'small ghost' }) : ''}</div>`).join('') || empty('集合中还没有内容')}</section></main>`; }
async function objectHTML(ref) {
    const x = await api.call('resolve', { uri: ref });
    app.currentObject = x;
    if (x.kind === 'view') {
        location.hash = '#view/' + x.id + '/' + (app.lastProject ?? '');
        return '';
    }
    if (x.kind === 'collection') {
        location.hash = '#collection/' + x.id;
        return '';
    }
    if (x.kind === 'project') {
        location.hash = projectHref(x.id);
        return '';
    }
    if (x.kind === 'task') {
        setTimeout(() => openTask(x.id), 0);
        return '<main class="main">' + empty('任务已在编辑面板打开') + '</main>';
    }
    const [rels, versions] = await Promise.all([api.call('relations?id=' + x.id), api.call('versions?id=' + x.id)]);
    const cols = all('collection');
    const selected = parseURI(ref).anchor;
    return `<main class="main object-main"><div class="breadcrumb"><a href="#knowledge">知识</a> / ${esc(x.category ?? '资料')}</div><div class="page-header"><h1>${esc(x.title)}</h1><span class="pill">${esc(x.category ?? '知识')}</span>${!x.isHistorical ? btn('edit-knowledge', '编辑', { id: x.id }) : '<span class="badge">历史版本</span>'}</div><div class="object-meta"><span>${x.demo ? '示例资料' : esc(x.source?.label ?? '本地知识')}</span><span>rev ${x.revision}</span><span>${date(x.updatedAt)}</span><span>${x.status === 'archived' ? '已归档' : ''}</span></div>${(x.blocks ?? []).map(b => `<section class="document-block ${selected === b.id ? 'selected' : ''}" data-action="select-block" data-id="${b.id}" tabindex="0"><span class="block-anchor" title="${b.id}">${esc(b.id.replace('block_', '#'))}</span><div class="markdown">${md(b.text)}</div></section>`).join('') || `<div class="markdown">${md(x.content ?? '')}</div>`}</main><aside class="inspector"><section class="inspector-section"><h4>资源地址</h4><div class="mono secondary">${esc(uri(x.kind, x.id, { rev: x.revision }))}</div><div class="row" style="margin-top:10px">${btn('copy-uri', '复制引用', { id: uri(x.kind, x.id, { rev: x.revision }), cls: 'small' })}${btn('attach-object', '交给负责人', { id: x.id, cls: 'small' })}</div></section><section class="inspector-section"><h4>上下文表示</h4>${x.summary ? `<div class="inspector-row"><span class="mono">L0 · 摘要</span>${badge(x.summary.stale ? '待更新' : '当前')}</div><p class="small secondary">${esc(x.summary.abstract)}</p><div class="inspector-row"><span class="mono">L1 · 概览</span><span class="small muted">源 rev ${x.summary.sourceRevision}</span></div>` : '<p class="small muted">仅保存原文。普通短内容不生成摘要。</p>'}<div class="inspector-row"><span class="mono">L2 · 原文</span><span>${(x.blocks ?? []).length} 个内容块</span></div>${btn('summary', '按需生成 / 更新摘要', { id: x.id, cls: 'small' })}</section><section class="inspector-section"><h4>版本</h4><select id="version-select" aria-label="查看版本">${versions.map(v => `<option value="${v.revision}" ${v.revision === x.revision ? 'selected' : ''}>rev ${v.revision} · ${date(v.created_at)}</option>`).join('')}</select></section><section class="inspector-section"><div class="row between"><h4>关联关系</h4>${btn('new-relation', '＋', { id: x.id, cls: 'small ghost' })}</div>${rels.map(rel => { const other = rel.source === x.id ? rel.targetResource : rel.sourceResource; return `<div class="relation-row"><small>${rel.source === x.id ? '→' : '←'} ${esc(rel.type)}</small><a href="${resourceRoute(other.uri)}">${esc(other.title)}</a></div>`; }).join('') || '<p class="small muted">暂无显式关联</p>'}</section><section class="inspector-section"><h4>组织</h4>${btn('add-to-collection', '加入集合', { id: x.id, cls: 'small' })}</section><div class="inspector-actions">${btn('archive', x.status === 'archived' ? '恢复到知识库' : '归档知识', { id: x.id })}${btn('delete-resource', '永久删除', { id: x.id, cls: 'danger' })}</div></aside>`;
}
async function viewHTML() { const data = await api.call('view?id=' + app.route.id); app.currentView = data; const projectId = app.route.projectId || app.data.mounts.find(m => m.view_id === data.view.id)?.project_id; app.lastProject = projectId ?? app.lastProject; const v = data.view; const p = projectId ? get(projectId) : null; return `<main class="main project-main"><div class="breadcrumb">${p ? `<a href="${projectHref(p.id)}">${esc(p.title)}</a> / ` : ''}项目视图</div><div class="page-header"><h1>${esc(v.title)}</h1>${badge(v.mode === 'live' ? '实时' : '快照')}<span class="mono muted">rev ${v.revision}</span>${btn('view-edit', '编辑结构', { id: v.id })}${btn('view-pin', '固定 / 挂载', { id: v.id })}${projectId && app.data.mounts.some(m => m.view_id === v.id && m.project_id === projectId) ? btn('view-unmount', '移除挂载', { id: app.data.mounts.find(m => m.view_id === v.id && m.project_id === projectId).id, cls: 'small ghost' }) : ''}${btn('toggle-chat', '负责人', { cls: 'small' })}</div><div class="row between" style="margin-bottom:16px"><div class="tabs" style="margin:0">${btn('layout-grid', '网格', { cls: 'tab ' + (app.viewLayout === 'grid' ? 'active' : '') })}${btn('layout-canvas', '画布', { cls: 'tab ' + (app.viewLayout === 'canvas' ? 'active' : '') })}</div><div class="row">${btn('view-snapshot', v.mode === 'snapshot' ? '切回实时' : '保存快照', { id: v.id, cls: 'small' })}${btn('copy-uri', '复制 URI', { id: v.uri, cls: 'small' })}</div></div><div class="${app.viewLayout === 'canvas' ? 'view-canvas' : 'view-grid'}" id="view-blocks">${app.viewLayout === 'canvas' ? '<div class="canvas-stage">' : ''}${data.blocks.map((b, i) => `<section class="card view-block ${['table', 'tasks', 'timeline', 'markdown', 'relations'].includes(b.type) ? 'wide' : ''}" data-block="${esc(b.id)}" style="${app.viewLayout === 'canvas' ? `left:${b.layout?.x ?? (i % 2) * 450 + 20}px;top:${b.layout?.y ?? Math.floor(i / 2) * 290 + 20}px;` : ''}"><header class="drag-handle"><span>${esc(b.title ?? b.id)} <span class="mono">${esc(b.type)}</span></span>${btn('select-view-block', '选中', { id: b.id, cls: 'small ghost' })}</header>${blockHTML(b)}</section>`).join('')}${app.viewLayout === 'canvas' ? '</div>' : ''}</div>${!data.blocks.length ? empty('视图还没有模块。编辑结构或请负责人生成。') : ''}</main>`; }
async function pluginsHTML() { const list = await api.call('widgets'); app.widgetList = list; let w = list.find(x => x.key === app.route.key) ?? list[0]; app.currentWidget = w; const phases = ['发现需求', '写代码', '编译 / Schema', '沙箱预览', '确认注册', '挂载']; const stage = !w ? 0 : w.state === 'draft' ? 1 : w.state === 'error' ? 2 : w.state === 'built' ? 3 : w.state === 'previewed' ? 4 : 5; return `<div class="plugins-layout"><aside class="plugin-list"><div class="row between" style="margin-bottom:22px"><h3>视图插件</h3>${btn('new-widget', '＋', { cls: 'small' })}</div>${list.map(x => `<a class="plugin-row ${x.key === w?.key ? 'active' : ''}" href="#plugins/${encodeURIComponent(x.key)}"><span class="mono">${esc(x.widget_id)}</span><div class="row">${badge(x.state)}<span class="mono muted">${esc(x.version)}</span></div><p>${esc(x.manifest.name)}</p></a>`).join('') || '<p class="small muted">还没有自定义插件</p>'}</aside><main class="plugin-main">${!w ? empty('预制组件之外的表达需求，可以通过代码插件扩展。', btn('new-widget', '创建插件', { cls: 'primary' })) : `<div class="breadcrumb">视图插件 / ${esc(w.manifest.name)}</div><div class="page-header"><h1 class="mono" style="font-size:24px">${esc(w.key)}</h1>${badge(w.state)}${w.state === 'registered' ? btn('mount-widget', '挂载到项目', { id: w.key, cls: 'primary' }) : btn('register-widget', '注册', { id: w.key, cls: 'primary', extra: w.previewOK ? '' : 'disabled' })}</div><p class="secondary">${esc(w.manifest.description ?? '')}</p><div class="pipeline">${phases.map((label, i) => `${i ? '<span class="arrow">→</span>' : ''}<div class="pipeline-step ${i < stage ? 'done' : i === stage ? 'current' : ''}"><i>${i < stage ? '✓' : i + 1}</i>${label}</div>`).join('')}</div><div class="grid2" style="grid-template-columns:minmax(0,1.15fr) minmax(0,1fr)"><section class="card"><div class="row between" style="margin-bottom:14px"><h3>沙箱预览</h3><span class="pill">隔离 origin</span></div><div id="plugin-preview" class="sandbox-host">${w.compiled ? '<div class="empty">准备加载…</div>' : empty('先编译，再查看真实运行结果')}</div><p class="plugin-note">代码在不含同源权限的 iframe 中运行。没有模型 Key、数据库或文件接口。点击可交互数据后，选择才回传给负责人。</p><div class="row" style="margin-top:16px">${btn('preview-widget', '重新预览', { id: w.key, cls: 'small', extra: w.compiled ? '' : 'disabled' })}${btn('widget-props', '调整预览数据', { id: w.key, cls: 'small' })}</div></section><section class="card"><div class="tabs" style="margin-bottom:12px">${[['manifest', 'Manifest'], ['source', '代码'], ['schema', 'Schema']].map(([k, text]) => btn('plugin-tab', text, { id: k, cls: 'tab ' + (app.pluginTab === k ? 'active' : '') })).join('')}</div><textarea id="widget-editor" class="code-editor" spellcheck="false" aria-label="插件源码与配置" ${w.state === 'registered' ? 'readonly' : ''}>${esc(app.pluginTab === 'source' ? w.source : JSON.stringify(app.pluginTab === 'schema' ? w.manifest.propsSchema : w.manifest, null, 2))}</textarea><div class="row" style="margin-top:12px">${w.state === 'registered' ? btn('widget-version', '新建版本', { id: w.key, cls: 'small' }) : btn('save-widget', '保存修改', { id: w.key, cls: 'small' })}${btn('build-widget', '编译校验', { id: w.key, cls: 'small primary', extra: w.state === 'registered' ? 'disabled' : '' })}</div></section></div>${w.buildLog ? `<div class="build-log section-gap">${esc((w.buildLog.ok ? '✓ Manifest / Schema / 源码语法检查通过' : '✕ 编译校验失败') + '\n' + (w.buildLog.errors ?? []).join('\n') + (w.buildLog.previewError ? '\n预览错误：' + w.buildLog.previewError : '') + '\n' + w.buildLog.compiler + ' · ' + w.buildLog.sourceHash?.slice(0, 16))}</div>` : ''}<div class="plugin-triplet"><section class="card"><h4>Widget Type</h4><p>代码、Schema 与版本。注册后版本不可变，可反复创建视图。</p></section><section class="card"><h4>View Instance</h4><p>布局、参数与数据引用。运行中可增量更新，不复制全部原始数据。</p></section><section class="card"><h4>View Mount</h4><p>决定视图出现在哪个项目。移除挂载不删除视图或插件。</p></section></div>${w.state === 'registered' ? `<div style="margin-top:18px">${btn('disable-widget', '停用这个版本', { id: w.key, cls: 'small danger' })}</div>` : ''}`}</main></div>`; }
function providerFields(kind, c) { return `<div class="field"><label>API Base URL</label><input name="${kind}.baseURL" value="${esc(c.baseURL ?? '')}" placeholder="https://…/v1"></div><div class="field"><label>模型名称</label><input name="${kind}.model" value="${esc(c.model ?? '')}" placeholder="填写提供方的 model ID"></div><div class="field"><label>API Key</label><input name="${kind}.apiKey" type="password" autocomplete="new-password" placeholder="${c.hasKey ? '已保存；留空保持不变' : '仅保存在本机服务，不返回浏览器'}"><small>Key 不进入 Agent 上下文和插件沙箱。</small></div><label class="row small secondary"><input type="checkbox" name="${kind}.allowAnonymous" ${c.allowAnonymous ? 'checked' : ''}>本地模型 / 无需 API Key</label>`; }
async function settingsHTML() { const config = await api.call('providers'), jobs = await api.call('jobs'); app.providerConfig = config; return `<main class="main"><div class="page-header"><h1>设置</h1><a class="usage-entry" href="#usage">用量 →</a>${btn('export', '导出工作空间')}</div><form id="provider-form"><div class="settings-sections"><section class="card"><h3>对话模型</h3><p class="small muted" style="margin-bottom:14px">OpenAI-compatible Chat Completions；可接 DeepSeek、兼容网关或本地服务。</p>${providerFields('chat', config.chat)}<div class="form-row section-gap"><div class="field"><label>上下文窗口</label><input type="number" name="chat.contextWindow" value="${config.chat.contextWindow ?? 65536}" min="8192"></div><div class="field"><label>最大输出 Tokens</label><input type="number" name="chat.maxTokens" value="${config.chat.maxTokens ?? 4096}" min="256" max="32000"></div></div><div class="field section-gap"><label>推理强度（可选，提供方不支持时留空）</label><input name="chat.effort" value="${esc(config.chat.effort ?? '')}" placeholder="例如 low / medium / high"></div></section><section class="card"><h3>语义检索</h3><p class="small muted" style="margin-bottom:14px">未配置时明确降级为 FTS5，不用词频伪装语义向量。</p>${providerFields('embedding', config.embedding)}<div class="divider"></div><p class="small secondary">${app.data.stats.chunks} 个片段 · ${app.data.stats.vectors} 个向量</p><p class="small muted">模型或地址改变后需要重新建立向量索引。</p>${btn('reindex', '构建 / 补齐向量索引', { cls: 'small', extra: 'type="button"' })}</section></div><section class="card section-gap"><h3 style="margin-bottom:15px">本地执行</h3><label class="row secondary"><input name="allowNetwork" type="checkbox" ${config.allowNetwork ? 'checked' : ''}>允许公开网页读取工具</label><label class="row secondary" style="margin-top:14px"><input name="allowShell" type="checkbox" ${config.allowShell ? 'checked' : ''}>允许本地 Shell 命令（非操作系统沙箱，使用当前用户权限）</label><p class="small muted" style="margin-top:12px">默认关闭命令执行。即使启用，也不要给不可信任务配置敏感系统凭据。</p><div class="divider"></div><p class="mono muted">${esc(app.data.dataHome)}</p><p class="small muted">SQLite、附件和模型设置均保存在此处。浏览器关闭不停止后台 Node 服务。</p></section><div class="form-actions"><span class="form-error grow"></span><button type="button" data-action="test-provider">保存并测试模型</button><button type="submit" class="primary">保存设置</button></div></form><section class="card section-gap">${cardHead('clock', '后台作业')}${jobs.map(j => `<div class="list-line"><span class="grow">${esc(j.type)} ${j.resource_id ? esc(get(j.resource_id)?.title ?? j.resource_id) : ''}<small class="muted">${j.error ? ' · ' + esc(j.error) : ''}</small></span>${badge(j.state)}</div>`).join('') || '<p class="small muted">没有后台索引 / 摘要作业</p>'}</section><p class="small muted" style="margin-top:20px">Lede v0.3 · 本地单用户 · 无遥测上传 · 空间权限预留，未实现多用户隔离。</p></main>`; }
async function chatHTML(projectId) { app.chatProject = projectId; const data = await api.call('chat?projectId=' + projectId); app.chatData = data; const global = projectId === 'global'; const rows = data.events.filter(e => e.type === 'assistant/message' || e.type === 'user/message' && e.data.source?.kind === 'user'); const active = data.runs.find(r => r.state === 'running'); const pending = data.pending; return `<aside class="chat-panel ${global ? 'global' : ''}" aria-label="${global ? '总助' : '项目负责人'}"><div class="chat-header">${global ? `<span class="spark-circle">${icon('spark', 16)}</span>` : botIcon(data.bot, true)}<div class="grow"><strong>${esc(data.bot.title)}</strong><small>${global ? '全局 · 不属于任何项目' : active ? '正在处理本项目 · Step ' + active.step : '项目负责人 · 对话与结果持久保存'}</small></div>${active ? btn('cancel-current', '停止', { id: active.id, cls: 'small' }) : ''}${btn(global ? 'close-global' : 'toggle-chat', '×', { cls: 'icon-btn', extra: 'aria-label="关闭对话面板"' })}</div><div class="chat-feed" id="chat-feed">${!api.token ? '' : !app.data.providers.chat.configured ? `<div class="provider-hint">先配置一个模型，再开始实际执行。知识、任务和视图可直接使用。<br><a href="#settings" style="color:var(--signal)">打开模型设置 →</a></div>` : ''}${!rows.length ? `<div class="message assistant"><p>${global ? '这里是总助。你可以找资料、建立项目，或把一个目标交给项目负责人。' : '我们围绕这个项目沟通。先明确目标和范围，再按需调动执行团队；资料、进展和成果会回到主视图。'}</p><p class="muted small">${global ? '' : '选中视图中的模块或知识片段，可以直接作为对话上下文。'}</p></div>` : rows.map(e => e.type === 'user/message' ? `<div class="message user">${esc(e.data.content.replace(/\n\[用户在界面选中的内容[\s\S]*/, ''))}</div>` : e.data.message.content ? `<div class="message assistant"><div class="markdown">${md(e.data.message.content)}</div></div>` : '').join('')}${pending.map(c => `<section class="confirm-card"><h4>我理解的是 · ${esc(c.title)}</h4>${[['scope', '范围'], ['do', '要做'], ['avoid', '不做'], ['delegate', '交给']].filter(([k]) => c.data[k]).map(([k, label]) => `<div class="confirm-line"><span>${label}</span><span>${esc(c.data[k])}</span></div>`).join('')}<div class="row">${btn('confirm-yes', '✓ 确认，继续', { id: c.id, cls: 'primary small' })}${btn('confirm-no', '调整理解', { id: c.id, cls: 'small' })}</div></section>`).join('')}${data.runs.filter(r => ['failed', 'blocked', 'interrupted', 'truncated'].includes(r.state)).slice(0, 2).map(run => `<div class="message error"><p>${esc(run.error ?? statusText[run.state])}</p><div class="row" style="margin-top:8px">${btn('retry-run', '检查后继续', { id: run.id, cls: 'small' })}${btn('run', '执行详情', { id: run.id, cls: 'small ghost' })}</div></div>`).join('')}<div class="message assistant stream-content" id="stream-content">${esc(app.streams.get(data.session.id) ?? '')}</div>${active ? '<p class="message meta">正在执行…可以插话；新消息会在下一步边界读取。</p>' : ''}</div><div class="chat-composer">${app.selection ? `<div class="context-chip">${icon('view', 12)}<span>${esc(app.selection.label ?? app.selection.excerpt ?? app.selection.uri ?? '已选上下文')}</span>${btn('clear-selection', '×', { cls: 'small ghost' })}</div>` : ''}<form id="chat-form" class="composer-box"><textarea name="message" rows="2" placeholder="${global ? '和总助说…' : '和负责人说…'}" aria-label="${global ? '总助消息' : '负责人消息'}">${esc(app.drafts[projectId] ?? '')}</textarea><button class="send" type="submit" aria-label="发送消息">${icon('send', 13)}</button></form><div class="small muted" style="margin-top:7px;padding:0 4px">Enter 发送 · Shift + Enter 换行</div></div></aside>`; }
async function render() {
    const seq = ++app.renderSeq;
    app.route = route();
    clearSandboxes();
    let body = '', chatProject = null;
    try {
        switch (app.route.type) {
            case 'home':
                body = homeHTML();
                break;
            case 'project':
                body = await projectHTML();
                chatProject = app.route.id;
                break;
            case 'knowledge':
                body = await knowledgeHTML();
                break;
            case 'collections':
                body = collectionsHTML();
                break;
            case 'collection':
                body = await collectionHTML();
                break;
            case 'resource':
                body = await objectHTML(app.route.uri);
                break;
            case 'plugins':
                body = await pluginsHTML();
                break;
            case 'view':
                body = await viewHTML();
                chatProject = app.route.projectId ?? app.lastProject;
                break;
            case 'usage':
                body = await usageHTML(app.data.resources);
                break;
            case 'settings':
                body = await settingsHTML();
                break;
        }
        if (app.global)
            chatProject = 'global';
        else if (app.chatHidden)
            chatProject = null;
        if (app.route.type === 'resource' && (app.global || app.objectChat)) {
            chatProject = app.global ? 'global' : app.lastProject;
            body = body.replace(/<aside class="inspector">[\s\S]*<\/aside>$/, '');
        }
        if (chatProject)
            body += await chatHTML(chatProject);
        if (seq !== app.renderSeq)
            return;
        qs('#app').innerHTML = `<div class="app-shell ${app.route.type === 'usage' ? 'usage-shell' : ''}">${sidebar()}<div class="main-wrap ${app.route.type === 'resource' ? 'object-layout' : ''}">${body}${!chatProject && app.route.type !== 'settings' && app.route.type !== 'plugins' && app.route.type !== 'usage' ? btn('global', icon('spark', 16), { cls: 'float-assistant', extra: 'aria-label="打开总助"' }) : ''}</div></div>`;
        wireForms();
        if(app.route.type === 'usage') wireUsage(render);
        if (app.route.type === 'plugins')
            previewCurrentWidget();
        if (app.route.type === 'view')
            wireView();
        if (app.route.type === 'project' && app.route.tab === 'progress')
            wireKanban();
        qs('#chat-feed')?.scrollTo(0, 1000000);
        if (app.team)
            await renderTeam();
    }
    catch (e) {
        if (seq !== app.renderSeq)
            return;
        qs('#app').innerHTML = `<div class="app-shell">${sidebar()}<main class="main">${empty('无法打开：' + esc(e.message), '<a href="#home">返回首页</a>')}</main></div>`;
    }
}
async function refresh(repaint = true) { app.data = await api.boot(); if (repaint)
    await render(); }
function closeModal() { qs('#modal-root').innerHTML = ''; }
function modal(title, content, { wide = false, submit } = {}) { qs('#modal-root').innerHTML = `<div class="modal-backdrop"><section class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="modal-header"><h2>${esc(title)}</h2>${btn('close-modal', '×', { cls: 'icon-btn', extra: 'aria-label="关闭"' })}</div>${submit ? '<form id="dialog-form">' : ''}${content}${submit ? '<div class="form-error" role="alert"></div><div class="form-actions"><button type="button" data-action="close-modal">取消</button><button class="primary" type="submit">保存</button></div></form>' : ''}</section></div>`; const form = qs('#dialog-form'); if (form)
    form.addEventListener('submit', async (e) => { e.preventDefault(); const button = form.querySelector('button[type=submit]'); button.disabled = true; try {
        await submit(new FormData(form), form);
        closeModal();
        await refresh();
    }
    catch (error) {
        qs('.form-error', form).textContent = error.message;
    }
    finally {
        button.disabled = false;
    } }); qs('input,textarea,select', qs('.modal'))?.focus(); }
const field = (label, name, value = '', type = 'text', extra = '') => `<div class="field"><label for="f-${name}">${label}</label><input id="f-${name}" name="${name}" type="${type}" value="${esc(value)}" ${extra}></div>`;
const area = (label, name, value = '', rows = 5, extra = '') => `<div class="field"><label for="f-${name}">${label}</label><textarea id="f-${name}" name="${name}" rows="${rows}" ${extra}>${esc(value)}</textarea></div>`;
const select = (label, name, options, value) => `<div class="field"><label for="f-${name}">${label}</label><select name="${name}" id="f-${name}">${options.map(([id, text]) => `<option value="${esc(id)}" ${id === value ? 'selected' : ''}>${esc(text)}</option>`).join('')}</select></div>`;
const jsonInput = (data, name, fallback) => { const text = data.get(name); return text ? JSON.parse(text) : fallback; };
function openNewProject() { modal('创建项目', field('项目名称', 'title', '', 'text', 'required maxlength="120"') + area('项目目标', 'goal', '', 4, 'required') + field('负责人名称', 'leadName', '', 'text', 'placeholder="留空自动命名"'), { submit: async (d) => { const p = await api.call('resource/create', { kind: 'project', data: Object.fromEntries(d) }); location.hash = projectHref(p.id); } }); }
async function openMemory(scope, owner) {
    const entries=await api.call(`memory?scope=${scope}&owner=${owner}`); app.memoryPanel={scope,owner,entries};
    modal('长期记忆', `<div class="continuity-panel"><div class="row">${btn('memory-add','添加记忆',{cls:'small'})}${scope==='project'?btn('workspace-memory','共享记忆',{cls:'small ghost'}):''}</div>${entries.map(m=>`<div class="card section-gap"><p>${esc(m.text)}</p><p class="small muted">${esc(m.source)}${m.pinned?' · 已固定':''}${m.until?' · 到期 '+date(m.until):''}</p><div class="row">${btn('memory-edit','编辑',{id:m.id,cls:'small'})}${btn('memory-history','历史',{id:m.id,cls:'small ghost'})}${btn('memory-delete','遗忘',{id:m.id,cls:'small danger'})}</div></div>`).join('')||empty('暂无长期记忆')}</div>`);
}
function editMemory(id) { const request_id=crypto.randomUUID(); const panel=app.memoryPanel,m=panel.entries.find(x=>x.id===id); modal(m?'编辑记忆':'添加记忆',area('内容','text',m?.text??'',3,'required maxlength="600"')+field('来源','source',m?.source??'用户手动维护')+field('到期时间（可留空）','until',m?.until??'')+select('固定','pinned',[['false','否'],['true','是']],String(m?.pinned??false)),{submit:d=>api.call('memory',{request_id,scope:panel.scope,owner:panel.owner,id:m?.id,baseRevision:m?.revision,text:d.get('text'),source:d.get('source'),until:d.get('until'),pinned:d.get('pinned')==='true'})}); }
async function openGoal(projectId) {
    const data=await api.call('project/continuity?projectId='+projectId),g=data.goal;app.goalPanel={projectId,goal:g};
    const labels={active:'推进中',paused:'已暂停',blocked:'待处理',complete:'已完成',stopped:'已停止'};
    modal('项目目标',`<div class="continuity-panel">${g?`<div class="row between"><strong>${esc(g.objective)}</strong>${badge(labels[g.status])}</div><p class="small secondary">验收：${esc(g.acceptance)}</p>${g.constraints?`<p class="small">约束：${esc(g.constraints)}</p>`:''}${g.reason?`<p class="small">${esc(g.reason)}</p>`:''}${g.stages.map((st,i)=>`<div class="card section-gap"><strong>${i+1}. ${esc(st.title)} · ${st.status==='passed'?'已验收':i===g.current?'当前阶段':'待推进'}</strong><p class="small secondary">${esc(st.acceptance)}</p>${st.taskIds.map(id=>`<p class="small">${esc(get(id)?.title??id)} · ${esc(statusText[get(id)?.state]??'已删除')}</p>`).join('')}${st.evidence?`<p class="small">证据：${esc(st.evidence)}</p>`:''}${st.feedback?`<p class="small">返工：${esc(st.feedback)}</p>`:''}</div>`).join('')}<div class="row section-gap">${g.status==='active'?btn('goal-control','暂停',{id:'pause'}):''}${['paused','blocked'].includes(g.status)?btn('goal-control','恢复推进',{id:'resume',cls:'primary'}):''}${['active','paused','blocked'].includes(g.status)?btn('goal-edit','调整目标',{id:projectId,cls:'small'}):''}${['active','paused','blocked'].includes(g.status)?btn('goal-control','停止目标',{id:'stop',cls:'danger'}):btn('goal-create','新目标',{id:projectId})}</div>`:empty('尚未设置执行目标',btn('goal-create','设置目标',{id:projectId,cls:'primary'}))}</div>`);
}
function goalStageFields(index,tasks) { return `<fieldset data-goal-stage="${index}"><legend>阶段 ${index+1}</legend>${field('名称','stageTitle'+index,'','text','required')}${area('验收标准','stageAcceptance'+index,'',2,'required')}<div class="field"><label>任务</label>${tasks.map(t=>`<label class="row"><input type="checkbox" name="taskIds${index}" value="${esc(t.id)}">${esc(t.title)}</label>`).join('')||'<p>先在进展页创建任务。</p>'}</div></fieldset>`; }
function createGoal(projectId) { const p=get(projectId),tasks=all('task').filter(t=>t.projectId===projectId),request_id=crypto.randomUUID();app.goalTasks=tasks;modal('设置项目目标',area('目标','objective',p.goal,3,'required')+area('完成标准','acceptance','',3,'required')+area('约束','constraints','',2)+`<div id="goal-stages">${goalStageFields(0,tasks)}</div><button type="button" data-action="goal-add-stage">添加阶段</button>`,{submit:(d,form)=>api.call('project/goal',{request_id,projectId,action:'start',baseRevision:app.goalPanel.goal?.revision??0,objective:d.get('objective'),acceptance:d.get('acceptance'),constraints:d.get('constraints'),stages:[...form.querySelectorAll('[data-goal-stage]')].map((_,i)=>({title:d.get('stageTitle'+i),acceptance:d.get('stageAcceptance'+i),taskIds:d.getAll('taskIds'+i)}))})}); }
function editGoal(projectId) { const g=app.goalPanel.goal,request_id=crypto.randomUUID();modal('调整目标',area('目标','objective',g.objective,3,'required')+area('完成标准','acceptance',g.acceptance,3,'required')+area('约束','constraints',g.constraints,2)+area('调整原因','reason','',2,'required'),{submit:d=>api.call('project/goal',{request_id,projectId,baseRevision:g.revision,action:'revise',...Object.fromEntries(d)})}); }
async function openHandoff(projectId) { const p=get(projectId),data=await api.call('project/continuity?projectId='+projectId);modal('负责人交接',select('新负责人','leadBotId',p.memberBotIds.map(id=>[id,get(id)?.title??id]),p.leadBotId)+`<div class="continuity-panel"><p class="small secondary">交接保留项目记忆、目标、任务、资料和用户原话；旧会话可追溯。有未结清工作时需先处理。</p>${data.transfers.map(t=>`<div class="list-line small">${esc(get(t.from_bot)?.title??t.from_bot)} → ${esc(get(t.to_bot)?.title??t.to_bot)} · ${date(t.created_at)}</div>`).join('')}${data.handoff?`<details><summary>最近交接包</summary><p class="small muted">${esc(data.handoff.note)}</p>${data.handoff.recentUserMessages.map(x=>`<blockquote>${esc(x.text)}</blockquote>`).join('')}<p class="small">${data.handoff.tasks.length} 个任务 · ${data.handoff.references.length} 份资料 · ${data.handoff.memory.length} 条项目记忆</p><p class="small muted">历史来源：${esc(data.handoff.historyUri)}</p></details>`:''}</div>`,{submit:d=>api.call('resource/update',{id:p.id,baseRevision:p.revision,patch:{leadBotId:d.get('leadBotId')}})}); }
function openEditProject(id) { const p = get(id); modal('编辑项目', field('名称', 'title', p.title, 'text', 'required') + area('目标', 'goal', p.goal) + field('当前阶段', 'phase', p.phase) + select('项目负责人', 'leadBotId', p.memberBotIds.map(id => [id, get(id)?.title ?? id]), p.leadBotId) + area('指标（JSON 数组）', 'metrics', JSON.stringify(p.metrics ?? [], null, 2), 5, 'class="mono"'), { submit: d => api.call('resource/update', { id, baseRevision: p.revision, patch: { title: d.get('title'), goal: d.get('goal'), phase: d.get('phase'), leadBotId: d.get('leadBotId'), metrics: jsonInput(d, 'metrics', []) } }) }); }
function openKnowledge(id, projectId) { const x = id ? get(id) : null; modal(x ? '编辑知识' : '新建知识', field('标题', 'title', x?.title ?? '', 'text', 'required') + select('内容类型', 'category', [['note', '笔记'], ['report', '研究报告'], ['method', '方法与经验'], ['decision', '决策'], ['material', '素材']], x?.category ?? 'note') + area('正文 · Markdown', 'content', x?.content ?? '', 15, 'required') + field('标签，用逗号分隔', 'tags', x?.tags?.join(', ') ?? ''), { wide: true, submit: async (d) => { const data = { title: d.get('title'), category: d.get('category'), content: d.get('content'), tags: d.get('tags').split(/[,，]/).map(x => x.trim()).filter(Boolean) }; const saved = x ? await api.call('resource/update', { id: x.id, baseRevision: x.revision, patch: data }) : await api.call('resource/create', { kind: 'object', data, options: projectId ? { projectId } : {} }); if (!x)
        location.hash = resourceRoute(saved.uri); } }); }
function openCollection(id) { const c = id ? get(id) : null; modal(c ? '编辑集合' : '新建集合', field('名称', 'title', c?.title ?? '', 'text', 'required') + area('这个集合解决什么问题', 'description', c?.description ?? '', 3) + select('集合类型', 'mode', [['static', '静态 · 手动引用'], ['dynamic', '动态 · 根据查询']], c?.mode ?? 'static') + area('动态查询（静态集合可留空）', 'query', c?.query ? JSON.stringify(c.query, null, 2) : '', 5, 'placeholder="{&quot;kind&quot;:&quot;object&quot;,&quot;tags&quot;:[&quot;方法论&quot;]}" class="mono"'), { submit: async (d) => { const data = { title: d.get('title'), description: d.get('description'), mode: d.get('mode'), query: jsonInput(d, 'query', {}) }; const saved = c ? await api.call('resource/update', { id, baseRevision: c.revision, patch: data }) : await api.call('resource/create', { kind: 'collection', data }); location.hash = '#collection/' + saved.id; } }); }
async function openTask(id, projectId) { const x = id ? await api.call('resource?id=' + id) : null; projectId = x?.projectId ?? projectId; const p = get(projectId); if (!p)
    throw Error('请选择所属项目'); const tasks = all('task').filter(t => t.projectId === projectId && t.id !== id); modal(x ? '任务 · ' + x.title : '新建任务', field('标题', 'title', x?.title ?? '', 'text', 'required') + area('具体工作', 'description', x?.description ?? '', 3) + `<div class="form-row">${select('执行 Bot', 'assigneeBotId', [['', '未分配'], ...p.memberBotIds.map(id => [id, get(id)?.title ?? id])], x?.assigneeBotId ?? '')}${select('状态', 'state', ['queued', 'doing', 'review', 'done', 'blocked', 'canceled'].map(s => [s, statusText[s]]), x?.state ?? 'queued')}</div>` + field('进度 %', 'progress', x?.progress ?? 0, 'number', 'min="0" max="100"') + area('验收标准', 'acceptance', x?.acceptance ?? '', 3) + area('完成证据 / 产物 URI', 'evidence', x?.evidence ?? '', 3) + `<div class="field"><label>前置任务</label><div class="checkbox-list">${tasks.map(t => `<label class="checkbox-item"><input type="checkbox" name="dependencies" value="${t.id}" ${x?.dependencies?.includes(t.id) ? 'checked' : ''}>${esc(t.title)} ${badge(t.state)}</label>`).join('') || '<span class="small muted">暂无其他任务</span>'}</div></div>`, { wide: true, submit: async (d) => { const data = { title: d.get('title'), description: d.get('description'), assigneeBotId: d.get('assigneeBotId') || null, state: d.get('state'), progress: Number(d.get('progress')), acceptance: d.get('acceptance'), evidence: d.get('evidence'), dependencies: d.getAll('dependencies'), projectId }; if (data.state === 'done' && !data.evidence.trim())
        throw Error('请记录完成证据，避免只修改状态。'); return x ? api.call('resource/update', { id, baseRevision: x.revision, patch: data }) : api.call('resource/create', { kind: 'task', data }); } }); }
function chooseResources({ title, rows, submit, multiple = false, label = '选择资源' }) { modal(title, `<div class="field"><label>${label}</label>${multiple ? `<div class="checkbox-list">${rows.map(x => `<label class="checkbox-item"><input type="checkbox" name="ids" value="${x.id}"><span>${esc(x.title)} <small class="muted">${esc(x.kind)}</small></span></label>`).join('')}</div>` : `<select name="id" required><option value="">请选择…</option>${rows.map(x => `<option value="${x.id}">${esc(x.title)}</option>`).join('')}</select>`}</div>`, { submit: d => submit(multiple ? d.getAll('ids') : d.get('id')) }); }
function viewTemplate(kind, p) { if (kind === 'tasks')
    return [{ id: 'tasks', type: 'tasks', dataSource: { kind: 'query', query: { kind: 'task', projectId: p } } }]; if (kind === 'table')
    return [{ id: 'knowledge', type: 'table', props: { columns: [{ key: 'title', label: '资料' }, { key: 'category', label: '类型' }] }, dataSource: { kind: 'query', query: { kind: 'object', projectId: p } } }]; return [{ id: 'overview', type: 'markdown', props: { text: '## 项目视图\n把信息组织成能继续操作的界面。' } }, { id: 'materials', type: 'cards', dataSource: { kind: 'query', query: { kind: 'object', projectId: p } } }]; }
function openView(id, projectId) { const v = id ? get(id) : null; projectId = projectId ?? app.lastProject ?? all('project')[0]?.id; modal(v ? '编辑视图结构' : '创建项目视图', field('视图标题', 'title', v?.title ?? '', 'text', 'required') + (!v ? select('所属项目', 'projectId', all('project').map(p => [p.id, p.title]), projectId) : '') + (!v ? `<div class="row">${btn('view-preset', '任务看板', { id: 'tasks', cls: 'small', extra: 'type="button"' })}${btn('view-preset', '资料表格', { id: 'table', cls: 'small', extra: 'type="button"' })}${btn('view-preset', '组合视图', { id: 'mixed', cls: 'small', extra: 'type="button"' })}</div>` : '') + area('ViewSpec.blocks · JSON', 'blocks', JSON.stringify(v?.blocks ?? viewTemplate('mixed', projectId), null, 2), 18, 'class="code-editor" required') + '<p class="small muted">数据绑定支持 query / resource / inline。每个模块必须有稳定 id。内置组件：markdown、metric、table、cards、chart、tasks、timeline、relations。</p>', { wide: true, submit: async (d) => { const blocks = JSON.parse(d.get('blocks')); if (v)
        return api.call('view/patch', { id: v.id, baseRevision: v.revision, operations: [...v.blocks.map(b => ({ op: 'removeBlock', id: b.id })), ...blocks.map(b => ({ op: 'addBlock', block: b })), { op: 'setTitle', value: d.get('title') }] }); const pid = d.get('projectId'); const created = await api.call('resource/create', { kind: 'view', data: { title: d.get('title'), blocks, mode: 'live' }, options: { projectId: pid } }); await api.call('view/mount', { projectId: pid, viewId: created.id }); location.hash = '#view/' + created.id + '/' + pid; } }); }
function defaultProps(schema) { const v = {}; for (const [k, s] of Object.entries(schema.properties ?? {})) {
    if (s.default !== undefined)
        v[k] = s.default;
    else if (k === 'rows')
        v[k] = [{ label: '曝光', value: 3200 }, { label: '试用', value: 412 }, { label: '付费', value: 23 }];
    else if (s.type === 'string')
        v[k] = s.title ?? k;
    else if (s.type === 'number' || s.type === 'integer')
        v[k] = 0;
    else if (s.type === 'boolean')
        v[k] = false;
    else if (s.type === 'array')
        v[k] = [];
    else if (s.type === 'object')
        v[k] = {};
} return v; }
function newWidget(versionOf) { const w = versionOf ? app.widgetList.find(w => w.key === versionOf) : null; const manifest = w ? { ...w.manifest, version: w.version.replace(/\d+$/, n => +n + 1) } : { id: 'custom.' + Date.now().toString(36), version: '1.0.0', name: '新的视图组件', description: '说明这个组件适合表达什么', entry: 'index.tsx', propsSchema: { type: 'object', properties: { title: { type: 'string' } }, additionalProperties: false }, capabilities: ['selection', 'context', 'resize'] }; const source = w?.source ?? `export default function mount(root, props, sdk) {\n  root.append(h('h3', {}, props.title || '项目资料'));\n  for (const row of (Array.isArray(sdk.data) ? sdk.data : [])) {\n    root.append(h('button', {onclick: () => sdk.select({resourceIds: [row.id], excerpt: row.title})}, row.title));\n  }\n  return () => root.replaceChildren();\n}`; modal(w ? '新建不可变版本' : '新建代码插件', area('Manifest', 'manifest', JSON.stringify(manifest, null, 2), 10, 'class="code-editor"') + area('源码 · JS / TS / TSX', 'source', source, 12, 'class="code-editor"'), { wide: true, submit: async (d) => { const saved = await api.call('widget', { manifest: JSON.parse(d.get('manifest')), source: d.get('source') }); location.hash = '#plugins/' + encodeURIComponent(saved.key); } }); }
async function saveWidget() { const w = app.currentWidget; const text = qs('#widget-editor').value; const change = app.pluginTab === 'source' ? { source: text } : app.pluginTab === 'schema' ? { manifest: { ...w.manifest, propsSchema: JSON.parse(text) } } : { manifest: JSON.parse(text) }; await api.call('widget/edit', { key: w.key, ...change }); app.pluginDirty = false; await refresh(); }
function previewCurrentWidget() { const w = app.currentWidget, host = qs('#plugin-preview'); if (!w?.compiled || !host)
    return; let recorded = false; sandbox(host, { widget: w, props: app.previewProps ?? defaultProps(w.manifest.propsSchema), data: app.previewData ?? [], context: { preview: true }, onReady: async () => { if (!w.previewOK && !recorded && w.state !== 'registered') {
        recorded = true;
        try {
            await api.call('widget/preview', { key: w.key, ok: true });
            w.previewOK = true;
            const b = qs('[data-action=register-widget]');
            if (b)
                b.disabled = false;
            toast('沙箱挂载成功，可以确认注册');
        }
        catch (e) {
            toast(e.message, true);
        }
    } }, onError: async (message) => { toast('插件预览：' + message, true); if (!recorded && w.state !== 'registered') {
        recorded = true;
        await api.call('widget/preview', { key: w.key, ok: false, error: message }).catch(() => { });
    } }, onSelect: selection => { toast('收到选择：' + (selection.excerpt ?? selection.key ?? '')); app.lastPreviewSelection = selection; } }); }
async function wireView() { const data = app.currentView; if (!data)
    return; await wireBlocks(qs('#view-blocks'), { ...data, onSelect: async (selection) => { try {
        const confirmed = await api.call('view/selection', selection);
        app.selection = { ...confirmed, label: selection.excerpt ?? data.view.title };
        app.chatHidden = false;
        await renderChatOnly();
    }
    catch (e) {
        toast(e.message, true);
    } }, onTask: id => openTask(id), onMove: app.viewLayout === 'canvas' ? async (id, layout) => { try {
        const updated = await api.call('view/patch', { id: data.view.id, baseRevision: app.currentView.view.revision, operations: [{ op: 'updateBlock', id, patch: { layout } }] });
        app.currentView.view = updated;
    }
    catch (e) {
        toast(e.message, true);
        await refresh();
    } } : null }); }
function wireKanban() { for (const card of qsa('[data-task-drag]'))
    card.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', card.dataset.taskDrag); }); for (const col of qsa('[data-column]')) {
    col.addEventListener('dragover', e => e.preventDefault());
    col.addEventListener('drop', async (e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain'), t = get(id); if (!t || t.kind !== 'task')
        return; if (col.dataset.column === 'done') {
        await openTask(id);
        const sel = qs('[name=state]');
        if (sel)
            sel.value = 'done';
        return;
    } try {
        await api.call('resource/update', { id, baseRevision: t.revision, patch: { state: col.dataset.column } });
        await refresh();
    }
    catch (e) {
        toast(e.message, true);
    } });
} }
async function openRun(id) { const data = await api.call('run?id=' + id), run = data.run; if (!run)
    throw Error('运行不存在'); modal('执行记录 · ' + id.slice(0, 18), `<div class="row between">${badge(run.state)}<span class="mono muted">Turn ${run.turn} · Step ${run.step}</span></div><div class="divider"></div><p class="small secondary">${esc(get(run.bot_id)?.title ?? run.bot_id)} · ${date(run.started_at)}</p>${run.error ? `<p class="form-error section-gap">${esc(run.error)}</p>` : ''}${data.tools.map(t => `<details class="card section-gap"><summary><span class="mono">${esc(t.name)}</span> ${badge(t.state)}</summary><h4 class="section-gap">参数</h4><pre class="build-log">${esc(t.args)}</pre><h4>结果</h4><pre class="build-log">${esc(t.result ?? '未确认')}</pre></details>`).join('')}<div class="markdown section-gap">${md(run.result ?? '')}</div><div class="form-actions">${['failed', 'blocked', 'interrupted', 'canceled', 'truncated'].includes(run.state) ? btn('retry-run', '检查后继续', { id, cls: 'primary' }) : ''}${run.state === 'running' ? btn('cancel-current', '停止', { id, cls: 'danger' }) : ''}</div>`, { wide: true }); }
async function renderTeam() { const members = await api.call('bots?projectId=' + app.team); app.teamMembers = members; const b = members.find(x => x.id === app.teamBot) ?? members[0]; app.teamBot = b?.id; let host = qs('#team-host'); if (!host) {
    host = document.createElement('div');
    host.id = 'team-host';
    document.body.append(host);
} host.innerHTML = `<div class="drawer-shade" data-action="close-team"></div><aside class="team-drawer" aria-label="执行团队"><div class="team-header"><h2>执行团队</h2>${btn('new-bot', '＋ 添加 Bot', { id: app.team, cls: 'small' })}${btn('close-team', '×', { cls: 'icon-btn' })}</div><div class="team-body"><div class="team-roster">${members.map(m => `<div class="team-member ${m.id === b?.id ? 'active' : ''}" data-action="team-bot" data-id="${m.id}">${botIcon(m, true)}<div class="grow">${esc(m.title)}<small>${m.id === get(app.team)?.leadBotId ? '项目负责人 · ' : ''}${statusText[m.runtimeState] ?? m.runtimeState}</small></div></div>`).join('')}</div><div class="team-detail">${b ? `<div class="row">${botIcon(b, true)}<div class="grow"><h3>${esc(b.title)}</h3><span class="small muted">${esc(b.role)}</span></div>${btn('stop-bot', '停止', { id: b.id, cls: 'small danger' })}</div><label>运行模型</label><p class="mono">${esc(b.model || app.data.providers.chat.model || '未配置')}</p><label>工具</label><div class="tagline">${b.tools.map(x => `<span class="pill mono">${esc(x)}</span>`).join('')}</div><label>指令与经验</label><p class="small secondary">${esc(b.instructions || '未设置专属指令')}</p><label>知识引用 / Skills</label><div class="small secondary">${b.skills.length ? b.skills.map(x => esc(x)).join('<br>') : '按需通过检索与 URI 读取项目知识'}</div><div class="row section-gap">${btn('edit-bot', '配置 Bot', { id: b.id, cls: 'small' })}${btn('bot-memory','记忆',{id:b.id,cls:'small'})}</div><div class="divider section-gap"></div><h4>收件箱</h4>${b.inbox.map(m => `<div class="card section-gap small"><span class="mono muted">${esc(m.target)}</span><p>${esc(m.message.content.slice(0, 180))}</p></div>`).join('') || '<p class="small muted section-gap">没有待处理消息</p>'}<div class="divider section-gap"></div><h4>最近运行</h4>${b.runs.slice(0, 5).map(run => `<div class="list-line"><span class="grow small">${badge(run.state)} · Step ${run.step}</span>${btn('run', '查看', { id: run.id, cls: 'small ghost' })}</div>`).join('') || '<p class="small muted section-gap">还没有运行记录</p>'}<p class="small muted" style="margin-top:24px">此 Bot 可被多个项目复用；每个项目保持独立 Session。资料与产物属于项目，不属于 Bot。</p>` : ''}</div></div></aside>`; }
function openBot(id, projectId) { const b = id ? get(id) : null; modal(b ? '配置 Bot' : '添加执行 Bot', field('名称', 'title', b?.title ?? '', 'text', 'required') + select('角色', 'role', [['research', '调研'], ['analyst', '分析'], ['maker', '制作'], ['reviewer', '审查'], ['worker', '通用执行'], ['lead', '负责人']], b?.role ?? 'worker') + field('模型（留空使用默认模型）', 'model', b?.model ?? '') + area('专属指令', 'instructions', b?.instructions ?? '', 5) + field('工具范围（逗号分隔）', 'tools', b?.tools.join(', ') ?? 'knowledge.*, collection.*, resource.*, task.*, view.*, widget.*, bot.*, project.get, web.fetch, file.read, file.write') + area('参考知识 / Skills URI（每行一条）', 'skills', b?.skills.join('\n') ?? '', 3), { wide: true, submit: async (d) => { const data = { title: d.get('title'), role: d.get('role'), model: d.get('model'), instructions: d.get('instructions'), tools: d.get('tools').split(/[,，]/).map(x => x.trim()).filter(Boolean), skills: d.get('skills').split('\n').map(x => x.trim()).filter(Boolean) }; if (b)
        return api.call('resource/update', { id, baseRevision: b.revision, patch: data }); return api.call('bot/create', { data, projectId }); } }); }
async function saveProviders(form) { const d = new FormData(form), patch = { allowNetwork: d.has('allowNetwork'), allowShell: d.has('allowShell') }; for (const group of ['chat', 'embedding']) {
    patch[group] = {};
    for (const [key, value] of d) {
        if (!key.startsWith(group + '.'))
            continue;
        const name = key.slice(group.length + 1);
        if (name === 'apiKey' && !value.trim())
            continue;
        patch[group][name] = ['contextWindow', 'maxTokens', 'timeoutMs'].includes(name) ? Number(value) : value;
    }
    patch[group].allowAnonymous = d.has(group + '.allowAnonymous');
} await api.call('providers', patch); app.data = await api.boot(); return patch; }
function wireForms() {
    const search = qs('#search-form');
    search?.addEventListener('submit', async (e) => { e.preventDefault(); const d = new FormData(search), q = d.get('query').trim(); if (q.startsWith('lede://')) {
        try {
            parseURI(q);
            location.hash = resourceRoute(q);
        }
        catch (err) {
            toast(err.message, true);
        }
        return;
    } app.search = q; app.searchScope = d.get('scope'); await render(); });
    const form = qs('#chat-form'), input = form?.elements.message;
    input?.addEventListener('input', () => { app.drafts[app.chatProject] = input.value; });
    input?.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        form.requestSubmit();
    } });
    form?.addEventListener('submit', async (e) => { e.preventDefault(); const content = input.value.trim(), pid = app.chatProject; if (!content)
        return; const button = form.querySelector('button[type=submit]'); button.disabled = true; try {
        await api.call('chat', { projectId: pid, content, selection: app.selection, requestId: crypto.randomUUID() });
        app.drafts[pid] = '';
        app.selection = null;
        await refresh();
    }
    catch (err) {
        toast(err.message, true);
    }
    finally {
        button.disabled = false;
    } });
    const providers = qs('#provider-form');
    providers?.addEventListener('submit', async (e) => { e.preventDefault(); try {
        await saveProviders(providers);
        toast('设置已保存');
        await render();
    }
    catch (err) {
        qs('.form-error', providers).textContent = err.message;
    } });
    qs('#widget-editor')?.addEventListener('input', () => { app.pluginDirty = true; });
    qs('#version-select')?.addEventListener('change', e => { const x = app.currentObject; location.hash = resourceRoute(uri(x.kind, x.id, { rev: Number(e.target.value) })); });
}
function confirmDialog(title, description, work) { modal(title, `<p class="secondary">${esc(description)}</p><div style="height:16px"></div>`, { submit: work }); const b = qs('#dialog-form button[type=submit]'); if (b)
    b.textContent = '确认'; }
async function attachResource(id, blockId) { const x = get(id), ref = uri(x.kind, x.id, { rev: x.revision, anchor: blockId }); app.selection = { uri: ref, resourceIds: [id], label: x.title + (blockId ? ' · 选中片段' : ''), excerpt: blockId ? x.blocks.find(b => b.id === blockId)?.text.slice(0, 1200) : x.title }; app.objectChat = true; app.chatHidden = false; if (!app.lastProject)
    app.global = true; await renderChatOnly(); }
async function mountWidget(key) { const w = await api.call('widget?key=' + encodeURIComponent(key)); modal('挂载 ' + w.manifest.name, select('目标项目', 'projectId', all('project').map(p => [p.id, p.title]), app.lastProject ?? all('project')[0]?.id) + field('视图标题', 'title', w.manifest.name, 'text', 'required') + area('组件参数 · props', 'props', JSON.stringify(defaultProps(w.manifest.propsSchema), null, 2), 8, 'class="mono"') + area('数据绑定（默认项目知识查询，可修改）', 'dataSource', JSON.stringify({ kind: 'query', query: { kind: 'object', projectId: app.lastProject ?? all('project')[0]?.id } }, null, 2), 5, 'class="mono"'), { wide: true, submit: async (d) => { const pid = d.get('projectId'), dataSource = JSON.parse(d.get('dataSource')); if (dataSource.kind === 'query')
        dataSource.query.projectId = pid; const v = await api.call('resource/create', { kind: 'view', data: { title: d.get('title'), mode: 'live', blocks: [{ id: 'widget_' + crypto.randomUUID().slice(0, 8), type: 'widget:' + key, title: d.get('title'), props: JSON.parse(d.get('props')), dataSource }] }, options: { projectId: pid } }); await api.call('view/mount', { projectId: pid, viewId: v.id, pinned: true }); location.hash = '#view/' + v.id + '/' + pid; } }); }
function importFile() { modal('导入资料', '<div class="field"><label>Markdown、文本、JSON、CSV、HTML</label><input type="file" name="files" multiple accept=".md,.txt,.json,.csv,.html,.htm" required></div>' + select('关联项目（可选）', 'projectId', [['', '仅进入知识库'], ...all('project').map(p => [p.id, p.title])], app.lastProject ?? '') + '<p class="small muted">每份文件保存为独立知识对象。HTML 仅提取可读文本，不执行脚本。PDF / 视频等二进制解析尚未集成。</p>', { submit: async (d) => { const files = d.getAll('files'), pid = d.get('projectId'); for (const file of files) {
        if (file.size > 2000000)
            throw Error(file.name + ' 超过 2MB 文本导入限制');
        let content = await file.text();
        if (/\.html?$/i.test(file.name)) {
            const doc = new DOMParser().parseFromString(content, 'text/html');
            doc.querySelectorAll('script,style,iframe,object').forEach(x => x.remove());
            content = doc.body.textContent;
        }
        await api.call('resource/create', { kind: 'object', data: { title: file.name.replace(/\.[^.]+$/, ''), content, category: 'material', source: { label: file.name, type: 'file' } }, options: pid ? { projectId: pid } : {} });
    } toast('已导入 ' + files.length + ' 份资料'); } }); }
async function dispatch(action, id, el) {
    switch (action) {
        case 'project-memory': return openMemory('project',id);
        case 'workspace-memory': return openMemory('workspace','global');
        case 'bot-memory': return openMemory('bot',id);
        case 'memory-add': return editMemory();
        case 'memory-edit': return editMemory(id);
        case 'memory-delete': { const m=app.memoryPanel.entries.find(x=>x.id===id); await api.call('memory',{...m,baseRevision:m.revision,deleted:true}); return openMemory(m.scope,m.owner); }
        case 'memory-history': { const rows=await api.call('memory/history?id='+id);return modal('记忆历史',`<div class="continuity-panel">${rows.map(x=>`<div class="card section-gap"><p>${esc(x.data.text)}</p><small>${esc(x.actor)} · v${x.revision} · ${x.data.deleted?'已遗忘':'已保存'}</small></div>`).join('')}</div>`); }
        case 'project-goal': return openGoal(id);
        case 'goal-add-stage': { const host=qs('#goal-stages'),count=host.children.length;if(count<20)host.insertAdjacentHTML('beforeend',goalStageFields(count,app.goalTasks));return; }
        case 'goal-edit': return editGoal(id);
        case 'goal-create': return createGoal(id);
        case 'goal-control': { const {projectId,goal}=app.goalPanel;await api.call('project/goal',{request_id:crypto.randomUUID(),projectId,baseRevision:goal.revision,action:id,reason:id==='stop'?'用户停止目标':undefined});return openGoal(projectId); }
        case 'project-handoff': return openHandoff(id);
        case 'new-project': return openNewProject();
        case 'edit-project': return openEditProject(id);
        case 'new-knowledge': return openKnowledge(null, id || undefined);
        case 'edit-knowledge': return openKnowledge(id);
        case 'new-collection': return openCollection();
        case 'edit-collection': return openCollection(id);
        case 'collection-add': return chooseResources({ title: '添加资料到集合', rows: app.data.resources.filter(x => ['object', 'collection'].includes(x.kind) && x.id !== id && !app.currentCollection.members.some(y => y.id === x.id)), multiple: true, submit: async (ids) => { for (const rid of ids)
                await api.call('collection/member', { collectionId: id, resourceId: rid }); } });
        case 'collection-remove':
            await api.call('collection/member', { collectionId: app.currentCollection.collection.id, resourceId: id, remove: true });
            return refresh();
        case 'new-task': return openTask(null, id || app.lastProject);
        case 'task': return openTask(id);
        case 'global':
            app.global = !app.global;
            app.chatHidden = false;
            return render();
        case 'close-global':
            app.global = false;
            return render();
        case 'toggle-chat':
            app.global = false;
            app.chatHidden = !app.chatHidden;
            return render();
        case 'team':
            app.team = id;
            return renderTeam();
        case 'team-bot':
            app.teamBot = id;
            return renderTeam();
        case 'close-team':
            app.team = null;
            qs('#team-host')?.remove();
            return;
        case 'new-bot': return openBot(null, id);
        case 'edit-bot': return openBot(id);
        case 'stop-bot':
            await api.call('bot/stop', { botId: id, projectId: app.team });
            toast('停止请求已发送');
            return refresh();
        case 'copy-uri':
            await navigator.clipboard.writeText(id);
            return toast('已复制稳定引用');
        case 'accept-decision': {
            const r = get(id);
            return confirmDialog('确认这个决策？', r.title, () => api.call('resource/update', { id, baseRevision: r.revision, patch: { decisionState: 'accepted' } }));
        }
        case 'project-reference': return chooseResources({ title: '关联项目参考资料', rows: app.data.resources.filter(x => ['object', 'collection', 'view'].includes(x.kind)), multiple: true, submit: async (ids) => { for (const rid of ids)
                await api.call('project/link', { projectId: id, resourceId: rid, role: 'reference' }); } });
        case 'add-to-collection': return chooseResources({ title: '加入集合', rows: all('collection').filter(c => c.mode === 'static'), submit: collectionId => api.call('collection/member', { collectionId, resourceId: id }) });
        case 'new-relation': return modal('建立知识关联', select('关联对象', 'target', app.data.resources.filter(x => ['object', 'collection', 'task', 'view'].includes(x.kind) && x.id !== id).map(x => [x.id, x.title])) + select('关系类型', 'type', ['references', 'supports', 'contradicts', 'derived_from', 'related_to'].map(x => [x, x]), 'references'), { submit: d => api.call('relation', { source: id, target: d.get('target'), type: d.get('type') }) });
        case 'select-block': return attachResource(app.currentObject.id, id);
        case 'attach-object': return attachResource(id);
        case 'clear-selection':
            app.selection = null;
            return renderChatOnly();
        case 'archive':
            await api.call('resource/status', { id, status: get(id).status === 'archived' ? 'active' : 'archived' });
            return refresh();
        case 'delete-resource': return confirmDialog('永久删除知识', '删除对象、历史版本、索引与直接关联；其他结论和执行日志中的既有副本不会被改写。此操作不可撤销。', async () => { await api.call('resource/delete', { id }); location.hash = '#knowledge'; });
        case 'filter':
            app.filter = id;
            return render();
        case 'import': return importFile();
        case 'new-view': return openView(null, id || app.lastProject);
        case 'view-edit': return openView(id);
        case 'view-preset': {
            const form = qs('#dialog-form');
            form.elements.blocks.value = JSON.stringify(viewTemplate(id, form.elements.projectId.value), null, 2);
            return;
        }
        case 'view-unmount': return confirmDialog('移除项目挂载', '视图、插件和原始知识都会保留，仅从当前项目标签和固定入口移除。', async () => { await api.call('view/unmount', { id }); location.hash = projectHref(app.lastProject); });
        case 'view-pin': return chooseResources({ title: '挂载并固定视图', rows: all('project'), submit: projectId => api.call('view/mount', { projectId, viewId: id, pinned: true }) });
        case 'view-snapshot': {
            const v = app.currentView.view;
            if (v.mode === 'snapshot')
                await api.call('view/patch', { id, baseRevision: v.revision, operations: [{ op: 'setMode', value: 'live' }] });
            else
                await api.call('view/snapshot', { id });
            return refresh();
        }
        case 'layout-grid':
            app.viewLayout = 'grid';
            return render();
        case 'layout-canvas':
            app.viewLayout = 'canvas';
            return render();
        case 'select-view-block': {
            const selected = await api.call('view/selection', { viewId: app.currentView.view.id, blockId: id, resourceIds: [], excerpt: app.currentView.blocks.find(b => b.id === id)?.title ?? id });
            app.selection = { ...selected, label: selected.excerpt ?? id };
            app.chatHidden = false;
            return renderChatOnly();
        }
        case 'new-widget': return newWidget();
        case 'widget-version': return newWidget(id);
        case 'plugin-tab':
            if (app.pluginDirty) {
                await saveWidget();
            }
            app.pluginTab = id;
            return render();
        case 'save-widget':
            await saveWidget();
            return toast('插件草稿已保存');
        case 'build-widget':
            if (app.pluginDirty)
                await saveWidget();
            await api.call('widget/build', { key: id });
            await refresh();
            return toast('编译校验完成，开始沙箱预览');
        case 'preview-widget': return previewCurrentWidget();
        case 'widget-props': return modal('调整沙箱预览', area('props', 'props', JSON.stringify(app.previewProps ?? defaultProps(app.currentWidget.manifest.propsSchema), null, 2), 8, 'class="mono"') + area('sdk.data', 'data', JSON.stringify(app.previewData ?? [], null, 2), 8, 'class="mono"'), { wide: true, submit: async (d) => { app.previewProps = JSON.parse(d.get('props')); app.previewData = JSON.parse(d.get('data')); } });
        case 'register-widget': return confirmDialog('注册这个组件版本', '已完成本地编译与沙箱挂载。注册后此版本不可变，项目可引用它；代码仍在隔离 iframe 内运行。', () => api.call('widget/register', { key: id }));
        case 'mount-widget': return mountWidget(id);
        case 'disable-widget': return confirmDialog('停用这个版本', '已有视图会显示组件不可用；定义和版本仍保留。', () => api.call('widget/disable', { key: id }));
        case 'run': return openRun(id);
        case 'retry-run':
            await api.call('run/retry', { id });
            closeModal();
            toast('已安排继续，未确认的外部副作用不会自动重放');
            return refresh();
        case 'cancel-current':
            await api.call('run/cancel', { id });
            closeModal();
            return refresh();
        case 'abandon-work':
            await api.call('work/abandon', { id });
            return refresh();
        case 'confirm-yes':
            await api.call('confirm', { id, accepted: true });
            return refresh();
        case 'confirm-no': return modal('调整负责人的理解', area('需要修改的地方', 'note', '', 5, 'required'), { submit: d => api.call('confirm', { id, accepted: false, note: d.get('note') }) });
        case 'export':
            download('lede-workspace-' + new Date().toISOString().slice(0, 10) + '.json', await api.call('export', {}));
            return toast('已导出业务数据与插件定义（不含密钥和执行日志）');
        case 'reindex': {
            const job = await api.call('reindex', {});
            toast('向量索引作业已创建：' + job.id.slice(0, 12));
            return;
        }
        case 'summary': {
            await api.call('summary', { id });
            return toast('摘要作业已创建，可在设置页查看结果');
        }
        case 'test-provider':
            await saveProviders(qs('#provider-form'));
            await api.call('providers/test', {});
            toast('模型连接与响应测试通过');
            return refresh();
        case 'close-modal': return closeModal();
    }
}
document.addEventListener('click', async (e) => { const el = e.target.closest('[data-action]'); if (!el)
    return; e.preventDefault(); if (el.disabled || el.dataset.busy === 'true')
    return; el.dataset.busy = 'true'; try {
    await dispatch(el.dataset.action, el.dataset.id, el);
}
catch (err) {
    toast(err.message, true);
}
finally {
    delete el.dataset.busy;
} });
document.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
    e.preventDefault();
    app.global = !app.global;
    app.chatHidden = false;
    render();
} if (e.key === 'Escape') {
    if (qs('.modal'))
        closeModal();
    else if (app.team) {
        app.team = null;
        qs('#team-host')?.remove();
    }
    else if (app.global) {
        app.global = false;
        render();
    }
} if (e.key === 'Enter' && e.target.matches('.document-block'))
    e.target.click(); });
window.addEventListener('hashchange', () => { app.filter = 'all'; app.pluginDirty = false; app.currentView = null; app.objectChat = false; app.previewProps = null; app.previewData = null; render(); });
let pendingRefresh, stream;
function connectEvents() { stream?.close(); stream = new EventSource('/api/events?token=' + encodeURIComponent(api.token)); stream.onmessage = e => { let event; try {
    event = JSON.parse(e.data);
}
catch {
    return;
} if (event.topic === 'agent.delta') {
    const sid = event.data.sessionId;
    const text = (app.streams.get(sid) ?? '') + (event.data.delta?.text ?? event.data.text ?? '');
    app.streams.set(sid, text);
    if (app.chatData?.session.id === sid) {
        const node = qs('#stream-content');
        if (node)
            node.textContent = text;
        qs('#chat-feed')?.scrollTo(0, 1000000);
    }
    return;
} if (event.topic === 'run.ended')
    app.streams.clear(); if (['widget.preview', 'agent.event', 'agent.inbox', 'agent.stream'].includes(event.topic) || event.topic === 'job.progress')
    return; clearTimeout(pendingRefresh); pendingRefresh = setTimeout(() => { if (app.pluginDirty || qs('dialog[open]') || (app.route.type === 'usage' && document.activeElement?.matches('input,select')) || qs('.modal') || qs('#chat-form textarea') === document.activeElement) {
    refresh(false).catch(() => { });
    return;
} refresh().catch(err => toast(err.message, true)); }, 220); }; }
(async () => { try {
    app.data = await api.boot();
    await render();
    connectEvents();
}
catch (err) {
    qs('#app').innerHTML = '<main class="main"><h1>无法连接本地服务</h1><p>' + esc(err.message) + '</p><p>请运行 START.command 或 npm start。</p></main>';
} })();
async function renderChatOnly() { const pid = app.global ? 'global' : (app.route.type === 'project' ? app.route.id : app.lastProject); if (!pid) {
    app.global = true;
    return renderChatOnly();
} const html = await chatHTML(pid); const old = qs('.chat-panel'); if (old)
    old.outerHTML = html;
else {
    if (app.route.type === 'resource')
        qs('.inspector')?.remove();
    qs('.main-wrap').insertAdjacentHTML('beforeend', html);
} wireForms(); qs('#chat-feed')?.scrollTo(0, 1000000); }
window.addEventListener('beforeunload', e => { if (app.pluginDirty) {
    e.preventDefault();
    e.returnValue = '';
} });
