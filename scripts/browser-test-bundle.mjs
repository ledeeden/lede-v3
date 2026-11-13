// Test-only in-memory DOM harness. Production uses native ES modules unchanged.
// The container's Chromium prohibits URL navigation; no browser policies are modified.
import ts from '../vendor/typescript.cjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const seen = new Map();
function load(file) { file = resolve(file); if (seen.has(file))
    return; const code = readFileSync(file, 'utf8'); seen.set(file, null); const compiled = ts.transpileModule(code, { fileName: file.replace(/\.mjs$/, '.ts'), compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText; const deps = {}; for (const m of compiled.matchAll(/require\("([^"]+)"\)/g)) {
    const spec = m[1];
    const target = spec.startsWith('/') ? resolve(root, spec.slice(1)) : resolve(dirname(file), spec);
    deps[spec] = target;
    load(target);
} seen.set(file, { compiled, deps }); }
const entry = resolve(root, 'web/app.mjs');
load(entry);
const modules = [...seen].map(([id, { compiled, deps }]) => `${JSON.stringify(id)}:{deps:${JSON.stringify(deps)},run:function(require,module,exports){\n${compiled}\n}}`).join(',\n');
const bundle = `(()=>{const modules={${modules}},cache={};function req(id){if(cache[id])return cache[id].exports;const m=cache[id]={exports:{}};const def=modules[id];if(!def)throw Error(id);def.run(k=>req(def.deps[k]),m,m.exports);return m.exports;}req(${JSON.stringify(entry)});})();`;
writeFileSync(resolve(root, 'tests/artifacts/browser-test-bundle.js'), bundle);
