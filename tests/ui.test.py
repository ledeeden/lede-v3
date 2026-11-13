"""Real DOM interaction + real local HTTP service via a test-only bridge.

Chromium in this environment blocks every navigated URL by administrative policy.
The test renders the unchanged app modules in memory, forwards ONLY local /api/*
requests through Python, and loads the same sandbox HTML as opaque srcdoc.
No policies are modified. Native URL navigation, production CSP enforcement and
real browser SSE delivery need an ordinary Mac browser smoke test after download.
"""
from pathlib import Path
import json,urllib.request,urllib.error,time,tempfile,subprocess,shutil,os,sys
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'tests/artifacts';OUT.mkdir(exist_ok=True)
subprocess.run(['node','scripts/browser-test-bundle.mjs'],cwd=ROOT,check=True)
home=tempfile.mkdtemp(prefix='lede-ui-')
proc=subprocess.Popen(['node','tests/fixtures/ui-server.mjs'],cwd=ROOT,env={**os.environ,'TEST_HOME':home},stdout=subprocess.PIPE,stderr=open(OUT/'ui-server.log','w'),text=True)
config=json.loads(proc.stdout.readline());BASE=config['url'];checks=[];errors=[]
def bridge(_source,req):
    path=req['url']
    if not path.startswith('/api/'):raise ValueError('Test bridge accepts local /api/* only')
    body=req.get('body');request=urllib.request.Request(BASE+path,data=body.encode() if isinstance(body,str) else None,headers=req.get('headers',{}),method=req.get('method','GET'))
    try:
        with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request,timeout=40) as r:return {'status':r.status,'body':r.read().decode(),'headers':{'content-type':r.headers.get('content-type','application/json')}}
    except urllib.error.HTTPError as e:return {'status':e.code,'body':e.read().decode(),'headers':{'content-type':'application/json'}}
def api(path,data=None):
    token=json.loads(bridge(None,{'url':'/api/bootstrap'})['body'])['token']
    result=bridge(None,{'url':'/api/'+path,'method':'POST' if data is not None else 'GET','headers':{'Content-Type':'application/json','X-Lede-Token':token},'body':json.dumps(data,ensure_ascii=False) if data is not None else None})
    if result['status']>=400:raise RuntimeError(result['body'])
    return json.loads(result['body'])
def check(name,fn):
    start=time.time();fn();checks.append({'name':name,'passed':True,'durationMs':round((time.time()-start)*1000)});print('PASS',name,flush=True)
def mount(page):
    if os.environ.get('LEDE_NATIVE_BROWSER')=='1':
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto(BASE);page.wait_for_selector('.sidebar');page.wait_for_timeout(450);return
    page.on('pageerror',lambda e:errors.append(str(e)));page.expose_binding('__localAPI',bridge)
    page.set_content('<html lang="zh-CN"><head><meta charset="utf-8"></head><body><div id="app"></div><div id="modal-root"></div><div id="toast-root"></div></body></html>')
    page.add_style_tag(content=(ROOT/'web/styles.css').read_text())
    assets={f'/public/assets/{x.name}':x.read_text() for x in (ROOT/'web/public/assets').glob('*.svg')}
    page.evaluate('''({assets,sandbox})=>{
        crypto.randomUUID ||= () => '10000000-1000-4000-8000-100000000000'.replace(/[018]/g,c=>(c^crypto.getRandomValues(new Uint8Array(1))[0]&15>>c/4).toString(16));
        window.fetch=async(url,options={})=>{const r=await window.__localAPI({url,method:options.method||'GET',headers:options.headers||{},body:options.body});return new Response(r.body,{status:r.status,headers:r.headers});};
        window.EventSource=class {constructor(){this.onmessage=null;this.last=0;this.timer=setInterval(async()=>{try{const b=await fetch('/api/bootstrap').then(r=>r.json());const events=await fetch('/api/events/recent',{headers:{'X-Lede-Token':b.token}}).then(r=>r.json());for(const e of events.reverse()){if(e.seq>this.last){this.last=e.seq;this.onmessage?.({data:JSON.stringify({seq:e.seq,topic:e.topic,resourceId:e.resource_id,data:e.data})});}}}catch{}},350);} close(){clearInterval(this.timer);}};
        const img=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');Object.defineProperty(HTMLImageElement.prototype,'src',{set(value){img.set.call(this,assets[value]?'data:image/svg+xml,'+encodeURIComponent(assets[value]):value)},get:img.get});
        new MutationObserver(()=>{for(const e of document.querySelectorAll('img[src^="/public/"]')){const v=e.getAttribute('src');if(assets[v])e.src=v;}}).observe(document.body,{subtree:true,childList:true});
        const frame=Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype,'src');Object.defineProperty(HTMLIFrameElement.prototype,'src',{set(value){if(value==='/sandbox.html')this.srcdoc=sandbox;else frame.set.call(this,value);},get:frame.get});
    }''',{'assets':assets,'sandbox':(ROOT/'web/sandbox.html').read_text()})
    page.add_script_tag(content=(OUT/'browser-test-bundle.js').read_text());page.wait_for_selector('.sidebar');page.wait_for_timeout(450)
