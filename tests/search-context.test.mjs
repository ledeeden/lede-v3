import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, call } from './helpers.mjs';
import { modelFixture } from './fixtures/model-server.mjs';
import { createProject } from '../server/tools.mjs';

test('Hybrid + model rerank changes ordering and records provider usage', async t => {
    let preferred;
    const peer = await modelFixture(t, { embedding: () => [1, 0], respond: body => {
        const { candidates } = JSON.parse(body.messages[1].content);
        return { content: JSON.stringify({ order: candidates.sort((a,b) => Number(b.title === preferred) - Number(a.title === preferred)).map(c => c.id) }) };
    } });
    const app = await fixture(t, { providerConfig: peer.config });
    app.r.create('object', { title: '查询词', content: '查询词：一般信息。' });
    const target = app.r.create('object', { title: '目标文档', content: '查询词：具体操作。\n\n这里是后续步骤。' });
    preferred = target.title;
    await app.retrieval.reindexVectors();
    const response = await call(app, 'search', { query: '查询词', limit: 1 });
    assert.equal(response.status, 200);
    const result = response.body;
    assert.equal(result.mode, 'hybrid-rrf');
    assert.equal(result.rerank.status, 'ready');
    assert.equal(result.results[0].resourceId, target.id);
    assert.equal(result.results[0].rerankRank, 1);
    assert.ok(result.context.passages.some(p => p.role === 'neighbor' && p.text.includes('后续步骤')));
    for (const p of result.context.passages) assert.ok(app.r.resolve(p.uri));
    assert.equal(result.indexCoverage.vectorChunks, result.indexCoverage.totalChunks);
    assert.ok(app.s.all("SELECT * FROM usage_calls WHERE json_extract(data,'$.purpose')='rerank'").length);
});

test('Context keeps project scope, references, deduplication and a hard text budget', async t => {
    const a = await fixture(t), p = createProject(a.r, { title: '当前项目' });
    const hit = a.r.create('object', { title: '命中', content: 'needle ' + '正文'.repeat(400) + '\n\n相邻段落。' }, { projectId:p.id });
    const related = a.r.create('object', { title: '引用资料', content: '引用内容。' }, { projectId:p.id });
    const outside = a.r.create('object', { title: '范围外', content: '不应被扩展。' });
    a.r.relate(hit.id, related.id); a.r.relate(hit.id, outside.id);
    let result = await a.retrieval.search({ query:'needle', scope:{projectId:p.id}, maxContextChars:500 });
    assert.equal(result.context.usedChars, 500); assert.equal(result.context.truncated, true);
    result = await a.retrieval.search({ query:'needle', scope:{projectId:p.id} });
    assert.ok(result.context.passages.some(x => x.resourceId === related.id && x.role === 'reference'));
    assert.ok(result.context.passages.every(x => x.resourceId !== outside.id));
    assert.equal(new Set(result.context.passages.map(x => x.uri)).size, result.context.passages.length);
    assert.equal(result.indexCoverage.vectorChunks, 0);
    const empty = await a.retrieval.search({ query:'needle', scope:{ids:[]} });
    assert.deepEqual(empty.results, []); assert.deepEqual(empty.context.passages, []);
});

test('Malformed model rank falls back explicitly; opt out avoids model IO', async t => {
    const peer = await modelFixture(t, { respond: () => ({ content:'{"order":["invented"]}' }) });
    const a = await fixture(t, { providerConfig:peer.config });
    a.r.create('object', { title:'needle', content:'needle one' });
    a.r.create('object', { title:'needle', content:'needle two' });
    const result = await a.retrieval.search({ query:'needle' });
    assert.equal(result.rerank.status, 'error'); assert.equal(result.results.length, 2);
    assert.ok(result.results.every(x => x.rerankRank === null));
    const before = peer.calls.length;
    const plain = await a.retrieval.search({ query:'needle', rerank:false, context:false });
    assert.equal(plain.rerank.status, 'disabled'); assert.equal(plain.context, undefined);
    assert.equal(peer.calls.length, before);
    assert.equal((await call(a,'search',{query:'needle',maxContextChars:-1})).status,400);
});

test('Rerank yielding to mutations excludes changed/archived/unlinked results', async t => {
    let mutate = () => {};
    const peer = await modelFixture(t, { respond: body => {
        const { candidates } = JSON.parse(body.messages[1].content); mutate();
        return { content:JSON.stringify({order:candidates.map(x => x.id)}) };
    } });
    const a = await fixture(t,{providerConfig:peer.config}), p = createProject(a.r,{title:'项目'});
    const make = text => a.r.create('object',{title:'needle',content:text},{projectId:p.id});
    const changed=make('needle changed'), archived=make('needle archived'), unlinked=make('needle unlinked'), kept=make('needle kept');
    mutate=()=>{ a.r.update(changed.id,{content:'replacement'},{baseRevision:1}); a.r.status(archived.id,'archived'); a.r.unlink(p.id,unlinked.id); };
    const result=await a.retrieval.search({query:'needle',scope:{projectId:p.id}});
    assert.deepEqual(result.results.map(x=>x.resourceId),[kept.id]);
    assert.equal(result.staleCandidates,3);
    assert.ok(result.context.passages.every(x=>x.resourceId===kept.id));
});

test('Cancellation is not silently converted to successful retrieval', async t => {
    const a=await fixture(t), controller=new AbortController(); controller.abort();
    await assert.rejects(a.retrieval.search({query:'needle',signal:controller.signal}),{name:'AbortError'});
});
