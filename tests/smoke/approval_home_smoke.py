from playwright.sync_api import sync_playwright
import pathlib, json, os
root=pathlib.Path(os.environ.get('PROJECT_CONSTELLATION_ROOT','/mnt/data/project-constellation-v090-work'))
html=(root/'home.html').read_text(); js=(root/'home.js').read_text(); css=(root/'home.css').read_text()
summary={
 'counts':{'providers':1,'projects':1,'chats':3,'turns':20,'files':1,'knowledge':0},
 'statusCounts':{'blocked-approval':1,'stalled':1},
 'recentChats':[], 'recentFiles':[], 'recentProjects':[], 'recentEvents':[],
 'attention':[{'id':'chatgpt:blocked','providerId':'chatgpt','title':'GitHub mod upload','url':'https://chatgpt.com/c/blocked','projectName':'Minecraft','status':'blocked-approval','statusDetail':'Allow ChatGPT to use GitHub?','approvalConnector':'GitHub','updatedAt':1760000000000}],
 'live':[], 'topics':[], 'catalog':None, 'fullCapture':None,
 'discovery':{'browserHistoryGranted':False,'mode':'zero-tab-default','hiddenTabs':False,'manualFullCapture':True},
 'organization':{'projects':[]},
 'sync':{'drive':{'lastStatus':'not-connected','lastSyncAt':0,'oauthProvisioned':False},'github':{'configured':False,'lastSyncAt':0}},
 'approvalAutopilot':{'enabled':False,'acknowledged':False,'alwaysAllow':True,'fallbackAllowOnce':True,'autoRecoverPaused':True,'backgroundRecovery':True},
 'liveHealth':{'enabled':True,'showHealthy':True,'toolWatchdogEnabled':True,'capacityGuardEnabled':True,'corner':'bottom-right','density':'compact','softStallMs':45000,'hardStallMs':120000,'deadStallMs':240000,'capacityWarningTurns':180,'capacityHandoffTurns':260},
 'approvalRecovery':{'status':'idle','mode':'attention','total':0,'scanned':0,'recovered':0,'alwaysAllowed':0,'allowedOnce':0,'resumed':0,'failed':0,'startedAt':0}
}
providers=[{'id':'chatgpt','name':'ChatGPT','home':'https://chatgpt.com/','catalog':{'browserHistory':True,'backgroundHtml':True,'livePassive':True,'exportImport':'chatgpt-data-export'}}]
mock=f"""
(() => {{
 const summary={json.dumps(summary)}; const providers={json.dumps(providers)}; const messages=[];
 globalThis.chrome={{runtime:{{id:'pc-test',getURL:(p)=>'chrome-extension://pc-test/'+p,sendMessage:async(m)=>{{messages.push(m);
   if(m.type==='PC_HOME_SUMMARY')return {{ok:true,home:summary}};
   if(m.type==='PC_PROVIDER_LIST')return {{ok:true,providers}};
   if(m.type==='PC_CONNECTIONS_STATUS')return {{ok:true,extensionId:'pc-test',google:{{oauthProvisioned:false,connected:false}},github:{{connected:false}},providers:[]}};
   if(m.type==='PC_BRAIN_SETTINGS_GET')return {{ok:true,settings:{{approvalAutopilot:summary.approvalAutopilot,liveHealth:summary.liveHealth}}}};
   if(m.type==='PC_BRAIN_COUNTS')return {{ok:true,counts:summary.counts}};
   if(m.type==='PC_BRAIN_SETTINGS_SET'){{summary.approvalAutopilot={{...summary.approvalAutopilot,...(m.settings?.approvalAutopilot||{{}})}};summary.liveHealth={{...summary.liveHealth,...(m.settings?.liveHealth||{{}})}};return {{ok:true,settings:{{approvalAutopilot:summary.approvalAutopilot,liveHealth:summary.liveHealth}}}};}}
   if(m.type==='PC_APPROVAL_RECOVERY_START'){{summary.approvalRecovery={{status:'running',mode:m.mode,total:3,scanned:0,recovered:0,alwaysAllowed:0,allowedOnce:0,resumed:0,failed:0,startedAt:Date.now(),currentChatId:'chatgpt:blocked'}};return {{ok:true,state:summary.approvalRecovery}};}}
   if(m.type==='PC_APPROVAL_RECOVERY_STOP'){{summary.approvalRecovery={{...summary.approvalRecovery,status:'stopped'}};return {{ok:true,state:summary.approvalRecovery}};}}
   if(m.type==='PC_BRAIN_LIST')return {{ok:true,items:[]}};
   return {{ok:true}};
 }} }},tabs:{{create:async()=>({{id:1}}),query:async()=>[]}},sidePanel:{{open:async()=>{{}}}},permissions:{{contains:async()=>false,request:async()=>true}},storage:{{local:{{get:async()=>({{}}),set:async()=>{{}}}}}}}};
 globalThis.__messages=messages;globalThis.__summary=summary;
}})();
"""
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,args=['--no-sandbox'],executable_path=(os.environ.get('PROJECT_CONSTELLATION_CHROMIUM') or None))
    page=browser.new_page(viewport={'width':1440,'height':1000}); errors=[]; page.on('pageerror',lambda exc:errors.append(str(exc)))
    rendered=html.replace('<link rel="stylesheet" href="home.css">',f'<style>{css}</style>').replace('<script src="home.js"></script>','')
    page.set_content(rendered); page.add_script_tag(content=mock); page.add_script_tag(content=js); page.wait_for_timeout(160)
    page.locator('[data-view="attention"]').first.click(); page.wait_for_timeout(80)
    assert page.locator('#approvalAutopilotEnabled').is_visible()
    page.locator('#liveHealthShowHealthy').uncheck()
    page.locator('#liveHealthToolWatchdog').uncheck()
    page.locator('#approvalRiskAcknowledged').check(); page.wait_for_timeout(80)
    page.locator('#approvalFallbackAllowOnce').uncheck()
    page.locator('#approvalAutoRecoverPaused').uncheck()
    page.locator('#approvalAutopilotEnabled').check(); page.wait_for_timeout(400)
    persisted=page.evaluate("()=>({approval:{...__summary.approvalAutopilot},liveHealth:{...__summary.liveHealth}})")
    assert persisted['approval']['enabled'] is True and persisted['approval']['acknowledged'] is True
    assert persisted['approval']['fallbackAllowOnce'] is False and persisted['approval']['autoRecoverPaused'] is False
    assert persisted['liveHealth']['showHealthy'] is False and persisted['liveHealth']['toolWatchdogEnabled'] is False
    assert page.locator('#approvalFallbackAllowOnce').is_checked() is False
    assert page.locator('#approvalAutoRecoverPaused').is_checked() is False
    assert page.locator('#liveHealthShowHealthy').is_checked() is False
    assert page.locator('#liveHealthToolWatchdog').is_checked() is False
    assert page.locator('input[role="switch"] + .toggle-switch').count()==8
    page.locator('#saveLiveHealthSettings').click(); page.locator('#saveApprovalSettings').click(); page.wait_for_timeout(220)
    assert 'Saved at' in page.locator('#liveHealthSettingsStatus').text_content()
    assert 'Saved at' in page.locator('#approvalSettingsStatus').text_content()
    assert page.locator('#saveLiveHealthSettings').is_enabled()
    assert page.locator('#saveApprovalSettings').is_enabled()
    msgs=page.evaluate("()=>__messages.map(m=>({type:m.type,mode:m.mode,settings:m.settings}))")
    starts=[m for m in msgs if m['type']=='PC_APPROVAL_RECOVERY_START']
    assert not starts
    assert persisted['approval']['backgroundRecovery'] is False
    page.locator('#fixAllBlockedChats').click(); page.wait_for_timeout(120)
    msgs=page.evaluate("()=>__messages.map(m=>({type:m.type,mode:m.mode,settings:m.settings}))")
    starts=[m for m in msgs if m['type']=='PC_APPROVAL_RECOVERY_START']
    assert starts and starts[-1]['mode']=='all-known'
    assert page.locator('#approvalAutopilotBadge').text_content()=='ON'
    status=page.locator('#approvalRecoveryStatus').text_content()
    assert ('Open-tab recovery' in status) or ('Scanning all currently open ChatGPT chats' in status)
    reload_summary={**summary,'approvalAutopilot':persisted['approval'],'liveHealth':persisted['liveHealth']}
    reload_mock=mock.replace(f"const summary={json.dumps(summary)};",f"const summary={json.dumps(reload_summary)};",1)
    reload_mock=reload_mock.replace("if(m.type==='PC_HOME_SUMMARY')return {ok:true,home:summary};","if(m.type==='PC_HOME_SUMMARY')return {ok:false,error:'Failed to execute only on IDBKeyRange: invalid key'};",1)
    reloaded=browser.new_page(viewport={'width':1440,'height':1000}); reload_errors=[]; reloaded.on('pageerror',lambda exc:reload_errors.append(str(exc)))
    reloaded.set_content(rendered); reloaded.add_script_tag(content=reload_mock); reloaded.add_script_tag(content=js); reloaded.wait_for_timeout(180)
    reloaded.locator('[data-view="attention"]').first.click(); reloaded.wait_for_timeout(80)
    assert reloaded.locator('#approvalAutopilotEnabled').is_checked() is True
    assert reloaded.locator('#approvalRiskAcknowledged').is_checked() is True
    assert reloaded.locator('#approvalFallbackAllowOnce').is_checked() is False
    assert reloaded.locator('#approvalAutoRecoverPaused').is_checked() is False
    assert reloaded.locator('#liveHealthShowHealthy').is_checked() is False
    assert reloaded.locator('#liveHealthToolWatchdog').is_checked() is False
    assert reloaded.locator('#liveHealthSettingsStatus').text_content()=='Saved settings loaded.'
    assert reloaded.locator('#approvalSettingsStatus').text_content()=='Saved settings loaded.'
    assert reloaded.locator('#statusCountsText').text_content()=='3 indexed chats · 1 file · 0 knowledge'
    assert reloaded.evaluate("()=>getComputedStyle(document.querySelector('#approvalAutopilotEnabled + .toggle-switch'),'::after').content")==f'"ON"'
    assert reloaded.evaluate("()=>getComputedStyle(document.querySelector('#approvalFallbackAllowOnce + .toggle-switch'),'::after').content")==f'"OFF"'
    shot=os.environ.get('PROJECT_CONSTELLATION_APPROVAL_SCREENSHOT','/mnt/data/project-constellation-v090-work/dist/approval-autopilot-v090.png')
    pathlib.Path(shot).parent.mkdir(parents=True,exist_ok=True); reloaded.screenshot(path=shot,full_page=True)
    print(json.dumps({'status':status,'start':starts[-1],'messages':[m['type'] for m in msgs],'errors':errors,'reloadErrors':reload_errors},sort_keys=True))
    assert not errors and not reload_errors
    browser.close()
