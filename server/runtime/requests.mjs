// Adapted from Fei2411/DS-Bot requests.js, Apache-2.0.
// Source a66cc737cfb6c3d8a2597e748cded6cab1206dd3, blob d153e4742d78d73de4122ed4ecdc76a50ded5e05.
// Original request identity / fingerprint / pending-before-send / uncertain-outcome
// semantics retained. rt.state and rt.save replaced by a SQLite receipt repository.
import { randomUUID, createHash } from 'node:crypto';
import { assert } from '../../shared/schema.mjs';
import { now } from '../db.mjs';
export class RequestIdentity {
    constructor(s) { this.s = s; this.run = randomUUID(); this.inflight = new Map(); }
    identity({ caller, context, name, payload }) { assert(typeof name === 'string' && name.length > 0 && name.length <= 200, 'request_id 须为 1–200 字符'); return { key: `${caller}\u0000${context}\u0000${name}`, print: createHash('sha256').update(JSON.stringify(payload)).digest('hex') }; }
    verdict(request, record) { if (record.fingerprint !== request.print)
        return { status: 'conflict' }; if (record.state === 'delivered')
        return record.receipt === null ? { status: 'expired' } : { status: 'replay', receipt: JSON.parse(record.receipt) }; if (record.state === 'uncertain')
        return { status: 'uncertain' }; }
    async known(request) { const r = this.s.get('SELECT * FROM requests WHERE key=?', request.key); if (!r)
        return; const seen = this.verdict(request, r); if (seen)
        return seen; const p = this.inflight.get(request.key); if (!p)
        return { status: 'uncertain' }; await p.catch(() => { }); const settled = this.s.get('SELECT * FROM requests WHERE key=?', request.key); return settled ? (this.verdict(request, settled) ?? { status: 'uncertain' }) : undefined; }
    async admit(request, work) {
        const existing = await this.known(request);
        if (existing)
            return existing;
        // Recheck with no asynchronous gap between checking and persisting admission.
        const concurrent = this.s.get('SELECT * FROM requests WHERE key=?', request.key);
        if (concurrent)
            return this.known(request);
        this.s.run('INSERT INTO requests VALUES(?,?,?,?,?)', request.key, request.print, 'pending', null, now());
        const promise = (async () => { try {
            const receipt = await work();
            if (request.unsent === true) {
                this.s.run('DELETE FROM requests WHERE key=?', request.key);
                return receipt;
            }
            this.s.run("UPDATE requests SET state='delivered',receipt=? WHERE key=?", JSON.stringify(receipt), request.key);
            return receipt;
        }
        catch (error) {
            this.s.run("UPDATE requests SET state='uncertain' WHERE key=?", request.key);
            throw error;
        } })();
        this.inflight.set(request.key, promise);
        try {
            return { status: 'sent', receipt: await promise };
        }
        finally {
            this.inflight.delete(request.key);
        }
    }
}
