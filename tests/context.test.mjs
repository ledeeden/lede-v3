import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, settled, call } from './helpers.mjs';
import { modelFixture } from './fixtures/model-server.mjs';
import { createProject } from '../server/tools.mjs';
test('Large tool outputs spill durably, remain URI-readable and do not inflate model history', async (t) => {
    const peer = await modelFixture(t, { respond: body => body.messages.some(m => m.role === 'tool')
            ? { content: '读到了有界预览及完整输出 URI。' } : { tools: [{ name: 'project__get', args: {} }] } });
    const a = await fixture(t, { providerConfig: peer.config });
    const p = createProject(a.r, { title: '大输出', goal: '可读的长内容。'.repeat(18000) });
    await a.coordinator.userMessage({ projectId: p.id, content: '读取项目' });
    await settled(a);
    const row = a.s.get('SELECT * FROM tool_calls');
    const preview = JSON.parse(row.result);
    assert.equal(preview.truncated, true);
    assert.ok(preview.text.length <= 24000);
    let text = '', offset = 0;
    do {
        const page = a.r.read(preview.uri, { maxChars: 8000, offset });
        text += page.text;
        offset = page.nextOffset;
    } while (offset !== null);
    assert.ok(text.includes(p.goal));
    assert.equal(text, a.s.get('SELECT body FROM tool_outputs WHERE call_key=?', row.id).body);
    assert.ok(a.kernel.history(a.s.get('SELECT id FROM sessions WHERE bot_id=?', p.leadBotId).id).some(m => m.role === 'tool' && m.content.includes(preview.uri)));
});
test('Context compaction uses complete step boundaries inside a running turn and keeps recent user wording', async (t) => {
    const peer = await modelFixture(t, { respond: () => ({ content: '压缩摘要：保留目标、结果 URI 和未完成事项。' }) });
    const a = await fixture(t, { providerConfig: { ...peer.config, chat: { ...peer.config.chat, contextWindow: 8192, maxTokens: 1024 } } });
    const p = createProject(a.r, { title: '长会话' }), bot = a.r.get(p.leadBotId), ss = a.coordinator.session(bot.id, p.id);
    a.s.sessionEvent(ss.id, 'user/message', { content: '原话必须保留：不发广告。', source: { kind: 'user' } }, 1, 0);
    for (let step = 1; step <= 5; step++) {
        a.s.sessionEvent(ss.id, 'step/start', {}, 1, step);
        a.s.sessionEvent(ss.id, 'assistant/message', { message: { role: 'assistant', content: '', tool_calls: [{ id: 'call_' + step, type: 'function', function: { name: 'resource__read', arguments: '{}' } }] } }, 1, step);
        a.s.sessionEvent(ss.id, 'tool/result', { callId: 'call_' + step, result: { text: '测试上下文'.repeat(2000) } }, 1, step);
        a.s.sessionEvent(ss.id, 'step/end', {}, 1, step);
    }
    await a.kernel.compact(ss, bot, new AbortController().signal);
    const history = a.kernel.history(ss.id), checkpoint = a.s.get('SELECT * FROM sessions WHERE id=?', ss.id);
    assert.ok(checkpoint.checkpoint_seq > 0);
    assert.ok(checkpoint.checkpoint.includes('原话必须保留：不发广告。'));
    assert.equal(history.filter(m => m.role === 'assistant').length, 2);
    const callIds = history.filter(m => m.role === 'assistant').flatMap(m => m.tool_calls.map(c => c.id));
    assert.deepEqual(history.filter(m => m.role === 'tool').map(m => m.tool_call_id), callIds);
    assert.equal(peer.calls.length, 1);
});
test('Widget interaction state is capability gated, durable and independent of view revisions', async (t) => {
    const a = await fixture(t), p = a.plugins;
    const manifest = { id: 'state.test', version: '1.0.0', name: '交互状态', entry: 'index.js', propsSchema: { type: 'object' }, capabilities: ['state', 'selection'] };
    const w = p.create({ manifest, source: 'export default function mount(root, props, sdk){root.textContent=String(sdk.state.count||0);}' });
    p.build(w.key);
    p.preview(w.key, { ok: true });
    p.register(w.key);
    const v = p.viewCreate({ title: '持久交互', blocks: [{ id: 'counter', type: 'widget:' + w.key }] });
    const result = await call(a, 'view/state', { viewId: v.id, blockId: 'counter', data: { count: 4 } });
    assert.equal(result.status, 200);
    assert.deepEqual(p.data(v.id).blocks[0].localState, { count: 4 });
    assert.equal(a.r.get(v.id).revision, 1);
    assert.throws(() => p.state(v.id, 'counter', { text: 'a'.repeat(16001) }), /16 KB/);
    const plain = p.viewCreate({ title: '普通组件', blocks: [{ id: 'text', type: 'markdown', props: { text: 'x' } }] });
    assert.throws(() => p.state(plain.id, 'text', {}), /插件/);
});
test('Generic task updates cannot bypass evidence requirement', async (t) => {
    const a = await fixture(t), p = createProject(a.r, { title: '验证门槛' }), task = a.r.create('task', { title: '需要证据', projectId: p.id });
    const result = await call(a, 'resource/update', { id: task.id, baseRevision: 1, patch: { state: 'done' } });
    assert.equal(result.status, 400);
    assert.equal(a.r.get(task.id).state, 'queued');
});
test('A long document summary uses bounded source text instead of an empty prompt', async (t) => {
    const { summarize } = await import('../server/tools.mjs');
    const peer = await modelFixture(t, { respond: body => { const input = JSON.parse(body.messages[1].content); assert.equal(input.sources.length, 1); assert.ok(input.sources[0].text.startsWith('长文证据')); assert.equal(input.sources[0].partial, true); return { content: '# 概览\n\n材料的局部概述。\n\n## 结构\n需要回看完整原文。' }; } });
    const a = await fixture(t, { providerConfig: peer.config });
    const obj = a.r.create('object', { title: '长文', content: '长文证据'.repeat(15000) });
    const result = await summarize({ id: obj.id, r: a.r, providers: a.providers });
    assert.ok(result.summary.overview.includes('部分长文仅采样'));
});
