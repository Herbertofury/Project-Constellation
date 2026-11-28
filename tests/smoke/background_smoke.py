from playwright.sync_api import sync_playwright
import pathlib, json, re, os
root=pathlib.Path(os.environ.get('PROJECT_CONSTELLATION_ROOT','/mnt/data/project-constellation'))
manifest=json.loads((root/'manifest.json').read_text())
brain=(root/'src/brain-core.js').read_text()
providers=(root/'src/provider-core.js').read_text()
integrity=(root/'src/integrity-core.js').read_text()
knowledge=(root/'src/knowledge-core.js').read_text()
memory=(root/'src/project-memory-core.js').read_text()
router=(root/'src/project-router-core.js').read_text()
intelligence=(root/'src/project-intelligence-core.js').read_text()
health=(root/'src/health-core.js').read_text(); guardian=(root/'src/scheduled-task-guardian-core.js').read_text(); chat_guardian=(root/'src/chat-guardian-core.js').read_text()
bg=(root/'background.js').read_text()
bg=re.sub(r"^import ['\"]\./src/[^'\"]+['\"];\s*",'',bg,flags=re.M)
state_bus=(root/'src/state-event-bus-core.js').read_text(); provider_health=(root/'src/provider-health-core.js').read_text(); incident_brain=(root/'src/incident-brain-core.js').read_text(); brain_db=(root/'src/brain-db-core.js').read_text(); message_router=(root/'src/background-message-router-core.js').read_text()
mock=f"""
(() => {{
 const bag={{}}; const sessionBag={{}}; const listeners={{}};
 const dbStores=new Map();
 const legacyChat={{id:'legacy:v8',providerId:'chatgpt',title:'Legacy v8 flags',url:'https://chatgpt.com/c/legacy-v8',pinned:true,favorite:true,organizedArchived:true,updatedAt:1}};
 dbStores.set('chats',{{keyPath:'id',rows:new Map([[legacyChat.id,legacyChat]]),indexes:new Map([
   ['updatedAt',{{keyPath:'updatedAt',multiEntry:false}}],['pinned',{{keyPath:'pinned',multiEntry:false}}],['favorite',{{keyPath:'favorite',multiEntry:false}}],['organizedArchived',{{keyPath:'organizedArchived',multiEntry:false}}]
 ])}});
 let dbVersion=8;
 if(!globalThis.crypto?.randomUUID) Object.defineProperty(globalThis.crypto,'randomUUID',{{value:()=>`pc-${{Date.now()}}-${{Math.random().toString(16).slice(2)}}`,configurable:true}});
 const validKey=(value)=>typeof value==='string'||(typeof value==='number'&&Number.isFinite(value))||(value instanceof Date&&Number.isFinite(value.getTime()))||(Array.isArray(value)&&value.every(validKey))||value instanceof ArrayBuffer||ArrayBuffer.isView(value);
 const only=(value)=>{{if(!validKey(value))throw new DOMException('The parameter is not a valid key.','DataError');return {{kind:'only',value}};}}, lowerBound=(value,open)=>({{kind:'lower',value,open}}), bound=(lower,upper,lowerOpen=false,upperOpen=false)=>({{kind:'bound',lower,upper,lowerOpen,upperOpen}});
 Object.defineProperty(globalThis,'IDBKeyRange',{{value:{{only,lowerBound,bound}},configurable:true}});
 const names=(map)=>({{contains:(name)=>map.has(name)}});
 const makeReq=(fn)=>{{const r={{result:undefined,error:null,onsuccess:null,onerror:null}};setTimeout(()=>{{try{{r.result=fn();r.onsuccess&&r.onsuccess();}}catch(e){{r.error=e;r.onerror&&r.onerror();}}}},0);return r;}};
 const cursorReq=(values,onUpdate)=>{{const r={{result:null,error:null,onsuccess:null,onerror:null}};let i=0;const step=()=>setTimeout(()=>{{try{{if(i>=values.length){{r.result=null;r.onsuccess&&r.onsuccess();return;}}const value=values[i++];r.result={{value,update:(next)=>{{onUpdate?.(value,next);return makeReq(()=>next);}},continue:step}};r.onsuccess&&r.onsuccess();}}catch(e){{r.error=e;r.onerror&&r.onerror();}}}},0);step();return r;}};
 function eq(a,b){{return Array.isArray(a)&&Array.isArray(b)?JSON.stringify(a)===JSON.stringify(b):a===b;}} function cmp(a,b){{if(Array.isArray(a)&&Array.isArray(b)){{for(let i=0;i<Math.max(a.length,b.length);i++){{if(a[i]===b[i])continue;return a[i]>b[i]?1:-1;}}return 0;}}return a===b?0:(a>b?1:-1);}} function matches(v,q){{if(!q)return true;if(q.kind==='only')return eq(v,q.value);if(q.kind==='lower')return q.open?cmp(v,q.value)>0:cmp(v,q.value)>=0;if(q.kind==='bound'){{const lo=cmp(v,q.lower),hi=cmp(v,q.upper);return (q.lowerOpen?lo>0:lo>=0)&&(q.upperOpen?hi<0:hi<=0);}}return eq(v,q);}} function keyVal(v,keyPath){{return Array.isArray(keyPath)?keyPath.map(k=>v?.[k]):v?.[keyPath];}}
 function storeApi(meta){{
   const api={{
    indexNames:names(meta.indexes),
    createIndex:(name,keyPath,opts={{}})=>{{meta.indexes.set(name,{{keyPath,multiEntry:!!opts.multiEntry}});return indexApi(meta,name);}},
    deleteIndex:(name)=>meta.indexes.delete(name),
    index:(name)=>indexApi(meta,name),
    get:(id)=>makeReq(()=>meta.rows.get(id)),
    getAll:(query,count)=>makeReq(()=>Array.from(meta.rows.values()).filter(v=>matches(v?.[meta.keyPath],query)).slice(0,count||Infinity)),
    put:(record)=>{{meta.rows.set(record[meta.keyPath],structuredClone(record));return makeReq(()=>record[meta.keyPath]);}},
    clear:()=>{{meta.rows.clear();return makeReq(()=>undefined);}},
    delete:(id)=>{{meta.rows.delete(id);return makeReq(()=>undefined);}},
    count:(query)=>makeReq(()=>Array.from(meta.rows.values()).filter(v=>matches(v?.[meta.keyPath],query)).length),
    openCursor:(query,direction)=>{{let values=Array.from(meta.rows.values()).filter(v=>matches(v?.[meta.keyPath],query));if(direction==='prev')values=values.reverse();return cursorReq(values,(previous,next)=>meta.rows.set(previous[meta.keyPath],structuredClone(next)));}}
   }}; return api;
 }}
 function indexApi(meta,name){{const idx=meta.indexes.get(name);return {{
   keyPath:idx.keyPath,
   getAll:(query,count)=>makeReq(()=>Array.from(meta.rows.values()).filter(v=>{{const val=keyVal(v,idx.keyPath);if(idx.multiEntry&&Array.isArray(val))return val.some(x=>matches(x,query));return matches(val,query);}}).slice(0,count||Infinity)),
   count:(query)=>makeReq(()=>Array.from(meta.rows.values()).filter(v=>{{const val=keyVal(v,idx.keyPath);if(idx.multiEntry&&Array.isArray(val))return val.some(x=>matches(x,query));return matches(val,query);}}).length),
   openCursor:(query,direction)=>{{let values=Array.from(meta.rows.values()).filter(v=>{{const val=keyVal(v,idx.keyPath);if(idx.multiEntry&&Array.isArray(val))return val.some(x=>matches(x,query));return matches(val,query);}}).sort((a,b)=>{{const av=keyVal(a,idx.keyPath),bv=keyVal(b,idx.keyPath);return av===bv?0:av>bv?1:-1;}});if(direction==='prev')values=values.reverse();return cursorReq(values);}},
   openKeyCursor:(query,direction)=>{{let keys=[];for(const v of meta.rows.values()){{const val=keyVal(v,idx.keyPath);if(idx.multiEntry&&Array.isArray(val))keys.push(...val);else keys.push(val);}}keys=keys.filter(v=>v!==undefined&&v!==null&&matches(v,query)).sort();if(direction==='nextunique')keys=[...new Set(keys.map(k=>String(k)))];const r={{result:null,error:null,onsuccess:null,onerror:null}};let i=0;const step=()=>setTimeout(()=>{{if(i>=keys.length){{r.result=null;r.onsuccess&&r.onsuccess();return;}}const key=keys[i++];r.result={{key,continue:step}};r.onsuccess&&r.onsuccess();}},0);step();return r;}}
 }};}}
 const fakeDb={{
   objectStoreNames:names(dbStores),
   createObjectStore:(name,opt={{}})=>{{const meta={{keyPath:opt.keyPath||'id',rows:new Map(),indexes:new Map()}};dbStores.set(name,meta);return storeApi(meta);}},
   transaction:(storeNames,mode)=>{{const tx={{oncomplete:null,onerror:null,error:null,objectStore:(name)=>storeApi(dbStores.get(name))}};setTimeout(()=>tx.oncomplete&&tx.oncomplete(),4);return tx;}},
   close:()=>{{}}
 }};
 Object.defineProperty(globalThis,'indexedDB',{{value:{{open:(name,version)=>{{const req={{result:fakeDb,transaction:{{objectStore:(n)=>storeApi(dbStores.get(n))}},onupgradeneeded:null,onsuccess:null,onerror:null,error:null}};setTimeout(()=>{{try{{if(version>dbVersion){{const oldVersion=dbVersion;dbVersion=version;req.onupgradeneeded&&req.onupgradeneeded({{oldVersion,newVersion:version}});}}setTimeout(()=>req.onsuccess&&req.onsuccess(),0);}}catch(e){{req.error=e;req.onerror&&req.onerror();}}}},0);return req;}}}},configurable:true}});
 const normalizeGet=(keys)=>{{ if(keys===null||keys===undefined)return {{...bag}}; if(typeof keys==='string')return {{[keys]:bag[keys]}}; if(Array.isArray(keys))return Object.fromEntries(keys.map(k=>[k,bag[k]])); return Object.fromEntries(Object.keys(keys||{{}}).map(k=>[k,bag[k]??keys[k]])); }};
 const normalizeSessionGet=(keys)=>{{ if(keys===null||keys===undefined)return {{...sessionBag}}; if(typeof keys==='string')return {{[keys]:sessionBag[keys]}}; if(Array.isArray(keys))return Object.fromEntries(keys.map(k=>[k,sessionBag[k]])); return Object.fromEntries(Object.keys(keys||{{}}).map(k=>[k,sessionBag[k]??keys[k]])); }};
 globalThis.__pcNotifications=[]; globalThis.__pcClearedNotifications=[];
 globalThis.chrome={{
   runtime:{{id:'geljambmkfjkhodgkpjhnmfojkpcamig',getURL:(p)=>'chrome-extension://geljambmkfjkhodgkpjhnmfojkpcamig/'+p,getManifest:()=>({json.dumps(manifest)}),sendMessage:async()=>({{ok:true}}),onMessage:{{addListener:(fn)=>listeners.message=fn}},onInstalled:{{addListener:(fn)=>listeners.installed=fn}},onStartup:{{addListener:(fn)=>listeners.startup=fn}}}},
   storage:{{local:{{get:async(keys)=>normalizeGet(keys),set:async(obj)=>Object.assign(bag,obj),remove:async(keys)=>{{for(const k of (Array.isArray(keys)?keys:[keys]))delete bag[k];}}}},session:{{get:async(keys)=>normalizeSessionGet(keys),set:async(obj)=>Object.assign(sessionBag,obj),remove:async(keys)=>{{for(const k of (Array.isArray(keys)?keys:[keys]))delete sessionBag[k];}}}}}},
   alarms:{{create:async()=>{{}},clear:async()=>true,onAlarm:{{addListener:(fn)=>listeners.alarm=fn}}}},
   sidePanel:{{setPanelBehavior:async()=>{{}}}},action:{{setBadgeText:async()=>{{}},setTitle:async()=>{{}}}},
   identity:{{getAuthToken:async()=>({{token:'test-token'}}),removeCachedAuthToken:async()=>{{}},clearAllCachedAuthTokens:async()=>{{}}}},
   idle:{{queryState:async()=> 'idle'}},tabs:{{query:async()=>[],create:async(options)=>{{globalThis.__pcCreatedTabs.push(options);return {{id:88,...options}};}},update:async(id,props)=>({{id,...props}}),reload:async()=>undefined,get:async()=>null,sendMessage:async()=>({{ok:true}}),onRemoved:{{addListener:(fn)=>listeners.tabRemoved=fn}},onCreated:{{addListener:(fn)=>listeners.tabCreated=fn}},onUpdated:{{addListener:(fn)=>listeners.tabUpdated=fn}},onReplaced:{{addListener:(fn)=>listeners.tabReplaced=fn}}}},scripting:{{executeScript:async(options)=>{{const id=Number(options?.target?.tabId||0);if(id===104)return [{{result:{{ok:true,source:'scripting-dom-probe',chat:{{status:'idle',rawStatus:'idle',title:'Old Tab',url:'https://chatgpt.com/c/old-a',lastActivityAt:Date.now()-2500,healthState:'healthy'}},generation:{{active:false}},healthActive:false,healthStale:false,observedAt:Date.now()}}}}];return [];}}}},downloads:{{}},
   tabGroups:{{query:async()=>[],get:async()=>null,update:async()=>null,onUpdated:{{addListener:(fn)=>listeners.tabGroupUpdated=fn}},onRemoved:{{addListener:(fn)=>listeners.tabGroupRemoved=fn}}}},
   webRequest:{{onBeforeRequest:{{addListener:(fn)=>listeners.webBefore=fn}},onResponseStarted:{{addListener:(fn)=>listeners.webResponse=fn}},onCompleted:{{addListener:(fn)=>listeners.webComplete=fn}},onErrorOccurred:{{addListener:(fn)=>listeners.webError=fn}}}},
   notifications:{{create:async(id,options)=>{{__pcNotifications.push({{id,options}});return id;}},clear:async(id)=>{{__pcClearedNotifications.push(id);return true;}},onClicked:{{addListener:(fn)=>listeners.notificationClicked=fn}},onButtonClicked:{{addListener:(fn)=>listeners.notificationButton=fn}}}}
 }};
 globalThis.__pcFetchCount=0;
 globalThis.fetch=async(url)=>{{globalThis.__pcFetchCount++;return {{ok:false,status:429,url:String(url),headers:{{get:(name)=>String(name).toLowerCase()==='retry-after'?'120':String(name).toLowerCase()==='content-type'?'text/html':''}},text:async()=>''}};}};
 globalThis.__pcBag=bag; globalThis.__pcSessionBag=sessionBag; globalThis.__pcListeners=listeners; globalThis.__pcDbStores=dbStores; globalThis.__pcCreatedTabs=[];
 globalThis.__pcSend=(message,sender={{}})=>new Promise((resolve,reject)=>{{try{{const keep=listeners.message(message,sender,resolve);if(!keep&&keep!==true)setTimeout(()=>resolve(undefined),0);}}catch(e){{reject(e)}}}});
}})();
"""

