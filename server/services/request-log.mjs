import { hash } from '../db.mjs';

const size = value => JSON.stringify(value ?? null).length;
// Structural sizes are characters, never provider token allocations.
export function analyzeRequest(body, row, attempts) {
    if (!body) return null;
    const groups = new Map(), seen = new Set(); let duplicates = 0;
    const messages = (body.messages ?? []).map((message,index) => {
        const category = message.role === 'system' ? '系统指令' : message.role === 'tool' ? '工具返回' :
            String(message.content).startsWith('[当前项目上下文快照]') ? '项目上下文' : message.role === 'assistant' ? '历史模型消息' : '用户与历史输入';
        const chars=size(message), fingerprint=hash(message);
        if(seen.has(fingerprint)) duplicates++; seen.add(fingerprint);
        groups.set(category,(groups.get(category)??0)+chars);
        return {index,category,role:message.role,chars,message};
    });
    if(body.tools?.length) groups.set('工具定义',size(body.tools));
    if(body.input !== undefined) groups.set('向量输入',size(body.input));
    const sections=[...groups].map(([name,chars])=>({name,chars})).sort((a,b)=>b.chars-a.chars);
    const contentChars=sections.reduce((n,x)=>n+x.chars,0), findings=[];
    const largest=sections[0];
    if(largest) findings.push(`最大输入部分是${largest.name}，占已分类内容字符的 ${(largest.chars/Math.max(1,contentChars)*100).toFixed(1)}%。字符占比不等于 Token 占比。`);
    if((groups.get('工具返回')??0)>contentChars*.3) findings.push('工具返回占比较高：可检查是否只需字段摘要或分段读取，完整证据继续保留在工具账本中。');
    if((groups.get('工具定义')??0)>contentChars*.2) findings.push('工具定义占比较高：可按成员职责缩小工具集合，避免每轮发送无关工具。');
    if(duplicates) findings.push(`发现 ${duplicates} 条完全相同的重复输入消息。先核对语义与 tool-call/result 配对，再决定是否精简。`);
    if(attempts.length>1) findings.push(`该请求发生 ${attempts.length} 次尝试；优先检查失败原因，重试会产生额外请求。`);
    if(row.input>0 && row.hit!==null && row.hit/row.input<.3) findings.push('本次缓存命中率低于 30%。可检查稳定指令与工具定义是否放在前部、动态上下文是否频繁改变；单次低命中不证明存在问题。');
    return {messages,sections,contentChars,bodyChars:size(body),toolCount:body.tools?.length??0,duplicates,findings};
}
