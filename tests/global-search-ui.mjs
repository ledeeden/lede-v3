import {chromium} from '@playwright/test';
import {createApp} from '../server/index.mjs';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const home=mkdtempSync(join(tmpdir(),'lede-search-ui-')),app=createApp({home,port:0,demo:true});await app.listen();
const p=app.r.list({kind:'project'})[0];
const object=app.r.create('object',{title:'搜索测试 · 竞品订阅价格报告',category:'report',content:'9 个 App 有 7 天试用，年付价格折扣多在 40–60%。\n\nElsa 和 Praktika 的年付价格官网与应用内不一致。'},{projectId:p.id});
const session=app.coordinator.session(p.leadBotId,p.id);app.s.run('INSERT INTO session_events(session_id,type,data,created_at) VALUES(?,?,?,?)',session.id,'assistant/message',JSON.stringify({message:{content:'搜索动态测试：年付价格已经核查。'}}),new Date().toISOString());
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1024}});page.setDefaultTimeout(12000);const errors=[];page.on('pageerror',e=>errors.push(e.message));mkdirSync('tests/artifacts/search',{recursive:true});
const input=()=>page.getByRole('textbox',{name:'全局搜索',exact:true});
const wait=async()=>{await page.locator('.gs-status').waitFor({state:'hidden'});await page.evaluate(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});};
try{
 await page.goto(app.origin);await page.getByRole('button',{name:'全局搜索',exact:true}).click();await input().fill('年付价格');await page.locator('.gs-row').filter({hasText:'搜索测试'}).waitFor();await wait();
 await page.screenshot({path:'tests/artifacts/search/modal-1440.png'});assert.ok(await page.locator('.global-search img').evaluateAll(imgs=>imgs.every(img=>img.complete&&img.naturalWidth>0&&img.width===img.naturalWidth&&img.height===img.naturalHeight)));
 assert.equal(Math.round((await page.locator('.global-search-dialog').boundingBox()).width),800);
 await input().press('ArrowDown');assert.equal(await page.locator('.gs-row.selected').count(),1);await input().press('ArrowUp');
 await page.locator('.gs-row').filter({hasText:'搜索测试'}).click();await page.locator('[data-gs=side]').click();await page.locator('.gs-side').waitFor();await page.getByRole('button',{name:'关闭侧栏'}).click();
 await page.locator('[data-gs=reference]').click();await page.locator('#chat-form').waitFor();assert.ok((await page.locator('.chat-panel').innerText()).includes('搜索测试'));
 await page.keyboard.press('Control+k');await input().fill('年付价格');await page.locator('.gs-row').filter({hasText:'搜索测试'}).waitFor();await input().press('Shift+Enter');await page.locator('.gs-page').waitFor();await wait();await page.screenshot({path:'tests/artifacts/search/page-1440.png'});
 await page.locator('[data-type=activity]').click();await wait();await page.locator('.gs-row').filter({hasText:'搜索动态测试'}).click();await page.locator('[data-gs=open]').click();await page.locator('.search-target').waitFor();assert.ok((await page.locator('.search-target').innerText()).includes('搜索动态测试'));
 await page.keyboard.press('Control+k');await input().fill('年付价格 impossible');await page.locator('.gs-empty').waitFor();await wait();await page.screenshot({path:'tests/artifacts/search/empty-1440.png'});assert.ok(await page.locator('.gs-empty .gs-row').count());await page.locator('.gs-ask-card [data-gs=ask]').click();await page.waitForFunction(()=>document.querySelector('#chat-form textarea')?.value.includes('impossible'));assert.match(await page.locator('#chat-form textarea').inputValue(),/impossible/);
 for(const width of [390,1440]){await page.setViewportSize({width,height:1024});await page.goto(app.origin+'/#home');await page.locator('.home').waitFor();await page.keyboard.press('Control+k');await input().fill('年付价格');await page.locator('.gs-row').filter({hasText:'搜索测试'}).waitFor();await wait();await page.screenshot({path:`tests/artifacts/search/modal-${width}.png`});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));const box=await page.locator('.global-search-dialog').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width);await input().press('Shift+Enter');await page.locator('.gs-page').waitFor();await wait();await page.screenshot({path:`tests/artifacts/search/page-${width}.png`});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 // Slow, obsolete responses cannot replace a newer query.
 await page.goto(app.origin+'/#home');await page.locator('.home').waitFor();await page.keyboard.press('Control+k');await page.route('**/api/search/global',async route=>{if(route.request().postDataJSON().query==='obsolete')await new Promise(r=>setTimeout(r,500));await route.continue();});await input().fill('obsolete');await page.waitForTimeout(220);await input().fill('年付价格');await page.locator('.gs-row').filter({hasText:'搜索测试'}).waitFor();await page.waitForTimeout(600);assert.ok(await page.locator('.gs-row').filter({hasText:'搜索测试'}).count());await input().press('Escape');await page.locator('.global-search-dialog').waitFor({state:'detached'});
 assert.deepEqual(errors,[]);console.log('Global search UI passed: modal/full/empty 1440×1024 and 390px, keyboard, preview, reference draft, activity navigation and stale response guard.');
}catch(e){await page.screenshot({path:'tests/artifacts/search/failure.png'});console.error(await page.locator('body').innerText());throw e;}finally{await browser.close();await app.close();rmSync(home,{recursive:true,force:true});}
