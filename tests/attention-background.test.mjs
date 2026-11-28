import assert from 'node:assert/strict';
const values={},messages=[],created=[],focused=[],removed=[],alarmListeners=[],tabRemoved=[],tabUpdated=[];
let contexts=[],creates=0,playback=0,permission='granted',url='https://chatgpt.com/c/one';
globalThis.chrome={
  runtime:{id:'test-extension',getURL:(path)=>`chrome-extension://test-extension/${path}`,
    getContexts:async()=>contexts,onMessage:{addListener:(fn)=>messages.push(fn)},
    sendMessage:async(message)=>{if(message.target==='pc-attention-audio'){playback++;return {ok:true,started:true,backend:'offscreen-web-audio'};}return {ok:true};}},
  storage:{local:{get:async(key)=>({[key]:values[key]}),set:async(value)=>Object.assign(values,structuredClone(value))}},
  offscreen:{createDocument:async(options)=>{creates++;assert.ok(options.reasons.includes('AUDIO_PLAYBACK'));contexts=[{documentUrl:'chrome-extension://test-extension/offscreen.html'}];}},
  alarms:{create:async()=>{},clear:async()=>{},onAlarm:{addListener:(fn)=>alarmListeners.push(fn)}},
  notifications:{getPermissionLevel:async()=>permission,create:async(id,options)=>{created.push({id,options});return id;},clear:async(id)=>removed.push(id),onClicked:{addListener:()=>{}},onButtonClicked:{addListener:()=>{}}},
  tabs:{get:async(id)=>({id,url,windowId:2}),update:async(id,options)=>{focused.push({id,options});},sendMessage:async()=>({ok:true}),onRemoved:{addListener:(fn)=>tabRemoved.push(fn)},onUpdated:{addListener:(fn)=>tabUpdated.push(fn)}},
  windows:{update:async()=>{}}
};
await import('../extension/src/attention-background.js');
const service=globalThis.pcAttention;
await service.start();
const send=(message,sender)=>new Promise((resolve)=>{
  for(const fn of messages){if(fn(message,sender,resolve)===true)return;}
});
const ui={id:'test-extension',url:'chrome-extension://test-extension/agent-monitor.html'};
const page={id:'test-extension',url:'https://chatgpt.com/c/one',tab:{id:7,url}};
let reply=await send({type:'PC_ATTENTION_SETTINGS',settings:{audioEnabled:false}},page);
assert.equal(reply.ok,false,'provider scripts cannot mute the monitor or use control messages');
assert.equal((await service.get()).settings.audioEnabled,true);
reply=await send({type:'PC_ATTENTION_GET'},ui);assert.equal(reply.ok,true);
reply=await send({type:'PC_ATTENTION_APPLY_INCIDENT_STATE',id:'any',acknowledgedAt:1,snoozedUntil:0},ui);
assert.equal(reply.ok,false);assert.match(reply.error,/Unknown attention control/,'trusted native state mirroring has no UI or provider runtime-message route');
await service.observe({tabId:7,url,title:'Task',status:'blocked-approval'});
assert.equal(created.length,1);assert.equal(playback,1);assert.equal(creates,1);
assert.equal(created[0].options.silent,true,'OS default sound and configured WebAudio must not double-ring');
assert.match(created[0].options.iconUrl,/\.png$/,'notification icons are raster assets accepted by browser APIs');
const incident=(await service.get()).incidents[0];
reply=await send({type:'PC_ATTENTION_FOCUS',id:incident.id},ui);assert.equal(reply.ok,true);
assert.equal(focused.length,1);
url='https://chatgpt.com/c/other';
reply=await send({type:'PC_ATTENTION_FOCUS',id:incident.id},ui);assert.equal(reply.ok,false);
assert.equal(focused.length,1,'tab ID reuse cannot focus a different conversation');
reply=await send({type:'PC_ATTENTION_TEST'},ui);assert.equal(reply.ok,true);
assert.equal(reply.audio.ok,true);assert.equal(reply.notification.ok,true);assert.equal(creates,1,'offscreen document is shared and reused');
contexts=[];
reply=await send({type:'PC_ATTENTION_TEST'},ui);assert.equal(reply.ok,true);assert.equal(creates,2,'a retired silent offscreen document is recreated on the next explicit alert');
const normalRuntimeSend=chrome.runtime.sendMessage;let lostDuringSend=true;
chrome.runtime.sendMessage=async(message)=>{
  if(lostDuringSend&&message.target==='pc-attention-audio'){lostDuringSend=false;contexts=[];throw new Error('Receiving end does not exist');}
  return normalRuntimeSend(message);
};
reply=await send({type:'PC_ATTENTION_TEST'},ui);assert.equal(reply.ok,true);assert.equal(creates,3,'offscreen closure between lookup and playback retries once with a new document');
chrome.runtime.sendMessage=async()=>({ok:true});
reply=await send({type:'PC_ATTENTION_TEST'},ui);assert.equal(reply.ok,false);assert.match(reply.audio.error,/confirm.*playback started/,'a generic ACK is not proof of sound');
chrome.runtime.sendMessage=normalRuntimeSend;
permission='denied';
reply=await send({type:'PC_ATTENTION_TEST'},ui);assert.equal(reply.ok,false);assert.match(reply.error,/permission is denied/);
let remoteKey='';globalThis.pcNativeMonitor={focus:async(key)=>{remoteKey=key;return {ok:true};}};
await service.observe({sourceId:'native:firefox-client',tabId:32,url:'https://claude.ai/chat/two',title:'Remote',status:'error'});
const remote=(await service.get()).incidents.at(-1);
reply=await service.focus(remote.id);assert.equal(reply.ok,true);assert.equal(remoteKey,'firefox-client:32');
await service.closeTab(7);
assert.equal((await service.focus(incident.id)).ok,false);

