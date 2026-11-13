import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, waitFor, settled, call } from './helpers.mjs';
import { modelFixture } from './fixtures/model-server.mjs';
import { createProject, summarize } from '../server/tools.mjs';
const called = (body, name) => body.messages.some(m => m.role === 'assistant' && m.tool_calls?.some(t => t.function.name === name));
const replied = body => body.messages.some(m => m.role === 'user' && m.content.startsWith('[Bot ') && m.content.includes(' reply;'));
test('Real HTTP-driven A→B→C dispatch, wakeup and project deliverable loop', async (t) => {
    let project, worker, reviewer;
    const peer = await modelFixture(t, { respond: body => {
            const bot = body.messages[0].content.match(/botId=([^;]+);/)[1];
            if (bot === project.leadBotId) {
                if (!called(body, 'bot__message'))
                    return { tools: [{ name: 'bot__message', args: { toBotId: worker.id, message: '读取项目资料，形成报告，交给审查 Bot 核对。', request_id: 'research-one' } }] };
                if (!replied(body))
                    return { content: '已交给调研 Bot，等待最终证据。' };
                if (!called(body, 'view__register'))
                    return { tools: [{ name: 'view__register', args: { title: '协作产物视图', blocks: [{ id: 'reports', type: 'table', dataSource: { kind: 'query', query: { kind: 'object', projectId: project.id } } }], mount: true } }] };
                return { content: '负责人收到调研和审查结果，并挂载项目视图。' };
            }
            if (bot === worker.id) {
                if (!called(body, 'knowledge__search'))
                    return { tools: [{ name: 'knowledge__search', args: { query: '实验' } }] };
                if (!called(body, 'knowledge__create'))
                    return { tools: [{ name: 'knowledge__create', args: { title: '协作研究报告', content: '根据项目资料整理的测试报告，真实内容生成能力需接入模型验证。', category: 'report' } }] };
                if (!called(body, 'bot__message'))
                    return { tools: [{ name: 'bot__message', args: { toBotId: reviewer.id, message: '审查项目内研究报告的证据。', request_id: 'review-one' } }] };
                return { content: replied(body) ? '研究已完成并收到审查意见。' : '已提交审查，等待返回。' };
            }
            if (bot === reviewer.id) {
                if (!called(body, 'knowledge__search'))
                    return { tools: [{ name: 'knowledge__search', args: { query: '协作研究报告' } }] };
                return { content: '审查完成：测试报告已保存，并明确标记为测试资料。' };
            }
            throw Error('Unexpected bot ' + bot);
        } });
    const a = await fixture(t, { providerConfig: peer.config });
    project = createProject(a.r, { title: '真实协作执行' });
    worker = a.r.create('bot', { title: '研究', role: 'research' });
    reviewer = a.r.create('bot', { title: '审查', role: 'reviewer' });
    a.r.update(project.id, { memberBotIds: [project.leadBotId, worker.id, reviewer.id] }, { baseRevision: 1 });
    a.r.create('object', { title: '实验方法', content: '每个结论要有来源。' }, { projectId: project.id });
    await a.coordinator.userMessage({ projectId: project.id, content: '研究并生成视图' });
    await settled(a);
    const works = a.s.all('SELECT * FROM works');
    assert.equal(works.length, 3);
    assert.ok(works.every(w => w.state === 'consumed'), JSON.stringify(works));
    assert.equal(a.s.all('SELECT * FROM mounts').length, 1);
    assert.equal(a.r.list({ kind: 'object', projectId: project.id }).length, 2);
    assert.ok(a.s.all('SELECT * FROM runs').every(r => r.state === 'succeeded'));
    const root = works.find(w => w.sender === '@user');
    assert.ok(root.result.includes('审查完成'));
});
test('Global assistant routes to project lead without mixing project sessions', async (t) => { let project; const peer = await modelFixture(t, { respond: body => { const bot = body.messages[0].content.match(/botId=([^;]+);/)[1]; if (bot === 'bot_global') {
        if (!called(body, 'project__delegate'))
            return { tools: [{ name: 'project__delegate', args: { projectId: project.id, message: '核对这个项目的当前目标。', request_id: 'route-1' } }] };
        return { content: replied(body) ? '项目负责人已返回结果。' : '已交给项目负责人。' };
    } return { content: '已核对项目目标，所有产物保留在本项目。' }; } }); const a = await fixture(t, { providerConfig: peer.config }); project = createProject(a.r, { title: '跨项目入口' }); await a.coordinator.userMessage({ projectId: 'global', content: '请项目负责人核对目标' }); await settled(a); const works = a.s.all('SELECT * FROM works'); assert.ok(works.every(w => w.state === 'consumed'), JSON.stringify(works)); const sessions = a.s.all('SELECT * FROM sessions'); assert.ok(sessions.some(x => x.bot_id === 'bot_global' && x.project_id === 'global')); assert.ok(sessions.some(x => x.bot_id === project.leadBotId && x.project_id === project.id)); assert.ok(a.coordinator.chat('global').events.some(e => e.data.message?.content === '项目负责人已返回结果。')); });
