from playwright.sync_api import sync_playwright
import pathlib, json, os
root=pathlib.Path(os.environ.get('PROJECT_CONSTELLATION_ROOT','/mnt/data/project-constellation-v070-work'))
html=(root/'home.html').read_text(); js=(root/'home.js').read_text(); css=(root/'home.css').read_text()
chat={'id':'chatgpt:minecraft','providerId':'chatgpt','title':'Minecraft mod repair','url':'https://chatgpt.com/c/minecraft','projectId':'src:minecraft','projectName':'Minecraft','workspaceProjectId':'pc:minecraft','workspaceProjectName':'Minecraft Mods','status':'idle','coverage':'full-dom-walk','lastExcerpt':'Rebuilt the Forge jar and uploaded the verified build to Drive.','updatedAt':1760000000000}
blocked={'id':'chatgpt:blocked','providerId':'chatgpt','title':'Server build','url':'https://chatgpt.com/c/blocked','projectName':'Server','status':'blocked-approval','statusDetail':'Allow Google Drive access','updatedAt':1760000000000}
project={'id':'pc:minecraft','sourceType':'workspace','name':'Minecraft Mods','description':'Forge, Fabric, performance and mod repairs','groupId':'','icon':'C','color':'#10a37f','pinned':True,'chatCount':1,'fileCount':1,'attentionCount':0,'updatedAt':1760000000000}
smart={'id':'smart:forge','name':'Forge crashes','query':'forge crash','icon':'S','pinned':True,'updatedAt':1760000000000}
summary={'counts':{'providers':3,'projects':3,'chats':42,'turns':9200,'files':88},'recentChats':[chat],'recentFiles':[{'id':'f1','chatId':chat['id'],'providerId':'chatgpt','name':'minecraft-fixed.jar','externalUrl':'https://drive.google.com/file/d/test/view','externalProvider':'google-drive','updatedAt':1760000000000}],'recentProjects':[],'recentEvents':[],'attention':[blocked],'live':[],'topics':[{'term':'minecraft','count':18},{'term':'forge','count':11}],'catalog':{'status':'idle','discovered':42,'captured':40,'turnsCaptured':9200,'metadataOnly':2},'fullCapture':None,'discovery':{'browserHistoryGranted':True,'hiddenTabs':False},'organization':{'groups':[],'projects':[project],'providerProjects':[],'smartCollections':[smart],'tags':[{'name':'minecraft','count':18}],'pinnedChats':[chat],'favoriteChats':[],'unassignedCount':3},'sync':{'drive':{'lastStatus':'verified','lastSyncAt':1760000000000,'oauthProvisioned':True},'github':{'configured':True,'lastSyncAt':1760000000000}}}
providers=[{'id':'chatgpt','name':'ChatGPT','catalog':{}},{'id':'grok','name':'Grok','catalog':{}},{'id':'claude','name':'Claude','catalog':{}}]
mock=f"""
(() => {{
 const store={{}}; const summary={json.dumps(summary)}; const providers={json.dumps(providers)};
 globalThis.chrome={{
   runtime:{{sendMessage:async(m)=>{{
     if(m.type==='PC_HOME_SUMMARY')return {{ok:true,home:summary}};
     if(m.type==='PC_PROVIDER_LIST')return {{ok:true,providers}};
     if(m.type==='PC_ORG_SUMMARY')return {{ok:true,organization:summary.organization}};
     if(m.type==='PC_ORG_CHATS')return {{ok:true,items:[summary.recentChats[0]]}};
     if(m.type==='PC_BRAIN_LIST')return {{ok:true,items:[]}};
     if(m.type==='PC_HOME_SEARCH')return {{ok:true,result:{{groups:[],standalone:[],totalHits:0}}}};
     return {{ok:true}};
   }}}},
   storage:{{local:{{get:async(keys)=>{{const out={{}};for(const k of keys||[])if(k in store)out[k]=store[k];return out;}},set:async(obj)=>{{Object.assign(store,obj);}}}}}},
   tabs:{{create:async()=>({{id:1}}),query:async()=>[{{windowId:1}}]}},sidePanel:{{open:async()=>{{}}}},permissions:{{contains:async()=>true,request:async()=>true}}
 }};
 globalThis.__pcStore=store;
}})();
"""
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,args=['--no-sandbox'],executable_path=(os.environ.get('PROJECT_CONSTELLATION_CHROMIUM') or None))
    page=browser.new_page(viewport={'width':1600,'height':1000}); errors=[]; page.on('pageerror',lambda exc: errors.append(str(exc)))
    page.on('dialog',lambda dialog: dialog.accept('Power Workspace'))
    rendered=html.replace('<link rel="stylesheet" href="home.css">',f'<style>{css}</style>').replace('<script src="home.js"></script>','')
    page.set_content(rendered); page.add_script_tag(content=mock); page.add_script_tag(content=js); page.wait_for_timeout(180)
    assert page.locator('#editorTabs').inner_text().strip().startswith('Home')
    page.locator('#activityNav [data-view="projects"]').click(); page.wait_for_timeout(100)
    assert 'Projects' in page.locator('#editorTabs').inner_text()
    page.locator('#layoutButton').click(); page.locator('[data-layout-preset="operations"]').click(); page.wait_for_timeout(50)
    assert 'layout-no-panel' not in (page.locator('body').get_attribute('class') or '')
    page.locator('[data-primary-side="right"]').click(); page.locator('[data-density="compact"]').click(); page.locator('[data-theme-choice="midnight"]').click(); page.wait_for_timeout(30)
    body_class=page.locator('body').get_attribute('class') or ''
    assert 'primary-right' in body_class and page.locator('body').get_attribute('data-density')=='compact' and page.locator('body').get_attribute('data-theme')=='midnight'
    page.locator('#saveCurrentLayout').click(); page.wait_for_timeout(50)
    saved=page.evaluate("()=>Object.keys(__pcStore.pcWorkbenchSavedLayouts||{})")
    assert 'Power Workspace' in saved
    page.locator('#closeLayoutPopover').click()
    page.keyboard.press('Control+Shift+P'); page.fill('#commandInput','Focus Mode'); page.locator('.command-row').nth(1).click(); page.wait_for_timeout(30)
    assert 'layout-focus' in (page.locator('body').get_attribute('class') or '')
    page.keyboard.press('Control+Shift+P'); page.fill('#commandInput','Balanced Layout'); page.locator('.command-row').nth(1).click(); page.wait_for_timeout(30)
    assert 'layout-focus' not in (page.locator('body').get_attribute('class') or '')
    page.locator('#activityNav [data-view="overview"]').click(); page.wait_for_timeout(60)
    page.locator('#recentChats .work-card').first.click(); page.wait_for_timeout(30)
    assert 'Minecraft mod repair' in page.locator('#inspectorBody').inner_text()
    before=float(page.evaluate("()=>parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--primary-width'))"))
    box=page.locator('#primaryResizer').bounding_box()
    if box:
        page.mouse.move(box['x']+2,box['y']+120); page.mouse.down(); page.mouse.move(box['x']-38,box['y']+120); page.mouse.up(); page.wait_for_timeout(30)
    after=float(page.evaluate("()=>parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--primary-width'))"))
    assert before!=after
    screenshot=os.environ.get('PROJECT_CONSTELLATION_WORKBENCH_SCREENSHOT','/mnt/data/project-constellation-v070-work/dist/workbench-v070.png'); pathlib.Path(screenshot).parent.mkdir(parents=True,exist_ok=True); page.screenshot(path=screenshot,full_page=True)
    print(json.dumps({'saved':saved,'primaryBefore':before,'primaryAfter':after,'bodyClass':page.locator('body').get_attribute('class'),'errors':errors},sort_keys=True))
    assert not errors
    browser.close()
