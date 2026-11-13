// Modified adaptation of DeepSeek Harness token-meter usage-projection.ts and
// turn-usage.ts (MIT, Copyright (c) 2026 DeepSeek), pinned in upstream/manifest.json.
// Last sample replaces the previous sample; each physical retry is a separate attempt.
// Chat Completions prompt_tokens INCLUDES cache reads, unlike Harness Messages inputTokens.
const count = v => Number.isSafeInteger(v) && v >= 0 ? v : null;
export function normalizeUsage(raw, kind = 'chat') {
    const u = raw && typeof raw === 'object' ? raw : {};
    const input = count(u.prompt_tokens), output = kind === 'embedding' ? 0 : count(u.completion_tokens);
    let hit = count(u.prompt_cache_hit_tokens ?? u.prompt_tokens_details?.cached_tokens);
    let miss = count(u.prompt_cache_miss_tokens);
    let total = count(u.total_tokens);
    if (total === null && input !== null && output !== null) total = count(input + output);
    const invalid = input !== null && output !== null && total !== null && input + output !== total;
    if (input !== null) {
        if (hit !== null && hit <= input && miss === null) miss = input - hit;
        if (miss !== null && miss <= input && hit === null) hit = input - miss;
    }
    if (input === null || hit === null || miss === null || hit + miss !== input) hit = miss = null;
    let reasoning = count(u.completion_tokens_details?.reasoning_tokens);
    if (output === null || reasoning > output) reasoning = null;
    return { input: invalid ? null : input, output: invalid ? null : output, total: invalid ? null : total,
        hit: invalid ? null : hit, miss: invalid ? null : miss, reasoning,
        completeness: invalid || input === null || output === null || total === null ? 'unknown' : kind === 'embedding' || hit !== null ? 'complete' : 'partial' };
}

export function aggregateUsage(rows) {
    const sum = key => rows.reduce((n, x) => n + (x[key] ?? 0), 0);
    const cacheComplete = rows.length > 0 && rows.every(x => x.input !== null && x.hit !== null && x.miss !== null);
    return { calls: rows.length, recorded: rows.filter(x => x.total !== null).length,
        unknown: rows.filter(x => x.completeness === 'unknown').length, partial: rows.filter(x => x.completeness === 'partial').length,
        input: sum('input'), output: sum('output'), total: sum('total'), hit: sum('hit'), miss: sum('miss'),
        unclassified: rows.reduce((n,x) => n + (x.hit === null ? x.input ?? 0 : 0),0),
        reasoning: rows.length && rows.every(x => x.reasoning !== null) ? sum('reasoning') : null,
        rate: cacheComplete && sum('input') > 0 ? sum('hit') / sum('input') : null };
}

