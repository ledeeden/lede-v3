/** Adapted from DeepSeek Harness inbox.ts, MIT © 2026 DeepSeek.
 * upstream e8f7b93a344964de3dca1ace9e72b6e4d6de87cb / packages/core/agent-loop/src/inbox.ts
 * Changes: remove Cordis/Zod/types; durable SQLite event+projection transaction;
 * same splice normalization, global unique message IDs, next-step first claim.
 */
import { assert } from '../../shared/schema.mjs';
import { now } from '../db.mjs';
export function applyInboxSplice(state, event) { if (event.type !== 'agent/inbox/spliced')
    return state; const s = event.data, inbox = state[s.target], count = s.removedCount ?? 0; assert(inbox && Number.isSafeInteger(s.start) && s.start >= 0 && s.start <= inbox.length && Number.isSafeInteger(count) && count >= 0 && s.start + count <= inbox.length, 'Invalid persisted inbox splice'); const next = inbox.toSpliced(s.start, count, ...s.inserted); const combined = s.target === 'next-turn' ? [...next, ...state['next-step']] : [...state['next-turn'], ...next]; assert(new Set(combined.map(m => m.id)).size === combined.length, 'Duplicate pending message'); return { ...state, [s.target]: next }; }
export class DurableInbox {
    constructor(store, sessionId) { this.s = store; this.id = sessionId; }
    state() { const state = { 'next-turn': [], 'next-step': [] }; for (const r of this.s.all('SELECT * FROM inbox WHERE session_id=? ORDER BY rowid', this.id))
        state[r.target].push(JSON.parse(r.message)); return state; }
    get nextTurn() { return this.state()['next-turn']; }
    get nextStep() { return this.state()['next-step']; }
    get hasPending() { return !!this.s.get('SELECT id FROM inbox WHERE session_id=? LIMIT 1', this.id); }
    splice(target, start, deleteCount, inserted, discard = true) { assert(['next-step', 'next-turn'].includes(target), 'Invalid inbox target'); return this.s.transaction(() => { const state = this.state(), inbox = state[target]; const trunc = Math.trunc(start), offset = Number.isNaN(trunc) ? 0 : trunc; const actualStart = offset < 0 ? Math.max(inbox.length + offset, 0) : Math.min(offset, inbox.length); const truncated = Math.trunc(deleteCount); const count = Math.min(Math.max(Number.isNaN(truncated) ? 0 : truncated, 0), inbox.length - actualStart); if (!count && !inserted.length)
        return []; const event = { type: 'agent/inbox/spliced', data: { target, start: actualStart, ...count ? { removedCount: count } : {}, inserted, ...discard && count ? { outcome: 'canceled' } : {} } }; const next = applyInboxSplice(state, event); const removed = inbox.slice(actualStart, actualStart + count); this.s.run('DELETE FROM inbox WHERE session_id=?', this.id); for (const t of ['next-turn', 'next-step'])
        for (const m of next[t])
            this.s.run('INSERT INTO inbox VALUES(?,?,?,?,?)', m.id, this.id, t, JSON.stringify(m), now()); this.s.sessionEvent(this.id, event.type, event.data); return removed; }); }
    append(target, message) { return this.splice(target, this.state()[target].length, 0, [message]); }
    prepend(target, message) { return this.splice(target, 0, 0, [message]); }
    claim(target, turn) { return this.s.transaction(() => { const claimed = this.splice('next-step', 0, this.nextStep.length, [], false); if (target === 'next-turn')
        claimed.push(...this.splice('next-turn', 0, 1, [], false)); for (const message of claimed)
        this.s.sessionEvent(this.id, 'agent/inbox/claimed', { message, turn }, turn); return claimed; }); }
    replace(id, message) { for (const target of ['next-turn', 'next-step']) {
        const index = this.state()[target].findIndex(x => x.id === id);
        if (index >= 0) {
            this.splice(target, index, 1, [message]);
            return true;
        }
    } return false; }
    clear() { this.splice('next-step', 0, this.nextStep.length, []); this.splice('next-turn', 0, this.nextTurn.length, []); }
}
