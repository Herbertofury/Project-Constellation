import assert from 'node:assert/strict';
await import('../extension/src/project-router-core.js');
const router=globalThis.ProjectConstellationProjectRouterCore;
const now=2_000_000_000_000;
const projects=[
  {id:'p-mc',sourceType:'workspace',name:'Bloom and Boom',description:'Minecraft creeper variants, Boomshroom models and animations',updatedAt:now},
  {id:'p-it',sourceType:'workspace',name:'INTA Support',description:'Windows and Outlook client support',updatedAt:now},
  {id:'provider',sourceType:'provider',name:'Inbox',updatedAt:now}
];
const chats=[
  {id:'mc1',workspaceProjectId:'p-mc',title:'Boomshroom model polish',tags:['minecraft','boomshroom'],lastExcerpt:'Improve mushroom cap animations and model fidelity',updatedAt:now},
  {id:'it1',workspaceProjectId:'p-it',title:'Outlook exchange disconnect',tags:['outlook','windows'],lastExcerpt:'Remote client support and Exchange repair',updatedAt:now},
  {id:'new',title:'Continue Boomshroom animation work',tags:['minecraft'],lastUserExcerpt:'Improve the boomshroom model hair animations and cap details',updatedAt:now}
];
const profiles=router.projectProfiles(projects,chats);
const candidates=router.routeChat(chats[2],profiles,{limit:3});
assert.ok(candidates.length>=1,'router should recognize a meaningful project match');
assert.equal(candidates[0].projectId,'p-mc');
assert.ok(candidates[0].score>=.48);
assert.equal(chats[2].workspaceProjectId,undefined,'routing is suggestion-only and must not mutate membership');
const suggestions=router.suggestions({projects,chats,limit:10});
assert.equal(suggestions[0].chatId,'new');
assert.equal(suggestions[0].candidate.projectId,'p-mc');
const fp=suggestions[0].candidate.fingerprint;
const dismissed={...chats[2],projectRouteDismissals:[{projectId:'p-mc',fingerprint:fp,dismissedAt:now}]};
assert.equal(router.suggestions({projects,chats:[chats[0],chats[1],dismissed],limit:10}).length,0,'exact dismissed suggestion should stay dismissed');
assert.deepEqual(router.routeChat({...chats[2],workspaceProjectId:'p-mc'},profiles),[],'already assigned chats are not rerouted');
console.log('project-router-core.test.mjs: PASS');
