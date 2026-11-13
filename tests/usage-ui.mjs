// Test-only fixtures and real native browser navigation; never imported by production.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.mjs';
import { createProject } from '../server/tools.mjs';
const { chromium }=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out=join(import.meta.dirname,'artifacts/usage');mkdirSync(out,{recursive:true});
const home=mkdtempSync(join(tmpdir(),'lede-usage-ui-')),app=createApp({home,port:0});
await app.listen();
const browser=await chromium.launch({headless:true,...(process.env.LEDE_TEST_BROWSER?{executablePath:process.env.LEDE_TEST_BROWSER}:{})});
const page=await browser.newPage({viewport:{width:1440,height:1024}}), errors=[];
page.on('pageerror',e=>errors.push(e.message));
const check=async(name,fn)=>{await fn();console.log('PASS',name);};
try {
    await page.goto(app.origin+'/#usage');await page.locator('.usage-empty').waitFor();
    await check('empty state and native CSP',async()=>{assert.match(await page.locator('main').innerText(),/还没有调用记录/);await page.screenshot({path:join(out,'empty-desktop.png')});});
    const a=createProject(app.r,{title:'测试项目 A',goal:'用量页面浏览器测试'}),b=createProject(app.r,{title:'测试项目 B',goal:'独立项目归属'});
    for(let i=0;i<40;i++) {
        const project=i%3===0?b:a,context={projectId:i===0?'global':project.id,botId:i===0?'bot_global':project.leadBotId,purpose:i%5===0?'compression':'execution'};
        const id=app.usage.begin(context,'test-request-'+i,1,'fixture-deepseek','chat');
        app.usage.saveRequest('test-request-'+i,{model:'fixture-deepseek',messages:[{role:'system',content:'Test instructions'},{role:'user',content:'Test question <script>bad()</script>'}],tools:[{type:'function',function:{name:'test_tool',description:'Test only'}}],max_tokens:4096});
        app.usage.saveResponse(id,{message:{role:'assistant',content:'Test response'},complete:true});
        app.usage.finish(id,{state:i===38?'failed':'succeeded',raw:i===38?null:{prompt_tokens:18000+i*100,completion_tokens:600,total_tokens:18600+i*100,...(i===39?{}:{prompt_cache_hit_tokens:15000,prompt_cache_miss_tokens:3000+i*100})}});
        const date=new Date();date.setHours(i%12,15,0,0);app.s.run('UPDATE usage_calls SET created_at=? WHERE id=?',date.toISOString(),id);
    }
    await page.reload();await page.locator('.usage-chart').waitFor();
    await check('global totals, missing usage and local assets',async()=>{
        assert.match(await page.locator('main').innerText(),/2 次调用用量不完整/);
        const imgs=await page.locator('.usage-page img').evaluateAll(xs=>xs.map(x=>({src:x.getAttribute('src'),loaded:x.complete&&x.naturalWidth>0,width:x.width,height:x.height})));
        assert.ok(imgs.every(x=>x.loaded),JSON.stringify(imgs));
        writeFileSync(join(out,'assets.json'),JSON.stringify(imgs,null,2));
        await page.screenshot({path:join(out,'global-desktop.png')});
    });
    await check('project-first Bot grouping and project filter',async()=>{
        await page.locator('[data-usage=dimension][data-value=bot]').click();await page.locator('.usage-group').first().waitFor();
        assert.equal(await page.locator('.usage-group').count(),3);
        await page.locator('[data-usage-filter=projectId]').selectOption(a.id);
        await page.waitForFunction(()=>document.querySelectorAll('.usage-group').length===1);
        assert.ok(!(await page.locator('.usage-distribution').innerText()).includes('测试项目 B'));
        await page.screenshot({path:join(out,'project-desktop.png')});
    });
    await check('detail opens and raw counts are inspectable',async()=>{
        await page.locator('[data-usage=detail]').first().click();await page.locator('.usage-log-search').waitFor();
        assert.match(await page.locator('.usage-detail').innerText(),/服务商返回/);
        assert.match(await page.locator('.usage-request-log').innerText(),/输入构成/);
        await page.locator('.usage-log-search').fill('Test question');
        assert.equal(await page.locator('.usage-message-log:visible').count(),1);
        await page.locator('.usage-message-log:visible summary').click();
        assert.match(await page.locator('.usage-message-log:visible pre').innerText(),/<script>bad/);
        await page.screenshot({path:join(out,'detail-desktop.png')});
        await page.locator('[data-usage=close]').click();await page.locator('.usage-detail').waitFor({state:'detached'});
    });
    await check('unknown filter and custom dates',async()=>{
        await page.locator('[data-usage=reset]').click();await page.locator('.usage-warning').waitFor();
        await page.locator('[data-usage=incomplete]').first().click();await page.waitForFunction(()=>document.querySelectorAll('.usage-calls tbody tr').length===2);
        await page.locator('[data-usage=range][data-value=custom]').click();await page.locator('.usage-dates').waitFor();
        await page.locator('.usage-dates [name=start]').fill('2000-01-01');await page.locator('.usage-dates [name=end]').fill('2000-01-02');
        await page.locator('.usage-dates button').click();await page.locator('.usage-empty').waitFor();
        await page.locator('[data-usage=range][data-value=today]').click();await page.locator('.usage-chart').waitFor();
    });
    await check('390px layout and mobile detail',async()=>{
        await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(out,'mobile.png')});
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=390));
        await page.locator('[data-usage=detail]').first().click();await page.locator('.usage-detail').waitFor();
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=390));
        await page.screenshot({path:join(out,'mobile-detail.png')});
    });
    assert.deepEqual(errors,[]);writeFileSync(join(out,'report.json'),JSON.stringify({passed:6,errors,mode:'native navigation, production CSP; deterministic test-only ledger data'},null,2));
}finally {await browser.close();await app.close();rmSync(home,{recursive:true,force:true});}
