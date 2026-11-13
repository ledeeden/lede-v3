import {build} from 'esbuild';
import {mkdir, copyFile, writeFile, readFile, cp} from 'node:fs/promises';
await mkdir('web/public/vendor',{recursive:true});
await build({entryPoints:['web/canvas/index.jsx'],outfile:'web/public/vendor/canvas.js',bundle:true,format:'esm',minify:true,define:{'process.env.NODE_ENV':'"production"'},legalComments:'eof'});
await copyFile('node_modules/pdfjs-dist/build/pdf.mjs','web/public/vendor/pdf.mjs');
await copyFile('node_modules/pdfjs-dist/build/pdf.worker.mjs','web/public/vendor/pdf.worker.mjs');
for(const name of ['cmaps','standard_fonts','wasm','iccs'])await cp('node_modules/pdfjs-dist/'+name,'web/public/vendor/pdf-'+name,{recursive:true});
const css=await readFile('node_modules/pdfjs-dist/web/pdf_viewer.css','utf8');await writeFile('web/public/vendor/pdf-text.css','/* PDF.js Apache-2.0; see licenses/web-dependencies.txt. Extracted text-layer rule. */\n'+css.slice(css.indexOf('.textLayer {'),css.indexOf('.textLayerImages {')));
const licenses=[];
const lock=JSON.parse(await readFile('package-lock.json','utf8'));
for(const [path,entry] of Object.entries(lock.packages).filter(([path,p])=>path.startsWith('node_modules/')&&!p.dev)) {
    const pkg=path.replace(/^node_modules\//,'');
    let info;try{info=JSON.parse(await readFile(`node_modules/${pkg}/package.json`,'utf8'));}catch{continue;}
    let license=''; for(const name of ['LICENSE','LICENSE.txt']) {try{license=await readFile(`node_modules/${pkg}/${name}`,'utf8');break;}catch{}}
    licenses.push(`${pkg}@${info.version}\n${license}`);
}
await writeFile('licenses/web-dependencies.txt',licenses.join('\n\n'));
console.log('Built React Flow island and local PDF.js assets.');
