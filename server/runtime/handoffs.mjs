/** Adapted from DS-Bot handoffs.js (Apache-2.0), pinned a66cc737.
 * Extracted: openWork parent links; hold until child results consumed; ancestor-cycle
 * guard; automatic return; explicit abandoned/late settlements. Replaced global rt
 * and state.json/result files with SQLite records + durable wake messages.
 */
import { assert } from '../../shared/schema.mjs';
import { uid, now } from '../db.mjs';
export class Handoffs {
    constructor(s) { this.s = s; this.deliver = () => { }; }
    get(id) { return id ? this.s.get('SELECT * FROM works WHERE id=?', id) : undefined; }
    upstreamOf(workIds) { const bots = new Set(); for (const workId of workIds) {
        const seen = new Set();
        for (let id = workId; id && !seen.has(id);) {
            const w = this.get(id);
            if (!w)
                break;
            seen.add(id);
            if (w.sender)
                bots.add(w.sender);
            id = w.parent_id;
        }
    } return bots; }
    open({ id = uid('work_'), projectId, from, to, parent, message }) { const above = this.get(parent); assert(!above || above.project_id === projectId || (above.project_id === 'global' && from === 'bot_global'), '跨项目委派链被拒绝'); assert(!this.upstreamOf(parent ? [parent] : []).has(to), '目标正在等待这件工作的结果，请结束回合自动交回，不要回派上游'); assert(from !== to, '不能委派给自己'); const t = now(); this.s.run('INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?,?,?)', id, projectId, from, to, above ? parent : null, 'open', message, null, null, t, t); return this.get(id); }
    children(id) { return this.s.all('SELECT * FROM works WHERE parent_id=? ORDER BY created_at', id); }
    waiting(id) { return this.children(id).some(c => ['open', 'waiting', 'delivered'].includes(c.state)); }
    hold(id, text) { this.s.run("UPDATE works SET state='waiting',held=?,updated_at=? WHERE id=? AND state IN ('open','waiting')", text, now(), id); }
    taken(id) { this.s.run("UPDATE works SET state='consumed',updated_at=? WHERE id=? AND state='delivered'", now(), id); }
    answerText(id, reply) { const w = this.get(id); const results = this.children(id).filter(x => x.result).map(x => `${x.recipient}:\n${x.result}`); return [reply || w?.held || '执行完成，没有补充文字。', ...results.length ? ['\n[下游返回]', ...results] : []].join('\n\n'); }
    settle(id, text, { failed = false, abandoned = false } = {}) { return this.s.transaction(() => { const w = this.get(id); if (!w)
        return { missing: true }; if (['consumed', 'delivered', 'abandoned'].includes(w.state))
        return { duplicate: true }; const result = abandoned ? '[等待已放弃] ' + text : failed ? '[失败] ' + text : text; this.s.run('UPDATE works SET state=?,result=?,updated_at=? WHERE id=?', abandoned ? 'abandoned' : 'delivered', result, now(), id); const above = this.get(w.parent_id); if (w.sender === '@user') {
        this.s.run("UPDATE works SET state='consumed' WHERE id=?", id);
        this.s.event('work.completed', id, { projectId: w.project_id, result });
        return { root: true };
    } this.deliver({ projectId: above?.project_id ?? w.project_id, botId: w.sender, message: result, source: { kind: 'bot', role: 'reply', workId: above?.id, replyWorkId: id, from: w.recipient }, messageId: 'result_' + id, when: 'queue' }); this.s.event('work.settled', id, { projectId: w.project_id, failed, abandoned }); return { parent: above?.id }; }); }
    reconcile(resources) { for (const w of this.s.all("SELECT * FROM works WHERE state IN ('open','waiting')")) {
        if (!resources.maybe(w.recipient))
            this.settle(w.id, '执行 Bot 已不存在', { failed: true });
    } }
}
