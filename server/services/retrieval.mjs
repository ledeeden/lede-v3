import { assert } from '../../shared/schema.mjs';
import { uri } from '../../shared/uri.mjs';
import { hash } from '../db.mjs';
import { rerankCandidates, assembleContext } from './search-context.mjs';
const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });
export function tokenize(text) { const lower = String(text).toLowerCase(); const words = [...segmenter.segment(lower)].filter(x => x.isWordLike).map(x => x.segment); for (const run of lower.match(/[\p{Script=Han}]+/gu) ?? [])
    for (let i = 0; i < run.length - 1; i++)
        words.push(run.slice(i, i + 2)); return words.filter(w => w.length < 100); }
export function cosine(a, b) { if (a.length !== b.length)
    return 0; let dot = 0, an = 0, bn = 0; for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    an += a[i] * a[i];
    bn += b[i] * b[i];
} return an && bn ? dot / Math.sqrt(an * bn) : 0; }
export function rrf(lists, k = 60) { const scores = new Map(); for (const list of lists)
    list.forEach((item, i) => { const prev = scores.get(item.id) ?? { ...item, fusionScore: 0, channels: [] }; prev.fusionScore += 1 / (k + i + 1); prev.channels.push(item.channel); scores.set(item.id, prev); }); return [...scores.values()].sort((a, b) => b.fusionScore - a.fusionScore); }
