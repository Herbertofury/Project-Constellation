from playwright.sync_api import sync_playwright
import pathlib, json, os, tempfile, time
root=pathlib.Path(os.environ.get('PROJECT_CONSTELLATION_ROOT','/mnt/data/project-constellation-v0120-work'))
html=(root/'home.html').read_text(); js=(root/'home.js').read_text(); css=(root/'home.css').read_text()
now_ms=int(time.time()*1000)
summary={
 'counts':{'providers':3,'projects':2,'chats':4,'turns':340,'files':3,'knowledge':12},
 'statusCounts':{'blocked-approval':1},
 'recentChats':[{'id':'chatgpt:minecraft','providerId':'chatgpt','title':'Minecraft mod repair','url':'https://chatgpt.com/c/minecraft','projectId':'chatgpt:minecraft','projectName':'Minecraft','status':'idle','lastExcerpt':'Patched the Fabric mod and rebuilt the jar','updatedAt':1760000000000}],
 'recentFiles':[{'id':'f1','chatId':'chatgpt:minecraft','providerId':'chatgpt','name':'fixed-minecraft-mod.jar','externalUrl':'https://drive.google.com/file/d/mod/view','externalProvider':'google-drive','updatedAt':1760000000000}],
 'recentProjects':[{'id':'chatgpt:minecraft','providerId':'chatgpt','name':'Minecraft','updatedAt':1760000000000}], 'recentEvents':[],
 'attention':[{'id':'chatgpt:blocked','providerId':'chatgpt','title':'Server build','url':'https://chatgpt.com/c/blocked','projectName':'Server','status':'blocked-approval','statusDetail':'Allow Google Drive access','updatedAt':1760000000000}],
 'live':[{'id':'chatgpt:tool-stuck','providerId':'chatgpt','title':'Tool-heavy extension build','url':'https://chatgpt.com/c/tool-stuck','projectName':'Project Constellation','status':'running','statusDetail':'Working','updatedAt':now_ms,'liveHealthState':'tool-stalled','liveHealthLevel':'danger','liveHealthTitle':'Tool call looks stuck · Called tool','liveHealthDetail':'No live provider request and no observable tool progress for 73 seconds.','liveHealthActivityKind':'tool','liveHealthActivityPhase':'executing','liveHealthActivityLabel':'Called tool','liveHealthToolSteps':12,'liveHealthNetworkActive':False,'liveHealthProgressAgeMs':73000,'liveHealthUpdatedAt':now_ms}], 'topics':[{'term':'minecraft','count':9},{'term':'server','count':4}],
 'catalog':None,'fullCapture':None,'discovery':{'browserHistoryGranted':False,'mode':'zero-tab-default','hiddenTabs':False,'manualFullCapture':True},
 'sync':{'drive':{'lastStatus':'verified','lastSyncAt':1760000000000,'oauthProvisioned':True},'github':{'configured':True,'lastSyncAt':1760000000000}},
 'projectIntegrity':{'enabled':True,'autoScan':True,'lastScanAt':1760000000000,'latestSeverity':'critical'},
 'integrity':{'counts':{'critical':2,'warning':2,'info':1},'total':5,'severity':'critical','baselines':[{'projectId':'local:minecraft','projectName':'Minecraft Mods','latestVersion':'1.3.0','chatCount':3,'fileCount':2,'turnCount':12,'health':'critical','counts':{'critical':2,'warning':2,'info':1}}],'findings':[{'type':'old-version-chat','severity':'critical','projectId':'local:minecraft','projectName':'Minecraft Mods','chatId':'chatgpt:minecraft-old','chatTitle':'Minecraft Mods v1.2.0 work','chatUrl':'https://chatgpt.com/c/minecraft-old','title':'Chat appears to be on v1.2.0 while project is at v1.3.0','detail':'Active chat is working from an older project state.','evidence':{'chatVersion':'1.2.0','latestVersion':'1.3.0'},'updatedAt':1760000000000},{'type':'artifact-hash-conflict','severity':'critical','projectId':'local:minecraft','projectName':'Minecraft Mods','title':'Conflicting artifacts detected for Minecraft Mods v1.3.0','detail':'The same project artifact/version has multiple SHA-256 values.','updatedAt':1760000000000}]},
 'requestGovernor':{'totalRequests':8,'totalFreshSkips':52,'totalNotModified':5,'totalThrottles':1,'providers':{'chatgpt':{'requests':8,'freshSkips':52,'notModified':5,'throttles':1,'waitMs':120000}}}
 ,'liveHealth':{'enabled':True,'showHealthy':True,'toolWatchdogEnabled':True,'corner':'bottom-right','density':'compact','softStallMs':45000,'hardStallMs':120000,'deadStallMs':240000}
 ,'knowledge':{'total':12,'pending':0,'extractionVersion':2,'kinds':{'recommendation':3,'repository':2,'mod':2,'link':1,'code':1,'command':1,'follow-up':1,'decision':1},'backfill':{'active':False,'queued':340},'continuity':[{'projectId':'local:minecraft','projectName':'Minecraft Mods','latestChatId':'chatgpt:minecraft','latestChatTitle':'Minecraft mod repair','latestChatUrl':'https://chatgpt.com/c/minecraft','latestRecommendation':{'kind':'recommendation','title':'Use ModernFix for this pack','text':'Use ModernFix for this pack','chatUrl':'https://chatgpt.com/c/minecraft','url':'https://www.curseforge.com/minecraft/mc-mods/modernfix','updatedAt':1760000000000},'updatedAt':1760000000000}]}
}
providers=[{'id':'chatgpt','name':'ChatGPT','home':'https://chatgpt.com/','catalog':{'browserHistory':True,'backgroundHtml':True,'livePassive':True,'exportImport':'chatgpt-data-export'}},{'id':'deepseek','name':'DeepSeek','home':'https://chat.deepseek.com/','catalog':{'browserHistory':True,'backgroundHtml':True,'livePassive':True}},{'id':'grok','name':'Grok','home':'https://grok.com/','catalog':{'browserHistory':True,'backgroundHtml':True,'livePassive':True}}]
search={'groups':[{'chat':summary['recentChats'][0],'score':180,'matches':[{'entityType':'turn','excerpt':'Fixed Minecraft mod crash and rebuilt the jar','updatedAt':1760000000000}], 'files':summary['recentFiles']}], 'standalone':[], 'totalHits':3}
knowledge_items=[{'id':'k1','kind':'recommendation','title':'Use ModernFix for this Minecraft pack','text':'I recommend ModernFix because it fixes expensive game loading paths.','relatedUrls':['https://www.curseforge.com/minecraft/mc-mods/modernfix'],'providerId':'chatgpt','workspaceProjectId':'local:minecraft','versions':['5.20.0'],'updatedAt':1760000000000,'chat':{'id':'chatgpt:minecraft','providerId':'chatgpt','title':'Minecraft mod repair','url':'https://chatgpt.com/c/minecraft','projectName':'Minecraft Mods'}},{'id':'k2','kind':'repository','title':'embeddedt/ModernFix','text':'https://github.com/embeddedt/ModernFix','url':'https://github.com/embeddedt/ModernFix','domain':'github.com','providerId':'chatgpt','updatedAt':1760000000000,'chat':{'id':'chatgpt:minecraft','providerId':'chatgpt','title':'Minecraft mod repair','url':'https://chatgpt.com/c/minecraft','projectName':'Minecraft Mods'}}]
mock=f"""
(() => {{
 const opened=[]; let ingested=0; let ghPending=false; const listeners={{}}; const messages=[];
 const providers={json.dumps(providers)}; const summary={json.dumps(summary)}; const search={json.dumps(search)}; const knowledgeItems={json.dumps(knowledge_items)};
 globalThis.chrome={{runtime:{{id:'pc-test',getURL:(p)=>'chrome-extension://pc-test/'+p,sendMessage:async(m)=>{{ messages.push(m.type);
   if(m.type==='PC_HOME_SUMMARY')return {{ok:true,home:summary}};
   if(m.type==='PC_PROVIDER_LIST')return {{ok:true,providers}};
   if(m.type==='PC_CONNECTIONS_STATUS')return {{ok:true,extensionId:'pc-test',google:{{oauthProvisioned:true,connected:false,lastStatus:'not-connected'}},github:{{connected:false,clientConfigured:ghPending,clientId:ghPending?'Iv1.demo':'',pending:ghPending?{{userCode:'ABCD-EFGH',verificationUri:'https://github.com/login/device'}}:null}},providers:providers.map((p)=>({{ok:true,providerId:p.id,name:p.name,state:p.id==='chatgpt'?'connected':'unknown',source:p.id==='chatgpt'?'open-tab':'none'}}))}};
   if(m.type==='PC_GITHUB_OAUTH_START'){{ghPending=true;return {{ok:true,userCode:'ABCD-EFGH',verificationUri:'https://github.com/login/device',intervalMs:5000}};}}
   if(m.type==='PC_GITHUB_OAUTH_POLL')return {{ok:true,state:'pending',userCode:'ABCD-EFGH',verificationUri:'https://github.com/login/device',retryAfterMs:5000}};
   if(m.type==='PC_HOME_SEARCH')return {{ok:true,result:search}};
   if(m.type==='PC_KNOWLEDGE_LIST')return {{ok:true,items:knowledgeItems}};
   if(m.type==='PC_KNOWLEDGE_REINDEX')return {{ok:true,state:{{active:true}}}};
   if(m.type==='PC_BRAIN_LIST')return {{ok:true,items:m.entityType==='project'?summary.recentProjects:m.entityType==='file'?summary.recentFiles:summary.recentChats}};
   if(m.type==='PC_BRAIN_INGEST_BATCH'){{ingested+=m.payload.length;return {{ok:true}};}}
   if(m.type==='PC_SEARCH_REBUILD')return {{ok:true,counts:{{}}}};
   if(m.type==='PC_CATALOG_START')return {{ok:true,state:{{status:'running'}}}};
   if(m.type==='PC_CATALOG_STOP')return {{ok:true}};
   if(m.type==='PC_FULL_CAPTURE_START')return {{ok:true,state:{{status:'running'}}}};
   if(m.type==='PC_FULL_CAPTURE_PAUSE'||m.type==='PC_FULL_CAPTURE_RESUME'||m.type==='PC_FULL_CAPTURE_STOP')return {{ok:true}};
   if(m.type==='PC_DRIVE_SYNC')return {{ok:true,size:1234,sha256:'abcdef1234567890abcdef'}};
   if(m.type==='PC_DRIVE_RESTORE')return {{ok:true,size:1234,sha256:'abcdef1234567890abcdef'}};
   return {{ok:true}};
 }} }},tabs:{{create:async(o)=>{{opened.push(o.url);return {{id:1}}}},query:async()=>[{{windowId:1}}]}},sidePanel:{{open:async()=>{{}}}},permissions:{{contains:async()=>false,request:async()=>true}}}};
 globalThis.__opened=opened; globalThis.__ingested=()=>ingested; globalThis.__messages=messages;
}})();
"""
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,args=['--no-sandbox'],executable_path=(os.environ.get('PROJECT_CONSTELLATION_CHROMIUM') or None))
    page=browser.new_page(); errors=[]; page.on('pageerror',lambda exc: errors.append(str(exc)))
    rendered=html.replace('<link rel="stylesheet" href="home.css">',f'<style>{css}</style>').replace('<script src="home.js"></script>','')
    page.set_content(rendered)
    page.add_script_tag(content=mock); page.add_script_tag(content=js); page.wait_for_timeout(120)
    overview_shot=os.environ.get('PROJECT_CONSTELLATION_HOME_OVERVIEW_SCREENSHOT','/mnt/data/project-constellation/dist/home-overview-smoke.png'); page.screenshot(path=overview_shot,full_page=True)
    live_text=page.locator('#liveWork').text_content()
    live_class=page.locator('#liveWork .status').first.get_attribute('class')
    assert 'tool-stalled' in live_text and 'No live provider request' in live_text and 'stalled' in live_class
    page.locator('#recentFiles [data-open-url]').first.click(); page.wait_for_timeout(20)
    page.locator('#recentFiles [data-chat-id]').first.click(); page.wait_for_timeout(40)
    page.fill('#globalSearch','minecraft'); page.keyboard.press('Enter'); page.wait_for_timeout(80)
    title=page.locator('#searchResults .search-card h3').first.text_content(); file_text=page.locator('#searchResults .related-files').first.text_content()
    page.locator('#searchResults [data-open-url]').first.click(); page.wait_for_timeout(20)
    export=[{
        'id':'imported-1','title':'Minecraft ideas','create_time':1760000000,'update_time':1760000100,
        'mapping':{'1':{'id':'1','message':{'id':'m1','author':{'role':'user'},'create_time':1760000000,'content':{'parts':['minecraft datapack idea']}}}}
    }]
    temp=pathlib.Path(tempfile.gettempdir())/'pc-conversations.json'; temp.write_text(json.dumps(export))
    page.set_input_files('#historyImport',str(temp)); page.wait_for_timeout(150)
    page.locator('#homeNav button[data-view="sources"]').click(); page.wait_for_timeout(30)
    page.locator('#startFullCapture').click(); page.wait_for_timeout(40)
    page.locator('#activityNav [data-view="integrity"]').click(); page.wait_for_timeout(30)
    integrity_text=page.locator('#integrityBrowser').text_content(); governor_text=page.locator('#requestGovernorCards').text_content()
    integrity_shot=os.environ.get('PROJECT_CONSTELLATION_INTEGRITY_SCREENSHOT','')
    if integrity_shot: page.screenshot(path=integrity_shot,full_page=True)
    assert 'v1.2.0' in integrity_text and 'multiple SHA-256 values' in integrity_text and '52 fresh skips' in governor_text
    page.locator('#runIntegrityScan').click(); page.wait_for_timeout(40)
    assert 'PC_INTEGRITY_SCAN' in page.evaluate('()=>__messages')
    page.locator('#activityNav [data-view="knowledge"]').click(); page.wait_for_timeout(40)
    assert 'Use ModernFix for this Minecraft pack' in page.locator('#knowledgeBrowser').text_content()
    assert 'embeddedt/ModernFix' in page.locator('#knowledgeBrowser').text_content()
    page.locator('#knowledgeBrowser button:has-text("Open exact chat")').first.click(); page.wait_for_timeout(20)
    page.locator('#activityNav [data-view="attention"]').click(); page.wait_for_timeout(30)
    page.locator('#liveHealthCorner').select_option('top-left'); page.wait_for_timeout(50)
    assert 'PC_BRAIN_SETTINGS_SET' in page.evaluate('()=>__messages')
    page.locator('#activityNav [data-view="connections"]').click(); page.wait_for_timeout(30)
    assert page.locator('#connectGoogleAccount').is_visible() and page.locator('#connectGithubAccount').is_visible()
    page.fill('#githubClientId','Iv1.demo'); page.locator('#connectGithubAccount').click(); page.wait_for_timeout(40)
    assert page.locator('#githubUserCode').text_content()=='ABCD-EFGH'
    screenshot=os.environ.get('PROJECT_CONSTELLATION_HOME_SCREENSHOT','/mnt/data/project-constellation/dist/home-smoke.png'); page.screenshot(path=screenshot,full_page=True)
    result=page.evaluate("""()=>({opened:__opened,ingested:__ingested(),messages:__messages,progress:document.getElementById('importProgress').textContent,zeroTab:document.getElementById('catalogHomeStatus').textContent,fullCapture:document.getElementById('fullCaptureStatus').textContent})""")
    print(json.dumps({'title':title,'file':file_text,'result':result,'errors':errors},sort_keys=True))
    assert title=='Minecraft mod repair' and 'fixed-minecraft-mod.jar' in file_text
    assert result['opened'][0]=='https://drive.google.com/file/d/mod/view'
    assert result['opened'][1]=='https://chatgpt.com/c/minecraft'
    assert result['opened'][2]=='https://chatgpt.com/c/minecraft'
    assert result['ingested']>=2 and 'Imported 1 chats' in result['progress']
    assert 'PC_FULL_CAPTURE_START' in result['messages']
    assert 'PC_GITHUB_OAUTH_START' in result['messages'] and 'https://github.com/login/device' in result['opened']
    assert not errors
    browser.close()
