import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../extension/agent-monitor.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../extension/agent-monitor.html',import.meta.url),'utf8');
// This fixture executes the actual dashboard. It proves routing/state behavior;
// browser-rendered layout, audio playback and OS notification proof stay separate.
class Element {
  constructor(tag='div'){this.tagName=tag.toUpperCase();this.className='';this.children=[];this.parentNode=null;this.ownText='';this.value='';this.hidden=false;this.disabled=false;this.listeners=new Map();this.attrs={};this.classList={toggle:(name,on)=>{const parts=new Set(this.className.split(' ').filter(Boolean));if(on)parts.add(name);else parts.delete(name);this.className=[...parts].join(' ');}};}
  set textContent(value){this.ownText=String(value);this.children=[];}
  get textContent(){return this.ownText+this.children.map(x=>x.textContent).join(' ');}
  get firstChild(){return this.children[0]||null;}
  get nextSibling(){if(!this.parentNode)return null;return this.parentNode.children[this.parentNode.children.indexOf(this)+1]||null;}
  append(...items){for(const item of items)this.insertBefore(item,null);}
  insertBefore(item,reference){if(item.parentNode)item.parentNode.removeChild(item);const at=reference?this.children.indexOf(reference):this.children.length;assert.ok(at>=0);this.children.splice(at,0,item);item.parentNode=this;return item;}
  removeChild(item){const at=this.children.indexOf(item);assert.ok(at>=0);this.children.splice(at,1);item.parentNode=null;return item;}
  prepend(...items){for(const item of items.reverse())this.insertBefore(item,this.firstChild);}
  replaceChildren(...items){this.ownText='';for(const child of this.children)child.parentNode=null;this.children=[];this.append(...items);}
  setAttribute(key,value){this.attrs[key]=value;}
  addEventListener(type,fn){this.listeners.set(type,fn);}
  click(){return this.listeners.get('click')?.({});}
  focus(){}
}
const descendants=(root,predicate)=>root.children.flatMap(child=>[...(predicate(child)?[child]:[]),...descendants(child,predicate)]);
const flush=async()=>{for(let i=0;i<12;i++)await new Promise(setImmediate);};
async function dashboard(fixture,{firefox=false,sharedSettingsError='',connectResult,readErrors={},incompleteReads={}}={}){
  const elements=new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(([,id])=>[id,new Element()]));
  elements.get('browserFilter').value='all';elements.get('sortOrder').value='attention';
  const calls=[],events=[];
  const context={console,URL,Date,Blob,Promise,queueMicrotask,setTimeout:()=>0,clearTimeout:()=>{},
    document:{getElementById:id=>elements.get(id),createElement:tag=>new Element(tag),createTextNode:text=>{const el=new Element('#text');el.textContent=text;return el;},querySelectorAll:()=>[],addEventListener:()=>{},activeElement:null},
    chrome:{runtime:{getManifest:()=>({version:'0.23.0'}),onMessage:{addListener:fn=>events.push(fn)},sendMessage:async message=>{
      calls.push(structuredClone(message));
      if(readErrors[message.type])throw new Error(readErrors[message.type]);
      if(incompleteReads[message.type])return {ok:true};
      if(message.type==='PC_ATTENTION_GET')return {ok:true,attention:structuredClone(fixture.attention)};
      if(message.type==='PC_MONITOR_GET')return {ok:true,monitor:structuredClone(fixture.monitor)};
      if(message.type==='PC_MONITOR_CONNECT')return connectResult??{ok:true,monitor:structuredClone(fixture.monitor)};
      if(message.type==='PC_MONITOR_REFRESH')return {ok:true,monitor:{refresh:{total:4,observed:2,rescanRequested:1,suspended:0,unavailable:1}}};
      if(message.type==='PC_MONITOR_ALERT_SETTINGS'&&sharedSettingsError)return {ok:false,error:sharedSettingsError};
      if(message.type==='PC_ATTENTION_TEST')return {ok:false,error:'Audio output is unavailable.',settingsNotice:'Explicit diagnostic: normal alerts are muted.',audio:{ok:false},notification:{ok:true}};
      return {ok:true};
    }},permissions:{request:async request=>{calls.push({type:'permission-request',...request});return true;}}}
  };
  if(firefox){
    context.browser=context.chrome;
    context.chrome={runtime:{sendMessage:()=>{throw new Error('Firefox dashboard must use the promise-based browser API.');}}};
  }
  vm.runInNewContext(source,context,{filename:'agent-monitor.js'});await flush();
  return {elements,calls,events};
}
const now=Date.now();
const own='chrome:work:session',foreign='edge:work:session',url='https://chatgpt.com/c/shared';
const settings={audioEnabled:true,notificationsEnabled:true,volume:.45,reminderMinutes:0};
const local={id:'local-issue',sourceId:'local',tabId:7,documentId:'chrome-doc',runId:'chrome-run',url,title:'Chrome request',kind:'error',status:'error',label:'Needs attention',severity:'critical',firstSeenAt:now,resolvedAt:0,acknowledgedAt:0};
const session={sessionId:foreign+':7',clientId:foreign,tabId:7,documentId:'edge-doc',runId:'edge-run',url,title:'Edge request',browser:'edge',status:'error',connected:true,observedAt:now};
const incident={incidentId:'native-issue',clientId:foreign,sessionId:session.sessionId,documentId:session.documentId,runId:session.runId,title:session.title,url:session.url,kind:'error',firstSeenAt:now,resolvedAt:null,acknowledgedAt:null};
const fixture={attention:{settings,sessions:[],incidents:[local],delivery:{},audioOwner:{enabled:true}},monitor:{connected:true,clientId:own,config:{browser:'chrome'},snapshot:{clients:[{clientId:own,browser:'chrome',connected:true},{clientId:foreign,browser:'edge',connected:true}],sessions:[session],incidents:[incident]}}};

