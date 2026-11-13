import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fork } from 'node:child_process';
import { createApp } from '../server/index.mjs';
import { waitFor } from './helpers.mjs';
import { modelFixture } from './fixtures/model-server.mjs';
import { createProject } from '../server/tools.mjs';
test('Actual process SIGKILL recovers dangling tool result as uncertain without replay', async (t) => { const peer = await modelFixture(t, { respond: () => ({ tools: [{ name: 'test__side_effect', args: {} }] }) }); const home = mkdtempSync(join(tmpdir(), 'lede-crash-')); let child; try {
    child = fork(new URL('./fixtures/crash-child.mjs', import.meta.url), [], { env: { ...process.env, TEST_HOME: home, TEST_PROVIDER: JSON.stringify(peer.config) }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    let error = '';
    child.stderr.on('data', b => error += b);
    await waitFor(() => existsSync(join(home, 'effect-started')), { timeout: 8000 });
    const exited = new Promise(r => child.once('exit', r));
    child.kill('SIGKILL');
    await exited;
    const before = peer.calls.length;
    const a = createApp({ home, port: 0 });
    await a.listen();
    try {
        await new Promise(r => setTimeout(r, 120));
        assert.equal(readFileSync(join(home, 'effect.txt'), 'utf8'), 'once\n');
        assert.equal(peer.calls.length, before);
        const run = a.s.get('SELECT * FROM runs');
        assert.equal(run.state, 'interrupted');
        assert.equal(a.s.get('SELECT state FROM tool_calls').state, 'uncertain');
        const messages = a.kernel.history(run.session_id);
        assert.ok(messages.some(m => m.role === 'tool' && m.content.includes('OUTCOME_UNKNOWN')));
        assert.equal(a.kernel.active.size, 0);
    }
    finally {
        await a.close();
    }
}
finally {
    child?.kill('SIGKILL');
    rmSync(home, { recursive: true, force: true });
} });
test('Waiting tree and pending inbox survive clean restart without a new runtime framework', async () => { const home = mkdtempSync(join(tmpdir(), 'lede-restart-')); try {
    let a = createApp({ home, port: 0 });
    await a.listen();
    const p = createProject(a.r, { title: '持续项目' }), b = a.r.create('bot', { title: '执行者' });
    a.r.update(p.id, { memberBotIds: [p.leadBotId, b.id] }, { baseRevision: 1 });
    const root = a.coordinator.handoffs.open({ projectId: p.id, from: '@user', to: p.leadBotId, message: 'root' });
    const child = a.coordinator.handoffs.open({ projectId: p.id, from: p.leadBotId, to: b.id, parent: root.id, message: 'work' });
    a.coordinator.handoffs.hold(root.id, 'waiting');
    await a.close();
    a = createApp({ home, port: 0 });
    await a.listen();
    try {
        assert.equal(a.coordinator.handoffs.get(root.id).state, 'waiting');
        assert.equal(a.coordinator.handoffs.waiting(root.id), true);
        a.kernel.closing = true;
        a.coordinator.handoffs.settle(child.id, '返回结果');
        assert.equal(a.s.all('SELECT * FROM inbox').length, 1);
        assert.equal(a.coordinator.handoffs.get(child.id).state, 'delivered');
    }
    finally {
        await a.close();
    }
}
finally {
    rmSync(home, { recursive: true, force: true });
} });
