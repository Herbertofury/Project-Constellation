import assert from 'node:assert/strict';
await import('../extension/src/project-memory-core.js');
await import('../extension/src/project-intelligence-core.js');
const memory=globalThis.ProjectConstellationProjectMemoryCore;
const intelCore=globalThis.ProjectConstellationProjectIntelligenceCore;
const now=2_000_000_000_000;
const project={id:'p1',name:'Project Constellation'};
const chats=[
  {id:'c1',title:'Build v0.17 dependency brain',status:'running',lastExcerpt:'dependency brain performance validation',updatedAt:now-50,url:'https://chatgpt.com/c/one'},
  {id:'c2',title:'Dependency brain performance validation',status:'running',lastExcerpt:'dependency brain optimization validation',updatedAt:now-70,url:'https://chatgpt.com/c/two'},
  {id:'c3',title:'Ship v0.16.0 release',status:'idle',lastExcerpt:'release artifact and performance benchmark',updatedAt:now-100,url:'https://chatgpt.com/c/three'}
];
const items=[
  {id:'v16',kind:'version',title:'v0.16.0',text:'Project Constellation v0.16.0 released',chatId:'c3',confidence:.9,updatedAt:now-120,canonicalKey:'project-version-16'},
  {id:'v17',kind:'version',title:'v0.17.0',text:'Project Constellation v0.17.0 dependency brain',chatId:'c1',confidence:.9,updatedAt:now-10,canonicalKey:'project-version-17'},
  {id:'d1',kind:'decision',title:'Guard provider writes',text:'Provider chat context requires explicit user approval before staging.',chatId:'c1',confidence:.99,updatedAt:now-45,canonicalKey:'guard-provider-writes'},
  {id:'f1',kind:'follow-up',title:'Validate dependency brain',text:'Validate dependency brain performance after guard provider writes.',chatId:'c1',confidence:.9,updatedAt:now-40,canonicalKey:'validate-dependency'},
  {id:'r1',kind:'recommendation',title:'Performance validation',text:'Use bounded performance validation and avoid blocking live capture.',chatId:'c1',confidence:.92,updatedAt:now-35,canonicalKey:'perf-validation'},
  {id:'r2',kind:'recommendation',title:'Performance validation',text:'Use bounded performance validation and avoid blocking live capture.',chatId:'c2',confidence:.91,updatedAt:now-34,canonicalKey:'perf-validation'},
  {id:'d2',kind:'decision',title:'Guard provider writes',text:'Provider chat context requires explicit user approval before staging.',chatId:'c2',confidence:.98,updatedAt:now-33,canonicalKey:'guard-provider-writes'}
];
const files=[
  {id:'f16',name:'Project-Constellation-v0.16.0-unpacked.zip',chatId:'c3',updatedAt:now-110},
  {id:'f17',name:'Project-Constellation-v0.17.0-unpacked.zip',chatId:'c1',updatedAt:now-5}
];
const brain=memory.compileProjectBrain({project,chats,items,files,now});
const intel=intelCore.compileProjectIntelligence({project,chats,items,files,brain,watermarkAt:now-60});
assert.equal(intel.versions.currentProjectVersion,'v0.17.0');
assert.ok(intel.versions.older.some((row)=>row.versionText==='v0.16.0'));
assert.ok(intel.dependencies.edges.length>0,'dependency edges should be inferred from source-backed sequence/overlap');
assert.ok(intel.dependencies.stale.some((row)=>row.status==='older-version'));
assert.ok(intel.duplicates.length>=1,'two active chats with strong shared focus should produce a duplicate-work review');
assert.ok(intel.handoffs.some((row)=>row.target.id==='c1'||row.target.id==='c2'),'cross-chat handoffs should be source-backed and target active chats');
assert.ok(intel.changes.items.length>0,'what-changed should respect the watermark');
const packet=intelCore.compileChatContext({project,chat:chats[0],chats,items,files,brain,intelligence:intel});
assert.ok(packet.relevant.length>0);
assert.ok(packet.generalLessons.some((row)=>row.label.includes('Performance')||row.text.includes('performance')),'repeated project-wide performance lessons should remain available to per-chat context');
const markdown=intelCore.contextMarkdown(packet);
assert.match(markdown,/not sent automatically/i);
assert.ok(intel.autopilot.proposals.length>0);
assert.ok(intel.autopilot.proposals.every((row)=>row.requiresApproval===true),'all Guarded Autopilot proposals require review');
const providerWrites=intel.autopilot.proposals.filter((row)=>row.providerWrite);
assert.ok(providerWrites.length>0,'at least one context/handoff provider-write proposal should exist');
const denied=intelCore.compileProjectIntelligence({project,chats,items,files,brain,watermarkAt:now-60,ledger:{[providerWrites[0].fingerprint]:{fingerprint:providerWrites[0].fingerprint,status:'denied',reviewedAt:now}}});
assert.ok(!denied.autopilot.proposals.some((row)=>row.fingerprint===providerWrites[0].fingerprint),'denied exact proposal fingerprints stay suppressed');
console.log('project-intelligence-core.test.mjs: PASS');
