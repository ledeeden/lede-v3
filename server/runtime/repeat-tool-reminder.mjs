/** Modified adaptation of DeepSeek Harness repeat-tool-reminder (MIT © 2026 DeepSeek).
 * Source: packages/guard/repeat-tool-reminder/src/index.ts @ e8f7b93a344964de3dca1ace9e72b6e4d6de87cb.
 * Lede uses session keys and durable messages instead of Cordis additionalContexts.
 * Advisory only; process-local chains reset on human input, not compaction.
 */
function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value !== null && typeof value === 'object')
        return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
    return value;
}
export class RepeatToolReminder {
    constructor() { this.chains = new Map(); }
    reset(sessionId) { this.chains.delete(sessionId); }
    observe(sessionId, name, rawArguments) {
        let args;
        try { args = JSON.parse(rawArguments || '{}'); } catch { args = rawArguments; }
        const serialized = JSON.stringify(canonical(args));
        const key = JSON.stringify([name, serialized]);
        const previous = this.chains.get(sessionId);
        const count = previous?.key === key ? previous.count + 1 : 1;
        this.chains.set(sessionId, { key, count });
        if (![3, 5, 8].includes(count)) return null;
        const preview = serialized.length > 500 ? serialized.slice(0, 500) + '…（参数已省略）' : serialized;
        return {
            source: { kind: 'repeat-tool-reminder', tool: name, count },
            content: count === 3
                ? '[重复工具调用提醒] 你正在连续调用同一个工具并使用相同参数。请先分析已有结果；任务未完成时尝试不同方法或参数，证据充分时结束本轮。'
                : `[重复工具调用提醒] 工具 ${name} 已连续调用 ${count} 次，参数相同：${preview}\n请检查最新结果，判断是否有进展，选择不同方法或参数；证据充分时完成任务。这是提醒，不是用户的新指令。`,
        };
    }
}