{
  const h=await dashboard(fixture);
  assert.equal(h.elements.get('attentionCount').textContent,'2','equal numeric tab IDs and URLs in different browsers must not merge incidents');
  assert.match(h.elements.get('incidentList').textContent,/Chrome request/);
  assert.match(h.elements.get('incidentList').textContent,/Edge request/);
  const buttons=descendants(h.elements.get('incidentList'),x=>x.tagName==='BUTTON'&&x.textContent.startsWith('Open chat'));
  assert.equal(buttons.length,2);for(const button of buttons)await button.click();await flush();
  assert.ok(h.calls.some(x=>x.type==='PC_ATTENTION_FOCUS'&&x.id==='local-issue'),'local incident routes to its local identity');
  assert.ok(h.calls.some(x=>x.type==='PC_MONITOR_FOCUS'&&x.sessionId===foreign+':7'),'remote incident routes to its remote session');
  await h.elements.get('refreshMonitor').click();await flush();
  assert.equal(h.elements.get('toast').textContent,'This browser: 2 observed, 1 rescans requested, 0 suspended, 1 unavailable.','refresh reports actual outcomes');
}
{
  const input=structuredClone(fixture);input.attention.incidents=[];input.monitor.snapshot.sessions[0].status='suspended';
  const h=await dashboard(input);
  assert.match(h.elements.get('sessionList').textContent,/Unavailable|Suspended/);
  const sessionButton=descendants(h.elements.get('sessionList'),x=>x.tagName==='BUTTON')[0];
  assert.equal(sessionButton.disabled,true,'suspended tab is not focusable even while its sensor transport is connected');
  const incidentButton=descendants(h.elements.get('incidentList'),x=>x.tagName==='BUTTON'&&x.textContent.startsWith('Open chat'))[0];
  assert.equal(incidentButton.disabled,true,'incident source suspension prevents stale focus');
}
{
  const input=structuredClone(fixture);input.attention.incidents=[];input.monitor.snapshot.sessions=[];
  const h=await dashboard(input);
  const button=descendants(h.elements.get('incidentList'),x=>x.tagName==='BUTTON'&&x.textContent.startsWith('Open chat'))[0];
  assert.equal(button.disabled,true,'an absent source session cannot default to connected');
}
{
  const input=structuredClone(fixture);input.attention.incidents=[];
  Object.assign(input.monitor.snapshot.incidents[0],{title:'',url:'',documentId:'',runId:''});
  const h=await dashboard(input);
  assert.match(h.elements.get('incidentList').textContent,/Agent chat \(identity unavailable\)/);
  assert.doesNotMatch(h.elements.get('incidentList').textContent,/Edge request/,'migrated unknown history must not borrow the current chat title');
  const button=descendants(h.elements.get('incidentList'),x=>x.tagName==='BUTTON'&&x.textContent.startsWith('Open chat'))[0];
  assert.equal(button.disabled,true,'legacy incident identity is not enough to route to a reused tab');
}
for(const changed of [{documentId:'new-document'},{runId:'new-run'}]){
  const input=structuredClone(fixture);input.attention.incidents=[];
  Object.assign(input.monitor.snapshot.sessions[0],changed,{title:'A different task'});
  const h=await dashboard(input);
  assert.match(h.elements.get('incidentList').textContent,/Edge request/,'history retains its captured title');
  assert.doesNotMatch(h.elements.get('incidentList').textContent,/A different task/);
  const button=descendants(h.elements.get('incidentList'),x=>x.tagName==='BUTTON'&&x.textContent.startsWith('Open chat'))[0];
  assert.equal(button.disabled,true,'a different document or run must not receive stale incident focus');
}
for(const changed of [{},{documentId:'chrome-doc-truncated'},{runId:'new-run'},{documentId:'',runId:''}]){
  const input=structuredClone(fixture);
  Object.assign(input.monitor.snapshot.sessions[0],{clientId:own,sessionId:own+':7',documentId:local.documentId,runId:local.runId});
  Object.assign(input.monitor.snapshot.incidents[0],{clientId:own,sessionId:own+':7',documentId:local.documentId,runId:local.runId},changed);
  const h=await dashboard(input);
  assert.equal(h.elements.get('attentionCount').textContent,Object.keys(changed).length?'2':'1','dedup requires the same source, document, and known run; uncertain identity preserves both incidents');
}
{
  const input=structuredClone(fixture);input.monitor.connected=false;input.monitor.config.browser='firefox';
  const h=await dashboard(input,{firefox:true});
  assert.equal(h.elements.get('attentionCount').textContent,'2','disconnected remote incidents remain visible with unavailable sources');
  await h.elements.get('connectNative').click();await flush();
  assert.ok(h.calls.some(x=>x.type==='permission-request'&&x.permissions.includes('nativeMessaging')));
  assert.ok(h.calls.some(x=>x.type==='PC_MONITOR_CONNECT'),'Firefox connects through the promise-based browser API');
}
{
  const input=structuredClone(fixture);input.attention.audioOwner.enabled=false;
  input.monitor.snapshot.alertSettings={...settings,enabled:false,audioEnabled:false,notificationsEnabled:false,completionEnabled:true,volume:.9,reminderMinutes:15,muteUntil:Date.now()+60000};
  const h=await dashboard(input);
  assert.equal(h.elements.get('alertScope').textContent,'SHARED SETTINGS');
  assert.equal(h.elements.get('alertsEnabled').checked,false);
  assert.match(h.elements.get('alertDelivery').textContent,/Automatic alerts are off/);
  h.elements.get('alertsEnabled').checked=true;
  await h.elements.get('alertsEnabled').listeners.get('change')({});await flush();
  assert.ok(h.calls.some(x=>x.type==='PC_MONITOR_ALERT_SETTINGS'&&x.settings.enabled===true),'disabled shared automatic delivery can be explicitly enabled again');
  assert.equal(h.elements.get('soundEnabled').checked,false,'connected controls display the hub policy even before local settings synchronize');
  assert.equal(h.elements.get('notificationsEnabled').checked,false);
  assert.equal(h.elements.get('completionEnabled').checked,true);
  assert.equal(Number(h.elements.get('soundVolume').value),90);
  assert.equal(h.elements.get('reminderMinutes').value,'15');
  assert.equal(h.elements.get('unmute').hidden,false,'shared mute is visible when stale local settings are unmuted');
  assert.match(h.elements.get('alertDelivery').textContent,/Alerts muted until/);
  input.monitor.connected=false;
  const standalone=await dashboard(input);
  assert.equal(standalone.elements.get('alertScope').textContent,'THIS BROWSER');
  assert.equal(standalone.elements.get('soundEnabled').checked,true,'standalone controls ignore a stale disconnected hub snapshot');
  assert.equal(Number(standalone.elements.get('soundVolume').value),45);
  assert.equal(standalone.elements.get('unmute').hidden,true);
}
{
  const input=structuredClone(fixture);input.attention.audioOwner.enabled=false;
  const h=await dashboard(input);
  const requestedAt=Date.now();
  await h.elements.get('quietHour').click();await flush();
  const mute=h.calls.find(x=>x.type==='PC_MONITOR_ALERT_SETTINGS'&&x.settings.muteUntil);
  assert.ok(mute,'a follower dashboard sends Mute to the shared hub policy that controls the elected alert owner');
  assert.ok(mute.settings.muteUntil>=requestedAt+3600000&&mute.settings.muteUntil<=Date.now()+3600000);
  h.elements.get('soundVolume').value='30';
  await h.elements.get('soundVolume').listeners.get('change')({});await flush();
  assert.ok(h.calls.some(x=>x.type==='PC_MONITOR_ALERT_SETTINGS'&&x.settings.volume===.3),'follower volume applies to the elected owner through the hub');
  await h.elements.get('unmute').click();await flush();
  assert.ok(h.calls.some(x=>x.type==='PC_MONITOR_ALERT_SETTINGS'&&x.settings.muteUntil===0),'shared mute is cleared through the same hub policy');
  assert.equal(h.calls.some(x=>x.type==='PC_ATTENTION_SETTINGS'),false,'a connected follower must not give false assurance by changing only its unused local delivery settings');
}
{
  const input=structuredClone(fixture);input.monitor.connected=false;
  const h=await dashboard(input);
  await h.elements.get('quietHour').click();await flush();
  h.elements.get('soundVolume').value='25';
  await h.elements.get('soundVolume').listeners.get('change')({});await flush();
  assert.ok(h.calls.some(x=>x.type==='PC_ATTENTION_SETTINGS'&&x.settings.muteUntil>Date.now()),'standalone mute remains local');
  assert.ok(h.calls.some(x=>x.type==='PC_ATTENTION_SETTINGS'&&x.settings.volume===.25),'standalone volume remains local');
  assert.equal(h.calls.some(x=>x.type==='PC_MONITOR_ALERT_SETTINGS'),false,'a disconnected browser does not route standalone settings through an unavailable hub');
}
{
  const input=structuredClone(fixture);input.attention.audioOwner.enabled=false;
  const h=await dashboard(input,{sharedSettingsError:'Shared alert policy could not be saved.'});
  await h.elements.get('quietHour').click();await flush();
  assert.match(h.elements.get('toast').textContent,/Shared alert policy could not be saved/,'failed shared mute must be visible');
  assert.equal(h.calls.some(x=>x.type==='PC_ATTENTION_SETTINGS'),false,'failed shared policy must not silently fall back to follower-only mute');
}
{
  const input=structuredClone(fixture);
  input.attention.settings.muteUntil=Date.now()+60000;
  input.attention.delivery={lastTest:{at:now-5000,ok:true},lastError:'Audio document failed.',lastErrorAt:now};
  const h=await dashboard(input);
  const status=h.elements.get('alertDelivery').textContent;
  assert.match(status,/Alerts muted until/);assert.match(status,/Latest alert delivery failed: Audio document failed/);
  assert.doesNotMatch(status,/accepted by this browser/,'an older successful test must not hide a newer delivery failure');
  await h.elements.get('testAlert').click();await flush();
  assert.match(h.elements.get('toast').textContent,/Audio output is unavailable/);
  assert.match(h.elements.get('toast').textContent,/Explicit diagnostic: normal alerts are muted/);
}
{
  const input=structuredClone(fixture);
  input.monitor={connected:false,connecting:false,waitingForWindow:true,config:{enabled:true,browser:'chrome'}};
  const h=await dashboard(input);
  assert.match(h.elements.get('nativeStatus').textContent,/paused.*normal browser window/);
  assert.match(h.elements.get('monitorState').textContent,/paused/);
  assert.equal(h.elements.get('disconnectNative').hidden,false,'paused opt-in can be disabled without first connecting');
  assert.equal(h.elements.get('connectNative').disabled,true);
  await h.elements.get('disconnectNative').click();await flush();
  assert.ok(h.calls.some(x=>x.type==='PC_MONITOR_DISCONNECT'));
}
{
  const input=structuredClone(fixture);
  input.monitor={connected:false,connecting:true,config:{enabled:true,browser:'chrome'}};
  const h=await dashboard(input);
  assert.match(h.elements.get('nativeStatus').textContent,/not confirmed/);
  assert.equal(h.elements.get('disconnectNative').hidden,false,'a pending connection can be cancelled');
}
{
  const input=structuredClone(fixture);input.monitor.connected=false;
  const h=await dashboard(input,{connectResult:{ok:true}});
  await h.elements.get('connectNative').click();await flush();
  assert.match(h.elements.get('toast').textContent,/not confirmed/,'an opaque acknowledgement must not claim a connected hub');
  assert.doesNotMatch(h.elements.get('toast').textContent,/hub connected/);
}
{
  const input=structuredClone(fixture);input.attention.incidents=[];
  Object.assign(input.monitor.snapshot.sessions[0],{title:undefined,status:undefined,observedAt:undefined});
  const h=await dashboard(input);
  h.elements.get('sortOrder').value='title';
  h.elements.get('sortOrder').listeners.get('change')({});
  assert.match(h.elements.get('sessionList').textContent,/Untitled chat/);
  assert.match(h.elements.get('sessionList').textContent,/unknown/);
}