with sync_playwright() as p:
    launch={'headless':True,'args':['--no-sandbox']}
    chromium=os.environ.get('PROJECT_CONSTELLATION_CHROMIUM','').strip()
    if chromium:
        launch['executable_path']=chromium
    browser=p.chromium.launch(**launch)
    page=browser.new_page(); errors=[]; page.on('pageerror',lambda exc: errors.append(str(exc)))
    page.set_content('<!doctype html><html><body></body></html>')
    page.add_script_tag(content=mock)
    page.add_script_tag(content=brain)
    page.add_script_tag(content=providers)
    page.add_script_tag(content=integrity)
    page.add_script_tag(content=knowledge)
    page.add_script_tag(content=memory)
    page.add_script_tag(content=router)
    page.add_script_tag(content=intelligence)
    page.add_script_tag(content=health)
    page.add_script_tag(content=guardian)
    page.add_script_tag(content=chat_guardian)
    page.add_script_tag(content=state_bus)
    page.add_script_tag(content=provider_health)
    page.add_script_tag(content=incident_brain)
    page.add_script_tag(content=brain_db)
    page.add_script_tag(content=message_router)
    page.add_script_tag(content=bg)
    page.wait_for_timeout(100)
    result=page.evaluate("""async()=>{
      // Force the v8 -> v9 upgrade to finish before the concurrent ingestion paths
      // exercise the database. Native IndexedDB blocks those opens automatically;
      // this lightweight fake needs the explicit warm-up.
      await __pcSend({type:'PC_ORG_CHATS',filters:{mode:'pinned',limit:20}});
      await new Promise((resolve)=>setTimeout(resolve,20));
      const now=Date.now();
      const items=[
        {type:'PROVIDER_SEEN',data:{id:'chatgpt',name:'ChatGPT',home:'https://chatgpt.com/',updatedAt:now}},
        {type:'CHAT_UPSERT',data:{id:'chatgpt:test',providerId:'chatgpt',providerName:'ChatGPT',title:'Drive approval recovery project',url:'https://chatgpt.com/c/test',projectId:'chatgpt:section:recovery',projectName:'Recovery',status:'blocked-approval',statusDetail:'Allow Google Drive access to continue',updatedAt:now}},
        {type:'TURN_UPSERT',data:{id:'chatgpt:test:t1',chatId:'chatgpt:test',providerId:'chatgpt',role:'assistant',ordinal:1,text:'Generated the recovery checkpoint and uploaded the database to Google Drive.',url:'https://chatgpt.com/c/test',updatedAt:now}},
        {type:'FILE_UPSERT',data:{id:'chatgpt:test:file1',chatId:'chatgpt:test',providerId:'chatgpt',name:'Project-Constellation-Checkpoint.json',href:'https://drive.google.com/file/d/demo/view',externalUrl:'https://drive.google.com/file/d/demo/view',externalProvider:'google-drive',kind:'google-drive',updatedAt:now}}
      ];
      const ingest=await __pcSend({type:'PC_BRAIN_INGEST_BATCH',payload:items});
      const richVaultTurn={id:'chatgpt:test:t1',chatId:'chatgpt:test',providerId:'chatgpt',role:'assistant',ordinal:1,text:'Final production result. The complete release is ready with every requested fix, recovery note, and verification detail.\\n\\nDownload the full build and keep the generated constellation image.',links:[{href:'https://example.com/Project-Constellation-v0.14.0.zip',text:'Full release build'}],codeBlocks:[{language:'json',text:'{"release":"verified","complete":true}'}],assets:[{id:'result-image',kind:'image',url:'https://example.com/constellation-result.png',alt:'Generated constellation result',width:1024,height:1024}],url:'https://chatgpt.com/c/test',updatedAt:now+1};
      richVaultTurn.formattedText='## Final production result\\n\\nThe complete release is ready with **every requested fix**.\\n\\n- Recovery note retained\\n- Verification detail retained';
      await __pcSend({type:'PC_BRAIN_INGEST_BATCH',payload:[{type:'TURN_UPSERT',data:richVaultTurn},{type:'FILE_UPSERT',data:{id:'chatgpt:test:embedded-image',chatId:'chatgpt:test',parentTurnId:'chatgpt:test:t1',providerId:'chatgpt',name:'Generated constellation result',href:'https://example.com/constellation-result.png',kind:'image',embedded:true,embeddedMimeType:'image/png',embeddedDataUrl:'data:image/png;base64,iVBORw0KGgo=',updatedAt:now+1}}]});
      const rescueAck=await __pcSend({type:'PC_RESCUE_TURN_COMMIT',turn:richVaultTurn});
      const rescueChat=structuredClone(__pcDbStores.get('chats').rows.get('chatgpt:test'));
      const poorVaultTurn={id:'chatgpt:test:t1',chatId:'chatgpt:test',providerId:'chatgpt',role:'assistant',ordinal:1,text:'Called tool\\nCalled tool\\nSearched 2 websites\\nUsed browser skill',links:[],codeBlocks:[],assets:[],url:'https://chatgpt.com/c/test',updatedAt:now+2};
      await __pcSend({type:'PC_BRAIN_INGEST_BATCH',payload:[{type:'TURN_UPSERT',data:poorVaultTurn}]});
      const poorFingerprint=ProjectConstellationBrainCore.turnFingerprint(poorVaultTurn);
      const outputObserve=await __pcSend({type:'PC_OUTPUT_OBSERVE',chatId:'chatgpt:test',providerId:'chatgpt',url:'https://chatgpt.com/c/test',hydrated:true,atBottom:true,running:false,observedAt:now+3,fingerprint:ProjectConstellationBrainCore.outputObservationFingerprint([{id:poorVaultTurn.id,ordinal:1,fingerprint:poorFingerprint}]),turns:[{id:poorVaultTurn.id,messageId:'t1',role:'assistant',ordinal:1,fingerprint:poorFingerprint,score:ProjectConstellationBrainCore.turnRichnessScore(poorVaultTurn),textLength:poorVaultTurn.text.length,excerpt:poorVaultTurn.text,links:[],assets:[],codeBlocks:0}]});
      const outputVault=await __pcSend({type:'PC_OUTPUT_COMPARE',chatId:'chatgpt:test',offset:0,limit:120});
      const outputRevisions=await __pcSend({type:'PC_OUTPUT_TURN_REVISIONS',turnId:'chatgpt:test:t1'});
      const outputCanonical=structuredClone(__pcDbStores.get('turns').rows.get('chatgpt:test:t1'));
      const group=await __pcSend({type:'PC_ORG_GROUP_CREATE',input:{name:'Modding',icon:'M'}});
      const project=await __pcSend({type:'PC_ORG_PROJECT_CREATE',input:{name:'Minecraft Mods',groupId:group.item.id,icon:'C',description:'All Minecraft mod repairs'}});
      await __pcSend({type:'PC_BRAIN_INGEST_BATCH',payload:[
        {type:'CHAT_UPSERT',data:{id:'chatgpt:old',providerId:'chatgpt',title:'Minecraft Mods v1.2.0 compatibility work',url:'https://chatgpt.com/c/old',status:'running',lastExcerpt:'Working from Minecraft Mods v1.2.0',updatedAt:now+10}},
        {type:'CHAT_UPSERT',data:{id:'chatgpt:new',providerId:'chatgpt',title:'Minecraft Mods v1.3.0 release',url:'https://chatgpt.com/c/new',status:'idle',lastExcerpt:'Minecraft Mods v1.3.0 release',updatedAt:now+20}},
        {type:'TURN_UPSERT',data:{id:'chatgpt:new:t1',chatId:'chatgpt:new',providerId:'chatgpt',role:'assistant',ordinal:1,text:'I recommend ModernFix for this Minecraft project: https://github.com/embeddedt/ModernFix\\nDecision: we will use ModernFix v5.20.0 as the baseline.\\n```java\\npublic class CreatureSelector { public void applyFix() {} }\\n```\\nImplemented creature selector and verified creature selector working.',updatedAt:now+20}},
        {type:'TURN_UPSERT',data:{id:'chatgpt:new:t2',chatId:'chatgpt:new',providerId:'chatgpt',role:'assistant',ordinal:2,text:'Creature selector is broken after the latest change.',updatedAt:now+21}},
        {type:'FILE_UPSERT',data:{id:'release:a',chatId:'chatgpt:new',providerId:'chatgpt',workspaceProjectId:project.item.id,name:'Minecraft-Mods-v1.3.0-source.zip',sha256:'aaa',size:100,updatedAt:now+20}},
        {type:'FILE_UPSERT',data:{id:'release:b',chatId:'chatgpt:new',providerId:'chatgpt',workspaceProjectId:project.item.id,name:'Minecraft-Mods-v1.3.0-source.zip',sha256:'bbb',size:100,updatedAt:now+21}}
      ]});
      await __pcSend({type:'PC_BRAIN_INGEST_BATCH',payload:[{type:'CHAT_UPSERT',data:{id:'chatgpt:old',providerId:'chatgpt',status:'refresh-required',retryForbidden:true,automaticRetryForbidden:true,updatedAt:now+22}}]});
      await __pcSend({type:'PC_BRAIN_INGEST_BATCH',payload:[{type:'CHAT_UPSERT',data:{id:'chatgpt:old',providerId:'chatgpt',status:'running',updatedAt:now+23}}]});
      const recoveredRetryFlags=structuredClone(__pcDbStores.get('chats').rows.get('chatgpt:old'));
      await __pcSend({type:'PC_ORG_CHAT_PATCH',chatIds:['chatgpt:old','chatgpt:new'],patch:{workspaceProjectId:project.item.id,tags:['minecraft','mods']}});
      const smart=await __pcSend({type:'PC_ORG_SMART_CREATE',input:{name:'Forge crashes',groupId:group.item.id,query:'forge crash'}});
      const patch=await __pcSend({type:'PC_ORG_CHAT_PATCH',chatIds:['chatgpt:test'],patch:{workspaceProjectId:project.item.id,tags:['minecraft','forge'],pinned:true,favorite:true}});
      const org=await __pcSend({type:'PC_ORG_SUMMARY'});
      const orgChats=await __pcSend({type:'PC_ORG_CHATS',filters:{workspaceProjectId:project.item.id,limit:20}});
      const pinnedChats=await __pcSend({type:'PC_ORG_CHATS',filters:{mode:'pinned',limit:20}});
      const favoriteChats=await __pcSend({type:'PC_ORG_CHATS',filters:{mode:'favorites',limit:20}});
      await __pcSend({type:'PC_ORG_CHAT_PATCH',chatIds:['chatgpt:test'],patch:{organizedArchived:true}});
      const archivedChats=await __pcSend({type:'PC_ORG_CHATS',filters:{mode:'archived',limit:20}});
      const migratedLegacy=structuredClone(__pcDbStores.get('chats').rows.get('legacy:v8'));
      const migratedIndexes=Object.fromEntries(['pinned','favorite','organizedArchived'].map(name=>[name,__pcDbStores.get('chats').indexes.get(name)?.keyPath]));
      await __pcSend({type:'PC_ORG_CHAT_PATCH',chatIds:['chatgpt:test'],patch:{organizedArchived:false}});
      const settingsWrites=await Promise.all([
        __pcSend({type:'PC_BRAIN_SETTINGS_SET',settings:{approvalAutopilot:{acknowledged:true,fallbackAllowOnce:false}}}),
        __pcSend({type:'PC_BRAIN_SETTINGS_SET',settings:{liveHealth:{showHealthy:false}}})
      ]);
      const settingsGet=await __pcSend({type:'PC_BRAIN_SETTINGS_GET'});
      const capacityMigration=migrateLiveHealthCapacityProfile({capacityWarningTurns:180,capacityHandoffTurns:260,capacityWarningChars:240000,capacityHandoffChars:400000});
      const capacityCustom=migrateLiveHealthCapacityProfile({capacityWarningTurns:150,capacityHandoffTurns:230,capacityWarningChars:200000,capacityHandoffChars:330000});
      const homeAfterSettings=await __pcSend({type:'PC_HOME_SUMMARY'});
      const search=await __pcSend({type:'PC_BRAIN_SEARCH',query:'Google Drive recovery',limit:20});
      const integrityScan={ok:true,summary:{findings:[]}};
      const [providerCheck1,providerCheck2]=await Promise.all([
        __pcSend({type:'PC_PROVIDER_SESSION_STATUS',providerId:'chatgpt',network:true}),
        __pcSend({type:'PC_PROVIDER_SESSION_STATUS',providerId:'chatgpt',network:true})
      ]);
      const governor=await __pcSend({type:'PC_REQUEST_GOVERNOR_STATUS'});
      __pcListeners.webBefore({tabId:7,requestId:'health-aux',type:'xmlhttprequest',url:'https://chatgpt.com/backend-api/conversations?offset=0',method:'GET',initiator:'https://chatgpt.com'});
      __pcListeners.webBefore({tabId:7,requestId:'health-1',type:'xmlhttprequest',url:'https://chatgpt.com/backend-api/conversation',method:'POST',initiator:'https://chatgpt.com'});
      const healthActive=await __pcSend({type:'PC_LIVE_HEALTH_CONTEXT',chatId:'chatgpt:test'},{tab:{id:7,url:'https://chatgpt.com/c/test'}});
      __pcListeners.webResponse({tabId:7,requestId:'health-1',type:'xmlhttprequest',url:'https://chatgpt.com/backend-api/conversation',method:'POST',statusCode:200,initiator:'https://chatgpt.com'});
      __pcListeners.webComplete({tabId:7,requestId:'health-1',type:'xmlhttprequest',url:'https://chatgpt.com/backend-api/conversation',method:'POST',statusCode:200,initiator:'https://chatgpt.com'});
      const healthQuiet=await __pcSend({type:'PC_LIVE_HEALTH_CONTEXT',chatId:'chatgpt:test'},{tab:{id:7,url:'https://chatgpt.com/c/test'}});
      chrome.tabs.query=async()=>[{id:41,windowId:1,active:true,url:'https://chatgpt.com/c/old',title:'Old Chat'}];
      const pulseActive=await __pcSend({type:'PC_PULSE_ACTIVE_CHAT'});
      const pulseAssign=await __pcSend({type:'PC_PULSE_CHAT_PROJECT_SET',input:{chatId:'chatgpt:old',tabId:41,projectId:project.item.id}});
      const pulseCreate=await __pcSend({type:'PC_PULSE_CHAT_PROJECT_SET',input:{chatId:'chatgpt:old',tabId:41,newProjectName:'Pulse Quick Project'}});
      chrome.tabs.query=async()=>[{id:42,windowId:1,active:true,url:'https://chatgpt.com/c/new',title:'New Chat'}];
      const pulseMismatch=await __pcSend({type:'PC_PULSE_CHAT_PROJECT_SET',input:{chatId:'chatgpt:old',tabId:41,projectId:project.item.id}});
      __pcDbStores.get('chats').rows.set('chatgpt:live-a',{id:'chatgpt:live-a',providerId:'chatgpt',title:'Live A',url:'https://chatgpt.com/c/live-a',workspaceProjectId:'workspace:constellation',workspaceProjectName:'Project Constellation',updatedAt:now});
      __pcDbStores.get('turns').rows.set('chatgpt:live-a:user:9',{id:'chatgpt:live-a:user:9',chatId:'chatgpt:live-a',providerId:'chatgpt',role:'user',ordinal:9,text:'Make the confusing live tab titles explain what the chat is actually working on and which project owns it.',updatedAt:now});
      chrome.tabs.query=async()=>[
        {id:101,windowId:1,groupId:201,url:'https://chatgpt.com/c/live-a',title:'Live A'},
        {id:102,windowId:1,groupId:-1,url:'https://chatgpt.com/c/stale-a',title:'Stale A'},
        {id:103,windowId:2,groupId:301,url:'https://chatgpt.com/c/done-a',title:'Done A'},
        {id:104,windowId:2,groupId:-1,url:'https://chatgpt.com/c/old-a',title:'Old Tab'},
        {id:105,windowId:2,groupId:301,url:'https://chatgpt.com/c/reconnect-a',title:'Reconnect Tab'}
      ];
      chrome.tabGroups.query=async()=>[
        {id:201,windowId:1,title:'PC ✦ 🟣 Active',color:'purple',collapsed:false},
        {id:301,windowId:2,title:'My Research',color:'blue',collapsed:true}
      ];
      chrome.tabs.sendMessage=async(id,msg)=>{
        if(msg.type!=='PC_GET_LIVE_CHAT_STATE')return {ok:true};
        if(id===101)return {ok:true,chat:{id:'chatgpt:live-a',status:'running',rawStatus:'running',lastActivityAt:Date.now(),healthState:'working'},generation:{active:true,toolLabel:'Updating Pulse context rows',phase:'editing'},healthActive:true};
        if(id===102)return {ok:true,chat:{id:'chatgpt:stale-a',status:'errored',rawStatus:'errored',lastActivityAt:Date.now()-1000,healthState:'errored'},generation:{active:false}};
        if(id===103)return {ok:true,chat:{id:'chatgpt:done-a',status:'idle',rawStatus:'idle',lastActivityAt:Date.now()-2000,healthState:'healthy'},generation:{active:false}};
        throw new Error('Receiving end does not exist');
      };
      const livePulse=await __pcSend({type:'PC_LIVE_CHAT_PULSE',force:true});
      globalThis.__pcGuardianSends=[];
      chrome.tabs.query=async()=>[
        {id:121,windowId:3,groupId:-1,url:'https://chatgpt.com/c/guardian-failed',title:'Guardian Failed',discarded:false},
        {id:122,windowId:3,groupId:-1,url:'https://chatgpt.com/c/guardian-healthy',title:'Guardian Healthy',discarded:false}
      ];
      chrome.tabs.sendMessage=async(id,msg)=>{
        if(msg.type==='PC_GET_LIVE_SENTINEL_STATE'){
          if(id===121)return {ok:true,source:'live-sentinel',sentinel:true,version:'0.25.0',observedAt:Date.now(),chat:{id:'chatgpt:guardian-failed',status:'response-interrupted',rawStatus:'response-interrupted',healthState:'response-interrupted',lastActivityAt:Date.now()-5000},failure:{active:true,state:'response-interrupted',status:'response-interrupted',title:'Response stream timed out',rawText:'ChatGPT stream recovery polling timed out',fingerprint:'provider-timeout',detectedAt:Date.now()-5000},generation:{active:false,quietForMs:5000}};
          return {ok:true,source:'live-sentinel',sentinel:true,version:'0.25.0',observedAt:Date.now(),chat:{id:'chatgpt:guardian-healthy',status:'idle',rawStatus:'idle',healthState:'healthy',lastActivityAt:Date.now()},generation:{active:false,finalControls:true,quietForMs:0}};
        }
        if(msg.type==='PC_LIVE_SENTINEL_CONTINUE_UNFINISHED'){
          __pcGuardianSends.push({id,message:structuredClone(msg)});
          return {ok:true,action:'sent-continue',chatId:'guardian-failed',state:msg.reason,prompt:msg.prompt};
        }
        return {ok:true};
      };
      const chatGuardianRun=await __pcSend({type:'PC_CHAT_GUARDIAN_RUN'});
      const chatGuardianStatus=await __pcSend({type:'PC_CHAT_GUARDIAN_STATUS'});
      __pcDbStores.get('chats').rows.delete('chatgpt:live-a');
      __pcDbStores.get('turns').rows.delete('chatgpt:live-a:user:9');
      globalThis.__pcNotifications=[];
      __pcSessionBag['projectConstellationLiveTransition:106']={tabId:106,bucket:'active',status:'running',healthState:'working',chatId:'chatgpt:session',url:'https://chatgpt.com/c/session',observedAt:Date.now()-1000};
      const sessionCompletionPush=await __pcSend({type:'PC_LIVE_CHAT_STATE_PUSH',state:{source:'live-sentinel',sentinel:true,version:'0.25.0',observedAt:Date.now(),status:'idle',chat:{id:'chatgpt:session',status:'idle',rawStatus:'idle',healthState:'healthy',title:'Session Resume',lastActivityAt:Date.now()},generation:{active:false}}},{tab:{id:106,windowId:1,url:'https://chatgpt.com/c/session',title:'Session Resume'}});
      await new Promise(r=>setTimeout(r,15));
      const sessionCompletionNotifications=structuredClone(__pcNotifications);
      globalThis.__pcNotifications=[];
      const legacyIgnored=await __pcSend({type:'PC_LIVE_CHAT_STATE_PUSH',state:{status:'idle',chat:{id:'chatgpt:live-a',status:'idle',rawStatus:'idle',title:'Live A',lastActivityAt:Date.now()},generation:{active:false}}},{tab:{id:101,windowId:1,url:'https://chatgpt.com/c/live-a',title:'Live A'}});
      const completedPush=await __pcSend({type:'PC_LIVE_CHAT_STATE_PUSH',state:{source:'live-sentinel',sentinel:true,version:'0.25.0',observedAt:Date.now(),status:'idle',chat:{id:'chatgpt:live-a',status:'idle',rawStatus:'idle',healthState:'healthy',title:'Live A',lastActivityAt:Date.now()},generation:{active:false}}},{tab:{id:101,windowId:1,url:'https://chatgpt.com/c/live-a',title:'Live A'}});
      await new Promise(r=>setTimeout(r,15));
      const completionNotifications=structuredClone(__pcNotifications);
      await __pcSend({type:'PC_LIVE_CHAT_STATE_PUSH',state:{source:'live-sentinel',sentinel:true,version:'0.25.0',observedAt:Date.now(),status:'running',chat:{id:'chatgpt:live-a',status:'running',rawStatus:'running',healthState:'working',title:'Live A',lastActivityAt:Date.now()},generation:{active:true,elapsedMs:61000,quietForMs:1200}}},{tab:{id:101,windowId:1,url:'https://chatgpt.com/c/live-a',title:'Live A'}});
      const attentionPush=await __pcSend({type:'PC_LIVE_CHAT_STATE_PUSH',state:{source:'live-sentinel',sentinel:true,version:'0.25.0',observedAt:Date.now(),status:'running',chat:{id:'chatgpt:live-a',status:'running',rawStatus:'running',healthState:'capacity-handoff',title:'Live A',lastActivityAt:Date.now()},generation:{active:true,elapsedMs:62000,quietForMs:2200}}},{tab:{id:101,windowId:1,url:'https://chatgpt.com/c/live-a',title:'Live A'}});
      await new Promise(r=>setTimeout(r,15));
      const holdPush=await __pcSend({type:'PC_LIVE_CHAT_STATE_PUSH',state:{source:'live-sentinel',sentinel:true,version:'0.25.0',observedAt:Date.now(),status:'provider-review',chat:{id:'chatgpt:live-a',status:'provider-review',rawStatus:'provider-review',healthState:'provider-review',title:'Live A',lastActivityAt:Date.now()},generation:{active:false,phase:'review-hold'}}},{tab:{id:101,windowId:1,url:'https://chatgpt.com/c/live-a',title:'Live A'}});
      await new Promise(r=>setTimeout(r,15));
      const notificationsDuringHold=structuredClone(__pcNotifications);
      const reviewReleasePush=await __pcSend({type:'PC_LIVE_CHAT_STATE_PUSH',state:{source:'live-sentinel',sentinel:true,version:'0.25.0',observedAt:Date.now(),status:'idle',chat:{id:'chatgpt:live-a',status:'idle',rawStatus:'idle',healthState:'healthy',title:'Live A',lastActivityAt:Date.now()},generation:{active:false}}},{tab:{id:101,windowId:1,url:'https://chatgpt.com/c/live-a',title:'Live A'}});
      await new Promise(r=>setTimeout(r,15));
      const reviewReleaseNotifications=structuredClone(__pcNotifications);
      const failurePush=await __pcSend({type:'PC_LIVE_CHAT_STATE_PUSH',state:{source:'live-sentinel',sentinel:true,version:'0.25.0',observedAt:Date.now(),status:'delivery-timeout',failure:{active:true,state:'delivery-timeout',title:'Message delivery timed out',retryAvailable:true,retryLabel:'Retry'},chat:{id:'chatgpt:stale-a',status:'delivery-timeout',rawStatus:'delivery-timeout',healthState:'delivery-timeout',title:'Stale A',lastActivityAt:Date.now(),failure:{active:true,state:'delivery-timeout',title:'Message delivery timed out',retryAvailable:true,retryLabel:'Retry'}},generation:{active:false,interrupted:true}}},{tab:{id:102,windowId:1,url:'https://chatgpt.com/c/stale-a',title:'Stale A'}});
      await new Promise(r=>setTimeout(r,15));
      const attentionNotifications=structuredClone(__pcNotifications);
      await __pcSend({type:'PC_BRAIN_SETTINGS_SET',settings:{scheduledTaskGuardian:{enabled:true,observeTaskState:true,desktopNotifications:true,notifyRunCompleted:true,notifyStateChanges:true}}});
      globalThis.__pcNotifications=[];
      const guardianSender={url:'https://chatgpt.com/schedules',tab:{id:501,url:'https://chatgpt.com/schedules'}};
      const guardianBaseline=await __pcSend({type:'PC_SCHEDULE_GUARDIAN_TASK_SNAPSHOT',snapshot:{source:'network',sourceUrl:'/backend-api/scheduled/tasks?limit=20',observedAt:Date.now(),tasks:[{id:'sched-1',title:'Morning brief',enabled:true,status:'active',lastRunId:'run-1',lastRunStatus:'completed',lastRunAt:1000}] }},guardianSender);
      await new Promise(r=>setTimeout(r,10));
      const guardianBaselineNotifications=structuredClone(__pcNotifications);
      const guardianTransition=await __pcSend({type:'PC_SCHEDULE_GUARDIAN_TASK_SNAPSHOT',snapshot:{source:'network',sourceUrl:'/backend-api/scheduled/tasks?limit=20',observedAt:Date.now(),tasks:[{id:'sched-1',title:'Morning brief',enabled:false,status:'paused',lastRunId:'run-2',lastRunStatus:'completed',lastRunAt:2000}] }},guardianSender);
      await new Promise(r=>setTimeout(r,10));
      const guardianTransitionNotifications=structuredClone(__pcNotifications);
      const guardianRepeat=await __pcSend({type:'PC_SCHEDULE_GUARDIAN_TASK_SNAPSHOT',snapshot:{source:'network',sourceUrl:'/backend-api/scheduled/tasks?limit=20',observedAt:Date.now(),tasks:[{id:'sched-1',title:'Morning brief',enabled:false,status:'paused',lastRunId:'run-2',lastRunStatus:'completed',lastRunAt:2000}] }},guardianSender);
      await new Promise(r=>setTimeout(r,10));
      const guardianRepeatNotifications=structuredClone(__pcNotifications);
      const guardianNotificationId=guardianTransitionNotifications[0]?.id||'';
      const createdBeforeGuardianOpen=__pcCreatedTabs.length;
      await __pcListeners.notificationButton(guardianNotificationId,0);
      const guardianOpenedTab=structuredClone(__pcCreatedTabs.at(-1));
      await __pcListeners.notificationButton(guardianNotificationId,1);
      const guardianMutedStatus=await __pcSend({type:'PC_SCHEDULE_GUARDIAN_TASK_STATUS'});
      globalThis.__pcNotifications=[];
      const guardianMutedTransition=await __pcSend({type:'PC_SCHEDULE_GUARDIAN_TASK_SNAPSHOT',snapshot:{source:'network',sourceUrl:'/backend-api/scheduled/tasks?limit=20',observedAt:Date.now(),tasks:[{id:'sched-1',title:'Morning brief',enabled:true,status:'active',lastRunId:'run-2',lastRunStatus:'completed',lastRunAt:2000}] }},guardianSender);
      await new Promise(r=>setTimeout(r,10));
      const guardianMutedNotifications=structuredClone(__pcNotifications);
      const guardianTestWhileMuted=await __pcSend({type:'PC_SCHEDULE_GUARDIAN_TEST_NOTIFICATION'});
      await __pcSend({type:'PC_BRAIN_INGEST_BATCH',payload:[{type:'CHAT_UPSERT',data:{id:'chatgpt:new',providerId:'chatgpt',status:'running',liveHealthState:'tool-stalled',liveHealthDetail:'Corroborated current-turn stall',liveHealthUpdatedAt:Date.now(),updatedAt:Date.now()}}]});
      const homeWithLiveAttention=await __pcSend({type:'PC_HOME_SUMMARY'});
      await __pcSend({type:'PC_BRAIN_INGEST_BATCH',payload:[{type:'CHAT_UPSERT',data:{id:'chatgpt:new',providerId:'chatgpt',status:'running',liveHealthState:'uncertain-working',liveHealthDetail:'Activity uncertain · do not interrupt yet',liveHealthUpdatedAt:Date.now(),updatedAt:Date.now()}}]});
      const homeWithUncertain=await __pcSend({type:'PC_HOME_SUMMARY'});
      await __pcSend({type:'PC_BRAIN_INGEST_BATCH',payload:[{type:'CHAT_UPSERT',data:{id:'chatgpt:new',providerId:'chatgpt',status:'idle',liveHealthState:'healthy',liveHealthDetail:'',liveHealthUpdatedAt:Date.now(),updatedAt:Date.now()}}]});
      const createdBeforeMissingFocus=__pcCreatedTabs.length;
      const missingFocus=await __pcSend({type:'PC_FOCUS_LIVE_CHAT',tabId:9999,url:'https://chatgpt.com/c/missing'});
      const createdAfterMissingFocus=__pcCreatedTabs.length;
      const handoff=await __pcSend({type:'PC_PREPARE_CHAT_HANDOFF',chatId:'chatgpt:test',url:'https://chatgpt.com/c/test',capacity:{turnCount:260,capturedChars:410000}},{tab:{id:7,url:'https://chatgpt.com/c/test'}});
      const branch=await __pcSend({type:'PC_BRANCH_CHAT',chatId:'chatgpt:test',url:'https://chatgpt.com/c/test',capacity:{turnCount:260,capturedChars:410000}},{tab:{id:7,url:'https://chatgpt.com/c/test'}});
      const wrongBranchClaim=await __pcSend({type:'PC_BRANCH_CONTINUATION_CLAIM',providerId:'chatgpt'},{tab:{id:77,url:'https://chatgpt.com/'}});
      const branchClaim=await __pcSend({type:'PC_BRANCH_CONTINUATION_CLAIM',providerId:'chatgpt'},{tab:{id:88,url:'https://chatgpt.com/'}});
      const branchComplete=await __pcSend({type:'PC_BRANCH_CONTINUATION_COMPLETE',branchId:branch.branchId,status:'sent'},{tab:{id:88,url:'https://chatgpt.com/'}});
      const branchResolve=await __pcSend({type:'PC_BRANCH_LINEAGE_RESOLVE',chatId:'chatgpt:continued',url:'https://chatgpt.com/c/continued'},{tab:{id:88,url:'https://chatgpt.com/c/continued'}});
      await processKnowledgeWork(); await processKnowledgeWork();
      const knowledgeSummary=await __pcSend({type:'PC_KNOWLEDGE_SUMMARY',limit:30});
      const knowledgeSearch=await __pcSend({type:'PC_KNOWLEDGE_LIST',filters:{query:'ModernFix Minecraft',limit:30}});
      const dash=await __pcSend({type:'PC_BRAIN_DASHBOARD'});
      const snap=await __pcSend({type:'PC_BRAIN_SNAPSHOT'});
      return {ingest,rescueAck,rescueChat,recoveredRetryFlags,outputObserve,outputVault,outputRevisions,outputCanonical,group:group.item,project:project.item,smart:smart.item,patch:patch.items,org:org.organization,orgChats:orgChats.items,pinnedChats:pinnedChats.items,favoriteChats:favoriteChats.items,archivedChats:archivedChats.items,migratedLegacy,migratedIndexes,settingsWrites,settingsGet,capacityMigration,capacityCustom,homeAfterSettings,homeWithLiveAttention,homeWithUncertain,search:search.results?.map(x=>({type:x.entityType,chatId:x.chatId,title:x.title,excerpt:x.excerpt})),summary:dash.dashboard?.summary,integrityScan,governor:governor.requestGovernor,providerCheck1,providerCheck2,fetchCount:__pcFetchCount,knowledgeSummary:knowledgeSummary.knowledge,knowledgeSearch:knowledgeSearch.items,snapshot:snap.snapshot,healthActive,healthQuiet,pulseActive,pulseAssign,pulseCreate,pulseMismatch,livePulse,chatGuardianRun,chatGuardianStatus,chatGuardianSends:structuredClone(__pcGuardianSends),sessionCompletionPush,sessionCompletionNotifications,legacyIgnored,completedPush,attentionPush,holdPush,reviewReleasePush,failurePush,completionNotifications,notificationsDuringHold,reviewReleaseNotifications,attentionNotifications,guardianBaseline,guardianBaselineNotifications,guardianTransition,guardianTransitionNotifications,guardianRepeat,guardianRepeatNotifications,createdBeforeGuardianOpen,guardianOpenedTab,guardianMutedStatus,guardianMutedTransition,guardianMutedNotifications,guardianTestWhileMuted,missingFocus,createdBeforeMissingFocus,createdAfterMissingFocus,handoff,branch,wrongBranchClaim,branchClaim,branchComplete,branchResolve,createdTabs:__pcCreatedTabs,branchParent:structuredClone(__pcDbStores.get('chats').rows.get('chatgpt:test')),branchChild:structuredClone(__pcDbStores.get('chats').rows.get('chatgpt:continued')),branchCheckpoint:structuredClone(__pcDbStores.get('checkpoints').rows.get(branch.checkpointId))};
    }""")
    print(json.dumps({'result':result,'errors':errors},sort_keys=True))
    assert result['ingest']['ok']
    assert result['rescueAck']['ok'] and result['rescueAck']['committed'] and result['rescueAck']['chars']>100
    assert result['rescueChat']['rescueJournalStatus']=='saved' and result['rescueChat']['rescueJournalRevisionId']==result['rescueAck']['revisionId']
    assert result['recoveredRetryFlags']['status']=='running' and result['recoveredRetryFlags']['retryForbidden'] is False and result['recoveredRetryFlags']['automaticRetryForbidden'] is False
    assert result['outputObserve']['regression']['active'] is True and len(result['outputObserve']['regression']['changedTurns'])==1
    assert 'Final production result' in result['outputCanonical']['text'] and result['outputCanonical']['lastObservedFingerprint']!=result['outputCanonical']['bestRevisionFingerprint']
    assert result['outputCanonical']['assets'][0]['url']=='https://example.com/constellation-result.png'
    assert result['outputCanonical']['formattedText'].startswith('## Final production result')
    assert len(result['outputRevisions']['revisions'])>=3
    assert result['outputVault']['regression']['active'] is True and result['outputVault']['items'][-1]['affected'] is True
    assert result['outputVault']['items'][-1]['assets'][0]['embeddedDataUrl'].startswith('data:image/png;base64,')
    assert 'Project-Constellation-v0.14.0.zip' in result['outputVault']['markdown'] and 'constellation-result.png' in result['outputVault']['markdown'] and '**every requested fix**' in result['outputVault']['markdown']
    assert result['snapshot']['summary']['turnRevisions']>=3 and result['snapshot']['summary']['outputSnapshots']>=1
    assert result['summary']['chats']==5 and result['summary']['turns']==3 and result['summary']['files']==4
    assert result['summary']['searchDocs']>=4
    assert any(r['chatId']=='chatgpt:test' for r in result['search'])
    assert result['org']['projects'][0]['name']=='Minecraft Mods'
    assert result['org']['projects'][0]['chatCount']==3 and result['org']['projects'][0]['fileCount']==4
    assert result['orgChats'][0]['workspaceProjectName']=='Minecraft Mods'
    assert 'minecraft' in result['orgChats'][0]['tags'] and result['orgChats'][0]['pinned'] and result['orgChats'][0]['favorite']
    assert any(row['id']=='chatgpt:test' for row in result['pinnedChats'])
    assert any(row['id']=='chatgpt:test' for row in result['favoriteChats'])
    assert any(row['id']=='chatgpt:test' for row in result['archivedChats'])
    assert result['migratedIndexes']=={'pinned':'pinnedKey','favorite':'favoriteKey','organizedArchived':'organizedArchivedKey'}
    assert result['migratedLegacy']['pinned'] is True and result['migratedLegacy']['favorite'] is True and result['migratedLegacy']['organizedArchived'] is True
    assert result['migratedLegacy']['pinnedKey']==1 and result['migratedLegacy']['favoriteKey']==1 and result['migratedLegacy']['organizedArchivedKey']==1
    assert any(row['id']=='legacy:v8' for row in result['archivedChats'])
    assert all(row['ok'] for row in result['settingsWrites'])
    assert result['settingsGet']['settings']['approvalAutopilot']['acknowledged'] is True
    assert result['settingsGet']['settings']['approvalAutopilot']['fallbackAllowOnce'] is False
    assert result['settingsGet']['settings']['liveHealth']['showHealthy'] is False
    assert result['settingsGet']['settings']['liveHealth']['capacityWarningTurns']==120
    assert result['settingsGet']['settings']['liveHealth']['capacityHandoffTurns']==180
    assert result['settingsGet']['settings']['liveHealth']['capacityProfileVersion']==2
    assert result['capacityMigration']['capacityWarningTurns']==120 and result['capacityMigration']['capacityHandoffTurns']==180
    assert result['capacityMigration']['capacityWarningChars']==160000 and result['capacityMigration']['capacityHandoffChars']==280000
    assert result['capacityMigration']['capacityProfileVersion']==2
    assert result['capacityCustom']['capacityWarningTurns']==150 and result['capacityCustom']['capacityHandoffTurns']==230
    assert result['capacityCustom']['capacityWarningChars']==200000 and result['capacityCustom']['capacityHandoffChars']==330000
    assert result['capacityCustom']['capacityProfileVersion']==2
    assert result['homeAfterSettings']['ok'] and result['homeAfterSettings']['home']['approvalAutopilot']['acknowledged'] is True
    assert result['homeAfterSettings']['home']['liveHealth']['showHealthy'] is False
    assert len(result['snapshot']['groups'])==1 and len(result['snapshot']['smartCollections'])==1
    assert result['knowledgeSummary']['total']>=3 and result['knowledgeSummary']['kinds']['recommendation']>=1 and result['knowledgeSummary']['kinds']['repository']>=1
    assert any(row['kind']=='repository' and 'github.com/embeddedt/ModernFix' in row.get('url','') for row in result['knowledgeSearch'])
    assert any(row['kind']=='recommendation' and row.get('chat',{}).get('url')=='https://chatgpt.com/c/new' for row in result['knowledgeSearch'])
    assert any(row.get('workspaceProjectId')==result['project']['id'] for row in result['knowledgeSearch'])
    assert result['snapshot']['summary']['knowledgeItems']>=result['knowledgeSummary']['total'] and len(result['snapshot']['projectContinuity'])>=1
    assert result['fetchCount']==1 and result['governor']['totalThrottles']==1 and result['governor']['providers']['chatgpt']['waitMs']>0
    checks=[result['providerCheck1'],result['providerCheck2']]
    assert any(c.get('coolingDown') is True and c.get('source')=='request-governor' and c.get('retryAfterMs',0)>0 for c in checks)
    assert result['livePulse']['openChatTabs']==5 and result['livePulse']['responsiveTabs']==4 and result['livePulse']['partial'] is True
    assert result['chatGuardianRun']['ok'] and result['chatGuardianRun']['tabs']==2 and result['chatGuardianRun']['candidates']==1 and result['chatGuardianRun']['continued']==1
    assert len(result['chatGuardianSends'])==1 and result['chatGuardianSends'][0]['id']==121
    assert result['chatGuardianSends'][0]['message']['prompt']=='Continue the unfinished task.'
    assert result['chatGuardianStatus']['state']['continuations']>=1
    assert result['livePulse']['counts']=={'critical':0,'hold':0,'active':1,'stale':2,'completed':2}
    assert result['missingFocus']['ok'] is False and result['createdAfterMissingFocus']==result['createdBeforeMissingFocus']
    assert result['livePulse']['groups']['active'][0]['tabId']==101 and {row['tabId'] for row in result['livePulse']['groups']['stale']}=={102,105}
    active_context=result['livePulse']['groups']['active'][0]['context'];assert active_context['projectName']=='Project Constellation' and active_context['taskHint'].startswith('Make the confusing live tab titles') and active_context['liveActivity']=='Updating Pulse context rows'
    assert {row['tabId'] for row in result['livePulse']['groups']['completed']}=={103,104}
    assert next(row for row in result['livePulse']['groups']['completed'] if row['tabId']==103)['tabGroup']=={'id':301,'title':'My Research','color':'blue','collapsed':True,'managed':False,'managedBucket':''}
    reconnect=next(row for row in result['livePulse']['groups']['stale'] if row['tabId']==105);assert reconnect['reconnecting'] is True and reconnect['responsive'] is False and reconnect['status']=='unavailable'
    assert result['sessionCompletionPush']['bucket']=='completed' and len(result['sessionCompletionNotifications'])==1
    assert result['sessionCompletionNotifications'][0]['options']['title']=='Chat completed' and 'Session Resume' in result['sessionCompletionNotifications'][0]['options']['message']
    assert result['legacyIgnored']['ignored'] is True and result['legacyIgnored']['reason']=='non-sentinel-live-state'
    assert result['completedPush']['bucket']=='completed' and len(result['completionNotifications'])==1
    assert result['completionNotifications'][0]['options']['title']=='Chat completed' and result['completionNotifications'][0]['options']['message']=='Live A is ready to check.'
    assert result['attentionPush']['bucket']=='stale' and result['holdPush']['bucket']=='hold' and result['reviewReleasePush']['bucket']=='completed' and result['failurePush']['bucket']=='critical'
    assert len(result['notificationsDuringHold'])==2, result['notificationsDuringHold']
    assert result['notificationsDuringHold'][-1]['options']['title']=='Secure a chat handoff' and 'runway threshold' in result['notificationsDuringHold'][-1]['options']['message']
    assert len(result['reviewReleaseNotifications'])==3 and result['reviewReleaseNotifications'][-1]['options']['title']=='Review cleared · chat completed' and result['reviewReleaseNotifications'][-1]['options']['contextMessage']=='Project Constellation · On hold released'
    assert len(result['attentionNotifications'])==4
    assert result['attentionNotifications'][-1]['options']['title']=='Message delivery timed out' and result['attentionNotifications'][-1]['options']['contextMessage']=='Project Constellation · Critical' and 'never trigger it automatically' in result['attentionNotifications'][-1]['options']['message']
    assert result['guardianBaseline']['ok'] and result['guardianBaseline']['events']==0 and result['guardianBaselineNotifications']==[]
    assert result['guardianTransition']['ok'] and result['guardianTransition']['events']==1
    assert len(result['guardianTransitionNotifications'])==1
    assert result['guardianTransitionNotifications'][0]['options']['title']=='Run completed · task is paused'
    assert result['guardianTransitionNotifications'][0]['options']['buttons']==[{'title':'Open Scheduled'},{'title':'Mute 1 hour'}]
    assert result['guardianTransitionNotifications'][0]['options']['requireInteraction'] is True
    assert result['guardianRepeat']['events']==0 and len(result['guardianRepeatNotifications'])==1
    assert result['guardianOpenedTab']['url']=='https://chatgpt.com/schedules' and result['guardianOpenedTab']['active'] is True
    assert result['guardianMutedStatus']['telemetry']['mutedUntil']>0
    assert result['guardianMutedTransition']['events']==1 and result['guardianMutedNotifications']==[]
    assert result['guardianTestWhileMuted']['ok'] is False and 'muted' in result['guardianTestWhileMuted']['error'].lower()
    assert any(chat['id']=='chatgpt:new' and chat['liveHealthState']=='tool-stalled' for chat in result['homeWithLiveAttention']['home']['attention'])
    assert not any(chat['id']=='chatgpt:new' for chat in result['homeWithUncertain']['home']['attention'])
    assert result['healthActive']['network']['pending']==1 and result['healthActive']['network']['streamLikely'] is True
    assert result['healthActive']['network']['pendingTotal']==2 and result['healthActive']['network']['auxiliaryPending']==1
    assert result['healthActive']['network']['inflight'][0]['category']=='response stream'
    assert result['healthActive']['network']['events'][-1]['phase']=='started' and result['healthActive']['network']['events'][-1]['category']=='response stream'
    assert result['healthActive']['network']['auxiliaryInflight'][0]['category']=='chat history'
    assert result['healthActive']['network']['events'][0]['activityBearing'] is False
    assert result['healthQuiet']['network']['pending']==0 and result['healthQuiet']['network']['auxiliaryPending']==1 and result['healthQuiet']['network']['observed'] is True
    assert result['pulseActive']['ok'] and result['pulseActive']['context']['chatId']=='chatgpt:old' and result['pulseActive']['context']['tabId']==41
    assert result['pulseAssign']['ok'] and result['pulseAssign']['result']['context']['workspaceProjectName']=='Minecraft Mods'
    assert result['pulseCreate']['ok'] and result['pulseCreate']['result']['created'] is True and result['pulseCreate']['result']['project']['name']=='Pulse Quick Project' and result['pulseCreate']['result']['context']['workspaceProjectName']=='Pulse Quick Project'
    assert result['pulseMismatch']['ok'] is False and 'active chat changed' in result['pulseMismatch']['error'].lower()
    assert [row['phase'] for row in result['healthQuiet']['network']['events'][-2:]]==['response','completed']
    assert all('url' not in row for row in result['healthQuiet']['network']['events'])
    assert result['healthActive']['capacity']['storedTurns']==1
    assert result['handoff']['ok'] and result['handoff']['checkpointId'].startswith('handoff:chatgpt:test:')
    assert '# Project Constellation Safe Handoff' in result['handoff']['markdown'] and 'https://chatgpt.com/c/test' in result['handoff']['markdown']
    assert result['handoff']['drive']['verified'] is False and result['handoff']['capacity']['turnCount']==260
    assert any(row.get('kind')=='safe-chat-handoff' for row in result['snapshot']['checkpoints'])
    assert result['branch']['ok'] and result['branch']['targetTabId']==88 and result['createdTabs'][-1]['url']=='https://chatgpt.com/'
    assert result['wrongBranchClaim']['state']=='not-for-this-tab' and result['branchClaim']['ok'] and 'Continue this work as the direct continuation' in result['branchClaim']['prompt']
    assert result['branchComplete']['status']=='sent' and result['branchResolve']['ok'] and result['branchResolve']['childChatId']=='chatgpt:continued'
    assert result['branchParent']['branchChildChatId']=='chatgpt:continued' and result['branchChild']['branchParentChatId']=='chatgpt:test'
    assert result['branchCheckpoint']['branchStatus']=='continued' and result['branchCheckpoint']['branchChatId']=='chatgpt:continued'
    assert not errors
    browser.close()
