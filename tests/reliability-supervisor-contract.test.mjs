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
const testCommand=JSON.parse(read('package.json')).scripts.test;
for(const file of ['core','brain-core','provider-core','integrity-core','knowledge-core','project-memory-core','health-core','drive-sync-policy','drive-sync-guard','live-state-policy','navigation-safety','interruption-safety','tab-group-convergence','tab-supervisor-core','reliability-supervisor-contract']) {
  assert.ok(testCommand.includes(`node tests/${file}.test.mjs`),`retain original main gate ${file}`);
}
console.log('reliability-supervisor-contract.test.mjs: PASS (active graph, hidden tabs, fresh ACKs, manual holds, project persistence, original inventory)');
