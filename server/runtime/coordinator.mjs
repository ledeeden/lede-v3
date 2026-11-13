/** Project-scoped long-lived identities and message routing, adapted from DS-Bot
 * delivery.js/tools.js/roster.js. No DS-Bot group-chat/product runtime dependency. */
import { DurableInbox } from './inbox.mjs';
import { RequestIdentity } from './requests.mjs';
import { uid, now, hash } from '../db.mjs';
import { assert, AppError } from '../../shared/schema.mjs';
export class BotCoordinator {
    constructor({ s, r, handoffs }) { Object.assign(this, { s, r, handoffs }); this.requests = new RequestIdentity(s); this.kernel = null; handoffs.deliver = m => this.deliver(m); }
    session(botId, projectId, thread = 'main') { const b = this.r.get(botId); assert(b.kind === 'bot', 'Not a Bot'); if (projectId !== 'global') {
        const p = this.r.get(projectId);
        assert(p.kind === 'project' && p.memberBotIds.includes(botId), 'Bot 不属于当前项目');
    }
    else
        assert(b.role === 'global', '全局会话需要总助'); const id = 'session_' + hash([botId, projectId, thread]).slice(0, 32); this.s.run('INSERT OR IGNORE INTO sessions(id,bot_id,project_id,thread) VALUES(?,?,?,?)', id, botId, projectId, thread); return this.s.get('SELECT * FROM sessions WHERE id=?', id); }
    deliver({ projectId, botId, message, source = {}, messageId = uid('msg_'), when = 'queue', selection }) { const session = this.session(botId, projectId); const inbox = new DurableInbox(this.s, session.id); const active = this.kernel?.active.get(session.id); const activeRun = active?.runId ? this.s.get('SELECT work_id FROM runs WHERE id=?', active.runId) : undefined; const differentWork = source.workId && activeRun?.work_id && source.workId !== activeRun.work_id; const target = when === 'now' && active && !differentWork ? 'next-step' : 'next-turn'; if (this.s.get('SELECT id FROM inbox WHERE id=?', messageId))
        return { messageId, sessionId: session.id, duplicate: true }; inbox.append(target, { id: messageId, content: message, source, ...selection ? { selection } : {} }); queueMicrotask(() => this.kernel?.wake(session.id)); return { messageId, sessionId: session.id, target }; }
    userMessage({ projectId, content, when = 'now', selection, requestId = uid('input_') }) {
        assert(typeof content === 'string' && content.trim().length > 0 && content.length <= 40000, '消息须为 1–40000 字符');
        const botId = projectId === 'global' ? 'bot_global' : this.r.get(projectId).leadBotId;
        assert(botId, '项目没有负责人');
        const session = this.session(botId, projectId);
        const active = this.kernel?.active.get(session.id);
        const activeRun = active?.runId ? this.s.get('SELECT * FROM runs WHERE id=?', active.runId) : undefined;
        return this.requests.admit(this.requests.identity({ caller: '@user', context: projectId, name: requestId, payload: { content, selection: selection ?? null } }), () => this.s.transaction(() => { for (const c of this.s.all("SELECT * FROM confirmations WHERE session_id=? AND state='pending'", session.id))
            this.s.run("UPDATE confirmations SET state='superseded' WHERE id=?", c.id); const work = when === 'now' && activeRun ? this.handoffs.get(activeRun.work_id) : this.handoffs.open({ projectId, from: '@user', to: botId, message: content }); return this.deliver({ projectId, botId, message: content, when, selection, source: { kind: 'user', workId: work?.id } }); }));
    }
    async delegate({ fromBotId, toBotId, projectId, parentWorkId, message, request_id, when = 'queue' }) { assert(message?.trim(), '委派消息不能为空'); const parent = this.handoffs.get(parentWorkId); assert(!parent || parent.recipient === fromBotId, 'Bot 不拥有该派活节点'); this.session(toBotId, projectId); assert(toBotId !== fromBotId, '不能发送给自己'); const request = this.requests.identity({ caller: fromBotId, context: projectId, name: request_id, payload: { to: toBotId, message: message.replace(/\r\n?/g, '\n').trim(), when } }); const result = await this.requests.admit(request, () => this.s.transaction(() => { const work = this.handoffs.open({ projectId, from: fromBotId, to: toBotId, parent: parentWorkId, message }); const receipt = this.deliver({ projectId, botId: toBotId, message, when, source: { kind: 'bot', role: 'request', from: fromBotId, workId: work.id } }); this.s.event('work.delegated', work.id, { projectId, from: fromBotId, to: toBotId }); return { ...receipt, workId: work.id, accepted: true }; })); if (result.status === 'conflict')
        throw new AppError('request_id 已用于不同的内容', 409, 'REQUEST_CONFLICT'); if (result.status === 'uncertain')
        throw new AppError('该请求发送结果未知，未重发。先检查目标 Inbox 与运行记录。', 409, 'OUTCOME_UNKNOWN'); return result; }
    bots(projectId) { const members = projectId === 'global' ? this.r.list({ kind: 'bot' }) : this.r.get(projectId).memberBotIds.map(id => this.r.get(id)); return members.map(b => { const sessions = this.s.all('SELECT * FROM sessions WHERE bot_id=? AND project_id=?', b.id, projectId); const runs = this.s.all('SELECT * FROM runs WHERE bot_id=? AND project_id=? ORDER BY started_at DESC LIMIT 10', b.id, projectId); const inbox = sessions.flatMap(ss => this.s.all('SELECT * FROM inbox WHERE session_id=?', ss.id).map(x => ({ ...x, message: JSON.parse(x.message) }))); const waiting = this.s.all("SELECT * FROM works WHERE recipient=? AND project_id=? AND state='waiting'", b.id, projectId); return { ...b, sessions, runs, inbox, waiting, runtimeState: runs.some(x => x.state === 'running') ? 'running' : waiting.length ? 'waiting' : inbox.length ? 'queued' : runs[0]?.state === 'blocked' ? 'blocked' : 'idle' }; }); }
    async stopBot(botId, projectId) { const sessions = this.s.all('SELECT id FROM sessions WHERE bot_id=? AND project_id=?', botId, projectId); for (const session of sessions) {
        await this.kernel.stop(session.id);
        const inbox = new DurableInbox(this.s, session.id);
        for (const m of [...inbox.nextTurn, ...inbox.nextStep])
            if (m.source?.workId)
                this.handoffs.settle(m.source.workId, '用户取消了排队任务', { failed: true });
        inbox.clear();
    } for (const w of this.s.all("SELECT * FROM works WHERE recipient=? AND project_id=? AND state IN ('open','waiting')", botId, projectId))
        this.handoffs.settle(w.id, '用户停止该 Bot', { failed: true }); return { stopped: true }; }
    retry(runId) { const run = this.s.get('SELECT * FROM runs WHERE id=?', runId); assert(run, '运行不存在', 404); assert(['failed', 'blocked', 'interrupted', 'truncated', 'canceled'].includes(run.state), '该状态不能重试'); const original = this.handoffs.get(run.work_id); const work = original && ['open', 'waiting'].includes(original.state) ? original : this.handoffs.open({ projectId: run.project_id, from: '@user', to: run.bot_id, message: '恢复上次运行' }); return this.deliver({ projectId: run.project_id, botId: run.bot_id, message: `继续上次运行 ${runId}。先检查历史工具结果与已保存产物，不要重复产生副作用。结果未知的外部调用需要先核实。`, source: { kind: 'user', workId: work.id }, when: 'queue' }); }
    confirm(id, accepted, note = '') { return this.s.transaction(() => { const c = this.s.get('SELECT * FROM confirmations WHERE id=?', id); assert(c && c.state === 'pending', '确认卡已过期或已处理', 409); this.s.run('UPDATE confirmations SET state=? WHERE id=?', accepted ? 'accepted' : 'rejected', id); const data = JSON.parse(c.data); const receipt = this.deliver({ projectId: c.project_id, botId: c.bot_id, message: accepted ? '已确认：' + c.title + (note ? '。补充：' + note : '') : '需要调整，暂不执行：' + (note || '请重新对齐范围'), source: { kind: 'user', workId: data.workId }, when: 'queue' }); this.s.event('confirmation.replied', id, { accepted }); return receipt; }); }
    chat(projectId) { const botId = projectId === 'global' ? 'bot_global' : this.r.get(projectId).leadBotId; const session = this.session(botId, projectId); return { session, bot: this.r.get(botId), events: this.s.sessionEvents(session.id).filter(e => ['user/message', 'assistant/message', 'turn/end'].includes(e.type)), pending: this.s.all("SELECT * FROM confirmations WHERE session_id=? AND state='pending'", session.id).map(c => ({ ...c, data: JSON.parse(c.data) })), runs: this.s.all('SELECT * FROM runs WHERE session_id=? ORDER BY started_at DESC LIMIT 30', session.id) }; }
}
