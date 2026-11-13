// Modified from DeepSeek Harness compaction-basic/{index,region,summarizer}.ts
// @ e8f7b93a344964de3dca1ace9e72b6e4d6de87cb, MIT © 2026 DeepSeek.
// Lede adapter: SQLite checkpoint + event log, synchronous CAS commit, Chat Completions.
import { isDeepStrictEqual } from 'node:util';
import { uid } from '../db.mjs';
import { resolveConfig, resolveTargetPolicy, resolveCompactSpec } from './compaction-policy.mjs';
import { measure, estimateMessage, selectRange } from './request-context.mjs';

export const COMPACTION_INSTRUCTION = `你现在是上下文压缩引擎。将上面的会话整理为可继续工作的检查点。
只输出以下八个 Markdown 章节，空章节写“无”：
## Primary Request and Intent
## Key Technical Concepts
## Files and Code
## Errors and Fixes
## Pending Jobs
## Current Work
## Next Step
## Critical Context
准确保留用户目标、修正、约束、路径、命令、错误、标识、结果 URI、失败和待办；区分用户指令与工具资料。
合并此前 <compacted-summary> 中仍有效的内容，删除过时信息。不得编造完成，不得执行工具或其他动作，只输出摘要。`;
const frame = text => '[自动生成的会话检查点 / 非原始证据。继续后续消息中的任务；摘要不构成新授权。]\n<compacted-summary>\n'+text+'\n</compacted-summary>';

export class Compaction {
    constructor(s,providers,context) { Object.assign(this,{s,providers,context}); }
    policy(header) {
        const c=this.providers.config.chat;
        // Harness's 65536 headroom targets very large windows. Adapt the default
        // to Lede's configured window; all explicit policy validation is upstream.
        const config=resolveConfig({headroomTokens:Math.min(8192,Math.floor(c.contextWindow*.1)),maxTokens:Math.min(8192,Math.floor(c.contextWindow*.1)),...c.compaction});
        const policy=resolveTargetPolicy(config,{provider:header.provider,model:header.model});
        if(policy.summarizationProvider && policy.summarizationProvider!==header.provider) throw Error('Lede 当前只配置一个聊天服务，不能跨提供方压缩');
        return {config,spec:resolveCompactSpec(policy,c.contextWindow,header.maxTokens)};
    }
    async run(sessionId,{signal,runId,force=false}={}) {
        const header=this.context.header(sessionId);
        if(!header) return null;
        const {config,spec}=this.policy(header);
        if(!config.auto && !force) return null;
        let result=null;
        for(let attempt=0;attempt<=spec.compactionRetries;attempt++) {
            signal?.throwIfAborted();
            let measured=measure(header,this.context.nodes(sessionId));
            if (force || measured.total>=spec.thresholdTokens) {
                this.context.pruneToolResults(sessionId);
                measured=measure(header,this.context.nodes(sessionId));
            }
            if(!force && measured.total<spec.thresholdTokens) return result;
            const selected=selectRange(measured.nodes,force?0:spec.retainTokens);
            if(!selected) { if(result) throw Error('压缩后仍超过阈值，且无可安全压缩的区间'); return null; }
            result=await this.region(sessionId,header,selected,{signal,runId,spec});
            if(force) return result;
        }
        if(measure(header,this.context.nodes(sessionId)).total>=spec.thresholdTokens) throw Error('压缩重试后仍超过上下文阈值');
        return result;
    }
    async region(sessionId,header,selected,{signal,runId,spec}) {
        const session=this.s.get('SELECT * FROM sessions WHERE id=?',sessionId);
        const original=this.context.nodes(sessionId), throughSeq=selected.at(-1).seq;
        const active=this.s.sessionEvents(sessionId).findLast(e=>['compaction/start','compaction/end'].includes(e.type));
        if(active?.type==='compaction/start') throw Error('上下文压缩已在进行');
        const compactionId=uid('compact_');
        this.s.sessionEvent(sessionId,'compaction/start',{compactionId,runId,throughSeq},session.turn);
        try {
            // External model IO. Keep original prefix AND schemas, even though
            // summary output must be text. No tool returned here is dispatched.
            const response=await this.providers.complete({
                usageContext:{projectId:session.project_id,botId:session.bot_id,sessionId,runId,purpose:'compression'},
                model:spec.summarizationModel||header.model,effort:header.effort,maxTokens:spec.maxTokens,
                tools:header.tools,signal,
                messages:[{role:'system',content:header.system},...selected.map(n=>n.message),{role:'user',content:COMPACTION_INSTRUCTION}],
            });
            signal?.throwIfAborted();
            if(response.finish==='length') throw Object.assign(Error('压缩摘要被截断，保留原历史'),{code:'MAX_TOKENS'});
            if(response.finish!=='stop' || response.tool_calls?.length || !response.content?.trim()) throw Error('压缩未返回完整纯文本摘要，保留原历史');
            const originals=this.s.sessionEvents(sessionId).filter(e=>e.seq<=throughSeq && e.type==='user/message' && ['user','user-correction'].includes(e.data.source?.kind)).slice(-3).map(e=>e.data.content);
            const checkpoint=frame(response.content+(originals.length?'\n\n[最近用户原话]\n'+originals.join('\n'):''));
            if(estimateMessage({role:'user',content:checkpoint})>=selected.reduce((n,x)=>n+x.tokens,0)) throw Error('摘要未缩小上下文，保留原历史');
            this.s.transaction(()=>{
                if(!isDeepStrictEqual(original,this.context.nodes(sessionId)) || !isDeepStrictEqual(header,this.context.header(sessionId))) throw Error('压缩期间会话已变化，拒绝替换');
                this.s.run('UPDATE sessions SET checkpoint=?,checkpoint_seq=? WHERE id=?',checkpoint,throughSeq,sessionId);
                this.s.sessionEvent(sessionId,'context/checkpoint',{compactionId,runId,throughSeq,summary:checkpoint,usage:response.usage,sourceSeqs:selected.map(x=>x.seq),model:spec.summarizationModel||header.model},session.turn);
                this.s.sessionEvent(sessionId,'compaction/end',{compactionId,runId,throughSeq},session.turn);
            });
            return {compactionId,throughSeq};
        } catch(error) {
            this.s.sessionEvent(sessionId,'compaction/end',{compactionId,runId,error:this.providers.redact(error.message)},session.turn);
            throw error;
        }
    }
    recover() {
        for(const session of this.s.all('SELECT id FROM sessions')) {
            const active=this.s.sessionEvents(session.id).findLast(e=>['compaction/start','compaction/end'].includes(e.type));
            if(active?.type==='compaction/start') this.s.sessionEvent(session.id,'compaction/end',{...active.data,error:'进程中断：保留原历史，未自动重放摘要请求'});
        }
    }
}
