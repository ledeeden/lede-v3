import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { Store, now, uid } from './db.mjs';
import { Resources } from './services/resources.mjs';
import { Retrieval } from './services/retrieval.mjs';
import { Memory } from './services/memory.mjs';
import { ProjectContinuity } from './runtime/project-continuity.mjs';
import { UsageLedger } from './services/usage.mjs';
import { Providers } from './services/providers.mjs';
import { Plugins } from './services/plugins.mjs';
import { AgentKernel } from './runtime/kernel.mjs';
import { BotCoordinator } from './runtime/coordinator.mjs';
import { Handoffs } from './runtime/handoffs.mjs';
import { installTools, createProject, summarize } from './tools.mjs';
import { safeJSON, assert, AppError } from '../shared/schema.mjs';
import { bootstrap, seed } from './seed.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function createApp({ home = process.env.LEDE_HOME || join(homedir(), '.lede'), demo = false, providerConfig, port = Number(process.env.PORT) || 4217 } = {}) {
    const s = new Store(home), r = new Resources(s), providers = new Providers(home);
    const usage = new UsageLedger(s); providers.ledger = usage;
    if (providerConfig)
        providers.save(providerConfig);
    const retrieval = new Retrieval(s, r, providers), plugins = new Plugins(s, r), handoffs = new Handoffs(s), coordinator = new BotCoordinator({ s, r, handoffs });
    const tools = installTools({ s, r, retrieval, plugins, providers, coordinator });
    const kernel = new AgentKernel({ s, r, providers, tools, handoffs });
    coordinator.kernel = kernel;
    kernel.coordinator = coordinator;
    const memory = new Memory(s, r, providers), continuity = new ProjectContinuity(s, r, coordinator, memory);
    Object.assign(coordinator, { memory, continuity });
    Object.assign(kernel, { memory, continuity });
    bootstrap(r);
    if (demo)
        seed({ s, r, plugins });
    const token = randomBytes(24).toString('hex'), clients = new Set(), jobRuns = new Set(), jobAbort = new AbortController();
    let origin = '';
    s.run("UPDATE jobs SET state='failed',error='本地服务在作业完成前退出，请重新执行。',updated_at=? WHERE state='running'", now());
    const json = (res, value, status = 200) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
    const parse = async (req) => { let data = '', size = 0; for await (const chunk of req) {
        size += chunk.length;
        assert(size <= 2500000, '请求过大', 413);
        data += chunk;
    } try {
        return data ? safeJSON(data) : {};
    }
    catch (e) {
        throw new AppError('无效 JSON: ' + e.message);
    } };
    function eventClient(res, e) { if (res.destroyed)
        return; if (!e.transient)
        res.write(`id: ${e.seq}\n`); res.write(`data: ${JSON.stringify(e)}\n\n`); }
    s.events.on('event', e => { for (const res of clients)
        eventClient(res, e); });
    async function job(type, resourceId, run) { const id = uid('job_'); s.run('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?)', id, type, resourceId ?? null, 'running', '{}', null, now(), now()); const promise = (async () => { await Promise.resolve(); try {
        const result = await run(progress => { s.run('UPDATE jobs SET data=?,updated_at=? WHERE id=?', JSON.stringify(progress), now(), id); s.event('job.progress', id, progress); });
        s.run("UPDATE jobs SET state='succeeded',data=?,updated_at=? WHERE id=?", JSON.stringify(result), now(), id);
        s.event('job.ended', id, { state: 'succeeded' });
    }
    catch (e) {
        s.run("UPDATE jobs SET state='failed',error=?,updated_at=? WHERE id=?", providers.redact(e.message), now(), id);
        s.event('job.ended', id, { state: 'failed', error: e.message });
    } })(); jobRuns.add(promise); promise.finally(() => jobRuns.delete(promise)); return { id }; }
    const server = createServer(async (req, res) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader('X-Frame-Options', 'DENY');
        try {
            const host = req.headers.host;
            assert(host === new URL(origin).host || host === 'localhost:' + server.address()?.port, 'Host rejected', 403);
            const u = new URL(req.url, origin), path = u.pathname;
            if (req.method === 'OPTIONS') {
                res.writeHead(405);
                res.end();
                return;
            }
            if (req.headers.origin)
                assert(req.headers.origin === origin || req.headers.origin === 'http://localhost:' + server.address().port, 'Cross-origin request rejected', 403);
            if (path.startsWith('/api/')) {
                if (path === '/api/bootstrap' && req.method === 'GET') {
                    json(res, { token, version: '0.3.0', demo: s.getMeta('demoMode', false), providers: providers.public(), stats: retrieval.stats(), resources: r.all({ status: 'all' }), widgets: plugins.list().map(w => ({ key: w.key, manifest: w.manifest, state: w.state })), mounts: s.all('SELECT * FROM mounts ORDER BY position'), dataHome: home });
                    return;
                }
                if (path === '/api/events' && req.method === 'GET') {
                    assert(u.searchParams.get('token') === token, 'Invalid session token', 403);
                    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'connection': 'keep-alive' });
                    const last = Number(req.headers['last-event-id'] || u.searchParams.get('since') || 0);
                    if (last > 0)
                        for (const e of s.all('SELECT * FROM events WHERE seq>? ORDER BY seq LIMIT 2000', last))
                            eventClient(res, { seq: e.seq, topic: e.topic, resourceId: e.resource_id, data: JSON.parse(e.data), createdAt: e.created_at });
                    res.write(': connected\n\n');
                    clients.add(res);
                    const ping = setInterval(() => { if (!res.destroyed)
                        res.write(': keepalive\n\n'); }, 15000);
                    req.on('close', () => { clearInterval(ping); clients.delete(res); });
                    return;
                }
                assert(req.headers['x-lede-token'] === token, '会话过期，请刷新页面', 403, 'CSRF');
                const a = req.method === 'GET' ? Object.fromEntries(u.searchParams) : await parse(req);
                const endpoints = {
                    'GET /api/resources': () => r.list(a),
                    'POST /api/resource/create': () => a.kind === 'project' ? createProject(r, a.data) : a.kind === 'view' ? plugins.viewCreate(a.data, a.options) : r.create(a.kind, a.data, a.options),
                    'POST /api/resource/update': () => r.update(a.id, a.patch, { baseRevision: a.baseRevision }),
                    'POST /api/resource/status': () => r.status(a.id, a.status),
                    'POST /api/resource/delete': () => r.remove(a.id),
                    'GET /api/resource': () => r.get(a.id),
                    'POST /api/resolve': () => r.resolve(a.uri),
                    'GET /api/versions': () => s.all('SELECT revision,created_at FROM versions WHERE resource_id=? ORDER BY revision DESC', a.id),
                    'GET /api/project': () => r.projectContext(a.id),
                    'POST /api/project/link': () => r.link(a.projectId, a.resourceId, a.role),
                    'POST /api/project/unlink': () => r.unlink(a.projectId, a.resourceId),
                    'GET /api/collection': () => ({ collection: r.get(a.id), members: r.collectionMembers(a.id), signature: r.signature(a.id), projects: s.all('SELECT project_id FROM project_links WHERE resource_id=?', a.id).map(x => r.get(x.project_id)) }),
                    'POST /api/collection/member': () => r.member(a.collectionId, a.resourceId, a.remove),
                    'POST /api/relation': () => r.relate(a.source, a.target, a.type, a.metadata),
                    'GET /api/relations': () => r.related(a.id),
                    'POST /api/relation/delete': () => r.unrelate(a.id),
                    'POST /api/search': () => retrieval.search(a),
                    'POST /api/summary': () => job('summary', a.id, () => summarize({ id: a.id, r, providers, signal: jobAbort.signal })),
                    'POST /api/reindex': () => job('embeddings', null, progress => retrieval.reindexVectors({ onProgress: progress, signal: jobAbort.signal })),
                    'GET /api/jobs': () => s.all('SELECT * FROM jobs ORDER BY created_at DESC LIMIT 50').map(j => ({ ...j, data: JSON.parse(j.data) })),
                    'GET /api/usage': () => usage.query(a),
                    'GET /api/usage/detail': () => providers.redactLog(usage.detail(a.id)),
                    'GET /api/usage/balance': () => providers.balance(),
                    'GET /api/providers': () => providers.public(),
                    'POST /api/providers': () => providers.save(a),
                    'POST /api/providers/test': () => providers.test(),
                    'GET /api/memory': () => memory.list(a.scope, a.owner, { all: a.all === 'true', query: a.query }),
                    'POST /api/memory': () => memory.save(a),
                    'GET /api/memory/history': () => { memory.get(a.id); return s.all('SELECT * FROM memory_history WHERE id=? ORDER BY seq DESC', a.id).map(x=>({...x,data:JSON.parse(x.data)})); },
                    'GET /api/project/continuity': () => { const p=r.get(a.projectId); return {...continuity.context(p.id,p.leadBotId),transfers:s.all('SELECT id,from_bot,to_bot,created_at FROM lead_transfers WHERE project_id=? ORDER BY rowid DESC',p.id)}; },
                    'POST /api/project/goal': () => continuity.change(a),
                    'GET /api/bots': () => coordinator.bots(a.projectId ?? 'global'),
                    'POST /api/bot/create': () => { const b = r.create('bot', a.data); if (a.projectId) {
                        const p = r.get(a.projectId);
                        r.update(p.id, { memberBotIds: [...p.memberBotIds, b.id] }, { baseRevision: p.revision });
                    } return b; },
                    'POST /api/bot/stop': () => coordinator.stopBot(a.botId, a.projectId),
                    'GET /api/chat': () => coordinator.chat(a.projectId ?? 'global'),
                    'POST /api/chat': () => coordinator.userMessage(a),
                    'GET /api/runs': () => s.all('SELECT * FROM runs WHERE (? IS NULL OR project_id=?) ORDER BY started_at DESC LIMIT 100', a.projectId ?? null, a.projectId ?? null),
                    'GET /api/run': () => ({ run: s.get('SELECT * FROM runs WHERE id=?', a.id), tools: s.all('SELECT * FROM tool_calls WHERE run_id=? ORDER BY started_at', a.id) }),
                    'POST /api/run/retry': () => coordinator.retry(a.id),
                    'POST /api/run/cancel': () => { const run = s.get('SELECT * FROM runs WHERE id=?', a.id); assert(run, 'Not found', 404); return kernel.stop(run.session_id); },
                    'GET /api/works': () => s.all('SELECT * FROM works WHERE project_id=? ORDER BY created_at', a.projectId),
                    'POST /api/work/abandon': () => handoffs.settle(a.id, '用户手动结束等待', { abandoned: true }),
                    'POST /api/confirm': () => coordinator.confirm(a.id, a.accepted, a.note),
                    'GET /api/session/events': () => s.sessionEvents(a.id),
                    'GET /api/widgets': () => plugins.list(),
                    'GET /api/widget': () => plugins.get(a.key),
                    'POST /api/widget': () => plugins.create(a),
                    'POST /api/widget/edit': () => plugins.edit(a.key, a),
                    'POST /api/widget/build': () => plugins.build(a.key),
                    'POST /api/widget/preview': () => plugins.preview(a.key, a),
                    'POST /api/widget/register': () => plugins.register(a.key),
                    'POST /api/widget/disable': () => plugins.disable(a.key),
                    'GET /api/view': () => plugins.data(a.id),
                    'POST /api/view/patch': () => plugins.patchView(a.id, a),
                    'POST /api/view/mount': () => plugins.mount(a),
                    'POST /api/view/unmount': () => plugins.unmount(a.id),
                    'POST /api/view/snapshot': () => plugins.snapshot(a.id),
                    'POST /api/view/state': () => plugins.state(a.viewId, a.blockId, a.data),
                    'GET /api/tool-output': () => { const x = s.get('SELECT * FROM tool_outputs WHERE call_key=?', a.id); assert(x, '工具输出不存在', 404); return { ...x, body: JSON.parse(x.body) }; },
                    'POST /api/view/selection': () => plugins.selection(a),
                    'GET /api/events/recent': () => s.all('SELECT * FROM events ORDER BY seq DESC LIMIT 100').map(e => ({ ...e, data: JSON.parse(e.data) })),
                    'POST /api/export': () => ({ schemaVersion: 1, exportedAt: now(), resources: r.all({ status: 'all' }), members: s.all('SELECT * FROM members'), relations: s.all('SELECT * FROM relations'), projectLinks: s.all('SELECT * FROM project_links'), mounts: s.all('SELECT * FROM mounts'), widgets: plugins.list(), memories: s.all('SELECT * FROM memories'), goals: s.all('SELECT * FROM project_goals') }),
                    'POST /api/demo': () => { seed({ r, plugins, s }); return { ok: true }; }
                };
                const fn = endpoints[req.method + ' ' + path];
                assert(fn, 'API not found', 404, 'NOT_FOUND');
                const result = await fn();
                json(res, result ?? { ok: true });
                return;
            }
            assert(req.method === 'GET' || req.method === 'HEAD', 'Method not allowed', 405);
            const file = path === '/' ? join(root, 'web/index.html') : path.startsWith('/shared/') ? join(root, path) : join(root, 'web', decodeURIComponent(path));
            const resolved = resolve(file);
            assert(resolved.startsWith(join(root, 'web') + '/') || resolved.startsWith(join(root, 'shared') + '/'), 'Path denied', 403);
            const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };
            let bytes;
            try {
                bytes = await readFile(resolved);
            }
            catch {
                throw new AppError('File not found', 404);
            }
            if (path === '/sandbox.html') {
                res.setHeader('X-Frame-Options', 'SAMEORIGIN');
                res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'");
            }
            else
                res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
            res.writeHead(200, { 'content-type': types[extname(resolved)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
            res.end(req.method === 'HEAD' ? undefined : bytes);
        }
        catch (error) {
            json(res, { error: { code: error.code ?? 'INTERNAL_ERROR', message: providers.redact(error.message), details: error.details } }, error.status ?? 500);
        }
    });
    return { s, r, retrieval, plugins, providers, usage, memory, continuity, coordinator, kernel, tools, server, get token() { return token; }, get origin() { return origin; }, async listen() { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); }); origin = 'http://127.0.0.1:' + server.address().port; continuity.recover(); kernel.recover(); return origin; }, async close() { for (const res of clients)
            res.end(); clients.clear(); jobAbort.abort(new Error('本地服务停止')); await kernel.shutdown(); await Promise.allSettled([...jobRuns]); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); s.close(); } };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const app = createApp({ demo: process.argv.includes('--demo') });
    app.listen().then(url => console.log(`\nLede v0.3 · Local Workspace\n${url}\nData: ${app.s.home}\nNo model calls until you configure a provider.\n`)).catch(e => { console.error(e); process.exit(1); });
    let closing = false;
    const stop = async () => { if (closing)
        return; closing = true; await app.close(); process.exit(0); };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
}
