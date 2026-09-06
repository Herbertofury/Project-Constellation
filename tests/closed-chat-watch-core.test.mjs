import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../extension/src/closed-chat-watch-core.js', import.meta.url), 'utf8');
const context = vm.createContext({ console, URL, Date });
vm.runInContext(source, context, { filename:'closed-chat-watch-core.js' });
const core = context.ProjectConstellationClosedChatWatchCore;
assert.ok(core, 'closed-chat watch core should install a global API');

const parsed = {
  turns:[
    {id:'u1',role:'user',text:'hello'},
    {id:'a1',role:'assistant',text:'working on it'}
  ],
  textLength:200
};
const fp = core.parsedFingerprint(parsed,'fallback');
assert.equal(fp.signal,'turns');
assert.equal(fp.turnCount,2);
assert.equal(fp.assistantCount,1);
assert.match(fp.fingerprint,/^turns:2:/);

const start = 1_000_000;
let watch = core.normalizeWatch({
  key:'chatgpt:abc',url:'https://chatgpt.com/c/abc',title:'Test',providerId:'chatgpt',providerName:'ChatGPT',phase:'queued',active:true,closedAt:start,createdAt:start,updatedAt:start,nextCheckAt:start + 1000
});
watch = core.reduceProbe(watch,{...fp,etag:'v1'},start + 1000);
assert.equal(watch.phase,'baseline');
assert.equal(watch.active,true);
assert.equal(watch.seenProgress,false);

const fp2 = core.parsedFingerprint({turns:[...parsed.turns,{id:'a2',role:'assistant',text:'new persisted output'}],textLength:260},'fallback2');
watch = core.reduceProbe(watch,{...fp2,etag:'v2'},start + 90_000);
assert.equal(watch.phase,'progress');
assert.equal(watch.seenProgress,true);
assert.equal(watch.turnCount,3);
assert.ok(watch.nextCheckAt > start + 90_000);

watch = core.reduceProbe(watch,{...fp2},start + 4 * 60_000);
watch = core.reduceProbe(watch,{...fp2},start + 7 * 60_000);
assert.equal(watch.phase,'settling');
assert.equal(watch.active,true);
watch = core.reduceProbe(watch,{...fp2},start + 13 * 60_000);
watch = core.reduceProbe(watch,{...fp2},start + 16 * 60_000);
assert.equal(watch.phase,'settled');
assert.equal(watch.active,false);
assert.equal(core.presentation(watch).label,'Remote settled');

let errorWatch = core.normalizeWatch({key:'chatgpt:e',url:'https://chatgpt.com/c/e',providerId:'chatgpt',phase:'queued',active:true,closedAt:start,createdAt:start,updatedAt:start});
for (let i = 0; i < 4; i += 1) errorWatch = core.reduceProbe(errorWatch,{error:'HTTP 503'},start + (i + 1) * 120_000);
assert.equal(errorWatch.phase,'attention');
assert.equal(errorWatch.active,false);

let quiet = core.normalizeWatch({key:'chatgpt:q',url:'https://chatgpt.com/c/q',providerId:'chatgpt',phase:'baseline',active:true,closedAt:start,createdAt:start,updatedAt:start,fingerprint:'turns:1:x',signal:'turns'});
quiet = core.reduceProbe(quiet,{fingerprint:'turns:1:x',signal:'turns',turnCount:1},start + core.NO_PROGRESS_MAX_MS + 1000);
assert.equal(quiet.phase,'dormant');
assert.equal(quiet.active,false);

const pruned = core.pruneState({watches:{a:watch,b:errorWatch,c:quiet}},start + 17 * 60_000);
assert.equal(Object.keys(pruned.watches).length,3);

console.log('closed-chat-watch-core: ok');