export class Retrieval {
    constructor(s, resources, provider) { this.s = s; this.r = resources; this.provider = provider; resources.indexer = r => this.index(r); }
    index(r) {
        this.s.run('DELETE FROM chunks WHERE resource_id=?', r.id);
        if (r.status !== 'active' || !['object', 'collection'].includes(r.kind))
            return;
        const chunks = [];
        if (r.kind === 'object') {
            for (const b of r.blocks ?? []) {
                for (let off = 0; off < b.text.length; off += 1600)
                    chunks.push({ anchor: b.id, text: b.text.slice(off, off + 1800), level: 2 });
            }
        }
        else
            chunks.push({ anchor: 'members', text: r.title + '\n' + (r.description ?? ''), level: 2 });
        if (r.summary && !r.summary.stale) {
            chunks.push({ anchor: 'abstract', text: r.summary.abstract, level: 0 });
            chunks.push({ anchor: 'overview', text: r.summary.overview, level: 1 });
        }
        for (const [i, c] of chunks.entries()) {
            if (!c.text)
                continue;
            const id = `${r.id}:${r.revision}:${i}`;
            const tokens = tokenize(c.text).join(' ');
            this.s.run('INSERT INTO chunks VALUES(?,?,?,?,?,?,?)', id, r.id, r.revision, c.level, c.anchor, c.text, tokens);
            this.s.run('INSERT INTO chunks_fts(chunk_id,title,tokens) VALUES(?,?,?)', id, tokenize(r.title).join(' '), tokens);
        }
    }
    scopeIds(scope) { if (!scope)
        return undefined; if (scope.projectId) {
        const refs = this.r.all({ projectId: scope.projectId });
        const ids = new Set(refs.map(x => x.id));
        for (const c of refs.filter(x => x.kind === 'collection'))
            for (const member of this.r.collectionMembers(c.id, { recursive: true }))
                ids.add(member.id);
        return ids;
    } if (scope.collectionId)
        return new Set([scope.collectionId, ...this.r.collectionMembers(scope.collectionId, { recursive: true }).map(x => x.id)]); if (scope.ids)
        return new Set(scope.ids); return undefined; }
    async search({ query, scope, limit = 10, level, includeRelations = false, rerank = true, context = true, maxContextChars = 12000, neighbors = 1, relatedLimit = 2, signal } = {}) {
        assert(typeof query === 'string' && query.trim().length > 0 && query.length <= 2000, '请输入 1–2000 字符的查询');
        assert(typeof rerank === 'boolean' && typeof context === 'boolean', 'rerank/context must be boolean');
        assert(Number.isInteger(maxContextChars) && maxContextChars >= 500 && maxContextChars <= 30000, 'maxContextChars must be 500–30000');
        assert(Number.isInteger(neighbors) && neighbors >= 0 && neighbors <= 2, 'neighbors must be 0–2');
        assert(Number.isInteger(relatedLimit) && relatedLimit >= 0 && relatedLimit <= 5, 'relatedLimit must be 0–5');
        assert(!level || Array.isArray(level) && level.every(x => [0, 1, 2].includes(x)), 'Invalid search levels');
        signal?.throwIfAborted();
        limit = Math.min(50, Math.max(1, Number(limit) || 10));
        const ids = this.scopeIds(scope);
        const terms = [...new Set(tokenize(query))].slice(0, 24);
        const match = terms.map(t => '"' + t.replaceAll('"', '""') + '"').join(' OR ');
        let filters = "r.status='active'", args = [];
        if (ids) {
            filters += ` AND c.resource_id IN (${[...ids].map(() => '?').join(',')})`;
            args.push(...ids);
        }
        if (level?.length) {
            filters += ` AND c.level IN (${level.map(() => '?').join(',')})`;
            args.push(...level);
        }
        const keyword = match ? this.s.all(`SELECT c.*,r.title,bm25(chunks_fts,0,3,1) AS rank FROM chunks_fts JOIN chunks c ON c.id=chunks_fts.chunk_id JOIN resources r ON r.id=c.resource_id WHERE chunks_fts MATCH ? AND ${filters} ORDER BY rank LIMIT ?`, match, ...args, Math.max(limit * 4, 40)).map(x => ({ ...x, channel: 'fts' })) : [];
        let vector = [], vectorStatus = this.provider.embeddingConfigured() ? 'no-index' : 'not-configured';
        let warning;
        if (this.provider.embeddingConfigured()) {
            try {
                const model = this.provider.embeddingIdentity();
                const rows = this.s.all(`SELECT c.*,r.title,v.vector FROM vectors v JOIN chunks c ON c.id=v.chunk_id JOIN resources r ON r.id=c.resource_id WHERE v.model=? AND ${filters}`, model, ...args);
                if (rows.length) {
                    const [q] = await this.provider.embed([query], signal);
                    vector = rows.map(x => ({ ...x, score: cosine(q, JSON.parse(x.vector)), vector: undefined, channel: 'vector' })).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, Math.max(limit * 4, 40));
                    vectorStatus = 'ready';
                }
            }
            catch (e) {
                signal?.throwIfAborted();
                vectorStatus = 'error';
                warning = e.message;
            }
        }
        const fused = rrf([keyword, vector]);
        const dedup = new Set();
        const unique = fused.filter(c => { const key = c.resource_id + ':' + c.anchor + ':' + c.level; if (dedup.has(key)) return false; dedup.add(key); return true; });
        // Bounded model input; keep the remaining RRF candidates as an unreranked tail.
        const ranked = await rerankCandidates(this.provider, query, unique.slice(0, 24), { enabled: rerank, signal });
        signal?.throwIfAborted();
        const currentIds = this.scopeIds(scope);
        const hits = [];
        const contexts = [];
        let staleCandidates = 0;
        for (const c of [...ranked.candidates, ...unique.slice(24)]) {
            const r = this.r.maybe(c.resource_id);
            // Provider IO yields control: never return obsolete, archived or unlinked hits.
            if (!r || r.status !== 'active' || r.revision !== c.revision || currentIds && !currentIds.has(r.id)) { staleCandidates++; continue; }
            hits.push({ id: c.id, resourceId: c.resource_id, title: c.title, kind: r.kind, uri: uri(r.kind, r.id, { rev: c.revision, anchor: c.level === 2 && r.kind === 'object' ? c.anchor : undefined }), level: c.level, anchor: c.anchor, revision: c.revision, snippet: c.content.slice(0, 900), score: c.fusionScore, rerankRank: c.rerankRank ?? null, channels: c.channels, source: r.source ?? null, ...includeRelations ? { relations: this.r.related(r.id).filter(e => !currentIds || currentIds.has(e.source) && currentIds.has(e.target)).map(e => ({ source: e.source, target: e.target, type: e.type })) } : {} });
            contexts.push({ ...hits.at(-1), snippet: c.content });
            if (hits.length === limit)
                break;
        }
        const model = this.provider.embeddingConfigured() ? this.provider.embeddingIdentity() : null;
        const eligible = this.s.all(`SELECT c.id FROM chunks c JOIN resources r ON r.id=c.resource_id WHERE ${filters}`, ...args);
        const indexed = model ? new Set(this.s.all('SELECT chunk_id FROM vectors WHERE model=?', model).map(x => x.chunk_id)) : new Set();
        return { results: hits, mode: vectorStatus === 'ready' ? 'hybrid-rrf' : 'fts', vectorStatus, warning, candidateCount: fused.length,
            rerank: { status: ranked.status, method: ranked.method, model: ranked.model, warning: ranked.warning, candidateCount: Math.min(24, unique.length) },
            indexCoverage: { totalChunks: eligible.length, vectorChunks: eligible.filter(x => indexed.has(x.id)).length }, staleCandidates,
            ...(context ? { context: assembleContext(this.r, contexts, { maxChars: maxContextChars, neighbors, relatedLimit, scopeIds: currentIds }) } : {}) };
    }
    async reindexVectors({ onProgress = () => { }, signal } = {}) { assert(this.provider.embeddingConfigured(), '先在设置中配置 Embedding 模型'); const model = this.provider.embeddingIdentity(); const chunks = this.s.all("SELECT c.* FROM chunks c JOIN resources r ON r.id=c.resource_id WHERE r.status='active' AND NOT EXISTS(SELECT 1 FROM vectors v WHERE v.chunk_id=c.id AND v.model=?)", model); let done = 0; for (let start = 0; start < chunks.length; start += 16) {
        signal?.throwIfAborted();
        const batch = chunks.slice(start, start + 16);
        const vectors = await this.provider.embed(batch.map(c => c.content), signal);
        this.s.transaction(() => { for (let i = 0; i < batch.length; i++) {
            if (!this.s.get('SELECT id FROM chunks WHERE id=?', batch[i].id))
                continue;
            this.s.run('INSERT OR REPLACE INTO vectors VALUES(?,?,?,?)', batch[i].id, model, vectors[i].length, JSON.stringify(vectors[i]));
        } });
        done += batch.length;
        onProgress({ done, total: chunks.length });
    } return { done, total: chunks.length, model }; }
    stats() { return { chunks: Number(this.s.get('SELECT count(*) n FROM chunks').n), vectors: Number(this.s.get('SELECT count(*) n FROM vectors').n), model: this.provider.embeddingConfigured() ? this.provider.embeddingIdentity() : null }; }
}
