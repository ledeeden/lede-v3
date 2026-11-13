import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { acquireHomeLock } from './runtime/home-lock.mjs';
export const now = () => new Date().toISOString();
export const uid = (prefix = '') => prefix + randomUUID();
export const hash = x => createHash('sha256').update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex');
export class Store {
    constructor(home) {
        this.home = home;
        mkdirSync(home, { recursive: true, mode: 0o700 });
        mkdirSync(join(home, 'blobs'), { recursive: true });
        this.releaseLock = acquireHomeLock(home);
        this.db = new DatabaseSync(join(home, 'lede.sqlite'));
        this.events = new EventEmitter();
        this.events.setMaxListeners(100);
        this.depth = 0;
        this.pending = [];
        this.db.exec(`PRAGMA journal_mode=WAL;PRAGMA foreign_keys=ON;PRAGMA busy_timeout=5000;PRAGMA synchronous=FULL;
 CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS resources(id TEXT PRIMARY KEY,kind TEXT NOT NULL,title TEXT NOT NULL,owner_space TEXT NOT NULL DEFAULT 'local',status TEXT NOT NULL DEFAULT 'active',revision INTEGER NOT NULL DEFAULT 1,data TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS resources_kind ON resources(kind,status);
 CREATE TABLE IF NOT EXISTS versions(resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,revision INTEGER NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(resource_id,revision));
 CREATE TABLE IF NOT EXISTS project_links(project_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,role TEXT NOT NULL DEFAULT 'reference',PRIMARY KEY(project_id,resource_id));
 CREATE TABLE IF NOT EXISTS members(collection_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,position INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(collection_id,resource_id));
 CREATE TABLE IF NOT EXISTS relations(id TEXT PRIMARY KEY,source TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,target TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,type TEXT NOT NULL,metadata TEXT NOT NULL DEFAULT '{}',UNIQUE(source,target,type));
 CREATE TABLE IF NOT EXISTS chunks(id TEXT PRIMARY KEY,resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,revision INTEGER NOT NULL,level INTEGER NOT NULL DEFAULT 2,anchor TEXT NOT NULL,content TEXT NOT NULL,tokens TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS chunks_resource ON chunks(resource_id);
 CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(chunk_id UNINDEXED,title,tokens,tokenize='unicode61');
 CREATE TRIGGER IF NOT EXISTS chunks_delete AFTER DELETE ON chunks BEGIN DELETE FROM chunks_fts WHERE chunk_id=old.id; END;
 CREATE TABLE IF NOT EXISTS vectors(chunk_id TEXT PRIMARY KEY REFERENCES chunks(id) ON DELETE CASCADE,model TEXT NOT NULL,dimension INTEGER NOT NULL,vector TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,topic TEXT NOT NULL,resource_id TEXT,data TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,bot_id TEXT NOT NULL,project_id TEXT NOT NULL,thread TEXT NOT NULL DEFAULT 'main',state TEXT NOT NULL DEFAULT 'idle',turn INTEGER NOT NULL DEFAULT 0,checkpoint TEXT,checkpoint_seq INTEGER DEFAULT 0,UNIQUE(bot_id,project_id,thread));
 CREATE TABLE IF NOT EXISTS session_events(seq INTEGER PRIMARY KEY AUTOINCREMENT,session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,type TEXT NOT NULL,turn INTEGER NOT NULL DEFAULT 0,step INTEGER NOT NULL DEFAULT 0,data TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS session_event_order ON session_events(session_id,seq);
 CREATE TABLE IF NOT EXISTS inbox(id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,target TEXT NOT NULL,message TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,project_id TEXT NOT NULL,bot_id TEXT NOT NULL,work_id TEXT,state TEXT NOT NULL,turn INTEGER NOT NULL,step INTEGER NOT NULL DEFAULT 0,input TEXT NOT NULL,result TEXT,error TEXT,started_at TEXT NOT NULL,ended_at TEXT);
 CREATE TABLE IF NOT EXISTS tool_outputs(call_key TEXT PRIMARY KEY,run_id TEXT NOT NULL,body TEXT NOT NULL,bytes INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS widget_state(view_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,block_id TEXT NOT NULL,data TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(view_id,block_id));
 CREATE TABLE IF NOT EXISTS tool_calls(id TEXT PRIMARY KEY,run_id TEXT NOT NULL,name TEXT NOT NULL,args TEXT NOT NULL,state TEXT NOT NULL,result TEXT,started_at TEXT NOT NULL,ended_at TEXT);
 CREATE TABLE IF NOT EXISTS works(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,sender TEXT NOT NULL,recipient TEXT NOT NULL,parent_id TEXT,state TEXT NOT NULL,request TEXT NOT NULL,held TEXT,result TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS work_parent ON works(parent_id);
 CREATE TABLE IF NOT EXISTS requests(key TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,state TEXT NOT NULL,receipt TEXT,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS widget_versions(key TEXT PRIMARY KEY,widget_id TEXT NOT NULL,version TEXT NOT NULL,manifest TEXT NOT NULL,source TEXT NOT NULL,compiled TEXT,state TEXT NOT NULL,build_log TEXT,preview_ok INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,UNIQUE(widget_id,version));
 CREATE TABLE IF NOT EXISTS mounts(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,view_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,position INTEGER NOT NULL DEFAULT 0,pinned INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS confirmations(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,project_id TEXT NOT NULL,bot_id TEXT NOT NULL,run_id TEXT,title TEXT NOT NULL,data TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,type TEXT NOT NULL,resource_id TEXT,state TEXT NOT NULL,data TEXT NOT NULL,error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
 `);
        this.setMeta('schemaVersion', 1);
        try {
            chmodSync(join(home, 'lede.sqlite'), 0o600);
        }
        catch { }
    }
    run(sql, ...args) { return this.db.prepare(sql).run(...args); }
    get(sql, ...args) { return this.db.prepare(sql).get(...args); }
    all(sql, ...args) { return this.db.prepare(sql).all(...args); }
    transaction(fn) { if (this.depth) {
        this.depth++;
        try {
            return fn();
        }
        finally {
            this.depth--;
        }
    } this.db.exec('BEGIN IMMEDIATE'); this.depth = 1; this.pending = []; try {
        const r = fn();
        if (r && typeof r.then === 'function')
            throw new Error('SQLite transaction must be synchronous');
        this.db.exec('COMMIT');
        this.depth = 0;
        const pending = this.pending;
        this.pending = [];
        for (const e of pending) {
            try {
                this.events.emit('event', e);
            }
            catch (error) {
                console.error('Lede event observer failed after commit:', error.message);
            }
        }
        return r;
    }
    catch (e) {
        this.db.exec('ROLLBACK');
        this.depth = 0;
        this.pending = [];
        throw e;
    } }
    event(topic, resourceId, data = {}) { const created = now(); const r = this.run('INSERT INTO events(topic,resource_id,data,created_at) VALUES(?,?,?,?)', topic, resourceId ?? null, JSON.stringify(data), created); const e = { seq: Number(r.lastInsertRowid), topic, resourceId, data, createdAt: created }; if (this.depth)
        this.pending.push(e);
    else
        this.events.emit('event', e); return e; }
    sessionEvent(sessionId, type, data = {}, turn = 0, step = 0) { return this.transaction(() => { const r = this.run('INSERT INTO session_events(session_id,type,turn,step,data,created_at) VALUES(?,?,?,?,?,?)', sessionId, type, turn, step, JSON.stringify(data), now()); this.event('agent.event', sessionId, { sessionId, type, turn, step, data, seq: Number(r.lastInsertRowid) }); return Number(r.lastInsertRowid); }); }
    sessionEvents(id) { return this.all('SELECT * FROM session_events WHERE session_id=? ORDER BY seq', id).map(x => ({ ...x, data: JSON.parse(x.data) })); }
    getMeta(k, fallback) { const row = this.get('SELECT value FROM meta WHERE key=?', k); return row ? JSON.parse(row.value) : fallback; }
    setMeta(k, v) { this.run('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, JSON.stringify(v)); }
    blob(text) { const key = hash(text); const dest = join(this.home, 'blobs', key); writeFileSync(dest, text, { mode: 0o600 }); return key; }
    close() { try {
        this.db.close();
    }
    finally {
        this.releaseLock();
    } }
}
