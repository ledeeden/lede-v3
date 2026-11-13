import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import ts from '../vendor/typescript.cjs';
const root = resolve(import.meta.dirname, '..');
const files = [];
function walk(dir) { for (const f of readdirSync(dir, { withFileTypes: true })) {
    if (['vendor', 'artifacts', '.git', 'node_modules'].includes(f.name))
        continue;
    const path = join(dir, f.name);
    if (f.isDirectory())
        walk(path);
    else if (f.name.endsWith('.mjs'))
        files.push(path);
} }
walk(root);
let failed = 0;
for (const file of files) {
    const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (r.status) {
        console.error(r.stderr);
        failed++;
    }
}
for (const file of ['web/index.html', 'web/sandbox.html', 'licenses/DeepSeek-MIT.txt', 'licenses/DS-Bot-Apache-2.0.txt', 'licenses/TypeScript-LICENSE.txt', 'upstream/manifest.json'])
    if (!existsSync(join(root, file))) {
        console.error('Missing ' + file);
        failed++;
    }
const inline = readFileSync(join(root, 'web/sandbox.html'), 'utf8').match(/<script>([\s\S]*?)<\/script>/)?.[1];
if (!inline) {
    console.error('Sandbox script missing');
    failed++;
}
else {
    const r = ts.transpileModule(inline, { fileName: 'sandbox.js', compilerOptions: { allowJs: true, target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true });
    for (const d of r.diagnostics ?? [])
        if (d.category === ts.DiagnosticCategory.Error) {
            console.error(ts.flattenDiagnosticMessageText(d.messageText, '\n'));
            failed++;
        }
}
console.log(`${files.length} JavaScript modules + sandbox script checked; ${failed} errors.`);
process.exitCode = failed ? 1 : 0;
