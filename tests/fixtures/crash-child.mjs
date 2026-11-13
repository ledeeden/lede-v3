// Invoked ONLY by recovery.test.mjs; deliberately blocks after an external side effect.
import { createApp } from '../../server/index.mjs';
import { createProject } from '../../server/tools.mjs';
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const home = process.env.TEST_HOME;
const app = createApp({ home, port: 0, providerConfig: JSON.parse(process.env.TEST_PROVIDER) });
await app.listen();
app.tools.add('test.side_effect', 'Test-only side effect', { type: 'object', properties: {}, additionalProperties: false }, async () => { appendFileSync(join(home, 'effect.txt'), 'once\n'); writeFileSync(join(home, 'effect-started'), '1'); await new Promise(r => setTimeout(r, 120000)); return { ok: true }; }, { effect: 'external' });
const p = createProject(app.r, { title: 'Crash recovery fixture' });
const b = app.r.get(p.leadBotId);
app.r.update(b.id, { tools: ['*'] }, { baseRevision: b.revision });
await app.coordinator.userMessage({ projectId: p.id, content: 'test crash side effect' });
process.send?.({ ready: true });