// Restart checks every persisted local session. A Firefox minimal sensor answers
// the rescan request; it does not implement the full Chromium Sentinel protocol.
const startupProbes=[];
const startupUrl='https://chatgpt.com/c/startup';
values.projectConstellationAttentionV1={sessions:[
  {key:'local:21',sourceId:'local',tabId:21,url:startupUrl,status:'running'},
  {key:'local:22',sourceId:'local',tabId:22,url:startupUrl,status:'running'},
  {key:'local:23',sourceId:'local',tabId:23,url:startupUrl,status:'running'},
  {key:'local:24',sourceId:'local',tabId:24,url:startupUrl,status:'running'}
],incidents:[]};
chrome.tabs.query=async(query)=>{assert.deepEqual(query,{});return [
  {id:21,url:startupUrl},{id:22,url:startupUrl},{id:23,url:startupUrl,frozen:true}
];};
chrome.tabs.get=async(id)=>({id,url:startupUrl,frozen:id===23});
chrome.tabs.sendMessage=async(id,message)=>{
  startupProbes.push({id,type:message.type});
  if(id===22&&message.type==='PC_GET_LIVE_SENTINEL_STATE')return {ok:true,source:'live-sentinel',version:'0.24.0',chat:{id:'startup',url:startupUrl,status:'running'},generation:{active:true},observedAt:Date.now()};
  return undefined;
};
await import('../extension/src/attention-background.js?startup-reconcile');
for(let i=0;i<20&&!startupProbes.some((row)=>row.type==='PC_MONITOR_RESCAN');i++)await new Promise(setImmediate);
assert.ok(startupProbes.some((row)=>row.id===21&&row.type==='PC_MONITOR_RESCAN'),'quiet Firefox pages are asked for fresh evidence once on background restart');
assert.equal(startupProbes.filter((row)=>row.type==='PC_MONITOR_RESCAN').length,1,'current full sensors do not receive redundant fallback probes');
assert.ok(startupProbes.every((row)=>![23,24].includes(row.id)),'frozen and closed pages are never probed as if healthy');
assert.equal((await globalThis.pcAttention.get()).sessions.find((row)=>row.tabId===24).status,'closed');

