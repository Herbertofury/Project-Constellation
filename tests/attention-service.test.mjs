import assert from 'node:assert/strict';
await import('../extension/src/attention-service.js');
const core=globalThis.ProjectConstellationAttentionService;
const clone=(value)=>structuredClone(value);
let time=1_000_000;
let persisted={};
const notifications=[],sounds=[],alarms=new Map(),cleared=[];
let failSound=false;
const io={now:()=>time,read:async(key)=>clone(persisted[key]),write:async(key,value)=>{persisted[key]=clone(value);},
  notify:async(item)=>{notifications.push(clone(item));return {ok:true};},
  sound:async(options)=>{sounds.push(clone(options));return failSound?{ok:false,error:'Audio device blocked.'}:{ok:true,started:true};},
  alarm:async(name,when)=>alarms.set(name,when),clearAlarm:async(name)=>alarms.delete(name),
  clearNotification:async(id)=>cleared.push(id),focus:async(item)=>({ok:true,tabId:item.tabId})};
let service=core.createService(io);
const base={tabId:7,chatId:'chat-one',url:'https://chatgpt.com/c/chat-one?secret=do-not-store#fragment',title:'Build the project'};
const observe=(input={})=>service.observe({...base,...input,observedAt:time});
await service.start();
assert.equal(core.DEFAULTS.reminderMinutes,0,'default delivery is once per incident');

// Installing/restarting while a prompt is already open must still surface it.
await Promise.all(Array.from({length:20},()=>observe({status:'blocked-approval'})));
assert.equal(notifications.length,1,'concurrent same-episode observations deduplicate');
assert.equal(sounds.length,1);
let snapshot=await service.get();
let first=snapshot.incidents[0];
assert.equal(first.kind,'permission_required');
assert.equal(first.url,'https://chatgpt.com/c/chat-one','query strings and fragments are not stored');
assert.equal(first.delivery.notification,'accepted');
assert.equal(first.delivery.audio,'started');
assert.equal(snapshot.counts.open,1);
assert.equal(alarms.size,0,'no fixed polling or repeat alarm by default');

// Durable restart plus identical provider evidence produces no duplicate alarm.
service=core.createService(io);await service.start();assert.equal((await service.get()).sessions[0].status,'sensor-offline','stored state is not live evidence');time+=10_000;
await observe({status:'blocked-approval'});
assert.equal(notifications.length,1);
await service.acknowledge(first.id);
assert.equal((await service.get()).counts.acknowledged,1);
time+=600_000;await service.reminders();
assert.equal(notifications.length,1,'acknowledgment stops reminders without claiming provider recovery');
assert.equal((await service.get()).incidents[0].resolvedAt,0);

await observe({status:'running',healthState:'working',generation:{active:true}});
assert.ok((await service.get()).incidents[0].resolvedAt);
assert.ok(cleared.includes(first.id));
time+=2000;await observe({status:'blocked-approval'});
snapshot=await service.get();first=snapshot.incidents.at(-1);
assert.equal(notifications.length,2,'a later incident in the same chat receives a new alert');
assert.notEqual(snapshot.incidents[0].id,first.id);

// A user-requested snooze uses one durable deadline even with repeats disabled.
await service.snooze(first.id,10);
assert.equal(alarms.get(core.ALARM_NAME),time+600_000);
time+=599_000;await service.reminders();assert.equal(notifications.length,2);
time+=1000;await service.reminders();assert.equal(notifications.length,3);
assert.equal(alarms.size,0,'snooze expires once; it does not start a repeating loop');

// Frozen/discarded pages have unknown current evidence, never a fabricated recovery.
await service.settings({reminderMinutes:1});
await observe({status:'running',generation:{active:true}});time+=2000;
await observe({status:'errored'});let frozenIncident=(await service.get()).incidents.at(-1);
await observe({status:'errored',discarded:true});
assert.equal((await service.get()).sessions.at(-1).status,'suspended');
assert.equal((await service.get()).incidents.at(-1).resolvedAt,0);
assert.equal(alarms.size,0);
const countBefore=notifications.length;time+=120_000;await service.reminders();
assert.equal(notifications.length,countBefore);
await service.closeTab(7);assert.equal((await service.get()).incidents.at(-1).sourceClosed,true);
assert.equal((await service.focus(frozenIncident.id)).ok,false);

