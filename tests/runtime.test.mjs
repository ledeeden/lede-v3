import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture, waitFor, settled } from './helpers.mjs';
import { modelFixture } from './fixtures/model-server.mjs';
import { DurableInbox, applyInboxSplice } from '../server/runtime/inbox.mjs';
import { RequestIdentity } from '../server/runtime/requests.mjs';
import { createProject } from '../server/tools.mjs';
import { Store } from '../server/db.mjs';
import { createApp } from '../server/index.mjs';
test('Extracted DSH inbox preserves splice normalization, uniqueness, claim and replay', async (t) => { const a = await fixture(t); const ss = a.coordinator.session('bot_global', 'global'); const inbox = new DurableInbox(a.s, ss.id); inbox.append('next-turn', { id: 'm1', content: 'one' }); inbox.append('next-turn', { id: 'm2', content: 'two' }); inbox.prepend('next-step', { id: 'm3', content: 'steer' }); assert.throws(() => inbox.append('next-step', { id: 'm1', content: 'dup' }), /Duplicate/); inbox.splice('next-turn', -1, 1, [{ id: 'm4', content: 'replace' }]); assert.deepEqual(inbox.claim('next-turn', 1).map(m => m.id), ['m3', 'm1']); let state = { 'next-turn': [], 'next-step': [] }; for (const event of a.s.sessionEvents(ss.id))
    state = applyInboxSplice(state, event); assert.deepEqual(state, inbox.state()); assert.equal(inbox.nextTurn[0].id, 'm4'); inbox.clear(); assert.equal(inbox.hasPending, false); });
test('DS-Bot request identities deduplicate races and fail closed across restart uncertainty', async (t) => { const a = await fixture(t); const r = new RequestIdentity(a.s); const key = r.identity({ caller: 'bot-a', context: 'project-a', name: 'task-one', payload: { body: 'same' } }); let calls = 0; const work = async () => { calls++; await new Promise(r => setTimeout(r, 20)); return { accepted: true }; }; const [one, two] = await Promise.all([r.admit(key, work), r.admit(key, work)]); assert.equal(calls, 1); assert.equal(one.status, 'sent'); assert.equal(two.status, 'replay'); const altered = r.identity({ caller: 'bot-a', context: 'project-a', name: 'task-one', payload: { body: 'different' } }); assert.equal((await r.admit(altered, work)).status, 'conflict'); const fail = r.identity({ caller: 'b', context: 'p', name: 'uncertain', payload: {} }); await assert.rejects(() => r.admit(fail, () => { throw Error('sent but disconnected'); })); const again = new RequestIdentity(a.s); assert.equal((await again.admit(fail, work)).status, 'uncertain'); assert.equal(calls, 1); });
test('Long-lived Bot identity maps to independent project sessions', async (t) => { const a = await fixture(t); const p = createProject(a.r, { title: 'P' }), q = createProject(a.r, { title: 'Q' }); const b = a.r.create('bot', { title: '共享执行者' }); a.r.update(p.id, { memberBotIds: [p.leadBotId, b.id] }, { baseRevision: 1 }); a.r.update(q.id, { memberBotIds: [q.leadBotId, b.id] }, { baseRevision: 1 }); const one = a.coordinator.session(b.id, p.id), two = a.coordinator.session(b.id, q.id); assert.notEqual(one.id, two.id); assert.equal(a.coordinator.session(b.id, p.id).id, one.id); });
test('Handoff A→B→C tree, upstream guard, read-before-settle and duplicate completion', async (t) => { const a = await fixture(t), h = a.coordinator.handoffs; const delivered = []; h.deliver = m => delivered.push(m); const root = h.open({ projectId: 'p', from: '@user', to: 'A', message: 'root' }); const ab = h.open({ projectId: 'p', from: 'A', to: 'B', parent: root.id, message: 'B work' }); const bc = h.open({ projectId: 'p', from: 'B', to: 'C', parent: ab.id, message: 'C work' }); assert.throws(() => h.open({ projectId: 'p', from: 'C', to: 'A', parent: bc.id, message: 'bad loop' }), /上游/); h.hold(ab.id, 'waiting C'); h.settle(bc.id, 'C result'); assert.equal(h.waiting(ab.id), true); h.taken(bc.id); assert.equal(h.waiting(ab.id), false); h.settle(ab.id, h.answerText(ab.id, 'B final')); assert.equal(delivered.length, 2); assert.ok(delivered[1].message.includes('C result')); assert.deepEqual(h.settle(ab.id, 'dup'), { duplicate: true }); h.taken(ab.id); h.settle(root.id, 'A final'); assert.equal(h.get(root.id).state, 'consumed'); });
test('Missing model is explicitly blocked, no fabricated execution', async (t) => { const a = await fixture(t); const p = createProject(a.r, { title: '项目' }); await a.coordinator.userMessage({ projectId: p.id, content: '请开始' }); await settled(a); const run = a.s.get('SELECT * FROM runs'); assert.equal(run.state, 'blocked'); assert.match(run.error, /模型尚未配置/); assert.equal(a.s.all('SELECT * FROM tool_calls').length, 0); });
test('Streaming model/tool loop really creates knowledge, task and view with durable events', async (t) => { let p; const peer = await modelFixture(t, { respond: body => { const n = body.messages.filter(m => m.role === 'tool').length; if (n === 0)
        return { tools: [{ name: 'knowledge__create', args: { title: '测试产物', content: '来自协议测试工具调用的真实持久化结果', category: 'report' } }] }; if (n === 1)
        return { tools: [{ name: 'task__create', args: { title: '检查测试产物', acceptance: '对象存在并可读' } }] }; if (n === 2)
        return { tools: [{ name: 'view__register', args: { title: '测试生成视图', blocks: [{ id: 'sources', type: 'table', dataSource: { kind: 'query', query: { kind: 'object', projectId: p.id } } }], mount: true } }] }; return { content: '已写入知识、创建任务并挂载视图。此响应来自确定性测试 fixture。' }; } }); const a = await fixture(t, { providerConfig: peer.config }); p = createProject(a.r, { title: '完整链路' }); const events = []; a.s.events.on('event', e => events.push(e)); await a.coordinator.userMessage({ projectId: p.id, content: '运行链路' }); await settled(a); const run = a.s.get('SELECT * FROM runs'); assert.equal(run.state, 'succeeded', run.error); assert.equal(run.step, 4); assert.equal(a.s.all('SELECT * FROM tool_calls').length, 3); assert.equal(a.r.list({ kind: 'object', projectId: p.id }).length, 1); assert.equal(a.r.list({ kind: 'task', projectId: p.id }).length, 1); assert.equal(a.s.all('SELECT * FROM mounts').length, 1); assert.ok(events.some(e => e.topic === 'agent.delta')); const sessionEvents = a.s.sessionEvents(run.session_id); assert.equal(sessionEvents.filter(e => e.type === 'step/start').length, 4); assert.equal(sessionEvents.filter(e => e.type === 'tool/result').length, 3); });