// Use the real background adapter with controlled provider replies to exercise
// worker restarts and lifecycle callbacks, including responses arriving out of order.
const realNow=Date.now;let lifecycleClock=40_000_000;
Date.now=()=>lifecycleClock;
const settle=async()=>{for(let i=0;i<6;i++)await new Promise(setImmediate);};
try {
  const core=globalThis.ProjectConstellationAttentionService;
  const lifecycleUrl='https://chatgpt.com/c/lifecycle';
  const seed=async({acknowledged=false}={})=>{
    const runtime=core.createService({now:()=>lifecycleClock,read:async()=>({}),write:async(key,value)=>{values[key]=structuredClone(value);},notify:async()=>({ok:true}),sound:async()=>({ok:true,started:true})});
    await runtime.observe({sourceId:'local',tabId:30,url:lifecycleUrl,documentId:'lifecycle',runId:'old-run',status:'permission_required',observedAt:lifecycleClock});
    if(acknowledged)await runtime.acknowledge((await runtime.get()).incidents[0].id);
    lifecycleClock+=100;
  };
  chrome.tabs.query=async()=>[{id:30,url:lifecycleUrl}];
  let actualTab={id:30,url:lifecycleUrl};chrome.tabs.get=async()=>({...actualTab});
  await seed({acknowledged:true});
  chrome.tabs.sendMessage=async()=>({ok:true,source:'live-sentinel',version:'0.24.0',chat:{id:'lifecycle',url:lifecycleUrl,status:'permission_required'},generation:{runId:'new-run'},observedAt:lifecycleClock});
  await import('../extension/src/attention-background.js?startup-new-run');await settle();
  let restored=await globalThis.pcAttention.get();
  assert.equal(restored.sessions[0].runId,'new-run','startup uses the fresh generation identity instead of the old persisted run');
  assert.equal(restored.incidents.length,2);assert.equal(restored.incidents.at(-1).acknowledgedAt,0,'an acknowledged earlier run cannot suppress a new current permission request');
  assert.ok(restored.incidents[0].resolvedAt);

  await seed();let answerProbe;const probeAt=lifecycleClock;
  chrome.tabs.sendMessage=(_id,message)=>message.type==='PC_GET_LIVE_SENTINEL_STATE'?new Promise(resolve=>{answerProbe=resolve;}):Promise.resolve({ok:true});
  await import('../extension/src/attention-background.js?startup-delayed-reply');await settle();assert.equal(typeof answerProbe,'function');
  lifecycleClock+=100;
  await globalThis.pcAttention.observe({sourceId:'local',tabId:30,url:lifecycleUrl,documentId:'lifecycle',runId:'current-run',status:'permission_required',observedAt:lifecycleClock});
  lifecycleClock+=100;
  answerProbe({ok:true,source:'live-sentinel',version:'0.24.0',chat:{id:'lifecycle',url:lifecycleUrl,status:'running'},generation:{runId:'old-run'},observedAt:probeAt});
  await settle();restored=await globalThis.pcAttention.get();
  assert.equal(restored.sessions[0].status,'permission_required');assert.equal(restored.sessions[0].runId,'current-run');
  assert.equal(restored.counts.open,1,'a delayed startup response keeps its original evidence time and cannot clear the newer incident');

  await seed();const mismatchProbes=[];
  chrome.tabs.sendMessage=async(_id,message)=>{mismatchProbes.push(message.type);return message.type==='PC_GET_LIVE_SENTINEL_STATE'?{ok:true,source:'live-sentinel',version:'0.24.0',chat:{id:'other',url:'https://chatgpt.com/c/other',status:'idle'},observedAt:lifecycleClock}:{ok:true};};
  await import('../extension/src/attention-background.js?startup-wrong-document');await settle();
  assert.equal((await globalThis.pcAttention.get()).sessions[0].status,'sensor-offline','a reply about another conversation cannot claim restored coverage');
  assert.ok(mismatchProbes.includes('PC_MONITOR_RESCAN'));

  await seed();chrome.tabs.sendMessage=async()=>({ok:true,source:'live-sentinel',version:'0.24.0',chat:{id:'lifecycle',url:lifecycleUrl,status:'permission_required'},generation:{runId:'current-run'},observedAt:lifecycleClock});
  await import('../extension/src/attention-background.js?lifecycle-stale-events');await settle();
  const updated=tabUpdated.at(-1);
  updated(30,{url:'https://chatgpt.com/c/obsolete'},{id:30,url:'https://chatgpt.com/c/obsolete'});await settle();
  assert.equal((await globalThis.pcAttention.get()).sessions[0].status,'permission_required','late navigation callbacks cannot close a currently different live tab');
  updated(30,{discarded:true},{id:30,url:lifecycleUrl,discarded:true});await settle();
  assert.equal((await globalThis.pcAttention.get()).sessions[0].status,'permission_required','late discard callbacks cannot suspend a page which is active again');
  actualTab.discarded=true;lifecycleClock+=100;updated(30,{discarded:true},actualTab);await settle();
  assert.equal((await globalThis.pcAttention.get()).sessions[0].status,'suspended','a confirmed current discard still marks coverage unavailable');
  actualTab.discarded=false;lifecycleClock+=100;
  await globalThis.pcAttention.observe({sourceId:'local',tabId:30,url:lifecycleUrl,documentId:'lifecycle',runId:'current-run',status:'permission_required',observedAt:lifecycleClock+2000});
  actualTab.frozen=true;updated(30,{frozen:true},actualTab);await settle();
  const frozen=(await globalThis.pcAttention.get()).sessions[0];
  assert.equal(frozen.status,'suspended','an accepted future-clock watermark cannot defeat authoritative freeze evidence');
  assert.equal(frozen.observedAt,lifecycleClock+2000,'lifecycle suspension retains the accepted ordering watermark');
} finally {Date.now=realNow;}