{
  const input=structuredClone(fixture),readErrors={};
  const h=await dashboard(input,{readErrors});
  readErrors.PC_ATTENTION_GET='Extension service worker did not answer.';
  readErrors.PC_MONITOR_GET='Native bridge did not answer.';
  h.events[0]({type:'PC_MONITOR_CHANGED'});await flush();
  assert.equal(h.elements.get('totalCount').textContent,'1','failed reads retain the last known source inventory');
  assert.equal(h.elements.get('attentionCount').textContent,'2','a failed read never erases unresolved work');
  assert.match(h.elements.get('monitorState').textContent,/unavailable/);
  assert.match(h.elements.get('nativeStatus').textContent,/status is unavailable/);
  assert.match(h.elements.get('lastUpdated').textContent,/last known state/);
  assert.equal(h.elements.get('coverageCount').textContent,'0 / 4','stale data cannot claim connected coverage');
  assert.equal(h.elements.get('alertsEnabled').disabled,true,'unconfirmed shared ownership cannot silently route settings to local policy');
  assert.ok(descendants(h.elements.get('sessionList'),x=>x.tagName==='BUTTON').every(x=>x.disabled));
  assert.ok(descendants(h.elements.get('incidentList'),x=>x.tagName==='BUTTON').every(x=>x.disabled));
  delete readErrors.PC_ATTENTION_GET;delete readErrors.PC_MONITOR_GET;
  h.events[0]({type:'PC_MONITOR_CHANGED'});await flush();
  assert.match(h.elements.get('monitorState').textContent,/hub connected/);
  assert.equal(h.elements.get('alertsEnabled').disabled,false);
  assert.equal(h.elements.get('coverageCount').textContent,'2 / 4');
}
{
  const input=structuredClone(fixture),incompleteReads={PC_MONITOR_GET:true};
  const h=await dashboard(input,{incompleteReads});
  assert.match(h.elements.get('loadError').textContent,/incomplete status/,'an opaque GET success is not live connection evidence');
  assert.equal(h.elements.get('loadError').hidden,false);
  assert.match(h.elements.get('nativeStatus').textContent,/unavailable/);
}
{
  const input=structuredClone(fixture);input.monitor.connected=false;
  const h=await dashboard(input);
  assert.equal(h.elements.get('totalCount').textContent,'1','remote source inventory survives hub disconnect');
  assert.match(h.elements.get('sessionList').textContent,/Unavailable/);
  assert.ok(descendants(h.elements.get('sessionList'),x=>x.tagName==='BUTTON').every(x=>x.disabled));
  assert.match(h.elements.get('incidentList').textContent,/Source unavailable/);
  assert.equal(h.elements.get('coverageCount').textContent,'1 / 4');
}
{
  const input=structuredClone(fixture);input.attention.incidents=[];
  input.monitor.snapshot.sessions=Array.from({length:121},(_,i)=>({...session,sessionId:foreign+':'+i,tabId:i,title:'Chat '+String(i).padStart(3,'0'),observedAt:now-i}));
  input.monitor.snapshot.incidents=Array.from({length:61},(_,i)=>({...incident,incidentId:'issue-'+i,sessionId:foreign+':'+i,title:'Issue '+String(i).padStart(3,'0'),firstSeenAt:now-i}));
  const h=await dashboard(input);
  assert.equal(h.elements.get('totalCount').textContent,'121');assert.equal(h.elements.get('attentionCount').textContent,'61');
  assert.equal(h.elements.get('sessionList').children.length,121,'every observed row is rendered; no cap or viewport culling');
  assert.equal(h.elements.get('incidentList').children.length,61,'all incidents remain rendered');
  const originalSessions=[...h.elements.get('sessionList').children],originalIncidents=[...h.elements.get('incidentList').children];
  h.events[0]({type:'PC_MONITOR_CHANGED'});await flush();
  assert.deepEqual(h.elements.get('sessionList').children,originalSessions,'unchanged events preserve all existing row nodes');
  assert.deepEqual(h.elements.get('incidentList').children,originalIncidents,'unchanged events preserve incident nodes and focused actions');
  input.monitor.snapshot.sessions[120].title='Changed last chat';
  h.events[0]({type:'PC_MONITOR_CHANGED'});await flush();
  assert.equal(h.elements.get('sessionList').children.length,121);
  assert.equal(h.elements.get('sessionList').children[0],originalSessions[0]);
  assert.notEqual(h.elements.get('sessionList').children[120],originalSessions[120]);
  assert.match(h.elements.get('sessionList').children[120].textContent,/Changed last chat/);
  input.monitor.snapshot.sessions[120].title='Chat 120';
  h.events[0]({type:'PC_MONITOR_CHANGED'});await flush();
  h.elements.get('searchAgents').value='Chat 120';h.elements.get('searchAgents').listeners.get('input')({});
  assert.equal(h.elements.get('sessionList').children.length,1,'search spans all data, including the final rendered row');
  assert.match(h.elements.get('sessionList').textContent,/Chat 120/);
  assert.match(h.elements.get('incidentList').textContent,/No incidents match/);
  assert.match(h.elements.get('activityHint').textContent,/1 of 121/);
  h.elements.get('searchAgents').value='absent';h.elements.get('searchAgents').listeners.get('input')({});
  assert.match(h.elements.get('activityHint').textContent,/0 of 121/,'empty search updates the count instead of retaining stale results');
}
{
  const input=structuredClone(fixture);input.attention.incidents=[];
  input.monitor.snapshot.incidents=[incident,{...incident,incidentId:'acknowledged',acknowledgedAt:now,title:'Handled issue'},
    {...incident,incidentId:'snoozed',snoozedUntil:now+600000,title:'Quiet issue'}];
  const h=await dashboard(input);
  h.elements.get('inboxFilter').value='pending';h.elements.get('inboxFilter').listeners.get('change')({});
  assert.equal(h.elements.get('incidentList').children.length,1);assert.match(h.elements.get('incidentList').textContent,/Edge request/);
  h.elements.get('inboxFilter').value='acknowledged';h.elements.get('inboxFilter').listeners.get('change')({});
  assert.equal(h.elements.get('incidentList').children.length,1);assert.match(h.elements.get('incidentList').textContent,/Handled issue/);
  h.elements.get('inboxFilter').value='snoozed';h.elements.get('inboxFilter').listeners.get('change')({});
  assert.equal(h.elements.get('incidentList').children.length,1);assert.match(h.elements.get('incidentList').textContent,/Quiet issue/);
  assert.equal(h.elements.get('attentionCount').textContent,'3','triage views do not drop incidents from the total');
}
{
  const input=structuredClone(fixture);
  input.attention.incidents[0].resolvedAt=now-10;
  Object.assign(input.monitor.snapshot.incidents[0],{clientId:own,sessionId:own+':7',documentId:local.documentId,runId:local.runId,resolvedAt:now});
  const h=await dashboard(input);await h.elements.get('showResolved').click();
  assert.equal(h.elements.get('incidentList').children.length,1,'resolved local and hub copies do not duplicate history because their clocks differ');
}

