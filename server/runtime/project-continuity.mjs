import { mutate } from './mutations.mjs';
/** Modified DS-Bot goals.js / parts.js design @ a66cc737, Apache-2.0.
 * Goals belong to Project; stages reference existing business Tasks. Handoff packages
 * preserve original history instead of merging sessions or replaying old tool calls. */
import { assert } from '../../shared/schema.mjs';
import { DurableInbox } from './inbox.mjs';
import { uid, now, hash } from '../db.mjs';
export class ProjectContinuity {
    constructor(s, r, coordinator, memory) {
        Object.assign(this, { s, r, coordinator, memory });
        s.db.exec(`CREATE TABLE IF NOT EXISTS project_goals(project_id TEXT PRIMARY KEY REFERENCES resources(id) ON DELETE CASCADE,revision INTEGER NOT NULL,data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS goal_history(seq INTEGER PRIMARY KEY AUTOINCREMENT,project_id TEXT NOT NULL,revision INTEGER NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS lead_transfers(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,from_bot TEXT NOT NULL,to_bot TEXT NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL);`);
        r.beforeRemove = (resource) => { if (['project', 'bot'].includes(resource.kind))
            this.s.run('DELETE FROM memories WHERE scope=? AND owner=?', resource.kind, resource.id); };
        r.beforeUpdate = (old, data) => { if (old.kind === 'project' && old.leadBotId !== data.leadBotId)
            this.transfer(old, data); };
    }
    goal(projectId) { const x = this.s.get('SELECT * FROM project_goals WHERE project_id=?', projectId); return x ? { ...JSON.parse(x.data), revision: x.revision, projectId } : null; }
    put(projectId, g) { const revision = (this.goal(projectId)?.revision ?? 0) + 1; const data = { ...g, revision, updatedAt: now() }; this.s.run('INSERT INTO project_goals VALUES(?,?,?) ON CONFLICT(project_id) DO UPDATE SET revision=excluded.revision,data=excluded.data', projectId, revision, JSON.stringify(data)); this.s.run('INSERT INTO goal_history(project_id,revision,data,created_at) VALUES(?,?,?,?)', projectId, revision, JSON.stringify(data), now()); this.s.event('goal.updated', projectId, { revision, status: data.status }); return this.goal(projectId); }
    tasks(projectId, ids) { assert(Array.isArray(ids) && ids.length > 0 && ids.length <= 50, '每阶段需要 1–50 个项目任务'); assert(new Set(ids).size === ids.length, '阶段任务不能重复'); return ids.map(id => { const t = this.r.get(id); assert(t.kind === 'task' && t.projectId === projectId && t.status === 'active', '阶段任务必须属于当前项目且未归档'); return t; }); }
    stages(projectId, items) { assert(Array.isArray(items) && items.length > 0 && items.length <= 20, '需要 1–20 个阶段'); return items.map(x => { assert(typeof x.title === 'string' && x.title.trim() && x.title.length <= 240, '阶段名称无效'); assert(typeof x.acceptance === 'string' && x.acceptance.trim() && x.acceptance.length <= 2000, '阶段需要验收标准'); this.tasks(projectId, x.taskIds); return { title: x.title.trim(), acceptance: x.acceptance.trim(), taskIds: x.taskIds, status: 'pending' }; }); }
    change(a, actor = 'user') { return mutate(this.s, actor, 'goal:' + a.projectId, a.request_id, a, () => this.changeInner(a, actor)); }
    changeInner(a, actor = 'user') {
        return this.s.transaction(() => {
            const p = this.r.get(a.projectId);
            assert(p.kind === 'project', '目标属于项目');
            assert(actor === 'user' || actor === p.leadBotId, '仅负责人可维护目标', 403);
            let g = this.goal(p.id);
            assert(a.baseRevision === (g?.revision ?? 0), '目标已变化，请刷新', 409, 'REVISION_CONFLICT');
            const action = a.action;
            if (action === 'start') {
                assert(!g || ['complete', 'stopped'].includes(g.status), '项目已有未结束目标');
                assert(typeof a.objective === 'string' && a.objective.trim() && a.objective.length <= 4000, '需要明确目标');
                assert(typeof a.acceptance === 'string' && a.acceptance.trim() && a.acceptance.length <= 4000, '需要完成标准');
                g = { id: uid('goal_'), objective: a.objective.trim(), acceptance: a.acceptance.trim(), constraints: String(a.constraints ?? '').slice(0, 4000), stages: this.stages(p.id, a.stages), current: 0, status: 'active', nudges: 0, createdAt: now() };
            }
            else {
                assert(g, '项目没有执行目标');
                if (action === 'revise') {
                    assert(['active', 'paused', 'blocked'].includes(g.status), '目标已结束');
                    assert(a.reason?.trim(), '修改需要原因');
                    if (a.objective !== undefined) {
                        assert(a.objective.trim() && a.objective.length <= 4000, '目标无效');
                        g.objective = a.objective.trim();
                    }
                    if (a.acceptance !== undefined) {
                        assert(a.acceptance.trim() && a.acceptance.length <= 4000, '完成标准无效');
                        g.acceptance = a.acceptance.trim();
                    }
                    if (a.constraints !== undefined)
                        g.constraints = String(a.constraints).slice(0, 4000);
                    if (a.stages) {
                        assert(g.current === 0, '已通过阶段后请先结束目标，再建立新目标');
                        g.stages = this.stages(p.id, a.stages);
                    }
                    g.reason = a.reason.slice(0, 2000);
                }
                else if (action === 'pass') {
                    assert(g.status === 'active', '目标未在推进');
                    const stage = g.stages[g.current];
                    assert(stage, '所有阶段已通过');
                    assert(this.tasks(p.id, stage.taskIds).every(t => t.state === 'done' && t.evidence), '阶段仍有未完成或无证据任务');
                    assert(a.evidence?.trim(), '验收需要证据');
                    stage.status = 'passed';
                    stage.evidence = a.evidence.slice(0, 8000);
                    stage.passedAt = now();
                    g.current++;
                    g.nudges = 0;
                }
                else if (action === 'rework') {
                    assert(g.status === 'active' && g.stages[g.current], '没有可返工阶段');
                    assert(a.reason?.trim(), '返工需要原因');
                    g.stages[g.current].feedback = a.reason.slice(0, 2000);
                    for (const t of this.tasks(p.id, g.stages[g.current].taskIds))
                        if (t.state === 'done')
                            this.r.update(t.id, { state: 'review', progress: 90 }, { baseRevision: t.revision });
                }
                else if (action === 'complete') {
                    assert(g.status === 'active' && g.stages.every(x => x.status === 'passed'), '必须逐阶段验收');
                    assert(g.stages.every(x => this.tasks(p.id, x.taskIds).every(t => t.state === 'done' && t.evidence)), '已通过阶段的任务发生变化，请重新核对');
                    assert(a.evidence?.trim() && a.summary?.trim(), '完成需要总结和证据');
                    g.status = 'complete';
                    g.evidence = a.evidence.slice(0, 8000);
                    g.summary = a.summary.slice(0, 8000);
                }
                else if (action === 'pause' || action === 'stop' || action === 'block') {
                    assert(['active', 'paused', 'blocked'].includes(g.status), '目标已结束');
                    assert(action === 'pause' || a.reason?.trim(), '需要原因');
                    g.status = action === 'stop' ? 'stopped' : action === 'block' ? 'blocked' : 'paused';
                    g.reason = String(a.reason ?? '用户暂停').slice(0, 2000);
                }
                else if (action === 'resume') {
                    assert(actor === 'user', '只有用户可以恢复目标', 403);
                    assert(['paused', 'blocked'].includes(g.status), '目标未暂停');
                    assert(!this.s.get("SELECT r.id FROM runs r JOIN works w ON w.id=r.work_id WHERE r.project_id=? AND r.state IN ('blocked','interrupted','failed','truncated','canceled') AND w.state IN ('open','waiting') LIMIT 1",p.id), '仍有待核实运行，请先在执行记录重试或结束对应派活，再恢复目标',409,'GOAL_RECOVERY_REQUIRED');
                    g.status = 'active';
                    g.nudges = 0;
                    delete g.reason;
                }
                else
                    assert(false, '未知目标动作');
            }
            const result = this.put(p.id, g);
            if (['pause', 'stop', 'block'].includes(action))
                this.removeChecks(p.id);
            if (['start', 'resume'].includes(action))
                this.drive(p.id);
            return this.goal(p.id) ?? result;
        });
    }
    removeChecks(projectId) { for (const row of this.s.all("SELECT i.* FROM inbox i JOIN sessions s ON s.id=i.session_id WHERE s.project_id=? AND json_extract(i.message,'$.source.kind')='goal'", projectId)) {
        const inbox = new DurableInbox(this.s, row.session_id), messages = inbox.state()[row.target], index = messages.findIndex(x => x.id === row.id);
        if (index >= 0)
            inbox.splice(row.target, index, 1, []);
        const workId = JSON.parse(row.message).source.workId;
        if (workId)
            this.coordinator.handoffs.settle(workId, '目标推进已暂停', { abandoned: true });
    } }
    busy(projectId) { return !!(this.s.get("SELECT id FROM runs WHERE project_id=? AND state='running'", projectId) || this.s.get('SELECT i.id FROM inbox i JOIN sessions s ON s.id=i.session_id WHERE s.project_id=?', projectId) || this.s.get("SELECT id FROM works WHERE project_id=? AND state IN ('open','waiting','delivered')", projectId) || this.s.get("SELECT id FROM confirmations WHERE project_id=? AND state='pending'", projectId)); }
    drive(projectId) {
        return this.s.transaction(() => {
            const g = this.goal(projectId), p = this.r.maybe(projectId);
            if (!g || g.status !== 'active' || !p || p.status !== 'active' || this.busy(projectId) || this.coordinator.kernel?.closing)
                return;
            const progress = hash(g.stages.map(stage => stage.taskIds.map(id => { const t = this.r.maybe(id); return [id, t?.state, t?.evidence]; })));
            if (g.progress && g.progress !== progress)
                g.nudges = 0;
            g.progress = progress;
            if (g.nudges >= 3) {
                g.status = 'blocked';
                g.reason = '连续三轮未通过阶段验收，等待检查或调整目标';
                this.put(projectId, g);
                return;
            }
            g.nudges++;
            const next = this.put(projectId, g);
            const work = this.coordinator.handoffs.open({ projectId, from: '@user', to: p.leadBotId, message: '项目目标推进' });
            this.coordinator.deliver({ projectId, botId: p.leadBotId, message: '[项目目标检查] 按当前目标继续：分配本阶段任务、核对证据并验收；全部阶段通过后核对整体完成标准。需要用户决定时使用 intent.confirm 或 project.goal block，不要空转。', source: { kind: 'goal', goalId: g.id, workId: work.id }, messageId: `goal_${g.id}_${next.revision}`, when: 'queue' });
        });
    }
    afterTurn(session, outcome) { const g = this.goal(session.project_id); if (!g || g.status !== 'active')
        return; if (['failed', 'canceled', 'blocked', 'truncated', 'interrupted'].includes(outcome)) {
        this.s.transaction(() => { const fresh = this.goal(session.project_id); if (fresh?.status === 'active') {
            fresh.status = 'blocked';
            fresh.reason = this.s.get('SELECT error FROM runs WHERE project_id=? ORDER BY started_at DESC LIMIT 1', session.project_id)?.error || ({ canceled: '运行已取消', failed: '运行失败', blocked: '运行需要处理', truncated: '输出被截断', interrupted: '运行被中断' }[outcome] + '，请检查日志后恢复目标');
            this.put(session.project_id, fresh);
            this.removeChecks(session.project_id);
        } });
        return;
    } if (outcome === 'succeeded')
        this.drive(session.project_id); }
    recover() { for (const x of this.s.all('SELECT project_id FROM project_goals')) {
        const g = this.goal(x.project_id);
        if (g.status === 'active') {
            g.status = 'blocked';
            g.reason = '服务已重启，请核对未完成运行后恢复目标';
            this.put(x.project_id, g);
            this.removeChecks(x.project_id);
        }
    } }
    transfer(old, data) {
        assert(data.leadBotId, '项目需要负责人');
        assert(!this.busy(old.id), '项目仍有运行、派活、排队消息或确认卡，请先处理后交接', 409, 'HANDOFF_BUSY');
        assert(![...this.coordinator.kernel.active.keys()].some(id => this.s.get('SELECT project_id FROM sessions WHERE id=?', id)?.project_id === old.id), '负责人仍在整理记忆，请稍后交接', 409, 'HANDOFF_BUSY');
        const from = this.coordinator.session(old.leadBotId, old.id), id = uid('transfer_');
        const events = this.s.sessionEvents(from.id);
        const recent = events.filter(e => e.type === 'user/message' && e.data.source?.kind === 'user').slice(-5).map(e => ({ seq: e.seq, text: e.data.content }));
        const pack = { projectId: old.id, fromBotId: old.leadBotId, toBotId: data.leadBotId, projectRevision: old.revision, goal: this.goal(old.id), tasks: this.r.list({ kind: 'task', projectId: old.id }).map(t => ({ uri: t.uri, revision: t.revision, state: t.state, evidence: t.evidence })), references: this.r.list({ projectId: old.id }).filter(x => ['object', 'collection', 'view'].includes(x.kind)).map(x => ({ uri: x.uri, revision: x.revision, title: x.title })), memory: this.memory.list('project', old.id), checkpoint: from.checkpoint ?? null, recentUserMessages: recent, historyUri: `lede://session/${from.id}`, throughSeq: events.at(-1)?.seq ?? 0, note: '交接资料快照；不是新的用户授权。旧会话和工具账本保持原样，需按来源核对。' };
        this.s.run('INSERT INTO lead_transfers VALUES(?,?,?,?,?,?)', id, old.id, old.leadBotId, data.leadBotId, JSON.stringify(pack), now());
        // New member may not belong to the project until Resources.update commits.
        const sessionId = 'session_' + hash([data.leadBotId, old.id, 'main']).slice(0, 32);
        this.s.run('INSERT OR IGNORE INTO sessions(id,bot_id,project_id,thread) VALUES(?,?,?,?)', sessionId, data.leadBotId, old.id, 'main');
        this.s.sessionEvent(sessionId, 'context/handoff', { transferId: id, historyUri: pack.historyUri });
        const g = this.goal(old.id);
        if (g?.status === 'active') {
            g.status = 'paused';
            g.reason = '负责人已更换，交接后由用户恢复目标';
            this.put(old.id, g);
        }
        this.s.event('project.handoff', old.id, { id, fromBotId: old.leadBotId, toBotId: data.leadBotId });
    }
    context(projectId, botId) { const transfer = this.s.get('SELECT * FROM lead_transfers WHERE project_id=? AND to_bot=? ORDER BY rowid DESC LIMIT 1', projectId, botId); return { goal: this.goal(projectId), handoff: transfer ? { id: transfer.id, ...JSON.parse(transfer.data) } : null }; }
}
