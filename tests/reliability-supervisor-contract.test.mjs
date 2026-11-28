import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

// Retain original-main guarantees against the active replacement. Starting both
// supervisors would duplicate recovery, permission scans and timer wakeups.
const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('extension/manifest.json'));
const worker = read(`extension/${manifest.background.service_worker}`);
const background = read('extension/background.js');
const sentinel = read('extension/src/live-sentinel.js');
const content = read('extension/src/content.js');
const build = read('tools/build.mjs');
assert.equal(manifest.background.service_worker, 'background-entry.js');
assert.equal((worker.match(/import '\.\/background\.js'/g) || []).length, 1);
assert.match(worker, /import '\.\/src\/attention-background\.js'/);
assert.doesNotMatch(worker, /import ['"][^'"]*(?:tab-supervisor-background|approval-supervisor-background)/,
  'only the canonical guardian can recover; legacy auto-consent must not restart');
assert.match(read('extension/service-worker.js'), /import '\.\/background-entry\.js'/);
for (const name of ['project-constellation-tab-supervisor','project-constellation-approval-supervisor']) {
  assert.ok(worker.includes(name), `upgrade must clear retired alarm ${name}`);
}
assert.match(worker, /chrome\.alarms\.clear\(alarm\)/);
assert.ok(worker.indexOf("import './src/drive-sync-guard.js'") < worker.indexOf("import './background.js'"));

// The current closure validator supersedes the old hand-maintained build list.
const visited = new Set();
function visit(relative) {
  if (visited.has(relative)) return;
  visited.add(relative);
  const source = read(`extension/${relative}`);
  for (const match of source.matchAll(/\bimport\s+(?:[^'"\n]+?\s+from\s+)?['"](\.[^'"]+)['"]/g)) {
    visit(path.posix.normalize(path.posix.join(path.posix.dirname(relative), match[1])));
  }
}
visit(manifest.background.service_worker);
for (const script of manifest.content_scripts || []) for (const file of script.js || []) visit(file);
for (const name of ['brain-core','provider-core','integrity-core','knowledge-core','project-memory-core','health-core','chat-guardian-core']) {
  assert.ok(visited.has(`src/${name}.js`), `active graph must include ${name}`);
}
assert.match(build, /fs\.cpSync\(path\.join\(sourceRoot, 'src'\)/);
assert.match(build, /Build closure broken:/);
assert.match(build, /requireBuiltFile\(manifest\.background\?\.service_worker/);
const contentEntry = (manifest.content_scripts || []).find((row) => (row.js || []).includes('src/live-sentinel.js'));
assert.ok(contentEntry?.matches.includes('https://chatgpt.com/*'));
assert.ok(contentEntry.js.includes('src/content.js'));
assert.ok(!(manifest.content_scripts || []).some((row) => (row.js || []).includes('src/tab-supervisor.js')));

const block = (source, name, indent = '') => {
  const start = source.search(new RegExp(`^${indent}(?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, `production function ${name} must exist`);
  const end = source.indexOf(`\n${indent}}\n`, start);
  assert.ok(end > start, `production function ${name} must have a closing boundary`);
  return source.slice(start, end + indent.length + 3);
};

// Hidden runnable tabs begin concurrently. One dead tab cannot block others;
// frozen pages are deferred, discarded pages wake without focus, and approval
// holds never enter the continuation path. Exercise production guardian code.
await import('../extension/src/chat-guardian-core.js');
const guardian = globalThis.ProjectConstellationChatGuardianCore;
const cfg = guardian.normalizeSettings({ enabled:true });
const tabRows = [1,2,3,4,5].map((id) => ({id,url:`https://chatgpt.com/c/chat-${id}`,active:false,
  ...(id===4?{frozen:true}:{}),...(id===5?{discarded:true}:{})}));
tabRows.push({id:6,url:'https://example.com/',active:true});
const queries=[],probes=[],updates=[],reloads=[],sends=[],fallbacks=[],pending=[];
let enabled=true;
let state={chats:{},sweeps:0,continuations:0,failures:0};
const guardianContext=vm.createContext({
  console, setTimeout, clearTimeout, Date,
  CHAT_GUARDIAN_ALARM:'guardian', chatGuardian:guardian, LIVE_CHAT_PROBE_TIMEOUT_MS:1500,
  settings:async()=>({chatGuardian:{...cfg,enabled}}),
  providers:{detectProvider:(url)=>url.includes('chatgpt.com')?{id:'chatgpt'}:null,isLikelyChatUrl:()=>true},
  chrome:{tabs:{query:async(query)=>{queries.push(query);return tabRows;},
    update:async(id,patch)=>updates.push({id,patch}),reload:async(id)=>reloads.push(id),
    sendMessage:async(id,message)=>{sends.push({id,message});return {ok:true,action:'sent-continue'};}},
    alarms:{clear:async()=>true}},
  readLiveStateFromTab:async(tab)=>{probes.push(tab.id);if(tab.id===3)throw new Error('offline');
    return new Promise((resolve)=>pending.push(()=>resolve({tabId:tab.id,chatId:`chatgpt:chat-${tab.id}`,providerId:'chatgpt',url:tab.url,
      status:tab.id===1?'response-interrupted':'blocked-approval',healthState:tab.id===1?'response-interrupted':'blocked-approval',
      ...(tab.id===1?{failure:{active:true,state:'response-interrupted',detectedAt:Date.now()-10_000}}:{})})));},
  chatGuardianState:async()=>structuredClone(state),saveChatGuardianState:async(next)=>{state=structuredClone(next);return state;},
  armChatGuardianFallback:async(delay)=>fallbacks.push(delay),addEvent:async()=>{},
  scheduleLiveTabReconcile:()=>{},scheduleChatGuardianSweep:()=>{}
});
vm.runInContext(`let chatGuardianRunPromise=null;\n${block(background,'livePulseTimeout')}\n${block(background,'keepChatGptTabResident')}\n${block(background,'runChatGuardian')}`,guardianContext);
const sweep=vm.runInContext("runChatGuardian({trigger:'test'})",guardianContext);
for(let i=0;i<20&&probes.length<3;i++)await new Promise(setImmediate);
assert.deepEqual(probes,[1,2,3],'hidden pages begin before any one response completes');
pending.forEach((resolve)=>resolve());
const outcome=await sweep;
assert.deepEqual(JSON.parse(JSON.stringify(queries)),[{}],'supervision never narrows to active tabs');
assert.equal(outcome.tabs,5);assert.equal(outcome.responsive,2);assert.equal(outcome.deferred,2);
assert.deepEqual(reloads,[5],'only the discarded page is restored, not a failed or frozen probe');
assert.equal(updates.length,5);assert.ok(updates.every((row)=>row.patch.autoDiscardable===false&&!row.patch.active));
assert.equal(sends.length,1);assert.equal(sends[0].id,1);assert.equal(sends[0].message.type,'PC_LIVE_SENTINEL_CONTINUE_UNFINISHED');
assert.equal(fallbacks.length,1);assert.ok(fallbacks[0]>=30_000);
enabled=false;const before=queries.length;await vm.runInContext('runChatGuardian()',guardianContext);assert.equal(queries.length,before);

// A user edit, a newly visible hold, or SPA navigation during Send hydration
// aborts locally. The real background continuation handler must not turn those
// responses into a reload or focus change that could discard the protected draft.
tabRows.splice(0,tabRows.length,{id:1,url:'https://chatgpt.com/c/chat-1',active:false});
enabled=true;
for (const action of ['composer-busy','blocked-hold','chat-moved','already-complete','still-running','not-unfinished']) {
  state={chats:{},sweeps:0,continuations:0,failures:0};
  pending.length=0;
  const reloadCount=reloads.length,updateCount=updates.length;
  guardianContext.chrome.tabs.sendMessage=async()=>({ok:false,action,staged:true});
  const aborted=vm.runInContext('runChatGuardian()',guardianContext);
  for(let i=0;i<20&&!pending.length;i++)await new Promise(setImmediate);
  assert.equal(pending.length,1,`probe must execute for ${action}`);
  pending.splice(0).forEach((resolve)=>resolve());
  const abortedOutcome=await aborted;
  assert.equal(abortedOutcome.continued,0,action);
  assert.equal(abortedOutcome.reloaded,0,action);
  assert.equal(reloads.length,reloadCount,`${action} must never trigger a reload fallback`);
  assert.ok(updates.slice(updateCount).every((row)=>row.patch.autoDiscardable===false&&!('active' in row.patch)),`${action} must never activate a background tab`);
  assert.equal(state.chats['chatgpt:chat-1'].lastResult,action);
}

// A generic message ACK or old sensor version cannot masquerade as live evidence.
let response={ok:true};
const probeContext=vm.createContext({LIVE_SENTINEL_VERSION:manifest.version,chrome:{tabs:{sendMessage:async()=>response}}});
vm.runInContext(block(background,'readLiveSentinelState'),probeContext);
assert.equal(await vm.runInContext('readLiveSentinelState(1)',probeContext),null);
response={ok:true,source:'live-sentinel',version:'0.16.1'};
assert.equal(await vm.runInContext('readLiveSentinelState(1)',probeContext),null);
response={ok:true,source:'live-sentinel',version:manifest.version};
assert.equal(await vm.runInContext('readLiveSentinelState(1)',probeContext),null,'correct sensor version without fresh chat state is still not supervision');
response={ok:true,source:'live-sentinel',version:manifest.version,chat:{status:'idle'}};
assert.equal((await vm.runInContext('readLiveSentinelState(1)',probeContext)).chat.status,'idle');
assert.match(block(background,'ensureLiveSentinel'),/chrome\.scripting\.executeScript/);
assert.match(block(background,'ensureLiveSentinel'),/return readLiveSentinelState\(id\)/);
assert.match(block(background,'runChatGuardian'),/Promise\.allSettled\(probeTabs\.map/);
assert.match(block(background,'armChatGuardianFallback'),/\{ when:Date\.now\(\) \+ delay \}/);
assert.doesNotMatch(block(background,'armChatGuardianFallback'),/periodInMinutes/);
assert.match(background,/changeInfo\?\.frozen === false/);
assert.doesNotMatch(sentinel,/if \(document\.hidden\) return/);
assert.match(sentinel,/document\.hidden \? 1500 : 900/);

// Human permission review, draft preservation, hydrated send and dedup survive.
assert.match(content,/action:'manual-review'/);
assert.doesNotMatch(content,/clickApprovalPersistentOption|function approvalControls/);
assert.ok(/alwaysAllow:\s*false,\s*fallbackAllowOnce:\s*false/.test(background),'legacy approval scan options always forbid granting consent');
assert.match(sentinel,/composer-busy/);assert.match(sentinel,/blocked-hold/);
assert.match(sentinel,/sessionStorage\.setItem\(dedupeKey/);
assert.match(sentinel,/const sendDeadline = Date\.now\(\) \+ 6000/);
assert.match(content,/response\?\.ok \|\| !response\?\.committed/,'Work Rescue needs a persistence ACK');
assert.match(content,/pendingByTurn\.has\(pending\.id\)/,'a failed ACK cannot overwrite a newer pending revision');

// Preserve provider project discovery without reviving a second supervisor.
// Failed persistence stays pending; only a successful canonical ingest ACK dedups.
const projectTimers=new Map();let timerId=0,failProject=true,projectCalls=0;
const anchors=[{href:'https://chatgpt.com/g/g-p-alpha/project',innerText:'Alpha project',getAttribute:()=>''}];
const projectContext=vm.createContext({URL,Date,provider:{id:'chatgpt'},location:{href:'https://chatgpt.com/g/g-p-alpha/c/chat-1'},
  brain:{normalizeText:(value,max)=>String(value||'').trim().slice(0,max)},
  document:{querySelector:()=>anchors[0]},nodesWithin:()=>anchors,
  setTimeout:(fn,delay)=>{const id=++timerId;projectTimers.set(id,{fn,delay});return id;},
  chrome:{runtime:{sendMessage:async(message)=>{projectCalls++;assert.equal(message.type,'PC_BRAIN_INGEST_BATCH');
    assert.ok(message.payload.every((row)=>row.type==='PROJECT_UPSERT'));
    if(failProject)throw new Error('worker restarting');return {ok:true,counts:{projects:message.payload.length}};}}}
});
vm.runInContext(`const seenProviderProjects=new Map(),pendingProviderProjects=new Map();let providerProjectFlushTimer=0,providerProjectFlushBusy=false,providerProjectRetryMs=0;\n`+
  ['providerProjectFromUrl','providerProjectName','scheduleProviderProjectFlush','flushProviderProjects','captureProviderProjects','projectHintFromAnchor'].map((name)=>block(content,name,'  ')).join('\n'),projectContext);
vm.runInContext('captureProviderProjects()',projectContext);
assert.equal(vm.runInContext("projectHintFromAnchor({href:location.href}).id",projectContext),'chatgpt:project:g-p-alpha');
assert.equal(vm.runInContext("providerProjectFromUrl('https://malicious.example/g/g-p-alpha')",projectContext),null);
async function fireProjectTimer(){const [id,timer]=projectTimers.entries().next().value;projectTimers.delete(id);timer.fn();await new Promise(setImmediate);}
await fireProjectTimer();
assert.equal(vm.runInContext('seenProviderProjects.size',projectContext),0,'failed persistence never marks a project seen');
assert.equal(vm.runInContext('pendingProviderProjects.size',projectContext),1);
assert.ok([...projectTimers.values()][0].delay>=750,'pending work retries with backoff');
failProject=false;await fireProjectTimer();
assert.equal(vm.runInContext('seenProviderProjects.size',projectContext),1);
assert.equal(vm.runInContext('pendingProviderProjects.size',projectContext),0);assert.equal(projectTimers.size,0);
vm.runInContext('captureProviderProjects()',projectContext);assert.equal(projectTimers.size,0,'unchanged ACKed projects cause no work');
assert.equal(projectCalls,2);
assert.match(block(background,'ingestBatch'),/type === 'PROJECT_UPSERT'/);
assert.match(block(background,'ingestBatch'),/if \(projects\.length \|\| chats\.length/,'project-only discoveries mark Drive dirty');

// An in-flight acknowledgment cannot erase a newer name discovered in the page.
let releaseProject;
projectContext.chrome.runtime.sendMessage=()=>new Promise((resolve)=>{releaseProject=resolve;});
anchors[0].innerText='Alpha renamed';vm.runInContext('captureProviderProjects()',projectContext);await fireProjectTimer();
anchors[0].innerText='Alpha newest';vm.runInContext('captureProviderProjects()',projectContext);
releaseProject({ok:true,counts:{projects:1}});await new Promise(setImmediate);
assert.equal(vm.runInContext("pendingProviderProjects.get('chatgpt:project:g-p-alpha').project.name",projectContext),'Alpha newest');
projectContext.chrome.runtime.sendMessage=async()=>({ok:true,counts:{projects:1}});await fireProjectTimer();
assert.match(vm.runInContext("seenProviderProjects.get('chatgpt:project:g-p-alpha')",projectContext),/^Alpha newest\|/);
assert.equal(projectTimers.size,0);

// Canonical persistence includes standalone projects in both IndexedDB/search
// and the Drive dirty lane. A storage error propagates instead of returning ACK.
const persistedProjects=[],indexedProjects=[];let dirtyMarks=0,storageFails=false;
const ingestContext=vm.createContext({Date,console,
  settings:async()=>({captureEnabled:true}),brain:{normalizeText:(value,max)=>String(value||'').slice(0,max)},
  putMany:async(store,rows)=>{if(store==='projects'){if(storageFails)throw new Error('database unavailable');persistedProjects.push(...rows);}return rows;},
  preserveTurnRevisions:async()=>({turns:[],revisions:[]}),
  putSearchDocs:async(rows)=>indexedProjects.push(...rows),searchDoc:(type,row)=>({type,...row}),
  addEvent:async()=>{},markDriveDirty:async()=>{dirtyMarks++;},scheduleIntegrityScan:async()=>{},pruneEvents:async()=>{},
  liveRowContextCache:new Map(),liveHealthContextCache:new Map()
});
vm.runInContext(block(background,'ingestBatch'),ingestContext);
const projectInput=[{type:'PROJECT_UPSERT',data:{id:'chatgpt:project:g-p-alpha',name:'Alpha newest',providerId:'chatgpt',providerProjectId:'g-p-alpha'}}];
ingestContext.projectInput=projectInput;
assert.equal((await vm.runInContext('ingestBatch(projectInput)',ingestContext)).counts.projects,1);
assert.equal(persistedProjects[0].providerProjectId,'g-p-alpha');assert.equal(indexedProjects[0].type,'project');assert.equal(dirtyMarks,1);
storageFails=true;await assert.rejects(vm.runInContext('ingestBatch(projectInput)',ingestContext),/database unavailable/);
assert.equal(dirtyMarks,1,'failed storage cannot acknowledge a new durable project');

// Historical pure-policy fixtures still run; this test checks their live successor.
// Exercise the full worker's real ingestion/Pulse functions with the durable
// attention service. A late transport response must retain its source time all
// the way through the journal, legacy cache, persisted transition and UI result.
await import('../extension/src/attention-service.js');
const attentionCore=globalThis.ProjectConstellationAttentionService;
async function liveEvidenceFixture(){
  let clock=90_000_000,saved={},probe=async()=>null,failWrite=false;
  const rows=new Map(),transitions=[],events=[],presentations=[],legacyNotices=[];
  const tab={id:91,url:'https://claude.ai/chat/evidence',title:'Current task',windowId:1};
  const service=attentionCore.createService({now:()=>clock,read:async()=>structuredClone(saved),write:async(_key,value)=>{
    if(failWrite){failWrite=false;throw new Error('Evidence journal unavailable');}saved=structuredClone(value);
  }});
  await service.settings({audioEnabled:false,notificationsEnabled:false});
  const context=vm.createContext({console,URL,Date:{now:()=>clock},pcAttention:service,ProjectConstellationAttentionService:attentionCore,
    LIVE_SENTINEL_VERSION:manifest.version,LIVE_CHAT_PULSE_TTL_MS:0,LIVE_CHAT_PROBE_TIMEOUT_MS:1500,LIVE_CHAT_FALLBACK_TTL_MS:120000,
    providers:{detectProvider:()=>({id:'claude',name:'Claude'}),isLikelyChatUrl:()=>true,chatIdFromUrl:()=> 'evidence'},
    chrome:{tabs:{query:async()=>[tab],sendMessage:async()=>null}},
    networkStateForTab:()=>({}),livePulseBucket:state=>state.chat.status==='permission_required'?'hold':state.chat.status==='error'?'critical':state.chat.status==='idle'?'completed':'active',
    liveTabStateByTab:rows,readPersistedLiveTransition:async()=>null,persistLiveTransition:row=>transitions.push(structuredClone(row)),
    tabPresentationSignatures:new Map(),syncTabPresentation:async row=>presentations.push(structuredClone(row)),
    notifyChatCritical:async()=>legacyNotices.push('critical'),notifyReviewCleared:async()=>legacyNotices.push('cleared'),notifyChatCompletion:async()=>legacyNotices.push('completed'),notifyChatAttention:async()=>legacyNotices.push('attention'),
    stateBus:{publishCoalesced:(...args)=>events.push(args)},scheduleLiveTabReconcile:()=>{},
    readLiveSentinelState:async()=>probe(),ensureLiveSentinel:async()=>null,probeLiveStateFromTab:async()=>null,
    livePulseTimeout:async promise=>promise,liveGroupMap:async()=>new Map(),enrichLiveRowContext:async row=>row,canonicalLiveCatalogChatId:row=>row.chatId,renderActionBadge:async()=>{}});
  vm.runInContext('let liveChatPulseCacheAt=0,liveChatPulseCache=null,liveChatPulseRequest=null;\n'+
    ['sameLiveConversation','liveEvidenceTime','liveEvidenceMatchesTab','rememberLiveTabState','handleLiveChatStatePush','readLiveStateFromTab','fallbackLiveRow','withTabGroup','liveChatPulse'].map(name=>block(background,name)).join('\n'),context);
  const state=(status,observedAt=clock,extra={})=>({ok:true,sentinel:true,source:'live-sentinel',version:manifest.version,observedAt,
    chat:{id:'evidence',url:tab.url,title:tab.title,status},generation:{runId:'confirmed-run'},...extra});
  return {service,context,rows,transitions,events,presentations,legacyNotices,tab,state,now:()=>clock,advance:ms=>clock+=ms,
    failWrite:()=>{failWrite=true;},probe:fn=>{probe=fn;},read:()=>context.readLiveStateFromTab(tab),pulse:()=>context.liveChatPulse({force:true}),
    push:(status,at=clock,extra={})=>context.handleLiveChatStatePush({state:state(status,at,extra)},{tab}),saved:()=>structuredClone(saved)};
}
{
  const f=await liveEvidenceFixture();await f.push('permission_required');const latest=f.now(),writes=f.transitions.length,notices=f.legacyNotices.length,published=f.events.length;
  f.advance(100);const reply=await f.push('running',latest-50);
  assert.equal(reply.ignored,true);assert.equal(reply.reason,'out-of-order');
  let snapshot=await f.service.get();assert.equal(snapshot.sessions[0].observedAt,latest);assert.equal(snapshot.incidents[0].resolvedAt,0);
  assert.equal(f.rows.get(91).status,'permission_required');assert.equal(f.transitions.length,writes);assert.equal(f.legacyNotices.length,notices);assert.equal(f.events.length,published);
  f.probe(async()=>f.state('running',latest-25));const read=await f.read();
  assert.equal(read.status,'permission_required','a stale read returns the newer accepted row, never its rejected status');
  const pulse=await f.pulse();assert.equal(pulse.recentChats[0].status,'permission_required');assert.equal(pulse.counts.hold,1);
  assert.equal((await f.service.get()).incidents[0].resolvedAt,0);
  for(const invalid of [undefined,null,NaN,Infinity,-1,'90000000']){
    const ignored=await f.push('running',invalid,{observedAt:invalid});assert.equal(ignored.ignored,true,'malformed/missing push time cannot be laundered into current evidence');
  }
  const moved=await f.push('running',f.now(),{chat:{id:'other',url:'https://claude.ai/chat/other',status:'running'}});
  assert.equal(moved.ignored,true,'a reply from another conversation cannot be attached to the sender tab');
  snapshot=await f.service.get();assert.equal(snapshot.sessions[0].status,'permission_required');
}
{
  const f=await liveEvidenceFixture();let answer;f.probe(()=>new Promise(resolve=>{answer=resolve;}));
  const reading=f.read();await new Promise(setImmediate);const requestedAt=f.now();f.advance(25);await f.push('permission_required');
  f.advance(25);answer(f.state('running',undefined,{observedAt:undefined}));
  const result=await reading;assert.equal(result.status,'permission_required');assert.ok(result.observedAt>requestedAt);
  assert.equal((await f.service.get()).incidents[0].resolvedAt,0,'a legacy read without a timestamp uses request-start time, not the delayed receipt time');
}
{
  const f=await liveEvidenceFixture();f.failWrite();
  await assert.rejects(f.push('permission_required'),/Evidence journal unavailable/);
  assert.equal(f.rows.size,0);assert.equal(f.transitions.length,0);assert.equal(f.events.length,0,'failed durable acceptance cannot become a successful live push');
  await f.push('permission_required');assert.equal(f.rows.get(91).status,'permission_required');assert.equal(f.transitions.length,1);
  assert.equal(f.saved().sessions[0].status,'permission_required');
}
{
  const f=await liveEvidenceFixture();let finishOldRead,reads=0;
  f.context.readPersistedLiveTransition=()=>++reads===1?new Promise(resolve=>{finishOldRead=resolve;}):Promise.resolve(null);
  const first=f.push('permission_required');for(let i=0;i<10&&!finishOldRead;i++)await new Promise(setImmediate);
  assert.equal(typeof finishOldRead,'function');f.advance(10);await f.push('error');finishOldRead(null);const older=await first;
  assert.equal(older.ignored,true);assert.equal(f.rows.get(91).status,'error');assert.equal(f.transitions.length,1);
  assert.equal(f.transitions[0].status,'error','an earlier cache read completing late cannot rewrite the accepted transition');
}
{
  const f=await liveEvidenceFixture();await f.push('running');f.advance(10);let finishProbe;
  f.probe(()=>new Promise(resolve=>{finishProbe=resolve;}));const waiting=f.pulse();
  for(let i=0;i<10&&!finishProbe;i++)await new Promise(setImmediate);assert.equal(typeof finishProbe,'function');
  f.advance(10);await f.push('permission_required');const sourceAt=f.now();finishProbe(null);
  const fresh=await waiting;assert.equal(fresh.partial,false);assert.equal(fresh.recentChats[0].status,'permission_required');
  assert.equal((await f.service.get()).sessions[0].status,'permission_required','an unsuccessful read cannot suspend a push accepted while it was waiting');
  f.probe(async()=>null);f.advance(30);const unavailable=await f.pulse();assert.equal(unavailable.partial,true);
  let snapshot=await f.service.get();assert.equal(snapshot.sessions[0].status,'suspended');assert.equal(snapshot.sessions[0].observedAt,sourceAt);
  assert.equal(snapshot.sessions[0].runId,'confirmed-run','derived transport loss preserves the current source context');
  f.advance(10);await f.push('permission_required',sourceAt+5);snapshot=await f.service.get();
  assert.equal(snapshot.sessions[0].status,'permission_required');assert.equal(snapshot.sessions[0].observedAt,sourceAt+5);
  assert.equal(snapshot.incidents.length,1,'transport receipt time cannot hide a later provider observation or manufacture a new incident');
}
for(const delayedPhase of ['metadata','badge-settings']){
  const f=await liveEvidenceFixture();await f.push('running');const observedAt=f.now();f.tab.groupId=10;
  f.context.liveGroupMap=async()=>new Map([[10,{id:10,title:'hold',color:'blue'}]]);
  f.context.managedGroupBucket=title=>title;
  f.probe(async()=>f.state('running',observedAt));let release,first=true;const badgeTitles=[];
  f.context.enrichLiveRowContext=async row=>{
    if(delayedPhase==='metadata')await new Promise(resolve=>{release=resolve;});
    return {...row,catalogChatId:'claude:evidence',context:{projectName:'Preserved metadata'}};
  };
  if(delayedPhase==='badge-settings'){
    const badgeCfg={tabBeaconsEnabled:true,completedColor:'green',holdColor:'blue',activeColor:'purple'};
    f.context.liveToolbarSnapshot={};f.context.attentionBadgeCount=0;f.context.scheduledGuardianAttentionCount=0;
    f.context.pulseUxSettings=async()=>{if(first){first=false;await new Promise(resolve=>{release=resolve;});}return badgeCfg;};
    f.context.normalizePulseUx=()=>badgeCfg;
    f.context.chrome.action={setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{},setTitle:async({title})=>badgeTitles.push(title)};
    vm.runInContext(block(background,'renderActionBadge'),f.context);
  }
  const pending=f.pulse();for(let i=0;i<10&&!release;i++)await new Promise(setImmediate);assert.equal(typeof release,'function',delayedPhase);
  f.advance(25);await f.push('permission_required');f.presentations.length=0;release();
  const snapshot=await pending;await new Promise(setImmediate);
  assert.equal(snapshot.recentChats[0].status,'permission_required',`${delayedPhase} cannot publish an obsolete active row`);
  assert.equal(snapshot.counts.hold,1);assert.equal(snapshot.counts.active,0);assert.equal(snapshot.recentChats[0].context.projectName,'Preserved metadata');
  assert.equal(vm.runInContext('liveChatPulseCache.recentChats[0].status',f.context),'permission_required','cached results retain the newest accepted evidence too');
  assert.equal(f.presentations.filter(row=>row.bucket==='active').length,0,'late metadata/badge work cannot force the tab back into its older group');
  if(delayedPhase==='badge-settings')assert.ok(badgeTitles.length>0&&badgeTitles.every(title=>title.includes('on hold')),'a stale badge settings read cannot apply the earlier active title');
}
const testCommand=JSON.parse(read('package.json')).scripts.test;
for(const file of ['core','brain-core','provider-core','integrity-core','knowledge-core','project-memory-core','health-core','drive-sync-policy','drive-sync-guard','live-state-policy','navigation-safety','interruption-safety','tab-group-convergence','tab-supervisor-core','reliability-supervisor-contract']) {
  assert.ok(testCommand.includes(`node tests/${file}.test.mjs`),`retain original main gate ${file}`);
}
console.log('reliability-supervisor-contract.test.mjs: PASS (active graph, hidden tabs, source-time ordering, durable push ACKs, concurrent cache reads, Pulse reconciliation, manual holds, project persistence, original inventory)');