// Exercise the actual shared WebAudio helper's lifecycle. Scheduling is reported
// only for a running audio context, and oscillator nodes release after their tone.
const audioContexts=[],oscillators=[],gains=[];
globalThis.AudioContext=class {
  constructor(){this.state='running';this.currentTime=10;this.destination={};audioContexts.push(this);}
  async resume(){}
  createOscillator(){const oscillator={frequency:{setValueAtTime:(value)=>{oscillator.frequencyValue=value;}},connect:()=>{},
    start:(at)=>{oscillator.startedAt=at;},stop:(at)=>{oscillator.stoppedAt=at;},disconnect:()=>{oscillator.disconnected=true;}};oscillators.push(oscillator);return oscillator;}
  createGain(){const gain={gain:{setValueAtTime:()=>{},linearRampToValueAtTime:(value)=>{gain.peak=value;},exponentialRampToValueAtTime:()=>{}},
    connect:()=>{},disconnect:()=>{gain.disconnected=true;}};gains.push(gain);return gain;}
};
let sound=await globalThis.pcAttentionPlayAudio({volume:0});assert.equal(sound.ok,false);assert.match(sound.error,/zero/);assert.equal(oscillators.length,0);
sound=await globalThis.pcAttentionPlayAudio({kind:'permission_required',volume:.5});
assert.equal(sound.ok,true);assert.equal(sound.started,true);assert.equal(oscillators.length,3);
assert.ok(oscillators.every((row)=>row.stoppedAt>row.startedAt&&row.stoppedAt-row.startedAt<.2));
assert.ok(gains.every((row)=>row.peak===.075));
oscillators.forEach((row)=>row.onended());assert.ok(oscillators.every((row)=>row.disconnected));assert.ok(gains.every((row)=>row.disconnected));
audioContexts[0].state='suspended';sound=await globalThis.pcAttentionPlayAudio({volume:.5});assert.equal(sound.ok,false);assert.match(sound.error,/suspended/);
audioContexts[0].state='closed';sound=await globalThis.pcAttentionPlayAudio({volume:.5});assert.equal(sound.ok,true);assert.equal(audioContexts.length,2);
delete globalThis.AudioContext;
console.log('attention-background.test.mjs: PASS (message boundary, offscreen retirement/race, strict audio receipt, exact-tab focus, fresh startup identity and ordering, stale lifecycle callbacks, Firefox restart, WebAudio lifecycle)');
