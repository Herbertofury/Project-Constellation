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
{
  const f=edgeFixture();await f.runtime.start();let audioAttempts=0;
  f.hooks.sound=async()=>++audioAttempts===1?{ok:false,error:'Offscreen audio surface closed'}:{ok:true,started:true};
  await f.observe();const first=(await f.runtime.get()).incidents[0];
  assert.equal(first.delivery.audio,'failed');
  assert.equal(f.deadlines.get(core.ALARM_NAME),f.now()+2000,'a failed first channel gets a bounded recovery deadline with reminders disabled');
  assert.equal(first.delivery.attempt,1);
  f.advance(1999);await f.runtime.reminders();assert.equal(audioAttempts,1);
  f.advance(1);await f.runtime.reminders();
  const repaired=(await f.runtime.get()).incidents[0];
  assert.equal(audioAttempts,2);assert.equal(f.events.length,1,'successful notifications are not replayed while recovering audio');
  assert.equal(repaired.delivery.notification,'accepted');assert.equal(repaired.delivery.audio,'started');
  assert.equal(repaired.delivery.attempt,2);assert.equal(repaired.delivery.retryAt,0);assert.equal(f.deadlines.size,0);
  assert.equal(repaired.reminders,0,'channel recovery does not consume or enable repeat reminders');
  assert.equal((await f.runtime.get()).delivery.lastError,'');
}
{
  const f=edgeFixture();await f.runtime.start();const write=f.hooks.write;let writes=0;
  f.hooks.write=async(...args)=>{if(++writes===2)throw new Error('Storage rejected the delivery claim');return write(...args);};
  await assert.rejects(f.observe(),/Storage rejected/);
  assert.equal(f.events.length,0);assert.equal(f.audio.length,0);
  assert.equal((await f.runtime.get()).incidents[0].notifiedAt,0,'a failed pre-delivery write cannot claim an untouched alert was announced');
  await f.observe();assert.equal(f.events.length,1);assert.equal(f.audio.length,1);
  assert.equal((await f.runtime.get()).incidents.length,1,'retrying persistence retains the same incident episode');
}
{
  const f=edgeFixture();await f.runtime.start();const write=f.hooks.write;let writes=0;
  f.hooks.write=async(...args)=>{if(++writes===3)throw new Error('Storage rejected the audio claim');return write(...args);};
  await f.observe();assert.equal(f.events.length,1);assert.equal(f.audio.length,0);
  const failed=(await f.runtime.get()).incidents[0];assert.equal(failed.delivery.notification,'accepted');assert.equal(failed.delivery.audio,'failed');
  f.advance(2000);await f.runtime.reminders();assert.equal(f.events.length,1);assert.equal(f.audio.length,1,'a failed pre-audio claim recovers only audio without duplicating the accepted notification');
}
{
  const f=edgeFixture();await f.runtime.start();let notificationAttempts=0;
  f.hooks.notify=async(item)=>{f.events.push(structuredClone(item));return ++notificationAttempts===1?{ok:false,error:'OS notification temporarily unavailable'}:{ok:true};};
  await f.observe();assert.equal(f.audio.length,1);
  // A worker restart preserves failed-channel identity and the original retry
  // budget, but fresh provider evidence is still required before delivery.
  const restarted=core.createService(f.hooks);await restarted.start();
  f.advance(2000);await restarted.reminders();assert.equal(notificationAttempts,1);assert.equal(f.deadlines.size,0);
  await restarted.observe({tabId:1,url:'https://chatgpt.com/c/edge',status:'permission_required',runId:'run-1',observedAt:f.now()});
  await restarted.reminders();
  assert.equal(notificationAttempts,2);assert.equal(f.audio.length,1,'accepted audio is not replayed after a restart or toast-only retry');
  assert.equal((await restarted.get()).incidents[0].delivery.attempt,2);assert.equal(f.deadlines.size,0);
}
{
  const f=edgeFixture();await f.runtime.start();let audioAttempts=0,notificationAttempts=0;
  f.hooks.notify=async()=>{notificationAttempts++;return {ok:false,error:'Notifications denied'};};
  f.hooks.sound=async()=>{audioAttempts++;return {ok:false,error:'Audio is blocked'};};
  await f.observe();
  for(const delay of [2000,10000,30000]){assert.equal(f.deadlines.get(core.ALARM_NAME),f.now()+delay);f.advance(delay);await f.runtime.reminders();}
  assert.equal(audioAttempts,4);assert.equal(notificationAttempts,4);assert.equal(f.deadlines.size,0,'permanent channel failure cannot cause an endless alarm loop');
  let snap=await f.runtime.get();assert.equal(snap.incidents[0].delivery.retryExhausted,true);assert.equal(snap.incidents[0].delivery.retryAt,0);assert.match(snap.delivery.lastError,/retries are exhausted/);
  f.advance(86400000);await f.runtime.reminders();await f.observe();assert.equal(audioAttempts,4,'unchanged evidence cannot reset an exhausted retry budget');
}
{
  const f=edgeFixture();await f.runtime.start();let attempts=0;
  f.hooks.sound=async()=>{attempts++;return {ok:false,error:'Audio transport failed'};};
  await f.observe();const id=(await f.runtime.get()).incidents[0].id;
  await f.runtime.settings({muteUntil:f.now()+10000});assert.equal(f.deadlines.get(core.ALARM_NAME),f.now()+10000);
  await f.runtime.setAudioOwner({enabled:false});f.advance(10001);await f.runtime.reminders();assert.equal(attempts,1);
  await f.runtime.setAudioOwner({enabled:true});assert.equal(attempts,2,'the new delivery owner resumes only the failed channel');assert.equal(f.events.length,1);
  await f.runtime.snooze(id,1);f.advance(20000);await f.runtime.reminders();assert.equal(attempts,2,'an explicit snooze supersedes channel retry deadlines');
  await f.runtime.acknowledge(id);f.advance(60000);await f.runtime.reminders();assert.equal(attempts,2);assert.equal(f.deadlines.size,0);
}
{
  const f=edgeFixture();await f.runtime.start();const cleared=[];f.hooks.clearNotification=async(id)=>cleared.push(id);
  await f.observe({documentId:'previous-document'});const old=(await f.runtime.get()).incidents[0];
  const previousAt=f.now();f.advance(1000);
  await f.observe({documentId:'new-document',url:'https://chatgpt.com/c/new',runId:'new-run'});
  const before=await f.runtime.get();
  assert.ok(cleared.includes(old.id),'navigation clears the old incident toast as well as its focus target');
  const result=await f.observe({documentId:'previous-document',observedAt:previousAt,status:'running'});
  assert.equal(result.ignored,'out-of-order','an old document cannot retire the current tab session');
  const after=await f.runtime.get();assert.deepEqual(after.sessions,before.sessions);assert.deepEqual(after.incidents,before.incidents);
  for(const tabId of [NaN,Infinity,'bad',1.5,Number.MAX_SAFE_INTEGER+1])assert.equal((await f.observe({tabId})).ok,false,'malformed tab IDs cannot enter durable state');
}
// A rejected journal write must not make a duplicate look durably accepted.
{
  const f=edgeFixture();await f.runtime.start();const write=f.hooks.write;let fail=true;
  f.hooks.write=async(...args)=>{if(fail){fail=false;throw new Error('Journal unavailable');}return write(...args);};
  await assert.rejects(f.observe({status:'running'}),/Journal unavailable/);
  assert.equal((await f.hooks.read()).sessions,undefined);
  f.advance(10);assert.equal((await f.observe({status:'running'})).ok,true);
  const stored=await f.hooks.read();assert.equal(stored.sessions[0].status,'running');assert.equal(stored.sessions[0].observedAt,f.now());
  assert.equal((await core.createService(f.hooks).get()).sessions[0].observedAt,f.now(),'the successful retry survives a fresh service instance');
  await f.observe({status:'permission_required'});f.advance(100);fail=true;
  await assert.rejects(f.observe({status:'running'}),/Journal unavailable/);
  f.advance(10);await f.observe({status:'running'});
  assert.ok((await f.hooks.read()).incidents[0].resolvedAt,'retrying the same clear state persists the resolution after an earlier failed write');
}
{
  const f=edgeFixture();await f.runtime.start();await f.runtime.settings({audioEnabled:false,notificationsEnabled:false});
  const write=f.hooks.write;let writes=0;f.hooks.write=async(...args)=>{writes++;return write(...args);};
  await f.observe({status:'error'});const announced=f.events.length;
  f.advance(50);await f.observe({status:'error'});
  assert.equal((await f.hooks.read()).sessions[0].observedAt,f.now(),'an acknowledged advancing watermark must survive worker termination without a later mutation');
  const savedWrites=writes;await f.observe({status:'error'});
  assert.equal(writes,savedWrites,'an exact already-durable duplicate does not repeat the storage write');
  assert.equal(f.events.length,announced,'ordering-only persistence cannot create another alert');
  const restarted=core.createService(f.hooks);await restarted.start();f.advance(10);
  const reply=await restarted.observe({tabId:1,url:'https://chatgpt.com/c/edge',title:'Edge case',status:'running',runId:'run-1',observedAt:f.now()-30});
  assert.equal(reply.ignored,'out-of-order');
  assert.equal((await restarted.get()).incidents[0].resolvedAt,0,'an older clearance cannot resolve the newly acknowledged issue after restart');
}
{
  const f=edgeFixture();await f.runtime.start();await f.runtime.settings({audioEnabled:false,notificationsEnabled:false});
  await f.observe({status:'error'});f.advance(10);
  await f.observe({status:'running',authoritative:false});
  assert.equal((await f.hooks.read()).incidents[0].resolvedAt,0,'uncorroborated clear evidence cannot resolve the issue');
  await f.observe({status:'running',authoritative:true});
  const saved=await f.hooks.read();
  assert.equal(saved.sessions[0].authoritative,true,'a same-timestamp authority change is a durable observation change');
  assert.equal(saved.incidents[0].resolvedAt,f.now(),'the resulting same-timestamp resolution survives restart');
}
for(const action of ['acknowledge','snooze']){
  const f=edgeFixture();await f.runtime.start();await f.observe();
  const id=(await f.runtime.get()).incidents[0].id;f.advance(50);
  const patch=action==='acknowledge'?{acknowledgedAt:f.now(),snoozedUntil:0}:{acknowledgedAt:0,snoozedUntil:f.now()+5000};
  const write=f.hooks.write;let fail=true,writes=0;
  f.hooks.write=async(...args)=>{if(fail){fail=false;throw new Error('Mirrored-state journal unavailable');}writes++;return write(...args);};
  await assert.rejects(f.runtime.applyIncidentState(id,patch),/Mirrored-state journal unavailable/);
  assert.equal((await f.hooks.read()).incidents[0].mirroredState,undefined);
  assert.equal((await f.runtime.applyIncidentState(id,patch)).ok,true);
  const saved=(await f.hooks.read()).incidents[0];assert.deepEqual(saved.mirroredState,patch,'an identical retry must save the native suppression state before claiming success');
  assert.equal(saved.acknowledgedAt,patch.acknowledgedAt);assert.equal(saved.snoozedUntil,patch.snoozedUntil);
  assert.equal(f.deadlines.get(core.ALARM_NAME),patch.snoozedUntil||undefined,'a recovered mirrored write also establishes its correct alarm');
  const savedWrites=writes;await f.runtime.applyIncidentState(id,patch);assert.equal(writes,savedWrites,'an already-durable mirrored token remains idempotent');
}
// Lifecycle work is scoped to the row which was inspected, and close establishes
// an ordering tombstone so a delayed message cannot reopen a removed document.
{
  const f=edgeFixture();await f.runtime.start();await f.observe({documentId:'document-a',status:'running'});
  const captured=(await f.runtime.get()).sessions[0];f.advance(50);
  await f.observe({documentId:'document-a',runId:'run-2'});
  assert.equal((await f.runtime.closeTab(1,'local',captured)).ignored,'session-changed');
  assert.equal((await f.runtime.observe({...captured,status:'suspended',observedAt:f.now()},captured)).ignored,'session-changed');
  assert.equal((await f.runtime.get()).sessions[0].status,'permission_required');
  f.advance(100);await f.runtime.closeTab(1);const closed=(await f.runtime.get()).sessions[0];
  assert.equal(closed.observedAt,f.now());assert.equal(closed.closedAt,f.now());
  const announced=f.events.length;
  assert.ok((await f.observe({documentId:'document-a',runId:'run-2',observedAt:f.now()-1})).ignored);
  assert.ok((await f.observe({documentId:'document-a',runId:'run-2',observedAt:f.now()})).ignored);
  assert.equal((await f.runtime.get()).sessions[0].status,'closed');assert.equal(f.events.length,announced);
  f.advance(1);await f.observe({documentId:'document-b',runId:'run-3'});
  const before=await f.runtime.get();f.advance(20);
  assert.equal((await f.observe({documentId:'document-a',runId:'run-2',status:'closed'})).ignored,'stale-close');
  assert.deepEqual((await f.runtime.get()).sessions,before.sessions,'a newer timestamp cannot turn an obsolete-document close into authority over the new document');
}
{
  const f=edgeFixture();await f.runtime.start();
  await f.observe({documentId:'previous-document'});
  await f.observe({documentId:'current-document',url:'https://chatgpt.com/c/current'});
  const current=(await f.runtime.get()).sessions.find(row=>row.documentId==='current-document');
  const result=await f.runtime.observe({...current,status:'suspended'},current);
  assert.equal(result.ignored,undefined,'equal-millisecond navigation selects the most recently accepted document for scoped lifecycle work');
  assert.equal(result.session.status,'suspended');
}
// Simulate termination after the durable delivery claim, before either channel
// confirms success. Recovery waits for fresh evidence, keeps the same toast ID,
// and resumes only the channels which have not started.
{
  const f=edgeFixture();await f.runtime.start();const notify=f.hooks.notify;let awaitingNotification=false;
  f.hooks.notify=()=>{awaitingNotification=true;return new Promise(()=>{});};
  void f.observe({documentId:'interrupted'});
  for(let i=0;i<20&&!awaitingNotification;i++)await new Promise(setImmediate);
  assert.equal(awaitingNotification,true);const interrupted=await f.hooks.read();
  assert.equal(interrupted.incidents[0].delivery.notification,'pending');assert.equal(interrupted.incidents[0].delivery.audio,'pending');
  f.hooks.notify=notify;f.advance(2000);const restarted=core.createService(f.hooks);await restarted.start();
  assert.equal(f.deadlines.size,0,'recovered journal data remains offline until fresh provider evidence');
  await restarted.observe({...interrupted.sessions[0],observedAt:f.now()});await restarted.reminders();
  const recovered=(await restarted.get()).incidents[0];
  assert.equal(f.events.length,1);assert.equal(f.audio.length,1);assert.equal(f.events[0].id,interrupted.incidents[0].id);
  assert.equal(recovered.delivery.attempt,2);assert.equal(recovered.delivery.notification,'accepted');assert.equal(recovered.delivery.audio,'started');
  assert.equal(f.deadlines.size,0);
}
// A claimed sound may already have played before the worker vanished. Preserve
// uncertainty instead of ringing again or reporting an invented successful receipt.
for(const legacyPendingClaim of [false,true]) {
  const f=edgeFixture();await f.runtime.start();const sound=f.hooks.sound;let audioCalls=0;
  f.hooks.sound=()=>{audioCalls++;return new Promise(()=>{});};void f.observe({documentId:'audio-interrupted'});
  for(let i=0;i<20&&!audioCalls;i++)await new Promise(setImmediate);
  assert.equal(audioCalls,1);const interrupted=await f.hooks.read();assert.equal(interrupted.incidents[0].delivery.audio,'claimed');
  if(legacyPendingClaim){interrupted.incidents[0].delivery.audio='pending';await f.hooks.write(core.STORAGE_KEY,interrupted);}
  f.hooks.sound=sound;f.advance(3000);const restarted=core.createService(f.hooks);await restarted.start();
  await restarted.observe({...interrupted.sessions[0],observedAt:f.now()});await restarted.reminders();
  const recovered=await restarted.get();assert.equal(recovered.incidents[0].delivery.audio,'interrupted');
  assert.match(recovered.delivery.lastError,/interrupted after its playback claim/);assert.equal(f.events.length,1);assert.equal(f.audio.length,0);
  assert.equal(f.deadlines.size,0,'uncertain sound is neither automatically replayed nor reported as started');
  const diagnostic=await restarted.test();assert.equal(diagnostic.audio.started,true);assert.equal(f.audio.length,1,'an explicit diagnostic still tests real delivery');
  assert.equal((await restarted.get()).incidents[0].delivery.audio,'interrupted','a later diagnostic does not rewrite the historical uncertain receipt');
}
{
  const f=edgeFixture();await f.runtime.start();await f.observe();const stored=await f.hooks.read();
  stored.incidents[0].delivery.notification='pending';stored.incidents[0].delivery.attempt=4;await f.hooks.write(core.STORAGE_KEY,stored);
  const restarted=core.createService(f.hooks);await restarted.start();f.advance(5000);
  await restarted.observe({...stored.sessions[0],observedAt:f.now()});await restarted.reminders();
  assert.equal(f.events.length,1);assert.equal((await restarted.get()).incidents[0].delivery.retryExhausted,true,'worker termination cannot reset an exhausted delivery budget');
}
// Group sound from its actual durable playback claim, not from the beginning of
// a notification request which may take seconds to complete.
{
  const f=edgeFixture();await f.runtime.start();const notify=f.hooks.notify;let delayed=true;
  f.hooks.notify=async(item)=>{if(delayed){delayed=false;f.advance(5000);}return notify(item);};
  await f.observe();const soundAt=f.now();f.advance(50);await f.observe({tabId:2});
  assert.equal(f.events.length,2,'both current incidents retain their own notification');
  assert.equal(f.audio.length,1,'two sounds cannot overlap after the first notification took longer than the grouping window');
  const saved=await f.hooks.read();assert.equal(saved.delivery.lastAudioAt,soundAt);
  assert.equal(saved.incidents[1].delivery.audio,'grouped-or-disabled');
}
{
  const f=edgeFixture();await f.runtime.start();let calls=0;
  f.hooks.sound=async()=>{calls++;return {ok:false,interrupted:true,error:'Playback may have started but its reply was lost.'};};
  await f.observe();f.advance(60000);await f.runtime.reminders();await f.observe();
  const saved=await f.hooks.read();assert.equal(calls,1,'an ambiguous playback outcome is never treated as a safe automatic retry');
  assert.equal(saved.incidents[0].delivery.audio,'interrupted');assert.equal(saved.incidents[0].delivery.retryAt,0);
  assert.match(saved.delivery.lastError,/reply was lost/);assert.equal(f.deadlines.size,0);
}
// A one-shot alarm must recover a rejected durable claim without silently using
// the last reminder. Permanent storage failure still has a finite retry budget.
{
  const f=edgeFixture();await f.runtime.start();await f.runtime.settings({reminderMinutes:1,maxReminders:1});await f.observe();
  const write=f.hooks.write;let fail=true;f.hooks.write=async(...args)=>{if(fail){fail=false;throw new Error('Reminder journal unavailable');}return write(...args);};
  f.advance(60000);await assert.rejects(f.runtime.reminders(),/Reminder journal unavailable/);
  assert.equal((await f.runtime.get()).incidents[0].reminders,0,'an untouched reminder retains its budget after a failed claim');
  assert.equal(f.deadlines.get(core.ALARM_NAME),f.now()+2000,'the consumed one-shot alarm gets one bounded persistence-recovery deadline');
  f.advance(2000);await f.runtime.reminders();
  assert.equal(f.events.length,2);assert.equal((await f.hooks.read()).incidents[0].reminders,1);assert.equal(f.deadlines.size,0);
  f.advance(60000);await f.runtime.reminders();assert.equal(f.events.length,2,'storage recovery does not raise the configured repeat cap');
}
{
  const f=edgeFixture();await f.runtime.start();await f.runtime.settings({reminderMinutes:1,maxReminders:1});await f.observe();
  f.hooks.write=async()=>{throw new Error('Storage remains unavailable');};f.advance(60000);
  for(const delay of [2000,10000,30000,0]){
    await assert.rejects(f.runtime.reminders(),/Storage remains unavailable/);
    assert.equal((await f.runtime.get()).incidents[0].reminders,0);assert.equal(f.events.length,1);
    if(delay){assert.equal(f.deadlines.get(core.ALARM_NAME),f.now()+delay);f.advance(delay);}
    else assert.equal(f.deadlines.size,0,'permanent persistence failure cannot create an endless alarm loop');
  }
  assert.match((await f.runtime.get()).delivery.lastError,/persistence retries are exhausted/);
  await f.runtime.setAudioOwner({enabled:true});await f.runtime.setAudioOwner({enabled:false});await f.runtime.setAudioOwner({enabled:true});
  assert.equal(f.deadlines.size,0,'routine native ownership refresh and transfer cannot restart an exhausted storage-recovery loop');
  assert.equal(f.events.length,1);
}
{
  const f=edgeFixture();await f.runtime.start();await f.observe({status:'running'});
  const captured=(await f.runtime.get()).sessions[0],write=f.hooks.write;let fail=true;
  f.hooks.write=async(...args)=>{if(fail){fail=false;throw new Error('Close journal unavailable');}return write(...args);};f.advance(10);
  await assert.rejects(f.runtime.closeTab(1,'local',captured),/Close journal unavailable/);
  const retry=await f.runtime.closeTab(1,'local',captured);assert.equal(retry.ok,true);
  assert.equal((await f.hooks.read()).sessions[0].status,'closed','a scoped retry cannot return success while the accepted close remains only in memory');
  const restarted=core.createService(f.hooks);await restarted.start();assert.equal((await restarted.get()).sessions[0].status,'closed');
}
{
  const f=edgeFixture();await f.observe({status:'running'});const write=f.hooks.write;let fail=true,writes=0;
  f.hooks.write=async(...args)=>{if(fail){fail=false;throw new Error('Startup journal unavailable');}writes++;return write(...args);};
  const restarted=core.createService(f.hooks);await assert.rejects(restarted.start(),/Startup journal unavailable/);
  await restarted.start();const saved=await f.hooks.read();assert.equal(saved.sessions[0].status,'sensor-offline');
  assert.equal(saved.sessions[0].lastKnownStatus,'running','retrying startup preserves the original last-known provider status');
  const savedWrites=writes;await restarted.start();assert.equal(writes,savedWrites,'a successfully persisted repeated start remains read-only');
}
for(const legacyJournal of [false,true]){
  const f=edgeFixture();await f.runtime.start();await f.observe();const id=(await f.runtime.get()).incidents[0].id;
  await f.runtime.acknowledge(id);let runtime=f.runtime;
  if(legacyJournal){const saved=await f.hooks.read();delete saved.incidents[0].authoritative;await f.hooks.write(core.STORAGE_KEY,saved);runtime=core.createService(f.hooks);await runtime.start();}
  f.advance(10);await runtime.observe({tabId:1,url:'https://chatgpt.com/c/edge',runId:'unconfirmed-run',status:'error',authoritative:false,source:'scripting-dom-probe',observedAt:f.now()});
  let snapshot=await runtime.get();assert.equal(snapshot.incidents.length,1,'weak evidence cannot supersede a confirmed permission episode');
  assert.equal(snapshot.incidents[0].resolvedAt,0);assert.ok(snapshot.incidents[0].acknowledgedAt);assert.equal(snapshot.incidents[0].runId,'run-1');
  assert.equal(snapshot.sessions[0].authoritative,false);assert.equal(snapshot.sessions[0].suspended,true,'the uncertain current row is explicit while the original incident stays intact');
  assert.equal(f.events.length,1);
  f.advance(10);await runtime.observe({tabId:1,url:'https://chatgpt.com/c/edge',runId:'run-1',status:'permission_required',observedAt:f.now()});
  snapshot=await runtime.get();assert.equal(snapshot.incidents.length,1,'returning confirmed evidence is compared to the confirmed run, not the intervening weak run');
  assert.equal(snapshot.incidents[0].id,id);assert.ok(snapshot.incidents[0].acknowledgedAt);assert.equal(snapshot.incidents[0].suspended,false);assert.equal(f.events.length,1);
}
{
  const f=edgeFixture();await f.runtime.start();await f.observe({status:'error',authoritative:false,runId:'weak-probe-label'});const id=(await f.runtime.get()).incidents[0].id;
  assert.equal((await f.runtime.get()).incidents[0].authoritative,false,'new weak evidence remains identified as such');
  await f.runtime.acknowledge(id);f.advance(10);await f.observe({status:'error',authoritative:true,runId:'confirmed-provider-run'});
  const snapshot=await f.runtime.get();assert.equal(snapshot.incidents.length,1);assert.equal(snapshot.incidents[0].id,id);assert.equal(snapshot.incidents[0].authoritative,true);
  assert.ok(snapshot.incidents[0].acknowledgedAt);assert.equal(snapshot.incidents[0].runId,'confirmed-provider-run','untrusted run labels cannot reset owner suppression when confirmed identity arrives');
  assert.equal(f.events.length,1,'stronger confirmation upgrades the existing episode without replaying its first alert');
}
console.log('attention-service.test.mjs: PASS (restart, dedup, run episodes, durable retry recovery, uncertain playback, sound grouping, bounded reminder persistence, scoped lifecycle ordering, mute/settings wake, absolute native state, channel recovery, snooze, priority, suspension, ownership, navigation, completion, retention)');
