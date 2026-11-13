import ts from '../../vendor/typescript.cjs';
import { assert, ensure, checkSchema, objectSchema, idSchema, AppError } from '../../shared/schema.mjs';
import { uid, now, hash } from '../db.mjs';
import { parseURI } from '../../shared/uri.mjs';
const manifestSchema = objectSchema({ id: { type: 'string', pattern: '^[a-z][a-z0-9.-]{2,80}$' }, version: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+$' }, name: { type: 'string', minLength: 1, maxLength: 120 }, description: { type: 'string', maxLength: 4000 }, entry: { type: 'string', enum: ['index.tsx', 'index.ts', 'index.js'] }, propsSchema: { type: 'object' }, capabilities: { type: 'array', items: { type: 'string', enum: ['selection', 'context', 'state', 'resize'] }, uniqueItems: true, maxItems: 4 } }, ['id', 'version', 'name', 'propsSchema', 'capabilities']);
export class Plugins {
    constructor(s, r) { this.s = s; this.r = r; r.viewValidator = input => this.validateView(input); }
    decode(w) { return w ? { ...w, manifest: JSON.parse(w.manifest), buildLog: w.build_log ? JSON.parse(w.build_log) : null, previewOK: !!w.preview_ok } : undefined; }
    list() { return this.s.all('SELECT * FROM widget_versions ORDER BY created_at DESC').map(w => this.decode(w)); }
    get(key) { const w = this.decode(this.s.get('SELECT * FROM widget_versions WHERE key=?', key)); assert(w, 'Widget 不存在', 404); return w; }
    create({ manifest, source }) { ensure(manifestSchema, manifest); checkSchema(manifest.propsSchema); assert(typeof source === 'string' && source.length <= 200000, '插件源码超过 200 KB'); const key = manifest.id + '@' + manifest.version; assert(!this.s.get('SELECT key FROM widget_versions WHERE key=?', key), '插件版本已存在。修改已注册插件需要新版本。', 409); this.s.run('INSERT INTO widget_versions VALUES(?,?,?,?,?,?,?,?,?,?)', key, manifest.id, manifest.version, JSON.stringify(manifest), source, null, 'draft', null, 0, now()); this.s.event('widget.created', key); return this.get(key); }
    edit(key, { manifest, source }) { const w = this.get(key); assert(!['registered', 'disabled'].includes(w.state), '已注册版本不可变，请创建新版本', 409); manifest ??= w.manifest; ensure(manifestSchema, manifest); checkSchema(manifest.propsSchema); assert(manifest.id + '@' + manifest.version === key, '修改名称/版本须新建插件'); source ??= w.source; assert(source.length <= 200000, 'Source too large'); this.s.run("UPDATE widget_versions SET manifest=?,source=?,compiled=NULL,state='draft',preview_ok=0,build_log=NULL WHERE key=?", JSON.stringify(manifest), source, key); this.s.event('widget.edited', key); return this.get(key); }
    build(key) {
        const w = this.get(key);
        assert(!['registered', 'disabled'].includes(w.state), '已注册版本不重新编译');
        const sourceFile = ts.createSourceFile('index.tsx', w.source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
        const disallowed = [];
        let hasDefault = false;
        function visit(node) { if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node) || (ts.isExportDeclaration(node) && node.moduleSpecifier))
            disallowed.push('禁止外部依赖；使用平台提供的 h / sdk'); if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
            disallowed.push('禁止动态 import'); if (ts.isExportAssignment(node) || node.modifiers?.some(x => x.kind === ts.SyntaxKind.DefaultKeyword))
            hasDefault = true; ts.forEachChild(node, visit); }
        visit(sourceFile);
        if (!hasDefault)
            disallowed.push('必须 export default 一个 mount(root, props, sdk) 函数');
        const result = ts.transpileModule(w.source, { fileName: 'index.tsx', compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.React, jsxFactory: 'h', jsxFragmentFactory: 'Fragment', strict: true }, reportDiagnostics: true });
        const errors = [...disallowed, ...(result.diagnostics ?? []).filter(x => x.category === ts.DiagnosticCategory.Error).map(x => ts.flattenDiagnosticMessageText(x.messageText, '\n'))];
        const log = { ok: errors.length === 0, errors, compiler: 'TypeScript ' + ts.version, sourceHash: hash(w.source), compiledAt: now(), checks: ['manifest', 'supported-schema', 'syntax', 'imports', 'default-export'] };
        this.s.run('UPDATE widget_versions SET compiled=?,state=?,build_log=?,preview_ok=0 WHERE key=?', errors.length ? null : result.outputText, errors.length ? 'error' : 'built', JSON.stringify(log), key);
        this.s.event('widget.built', key, log);
        return this.get(key);
    }
    preview(key, { ok, error }) { const w = this.get(key); assert(['built', 'previewed', 'error'].includes(w.state) && w.compiled, '先成功编译再预览'); this.s.run('UPDATE widget_versions SET preview_ok=?,state=?,build_log=? WHERE key=?', ok ? 1 : 0, ok ? 'previewed' : 'error', JSON.stringify({ ...w.buildLog, previewError: error ?? null, previewAt: now() }), key); this.s.event('widget.preview', key, { ok, error }); return this.get(key); }
    register(key, { actor = 'user' } = {}) { assert(actor === 'user', '插件注册需要用户确认', 403, 'APPROVAL_REQUIRED'); const w = this.get(key); assert(w.compiled && w.previewOK, '必须编译成功并通过沙箱预览', 409); this.s.run("UPDATE widget_versions SET state='registered' WHERE key=?", key); this.s.event('widget.registered', key); return this.get(key); }
    disable(key) { const w = this.get(key); assert(w.state === 'registered', '只能停用已注册插件'); this.s.run("UPDATE widget_versions SET state='disabled' WHERE key=?", key); this.s.event('widget.disabled', key); return this.get(key); }
    validateView(input) { assert(Array.isArray(input.blocks ?? []), 'blocks 必须是数组'); for (const b of input.blocks ?? []) {
        assert(b && typeof b.type === 'string', '模块缺少 type');
        if (b.type.startsWith('widget:')) {
            const w = this.get(b.type.slice(7));
            assert(w.state === 'registered', '插件尚未注册: ' + w.key);
            ensure(w.manifest.propsSchema, b.props ?? {});
        }
        else
            assert(['markdown', 'metric', 'table', 'cards', 'chart', 'tasks', 'timeline', 'relations'].includes(b.type), '未知组件类型: ' + b.type);
    } return input; }
    viewCreate(input, options = {}) { return this.r.create('view', this.validateView(input), options); }
    patchView(id, { baseRevision, operations }) {
        const v = this.r.get(id);
        assert(v.kind === 'view', 'Not a view');
        assert(Array.isArray(operations) && operations.length <= 100, '最多 100 个操作');
        let next = structuredClone(v);
        for (const op of operations) {
            assert(['addBlock', 'updateBlock', 'removeBlock', 'setTitle', 'setMode'].includes(op.op), 'Unsupported view operation');
            if (op.op === 'addBlock') {
                assert(!next.blocks.some(b => b.id === op.block?.id), '模块已存在');
                next.blocks.push(op.block);
            }
            if (op.op === 'updateBlock') {
                const i = next.blocks.findIndex(b => b.id === op.id);
                assert(i >= 0, '模块不存在');
                next.blocks[i] = { ...next.blocks[i], ...op.patch, id: op.id };
            }
            if (op.op === 'removeBlock')
                next.blocks = next.blocks.filter(b => b.id !== op.id);
            if (op.op === 'setTitle')
                next.title = op.value;
            if (op.op === 'setMode')
                next.mode = op.value;
        }
        this.validateView(next);
        return this.r.update(id, next, { baseRevision });
    }
    mount({ projectId, viewId, pinned = false }) { assert(this.r.get(projectId).kind === 'project', 'Not a project'); assert(this.r.get(viewId).kind === 'view', 'Not a view'); const existing = this.s.get('SELECT * FROM mounts WHERE project_id=? AND view_id=?', projectId, viewId); if (existing) {
        this.s.run('UPDATE mounts SET pinned=? WHERE id=?', pinned ? 1 : 0, existing.id);
        this.s.event('view.mounted', viewId, { projectId, pinned });
        return { ...existing, pinned: pinned ? 1 : 0 };
    } const id = uid('mount_'); this.s.transaction(() => { this.s.run('INSERT INTO mounts VALUES(?,?,?,?,?)', id, projectId, viewId, Date.now(), pinned ? 1 : 0); this.r.link(projectId, viewId, 'view'); this.s.event('view.mounted', viewId, { projectId }); }); return { id, projectId, viewId, pinned }; }
    unmount(id) { const m = this.s.get('SELECT * FROM mounts WHERE id=?', id); assert(m, '挂载不存在', 404); this.s.run('DELETE FROM mounts WHERE id=?', id); this.s.event('view.unmounted', m.view_id, { projectId: m.project_id }); return { removed: true }; }
    data(viewId) { const v = this.r.get(viewId); const resolve = (b) => { if (v.mode === 'snapshot' && v.snapshot?.[b.id] !== undefined)
        return v.snapshot[b.id]; const ds = b.dataSource; if (!ds)
        return b.data ?? []; if (ds.kind === 'inline')
        return ds.value ?? []; if (ds.kind === 'resource')
        return this.r.resolve(ds.uri); const q = ds.query; if (q.kind === 'relations') {
        return q.resourceId ? this.r.related(q.resourceId) : this.s.all('SELECT * FROM relations').map(x => ({ ...x, sourceResource: this.r.maybe(x.source), targetResource: this.r.maybe(x.target) }));
    } return this.r.list({ kind: q.kind, projectId: q.projectId, tag: q.tag, limit: q.limit ?? 100 }).filter(x => !q.state || x.state === q.state); }; return { view: v, blocks: v.blocks.map(b => ({ ...b, resolvedData: resolve(b), localState: JSON.parse(this.s.get('SELECT data FROM widget_state WHERE view_id=? AND block_id=?', v.id, b.id)?.data ?? '{}') })) }; }
    snapshot(id) { const v = this.r.get(id); const data = this.data(id); return this.r.update(id, { mode: 'snapshot', snapshot: Object.fromEntries(data.blocks.map(b => [b.id, b.resolvedData])) }, { baseRevision: v.revision }); }
    state(viewId, blockId, data) { const view = this.r.get(viewId); const block = view.blocks?.find(b => b.id === blockId); assert(block?.type?.startsWith('widget:'), '目标不是插件模块'); const widget = this.get(block.type.slice(7)); assert(widget.state === 'registered' && widget.manifest.capabilities.includes('state'), '插件没有 state 能力', 403); ensure({ type: 'object' }, data); const text = JSON.stringify(data); assert(text.length <= 16000, '交互状态上限 16 KB'); this.s.run('INSERT INTO widget_state VALUES(?,?,?,?) ON CONFLICT(view_id,block_id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at', viewId, blockId, text, now()); return { saved: true }; }
    selection({ viewId, blockId, resourceIds = [], key, excerpt }) { const data = this.data(viewId); const block = data.blocks.find(b => b.id === blockId); assert(block, '视图模块不存在'); const bound = new Set(); const collect = x => { if (!x || typeof x !== 'object')
        return; if (x.id && this.r.maybe(x.id))
        bound.add(x.id); if (x.uri) {
        try {
            const p = parseURI(x.uri);
            if (this.r.maybe(p.id))
                bound.add(p.id);
        }
        catch { }
    } if (Array.isArray(x))
        x.forEach(collect);
    else
        Object.values(x).forEach(collect); }; collect(block.resolvedData); for (const id of resourceIds)
        assert(bound.has(id), '选择不属于当前模块的数据', 403); return { viewId, viewRevision: data.view.revision, blockId, key: String(key ?? '').slice(0, 300), resourceUris: resourceIds.map(id => this.r.get(id).uri), excerpt: String(excerpt ?? '').slice(0, 2000), trusted: false, source: 'view-selection' }; }
}
