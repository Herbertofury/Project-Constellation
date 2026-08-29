import assert from 'node:assert/strict';
await import('../extension/src/project-memory-core.js');
const memory = globalThis.ProjectConstellationProjectMemoryCore;
const now = 2_000_000_000_000;
const project = {id:'p1',name:'Atlas'};
const chats = [
  {id:'c1',title:'Build brain',status:'running',updatedAt:now},
  {id:'c2',title:'Fix tabs',status:'stalled',updatedAt:now-5},
  {id:'c3',title:'Released',status:'idle',updatedAt:now-10},
  {id:'c4',title:'Old',status:'idle',organizedArchived:true,updatedAt:now-20}
];
const items = [
  {id:'d1',kind:'decision',title:'Keep provenance',text:'Keep provenance',chatId:'c1',sourceTurnId:'t1',sourceRole:'user',confidence:.9,updatedAt:now-3,canonicalKey:'d'},
  {id:'f1',kind:'follow-up',title:'Ship grouping',text:'Ship grouping',chatId:'c1',confidence:.9,updatedAt:now-2,canonicalKey:'f'},
  {id:'f2',kind:'follow-up',title:'Rejected old route',text:'Rejected old route',chatId:'c2',confidence:.9,updatedAt:now-1,canonicalKey:'f2',memoryDisposition:'ignored'},
  {id:'r1',kind:'repository',title:'Repo',url:'https://example.com',chatId:'c1',confidence:.99,updatedAt:now-4,canonicalKey:'r',memoryPinned:true}
];
const brain = memory.compileProjectBrain({project,chats,items,files:[{id:'x',name:'build.zip',updatedAt:now-6}],now});
assert.equal(brain.projectName,'Atlas');
assert.deepEqual(brain.counts,{active:1,attention:1,completed:1,archived:1,total:4});
assert.equal(brain.sections.nextActions.length,1);
assert.equal(brain.sections.nextActions[0].id,'f1');
assert.equal(brain.coverage.ignored,1);
assert.equal(brain.coverage.pinned,1);
assert.equal(brain.activeChats.length,2);
assert.ok(brain.workingSet.some((row)=>row.id==='r1'));
const same = memory.compileProjectBrain({project,chats,items,files:[{id:'x',name:'build.zip',updatedAt:now-6}],now:now+999});
assert.equal(brain.fingerprint,same.fingerprint,'fingerprint must not depend on compile time');
console.log('project-memory-core.test.mjs: PASS');
