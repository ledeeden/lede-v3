import { assert, AppError, guard } from '../../shared/schema.mjs';
import { uri, parseURI, kinds } from '../../shared/uri.mjs';
import { uid, now, hash } from '../db.mjs';
const editableKinds = new Set(['project', 'object', 'collection', 'task', 'view', 'bot']);
const relations = new Set(['references', 'supports', 'contradicts', 'derived_from', 'related_to', 'produced_by', 'uses']);
export class Resources {
    constructor(store) { this.s = store; this.indexer = () => { }; }
    decode(r) { return r ? { ...JSON.parse(r.data), id: r.id, kind: r.kind, title: r.title, status: r.status, ownerSpaceId: r.owner_space, revision: r.revision, createdAt: r.created_at, updatedAt: r.updated_at, uri: uri(r.kind, r.id) } : undefined; }
    get(id, { includeArchived = true } = {}) { const r = this.decode(this.s.get('SELECT * FROM resources WHERE id=?', id)); assert(r, '资源不存在', 404, 'NOT_FOUND'); assert(includeArchived || r.status === 'active', '资源已归档', 404, 'NOT_FOUND'); return r; }
    maybe(id) { const r = this.s.get('SELECT * FROM resources WHERE id=?', id); return this.decode(r); }
    list({ kind, projectId, status = 'active', limit = 500, offset = 0, tag } = {}) { let sql = 'SELECT r.* FROM resources r WHERE 1=1', args = []; if (kind) {
        sql += ' AND r.kind=?';
        args.push(kind);
    } if (status !== 'all') {
        sql += ' AND r.status=?';
        args.push(status);
    } if (projectId) {
        sql += ' AND (r.id=? OR r.id IN (SELECT resource_id FROM project_links WHERE project_id=?))';
        args.push(projectId, projectId);
    } sql += ' ORDER BY r.updated_at DESC,r.id LIMIT ? OFFSET ?'; args.push(Math.min(Math.max(Number(limit) || 500, 1), 2000), Math.max(0, Number(offset) || 0)); let rows = this.s.all(sql, ...args).map(r => this.decode(r)); if (tag)
        rows = rows.filter(r => r.tags?.includes(tag)); return rows; }
    all(options = {}) { const rows = []; let offset = 0; while (true) {
        const batch = this.list({ ...options, tag: undefined, limit: 2000, offset });
        rows.push(...batch);
        if (batch.length < 2000)
            break;
        offset += 2000;
    } return options.tag ? rows.filter(r => r.tags?.includes(options.tag)) : rows; }
    clean(kind, input, previous) {
        guard(input);
        assert(editableKinds.has(kind), 'Unsupported resource kind');
        assert(typeof input.title === 'string' && input.title.trim().length > 0 && input.title.length <= 240, '标题须为 1–240 字符');
        assert(JSON.stringify(input).length < 2000000, '资源超过 2 MB，请使用附件');
        let data = structuredClone(input);
        for (const k of ['id', 'kind', 'uri', 'revision', 'createdAt', 'updatedAt', 'ownerSpaceId', 'status'])
            delete data[k];
        data.title = input.title.trim();
        if(data.citations){assert(Array.isArray(data.citations)&&data.citations.length<=1000,'引用过多');for(const c of data.citations){assert(typeof c.id==='string'&&typeof c.excerpt==='string','无效引用');parseURI(c.targetUri);}}
        if (kind === 'object') {
            if(data.asset){assert(Number.isSafeInteger(data.asset.size)&&data.asset.size>=0&&data.asset.size<=100*1024*1024,'无效原件大小');assert(typeof data.asset.id==='string'&&/^asset_[a-zA-Z0-9-]+$/.test(data.asset.id),'无效原件');assert(typeof data.asset.mime==='string'&&/^(image\/(png|jpeg|webp|gif)|application\/[a-z0-9.+-]+|(audio|video)\/[a-z0-9.+-]+)$/.test(data.asset.mime),'无效媒体类型');}
            if(data.annotations){assert(Array.isArray(data.annotations)&&data.annotations.length<=500,'标注过多');const ids=new Set();for(const a of data.annotations){assert(typeof a.id==='string'&&/^annotation_[a-zA-Z0-9-]+$/.test(a.id)&&!ids.has(a.id),'无效标注 ID');ids.add(a.id);assert(typeof a.text==='string'&&a.text.length<=5000,'无效标注内容');const v=a.selector;assert(v&&['region','page','time','block'].includes(v.type),'无效标注位置');if(v.type==='region'){for(const k of ['x','y','width','height'])assert(Number.isFinite(v[k])&&v[k]>=0&&v[k]<=1,'无效图片区域');assert(v.width>0&&v.height>0&&v.x+v.width<=1.001&&v.y+v.height<=1.001,'区域超界');}if(v.type==='page')assert(Number.isInteger(v.page)&&v.page>0,'无效页码');if(v.type==='time')assert(Number.isFinite(v.start)&&v.start>=0,'无效时间');if(v.type==='block')assert(typeof v.blockId==='string','无效段落');}}
            if(data.taskIds){assert(Array.isArray(data.taskIds)&&data.taskIds.length<=500,'关联任务过多');for(const id of data.taskIds){const task=this.get(id);assert(task.kind==='task'&&task.projectId===data.projectId,'关联任务不属于当前项目');}}
            data.content = String(data.content ?? '');
            data.format = data.format ?? 'markdown';
            assert(['markdown', 'text', 'json'].includes(data.format), 'Unsupported format');
            data.tags = Array.isArray(data.tags) ? data.tags.slice(0, 50).map(String) : [];
            const old = previous?.blocks ?? [];
            const parts = data.content.split(/\n\s*\n/).filter(x => x.trim());
            const used = new Set();
            data.blocks = parts.map((text, i) => { const explicit = input.blocks?.[i]; let match = explicit?.id && old.find(x => x.id === explicit.id); match ??= old.find(x => x.text === text && !used.has(x.id)); const id = match?.id ?? 'block_' + hash(text + '|' + i).slice(0, 12); used.add(id); return { id, text }; });
            if(data.extracted?.segments && data.content===data.extracted.segments.map(x=>x.text).join('\n\n')) {
                let start=0;const segments=data.extracted.segments.map(x=>{const v={...x,offset:start};start+=x.text.length+2;return v;});let cursor=0;
                data.blocks=data.blocks.map(b=>{const offset=data.content.indexOf(b.text,cursor);cursor=offset+b.text.length;const segment=segments.find(x=>offset>=x.offset&&offset<x.offset+x.text.length);return {...b,...segment?.page?{locator:{page:segment.page}}:segment?.start!==undefined?{locator:{time:segment.start}}:{}};});
            }
            data.contentHash = hash(data.content);
            if (previous && previous.contentHash !== data.contentHash && data.summary)
                data.summary = { ...data.summary, stale: true };
        }
        if (kind === 'collection') {
            data.mode = data.mode ?? 'static';
            assert(['static', 'dynamic'].includes(data.mode), '集合类型不正确');
            if (data.mode === 'dynamic') {
                const q = data.query ?? {};
                assert(!Object.keys(q).some(k => !['kind', 'tags', 'projectId', 'text'].includes(k)), '动态集合查询只支持 kind/tags/projectId/text');
                data.query = q;
            }
            data.description = String(data.description ?? '');
            if (previous && data.summary && (data.description !== previous.description || JSON.stringify(data.query) !== JSON.stringify(previous.query) || data.mode !== previous.mode))
                data.summary = { ...data.summary, stale: true };
        }
        if (kind === 'project') {
            if(previous)assert(previous.leadBotId===data.leadBotId,'项目负责人固定，不支持更换或交接',409,'FIXED_PROJECT_LEAD');
            data.goal = String(data.goal ?? '');
            data.phase = String(data.phase ?? '未开始');
            data.memberBotIds = Array.isArray(data.memberBotIds) ? [...new Set(data.memberBotIds)] : [];
            if (data.leadBotId) {
                assert(this.get(data.leadBotId).kind === 'bot', '负责人必须是 Bot');
                if (!data.memberBotIds.includes(data.leadBotId))
                    data.memberBotIds.unshift(data.leadBotId);
            }
            for (const b of data.memberBotIds)
                assert(this.get(b).kind === 'bot', '项目成员必须是 Bot');
        }
        if (kind === 'task') {
            if (previous)
                assert(previous.projectId === data.projectId, '任务所属项目不可直接更换');
            assert(data.projectId && this.get(data.projectId).kind === 'project', '任务需要所属项目');
            data.state = data.state ?? 'queued';
            assert(['queued', 'doing', 'review', 'done', 'blocked', 'canceled'].includes(data.state), '任务状态不正确');
            data.progress = Math.max(0, Math.min(100, Number(data.progress) || 0));
            data.dependencies = Array.isArray(data.dependencies) ? [...new Set(data.dependencies)] : [];
            for (const d of data.dependencies) {
                const task = this.get(d);
                assert(task.kind === 'task' && task.projectId === data.projectId, '依赖须为同项目任务');
            }
            if (data.assigneeBotId)
                assert(this.get(data.projectId).memberBotIds.includes(data.assigneeBotId), '执行者不属于该项目');
            if (data.state === 'done') {
                assert(data.dependencies.every(d => this.get(d).state === 'done'), '仍有未完成的依赖');
                assert(typeof data.evidence === 'string' && data.evidence.trim().length > 0, '完成任务需要验收证据');
                data.progress = 100;
            }
        }
        if (kind === 'bot') {
            assert(data.avatar==null||['redhat','curly','bun','cap'].includes(data.avatar),'未知头像');
            if(data.appearanceDescription!==undefined)assert(typeof data.appearanceDescription==='string'&&data.appearanceDescription.length<=2000,'形象描述过长');
            data.role = String(data.role ?? 'worker');
            data.instructions = String(data.instructions ?? '');
            data.model = String(data.model ?? '');
            data.tools = Array.isArray(data.tools) ? data.tools.map(String) : ['knowledge.*', 'collection.*', 'resource.*', 'task.*', 'bot.*', 'project.get', 'intent.confirm', 'web.fetch', 'file.read', 'file.write', ...(data.role === 'lead' || data.role === 'global' ? ['project.*','view.*','widget.*'] : [])];
            data.skills = Array.isArray(data.skills) ? data.skills.map(String) : [];
            // Legacy maxSteps data is preserved for compatibility but no longer limits execution.
        }
        if (kind === 'view') {
            data.blocks = Array.isArray(data.blocks) ? data.blocks : [];
            assert(data.blocks.length <= 100, '视图模块上限 100');
            assert(new Set(data.blocks.map(b => b.id)).size === data.blocks.length, '模块 ID 不可重复');
            data.layoutMode ??= 'grid';
            assert(['grid','article','canvas','gallery'].includes(data.layoutMode), 'Invalid view layout');
            data.edges ??= [];
            assert(Array.isArray(data.edges) && data.edges.length <= 500 && new Set(data.edges.map(e=>e.id)).size===data.edges.length, 'Invalid edges');
            for(const e of data.edges) assert(typeof e.id==='string' && /^[\w.-]{1,100}$/.test(e.id) && data.blocks.some(b=>b.id===e.source) && data.blocks.some(b=>b.id===e.target), 'Invalid edge endpoints');
            for(const b of data.blocks) if(b.layout) {if(b.layout.parentId){const seen=new Set([b.id]);let current=b;while(current.layout?.parentId){assert(!seen.has(current.layout.parentId),'分组循环');seen.add(current.layout.parentId);current=data.blocks.find(n=>n.id===current.layout.parentId);assert(current,'分组父节点不存在');}} for(const k of ['x','y','width','height']) if(b.layout[k]!==undefined) assert(Number.isFinite(b.layout[k]) && Math.abs(b.layout[k])<=100000, 'Invalid layout'); }
            data.mode = data.mode ?? 'live';
            assert(['live', 'snapshot'].includes(data.mode), 'Unknown view mode');
            for (const b of data.blocks) {
                assert(/^[\w.-]{1,100}$/.test(b.id), 'Invalid block id');
                assert(typeof b.type === 'string', 'Block requires type');
                if (b.dataSource) {
                    const ds = b.dataSource;
                    assert(['query', 'resource', 'inline'].includes(ds.kind), 'Unknown data binding');
                    if (ds.kind === 'query')
                        assert(ds.query && ['task', 'object', 'collection', 'project', 'bot', 'relations'].includes(ds.query.kind), 'Query requires kind');
                    if (ds.kind === 'resource')
                        parseURI(ds.uri);
                }
            }
            this.viewValidator?.(data);
        }
        return data;
    }
    create(kind, input, { id, projectId, actor = 'user' } = {}) { return this.s.transaction(() => { const data = this.clean(kind, input); id = id ?? uid(kind + '_'); assert(/^[A-Za-z0-9_.-]{1,100}$/.test(id), 'Invalid ID'); assert(!this.maybe(id), 'ID 已存在', 409, 'CONFLICT'); const t = now(); this.s.run('INSERT INTO resources VALUES(?,?,?,?,?,?,?,?,?)', id, kind, data.title, 'local', 'active', 1, JSON.stringify(data), t, t); this.s.run('INSERT INTO versions VALUES(?,?,?,?)', id, 1, JSON.stringify(data), t); if (projectId ?? data.projectId)
        this.link(projectId ?? data.projectId, id, kind === 'task' ? 'task' : 'reference'); const r = this.get(id); this.indexer(r); this.markCollections(id); this.s.event('resource.created', id, { kind, actor }); return r; }); }
    update(id, patch, { baseRevision, actor = 'user' } = {}) {
        assert(Number.isInteger(baseRevision), '更新必须携带 baseRevision', 400, 'REVISION_REQUIRED');
        return this.s.transaction(() => {
            const old = this.get(id);
            assert(old.revision === baseRevision, '内容已被其他操作修改，请刷新', 409, 'REVISION_CONFLICT');
            const data = this.clean(old.kind, { ...old, ...patch }, old);
            this.beforeUpdate?.(old, data);
            const revision = old.revision + 1, t = now();
            if (old.kind === 'task' && data.dependencies.includes(id))
                throw new AppError('任务不可依赖自己');
            if (old.kind === 'task') {
                const walk = (node, seen = new Set()) => { if (node === id)
                    return true; if (seen.has(node))
                    return false; seen.add(node); return (this.get(node).dependencies ?? []).some(d => walk(d, seen)); };
                assert(!data.dependencies.some(d => walk(d)), '任务依赖形成循环');
            }
            this.s.run('UPDATE resources SET title=?,revision=?,data=?,updated_at=? WHERE id=? AND revision=?', data.title, revision, JSON.stringify(data), t, id, baseRevision);
            this.s.run('INSERT INTO versions VALUES(?,?,?,?)', id, revision, JSON.stringify(data), t);
            const r = this.get(id);
            this.indexer(r);
            this.markCollections(id);
            this.s.event('resource.updated', id, { kind: old.kind, revision, actor });
            return r;
        });
    }
    status(id, status) { assert(['active', 'archived'].includes(status), 'Invalid archive status'); return this.s.transaction(() => { const r = this.get(id); this.s.run('UPDATE resources SET status=?,updated_at=? WHERE id=?', status, now(), id); this.indexer(this.get(id)); this.markCollections(id); this.s.event('resource.status', id, { status }); return this.get(id); }); }
    remove(id) {
        return this.s.transaction(() => {
            const r = this.get(id);
            if (r.kind === 'bot') {
                const owned = this.list({ kind: 'project', status: 'all' }).filter(p => p.leadBotId === id);
                assert(owned.length === 0, '请先为项目更换负责人');
                assert(!this.s.get("SELECT id FROM runs WHERE bot_id=? AND state IN ('running','queued','waiting')", id), '该 Bot 仍有未结束的运行');
                for (const p of this.list({ kind: 'project' }).filter(x => x.memberBotIds.includes(id)))
                    this.update(p.id, { memberBotIds: p.memberBotIds.filter(b => b !== id) }, { baseRevision: p.revision });
            }
            if (r.kind === 'project')
                assert(!this.s.get("SELECT id FROM runs WHERE project_id=? AND state IN ('running','queued','waiting')", id), '项目仍在执行，请先停止');
            if (r.kind === 'project') {
                for (const task of this.all({ kind: 'task', projectId: id, status: 'all' }))
                    this.remove(task.id);
                for (const ss of this.s.all('SELECT id FROM sessions WHERE project_id=?', id))
                    this.s.run('DELETE FROM inbox WHERE session_id=?', ss.id);
            }
            this.markCollections(id);
            this.beforeRemove?.(r);
            const result = this.s.run('DELETE FROM resources WHERE id=?', id);
            this.s.event('resource.deleted', id, { kind: r.kind });
            return { deleted: Number(result.changes) > 0, id };
        });
    }
    link(projectId, resourceId, role = 'reference') { assert(this.get(projectId).kind === 'project', '目标不是项目'); this.get(resourceId); this.s.run('INSERT INTO project_links VALUES(?,?,?) ON CONFLICT(project_id,resource_id) DO UPDATE SET role=excluded.role', projectId, resourceId, role); this.s.event('project.linked', projectId, { resourceId, role }); return { projectId, resourceId, role }; }
    unlink(projectId, resourceId) { this.s.run('DELETE FROM project_links WHERE project_id=? AND resource_id=?', projectId, resourceId); this.s.event('project.unlinked', projectId, { resourceId }); return { removed: true }; }
    related(id) { this.get(id); return this.s.all('SELECT * FROM relations WHERE source=? OR target=?', id, id).map(r => ({ ...r, metadata: JSON.parse(r.metadata), sourceResource: this.maybe(r.source), targetResource: this.maybe(r.target) })); }
    relate(source, target, type = 'references', metadata = {}) { assert(relations.has(type), 'Unknown relation type'); this.get(source); this.get(target); const id = uid('rel_'); this.s.run('INSERT OR IGNORE INTO relations VALUES(?,?,?,?,?)', id, source, target, type, JSON.stringify(metadata)); this.s.event('relation.created', source, { target, type }); return this.s.get('SELECT * FROM relations WHERE source=? AND target=? AND type=?', source, target, type); }
    unrelate(id) { this.s.run('DELETE FROM relations WHERE id=?', id); this.s.event('relation.deleted', id); return { deleted: true }; }
    collectionMembers(id, { recursive = false, seen = new Set() } = {}) { const c = this.get(id); assert(c.kind === 'collection', 'Not a collection'); if (seen.has(id))
        return []; seen.add(id); let members = c.mode === 'dynamic' ? this.all({ kind: c.query?.kind ?? 'object', projectId: c.query?.projectId }).filter(x => (!c.query?.tags?.length || c.query.tags.every(t => x.tags?.includes(t))) && (!c.query?.text || (x.title + ' ' + (x.content ?? '')).toLowerCase().includes(c.query.text.toLowerCase()))) : this.s.all('SELECT r.* FROM members m JOIN resources r ON r.id=m.resource_id WHERE collection_id=? AND r.status=? ORDER BY position,r.title', id, 'active').map(r => this.decode(r)); if (recursive)
        members = members.flatMap(m => m.kind === 'collection' ? [m, ...this.collectionMembers(m.id, { recursive, seen })] : [m]); return [...new Map(members.map(x => [x.id, x])).values()]; }
    member(collectionId, resourceId, remove = false) { return this.s.transaction(() => { const c = this.get(collectionId); assert(c.kind === 'collection' && c.mode === 'static', '只可编辑静态集合成员'); const r = this.get(resourceId); if (!remove && r.kind === 'collection') {
        assert(collectionId !== resourceId && !this.collectionMembers(resourceId, { recursive: true }).some(x => x.id === collectionId), '集合嵌套不能形成循环');
    } if (remove)
        this.s.run('DELETE FROM members WHERE collection_id=? AND resource_id=?', collectionId, resourceId);
    else
        this.s.run('INSERT OR IGNORE INTO members VALUES(?,?,?)', collectionId, resourceId, Date.now()); this.markCollections(collectionId, { includeSelf: true }); this.s.event('collection.members', collectionId, { resourceId, remove }); return this.collectionMembers(collectionId); }); }
    signature(id) { const r = this.get(id); return r.kind === 'collection' ? hash({ description: r.description, mode: r.mode, query: r.query, members: this.collectionMembers(id, { recursive: true }).map(x => [x.id, x.revision]).sort() }) : r.contentHash ?? hash(r); }
    markCollections(id, { includeSelf = false } = {}) { const direct = this.s.all('SELECT collection_id FROM members WHERE resource_id=?', id).map(x => x.collection_id); const done = new Set(); const queue = [...(includeSelf ? [id] : []), ...direct, ...this.all({ kind: 'collection' }).filter(c => c.mode === 'dynamic' && c.id !== id).map(c => c.id)]; for (const c of queue) {
        if (done.has(c))
            continue;
        done.add(c);
        const r = this.maybe(c);
        if (!r)
            continue;
        if (r.summary) {
            const data = JSON.parse(this.s.get('SELECT data FROM resources WHERE id=?', c).data);
            data.summary.stale = true;
            this.s.run('UPDATE resources SET data=? WHERE id=?', JSON.stringify(data), c);
            this.indexer(this.get(c));
        }
        queue.push(...this.s.all('SELECT collection_id FROM members WHERE resource_id=?', c).map(x => x.collection_id));
    } }
    saveSummary(id, { abstract, overview, sourceSignature, method = 'llm' }) { return this.s.transaction(() => { const r = this.get(id); assert(this.signature(id) === sourceSignature, '内容在摘要生成期间发生变化', 409, 'STALE_GENERATION'); return this.update(id, { summary: { abstract: String(abstract).slice(0, 1000), overview: String(overview).slice(0, 20000), sourceSignature, sourceRevision: r.revision, generatedAt: now(), method, stale: false } }, { baseRevision: r.revision, actor: 'summary-job' }); }); }
    resolve(ref) {
        const p = parseURI(ref);
        if (p.kind === 'run') {
            const run = this.s.get('SELECT * FROM runs WHERE id=?', p.id);
            assert(run, '运行不存在', 404);
            let output;
            if (p.anchor?.startsWith('tool=')) {
                const key = p.anchor.slice(5);
                output = this.s.get('SELECT body FROM tool_outputs WHERE call_key=? AND run_id=?', key, p.id);
                assert(output, '工具输出不存在', 404);
            }
            return { ...run, kind: 'run', content: output?.body, uri: ref };
        }
        if (p.kind === 'session') {
            const session = this.s.get('SELECT * FROM sessions WHERE id=?', p.id);
            assert(session, '会话不存在', 404);
            const events = this.s.sessionEvents(session.id);
            const selected = p.anchor?.startsWith('event=') ? events.filter(e => e.seq === Number(p.anchor.slice(6))) : events;
            return { ...session, content: JSON.stringify(selected), uri: ref };
        }
        if (p.kind === 'widget') {
            const w = this.s.get('SELECT * FROM widget_versions WHERE key=?', p.id);
            assert(w, '插件不存在', 404);
            return { ...w, manifest: JSON.parse(w.manifest), uri: ref };
        }
        let r = this.get(p.id);
        assert(r.kind === p.kind, 'URI kind 与资源类型不匹配', 404);
        if (p.rev) {
            const v = this.s.get('SELECT * FROM versions WHERE resource_id=? AND revision=?', p.id, p.rev);
            assert(v, '版本不存在', 404);
            r = { ...r, ...JSON.parse(v.data), revision: p.rev, uri: uri(r.kind, r.id, { rev: p.rev }), isHistorical: true };
        }
        if (p.anchor) {
            if (p.anchor.startsWith('annotation_')) { const annotation=(r.annotations??[]).find(a=>a.id===p.anchor);assert(annotation,'标注不存在',404);r={...r,selection:annotation}; }
            else if (p.anchor.startsWith('page=')) { const page=Number(p.anchor.slice(5));assert(Number.isInteger(page)&&page>0,'Invalid page anchor');r={...r,selection:{page}}; }
            else if (p.anchor.startsWith('t=')) {
                const time = Number(p.anchor.slice(2));
                assert(Number.isFinite(time) && time >= 0, 'Invalid time anchor');
                r = { ...r, selection: { time } };
            }
            else {
                const block = (r.blocks ?? []).find(b => b.id === p.anchor);
                assert(block, '定位片段已不存在，请使用带 rev 的历史引用', 404, 'ANCHOR_NOT_FOUND');
                r = { ...r, selection: block };
            }
        }
        return r;
    }
    read(ref, { level = 2, maxChars = 24000, offset = 0 } = {}) { const r = this.resolve(ref); if (level === 0 && r.summary && !r.summary.stale)
        return { uri: r.uri, level, text: r.summary.abstract, revision: r.revision }; if (level === 1 && r.summary && !r.summary.stale)
        return { uri: r.uri, level, text: r.summary.overview, revision: r.revision }; const text = r.selection?.text ?? r.content ?? r.description ?? JSON.stringify(r); return { uri: ref, level: 2, title: r.title, revision: r.revision, text: text.slice(offset, offset + maxChars), offset, nextOffset: offset + maxChars < text.length ? offset + maxChars : null, truncated: offset + maxChars < text.length, summaryAvailable: !!r.summary && !r.summary.stale }; }
    projectContext(id) { const p = this.get(id); assert(p.kind === 'project', 'Not a project'); return { project: p, resources: this.list({ projectId: id }), collections: this.list({ kind: 'collection', projectId: id }), tasks: this.list({ kind: 'task', projectId: id }), members: p.memberBotIds.map(id => this.maybe(id)).filter(Boolean), mounts: this.s.all('SELECT * FROM mounts WHERE project_id=? ORDER BY position', id) }; }
}
