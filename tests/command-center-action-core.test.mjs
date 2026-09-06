import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../extension/src/command-center-action-core.js', import.meta.url), 'utf8');
const context = vm.createContext({ console });
vm.runInContext(source, context, { filename:'command-center-action-core.js' });
const core = context.ProjectConstellationCommandCenterActionCore;
assert.ok(core, 'Command Center action core should install a global API');

assert.equal(core.normalizeMode('gather'),'gather');
assert.equal(core.normalizeMode('smart-collapse'),'smart-collapse');
assert.equal(core.normalizeMode('stash-close'),'stash-close');
assert.equal(core.normalizeMode('nonsense'),'gather');
assert.equal(core.modeMeta('stash-close').shortLabel,'OneTab-style');

const unpinned = { id:1, pinned:false };
const pinned = { id:2, pinned:true };
const running = { chat:{ status:'running', healthState:'working' }, generation:{ active:true } };
const toolStalled = { chat:{ status:'running', healthState:'tool-stalled' }, generation:{ active:false } };
const idle = { chat:{ status:'idle', healthState:'' }, generation:{ active:false } };
const errored = { chat:{ status:'errored', healthState:'send-failed' }, generation:{ active:false } };

assert.deepEqual(JSON.parse(JSON.stringify(core.closeDisposition('gather',unpinned,running))),{close:false,reason:'keep-live'});
assert.deepEqual(JSON.parse(JSON.stringify(core.closeDisposition('stash-close',unpinned,running))),{close:true,reason:'one-tab-style'});
assert.deepEqual(JSON.parse(JSON.stringify(core.closeDisposition('stash-close',pinned,running))),{close:false,reason:'pinned'});
assert.deepEqual(JSON.parse(JSON.stringify(core.closeDisposition('smart-collapse',unpinned,running))),{close:false,reason:'working'});
assert.deepEqual(JSON.parse(JSON.stringify(core.closeDisposition('smart-collapse',unpinned,toolStalled))),{close:false,reason:'working'});
assert.deepEqual(JSON.parse(JSON.stringify(core.closeDisposition('smart-collapse',unpinned,errored))),{close:false,reason:'attention'});
assert.deepEqual(JSON.parse(JSON.stringify(core.closeDisposition('smart-collapse',unpinned,idle))),{close:true,reason:'finished'});
assert.deepEqual(JSON.parse(JSON.stringify(core.closeDisposition('smart-collapse',unpinned,null))),{close:false,reason:'unproven'});
assert.deepEqual(JSON.parse(JSON.stringify(core.closeDisposition('smart-collapse',pinned,idle))),{close:false,reason:'pinned'});

console.log('command-center-action-core: ok');
