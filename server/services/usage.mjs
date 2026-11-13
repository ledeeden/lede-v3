// Modified adaptation of DeepSeek Harness token-meter usage-projection.ts and
// turn-usage.ts (MIT, Copyright (c) 2026 DeepSeek), pinned in upstream/manifest.json.
// Last sample replaces the previous sample; each physical retry is a separate attempt.
// Chat Completions prompt_tokens INCLUDES cache reads, unlike Harness Messages inputTokens.
import { analyzeRequest } from './request-log.mjs';
import { uid, now } from '../db.mjs';
import { assert } from '../../shared/schema.mjs';

import { normalizeUsage, aggregateUsage } from '../../shared/usage.mjs';
export { normalizeUsage, aggregateUsage } from '../../shared/usage.mjs';

export class UsageLedger {
    constructor(s) {
        this.s = s;
        s.db.exec(`CREATE TABLE IF NOT EXISTS usage_calls(id TEXT PRIMARY KEY, request_id TEXT NOT NULL, attempt INTEGER NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS usage_created ON usage_calls(created_at);
            CREATE INDEX IF NOT EXISTS usage_request ON usage_calls(request_id);
            CREATE TABLE IF NOT EXISTS usage_request_logs(request_id TEXT PRIMARY KEY,body TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS usage_response_logs(call_id TEXT PRIMARY KEY,body TEXT NOT NULL);`);
        if (!s.getMeta('usageStartedAt', null)) s.setMeta('usageStartedAt', now());
        // No external IO is replayed after restart.
        for (const row of s.all('SELECT id,data FROM usage_calls')) {
            const data = JSON.parse(row.data);
            if (data.state === 'running') this.finish(row.id, { state: 'interrupted', error: '服务退出，未取得最终用量' });
        }
        this.backfill();
    }
    backfill() {
        if (this.s.getMeta('usageHistoryImported', false)) return;
        this.s.transaction(() => {
            const rows = this.s.all(`SELECT e.*,s.project_id,s.bot_id FROM session_events e JOIN sessions s ON s.id=e.session_id WHERE e.type IN ('assistant/message','context/checkpoint') ORDER BY e.seq`);
            for (const e of rows) {
                const d = JSON.parse(e.data), run = d.runId ? this.s.get('SELECT * FROM runs WHERE id=?', d.runId) : null;
                const raw = d.usage ?? d.message?.usage ?? null;
                const data = { projectId:e.project_id, botId:e.bot_id, runId:run?.id ?? null, sessionId:e.session_id,
                    purpose:e.type === 'context/checkpoint' ? 'compression' : 'execution', model:d.message?.source?.model ?? '历史模型未知',
                    kind:'chat', state:run?.state ?? 'historical', raw, ...normalizeUsage(raw), historical:true, endedAt:e.created_at };
                this.s.run('INSERT OR IGNORE INTO usage_calls VALUES(?,?,?,?,?)', 'history:'+e.seq, 'history:'+e.seq, 1, e.created_at, JSON.stringify(data));
            }
            this.s.setMeta('usageHistoryImported', true);
        });
    }
    begin(context, requestId, attempt, model, kind) {
        const id = uid('usage_');
        const data = { ...context, model, kind, purpose:context.purpose ?? (kind === 'embedding' ? 'embedding' : 'other'), state:'running', raw:null, ...normalizeUsage(null, kind) };
        this.s.run('INSERT INTO usage_calls VALUES(?,?,?,?,?)', id, requestId, attempt, now(), JSON.stringify(data));
        return id;
    }
    saveRequest(requestId, body) {
        this.s.run('INSERT OR IGNORE INTO usage_request_logs VALUES(?,?)',requestId,JSON.stringify(body));
    }
    saveResponse(id, body) {
        if(id) this.s.run('INSERT INTO usage_response_logs VALUES(?,?) ON CONFLICT(call_id) DO UPDATE SET body=excluded.body',id,JSON.stringify(body));
    }
    finish(id, patch) {
        if (!id) return;
        const row = this.s.get('SELECT data FROM usage_calls WHERE id=?',id);
        if (!row) return;
        const data = { ...JSON.parse(row.data), ...patch, endedAt:now() };
        Object.assign(data, normalizeUsage(data.usageFinal === false ? null : data.raw, data.kind));
        this.s.run('UPDATE usage_calls SET data=? WHERE id=?', JSON.stringify(data),id);
        this.s.event('usage.updated',id,{});
    }
    rows() {
        return this.s.all('SELECT * FROM usage_calls ORDER BY created_at DESC,id').map(row => {
            const d=JSON.parse(row.data), p=d.projectId ? this.s.get('SELECT title FROM resources WHERE id=?',d.projectId) : null,
                b=d.botId ? this.s.get('SELECT title FROM resources WHERE id=?',d.botId) : null,
                run=d.runId ? this.s.get('SELECT state,error FROM runs WHERE id=?',d.runId) : null;
            return { ...d,id:row.id, requestId:row.request_id, attempt:row.attempt, createdAt:row.created_at,
                projectId:d.projectId ?? 'unassigned', projectTitle:d.projectId==='global'?'总助':p?.title ?? (d.projectId ? '已删除项目' : '未归属项目'),
                botTitle:b?.title ?? (d.botId?'已删除成员':'后台服务'), runState:run?.state, runError:run?.error };
        });
    }
    query(a={}) {
        const start = a.start ? Date.parse(a.start) : -Infinity, end = a.end ? Date.parse(a.end) : Infinity;
        assert(!Number.isNaN(start) && !Number.isNaN(end) && start < end,'无效时间范围');
        const rows=this.rows().filter(x => Date.parse(x.createdAt)>=start && Date.parse(x.createdAt)<end &&
            (!a.projectId || x.projectId===a.projectId) && (!a.botId || x.botId===a.botId) && (!a.model || x.model===a.model) && (!a.purpose || x.purpose===a.purpose));
        return { rows, totals:aggregateUsage(rows), startedAt:this.s.getMeta('usageStartedAt',null), historyPartial:true };
    }
    detail(id) {
        const rows=this.rows(), row=rows.find(x=>x.id===id); assert(row,'调用不存在',404);
        const attempts=rows.filter(x=>x.requestId===row.requestId).sort((a,b)=>a.attempt-b.attempt);
        const request=this.s.get('SELECT body FROM usage_request_logs WHERE request_id=?',row.requestId);
        const response=this.s.get('SELECT body FROM usage_response_logs WHERE call_id=?',id);
        let output=response?JSON.parse(response.body):null, event=null;
        if(!output) {
            if(id.startsWith('history:')) event=this.s.get('SELECT * FROM session_events WHERE seq=?',Number(id.slice(8)));
            else if(row.sessionId && row.runId && row.step && row.purpose==='execution' && row.state==='succeeded')
                event=this.s.all("SELECT * FROM session_events WHERE session_id=? AND type='assistant/message' AND step=?",row.sessionId,row.step).find(e=>JSON.parse(e.data).runId===row.runId);
            if(event) {
                const data=JSON.parse(event.data);
                output={message:data.message??{content:data.summary},complete:true,source:'historical-event'};
            }
        }
        const step=row.step??event?.step;
        const tools=(row.purpose==='execution' && row.runId && step && output?.message?.tool_calls ? output.message.tool_calls : []).map(c=>this.s.get('SELECT * FROM tool_calls WHERE id=? AND run_id=?',row.runId+':'+step+':'+c.id,row.runId)).filter(Boolean).map(t=>({...t,args:JSON.parse(t.args),result:(()=>{const full=this.s.get('SELECT body FROM tool_outputs WHERE call_key=?',t.id);return full?JSON.parse(full.body):t.result?JSON.parse(t.result):null;})()}));
        const body=request?JSON.parse(request.body):null;
        return {row,attempts,tools,log:{request:body,response:output,analysis:analyzeRequest(body,row,attempts),
            durationMs:!row.historical && row.endedAt?Math.max(0,Date.parse(row.endedAt)-Date.parse(row.createdAt)):null,
            requestAvailable:!!body, responseAvailable:!!output}};
    }
}
