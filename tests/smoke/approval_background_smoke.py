from playwright.sync_api import sync_playwright
import pathlib, json, re, os
root=pathlib.Path(os.environ.get('PROJECT_CONSTELLATION_ROOT','/mnt/data/project-constellation-v090-work'))
manifest=json.loads((root/'manifest.json').read_text());brain=(root/'src/brain-core.js').read_text();providers=(root/'src/provider-core.js').read_text(); integrity=(root/'src/integrity-core.js').read_text(); knowledge=(root/'src/knowledge-core.js').read_text(); health=(root/'src/health-core.js').read_text();bg=(root/'background.js').read_text();bg=re.sub(r"^import ['\"]\./src/(?:brain-core|provider-core|integrity-core|knowledge-core|health-core)\.js['\"];\s*",'',bg,flags=re.M)
mock=f"""
(() => {{
 const bag={{}},listeners={{}},dbStores=new Map();
 if(!globalThis.crypto?.randomUUID)Object.defineProperty(globalThis.crypto,'randomUUID',{{value:()=>`pc-${{Date.now()}}-${{Math.random().toString(16).slice(2)}}`,configurable:true}});
 Object.defineProperty(globalThis,'IDBKeyRange',{{value:{{only:(value)=>({{kind:'only',value}}),lowerBound:(value,open)=>({{kind:'lower',value,open}})}},configurable:true}});
 const names=(map)=>({{contains:(name)=>map.has(name)}});const eq=(a,b)=>Array.isArray(a)&&Array.isArray(b)?JSON.stringify(a)===JSON.stringify(b):a===b;const matches=(v,q)=>!q?true:q.kind==='only'?eq(v,q.value):q.kind==='lower'?(q.open?v>q.value:v>=q.value):eq(v,q);const keyVal=(v,k)=>Array.isArray(k)?k.map(x=>v?.[x]):v?.[k];
 const makeReq=(fn)=>{{const r={{result:undefined,error:null,onsuccess:null,onerror:null}};setTimeout(()=>{{try{{r.result=fn();r.onsuccess&&r.onsuccess();}}catch(e){{r.error=e;r.onerror&&r.onerror();}}}},0);return r;}};
 const cursorReq=(values)=>{{const r={{result:null,error:null,onsuccess:null,onerror:null}};let i=0;const step=()=>setTimeout(()=>{{if(i>=values.length){{r.result=null;r.onsuccess&&r.onsuccess();return;}}const value=values[i++];r.result={{value,continue:step}};r.onsuccess&&r.onsuccess();}},0);step();return r;}};
 function indexApi(meta,name){{const idx=meta.indexes.get(name);return {{getAll:(q,c)=>makeReq(()=>Array.from(meta.rows.values()).filter(v=>{{const val=keyVal(v,idx.keyPath);return idx.multiEntry&&Array.isArray(val)?val.some(x=>matches(x,q)):matches(val,q);}}).slice(0,c||Infinity)),count:(q)=>makeReq(()=>Array.from(meta.rows.values()).filter(v=>{{const val=keyVal(v,idx.keyPath);return idx.multiEntry&&Array.isArray(val)?val.some(x=>matches(x,q)):matches(val,q);}}).length),openCursor:(q,direction)=>{{let values=Array.from(meta.rows.values()).filter(v=>matches(keyVal(v,idx.keyPath),q));if(direction==='prev')values=values.reverse();return cursorReq(values);}},openKeyCursor:()=>cursorReq([])}};}}
 function storeApi(meta){{return {{indexNames:names(meta.indexes),createIndex:(n,k,o={{}})=>{{meta.indexes.set(n,{{keyPath:k,multiEntry:!!o.multiEntry}});return indexApi(meta,n);}},index:(n)=>indexApi(meta,n),get:(id)=>makeReq(()=>meta.rows.get(id)),getAll:(q,c)=>makeReq(()=>Array.from(meta.rows.values()).filter(v=>matches(v?.[meta.keyPath],q)).slice(0,c||Infinity)),put:(r)=>{{meta.rows.set(r[meta.keyPath],structuredClone(r));return makeReq(()=>r[meta.keyPath]);}},clear:()=>{{meta.rows.clear();return makeReq(()=>undefined);}},delete:(id)=>{{meta.rows.delete(id);return makeReq(()=>undefined);}},count:(q)=>makeReq(()=>Array.from(meta.rows.values()).filter(v=>matches(v?.[meta.keyPath],q)).length),openCursor:(q,direction)=>{{let values=Array.from(meta.rows.values()).filter(v=>matches(v?.[meta.keyPath],q));if(direction==='prev')values=values.reverse();return cursorReq(values);}}}};}}
 const fakeDb={{objectStoreNames:names(dbStores),createObjectStore:(n,o={{}})=>{{const m={{keyPath:o.keyPath||'id',rows:new Map(),indexes:new Map()}};dbStores.set(n,m);return storeApi(m);}},transaction:(stores,mode)=>{{const tx={{oncomplete:null,onerror:null,error:null,objectStore:(n)=>storeApi(dbStores.get(n))}};setTimeout(()=>tx.oncomplete&&tx.oncomplete(),1);return tx;}},close:()=>{{}}}};
 Object.defineProperty(globalThis,'indexedDB',{{value:{{open:()=>{{const req={{result:fakeDb,transaction:{{objectStore:(n)=>storeApi(dbStores.get(n))}},onupgradeneeded:null,onsuccess:null,onerror:null,error:null}};setTimeout(()=>{{req.onupgradeneeded&&req.onupgradeneeded();setTimeout(()=>req.onsuccess&&req.onsuccess(),0);}},0);return req;}}}},configurable:true}});
 const getBag=(keys)=>{{if(keys==null)return{{...bag}};if(typeof keys==='string')return{{[keys]:bag[keys]}};if(Array.isArray(keys))return Object.fromEntries(keys.map(k=>[k,bag[k]]));return{{}};}};
 let win=null,tab={{id:91,windowId:61,url:'about:blank',status:'complete',active:false}};const stats={{windowsCreated:0,windowsRemoved:0,createOptions:[],tabUpdates:[],tabReloads:[],messages:[]}};
 globalThis.chrome={{
  runtime:{{id:'geljambmkfjkhodgkpjhnmfojkpcamig',getManifest:()=>({json.dumps(manifest)}),getURL:(p)=>`chrome-extension://pc/${{p}}`,getContexts:async()=>[],sendMessage:async()=>({{ok:true}}),onMessage:{{addListener:(fn)=>listeners.message=fn}},onInstalled:{{addListener:(fn)=>listeners.installed=fn}},onStartup:{{addListener:(fn)=>listeners.startup=fn}}}},
  storage:{{local:{{get:async(k)=>getBag(k),set:async(o)=>Object.assign(bag,o),remove:async(k)=>{{for(const x of(Array.isArray(k)?k:[k]))delete bag[x];}}}}}},
  alarms:{{create:async()=>{{}},clear:async()=>true,onAlarm:{{addListener:(fn)=>listeners.alarm=fn}}}},sidePanel:{{setPanelBehavior:async()=>{{}}}},action:{{setBadgeText:async()=>{{}},setTitle:async()=>{{}}}},identity:{{getAuthToken:async()=>({{token:'x'}}),clearAllCachedAuthTokens:async()=>{{}}}},idle:{{queryState:async()=> 'idle'}},permissions:{{contains:async()=>false}},history:{{search:async()=>[]}},offscreen:{{createDocument:async()=>{{}}}},downloads:{{}},
  windows:{{create:async(o)=>{{stats.windowsCreated++;stats.createOptions.push(o);win={{id:61,state:o.state,focused:o.focused}};tab={{...tab,url:o.url,status:'complete'}};return{{...win,tabs:[{{...tab}}]}};}},get:async()=>win,remove:async()=>{{if(win){{win=null;stats.windowsRemoved++;}}}}}},
  tabs:{{get:async()=>{{if(!win)throw new Error('missing tab');return{{...tab}};}},query:async()=>win?[{{...tab}}]:[],update:async(id,o)=>{{tab={{...tab,...o,status:'complete'}};if(o.url)stats.tabUpdates.push(o.url);return{{...tab}};}},reload:async(id,o)=>{{stats.tabReloads.push(tab.url);tab={{...tab,status:'complete',__refreshed:true}};}},sendMessage:async(id,m)=>{{stats.messages.push(m.type);if(m.type==='PC_APPROVAL_RECOVERY_SCAN'){{if(tab.url.endsWith('/blocked'))return{{ok:true,action:'always-allow',connector:'GitHub',strategy:'dropdown-persistent'}};if(tab.url.endsWith('/paused'))return{{ok:true,action:'resume',strategy:'resume-control'}};if(tab.url.endsWith('/refresh')&&!tab.__refreshed)return{{ok:true,action:'refresh-required',strategy:'browser-refresh',retryForbidden:true,reason:'Message delivery timed out. Please try again. Retry'}};if(tab.url.endsWith('/rate-limit'))return{{ok:true,action:'rate-limited',strategy:'provider-cooldown',retryForbidden:true,waitMs:120000,reason:'Too many requests. Try again in 2 minutes. Retry'}};return{{ok:true,action:'none',reason:'clear'}};}}return{{ok:true}};}},onUpdated:{{addListener:()=>{{}},removeListener:()=>{{}}}}}}
 }};
 globalThis.fetch=async(url)=>({{ok:true,status:200,url:String(url),headers:{{get:()=> 'text/html'}},text:async()=>'<html></html>'}});
 globalThis.__pcListeners=listeners;globalThis.__pcStats=stats;globalThis.__pcSend=(m)=>new Promise((resolve,reject)=>{{try{{listeners.message(m,{{}},resolve);}}catch(e){{reject(e);}}}});globalThis.__pcSendFromTab=(m,tabInfo)=>new Promise((resolve,reject)=>{{try{{listeners.message(m,{{tab:tabInfo}},resolve);}}catch(e){{reject(e);}}}});
}})();
"""
with sync_playwright() as p:
  browser=p.chromium.launch(headless=True,args=['--no-sandbox']);page=browser.new_page();errors=[];page.on('pageerror',lambda exc:errors.append(str(exc)))
  page.set_content('<!doctype html><html><body></body></html>');page.add_script_tag(content=mock);page.add_script_tag(content=brain);page.add_script_tag(content=providers);page.add_script_tag(content=integrity);page.add_script_tag(content=knowledge);page.add_script_tag(content=health);page.add_script_tag(content=bg);page.wait_for_timeout(100)
  result=page.evaluate("""async()=>{
    const now=Date.now();
    await __pcSend({type:'PC_BRAIN_INGEST_BATCH',payload:[
      {type:'CHAT_UPSERT',data:{id:'chatgpt:blocked',providerId:'chatgpt',title:'Blocked',url:'https://chatgpt.com/c/blocked',status:'blocked-approval',lastActivityAt:now-5000,updatedAt:now}},
      {type:'CHAT_UPSERT',data:{id:'chatgpt:paused',providerId:'chatgpt',title:'Paused',url:'https://chatgpt.com/c/paused',status:'paused',lastActivityAt:now-5000,updatedAt:now}},
      {type:'CHAT_UPSERT',data:{id:'chatgpt:refresh',providerId:'chatgpt',title:'Refresh',url:'https://chatgpt.com/c/refresh',status:'refresh-required',statusDetail:'Message delivery timed out. Please try again.',recoveryKind:'browser-refresh',retryForbidden:true,lastActivityAt:now-5000,updatedAt:now}},
      {type:'CHAT_UPSERT',data:{id:'chatgpt:idle',providerId:'chatgpt',title:'Idle',url:'https://chatgpt.com/c/idle',status:'idle',lastActivityAt:now-5000,updatedAt:now}}
    ]});
    await __pcSend({type:'PC_BRAIN_SETTINGS_SET',settings:{approvalAutopilot:{enabled:true,acknowledged:true,alwaysAllow:true,fallbackAllowOnce:true,autoRecoverPaused:true,backgroundRecovery:true}}});
    const start=await __pcSend({type:'PC_APPROVAL_RECOVERY_START',mode:'all-known'});let state=start.state;
    for(let i=0;i<16&&state.status==='running';i++){__pcListeners.alarm({name:'project-constellation-approval-recovery-step'});await new Promise(r=>setTimeout(r,60));state=(await __pcSend({type:'PC_APPROVAL_RECOVERY_GET'})).state;}
    const dash1=(await __pcSend({type:'PC_BRAIN_DASHBOARD'})).dashboard;
    await __pcSend({type:'PC_BRAIN_INGEST_BATCH',payload:[{type:'CHAT_UPSERT',data:{id:'chatgpt:live-refresh',providerId:'chatgpt',title:'Live Refresh',url:'https://chatgpt.com/c/live-refresh',status:'refresh-required',statusDetail:'Connection interrupted',recoveryKind:'browser-refresh',retryForbidden:true,updatedAt:Date.now()}}]});
    const liveRefresh=await __pcSendFromTab({type:'PC_REFRESH_RECOVERY_REQUEST',chatId:'chatgpt:live-refresh',url:'https://chatgpt.com/c/live-refresh',detail:'Connection interrupted'},{id:91,url:'https://chatgpt.com/c/live-refresh'});
    const liveRefreshDup=await __pcSendFromTab({type:'PC_REFRESH_RECOVERY_REQUEST',chatId:'chatgpt:live-refresh',url:'https://chatgpt.com/c/live-refresh',detail:'Connection interrupted'},{id:91,url:'https://chatgpt.com/c/live-refresh'});
    await __pcSend({type:'PC_BRAIN_INGEST_BATCH',payload:[{type:'STATUS_EVENT',data:{chatId:'chatgpt:live-refresh',providerId:'chatgpt',status:'idle',detail:'Recovered after refresh',url:'https://chatgpt.com/c/live-refresh'}}]});
    await new Promise(r=>setTimeout(r,80));
    const refreshState=await __pcSend({type:'PC_REFRESH_RECOVERY_STATUS'});
    await __pcSend({type:'PC_BRAIN_INGEST_BATCH',payload:[{type:'CHAT_UPSERT',data:{id:'chatgpt:stale',providerId:'chatgpt',title:'Stale',url:'https://chatgpt.com/c/stale',status:'running',lastActivityAt:Date.now()-180000,updatedAt:Date.now()}}]});
    const watch=await __pcSend({type:'PC_APPROVAL_RECOVERY_WATCH'});await new Promise(r=>setTimeout(r,50));const dash2=(await __pcSend({type:'PC_BRAIN_DASHBOARD'})).dashboard;
    await __pcSend({type:'PC_APPROVAL_RECOVERY_STOP'});
    await __pcSend({type:'PC_BRAIN_INGEST_BATCH',payload:[{type:'CHAT_UPSERT',data:{id:'chatgpt:rate-limit',providerId:'chatgpt',title:'Rate limited',url:'https://chatgpt.com/c/rate-limit',status:'blocked-approval',lastActivityAt:Date.now(),updatedAt:Date.now()}}]});
    const rateStart=await __pcSend({type:'PC_APPROVAL_RECOVERY_START',mode:'attention'});
    __pcListeners.alarm({name:'project-constellation-approval-recovery-step'});await new Promise(r=>setTimeout(r,80));
    const rateState=(await __pcSend({type:'PC_APPROVAL_RECOVERY_GET'})).state;
    const governor=(await __pcSend({type:'PC_REQUEST_GOVERNOR_STATUS'})).requestGovernor;
    const rateStats={windowsCreated:__pcStats.windowsCreated,windowsRemoved:__pcStats.windowsRemoved,tabUpdates:__pcStats.tabUpdates.slice(),messages:__pcStats.messages.slice()};
    await __pcSend({type:'PC_APPROVAL_RECOVERY_STOP'});
    return {start,state,dash1,dash2,watch,liveRefresh,liveRefreshDup,refreshState,rateStart,rateState,governor,rateStats,stats:__pcStats};
  }""")
  print(json.dumps({'result':result,'errors':errors},sort_keys=True))
  st=result['state'];stats=result['stats'];
  assert st['status']=='completed' and st['scanned']==4 and st['recovered']==3 and st['alwaysAllowed']==1 and st['resumed']==1 and st['refreshed']==1
  assert stats['windowsCreated']>=1 and stats['windowsRemoved']>=1 and stats['createOptions'][0]['state']=='minimized' and stats['createOptions'][0]['focused'] is False
  assert 'PC_APPROVAL_RECOVERY_SCAN' in stats['messages'] and len(stats['tabReloads'])==2
  assert result['liveRefresh']['refreshed'] is True and result['liveRefreshDup']['deduped'] is True
  assert result['refreshState']['state']['attempts']==1 and result['refreshState']['state']['recovered']==1
  assert result['rateState']['status']=='running' and result['rateState']['currentChatId']=='chatgpt:rate-limit'
  assert result['governor']['providers']['chatgpt']['waitMs']>100000 and result['governor']['providers']['chatgpt']['lastStatus']==429
  assert result['rateStats']['windowsRemoved']>=2
  assert result['rateStats']['tabUpdates'].count('https://chatgpt.com/c/rate-limit')<=1
  chats={c['id']:c for c in result['dash1']['chats']}; assert chats['chatgpt:blocked']['status']=='idle' and chats['chatgpt:paused']['status']=='idle' and chats['chatgpt:refresh']['status']=='idle'
  chats2={c['id']:c for c in result['dash2']['chats']}; assert chats2['chatgpt:stale']['status']=='stalled'
  assert not errors
  browser.close()