// Quiet work and an uncorroborated old running label cannot become an audible stall.
const other={...base,tabId:9,chatId:'quiet',url:'https://chatgpt.com/c/quiet'};
await service.observe({...other,status:'stalled',observedAt:time});
await service.observe({...other,status:'running',healthState:'uncertain-working',observedAt:time});
assert.equal(notifications.length,countBefore);
await service.observe({...other,status:'running',healthState:'tool-stalled',health:{proof:{sources:[{kind:'tool'},{kind:'generation'}]}},observedAt:time});
assert.equal(notifications.length,countBefore+1);

// Only one browser may deliver the shared broker incidents; other sensors keep state.
await service.setAudioOwner({enabled:false,reason:'Another connected browser owns alerts'});
await service.observe({...other,tabId:10,status:'blocked-approval',observedAt:time});
assert.equal(notifications.length,countBefore+1);
assert.equal((await service.get()).audioOwner.enabled,false);
await service.setAudioOwner({enabled:true});
assert.equal(notifications.length,countBefore+2,'new leader announces previously suppressed active incidents exactly once');
await service.setAudioOwner({enabled:true});assert.equal(notifications.length,countBefore+2);

// Report failed sound delivery, not optimistic success.
time+=2000;failSound=true;
await service.observe({...other,tabId:11,status:'rate-limited',observedAt:time});
assert.equal((await service.get()).incidents.at(-1).delivery.audio,'failed');
assert.match((await service.get()).incidents.at(-1).delivery.audioError,/blocked/);
const test=await service.test();
assert.equal(test.ok,false);assert.equal(test.notification.ok,true);assert.equal(test.audio.ok,false);
failSound=false;

// Completion sounds are opt-in and cannot mistake a newly opened idle chat for work.
await service.settings({completionEnabled:true,reminderMinutes:0});
const completedBefore=notifications.filter((x)=>x.kind==='completed').length;
await service.observe({...other,tabId:12,status:'idle',observedAt:time});
assert.equal(notifications.filter((x)=>x.kind==='completed').length,completedBefore);
await service.observe({...other,tabId:12,status:'running',observedAt:time});time+=2000;
await service.observe({...other,tabId:12,status:'idle',observedAt:time});
assert.equal(notifications.filter((x)=>x.kind==='completed').length,completedBefore+1);
assert.ok((await service.get()).incidents.at(-1).resolvedAt,'completion is recorded as history, not an unresolved problem');

// Navigation cannot let a stale notification focus the next conversation in a reused tab.
await service.observe({...other,tabId:13,status:'blocked-approval',observedAt:time});
const oldIncident=(await service.get()).incidents.at(-1);
await service.observe({...other,tabId:13,chatId:'different',url:'https://chatgpt.com/c/different',status:'idle',observedAt:time});
assert.equal((await service.focus(oldIncident.id)).ok,false);
assert.equal((await service.observe({...base,url:'javascript:alert(1)'})).ok,false);

// The native bridge must receive unchanged observations as well as transitions.
let observed=0;const unsubscribe=service.subscribe((event)=>{if(event.session)observed++;});
await observe({status:'idle'});await observe({status:'idle'});unsubscribe();
assert.equal(observed,2);

// A broker warning describes a visible observation gap, never a conclusive failure.
const remote={...other,sourceId:'native:firefox-sensor',tabId:81,status:'no_visible_progress',
  reason:'The provider still shows running; no visible progress signal has changed.',authoritative:true,observedAt:time};
const beforeWarning=notifications.length;
await service.observe(remote);
const warning=(await service.get()).incidents.at(-1);
assert.equal(warning.kind,'no_visible_progress');
assert.equal(warning.label,'No visible progress');
assert.equal(warning.severity,'warning');
assert.equal(notifications.length,beforeWarning+1);
await service.observe(remote);
assert.equal(notifications.length,beforeWarning+1,'the same broker warning is delivered once');
time+=24*60*60*1000;
await service.observe({...other,tabId:82,status:'running',generation:{quietForMs:24*60*60*1000},observedAt:time});
assert.equal(notifications.length,beforeWarning+1,'the browser adapter never invents a warning from elapsed quiet alone');