test('Next-step steering is admitted after tools, without stealing unrelated queued work', async (t) => { let release, entered; const gate = new Promise(r => release = r); const peer = await modelFixture(t, { respond: async (body, n) => { if (n === 1) {
        entered = true;
        await gate;
        return { content: '第一次响应。' };
    } return { content: '已读取追加纠正。' }; } }); const a = await fixture(t, { providerConfig: peer.config }), p = createProject(a.r, { title: '插话' }); await a.coordinator.userMessage({ projectId: p.id, content: '最初任务' }); await waitFor(() => entered); await a.coordinator.userMessage({ projectId: p.id, content: '追加纠正', when: 'now' }); release(); await settled(a); const runs = a.s.all('SELECT * FROM runs'); assert.equal(runs.length, 1); assert.equal(runs[0].step, 2); assert.ok(peer.calls[1].body.messages.some(m => m.role === 'user' && m.content === '追加纠正')); });
test('Model-generated widget proposal/build is not auto-registered; user gate then mount', async (t) => {
    let project;
    const manifest = { id: 'agent.generated', version: '1.0.0', name: 'Agent 生成组件', entry: 'index.js', propsSchema: { type: 'object', properties: { title: { type: 'string' } }, additionalProperties: false }, capabilities: ['selection'] };
    const peer = await modelFixture(t, { respond: body => { if (!called(body, 'widget__propose'))
            return { tools: [{ name: 'widget__propose', args: { manifest, source: 'export default function mount(root, props, sdk) { root.append(h("p", {}, props.title)); }' } }] }; if (!called(body, 'widget__build'))
            return { tools: [{ name: 'widget__build', args: { key: 'agent.generated@1.0.0' } }] }; if (body.messages.some(m => m.role === 'user' && m.content === '组件已经预览并注册，请挂载。')) {
            if (!called(body, 'view__register'))
                return { tools: [{ name: 'view__register', args: { title: 'Agent 组件视图', blocks: [{ id: 'generated', type: 'widget:agent.generated@1.0.0', props: { title: '动态组件' } }], mount: true } }] };
            return { content: '已挂载。' };
        } return { content: '插件已构建，等待你在插件页预览并注册。' }; } });
    const a = await fixture(t, { providerConfig: peer.config });
    project = createProject(a.r, { title: '动态视图' });
    await a.coordinator.userMessage({ projectId: project.id, content: '生成代码插件' });
    await settled(a);
    assert.equal(a.plugins.get('agent.generated@1.0.0').state, 'built');
    assert.equal(a.s.all('SELECT * FROM mounts').length, 0);
    // Browser sandbox rendering is separately covered by ui.test.py; this tests host approval boundary.
    await call(a, 'widget/preview', { key: 'agent.generated@1.0.0', ok: true });
    await call(a, 'widget/register', { key: 'agent.generated@1.0.0' });
    await a.coordinator.userMessage({ projectId: project.id, content: '组件已经预览并注册，请挂载。' });
    await settled(a);
    assert.equal(a.s.all('SELECT * FROM mounts').length, 1);
    assert.ok(a.s.all('SELECT * FROM runs').every(r => r.state === 'succeeded'));
});
test('Collection L1 generation and L0 extraction use source signatures', async (t) => { const peer = await modelFixture(t, { respond: () => ({ content: '# 主题集合\n\n关于实验设计的简要概述。\n\n## 结构\n方法和案例。' }) }); const a = await fixture(t, { providerConfig: peer.config }); const x = a.r.create('object', { title: '实验', content: '一条测试方法。' }), c = a.r.create('collection', { title: '方法' }); a.r.member(c.id, x.id); const result = await summarize({ id: c.id, r: a.r, providers: a.providers }); assert.equal(result.summary.abstract, '关于实验设计的简要概述。'); assert.equal(result.summary.stale, false); assert.ok(result.summary.overview.includes('覆盖：1/1')); assert.equal(peer.calls.length, 1); });
test('Durable SSE event stream and reconnect replay carry persisted sequence IDs', async (t) => {
    const a = await fixture(t);
    const abort = new AbortController();
    const res = await fetch(a.origin + '/api/events?token=' + a.token, { signal: abort.signal });
    assert.equal(res.status, 200);
    const reader = res.body.getReader();
    await reader.read();
    const r = a.r.create('object', { title: '事件对象', content: '资料' });
    let text = '';
    await waitFor(async () => { const chunk = await reader.read(); text += new TextDecoder().decode(chunk.value); return text.includes(r.id); });
    assert.ok(text.includes('id: '));
    const seq = a.s.get("SELECT seq FROM events WHERE resource_id=? AND topic='resource.created'", r.id).seq;
    abort.abort();
    try {
        await reader.cancel();
    }
    catch { }
    const replayAbort = new AbortController();
    const replay = await fetch(a.origin + '/api/events?token=' + a.token + '&since=' + (seq - 1), { signal: replayAbort.signal });
    const replayReader = replay.body.getReader();
    const chunk = await replayReader.read();
    assert.ok(new TextDecoder().decode(chunk.value).includes(r.id));
    replayAbort.abort();
    try {
        await replayReader.cancel();
    }
    catch { }
});
