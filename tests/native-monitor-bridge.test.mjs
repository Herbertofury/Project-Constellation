import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';

const source=await fs.readFile(new URL('../extension/src/native-monitor-bridge.js',import.meta.url),'utf8');
const attentionSource=await fs.readFile(new URL('../extension/src/attention-service.js',import.meta.url),'utf8');
const DEFAULTS={enabled:true,audioEnabled:true,notificationsEnabled:true,completionEnabled:false,volume:0.45,reminderMinutes:0,maxReminders:3,muteUntil:0};
const KEY='projectConstellationMonitorConnectionV1';
const INSTANCE='projectConstellationMonitorInstanceV1';
const RETRY='project-constellation-monitor-reconnect';
const clone=(value)=>structuredClone(value);
const plain=(value)=>JSON.parse(JSON.stringify(value));
const flush=async()=>{for(let index=0;index<12;index++)await new Promise(setImmediate);};
function event(){const listeners=[];return {addListener(fn){listeners.push(fn);},emit(...args){return listeners.map(fn=>fn(...args));},listeners};}

function harness(options={}) {
  let time=1_800_000_000_000;
  const values={[KEY]:clone(options.config||{}),[INSTANCE]:options.instanceId||'browser-session'};
  const timers=new Map(),alarms=new Map(),ports=[],sent=[],ownerCalls=[],observed=[],closed=[],acknowledged=[],snoozed=[],focused=[],windows=[],tabMessages=[],announcements=[],settingsCalls=[],timeline=[],sounds=[];
  const attention={sessions:clone(options.sessions||[]),incidents:clone(options.incidents||[]),settings:{...DEFAULTS,...clone(options.settings||{})}};
  let sharedSettings=options.sharedSettings?{...DEFAULTS,...clone(options.sharedSettings)}:null;
  const tabs=new Map((options.tabs||[]).map(tab=>[tab.id,clone(tab)]));
  const browserWindows=new Map((options.browserWindows||[{id:1,type:'normal'}]).map(window=>[window.id,clone(window)]));
  const subscribers=[];
  let timerId=0,connectCount=0,failed=Boolean(options.failConnect),attentionId=0,pauseAttentionGet=null;
  const api={
    runtime:{id:'test-extension',getURL:path=>`chrome-extension://test-extension/${path}`,onMessage:event(),lastError:null,
      sendMessage:async value=>{announcements.push(clone(value));return {ok:true};},
      connectNative(name){
        assert.equal(name,'com.project_constellation.monitor');connectCount++;
        const port={onMessage:event(),onDisconnect:event(),disconnected:false,
          emit(value){port.onMessage.emit(clone(value));},
          disconnect(){if(port.disconnected)return;port.disconnected=true;port.onDisconnect.emit();},
          fail(message='Native host unavailable'){api.runtime.lastError={message};port.disconnect();api.runtime.lastError=null;},
          postMessage(value){
            sent.push(clone(value));
            if(failed){queueMicrotask(()=>port.fail());return;}
            if(options.silentOperations?.includes(value.op))return;
            if(value.op==='hello'){
              const client={...clone(value.client),clientId:`${value.client.browser}:${value.client.profileId}:${value.client.instanceId}`,connected:true,updatedAt:time};
              sharedSettings??=clone(value.alertSettings);
              port.snapshot={protocolVersion:1,revision:1,updatedAt:time,clientId:client.clientId,clients:[client],sessions:[],incidents:[],alertSettings:clone(sharedSettings),capabilities:{sharedAlertSettings:!options.oldCompanion}};
              queueMicrotask(()=>port.emit({v:1,id:value.id,ok:true,kind:'snapshot',data:port.snapshot}));
            }else if(value.op==='snapshot')queueMicrotask(()=>port.emit({v:1,id:value.id,ok:true,kind:'snapshot',data:port.snapshot}));
            else if(value.op==='alert_settings'){
              if(options.failSettings){queueMicrotask(()=>port.emit({v:1,id:value.id,ok:false,error:{message:'Shared policy could not be saved',code:'persistence_failed'}}));return;}
              sharedSettings={...sharedSettings,...clone(value.settings)};
              port.snapshot={...port.snapshot,revision:port.snapshot.revision+1,alertSettings:clone(sharedSettings)};
              queueMicrotask(()=>port.emit({v:1,id:value.id,ok:true,kind:'snapshot',data:port.snapshot}));
            }
            else queueMicrotask(()=>port.emit({v:1,id:value.id,ok:true,kind:'ack',data:{routed:true}}));
          }};
        ports.push(port);return port;
      }},
    storage:{
      local:{get:async key=>({[key]:clone(values[key])}),set:async patch=>Object.assign(values,clone(patch))},
      session:{get:async key=>{if(options.delaySessionRead)await options.delaySessionRead;return {[key]:clone(values[key])};},set:async patch=>Object.assign(values,clone(patch))}},
    permissions:{contains:async()=>options.permission!==false},
    alarms:{create:async(name,info)=>alarms.set(name,clone(info)),clear:async name=>alarms.delete(name),onAlarm:event()},
    tabs:{onRemoved:event(),onUpdated:event(),query:async()=>[...tabs.values()].map(clone),
      get:async id=>{if(!tabs.has(id))throw new Error('No such tab');return clone(tabs.get(id));},
      update:async(id,patch)=>{focused.push({id,patch:clone(patch)});return {...tabs.get(id),...patch};},
      sendMessage:async(id,message)=>{tabMessages.push({id,message:clone(message)});return options.sendTabMessage?options.sendTabMessage(id,message):{ok:true};}},
    windows:{onCreated:event(),onRemoved:event(),
      getAll:async options=>[...browserWindows.values()].filter(window=>!options?.windowTypes||options.windowTypes.includes(window.type)).map(clone),
      update:async(id,patch)=>windows.push({id,patch:clone(patch)})},
  };
  const context={chrome:api,crypto:{randomUUID},URL,TextEncoder,console,structuredClone,queueMicrotask,
    navigator:{userAgent:options.userAgent||'Chrome/158'},
    Date:class extends Date{static now(){return time;}},
    setTimeout(fn,ms){const id=++timerId;timers.set(id,{fn,at:time+ms});return id;},clearTimeout:id=>timers.delete(id),
    pcAttention:{
      closeTab:async(tabId,sourceId)=>{closed.push({tabId,sourceId});for(const row of attention.sessions.filter(x=>x.tabId===tabId&&x.sourceId===sourceId))row.status='closed';},
      acknowledge:async id=>{acknowledged.push(id);const item=attention.incidents.find(x=>x.id===id);if(item)item.acknowledgedAt=time;},
      snooze:async(id,minutes)=>snoozed.push({id,minutes}),
      settings:async patch=>{settingsCalls.push(clone(patch));timeline.push({type:'settings',settings:clone(patch)});attention.settings={...attention.settings,...clone(patch)};subscribers.forEach(fn=>fn({type:'settings'}));return clone(attention);},
      applyIncidentState:async(id,state)=>{timeline.push({type:'incident-state',id,state:clone(state)});const item=attention.incidents.find(x=>x.id===id);if(item)Object.assign(item,clone(state));if(state.acknowledgedAt)acknowledged.push(id);if(state.snoozedUntil)snoozed.push({id,snoozedUntil:state.snoozedUntil});return {ok:true};},
    },
    pcAttentionGet:async()=>{if(pauseAttentionGet)await pauseAttentionGet;return clone(attention);},
    pcAttentionSubscribe:fn=>subscribers.push(fn),
    pcAttentionSetAudioOwner:async value=>{ownerCalls.push(clone(value));timeline.push({type:'owner',...clone(value),settings:clone(attention.settings)});},
    pcAttentionObserve:async row=>{
      observed.push(clone(row));
      if(options.failRemoteObservation&&row.sourceId.startsWith('native:')){
        if(options.failRemoteObservation==='throw')throw new Error('Local observation storage failed');
        return {ok:false,error:'Local observation storage failed'};
      }
      timeline.push({type:'observe',sourceId:row.sourceId,status:row.status});
      const index=attention.sessions.findIndex(x=>x.tabId===row.tabId&&x.sourceId===row.sourceId);
      if(index<0)attention.sessions.push(clone(row));else attention.sessions[index]={...attention.sessions[index],...clone(row)};
      if(['permission_required','error'].includes(row.status)&&!attention.incidents.some(x=>x.tabId===row.tabId&&x.sourceId===row.sourceId&&x.kind===row.status&&!x.resolvedAt)){
        attention.incidents.push({id:`local-incident-${++attentionId}`,sourceId:row.sourceId,tabId:row.tabId,documentId:row.documentId,runId:row.runId,url:row.url,kind:row.status,resolvedAt:0});
      }
      return {ok:true};
    },
    ProjectConstellationProviders:{detectProvider:url=>/^https:\/\/(chatgpt\.com|claude\.ai)\//.test(url)},
  };
  if(options.realAttention){
    vm.runInNewContext(attentionSource,context,{filename:'attention-service.js'});
    const service=context.ProjectConstellationAttentionService.createService({now:()=>time,
      read:async()=>clone(attention),write:async(_key,value)=>Object.assign(attention,clone(value)),
      sound:async value=>{sounds.push({...clone(value),at:time});return {ok:true};},notify:async()=>({ok:true}),clearNotification:async()=>{},
      alarm:async(name,when)=>alarms.set(name,{when}),clearAlarm:async name=>alarms.delete(name)});
    context.pcAttention={...service,settings:async patch=>{settingsCalls.push(clone(patch));timeline.push({type:'settings',settings:clone(patch)});return service.settings(patch);},
      applyIncidentState:async(id,state)=>{timeline.push({type:'incident-state',id,state:clone(state)});return service.applyIncidentState(id,state);}};
    context.pcAttentionGet=()=>service.get();context.pcAttentionSubscribe=fn=>service.subscribe(fn);
    context.pcAttentionSetAudioOwner=async value=>{ownerCalls.push(clone(value));timeline.push({type:'owner',...clone(value),settings:clone(attention.settings)});return service.setAudioOwner(value);};
    context.pcAttentionObserve=async row=>{observed.push(clone(row));timeline.push({type:'observe',sourceId:row.sourceId,status:row.status});return service.observe(row);};
  }
  vm.runInNewContext(source,context,{filename:'native-monitor-bridge.js'});
  const ui={id:'test-extension',url:'chrome-extension://test-extension/agent-monitor.html'};
  const send=(message,sender=ui)=>new Promise((resolve,reject)=>{
    let answered=false;
    const respond=value=>{answered=true;resolve(plain(value));};
    const handled=api.runtime.onMessage.emit(message,sender,respond).some(x=>x===true);
    if(!handled&&!answered)reject(new Error('Message was not handled'));
  });
  return {api,context,values,timers,alarms,ports,sent,ownerCalls,observed,closed,acknowledged,snoozed,focused,windows,tabMessages,announcements,attention,tabs,browserWindows,send,settingsCalls,timeline,sounds,
    monitor:()=>context.pcNativeMonitor,
    setFailure(value){failed=value;},
    pauseGet(value){pauseAttentionGet=value;},
    connectCount:()=>connectCount,
    now:()=>time,
    advance(ms){time+=ms;},
    async alarm(){const current=alarms.get(RETRY);assert.ok(current);time=current.when;alarms.delete(RETRY);api.alarms.onAlarm.emit({name:RETRY});await flush();},
    async snapshot(data){const port=ports.at(-1);const full={alertSettings:clone(sharedSettings),capabilities:{sharedAlertSettings:true},...clone(data)};sharedSettings=clone(full.alertSettings);port.snapshot=full;port.emit({v:1,kind:'snapshot',data:full});await flush();},
    local(row){subscribers.forEach(fn=>fn({session:{sourceId:'local',...row}}));},
  };
}

// Background-mode browser processes with no normal windows must not start a
// native host or recreate it from a reconnect alarm. Reopening preserves opt-in
// and profile/session identity across Chrome, Edge, Opera and Firefox.
for(const browser of ['chrome','edge','opera_gx','firefox']){
  const h=harness({config:{enabled:true,browser,profileId:'work'},browserWindows:[{id:99,type:'popup'}]});await flush();
  assert.equal(h.connectCount(),0,`${browser}: background startup does not spawn a hub`);
  assert.equal((await h.monitor().get()).waitingForWindow,true);
  assert.equal(h.alarms.has(RETRY),false);
  h.api.alarms.onAlarm.emit({name:RETRY});await flush();
  assert.equal(h.connectCount(),0,'stale retry cannot reopen a windowless browser transport');
  h.browserWindows.set(1,{id:1,type:'normal'});h.api.windows.onCreated.emit({id:1,type:'normal'});await flush();
  assert.equal(h.connectCount(),1);
  assert.equal((await h.monitor().get()).connected,true);
  const firstClient=h.sent.find(message=>message.op==='hello').client;
  h.browserWindows.delete(1);h.api.windows.onRemoved.emit(1);await flush();
  assert.equal(h.ports[0].disconnected,true);
  assert.equal((await h.monitor().get()).waitingForWindow,true);
  assert.equal((await h.monitor().get()).config.enabled,true,'window closure preserves the user opt-in');
  assert.equal(h.alarms.has(RETRY),false,'window closure schedules no native reconnect');
  assert.equal(h.ownerCalls.at(-1).enabled,false,'a closed browser does not own alert sound');
  h.browserWindows.set(2,{id:2,type:'normal'});h.api.windows.onCreated.emit({id:2,type:'normal'});await flush();
  assert.equal(h.connectCount(),2);
  assert.deepEqual(h.sent.filter(message=>message.op==='hello').at(-1).client,firstClient);
  assert.equal((await h.monitor().get()).waitingForWindow,false);
  await h.monitor().disconnect();
}

// A browser can have several normal windows. Closing one window or an unrelated
// popup leaves the remaining profile connection and its observations intact.
{
  const h=harness({config:{enabled:true},browserWindows:[{id:1,type:'normal'},{id:2,type:'normal'},{id:3,type:'popup'}]});await flush();
  h.browserWindows.delete(1);h.api.windows.onRemoved.emit(1);await flush();
  h.browserWindows.delete(3);h.api.windows.onRemoved.emit(3);await flush();
  assert.equal(h.connectCount(),1);assert.equal(h.ports[0].disconnected,false);
  assert.equal((await h.monitor().get()).connected,true);
  h.browserWindows.delete(2);h.api.windows.onRemoved.emit(2);await flush();
  assert.equal(h.ports[0].disconnected,true);assert.equal(h.alarms.has(RETRY),false);
  await h.monitor().disconnect();
}

// Closing while setup waits on storage cancels that generation. Opening a new
// window before it finishes resumes once, without reviving the cancelled port.
{
  const h=harness();await flush();
  let release;const paused=new Promise(resolve=>{release=resolve;});h.pauseGet(paused);
  const connecting=h.monitor().connect(true);await flush();
  assert.equal(h.connectCount(),0);
  h.browserWindows.clear();h.api.windows.onRemoved.emit(1);await flush();
  assert.equal((await h.monitor().get()).waitingForWindow,true);
  h.browserWindows.set(2,{id:2,type:'normal'});h.api.windows.onCreated.emit({id:2,type:'normal'});await flush();
  h.pauseGet(null);release();await connecting;await flush();
  assert.equal(h.connectCount(),1,'only the resumed setup creates a native port');
  assert.equal((await h.monitor().get()).connected,true);
  assert.equal(h.alarms.has(RETRY),false);
  await h.monitor().disconnect();
}

{
  const h=harness({permission:false});await flush();
  const response=await h.send({type:'PC_MONITOR_CONNECT'});
  assert.equal(response.ok,false);assert.match(response.error,/native messaging permission/);
  assert.equal(h.connectCount(),0,'missing permission never attempts native IPC');
  await h.monitor().disconnect();
}

// Loading is inert until a user has enabled the native bridge. Provider pages
// cannot grant permission, change settings, request focus, or enable native IPC.
{
  const h=harness();await flush();
  assert.equal(h.connectCount(),0);
  assert.equal(h.alarms.size,0);
  const status=await h.monitor().get();assert.equal(status.config.enabled,false);
  for(const type of ['PC_MONITOR_CONNECT','PC_MONITOR_SETTINGS','PC_MONITOR_ALERT_SETTINGS','PC_MONITOR_FOCUS','PC_MONITOR_ACK']){
    const response=await h.send({type,settings:{browser:'firefox'},sessionId:'foreign'},{id:'test-extension',url:'https://chatgpt.com/c/test',tab:{id:1}});
    assert.equal(response.ok,false);assert.match(response.error,/extension dashboard/);
  }
  assert.equal(h.connectCount(),0);
  const response=await h.send({type:'PC_MONITOR_GET'});assert.equal(response.ok,true);
}

// Concurrent startup gets one durable profile and one session identity. Invalid
// persisted identity strings cannot produce a permanently rejected hello.
{
  let release;const delayed=new Promise(resolve=>{release=resolve;});
  const h=harness({delaySessionRead:delayed,config:{profileId:'bad profile / 猫'},instanceId:'bad session value'});
  await new Promise(setImmediate);
  const connecting=h.monitor().connect(true);
  await new Promise(setImmediate);
  assert.equal(h.connectCount(),0,'hello waits for asynchronous identity initialization');
  release();await connecting;await flush();
  const hello=h.sent.find(x=>x.op==='hello');
  assert.match(hello.client.profileId,/^[A-Za-z0-9._@-]{1,80}$/);
  assert.match(hello.client.instanceId,/^[A-Za-z0-9._@-]{1,80}$/);
  assert.equal(h.connectCount(),1);
  await h.monitor().disconnect();
}

// Transport data obeys the native byte limits even for multi-byte Unicode; the
// matching normalized document ID is what focus validation uses.
{
  const h=harness({config:{browser:'edge'}});await flush();await h.monitor().connect(true);
  const row={sourceId:'local',tabId:7,key:'fallback-'.repeat(30),runId:'🐈'.repeat(100),url:'https://chatgpt.com/c/one?private=query#fragment',title:'猫'.repeat(200),reason:'🐈'.repeat(200),status:'permission_required',observedAt:h.now()};
  h.tabs.set(7,{id:7,url:row.url,windowId:2});
  await h.monitor().observe(row);
  const wire=h.sent.filter(x=>x.op==='observe').at(-1).event;
  assert.ok(Buffer.byteLength(wire.documentId)<=80);assert.ok(Buffer.byteLength(wire.runId)<=80);
  assert.ok(Buffer.byteLength(wire.title)<=180);assert.ok(Buffer.byteLength(wire.reason)<=240);
  assert.equal(wire.url,'https://chatgpt.com/c/one');
  assert.equal(wire.status,'permission_required');
  await h.monitor().observe({...row,reason:'Control\u0085 and lone surrogate \ud800'});
  const sanitized=h.sent.filter(x=>x.op==='observe').at(-1).event.reason;
  assert.ok(sanitized.isWellFormed());assert.ok(!/[\u0080-\u009f]/.test(sanitized));
  const client=(await h.monitor().get()).clientId;
  h.ports[0].emit({v:1,kind:'focus',data:{sessionId:`${client}:7`,tabId:7,documentId:wire.documentId}});await flush();
  assert.equal(h.focused.length,1);assert.equal(h.windows.length,1);
  assert.equal(h.tabMessages.at(-1).message.type,'PC_ATTENTION_REVEAL_PERMISSION');
  h.ports[0].emit({v:1,kind:'focus',data:{sessionId:`${client}:7`,tabId:7,documentId:'stale'}});await flush();
  assert.equal(h.focused.length,1,'stale document cannot gain focus');
  h.tabs.set(7,{id:7,url:'https://chatgpt.com/c/reused',windowId:2});
  h.ports[0].emit({v:1,kind:'focus',data:{sessionId:`${client}:7`,tabId:7,documentId:wire.documentId}});await flush();
  assert.equal(h.focused.length,1,'reused tab identity cannot focus a different chat');
  h.api.tabs.onUpdated.emit(7,{url:'https://chatgpt.com/c/reused'});await flush();
  assert.equal(h.sent.at(-1).op,'remove');
  await h.monitor().disconnect();
}

// Synchronization already queued behind a slow storage read must not revive a
// disconnected source or take audio ownership away from standalone fallback.
{
  const h=harness();await flush();await h.monitor().connect(true);
  const own=(await h.monitor().get()).clientId;
  let release;const paused=new Promise(resolve=>{release=resolve;});
  const session={sessionId:'edge:work:session:7',clientId:'edge:work:session',browser:'edge',tabId:7,documentId:'doc',url:'https://chatgpt.com/c/edge',title:'Remote',status:'error',reason:'Initial',observedAt:h.now(),connected:true};
  const base={revision:2,clients:[{clientId:own,connected:true},{clientId:session.clientId,connected:true}],sessions:[session],incidents:[]};
  await h.snapshot(base);
  h.pauseGet(paused);
  await h.snapshot({...base,revision:3,sessions:[{...session,status:'permission_required',reason:'Queued stale status'}]});
  h.ports[0].fail();await flush();
  h.pauseGet(null);release();await flush();
  assert.ok(!h.observed.some(x=>x.reason==='Queued stale status'));
  assert.equal(h.observed.at(-1).status,'sensor-offline');
  assert.equal(h.ownerCalls.at(-1).enabled,true);
  await h.monitor().disconnect();
}

// The same numeric tab ID in different browsers remains distinct, and missing
// remote sessions in an authoritative snapshot are closed rather than retained.
{
  const h=harness();await flush();await h.monitor().connect(true);
  const own=(await h.monitor().get()).clientId;
  const clients=[{clientId:own,connected:true},{clientId:'firefox:work:instance',connected:true},{clientId:'edge:work:instance',connected:true}];
  const sessions=['firefox','edge'].map(browser=>({sessionId:`${browser}:work:instance:7`,clientId:`${browser}:work:instance`,browser,tabId:7,documentId:`${browser}-doc`,runId:'run',url:'https://chatgpt.com/c/'+browser,title:browser,status:'error',reason:'Issue',observedAt:h.now(),connected:true}));
  await h.snapshot({revision:2,clients,sessions,incidents:[]});
  assert.equal(h.observed.length,2);assert.notEqual(h.observed[0].sourceId,h.observed[1].sourceId);
  assert.equal(h.ownerCalls.at(-1).enabled,true,'lexically first connected client owns shared alerts');
  await h.snapshot({revision:3,clients,sessions:[sessions[0]],incidents:[]});
  assert.deepEqual(h.closed,[{tabId:7,sourceId:'native:edge:work:instance'}]);
  const before=h.observed.length;
  await h.snapshot({revision:2,clientId:'old-bogus-client',clients:[],sessions,incidents:[]});
  assert.equal(h.observed.length,before,'older revision is ignored');
  assert.equal((await h.monitor().get()).clientId,own,'stale snapshot cannot change own identity');
  h.ports[0].fail('Broker stopped');await flush();
  assert.equal(h.ownerCalls.at(-1).enabled,true);
  assert.equal((await h.monitor().get()).connected,false);
  assert.equal(h.observed.at(-1).status,'sensor-offline');
  const count=h.observed.length;
  h.ports[0].emit({v:1,kind:'snapshot',data:{revision:100,clients,sessions,incidents:[]}});await flush();
  assert.equal(h.observed.length,count,'messages from a disconnected port are ignored');
  assert.equal(h.ownerCalls.at(-1).enabled,true,'stale work cannot override standalone alert ownership');
  await h.monitor().disconnect();
}

// Native ack/snooze state can arrive before a corresponding attention incident.
// It must be applied when that incident becomes available on a later snapshot.
{
  const h=harness();await flush();await h.monitor().connect(true);
  const own=(await h.monitor().get()).clientId;
  const session={sessionId:`${own}:9`,clientId:own,tabId:9,documentId:'doc',runId:'run',url:'https://chatgpt.com/c/late',status:'error',connected:true};
  const incident={incidentId:'incident-1',sessionId:session.sessionId,documentId:'doc',runId:'run',url:session.url,kind:'error',acknowledgedAt:h.now(),snoozedUntil:null,resolvedAt:null};
  const snapshot={revision:2,clients:[{clientId:own,connected:true}],sessions:[session],incidents:[incident]};
  await h.snapshot(snapshot);assert.equal(h.acknowledged.length,0);
  h.attention.incidents.push({id:'late-local',sourceId:'local',tabId:9,documentId:'doc',runId:'run',url:session.url,kind:'error',resolvedAt:0});
  await h.snapshot({...snapshot,revision:3});assert.deepEqual(h.acknowledged,['late-local']);
  await h.snapshot({...snapshot,revision:4});assert.equal(h.acknowledged.length,1,'already mirrored state is not replayed');
  await h.monitor().disconnect();
}

// A temporary local persistence failure cannot mark an unimported remote row
// as synchronized forever. Both thrown and structured failures are visible and
// the next unchanged authoritative snapshot retries that row successfully.
for(const failure of ['throw','response']){
  const options={failRemoteObservation:failure};const h=harness(options);await flush();await h.monitor().connect(true);
  const own=(await h.monitor().get()).clientId,remote='firefox:work:session';
  const row={sessionId:`${remote}:7`,clientId:remote,browser:'firefox',tabId:7,documentId:'doc',runId:'run',url:'https://chatgpt.com/c/retry-import',title:'Retry import',status:'error',connected:true,observedAt:h.now()};
  const snapshot={revision:2,clients:[{clientId:own,connected:true},{clientId:remote,connected:true}],sessions:[row],incidents:[]};
  await h.snapshot(snapshot);
  assert.equal(h.attention.sessions.length,0);assert.match((await h.monitor().get()).error,/observation storage failed/);
  options.failRemoteObservation=false;await h.snapshot({...snapshot,revision:3});
  assert.equal(h.observed.length,2,'failed import retries despite unchanged observation bytes');
  assert.equal(h.attention.sessions.length,1);assert.equal((await h.monitor().get()).error,'');
  await h.snapshot({...snapshot,revision:4});assert.equal(h.observed.length,2,'accepted imports still deduplicate');
  await h.monitor().disconnect();
}

// History and reused tab IDs must never transfer acknowledgements or snoozes
// into a different conversation, document, or run.
{
  const h=harness();await flush();await h.monitor().connect(true);
  const own=(await h.monitor().get()).clientId;
  const session={sessionId:`${own}:9`,clientId:own,tabId:9,documentId:'new-doc',runId:'new-run',url:'https://chatgpt.com/c/new',status:'error',connected:true};
  h.attention.incidents.push({id:'current-local',sourceId:'local',tabId:9,documentId:session.documentId,runId:session.runId,url:session.url,kind:'error',resolvedAt:0});
  const old={incidentId:'old-incident',sessionId:session.sessionId,documentId:'old-doc',runId:'old-run',url:'https://chatgpt.com/c/old',kind:'error',acknowledgedAt:h.now(),resolvedAt:h.now()};
  const base={revision:2,clients:[{clientId:own,connected:true}],sessions:[session],incidents:[old]};
  await h.snapshot(base);assert.equal(h.acknowledged.length,0,'resolved history cannot acknowledge current incident');
  await h.snapshot({...base,revision:3,incidents:[{...old,resolvedAt:null}]});
  assert.equal(h.acknowledged.length,0,'different document and URL cannot transfer acknowledgement');
  const current={...old,incidentId:'current-incident',documentId:session.documentId,url:session.url,resolvedAt:null};
  await h.snapshot({...base,revision:4,incidents:[current]});
  assert.equal(h.acknowledged.length,0,'different run cannot transfer acknowledgement');
  await h.snapshot({...base,revision:5,incidents:[{...current,runId:session.runId,acknowledgedAt:null,snoozedUntil:h.now()+60000}]});
  assert.deepEqual(h.snoozed,[{id:'current-local',snoozedUntil:h.now()+60000}]);
  await h.snapshot({...base,revision:6,incidents:[{...current,runId:session.runId}]});
  assert.deepEqual(h.acknowledged,['current-local']);
  await h.monitor().disconnect();
}

// A missing companion performs three bounded one-shot retries and then stops.
// It does not poll or silently request native-messaging permission.
{
  const h=harness({failConnect:true});await flush();
  await assert.rejects(h.monitor().connect(true));await flush();
  assert.equal(h.connectCount(),1);assert.equal((await h.monitor().get()).retryAttempt,1);
  for(let index=0;index<3;index++)await h.alarm();
  assert.equal(h.connectCount(),4);assert.equal(h.alarms.size,0);
  assert.equal((await h.monitor().get()).retryAttempt,3);
  assert.equal(h.timers.size,0,'disconnected pending requests release their timeout timers');
  await h.monitor().disconnect();assert.equal(h.alarms.size,0);
}

// A clean reconnect accepts a fresh broker revision sequence and ignores old
// port events instead of applying stale state over the new connection.
{
  const h=harness();await flush();await h.monitor().connect(true);
  const old=h.ports[0];const client=(await h.monitor().get()).clientId;
  await h.snapshot({revision:90,clients:[{clientId:client,connected:true}],sessions:[],incidents:[]});
  old.fail();await flush();await h.monitor().connect(true);await flush();
  assert.equal((await h.monitor().get()).snapshot.revision,1);
  old.emit({v:1,kind:'snapshot',data:{revision:100,clientId:'old',clients:[],sessions:[],incidents:[]}});await flush();
  assert.equal((await h.monitor().get()).clientId,client);
  assert.equal((await h.monitor().get()).snapshot.revision,1);
  await h.monitor().disconnect();
}

// An open but unresponsive native pipe must not remain falsely connected. A
// request deadline retires that port, releases all pending requests, marks
// remote observations offline and schedules one bounded reconnect.
{
  const options={silentOperations:[]};const h=harness(options);await flush();await h.monitor().connect(true);
  options.silentOperations.push('snapshot','focus');
  const timedOut=h.monitor().request('snapshot');
  const pendingFocus=h.monitor().request('focus',{sessionId:'firefox:work:session:7'});
  const failures=Promise.all([assert.rejects(timedOut,/did not answer snapshot/),assert.rejects(pendingFocus,/did not answer snapshot/)]);
  assert.equal(h.timers.size,2);
  const first=[...h.timers.entries()][0];h.timers.delete(first[0]);first[1].fn();
  await failures;await flush();
  assert.equal(h.ports[0].disconnected,true);
  assert.equal((await h.monitor().get()).connected,false);
  assert.match((await h.monitor().get()).error,/did not answer snapshot/);
  assert.equal(h.timers.size,0,'all requests on the hung transport release their deadlines');
  assert.equal(h.alarms.size,1);assert.equal((await h.monitor().get()).retryAttempt,1);
  options.silentOperations.length=0;await h.alarm();
  assert.equal((await h.monitor().get()).connected,true);assert.equal(h.connectCount(),2);
  h.ports[0].emit({v:1,kind:'snapshot',data:{revision:900,clientId:'stale',clients:[],sessions:[],incidents:[]}});await flush();
  assert.notEqual((await h.monitor().get()).clientId,'stale');
  await h.monitor().disconnect();
}

// Manual refresh probes the real Chromium sentinel first, falls back to the
// Firefox sensor, and reports unavailable/suspended sources without fake success.
{
  const tabs=[
    {id:11,url:'https://chatgpt.com/c/current',title:'Current'},
    {id:12,url:'https://claude.ai/chat/firefox',title:'Firefox'},
    {id:13,url:'https://chatgpt.com/c/missing'},
    {id:14,url:'https://chatgpt.com/c/asleep',discarded:true},
    {id:15,url:'https://example.com/'},
    {id:16,url:'https://chatgpt.com/c/changed'},
  ];
  const h=harness({tabs,sendTabMessage:async(id,message)=>{
    if(id===11&&message.type==='PC_GET_LIVE_SENTINEL_STATE')return {ok:true,source:'live-sentinel',version:'0.23.0',chat:{id:'current-doc',url:tabs[0].url,title:'Current permission',status:'blocked-approval',healthState:'blocked-approval'},generation:{active:false},observedAt:1_800_000_000_000};
    if(id===12&&message.type==='PC_MONITOR_RESCAN')return {ok:true};
    if(id===16&&message.type==='PC_GET_LIVE_SENTINEL_STATE'){
      h.tabs.set(16,{id:16,url:'https://chatgpt.com/c/reused'});
      return {ok:true,source:'live-sentinel',version:'0.23.0',chat:{id:'changed-doc',url:tabs[5].url,status:'running'}};
    }
    throw new Error('No current sensor');
  }});await flush();
  const response=await h.send({type:'PC_MONITOR_REFRESH'});
  assert.equal(response.ok,true);
  assert.deepEqual(response.monitor.refresh,{total:5,observed:1,rescanRequested:1,suspended:1,unavailable:2,at:h.now()});
  assert.equal(h.observed.length,1);assert.equal(h.observed[0].tabId,11);
  assert.equal(h.observed[0].documentId,'current-doc');assert.equal(h.observed[0].healthState,'blocked-approval');
  assert.equal(h.observed[0].authoritative,true);
  assert.ok(!h.tabMessages.some(x=>x.id===14||x.id===15),'discarded and unsupported tabs receive no probes');
  assert.equal(h.timers.size,0,'completed probes release their deadlines');
}
// Unresponsive content scripts cannot hold the manual refresh indefinitely.
{
  const h=harness({tabs:[{id:20,url:'https://chatgpt.com/c/hung'}],sendTabMessage:()=>new Promise(()=>{})});await flush();
  const refresh=h.send({type:'PC_MONITOR_REFRESH'});await flush();
  for(let i=0;i<2;i++){
    assert.equal(h.timers.size,1);[...h.timers.values()][0].fn();await flush();
  }
  const response=await refresh;
  assert.equal(response.monitor.refresh.unavailable,1);assert.equal(h.observed.length,0);assert.equal(h.timers.size,0);
}

// The first connection carries existing browser preferences, while a stored
// hub policy wins over a later profile's different local settings.
{
  const initial={...DEFAULTS,audioEnabled:false,volume:0.23,muteUntil:1_800_000_300_000};
  const h=harness({settings:initial});await flush();await h.monitor().connect(true);
  assert.deepEqual(h.sent.find(x=>x.op==='hello').alertSettings,initial);
  assert.deepEqual((await h.monitor().get()).snapshot.alertSettings,initial);
  assert.equal(h.sent.filter(x=>x.op==='alert_settings').length,0,'native hello initializes atomically, without a second initializer race');
  await h.monitor().disconnect();
  const later=harness({settings:{muteUntil:0,volume:1},sharedSettings:initial});await flush();await later.monitor().connect(true);
  assert.equal(later.attention.settings.muteUntil,initial.muteUntil);
  assert.equal(later.attention.settings.volume,initial.volume);
  const enabled=later.timeline.find(x=>x.type==='owner'&&x.enabled);
  assert.equal(enabled.settings.muteUntil,initial.muteUntil,'stored mute is applied before delivery ownership');
  await later.monitor().disconnect();
}

// Missing capability cannot present a falsely connected shared-policy UI.
{
  const h=harness({oldCompanion:true});await flush();
  await assert.rejects(h.monitor().connect(true),/does not support shared alert settings/);
  assert.equal((await h.monitor().get()).connected,false);
  assert.equal(h.settingsCalls.length,0);
  assert.equal(h.ownerCalls.at(-1).reason,'standalone-fallback');
  await h.monitor().disconnect();
}

// Invalid patches never reach native IPC, and a failed durable native update
// never silently applies a browser-only policy.
{
  const h=harness({failSettings:true,sharedSettings:{muteUntil:1_800_000_300_000}});await flush();await h.monitor().connect(true);
  const settingsBefore=clone(h.attention.settings),callsBefore=h.settingsCalls.length;
  for(const patch of [{volume:2},{enabled:'false'},{muteUntil:-1},{muteUntil:1.5},{maxReminders:11},{arbitrary:true},null]){
    const before=h.sent.length;const response=await h.send({type:'PC_MONITOR_ALERT_SETTINGS',settings:patch});
    assert.equal(response.ok,false);assert.equal(h.sent.length,before);
  }
  const response=await h.send({type:'PC_MONITOR_ALERT_SETTINGS',settings:{muteUntil:0}});
  assert.equal(response.ok,false);assert.match(response.error,/could not be saved/);
  assert.deepEqual(h.attention.settings,settingsBefore);assert.equal(h.settingsCalls.length,callsBefore);
  await h.monitor().disconnect();
}

// Run the real attention service: a follower mute reaches the elected owner,
// survives leadership transfer, and exact snooze deadlines survive frequent
// unchanged snapshots without repeated ownership or policy changes.
{
  const leader=harness({realAttention:true,config:{browser:'chrome',profileId:'leader'}});
  const follower=harness({realAttention:true,config:{browser:'firefox',profileId:'follower'}});
  await flush();await leader.monitor().connect(true);await follower.monitor().connect(true);
  const a=(await leader.monitor().get()).clientId,b=(await follower.monitor().get()).clientId;
  const clients=[{clientId:a,connected:true},{clientId:b,connected:true}];
  await leader.snapshot({revision:2,clients,sessions:[],incidents:[]});
  await follower.snapshot({revision:2,clients,sessions:[],incidents:[]});
  assert.equal(follower.ownerCalls.at(-1).enabled,false);
  const until=follower.now()+300000;
  const muted=await follower.send({type:'PC_MONITOR_ALERT_SETTINGS',settings:{muteUntil:until}});
  assert.equal(muted.ok,true);
  const policy=muted.monitor.snapshot.alertSettings;
  await leader.snapshot({revision:3,clients,sessions:[],incidents:[],alertSettings:policy});
  assert.equal((await leader.context.pcAttentionGet()).settings.muteUntil,until);
  const session={sessionId:`${b}:7`,clientId:b,browser:'firefox',tabId:7,documentId:'shared-doc',runId:'shared-run',url:'https://chatgpt.com/c/shared',title:'Shared error',status:'error',connected:true,observedAt:follower.now()};
  const item={incidentId:'shared-incident',sessionId:session.sessionId,documentId:session.documentId,runId:session.runId,url:session.url,kind:'error',acknowledgedAt:null,snoozedUntil:null,resolvedAt:null};
  await follower.context.pcAttentionObserve({...session,sourceId:'local'});await flush();
  await leader.snapshot({revision:4,clients,sessions:[session],incidents:[item],alertSettings:policy});
  assert.equal(leader.sounds.length,0,'elected owner honors a mute requested in another profile');
  const transferred=[{clientId:a,connected:false},{clientId:b,connected:true}];
  await follower.snapshot({revision:4,clients:transferred,sessions:[session],incidents:[item],alertSettings:policy});
  assert.equal(follower.ownerCalls.at(-1).enabled,true);
  assert.equal(follower.sounds.length,0,'ownership transfer retains the shared mute');
  const unmuted=await follower.send({type:'PC_MONITOR_ALERT_SETTINGS',settings:{muteUntil:0}});
  assert.equal(unmuted.ok,true);assert.equal(follower.sounds.length,1,'explicit shared unmute delivers the pending episode once');
  const deadline=follower.now()+20000;
  const snoozed={...item,snoozedUntil:deadline};
  await follower.snapshot({revision:6,clients:transferred,sessions:[session],incidents:[snoozed]});
  const local=await follower.context.pcAttentionGet();
  assert.equal(local.incidents.find(x=>!x.resolvedAt).snoozedUntil,deadline,'less than one minute remains an exact absolute deadline');
  const alarmName='project-constellation-attention-reminder';
  assert.equal(follower.alarms.get(alarmName).when,deadline);
  const ownershipCalls=follower.ownerCalls.length,settingsCalls=follower.settingsCalls.length;
  follower.advance(20000);
  for(let index=0;index<25;index++){
    follower.advance(200);
    await follower.snapshot({revision:7+index,clients:transferred,sessions:[session],incidents:[snoozed]});
  }
  assert.equal(follower.ownerCalls.length,ownershipCalls,'unchanged snapshots do not toggle ownership');
  assert.equal(follower.settingsCalls.length,settingsCalls,'unchanged policy does not rewrite browser settings');
  assert.equal(follower.alarms.get(alarmName).when,deadline,'high-frequency snapshots cannot push a due alarm forward');
  await follower.context.pcAttention.reminders();
  assert.equal(follower.sounds.length,2,'expired snooze still delivers once');
  assert.equal(follower.sent.filter(x=>x.op==='alert_settings').length,2,'mirrored local settings events do not feed back into native policy writes');
  await leader.monitor().disconnect();await follower.monitor().disconnect();
}

// Already-acknowledged remote incidents are imported while delivery is paused,
// so an owner cannot announce them before suppression is mirrored.
{
  const h=harness({realAttention:true,config:{browser:'chrome',profileId:'owner'}});await flush();await h.monitor().connect(true);
  const own=(await h.monitor().get()).clientId,remote='firefox:work:session';
  const session={sessionId:`${remote}:8`,clientId:remote,browser:'firefox',tabId:8,documentId:'acked-doc',runId:'acked-run',url:'https://chatgpt.com/c/acked',title:'Already reviewed',status:'error',connected:true,observedAt:h.now()};
  const item={incidentId:'acked-native',sessionId:session.sessionId,documentId:session.documentId,runId:session.runId,url:session.url,kind:'error',acknowledgedAt:h.now()-1000,snoozedUntil:null,resolvedAt:null};
  const begin=h.timeline.length;
  await h.snapshot({revision:2,clients:[{clientId:own,connected:true},{clientId:remote,connected:true}],sessions:[session],incidents:[item]});
  assert.equal(h.sounds.length,0);
  const order=h.timeline.slice(begin);
  assert.ok(order.findIndex(x=>x.type==='owner'&&!x.enabled)<order.findIndex(x=>x.type==='observe'));
  assert.ok(order.findIndex(x=>x.type==='incident-state')<order.findIndex(x=>x.type==='owner'&&x.enabled));
  await h.monitor().disconnect();
}

// A disconnected follower marks remote pending episodes offline before enabling
// standalone alerts, avoiding an announcement from stale remote observations.
{
  const h=harness({realAttention:true,config:{browser:'firefox',profileId:'follower'}});await flush();await h.monitor().connect(true);
  const own=(await h.monitor().get()).clientId,remote='chrome:owner:session';
  const session={sessionId:`${remote}:7`,clientId:remote,browser:'chrome',tabId:7,documentId:'remote-doc',runId:'run',url:'https://chatgpt.com/c/offline',status:'error',connected:true,observedAt:h.now()};
  await h.snapshot({revision:2,clients:[{clientId:own,connected:true},{clientId:remote,connected:true}],sessions:[session],incidents:[]});
  assert.equal(h.sounds.length,0);
  const begin=h.timeline.length;h.ports[0].fail();await flush();
  assert.equal(h.sounds.length,0);
  const order=h.timeline.slice(begin);
  assert.ok(order.findIndex(x=>x.type==='observe'&&x.status==='sensor-offline')<order.findIndex(x=>x.type==='owner'&&x.enabled));
  await h.monitor().disconnect();
}

// Same-document new runs cannot inherit a previous run's acknowledgement while
// native observations are catching up; leadership uses locale-independent ASCII.
{
  const h=harness({config:{browser:'chrome',profileId:'z'}});await flush();await h.monitor().connect(true);
  const own=(await h.monitor().get()).clientId;
  const session={sessionId:`${own}:9`,clientId:own,tabId:9,documentId:'same-doc',runId:'old-run',url:'https://chatgpt.com/c/same',status:'error',connected:true};
  h.attention.incidents.push({id:'new-run-local',sourceId:'local',tabId:9,documentId:session.documentId,runId:'new-run',url:session.url,kind:'error',resolvedAt:0});
  const item={incidentId:'native-old-run',sessionId:session.sessionId,documentId:session.documentId,runId:session.runId,url:session.url,kind:'error',acknowledgedAt:h.now(),resolvedAt:null};
  await h.snapshot({revision:2,clients:[{clientId:own,connected:true},{clientId:'chrome:Z:browser-session',connected:true}],sessions:[session],incidents:[item]});
  assert.equal(h.acknowledged.length,0);assert.equal(h.ownerCalls.at(-1).enabled,false,'uppercase Z sorts before lowercase z by protocol code points');
  await h.snapshot({revision:3,clients:[{clientId:own,connected:true}],sessions:[{...session,runId:'new-run'}],incidents:[{...item,incidentId:'native-new-run',runId:'new-run'}]});
  assert.deepEqual(h.acknowledged,['new-run-local']);await h.monitor().disconnect();
}

console.log('native-monitor-bridge.test.mjs: PASS (opt-in, UI boundary, shared policy, follower mute, ownership transfer, absolute snooze deadlines, staged acknowledgements, browser identity, stale events, bounded reconnect, window-bound shutdown/reopen, cancelled setup, honest refresh)');