def go(page,hash):
    page.evaluate('(h)=>location.hash=h',hash);page.wait_for_timeout(550)
    assert '无法打开：' not in page.locator('body').inner_text(),page.locator('body').inner_text()
def screenshot(page,name):page.screenshot(path=str(OUT/name),full_page=False)
def save(page):page.locator('#dialog-form button[type=submit]').click();expect(page.locator('.modal')).to_have_count(0,timeout=10000);page.wait_for_timeout(350)
try:
 with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path=os.environ.get('LEDE_TEST_BROWSER','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1440,'height':1024});mount(page)
    boot=api('bootstrap');pid=next(r['id'] for r in boot['resources'] if r['kind']=='project' and '出海' in r['title']);cid=next(r['id'] for r in boot['resources'] if r['kind']=='collection');oid=next(r['id'] for r in boot['resources'] if r['kind']=='object');vid=next(r['id'] for r in boot['resources'] if r['kind']=='view')
    check('01 首页与项目入口',lambda:(expect(page.locator('h1')).to_have_text('项目'),screenshot(page,'01-home.png')))
    check('02 项目总览与负责人',lambda:(go(page,'#project/'+pid+'/overview'),expect(page.locator('.chat-header strong')).to_have_text('出海负责人'),screenshot(page,'02-project.png')))
    check('03 任务进展与执行记录',lambda:(go(page,'#project/'+pid+'/progress'),expect(page.locator('[data-column]')).to_have_count(4),screenshot(page,'03-progress.png')))
    check('04 成果页',lambda:(go(page,'#project/'+pid+'/results'),expect(page.locator('.result-card').first).to_be_visible(),screenshot(page,'04-results.png')))
    check('05 全局总助',lambda:(page.locator('[data-action=global]').first.click(),expect(page.locator('.chat-header strong')).to_have_text('总助'),screenshot(page,'05-global.png'),page.locator('[data-action=close-global]').click()))
    check('06 集合与概览',lambda:(go(page,'#collection/'+cid),expect(page.locator('main h1').first).to_be_visible(),screenshot(page,'06-collection.png')))
    check('07 知识对象与 URI',lambda:(go(page,'#resource/'+urllib.parse.quote('lede://object/'+oid,safe='')),expect(page.locator('.document-block').first).to_be_visible(),screenshot(page,'07-knowledge.png')))
    check('08 插件编译与沙箱挂载',lambda:(go(page,'#plugins/'+urllib.parse.quote(boot['widgets'][0]['key'],safe='')),expect(page.frame_locator('iframe').locator('h3')).to_be_visible(timeout=10000),expect(page.locator('[data-action=register-widget]')).to_be_enabled(timeout=10000),screenshot(page,'08-plugins.png')))
    check('09 执行团队详情',lambda:(go(page,'#project/'+pid+'/overview'),page.locator('[data-action=team]').click(),expect(page.locator('.team-member')).to_have_count(5),screenshot(page,'09-team.png'),page.locator('button[data-action=close-team]').click()))
    def bot_settings():
        for width,height in [(1440,1024),(390,844)]:
            page.set_viewport_size({'width':width,'height':height})
            go(page,'#project/'+pid+'/overview')
            if width==390 and page.locator('.chat-panel').is_visible():
                page.locator('.chat-panel [data-action=toggle-chat]').click()
            page.locator('[data-action=team]').click()
            page.locator('[data-action=edit-bot]').first.click()
            expect(page.locator('[name=maxSteps]')).to_have_count(0)
            expect(page.locator('[name=instructions]')).to_be_visible()
            assert page.evaluate('document.documentElement.scrollWidth')<=width
            screenshot(page,'loop-bot-settings-'+str(width)+'.png')
            page.locator('[data-action=close-modal]').first.click()
            page.locator('button[data-action=close-team]').click()
        page.set_viewport_size({'width':1440,'height':1024})
    check('Bot 配置移除步数限制，桌面与窄屏布局',bot_settings)
    def continuity_ui():
        p=api('resource/create',{'kind':'project','data':{'title':'持续项目 UI','goal':'验证长期记忆和项目交接'}})
        b=api('bot/create',{'projectId':p['id'],'data':{'title':'接任负责人'}})
        for title in ['资料整理','成果核验']:
            api('resource/create',{'kind':'task','data':{'title':title,'projectId':p['id']}})
        go(page,'#project/'+p['id']+'/overview')
        page.locator('[data-action=project-memory]').click()
        page.locator('[data-action=memory-add]').click()
        page.locator('[name=text]').fill('保留原始资料，使用中文')
        page.locator('[name=pinned]').select_option('true');save(page)
        page.locator('[data-action=project-memory]').click()
        expect(page.locator('.continuity-panel')).to_contain_text('保留原始资料')
        page.locator('[data-action=memory-history]').click()
        expect(page.locator('.continuity-panel')).to_contain_text('v1')
        page.locator('[data-action=close-modal]').first.click()
        page.locator('[data-action=project-goal]').click()
        page.locator('[data-action=goal-create]').click()
        page.locator('[name=acceptance]').fill('每阶段都有成果和来源')
        page.locator('[name=stageTitle0]').fill('资料整理')
        page.locator('[name=stageAcceptance0]').fill('保留来源')
        page.locator('label.row').filter(has_text='资料整理').locator('input').check()
        page.locator('[data-action=goal-add-stage]').click()
        page.locator('[name=stageTitle1]').fill('成果核验')
        page.locator('[name=stageAcceptance1]').fill('逐条核验')
        page.locator('[data-goal-stage="1"] label.row').filter(has_text='成果核验').locator('input').check();save(page)
        page.wait_for_timeout(400)
        page.locator('[data-action=project-goal]').click()
        expect(page.locator('.continuity-panel')).to_contain_text('成果核验')
        page.locator('[data-action=close-modal]').first.click()
        for width,height in [(1440,1024),(390,844)]:
            page.set_viewport_size({'width':width,'height':height})
            for kind in ['memory','goal','handoff']:
                page.locator('[data-action=project-'+kind+']').click()
                expect(page.locator('.modal')).to_be_visible()
                assert page.evaluate('document.documentElement.scrollWidth')<=width
                screenshot(page,'continuity-'+kind+'-'+str(width)+'.png')
                page.locator('[data-action=close-modal]').first.click()
        page.set_viewport_size({'width':1440,'height':1024})
        page.locator('[data-action=project-goal]').click()
        page.locator('[data-action=goal-control][data-id=stop]').click()
        expect(page.locator('.continuity-panel')).to_contain_text('已停止')
        page.locator('[data-action=close-modal]').first.click()
        api('bot/stop',{'projectId':p['id'],'botId':p['leadBotId']})
        page.locator('[data-action=project-handoff]').click()
        page.locator('[name=leadBotId]').select_option(b['id']);save(page)
        page.locator('[data-action=project-handoff]').click()
        expect(page.locator('.continuity-panel')).to_contain_text('接任负责人')
        expect(page.locator('.continuity-panel')).to_contain_text('最近交接包')
        page.locator('[data-action=close-modal]').first.click()
        page.locator('[data-action=project-memory]').click()
        expect(page.locator('.continuity-panel')).to_contain_text('保留原始资料')
        page.locator('[data-action=memory-delete]').click()
        expect(page.locator('.continuity-panel')).to_contain_text('暂无长期记忆')
        page.locator('[data-action=close-modal]').first.click()
    check('项目记忆、分阶段目标与负责人交接，桌面及390px',continuity_ui)
    def create_project():
        page.locator('[data-action=new-project]').first.click();page.locator('[name=title]').fill('浏览器创建项目');page.locator('[name=goal]').fill('验证资料、任务、插件与负责人完整闭环');save(page);expect(page.locator('h1')).to_have_text('浏览器创建项目')
    check('项目创建自动配置负责人',create_project);newpid=page.evaluate('location.hash.split("/")[1]')
    def create_knowledge():
        go(page,'#project/'+newpid+'/materials');page.locator('[data-action=new-knowledge]').click();page.locator('[name=title]').fill('浏览器知识资料');page.locator('[name=content]').fill('# 方法\n\n所有结论必须来自真实资料。\n\n保留稳定的引用。');page.locator('[name=tags]').fill('测试, 方法');save(page);expect(page.locator('h1').first).to_have_text('浏览器知识资料')
    check('知识新建与段落选择回传',create_knowledge)
    newobject=next(x for x in api('resources?kind=object') if x['title']=='浏览器知识资料')
    page.locator('.document-block').nth(1).click();expect(page.locator('.context-chip')).to_contain_text('浏览器知识资料')
    def edit_knowledge():
        page.locator('[data-action=edit-knowledge]').click();page.locator('[name=content]').fill('# 方法\n\n更新后的证据记录。');save(page);assert api('resource?id='+newobject['id'])['revision']==2
    check('知识编辑、修订号与历史版本',edit_knowledge)
    go(page,'#resource/'+urllib.parse.quote('lede://object/'+newobject['id']+'?rev=1',safe=''));expect(page.locator('.markdown')).to_contain_text(['方法','所有结论必须来自真实资料。','保留稳定的引用。'])
    def search():
        go(page,'#knowledge');page.locator('[name=query]').fill('浏览器知识');page.locator('#search-form').evaluate('(f)=>f.requestSubmit()');page.wait_for_timeout(450);expect(page.locator('main')).to_contain_text('浏览器知识资料')
    check('中文全文检索与知识发现',search)
    def collection():
        go(page,'#collections');page.locator('[data-action=new-collection]').click();page.locator('[name=title]').fill('浏览器集合');save(page);page.locator('[data-action=collection-add]').click();page.locator('input[value="'+newobject['id']+'"]').check();save(page);expect(page.locator('.member-row')).to_contain_text('浏览器知识资料');page.locator('[data-action=collection-remove]').click();expect(page.locator('.member-row')).to_have_count(0);assert api('resource?id='+newobject['id'])
    check('集合增删关联，不删除知识',collection)
    def task():
        go(page,'#project/'+newpid+'/progress');page.locator('[data-action=new-task]').click();page.locator('[name=title]').fill('浏览器任务');page.locator('[name=acceptance]').fill('对象和视图均存在');save(page);page.locator('[data-action=task]').filter(has_text='浏览器任务').click();page.locator('[name=state]').select_option('done');page.locator('[name=evidence]').fill(newobject['uri']);save(page);assert next(x for x in api('resources?kind=task') if x['title']=='浏览器任务')['state']=='done'
    check('任务创建、验收证据与状态更新',task)
    def register():
        go(page,'#plugins/'+urllib.parse.quote(boot['widgets'][0]['key'],safe=''));expect(page.locator('[data-action=register-widget]')).to_be_enabled();page.locator('[data-action=register-widget]').click();save(page);expect(page.locator('[data-action=mount-widget]')).to_be_visible();page.locator('[data-action=mount-widget]').click();page.locator('[name=projectId]').select_option(newpid);page.locator('[name=title]').fill('浏览器漏斗视图');save(page);expect(page.frame_locator('iframe').locator('h3')).to_be_visible();page.frame_locator('iframe').locator('button').first.click();expect(page.locator('.context-chip')).to_be_visible();expect(page.frame_locator('iframe').locator('h3')).to_be_visible();screenshot(page,'10-live-widget.png')
    check('插件预览批准注册、挂载、交互选择',register)
    def configure():
        go(page,'#settings');page.locator('[name="chat.baseURL"]').fill(config['providerConfig']['chat']['baseURL']);page.locator('[name="chat.model"]').fill('fixture-not-a-real-model');page.locator('[name="chat.allowAnonymous"]').check();page.locator('[data-action=test-provider]').click();expect(page.locator('#toast-root')).to_contain_text('模型连接与响应测试通过',timeout=10000)
    check('模型设置真实 HTTP 流式协议测试',configure)
    def chat():
        go(page,'#project/'+newpid+'/overview');page.locator('#chat-form textarea').fill('执行浏览器验收');page.locator('#chat-form button[type=submit]').click();page.locator('h1').click();expect(page.locator('#chat-feed')).to_contain_text('测试工具已经保存报告',timeout=15000);assert any(x['title']=='浏览器验收报告' for x in api('resources?kind=object'));assert any(x['title']=='浏览器验收视图' for x in api('resources?kind=view'));screenshot(page,'11-agent-result.png')
    check('UI 发送→Agent 工具→知识落盘→视图生成→回传',chat)
    def canvas():
        go(page,'#view/'+vid+'/'+pid);page.locator('[data-action=layout-canvas]').click();expect(page.locator('.canvas-stage')).to_be_visible();box=page.locator('.view-block').first;handle=box.locator('.drag-handle');rect=handle.bounding_box();page.mouse.move(rect['x']+25,rect['y']+10);page.mouse.down();page.mouse.move(rect['x']+100,rect['y']+65);page.mouse.up();page.wait_for_timeout(500);assert api('view?id='+vid)['view']['revision']>1;screenshot(page,'12-canvas.png')
    check('画布拖动持久化布局',canvas)
    def mobile():
        page.set_viewport_size({'width':390,'height':844});go(page,'#home');assert page.evaluate('document.documentElement.scrollWidth')<=390;screenshot(page,'13-mobile.png');page.set_viewport_size({'width':1440,'height':1024})
    check('窄屏不出现页面级横向溢出',mobile)
    assert not errors,errors
    browser.close()
    report={'passed':len(checks),'failed':0,'checks':checks,'pageErrors':errors,'mode':'native navigation' if os.environ.get('LEDE_NATIVE_BROWSER')=='1' else 'in-memory DOM + real local HTTP bridge; no Chromium policies changed','limitations':([] if os.environ.get('LEDE_NATIVE_BROWSER')=='1' else ['Native browser URL navigation and production CSP execution are not exercised by this environment.'])+['Streaming/model tool tests use a deterministic HTTP fixture, not a live model.']}
    (OUT/'ui-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False,indent=2))
except Exception as e:
    (OUT/'ui-report.json').write_text(json.dumps({'passed':len(checks),'failed':1,'checks':checks,'error':str(e),'pageErrors':errors},ensure_ascii=False,indent=2));raise
finally:
    proc.terminate()
    try:proc.wait(timeout=10)
    except subprocess.TimeoutExpired:proc.kill();proc.wait()
    shutil.rmtree(home,ignore_errors=True)
