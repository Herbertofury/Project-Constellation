from playwright.sync_api import sync_playwright
import pathlib, json, re, os
root=pathlib.Path(os.environ.get('PROJECT_CONSTELLATION_ROOT','/mnt/data/project-constellation'))
manifest=json.loads((root/'manifest.json').read_text())
brain=(root/'src/brain-core.js').read_text(); providers=(root/'src/provider-core.js').read_text(); integrity=(root/'src/integrity-core.js').read_text(); knowledge=(root/'src/knowledge-core.js').read_text(); health=(root/'src/health-core.js').read_text(); bg=(root/'background.js').read_text()
bg=re.sub(r"^import ['\"]\./src/(?:brain-core|provider-core|integrity-core|knowledge-core|health-core)\.js['\"];\s*",'',bg,flags=re.M)
mock=f"""
(() => {{
 const bag={{}}, listeners={{}}, dbStores=new Map();
 if(!globalThis.crypto?.randomUUID) Object.defineProperty(globalThis.crypto,'randomUUID',{{value:()=>`pc-${{Date.now()}}-${{Math.random().toString(16).slice(2)}}`,configurable:true}});
 Object.defineProperty(globalThis,'IDBKeyRange',{{value:{{only:(value)=>({{kind:'only',value}}),lowerBound:(value,open)=>({{kind:'lower',value,open}})}},configurable:true}});
 const names=(map)=>({{contains:(name)=>map.has(name)}}); const matches=(v,q)=>!q?true:q.kind==='only'?v===q.value:q.kind==='lower'?(q.open?v>q.value:v>=q.value):v===q;
 const makeReq=(fn)=>{{const r={{result:undefined,error:null,onsuccess:null,onerror:null}};setTimeout(()=>{{try{{r.result=fn();r.onsuccess&&r.onsuccess();}}catch(e){{r.error=e;r.onerror&&r.onerror();}}}},0);return r;}};
 function indexApi(meta,name){{const idx=meta.indexes.get(name);return {{getAll:(q,c)=>makeReq(()=>Array.from(meta.rows.values()).filter(v=>{{const val=v?.[idx.keyPath];return idx.multiEntry&&Array.isArray(val)?val.some(x=>matches(x,q)):matches(val,q);}}).slice(0,c||Infinity)),count:(q)=>makeReq(()=>Array.from(meta.rows.values()).filter(v=>{{const val=v?.[idx.keyPath];return idx.multiEntry&&Array.isArray(val)?val.some(x=>matches(x,q)):matches(val,q);}}).length)}};}}
 function storeApi(meta){{return {{indexNames:names(meta.indexes),createIndex:(n,k,o={{}})=>{{meta.indexes.set(n,{{keyPath:k,multiEntry:!!o.multiEntry}});return indexApi(meta,n);}},index:(n)=>indexApi(meta,n),get:(id)=>makeReq(()=>meta.rows.get(id)),getAll:(q,c)=>makeReq(()=>Array.from(meta.rows.values()).filter(v=>matches(v?.[meta.keyPath],q)).slice(0,c||Infinity)),put:(r)=>{{meta.rows.set(r[meta.keyPath],structuredClone(r));return makeReq(()=>r[meta.keyPath]);}},clear:()=>{{meta.rows.clear();return makeReq(()=>undefined);}},delete:(id)=>{{meta.rows.delete(id);return makeReq(()=>undefined);}},count:(q)=>makeReq(()=>Array.from(meta.rows.values()).filter(v=>matches(v?.[meta.keyPath],q)).length)}};}}
 const fakeDb={{objectStoreNames:names(dbStores),createObjectStore:(n,o={{}})=>{{const m={{keyPath:o.keyPath||'id',rows:new Map(),indexes:new Map()}};dbStores.set(n,m);return storeApi(m);}},transaction:(stores,mode)=>{{const tx={{oncomplete:null,onerror:null,error:null,objectStore:(n)=>storeApi(dbStores.get(n))}};setTimeout(()=>tx.oncomplete&&tx.oncomplete(),1);return tx;}},close:()=>{{}}}};
 Object.defineProperty(globalThis,'indexedDB',{{value:{{open:()=>{{const req={{result:fakeDb,transaction:{{objectStore:(n)=>storeApi(dbStores.get(n))}},onupgradeneeded:null,onsuccess:null,onerror:null,error:null}};setTimeout(()=>{{req.onupgradeneeded&&req.onupgradeneeded();setTimeout(()=>req.onsuccess&&req.onsuccess(),0);}},0);return req;}}}},configurable:true}});
 const getBag=(keys)=>{{if(keys==null)return {{...bag}};if(typeof keys==='string')return {{[keys]:bag[keys]}};if(Array.isArray(keys))return Object.fromEntries(keys.map(k=>[k,bag[k]]));return {{}};}};
 let captureWindow=null, tab={{id:77,windowId:55,url:'about:blank',status:'complete',active:true}}; const stats={{windowsCreated:0,windowsRemoved:0,tabUpdates:[],messages:[]}};
 const providerFor=(url)=>String(url).includes('chatgpt.com')?{{id:'chatgpt',name:'ChatGPT'}}:null;
 globalThis.chrome={{
   runtime:{{id:'geljambmkfjkhodgkpjhnmfojkpcamig',getManifest:()=>({json.dumps(manifest)}),getURL:(p)=>`chrome-extension://pc-test/${{p}}`,getContexts:async()=>[],sendMessage:async(m)=>m?.type==='PC_OFFSCREEN_PARSE_HTML'?{{ok:true,providerId:'chatgpt',title:'',authRequired:false,chats:[],turns:[],files:[]}}:{{ok:true}},onMessage:{{addListener:(fn)=>listeners.message=fn}},onInstalled:{{addListener:(fn)=>listeners.installed=fn}},onStartup:{{addListener:(fn)=>listeners.startup=fn}}}},
   storage:{{local:{{get:async(k)=>getBag(k),set:async(o)=>Object.assign(bag,o),remove:async(k)=>{{for(const x of (Array.isArray(k)?k:[k]))delete bag[x];}}}}}},
   alarms:{{create:async()=>{{}},clear:async()=>true,onAlarm:{{addListener:(fn)=>listeners.alarm=fn}}}},
   sidePanel:{{setPanelBehavior:async()=>{{}}}},action:{{setBadgeText:async()=>{{}},setTitle:async()=>{{}}}},identity:{{getAuthToken:async()=>({{token:'x'}}),clearAllCachedAuthTokens:async()=>{{}}}},idle:{{queryState:async()=> 'idle'}},
   permissions:{{contains:async()=>false}},history:{{search:async()=>[]}},offscreen:{{createDocument:async()=>{{}}}},downloads:{{}},
   windows:{{create:async(o)=>{{stats.windowsCreated++;captureWindow={{id:55,state:o.state,focused:o.focused}};tab={{...tab,url:o.url,status:'complete'}};return {{...captureWindow,tabs:[{{...tab}}]}};}},get:async(id)=>{{if(!captureWindow||id!==55)throw new Error('missing window');return {{...captureWindow}};}},remove:async(id)=>{{if(captureWindow&&id===55){{captureWindow=null;stats.windowsRemoved++;}}}}}},
   tabs:{{get:async(id)=>{{if(!captureWindow||id!==77)throw new Error('missing tab');return {{...tab}};}},query:async(q)=>captureWindow?[{{...tab}}]:[],update:async(id,o)=>{{tab={{...tab,...o,status:'complete'}};stats.tabUpdates.push(o.url||'');return {{...tab}};}},sendMessage:async(id,m)=>{{
     stats.messages.push(m.type);
     if(m.type==='PC_GET_PROVIDER')return {{ok:true,provider:providerFor(tab.url)}};
     if(m.type==='PC_MANUAL_DISCOVER_CHATS_ASYNC'){{setTimeout(()=>listeners.message({{type:'PC_FULL_CAPTURE_RUNNER_DONE',jobId:m.jobId,result:{{ok:true,chats:[{{id:'chatgpt:one',providerId:'chatgpt',title:'One',url:'https://chatgpt.com/c/one'}},{{id:'chatgpt:two',providerId:'chatgpt',title:'Two',url:'https://chatgpt.com/c/two'}}]}}}},{{tab:{{id:77}}}},()=>{{}}),20);return {{ok:true,accepted:true}};}}
     if(m.type==='PC_MANUAL_FULL_CAPTURE_ASYNC'){{const result=tab.url.endsWith('/one')?{{ok:true,complete:true,totalTurnsObserved:10,totalFilesObserved:1}}:{{ok:true,complete:true,totalTurnsObserved:12,totalFilesObserved:2}};setTimeout(()=>listeners.message({{type:'PC_FULL_CAPTURE_RUNNER_DONE',jobId:m.jobId,result}},{{tab:{{id:77}}}},()=>{{}}),20);return {{ok:true,accepted:true}};}}
     return {{ok:true}};
   }},onUpdated:{{addListener:()=>{{}},removeListener:()=>{{}}}}}}
 }};
 globalThis.fetch=async(url)=>({{ok:true,status:200,url:String(url),headers:{{get:()=> 'text/html'}},text:async()=>'<html><head><title>ChatGPT</title></head><body></body></html>'}});
 globalThis.__pcListeners=listeners;globalThis.__pcStats=stats;
 globalThis.__pcSend=(message)=>new Promise((resolve,reject)=>{{try{{listeners.message(message,{{}},resolve);}}catch(e){{reject(e);}}}});
 globalThis.__pcSendFromTab=(message)=>new Promise((resolve,reject)=>{{try{{listeners.message(message,{{tab:{{id:77}}}},resolve);}}catch(e){{reject(e);}}}});
}})();
"""
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,args=['--no-sandbox'],executable_path=(os.environ.get('PROJECT_CONSTELLATION_CHROMIUM') or None))
    page=browser.new_page(); errors=[]; page.on('pageerror',lambda exc: errors.append(str(exc)))
    page.set_content('<!doctype html><html><body></body></html>');page.add_script_tag(content=mock);page.add_script_tag(content=brain);page.add_script_tag(content=providers);page.add_script_tag(content=integrity);page.add_script_tag(content=knowledge);page.add_script_tag(content=health);page.add_script_tag(content=bg);page.wait_for_timeout(80)
    result=page.evaluate("""async()=>{
      const start=await __pcSend({type:'PC_FULL_CAPTURE_START',providerIds:['chatgpt'],speed:'fast'});
      let state=start.state; const doneResponses=[];
      for(let i=0;i<16 && state?.status!=='completed';i++){
        __pcListeners.alarm({name:'project-constellation-full-capture-step'});
        await new Promise(r=>setTimeout(r,80));
        state=(await __pcSend({type:'PC_FULL_CAPTURE_GET'})).state;
        if(state?.runner){
          const runner=state.runner;
          const result=runner.kind==='discover'
            ? {ok:true,chats:[{id:'chatgpt:one',providerId:'chatgpt',title:'One',url:'https://chatgpt.com/c/one'},{id:'chatgpt:two',providerId:'chatgpt',title:'Two',url:'https://chatgpt.com/c/two'}]}
            : (state.currentUrl.endsWith('/one')?{ok:true,complete:true,totalTurnsObserved:10,totalFilesObserved:1}:{ok:true,complete:true,totalTurnsObserved:12,totalFilesObserved:2});
          doneResponses.push(await __pcSendFromTab({type:'PC_FULL_CAPTURE_RUNNER_DONE',jobId:runner.jobId,result}));
          await new Promise(r=>setTimeout(r,30));
          state=(await __pcSend({type:'PC_FULL_CAPTURE_GET'})).state;
        }
      }
      const first={...state};
      const secondStart=await __pcSend({type:'PC_FULL_CAPTURE_START',providerIds:['chatgpt'],speed:'gentle'});
      __pcListeners.alarm({name:'project-constellation-full-capture-step'});
      await new Promise(r=>setTimeout(r,80));
      const paused=(await __pcSend({type:'PC_FULL_CAPTURE_PAUSE'})).state;
      const resumed=(await __pcSend({type:'PC_FULL_CAPTURE_RESUME'})).state;
      const stopped=(await __pcSend({type:'PC_FULL_CAPTURE_STOP'})).state;
      return {state:first,paused,resumed,stopped,stats:__pcStats,doneResponses};
    }""")
    print(json.dumps({'result':result,'errors':errors},sort_keys=True))
    st=result['state']; stats=result['stats']
    assert st['status']=='completed' and st['captured']==2 and st['completeChats']==2 and st['partialChats']==0
    assert st['turnsCaptured']==22 and st['filesCaptured']==3
    assert stats['windowsCreated']==2 and stats['windowsRemoved']==2
    assert result['paused']['status']=='paused' and result['resumed']['status']=='running' and result['stopped']['status']=='stopped'
    assert stats['tabUpdates']==['https://chatgpt.com/c/one','https://chatgpt.com/c/two']
    assert stats['messages'].count('PC_MANUAL_DISCOVER_CHATS_ASYNC')>=2 and stats['messages'].count('PC_MANUAL_FULL_CAPTURE_ASYNC')==2
    assert not errors
    browser.close()
