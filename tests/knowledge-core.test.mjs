import assert from 'node:assert/strict';
await import('../extension/src/knowledge-core.js');
const k=globalThis.ProjectConstellationKnowledgeCore;
assert(k,'knowledge core loads');

const turn={
  id:'chatgpt:c1:t1',chatId:'chatgpt:c1',providerId:'chatgpt',role:'assistant',ordinal:4,updatedAt:1700000000000,
  text:`## Best mods\n- I recommend [ModernFix](https://www.curseforge.com/minecraft/mc-mods/modernfix) for performance.\n- My pick is https://github.com/embeddedt/ModernFix\n\nDecision: we'll use ModernFix v5.20.0 as the baseline.\nNext step: test the generated build and update README.md.\n\n\`\`\`java\npublic class PerfPatch {\n  public void applyFix() {}\n}\n\`\`\``,
  links:[{href:'https://www.curseforge.com/minecraft/mc-mods/modernfix?utm_source=x',text:'ModernFix',context:'Recommended performance mod'}]
};
const a=k.extractTurnKnowledge(turn,{projectId:'p-provider',workspaceProjectId:'p-work',workspaceProjectName:'Minecraft Performance',chatUrl:'https://chatgpt.com/c/c1'});
const b=k.extractTurnKnowledge(turn,{projectId:'p-provider',workspaceProjectId:'p-work',workspaceProjectName:'Minecraft Performance',chatUrl:'https://chatgpt.com/c/c1'});
assert.equal(a.fingerprint,b.fingerprint,'deterministic fingerprint');
assert.deepEqual(a.items.map(x=>x.id),b.items.map(x=>x.id),'deterministic ids');
assert(a.items.some(x=>x.kind==='mod'&&x.url.includes('curseforge.com')),'extracts mod link');
assert(a.items.some(x=>x.kind==='repository'&&x.url.includes('github.com/embeddedt/ModernFix')),'extracts GitHub repo');
assert(a.items.some(x=>x.kind==='recommendation'),'extracts recommendation');
assert(a.items.some(x=>x.kind==='decision'),'extracts decision');
assert(a.items.some(x=>x.kind==='follow-up'),'extracts follow-up');
assert(a.items.some(x=>x.kind==='version'&&x.versions.includes('5.20.0')),'extracts version');
const code=a.items.find(x=>x.kind==='code');
assert(code,'extracts code');
assert(code.symbols.some(x=>x.endsWith(':PerfPatch')),'extracts code type symbol');
assert(code.symbols.some(x=>x.endsWith(':applyFix')),'extracts method symbol');
assert(a.items.some(x=>x.kind==='reference'&&x.fileRefs.some(r=>r.includes('README.md'))),'extracts file reference');
assert(a.items.every(x=>x.workspaceProjectId==='p-work'),'preserves workspace project lineage');

const userTurn={id:'u1',chatId:'c2',role:'user',text:'Idea: add hoverboards to the mod. I want a searchable archive. TODO finish import.',updatedAt:1};
const userItems=k.extractTurnKnowledge(userTurn,{}).items;
assert(userItems.some(x=>x.kind==='idea'),'extracts user idea');
assert(userItems.some(x=>x.kind==='follow-up'),'extracts user follow-up');

console.log('knowledge-core.test.mjs: PASS');
