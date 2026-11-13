import {chromium} from '@playwright/test';
import {createApp} from '../server/index.mjs';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const home=mkdtempSync(join(tmpdir(),'lede-library-'));
const app=createApp({home,port:0,demo:true});await app.listen();
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1024}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
mkdirSync('tests/artifacts/design',{recursive:true});
try{
 await page.goto(app.origin+'/#plugins');await page.locator('.catalog-card').first().waitFor();
 assert.equal(await page.locator('.catalog-card').count(),16);
 assert.equal(await page.locator('.inspector').count(),0);
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1024});
  await page.locator('.library img').evaluateAll(imgs=>Promise.all(imgs.map(i=>i.decode())));
  const rects=await page.locator('.catalog-card').evaluateAll(nodes=>nodes.slice(0,4).map(n=>({x:n.getBoundingClientRect().x,y:n.getBoundingClientRect().y,width:n.getBoundingClientRect().width})));
  if(width===1440){assert.equal(rects[0].y,rects[2].y);assert.ok(rects[3].y>rects[0].y);assert.equal(Math.round(rects[0].width),360);}else assert.ok(rects[1].y>rects[0].y);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const search=await page.locator('#catalog-search button').boundingBox();assert.ok(search.width>30&&search.height<35);
  await page.screenshot({path:`tests/artifacts/design/library-${width}.png`});
 }
 await page.locator('[data-action=catalog-filter][data-id="引用"]').click();assert.equal(await page.locator('.catalog-card').count(),3);
 await page.locator('[data-action=catalog-filter][data-id="全部"]').click();
 await page.getByRole('textbox',{name:'搜索组件'}).fill('quote');await page.locator('#catalog-search button').click();assert.equal(await page.locator('.catalog-card').count(),1);
 await page.locator('[data-action=catalog-use]').click();await page.locator('[name=viewId]').waitFor();await page.keyboard.press('Escape');
 await page.goto(app.origin+'/#home');await page.goto(app.origin+'/#plugins');
 await page.getByRole('textbox',{name:'搜索组件'}).fill('不存在的组件');await page.locator('#catalog-search button').click();await page.getByText('没有匹配的组件，试试其他关键词或分类。').waitFor();
 assert.deepEqual(errors,[]);console.log('Library: 1440/390 layout, all SVG assets, search, category filters, empty results and add dialog passed.');
}finally{await browser.close();await app.close();rmSync(home,{recursive:true,force:true});}
