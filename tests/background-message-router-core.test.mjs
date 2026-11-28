import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../extension/src/background-message-router-core.js', import.meta.url), 'utf8');
const context = vm.createContext({ console });
vm.runInContext(code, context);
const core = context.ProjectConstellationBackgroundMessageRouterCore;
assert.ok(core);
const router = core.createRouter();
router.register('A', async ({ value }) => value * 2);
assert.equal(router.has('A'), true);
assert.equal(JSON.stringify(router.list()), JSON.stringify(['A']));
const hit = await router.dispatch('A', { value: 4 });
assert.equal(hit.matched, true); assert.equal(hit.value, 8);
const miss = await router.dispatch('B', {});
assert.equal(miss.matched, false); assert.equal(miss.value, undefined);
assert.throws(() => router.register('A', () => {}), /already registered/i);
console.log('background message router core PASS');
