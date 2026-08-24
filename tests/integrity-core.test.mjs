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
console.log('integrity-core.test.mjs: PASS');
