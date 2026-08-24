import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const source=fs.readFileSync(new URL('../extension/src/brain-core.js',import.meta.url),'utf8');const context={globalThis:{},module:{exports:{}},URL,Date};context.globalThis=context;vm.createContext(context);vm.runInContext(source,context);const b=context.ProjectConstellationBrainCore;
assert.match(b.turnKey('chatgpt:abc','m1','user',1),/^chatgpt:abc:m1$/);const merged=b.mergeRecord({id:'x',createdAt:10,title:'old'},{id:'x',title:'new',updatedAt:20});assert.equal(merged.title,'new');assert.equal(merged.createdAt,10);
assert.equal(b.classifyChatStatus({approval:true,text:'Allow Google Drive access to continue'}),'blocked-approval');assert.equal(b.classifyChatStatus({error:true,text:'Something went wrong. Retry'}),'errored');assert.equal(b.classifyChatStatus({running:true,text:'Stop generating'}),'running');assert.equal(b.classifyChatStatus({paused:true,text:'Continue generating'}),'paused');
const snap=b.makeSnapshot({chats:[{id:'c',status:'stalled'}],turns:[{id:'t'}],turnRevisions:[{id:'r'}],outputSnapshots:[{id:'o'}],files:[],projects:[],events:[]});assert.equal(snap.schemaVersion,7);assert.equal(snap.summary.chats,1);assert.equal(snap.summary.turnRevisions,1);assert.equal(snap.summary.outputSnapshots,1);assert.equal(snap.summary.statusCounts.stalled,1);assert.equal(snap.schema,'project-constellation');
const rich={role:'assistant',text:'Complete result with a durable build and documentation.',links:[{href:'https://example.com/build.zip',text:'Build'}],codeBlocks:[{language:'js',text:'console.log("saved")'}],assets:[{kind:'image',url:'https://example.com/result.png',alt:'Result'}]};
const poor={role:'assistant',text:'Called tool\nCalled tool\nSearched 2 websites\nUsed browser skill'};
assert.notEqual(b.turnFingerprint(rich),b.turnFingerprint(poor));
assert(b.turnRichnessScore(rich)>b.turnRichnessScore(poor));
assert.match(b.outputObservationFingerprint([{id:'t',ordinal:1,fingerprint:b.turnFingerprint(rich)}]),/-/);
assert.deepEqual(Array.from(b.searchTerms('Google Drive drive RECOVERY recovery')), ['google','drive','recovery']);
assert.deepEqual(Array.from(b.searchTerms('项目 Constellation 数据库', 10)), ['项目','constellation','数据库']);

console.log('brain-core.test.mjs: PASS');
