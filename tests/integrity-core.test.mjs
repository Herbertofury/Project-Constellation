import assert from 'node:assert/strict';
await import('../extension/src/integrity-core.js');
const core = globalThis.ProjectConstellationIntegrityCore;
assert(core);
assert.equal(core.compareVersions('0.9.0','0.10.0'), -1);
assert.equal(core.compareVersions('1.2.1','1.2.0'), 1);
assert.equal(core.projectScopedVersion('Project Constellation v0.10.0 source.zip',{name:'Project Constellation'},{artifact:true}).version,'0.10.0');
assert.equal(core.projectScopedVersion('forge 1.20.1 jar',{name:'JetSetCraft'},{artifact:true}), null);
const result = core.analyzeProject({
  project:{id:'p1',name:'Project Constellation'},
  chats:[{id:'c1',title:'Project Constellation v0.9.0 work',status:'running',updatedAt:10},{id:'c2',title:'Project Constellation v0.10.0 release',status:'idle',updatedAt:20},{id:'c3',title:'Project Constellation v0.10.0 follow-up',status:'idle',updatedAt:22},{id:'c4',title:'Project Constellation v0.10.0 timeout',status:'refresh-required',statusDetail:'Message delivery timed out. Please try again.',updatedAt:23}],
  files:[{id:'f1',name:'Project-Constellation-v0.10.0-source.zip',sha256:'aaa',updatedAt:20},{id:'f2',name:'Project-Constellation-v0.10.0-source.zip',sha256:'bbb',updatedAt:21}],
  turns:[{id:'t1',chatId:'c2',role:'assistant',ordinal:1,text:'Implemented approval recovery and verified it working.',updatedAt:20},{id:'t2',chatId:'c2',role:'assistant',ordinal:2,text:'Approval recovery is broken after the latest change.',updatedAt:21},{id:'t3',chatId:'c3',role:'user',ordinal:1,text:'Please finish the remaining compatibility validation.',updatedAt:22}], now:30
});
assert.equal(result.baseline.latestVersion,'0.10.0');
assert(result.findings.some((f)=>f.type==='old-version-chat'&&f.chatId==='c1'));
assert(result.findings.some((f)=>f.type==='artifact-hash-conflict'));
assert(result.findings.some((f)=>f.type==='feature-regression-signal'));
assert(result.findings.some((f)=>f.type==='unanswered-chat'&&f.chatId==='c3'));
assert(result.findings.some((f)=>f.type==='refresh-required'&&f.chatId==='c4'&&/browser refresh/i.test(f.detail)));

const rollback = core.analyzeProject({
  project:{id:'p2',name:'Project Constellation'},
  chats:[{id:'rollback-chat',title:'Project Constellation v0.9.0 recovered state',status:'idle',updatedAt:40}],
  files:[{id:'rollback-file',name:'Project-Constellation-v0.9.0-source.zip',sha256:'ccc',updatedAt:40}],
  turns:[], previousBaseline:{latestVersion:'0.10.0',latestVersionSource:'Project-Constellation-v0.10.0-source.zip'}, now:50
});
assert(rollback.findings.some((f)=>f.type==='project-version-rollback'&&f.severity==='critical'&&f.evidence.previousVersion==='0.10.0'&&f.evidence.currentVersion==='0.9.0'));

const now = 2_000_000;
const liveTruth = core.analyzeProject({
  project:{id:'p3',name:'Project Constellation'},
  chats:[
    {id:'live-stall',title:'Project Constellation v0.14.12 truth run',status:'running',liveHealthState:'tool-stalled',liveHealthDetail:'Tool card and request lifecycle are both stale.',liveHealthUpdatedAt:now-1000,updatedAt:now-1000},
    {id:'uncertain',title:'Project Constellation v0.14.12 uncertain run',status:'running',liveHealthState:'uncertain-working',liveHealthDetail:'Activity uncertain · do not interrupt yet',liveHealthUpdatedAt:now-1000,updatedAt:now-1000},
    {id:'capacity',title:'Project Constellation v0.14.12 capacity run',status:'running',liveHealthState:'capacity-reached',liveHealthDetail:'Provider reports conversation maximum length.',liveHealthUpdatedAt:now-1000,updatedAt:now-1000},
    {id:'stale-live',title:'Project Constellation v0.14.12 stale health',status:'running',liveHealthState:'tool-dead',liveHealthUpdatedAt:now-(16*60*1000),updatedAt:now-1000}
  ],
  files:[],
  turns:[
    {id:'u1',chatId:'uncertain',role:'user',ordinal:1,text:'Continue the work.',updatedAt:now-1500}
  ], now
});
assert(liveTruth.findings.some((f)=>f.type==='chat-tool-stalled'&&f.chatId==='live-stall'&&f.severity==='warning'));
assert(liveTruth.findings.some((f)=>f.type==='chat-capacity-reached'&&f.chatId==='capacity'&&f.severity==='critical'));
assert(!liveTruth.findings.some((f)=>f.chatId==='uncertain'&&(f.type==='unanswered-chat'||f.type==='chat-uncertain-working')));
assert(!liveTruth.findings.some((f)=>f.chatId==='stale-live'&&f.type==='chat-tool-dead'));
assert.equal(core.executionState({status:'running',liveHealthState:'tool-stalled',liveHealthUpdatedAt:now-1},now),'tool-stalled');
assert.equal(core.executionState({status:'running',liveHealthState:'tool-stalled',liveHealthUpdatedAt:now-(16*60*1000)},now),'running');
console.log('integrity-core.test.mjs: PASS');