{
  const input=structuredClone(fixture);
  input.attention.incidents[0].resolvedAt=now-10;
  input.attention.incidents.push({...input.attention.incidents[0],id:'second-local-episode',title:'A second failure',firstSeenAt:now+100,resolvedAt:now+150});
  Object.assign(input.monitor.snapshot.incidents[0],{clientId:own,sessionId:own+':7',documentId:local.documentId,runId:local.runId,resolvedAt:now});
  const h=await dashboard(input);await h.elements.get('showResolved').click();
  assert.equal(h.elements.get('incidentList').children.length,2,'native/local reconciliation is one-to-one and preserves unmatched historical episodes');
  assert.match(h.elements.get('incidentList').textContent,/A second failure/);
}
{
  const input=structuredClone(fixture),readErrors={};input.attention.incidents=[];input.monitor.snapshot.sessions=[];
  const h=await dashboard(input,{readErrors});
  assert.ok(descendants(h.elements.get('incidentList'),x=>x.tagName==='BUTTON'&&x.textContent==='Acknowledge').some(x=>!x.disabled));
  readErrors.PC_MONITOR_GET='Bridge unavailable';h.events[0]({type:'PC_MONITOR_CHANGED'});await flush();
  assert.ok(descendants(h.elements.get('incidentList'),x=>x.tagName==='BUTTON').every(x=>x.disabled),'unavailable-source cards invalidate cached edit eligibility when the hub read fails');
}
console.log('agent-monitor-ui-logic.test.mjs: PASS (identity, focus, alert settings, stale-state recovery, complete incremental rendering, complete search and incident triage)');