// An existing installation with more than 500 live agents loses none on load/save.
const retained=Array.from({length:550},(_,i)=>({key:`local:${i+1}`,tabId:i+1,status:'running'}));
const many=core.createService({read:async()=>({sessions:retained,incidents:retained.map((x)=>({id:x.key,resolvedAt:0}))}),write:async()=>{},clearAlarm:async()=>{}});
await many.start();await many.settings({audioEnabled:false});
assert.equal((await many.get()).sessions.length,550);assert.equal((await many.get()).incidents.length,550);

// Independent edge-case fixture: exercise delivery deadlines without wall timers.
function edgeFixture(){
  let clock=10_000_000,stored={};const events=[],audio=[],deadlines=new Map();
  const hooks={now:()=>clock,read:async()=>structuredClone(stored),write:async(_key,value)=>{stored=structuredClone(value);},
    notify:async(item)=>{events.push(structuredClone(item));return {ok:true};},sound:async(options)=>{audio.push(options);return {ok:true,started:true};},
    alarm:async(name,when)=>deadlines.set(name,when),clearAlarm:async(name)=>deadlines.delete(name),clearNotification:async()=>{}};
  const runtime=core.createService(hooks);
  return {runtime,hooks,events,audio,deadlines,now:()=>clock,advance:(ms)=>{clock+=ms;},
    observe:(row={})=>runtime.observe({tabId:1,url:'https://chatgpt.com/c/edge',title:'Edge case',status:'permission_required',runId:'run-1',observedAt:clock,...row})};
}
{
  const f=edgeFixture();await f.runtime.start();
  await f.runtime.settings({muteUntil:f.now()+60_000});
  await f.observe();assert.equal(f.events.length,0);
  assert.equal(f.deadlines.get(core.ALARM_NAME),f.now()+60_000,'first muted incident gets a wake deadline with repeat reminders disabled');
  f.advance(60_000);await f.runtime.reminders();assert.equal(f.events.length,1);assert.equal(f.audio.length,1);
  assert.equal(f.deadlines.size,0,'mute expiry announces once, without starting a repeat loop');
  const item=(await f.runtime.get()).incidents[0];
  await f.runtime.settings({maxReminders:0});await f.runtime.snooze(item.id,1);
  f.advance(60_000);await f.runtime.reminders();assert.equal(f.events.length,2,'explicit snooze wakes even when repeat cap is zero');
  assert.equal(f.deadlines.size,0);await f.runtime.reminders();assert.equal(f.events.length,2);
}
{
  const f=edgeFixture();await f.runtime.start();await f.runtime.settings({enabled:false});await f.observe();
  assert.equal(f.events.length,0);assert.equal(f.deadlines.size,0);
  await f.runtime.settings({enabled:true});assert.equal(f.events.length,1,'re-enabling announces still-current suppressed incidents without another DOM event');
  await f.runtime.acknowledge((await f.runtime.get()).incidents[0].id);
  await f.observe({runId:''});assert.equal(f.events.length,1,'partial observation cannot erase the incident run identity');
  f.advance(2000);await f.observe({runId:'run-2'});
  let rows=(await f.runtime.get()).incidents;
  assert.equal(f.events.length,2,'an acknowledgment in run 1 cannot silence the same problem in run 2');
  assert.equal(rows[0].resolution,'superseded-by-new-run');assert.equal(rows[1].acknowledgedAt,0);assert.equal(rows[1].runId,'run-2');
  await f.observe({runId:'run-2'});assert.equal(f.events.length,2,'same run remains deduplicated');
  await f.observe({status:'running',runId:'run-2'});f.advance(2000);await f.observe({runId:'run-3'});
  assert.equal(f.events.length,3,'a genuinely resolved prior episode permits a later incident');
}
{
  const f=edgeFixture();await f.runtime.start();await f.runtime.settings({audioEnabled:false,notificationsEnabled:false});await f.observe();
  assert.equal((await f.runtime.get()).incidents[0].notifiedAt,0,'both disabled channels are not falsely recorded as delivery');
  assert.equal(f.deadlines.size,0);await f.runtime.settings({notificationsEnabled:true});assert.equal(f.events.length,1);assert.equal(f.audio.length,0);
  await f.runtime.settings({muteUntil:f.now()+60_000,enabled:false});
  const receipt=await f.runtime.test();assert.equal(receipt.ok,true);assert.equal(receipt.mode,'explicit-diagnostic');
  assert.match(receipt.settingsNotice,/disabled/);assert.match(receipt.settingsNotice,/muted/);assert.match(receipt.settingsNotice,/sound is off/);
}
{
  const f=edgeFixture();await f.runtime.start();await f.runtime.settings({completionEnabled:true});
  await f.observe({status:'running'});
  await f.observe({status:'completed',healthState:'healthy',permission:{active:true}});
  let snap=await f.runtime.get();assert.equal(snap.sessions[0].kind,'permission_required');assert.equal(snap.incidents.length,1);assert.equal(snap.incidents[0].kind,'permission_required');
  const id=snap.incidents[0].id;
  await f.observe({status:'running',healthState:'working',permission:{active:true}});assert.equal(f.events.length,1,'a stale running label cannot clear or duplicate a visible permission incident');
  await f.observe({frozen:true});snap=await f.runtime.get();assert.equal(snap.incidents[0].resolvedAt,0);assert.equal(snap.sessions[0].suspended,true);
  await f.runtime.closeTab(1);snap=await f.runtime.get();assert.equal(snap.incidents[0].resolvedAt,0);assert.equal(snap.incidents[0].sourceClosed,true);assert.equal((await f.runtime.focus(id)).ok,false);
}
{
  const f=edgeFixture();await f.runtime.start();let calls=0;
  f.hooks.sound=async()=>{calls++;return calls===1?{ok:false,error:'Offscreen transport closed'}:{ok:true,started:true};};
  await f.observe();let snap=await f.runtime.get();assert.equal(snap.incidents[0].delivery.audio,'failed');assert.equal(snap.delivery.lastErrorAt,f.now());
  await f.observe({tabId:2,url:'https://chatgpt.com/c/another'});assert.equal(calls,2,'failed audio must not group/suppress the next incident as if a sound played');
  f.hooks.clearNotification=async()=>{throw new Error('OS notification unavailable');};
  const id=(await f.runtime.get()).incidents.at(-1).id;
  assert.equal((await f.runtime.acknowledge(id)).ok,true,'OS toast cleanup failure cannot lose the durable acknowledgment');
  assert.ok((await f.runtime.get()).incidents.at(-1).acknowledgedAt);
}
{
  const f=edgeFixture();await f.runtime.start();await f.observe();
  const id=(await f.runtime.get()).incidents[0].id;
  const deadline=f.now()+23_500;
  const result=await f.runtime.applyIncidentState(id,{acknowledgedAt:0,snoozedUntil:deadline});
  assert.equal(result.ok,true);assert.equal(result.incident.snoozedUntil,deadline);assert.equal(result.incident.nextReminderAt,deadline);
  assert.equal(f.deadlines.get(core.ALARM_NAME),deadline,'native snooze with less than one minute left keeps its absolute deadline');
  await f.runtime.setAudioOwner({enabled:false});f.advance(23_400);
  await f.runtime.setAudioOwner({enabled:true});assert.equal(f.events.length,1);assert.equal(f.deadlines.get(core.ALARM_NAME),deadline);
  for(let i=0;i<105;i++){f.advance(1);await f.runtime.setAudioOwner({enabled:true});}
  assert.equal(f.deadlines.get(core.ALARM_NAME),deadline,'unchanged owner snapshots cannot push an imminent or already-due alarm forward');
  await f.runtime.setAudioOwner({enabled:false});await f.runtime.setAudioOwner({enabled:true});
  assert.equal(f.events.length,2,'legitimate ownership transfer immediately delivers an expired snooze');assert.equal(f.deadlines.size,0);
  assert.equal((await f.runtime.applyIncidentState(id,{acknowledgedAt:0,snoozedUntil:deadline})).unchanged,true);
  assert.equal(f.events.length,2,'same expired native snooze cannot replay after local delivery');
  const restarted=core.createService(f.hooks);await restarted.start();
  await restarted.observe({tabId:1,url:'https://chatgpt.com/c/edge',title:'Edge case',status:'permission_required',runId:'run-1',observedAt:f.now()});
  assert.equal((await restarted.applyIncidentState(id,{acknowledgedAt:0,snoozedUntil:deadline})).unchanged,true);
  assert.equal(f.events.length,2,'source token remains idempotent through worker restart');
}
{
  const f=edgeFixture();await f.runtime.start();await f.observe();const id=(await f.runtime.get()).incidents[0].id;
  let cleared=0;f.hooks.clearNotification=async()=>{cleared++;};
  await f.runtime.applyIncidentState(id,{acknowledgedAt:0,snoozedUntil:0});assert.equal(cleared,0,'native baseline must not erase a newly delivered toast');
  const acknowledgedAt=f.now();let result=await f.runtime.applyIncidentState(id,{acknowledgedAt,snoozedUntil:0});
  assert.equal(result.incident.acknowledgedAt,acknowledgedAt);assert.equal(result.incident.nextReminderAt,0);assert.equal(f.deadlines.size,0);
  const deadline=f.now()+500;result=await f.runtime.applyIncidentState(id,{acknowledgedAt:0,snoozedUntil:deadline});
  assert.equal(result.incident.acknowledgedAt,0);assert.equal(result.incident.nextReminderAt,deadline);assert.equal(f.deadlines.get(core.ALARM_NAME),deadline,'acknowledgment-to-snooze transition preserves a sub-second deadline');
  f.advance(501);await f.runtime.reminders();assert.equal(f.events.length,2);assert.equal(f.deadlines.size,0);
  const invalid=[true,false,'123',-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,f.now()+8*86400000];
  for(const value of invalid)assert.equal((await f.runtime.applyIncidentState(id,{acknowledgedAt:0,snoozedUntil:value})).ok,false,`reject invalid native timestamp ${value}`);
  assert.equal((await f.runtime.applyIncidentState(id,{acknowledgedAt:f.now(),snoozedUntil:f.now()+1000})).ok,false);
  assert.equal((await f.runtime.applyIncidentState(id,{acknowledgedAt:false,snoozedUntil:0})).ok,false);
  assert.equal((await f.runtime.applyIncidentState(id,{acknowledgedAt:f.now()+6*60000,snoozedUntil:0})).ok,false);
  assert.equal((await f.runtime.applyIncidentState(id,{enabled:true})).ok,false);
  assert.equal((await f.runtime.applyIncidentState(id,null)).ok,false);
  assert.equal(f.events.length,2,'invalid control metadata creates no delivery or state transition');
  result=await f.runtime.applyIncidentState(id,{acknowledgedAt:0,snoozedUntil:f.now()-1000});
  assert.equal(result.ok,true);assert.equal(f.events.length,3,'a newly mirrored past-due native snooze delivers immediately');assert.equal(f.deadlines.size,0);
}
{
  const f=edgeFixture();await f.runtime.start();await f.runtime.settings({reminderMinutes:1,maxReminders:1});await f.observe();
  await f.runtime.setAudioOwner({enabled:false});f.advance(60_001);await f.runtime.setAudioOwner({enabled:true});
  assert.equal(f.events.length,2,'ownership transfer also flushes a due bounded repeat reminder');
  assert.equal((await f.runtime.get()).incidents[0].reminders,1);assert.equal(f.deadlines.size,0);
  await f.runtime.setAudioOwner({enabled:false});await f.runtime.setAudioOwner({enabled:true});assert.equal(f.events.length,2,'ownership changes do not reset the repeat cap');
}
console.log('attention-service.test.mjs: PASS (restart, dedup, run episodes, mute/settings wake, absolute native state, snooze, priority, suspension, receipts, ownership, completion, retention)');
