/** TEST FIXTURE ONLY. Deterministic HTTP model/embedding protocol peer.
 * This is not AI inference, not a production provider and not shipped as an app mode. */
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
export async function modelFixture(t, { respond, embedding, delay = 0 } = {}) {
    const calls = [];
    let count = 0;
    const server = createServer(async (req, res) => {
        try {
            let raw = '';
            for await (const b of req)
                raw += b;
            const body = JSON.parse(raw);
            calls.push({ path: req.url, body });
            if (req.url.endsWith('/embeddings')) {
                const vectors = body.input.map(text => embedding ? embedding(text) : vector(text));
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ data: vectors.map((v, index) => ({ index, embedding: v })) }));
                return;
            }
            const id = ++count;
            const result = await (respond?.(body, id) ?? { content: 'OK' });
            if (result.httpError) {
                res.writeHead(result.httpError, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ error: { message: result.errorMessage ?? 'fixture error', code: result.errorCode } }));
                return;
            }
            res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
            const send = x => res.write('data: ' + JSON.stringify(x) + '\n\n');
            for (const usage of result.usageSamples ?? []) send({ choices: [], usage });
            const text = result.content ?? '';
            for (const chunk of text.match(/.{1,7}/gs) ?? []) {
                if (delay)
                    await new Promise(r => setTimeout(r, delay));
                if (res.destroyed)
                    return;
                send({ choices: [{ index: 0, delta: { content: chunk } }] });
            }
            for (const [index, call] of (result.tools ?? []).entries()) {
                const args = typeof call.args === 'string' ? call.args : JSON.stringify(call.args ?? {});
                send({ choices: [{ index: 0, delta: { tool_calls: [{ index, id: call.id ?? 'call_' + id + '_' + index, type: 'function', function: { name: call.name, arguments: '' } }] } }] });
                for (const part of args.match(/.{1,13}/gs) ?? [])
                    send({ choices: [{ index: 0, delta: { tool_calls: [{ index, function: { arguments: part } }] } }] });
            }
            if (result.cut) {
                res.end();
                return;
            }
            send({ choices: [{ index: 0, delta: {}, finish_reason: result.finish ?? ((result.tools?.length) ? 'tool_calls' : 'stop') }], usage: result.usage === null ? undefined : result.usage ?? { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } });
            res.end('data: [DONE]\n\n');
        }
        catch (e) {
            if (!res.headersSent)
                res.writeHead(500);
            res.end(String(e.message));
        }
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const baseURL = 'http://127.0.0.1:' + server.address().port;
    const close = async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); };
    t?.after(close);
    return { baseURL, config: { chat: { baseURL, model: 'fixture-not-a-real-model', allowAnonymous: true, contextWindow: 65536, maxTokens: 4096 }, embedding: { baseURL, model: 'fixture-vector-v1', allowAnonymous: true } }, calls, close };
}
function vector(text) { const h = createHash('sha256').update(text).digest(); return [...h.slice(0, 16)].map(x => (x - 128) / 128); }
export const toolsOf = body => body.messages.filter(x => x.role === 'tool').map(x => JSON.parse(x.content));
