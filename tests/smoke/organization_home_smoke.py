from playwright.sync_api import sync_playwright
import pathlib, json, os
root=pathlib.Path(os.environ.get('PROJECT_CONSTELLATION_ROOT','/mnt/data/pc-v060-work'))
html=(root/'home.html').read_text(); js=(root/'home.js').read_text(); css=(root/'home.css').read_text()
chat1={'id':'chatgpt:minecraft','providerId':'chatgpt','title':'Minecraft mod repair','url':'https://chatgpt.com/c/minecraft','projectId':'chatgpt:source:minecraft','projectName':'Source Minecraft','workspaceProjectId':'local:project:minecraft','workspaceProjectName':'Minecraft Mods','workspaceGroupId':'local:group:modding','status':'idle','tags':['minecraft','forge'],'pinned':True,'favorite':False,'lastExcerpt':'Patched the mod jar','updatedAt':1760000000000}
chat2={'id':'grok:skyrim','providerId':'grok','title':'Skyrim animation idea','url':'https://grok.com/c/skyrim','projectId':'grok:inbox','projectName':'Inbox','status':'idle','tags':['skyrim'],'pinned':False,'favorite':True,'lastExcerpt':'Animation framework notes','updatedAt':1759000000000}
org={'groups':[{'id':'local:group:modding','name':'Modding','icon':'M','color':'#6f8cff','parentId':'','pinned':True,'updatedAt':1760000000000}], 'projects':[{'id':'local:project:minecraft','sourceType':'workspace','name':'Minecraft Mods','description':'Forge and Fabric repairs','groupId':'local:group:modding','icon':'C','color':'#7d92ff','pinned':True,'chatCount':1,'fileCount':1,'attentionCount':0,'updatedAt':1760000000000}], 'providerProjects':[{'id':'chatgpt:source:minecraft','providerId':'chatgpt','name':'Minecraft source','sourceType':'provider','updatedAt':1760000000000}], 'smartCollections':[{'id':'local:smart:forge','name':'Forge crashes','query':'forge crash','groupId':'local:group:modding','icon':'S','pinned':True,'updatedAt':1760000000000}], 'tags':[{'name':'minecraft','count':1},{'name':'forge','count':1},{'name':'skyrim','count':1}], 'pinnedChats':[chat1], 'favoriteChats':[chat2], 'unassignedCount':1}
summary={'counts':{'providers':2,'projects':2,'chats':2,'turns':22,'files':1},'recentChats':[chat1,chat2],'recentFiles':[],'recentProjects':org['providerProjects'],'recentEvents':[],'attention':[],'live':[],'topics':[{'term':'minecraft','count':4}],'catalog':None,'fullCapture':None,'discovery':{'browserHistoryGranted':True,'mode':'zero-tab-default','hiddenTabs':False,'manualFullCapture':True},'organization':org,'sync':{'drive':{'lastStatus':'verified','lastSyncAt':1760000000000,'oauthProvisioned':True},'github':{'configured':False,'lastSyncAt':0}}}
providers=[{'id':'chatgpt','name':'ChatGPT','catalog':{}},{'id':'grok','name':'Grok','catalog':{}}]
mock=f"""
(() => {{
 const opened=[]; const messages=[]; const org={json.dumps(org)}; let chats={json.dumps([chat1,chat2])};
 const summary={json.dumps(summary)}; summary.organization=org; const providers={json.dumps(providers)};
 const findProject=(id)=>org.projects.find(p=>p.id===id);
 const refreshCounts=()=>{{for(const p of org.projects){{p.chatCount=chats.filter(c=>c.workspaceProjectId===p.id&&!c.organizedArchived).length;}}org.pinnedChats=chats.filter(c=>c.pinned&&!c.organizedArchived);org.favoriteChats=chats.filter(c=>c.favorite&&!c.organizedArchived);org.unassignedCount=chats.filter(c=>!c.workspaceProjectId&&!c.organizedArchived).length;}};
 globalThis.chrome={{runtime:{{id:'pc-test',sendMessage:async(m)=>{{messages.push(m);
   if(m.type==='PC_HOME_SUMMARY')return {{ok:true,home:summary}};
   if(m.type==='PC_PROVIDER_LIST')return {{ok:true,providers}};
   if(m.type==='PC_ORG_SUMMARY'){{refreshCounts();return {{ok:true,organization:org}};}}
   if(m.type==='PC_ORG_CHATS'){{let out=[...chats];const f=m.filters||{{}};if(f.workspaceProjectId)out=out.filter(c=>c.workspaceProjectId===f.workspaceProjectId);if(f.groupId)out=out.filter(c=>c.workspaceGroupId===f.groupId);if(f.tag)out=out.filter(c=>(c.tags||[]).includes(f.tag));if(f.mode==='unassigned')out=out.filter(c=>!c.workspaceProjectId);if(f.mode==='pinned')out=out.filter(c=>c.pinned);if(f.mode==='favorites')out=out.filter(c=>c.favorite);if(f.mode==='archived')out=out.filter(c=>c.organizedArchived);else out=out.filter(c=>!c.organizedArchived);return {{ok:true,items:out}};}}
   if(m.type==='PC_ORG_PROJECT_CREATE'){{const item={{id:'local:project:'+Math.random().toString(16).slice(2),sourceType:'workspace',name:m.input.name,description:m.input.description||'',groupId:m.input.groupId||'',icon:m.input.icon||'P',color:m.input.color||'#7d92ff',pinned:false,chatCount:0,fileCount:0,attentionCount:0,updatedAt:Date.now()}};org.projects.push(item);return {{ok:true,item}};}}
   if(m.type==='PC_ORG_GROUP_CREATE'){{const item={{id:'local:group:'+Math.random().toString(16).slice(2),...m.input,updatedAt:Date.now()}};org.groups.push(item);return {{ok:true,item}};}}
   if(m.type==='PC_ORG_SMART_CREATE'){{const item={{id:'local:smart:'+Math.random().toString(16).slice(2),...m.input,updatedAt:Date.now()}};org.smartCollections.push(item);return {{ok:true,item}};}}
   if(m.type==='PC_ORG_CHAT_PATCH'){{for(const id of m.chatIds||[]){{const c=chats.find(x=>x.id===id);if(!c)continue;const patch=m.patch||{{}};if('workspaceProjectId'in patch){{const p=findProject(patch.workspaceProjectId);c.workspaceProjectId=p?.id||'';c.workspaceProjectName=p?.name||'';c.workspaceGroupId=p?.groupId||'';}}if('pinned'in patch)c.pinned=patch.pinned;if('favorite'in patch)c.favorite=patch.favorite;if('organizedArchived'in patch)c.organizedArchived=patch.organizedArchived;if('tags'in patch)c.tags=String(patch.tags).split(',').map(x=>x.trim()).filter(Boolean);}}refreshCounts();return {{ok:true,items:chats}};}}
   if(m.type==='PC_ORG_ENTITY_UPDATE'){{const arr=m.kind==='project'?org.projects:m.kind==='group'?org.groups:org.smartCollections;const item=arr.find(x=>x.id===m.id);Object.assign(item,m.patch||{{}});return {{ok:true,item}};}}
   if(m.type==='PC_ORG_ENTITY_DELETE')return {{ok:true,result:{{deleted:true}}}};
   if(m.type==='PC_HOME_SEARCH')return {{ok:true,result:{{groups:[],standalone:[],totalHits:0}}}};
   if(m.type==='PC_BRAIN_LIST')return {{ok:true,items:[]}}; return {{ok:true}};
 }} }},tabs:{{create:async(o)=>{{opened.push(o.url);return {{id:1}}}},query:async()=>[{{windowId:1}}]}},sidePanel:{{open:async()=>{{}}}},permissions:{{contains:async()=>true,request:async()=>true}}}};
 globalThis.__orgMessages=messages; globalThis.__orgChats=()=>chats; globalThis.__orgState=org;
}})();
"""
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1500,'height':1000}); errors=[]; page.on('pageerror',lambda exc: errors.append(str(exc)))
    page.on('dialog',lambda dialog: dialog.accept())
    rendered=html.replace('<link rel="stylesheet" href="home.css">',f'<style>{css}</style>').replace('<script src="home.js"></script>','')
    page.set_content(rendered); page.add_script_tag(content=mock); page.add_script_tag(content=js); page.wait_for_timeout(140)
    page.locator('#homeNav button[data-view="projects"]').click(); page.wait_for_timeout(120)
    assert 'Minecraft Mods' in page.locator('#orgProjectGrid').inner_text(); assert 'Modding' in page.locator('#orgGroupTree').inner_text(); assert 'Forge crashes' in page.locator('#orgSmartList').inner_text(); assert '#minecraft' in page.locator('#orgTagCloud').inner_text()
    page.locator('#newProject').click(); page.fill('#orgName','Skyrim Mods'); page.select_option('#orgParent','local:group:modding'); page.fill('#orgDescription','Animations and modding research'); page.locator('#orgDialogSave').click(); page.wait_for_timeout(120)
    assert 'Skyrim Mods' in page.locator('#orgProjectGrid').inner_text()
    new_project=page.evaluate("()=>__orgState.projects.find(p=>p.name==='Skyrim Mods').id")
    page.locator('[data-drag-chat="grok:skyrim"]').drag_to(page.locator(f'[data-project-drop="{new_project}"]')); page.wait_for_timeout(140)
    assert page.evaluate("()=>__orgChats().find(c=>c.id==='grok:skyrim').workspaceProjectName")=='Skyrim Mods'
    page.locator('[data-org-select-chat="chatgpt:minecraft"]').check(); page.select_option('#orgBulkProject',new_project); page.locator('#orgBulkMove').click(); page.wait_for_timeout(120)
    assert 'Skyrim Mods' in page.locator('#orgChatList').inner_text()
    page.locator('[data-org-chat-action="favorite"][data-chat-id="grok:skyrim"]').click(); page.wait_for_timeout(100)
    workspace_shot=os.environ.get('PROJECT_CONSTELLATION_ORG_WORKSPACE_SCREENSHOT','/mnt/data/pc-v060-work/dist/organization-workspace-smoke.png'); pathlib.Path(workspace_shot).parent.mkdir(parents=True,exist_ok=True); page.screenshot(path=workspace_shot,full_page=True)
    page.locator('[data-org-smart="local:smart:forge"]').click(); page.wait_for_timeout(70)
    assert page.locator('#globalSearch').input_value()=='forge crash'
    shot=os.environ.get('PROJECT_CONSTELLATION_ORG_SCREENSHOT','/mnt/data/pc-v060-work/dist/organization-smoke.png'); pathlib.Path(shot).parent.mkdir(parents=True,exist_ok=True); page.screenshot(path=shot,full_page=True)
    result=page.evaluate("()=>({messages:__orgMessages.map(m=>m.type),chat:__orgChats().find(c=>c.id==='grok:skyrim')})")
    print(json.dumps({'result':result,'errors':errors},sort_keys=True))
    assert 'PC_ORG_PROJECT_CREATE' in result['messages'] and 'PC_ORG_CHAT_PATCH' in result['messages']
    assert result['chat']['workspaceProjectName']=='Skyrim Mods'
    assert not errors
    browser.close()
