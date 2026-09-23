const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const DIR=path.join(__dirname,'../browser-companion');
function event(){const listeners=[];return {addListener(fn){listeners.push(fn)},emit(...args){listeners.forEach(f=>f(...args))},listeners};}
const clone=x=>JSON.parse(JSON.stringify(x));
async function boot(existing={}) {
 let clock=Date.now(), nextId=1;
 const db=existing.db||{},tabs=existing.tabs||new Map(),actions=[],alarms=new Map(),timers=new Map();
 let snap=()=>({url:'https://chatgpt.com/schedules',recognized:true,tasks:[],explicitEmpty:true});
 let act=()=>({ok:true});
 const api={db,tabs,actions,alarms,timers,advance(ms){clock+=ms},setSnapshot(fn){snap=fn},setAction(fn){act=fn}};
 const storage={async get(keys){const out={};for(const k of Array.isArray(keys)?keys:[keys]) if(db[k]!==undefined)out[k]=clone(db[k]);return out},async set(v){Object.assign(db,clone(v));if(api.afterWrite)api.afterWrite(v)},async setAccessLevel(){}};
 const chrome={storage:{local:storage},alarms:{onAlarm:event(),async get(k){return alarms.get(k)},async create(k,v){alarms.set(k,v)},async clear(k){alarms.delete(k)}},
 runtime:{id:'fixture',onStartup:event(),onInstalled:event(),onMessage:event(),getURL:p=>'chrome-extension://fixture/'+p},
 tabs:{onUpdated:event(),async get(id){if(!tabs.has(id))throw Error('closed');return clone(tabs.get(id))},async create(v){while(tabs.has(nextId))nextId++;const tab={id:nextId++,status:'complete',...v};tabs.set(tab.id,tab);return clone(tab)},async remove(id){tabs.delete(id)},async reload(id){api.reloads=(api.reloads||0)+1},async sendMessage(id,m){
  if(m.type==='PCX_RECOVERY_INSPECT') return clone(snap(id,m));
  if(m.type==='PCX_RECOVERY_SCAN_MORE') return {status:'END_OF_VISIBLE_LIST'};
  if(m.type==='PCX_RECOVERY_ACT'){actions.push({id,action:m.action,active:m.active,db:clone(db)});return act(id,m)}
 }},scripting:{async executeScript(){}},action:{async setBadgeText(){}}};
 class ClockDate extends Date {constructor(...a){super(...(a.length?a:[clock]))}static now(){return clock}}
 const ctx=vm.createContext({chrome,console,URL,Date:ClockDate,Promise,setTimeout(fn,ms){const id=timers.size+1;timers.set(id,{fn,ms});return id},clearTimeout(id){timers.delete(id)}});
 vm.runInContext(fs.readFileSync(path.join(DIR,'core.js'),'utf8'),ctx);
 const source=fs.readFileSync(path.join(DIR,'background.js'),'utf8').replace("import './core.js';",'').replace('import.meta.url',"'chrome-extension://fixture/background.js'");
 vm.runInContext(source+'\nglobalThis.TEST={kick,load,ensureAlarm};',ctx);
 api.C=ctx.PCXTaskRecoveryCore;api.chrome=chrome;api.run=reason=>ctx.TEST.kick(reason||'test');api.state=()=>ctx.TEST.load();
 api.message=m=>new Promise(resolve=>chrome.runtime.onMessage.emit(m,{id:'fixture',url:'chrome-extension://fixture/popup.html'},resolve));
 await ctx.TEST.ensureAlarm();return api;
}
const T='Minecraft Mod Catalogue Updater';
function task(id='a',title=T){return {title,id,runId:'r1',attention:true,fingerprint:id+'f',openAction:{token:id+'open',kind:'open-followup'}};}
const base={url:'https://chatgpt.com/schedules',recognized:true,tasks:[]};
function script(api,taskValue=task()){
 api.setSnapshot((id,msg)=>msg.active?{...base,bound:true,tasks:[taskValue],fingerprint:'resume-f',action:{kind:'resume',token:'resume'}}:{...base,tasks:[taskValue]});
}
test('startup recreates its persisted browser alarm',async()=>{const a=await boot();assert.equal(a.alarms.size,1);assert.equal([...a.alarms.values()][0].periodInMinutes,1)});
test('Follow-up intent is persisted before the click',async()=>{const a=await boot();script(a);await a.run();assert.equal(a.actions.length,1);const sent=a.actions[0];assert.equal(sent.action.kind,'open-followup');const record=Object.values(sent.db[a.C.KEY].incidents)[0];assert.equal(Object.values(record.actions)[0].status,'INTENT_PERSISTED')});
test('simultaneous wake-ups are single-flight',async()=>{const a=await boot();script(a);await Promise.all([a.run(),a.run(),a.run()]);assert.equal(a.actions.filter(x=>x.action.kind==='open-followup').length,1)});
test('same run resumes once, does not create another task',async()=>{const a=await boot();script(a);await a.run();await a.run();await a.run();assert.equal(a.actions.filter(x=>x.action.kind==='resume').length,1);assert.equal(a.actions.filter(x=>x.action.kind==='open-followup').length,1)});
test('unknown click receipt does not cause blind replay',async()=>{const a=await boot();script(a);a.setAction(()=>{throw Error('lost receipt')});await a.run();await a.run();await a.run();assert.equal(a.actions.filter(x=>x.action.kind==='open-followup').length,1);assert.equal(a.actions.filter(x=>x.action.kind==='resume').length,1)});
test('security-blocked session is revisited after legitimate consent changes',async()=>{const a=await boot();let gated=true;
 a.setSnapshot((id,m)=>m.active?{...base,bound:true,approval:gated,tasks:[task()],fingerprint:'r',action:{kind:'resume',token:'r'}}:{...base,tasks:[task()]});
 await a.run();await a.run();assert.equal(a.actions.length,1);gated=false;await a.run();assert.equal(a.actions.filter(x=>x.action.kind==='resume').length,1);
});
test('one blocked run does not stop another independent task',async()=>{const a=await boot();const tasks=[task('a'),task('b','Minecraft Catalogue Librarian')];
 a.setSnapshot((id,m)=>m.active?{...base,bound:true,approval:m.active.id==='a',tasks,action:null}:{...base,tasks});
 await a.run();await a.run();assert.equal(a.actions.filter(x=>x.action.kind==='open-followup').length,2);assert.equal(a.actions[1].active.id,'b');
});
test('pause between write-ahead and click prevents the click',async()=>{const a=await boot();script(a);a.afterWrite=v=>{if(Object.values(v[a.C.KEY]?.incidents||{}).some(i=>Object.keys(i.actions||{}).length))a.db[a.C.KEY+'.config']={enabled:false}};
 await a.run();assert.equal(a.actions.length,0);
});
test('browser/service worker restart preserves action deduplication',async()=>{const a=await boot();script(a);await a.run();await a.run();const b=await boot({db:clone(a.db),tabs:a.tabs});script(b);await b.run();assert.equal(b.actions.length,0)});
test('a missing task selector is not certified healthy',async()=>{const a=await boot();a.setSnapshot(()=>({...base,recognized:false}));await a.run();assert.equal((await a.state()).status,'UI_UNRECOGNIZED');assert.equal(a.actions.length,0)});
test('signed-out state does not create one tab on every check',async()=>{const a=await boot();a.setSnapshot(()=>({...base,auth:true}));await a.run();await a.run();await a.run();assert.equal(a.tabs.size,1);assert.equal(a.actions.length,0)});
test('a running conversation is retained and never navigated away',async()=>{const a=await boot();script(a);await a.run();const first=[...a.tabs.values()][0];a.tabs.set(first.id,{...first,url:'https://chatgpt.com/c/run1'});
 a.setSnapshot((id,m)=>m.active?{...base,url:'https://chatgpt.com/c/run1',bound:true,running:true}:{...base,tasks:[task()]});await a.run();assert.equal(a.tabs.get(first.id).url,'https://chatgpt.com/c/run1');assert.equal((await a.state()).sessions[first.id].status,'RUNNING_OBSERVED');
});
test('user navigated conversation is not commandeered',async()=>{const a=await boot();script(a);await a.run();let s=await a.state();const id=Number(Object.keys(s.sessions)[0]);s.sessions[id].conversationUrl='https://chatgpt.com/c/run1';a.db[a.C.KEY]=clone(s);a.tabs.set(id,{id,status:'complete',url:'https://chatgpt.com/c/user-chat'});await a.run();assert.equal(a.tabs.get(id).url,'https://chatgpt.com/c/user-chat');assert.ok(!(await a.state()).sessions[id]);});
test('configuration change removes only the owned recovery alarm',async()=>{const a=await boot();a.alarms.set('other-component',{periodInMinutes:5});await a.message({type:'PCX_RECOVERY_CONFIG',config:{enabled:false}});assert.equal(a.alarms.size,1);assert.ok(a.alarms.has('other-component'))});
