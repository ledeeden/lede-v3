import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.mjs';
export async function fixture(t, options = {}) { const home = options.home ?? mkdtempSync(join(tmpdir(), 'lede-test-')); const app = createApp({ home, port: 0, ...options }); await app.listen(); t.after(async () => { await app.close(); if (!options.keep)
    rmSync(home, { recursive: true, force: true }); }); return app; }
export async function waitFor(fn, { timeout = 8000, interval = 15 } = {}) { const end = Date.now() + timeout; let value; while (Date.now() < end) {
    value = await fn();
    if (value)
        return value;
    await new Promise(r => setTimeout(r, interval));
} throw Error('Timed out waiting for condition'); }
export async function settled(app) { await waitFor(() => app.kernel.active.size === 0 && app.kernel.ready.size === 0 && !app.s.get('SELECT id FROM inbox LIMIT 1')); await new Promise(r => setTimeout(r, 30)); }
export async function call(app, path, data, headers = {}) { const res = await fetch(app.origin + '/api/' + path, { method: data === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'X-Lede-Token': app.token, ...headers }, body: data === undefined ? undefined : JSON.stringify(data) }); return { status: res.status, body: await res.json() }; }