test('Tools receive schema/unknown-tool errors as tool results, not fake success', async (t) => { const peer = await modelFixture(t, { respond: body => body.messages.some(m => m.role === 'tool') ? { content: '已观察到工具错误。' } : { tools: [{ name: 'knowledge__create', args: { content: 'missing title' } }, { name: 'nonexistent', args: {} }] } }); const a = await fixture(t, { providerConfig: peer.config }); const p = createProject(a.r, { title: '错误处理' }); await a.coordinator.userMessage({ projectId: p.id, content: '测试' }); await settled(a); assert.equal(a.r.list({ kind: 'object' }).length, 0); const tools = a.s.all('SELECT * FROM tool_calls'); assert.equal(tools.length, 2); assert.ok(tools.every(t => t.state === 'failed')); assert.ok(JSON.parse(tools[0].result).error); });
test('Intent confirmation persists, pauses and resumes only when user replies', async (t) => { const peer = await modelFixture(t, { respond: body => body.messages.some(m => m.role === 'user' && m.content.startsWith('已确认：')) ? { content: '确认后继续完成。' } : { tools: [{ name: 'intent__confirm', args: { title: '研究范围', scope: '当前项目', do: '读取资料后写结论', avoid: '不发外部消息' } }] } }); const a = await fixture(t, { providerConfig: peer.config }), p = createProject(a.r, { title: '意图对齐' }); await a.coordinator.userMessage({ projectId: p.id, content: '帮我规划' }); await settled(a); const card = a.s.get("SELECT * FROM confirmations WHERE state='pending'"); assert.ok(card); assert.equal(a.s.get('SELECT state FROM runs').state, 'waiting_input'); a.coordinator.confirm(card.id, true); await settled(a); assert.equal(a.s.get('SELECT state FROM confirmations').state, 'accepted'); assert.throws(() => a.coordinator.confirm(card.id, true), /过期/); assert.ok(a.s.all('SELECT * FROM runs').some(r => r.state === 'succeeded')); });
test('Harness loop continues beyond legacy caps and records advisory reminders after full tool batches', async (t) => {
    let requests = 0;
    const peer = await modelFixture(t, { respond: body => !body.tools?.length ? { content: '测试摘要：继续执行任务。' } : ++requests <= 30
        ? { tools: [{ name: 'project__get', args: {} }, { name: 'project__get', args: {} }] }
        : { content: '完成长任务' } });
    const a = await fixture(t, { providerConfig: peer.config }), p = createProject(a.r, { title: '持续执行' });
    const b = a.r.get(p.leadBotId);
    a.r.update(b.id, { maxSteps: 2 }, { baseRevision: b.revision });
    await a.coordinator.userMessage({ projectId: p.id, content: '测试' });
    await settled(a);
    const run = a.s.get('SELECT * FROM runs');
    assert.equal(run.state, 'succeeded', run.error);
    assert.equal(run.step, 31);
    assert.equal(a.s.all('SELECT * FROM tool_calls').length, 60);
    const events = a.s.sessionEvents(run.session_id);
    const reminders = events.filter(e => e.data.source?.kind === 'repeat-tool-reminder');
    assert.deepEqual(reminders.map(e => e.data.source.count), [3, 5, 8]);
    for (const reminder of reminders) {
        const results = events.filter(e => e.turn === reminder.turn && e.step === reminder.step && e.type === 'tool/result');
        assert.equal(results.length, 2);
        assert.ok(results.every(e => e.seq < reminder.seq));
    }
    assert.ok(peer.calls.some(c => c.body.messages.some(m => m.content?.includes('[重复工具调用提醒]'))));
    assert.match(a.s.get('SELECT checkpoint FROM sessions WHERE id=?', run.session_id).checkpoint, /测试/);
    // A new human instruction resets the chain even in the same session.
    requests = 0;
    await a.coordinator.userMessage({ projectId: p.id, content: '再执行一次' });
    await settled(a);
    assert.equal(a.s.sessionEvents(run.session_id).filter(e => e.data.source?.kind === 'repeat-tool-reminder').length, 6);
});
test('An ongoing tool loop remains cancellable beyond the old default', async (t) => {
    const peer = await modelFixture(t, { respond: () => ({ tools: [{ name: 'project__get', args: {} }] }) });
    const a = await fixture(t, { providerConfig: peer.config }), p = createProject(a.r, { title: '停止长循环' });
    await a.coordinator.userMessage({ projectId: p.id, content: '开始' });
    await waitFor(() => peer.calls.length > 25);
    await a.coordinator.stopBot(p.leadBotId, p.id);
    await settled(a);
    assert.equal(a.s.get('SELECT state FROM runs').state, 'canceled');
});
test('Cancellation interrupts the stream and records a canceled run', async (t) => { const peer = await modelFixture(t, { delay: 50, respond: () => ({ content: '需要很长时间输出的测试内容。'.repeat(100) }) }); const a = await fixture(t, { providerConfig: peer.config }), p = createProject(a.r, { title: '取消' }); await a.coordinator.userMessage({ projectId: p.id, content: '开始' }); await waitFor(() => a.kernel.active.size > 0 && peer.calls.length > 0); await a.coordinator.stopBot(p.leadBotId, p.id); await settled(a); assert.equal(a.s.get('SELECT state FROM runs').state, 'canceled'); });
test('Truncated tool-call output never executes and leaves paired history', async (t) => { const peer = await modelFixture(t, { respond: () => ({ finish: 'length', tools: [{ name: 'knowledge__create', args: { title: '不要创建', content: '截断' } }] }) }); const a = await fixture(t, { providerConfig: peer.config }), p = createProject(a.r, { title: '截断' }); await a.coordinator.userMessage({ projectId: p.id, content: '开始' }); await settled(a); assert.equal(a.s.get('SELECT state FROM runs').state, 'truncated'); assert.equal(a.r.list({ kind: 'object' }).length, 0); const history = a.kernel.history(a.coordinator.session(p.leadBotId, p.id).id); assert.ok(history.some(x => x.role === 'tool' && x.content.includes('MAX_TOKENS'))); });
test('Home lock rejects duplicate writers and releases on close', async () => { const home = mkdtempSync(join(tmpdir(), 'lede-lock-')); try {
    const s = new Store(home);
    assert.throws(() => new Store(home), /已被进程/);
    s.close();
    const again = new Store(home);
    again.close();
}
finally {
    rmSync(home, { recursive: true, force: true });
} });
