import { readFileSync, writeFileSync, renameSync, chmodSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { assert, AppError } from '../../shared/schema.mjs';
import { hash, uid, now } from '../db.mjs';
import { AsyncLocalStorage } from 'node:async_hooks';
const sleep = (ms, signal) => new Promise((resolve, reject) => { const t = setTimeout(resolve, ms); signal?.addEventListener('abort', () => { clearTimeout(t); reject(signal.reason ?? new Error('Canceled')); }, { once: true }); });
/** OpenAI-compatible Chat Completions and embeddings provider. No mock route in production. */
export class Providers {
    constructor(home) { this.meters = new AsyncLocalStorage(); this.context = new AsyncLocalStorage(); this.file = join(home, 'providers.json'); this.config = existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) : {}; this.config.chat ??= { baseURL: 'https://api.deepseek.com', model: 'deepseek-chat', apiKey: '', contextWindow: 65536, maxTokens: 4096, timeoutMs: 120000 }; this.config.embedding ??= { baseURL: '', model: '', apiKey: '' }; this.config.allowShell ??= false; this.config.allowNetwork ??= true; }
    public() { const out = structuredClone(this.config); for (const key of ['chat', 'embedding']) {
        out[key].configured = !!(out[key].baseURL && out[key].model);
        out[key].hasKey = !!out[key].apiKey;
        delete out[key].apiKey;
    } out.chat.configured = !!(this.config.chat.apiKey || this.config.chat.allowAnonymous); return out; }
    save(patch) {
        for (const kind of ['chat', 'embedding'])
            if (patch[kind]) {
                const next = { ...this.config[kind], ...patch[kind] };
                assert(Object.keys(patch[kind]).every(k => ['baseURL', 'model', 'apiKey', 'allowAnonymous', 'contextWindow', 'maxTokens', 'timeoutMs', 'effort'].includes(k)), 'Unknown provider field');
                if (next.baseURL) {
                    const u = new URL(next.baseURL);
                    assert(['https:', 'http:'].includes(u.protocol) && !u.username && !u.password, 'Invalid provider URL');
                    next.baseURL = next.baseURL.replace(/\/+$/, '');
                }
                assert(typeof next.model === 'string' && next.model.length < 200, 'Invalid model');
                next.maxTokens = Math.max(256, Math.min(32000, Number(next.maxTokens) || 4096));
                next.contextWindow = Math.max(next.maxTokens + 4096, Number(next.contextWindow) || 65536);
                next.timeoutMs = Math.min(600000, Math.max(1000, Number(next.timeoutMs) || 120000));
                this.config[kind] = next;
            }
        for (const key of ['allowShell', 'allowNetwork'])
            if (patch[key] !== undefined)
                this.config[key] = !!patch[key];
        writeFileSync(this.file + '.tmp', JSON.stringify(this.config, null, 2), { mode: 0o600 });
        renameSync(this.file + '.tmp', this.file);
        chmodSync(this.file, 0o600);
        return this.public();
    }
    configured() { return !!(this.config.chat.apiKey || this.config.chat.allowAnonymous); }
    embeddingConfigured() { const c = this.config.embedding; return !!(c.baseURL && c.model && (c.apiKey || c.allowAnonymous)); }
    embeddingIdentity() { const c = this.config.embedding; return c.model + '@' + hash(c.baseURL).slice(0, 12); }
    redact(text) { let out = String(text); for (const c of [this.config.chat, this.config.embedding])
        if (c.apiKey)
            out = out.replaceAll(c.apiKey, '[REDACTED]'); return out; }
    endpoint(c, suffix) { const b = c.baseURL.replace(/\/+$/, ''); return b.endsWith('/v1') || b.includes('/api/') || b === 'https://api.deepseek.com' ? b + suffix : b + '/v1' + suffix; }
    redactLog(value) {
        if(typeof value==='string') return this.redact(value);
        if(Array.isArray(value)) return value.map(x=>this.redactLog(x));
        if(value && typeof value==='object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,this.redactLog(v)]));
        return value;
    }
    saveResponseLog(value) { const meter=this.meters.getStore(); if(meter?.id) this.ledger?.saveResponse(meter.id,this.redactLog(value)); }
    withContext(context, fn) { return this.context.run({ ...this.context.getStore(), ...context }, fn); }
    async metered(kind, context, fn) {
        const meter = { requestId: uid('request_'), context: { ...this.context.getStore(), ...context }, kind, id:null, raw:null };
        return this.meters.run(meter, async () => {
            try { const result = await fn(); this.ledger?.finish(meter.id, { raw:meter.raw, usageFinal:true, state:'succeeded', ...(meter.model ? { model:meter.model } : {}) }); return result; }
            catch (error) { this.ledger?.finish(meter.id, { raw:meter.raw, usageFinal:meter.terminal===true, state:error.name === 'AbortError' ? 'canceled' : 'failed', error:this.redact(error.message), ...(meter.model ? { model:meter.model } : {}) }); throw error; }
        });
    }
    captureUsage(raw, model) { const meter=this.meters.getStore(); if(meter) { if(raw) meter.raw=raw; if(model) meter.model=model; } }
    async balance() {
        const c=this.config.chat, url=new URL(c.baseURL);
        assert(url.origin === 'https://api.deepseek.com' && c.apiKey, '余额查询仅支持配置了 API Key 的 DeepSeek 官方接口',409);
        // External read-only IO. Never send the configured key to a different host.
        const res=await fetch('https://api.deepseek.com/user/balance',{headers:{Authorization:'Bearer '+c.apiKey},signal:AbortSignal.timeout(15000),redirect:'error'});
        assert(res.ok,'DeepSeek 余额查询失败',502);
        const data=await res.json();
        assert(Array.isArray(data.balance_infos),'余额响应格式不正确',502);
        return { checkedAt:now(), balances:data.balance_infos.map(x=>({currency:x.currency,total:x.total_balance})) };
    }
    async request(kind, suffix, body, signal) {
        const c = this.config[kind];
        assert(c.baseURL && c.model && (c.apiKey || c.allowAnonymous), '请先配置模型地址、模型名称和 API Key（本地模型可启用无需 Key）', 409, 'MODEL_NOT_CONFIGURED');
        const timeout = AbortSignal.timeout(c.timeoutMs ?? 120000);
        const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
        let response;
        for (let attempt = 0; attempt < 3; attempt++) {
            combined.throwIfAborted();
            const meter=this.meters.getStore();
            if(meter) { meter.raw=null; meter.terminal=false; meter.id=this.ledger?.begin(meter.context,meter.requestId,attempt+1,body.model,kind); this.ledger?.saveRequest(meter.requestId,this.redactLog(body)); }
            try {
                // External provider IO; every physical attempt has its own durable ledger row.
                response = await fetch(this.endpoint(c, suffix), { method: 'POST', headers: { 'Content-Type': 'application/json', ...(c.apiKey ? { Authorization: 'Bearer ' + c.apiKey } : {}) }, body: JSON.stringify(body), signal: combined });
                if (response.ok)
                    return response;
                this.ledger?.finish(meter?.id,{state:'failed',error:'HTTP '+response.status});
                if(meter) meter.id=null;
                if ([408, 429, 500, 502, 503, 504].includes(response.status) && attempt < 2) {
                    await response.body?.cancel();
                    await sleep(400 * 2 ** attempt, combined);
                    continue;
                }
                const text = await response.text();
                throw new AppError(this.redact(`模型请求失败 HTTP ${response.status}: ${text.slice(0, 1000)}`), 502, 'PROVIDER_ERROR');
            }
            catch (e) {
                this.ledger?.finish(meter?.id,{state:combined.aborted?'interrupted':'failed',error:this.redact(e.message)});
                if(meter) meter.id=null;
                if (e instanceof AppError || combined.aborted || attempt === 2)
                    throw e;
                await sleep(300 * 2 ** attempt, combined);
            }
        }
    }
    async complete(options={}) { return this.metered('chat',options.usageContext,()=>this.completeResponse(options)); }
    async completeResponse({ messages, tools = [], model, effort, signal, onDelta = () => { }, maxTokens } = {}) {
        const c = this.config.chat;
        const body = { model: model || c.model, messages, stream: true, stream_options: { include_usage:true }, max_tokens: maxTokens ?? c.maxTokens };
        if (tools.length) {
            body.tools = tools;
            body.tool_choice = 'auto';
        }
        if (effort || c.effort)
            body.reasoning_effort = effort || c.effort;
        const res = await this.request('chat', '/chat/completions', body, signal);
        if (!res.headers.get('content-type')?.includes('text/event-stream')) {
            const data = await res.json();
            this.captureUsage(data.usage,data.model); this.meters.getStore().terminal=true;
            const m = data.choices?.[0]?.message;
            this.saveResponseLog({message:m??null,finish:data.choices?.[0]?.finish_reason,complete:true});
            assert(m, '模型未返回 choices[0].message', 502, 'PROVIDER_PROTOCOL');
            return { ...m, role: 'assistant', content: m.content ?? '', usage: data.usage, finish: data.choices[0].finish_reason };
        }
        const reader = res.body.getReader(), decoder = new TextDecoder();
        let buffer = '', content = '', reasoning = '', finish, usage, sawDone = false;
        const calls = new Map();
        let bytes = 0;
        const process = line => { if (!line.startsWith('data:'))
            return; const payload = line.slice(5).trim(); if (!payload)
            return; if (payload === '[DONE]') {
            sawDone = true;
            return;
        } let item; try {
            item = JSON.parse(payload);
        }
        catch {
            throw new AppError('模型流包含无效 JSON', 502, 'PROVIDER_PROTOCOL');
        } if (item.error)
            throw new AppError(this.redact(item.error.message ?? JSON.stringify(item.error)), 502, 'PROVIDER_ERROR'); if (item.usage)
            usage = item.usage; this.captureUsage(item.usage,item.model); const choice = item.choices?.[0]; if (!choice)
            return; if (choice.finish_reason)
            { finish = choice.finish_reason; this.meters.getStore().terminal=true; } const d = choice.delta ?? {}; if (d.content) {
            content += d.content;
            onDelta({ text: d.content });
        } if (d.reasoning_content) {
            reasoning += d.reasoning_content;
            onDelta({ reasoning: d.reasoning_content });
        } for (const t of d.tool_calls ?? []) {
            const index = t.index ?? 0;
            const old = calls.get(index) ?? { id: '', type: 'function', function: { name: '', arguments: '' } };
            if (t.id)
                old.id = t.id;
            if (t.function?.name)
                old.function.name += t.function.name;
            if (t.function?.arguments)
                old.function.arguments += t.function.arguments;
            calls.set(index, old);
        } };
        try {
            while (true) {
                signal?.throwIfAborted();
                const { value, done } = await reader.read();
                if (done)
                    break;
                bytes += value.byteLength;
                assert(bytes < 16000000, 'Model stream exceeded 16 MB', 502);
                buffer += decoder.decode(value, { stream: true });
                let pos;
                while ((pos = buffer.indexOf('\n')) !== -1) {
                    process(buffer.slice(0, pos).replace(/\r$/, ''));
                    buffer = buffer.slice(pos + 1);
                }
            }
            buffer += decoder.decode();
            if (buffer.trim())
                process(buffer.trim());
            assert(sawDone || finish, '模型流中断，未收到终止记录', 502, 'STREAM_INTERRUPTED');
        }
        finally {
            this.saveResponseLog({message:{role:'assistant',content,reasoning_content:reasoning,tool_calls:[...calls.entries()].sort((a,b)=>a[0]-b[0]).map(([,v])=>v)},finish:finish??null,complete:!!(sawDone||finish)});
            reader.releaseLock();
        }
        const tool_calls = [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
        assert(tool_calls.length <= 64 && new Set(tool_calls.map(c => c.id)).size === tool_calls.length, '工具调用重复或超过单步上限', 502, 'PROVIDER_PROTOCOL');
        for (const call of tool_calls) {
            assert(call.id && call.function.name, 'Incomplete tool call', 502);
            try {
                JSON.parse(call.function.arguments || '{}');
            }
            catch {
                throw new AppError('工具参数 JSON 不完整', 502, 'TOOL_ARGS_TRUNCATED');
            }
        }
        return { role: 'assistant', content, ...tool_calls.length ? { tool_calls } : {}, ...(reasoning ? { reasoning_content: reasoning } : {}), usage, finish };
    }
    async embed(texts, signal) { return this.metered('embedding',{purpose:'embedding'},()=>this.embedResponse(texts,signal)); }
    async embedResponse(texts, signal) { const c = this.config.embedding; const response = await this.request('embedding', '/embeddings', { model: c.model, input: texts }, signal); const data = await response.json(); this.captureUsage(data.usage,data.model); assert(Array.isArray(data.data) && data.data.length === texts.length, 'Embedding 数量不匹配', 502); this.saveResponseLog({complete:true,embeddingCount:data.data.length,dimensions:data.data[0]?.embedding?.length,note:'向量数值不写入请求日志'}); const list = data.data.sort((a, b) => a.index - b.index).map(x => x.embedding); const dim = list[0]?.length; assert(dim > 0 && dim <= 32768 && list.every(v => v.length === dim && v.every(Number.isFinite)), 'Embedding 向量格式不正确', 502); return list; }
    async test() { const m = await this.complete({ usageContext:{purpose:'connection-test'}, messages: [{ role: 'user', content: 'Respond with only OK.' }], maxTokens: 32 }); return { ok: true, model: this.config.chat.model, response: m.content }; }
}
