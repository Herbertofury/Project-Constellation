import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

await import('../extension/src/health-core.js');
const health = globalThis.ProjectConstellationHealthCore;
assert(health);

const source = fs.readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');
const start = source.indexOf('function migrateLiveHealthSettings(');
const end = source.indexOf('\nfunction deepMergeSettings(', start);
assert(start >= 0 && end > start, 'migrateLiveHealthSettings source must remain discoverable');
const fnSource = source.slice(start, end);
const sandbox = { health };
vm.createContext(sandbox);
vm.runInContext(`${fnSource}\nthis.migrateLiveHealthSettings = migrateLiveHealthSettings;`, sandbox);
const migrate = sandbox.migrateLiveHealthSettings;

const legacy = migrate({
  capacityWarningTurns: 180,
  capacityHandoffTurns: 260,
  capacityWarningChars: 240000,
  capacityHandoffChars: 400000
});
assert.equal(legacy.capacityProfileVersion, 2);
assert.equal(legacy.capacityWarningTurns, 120);
assert.equal(legacy.capacityHandoffTurns, 180);
assert.equal(legacy.capacityWarningChars, 160000);
assert.equal(legacy.capacityHandoffChars, 280000);

const custom = migrate({
  capacityWarningTurns: 145,
  capacityHandoffTurns: 225,
  capacityWarningChars: 190000,
  capacityHandoffChars: 330000
});
assert.equal(custom.capacityProfileVersion, 2);
assert.equal(custom.capacityWarningTurns, 145, 'custom user warning threshold must be preserved');
assert.equal(custom.capacityHandoffTurns, 225, 'custom user handoff threshold must be preserved');
assert.equal(custom.capacityWarningChars, 190000, 'custom user character threshold must be preserved');
assert.equal(custom.capacityHandoffChars, 330000, 'custom user character threshold must be preserved');

const alreadyMigrated = migrate({
  capacityProfileVersion: 2,
  capacityWarningTurns: 180,
  capacityHandoffTurns: 260,
  capacityWarningChars: 240000,
  capacityHandoffChars: 400000
});
assert.equal(alreadyMigrated.capacityWarningTurns, 180, 'profile-version marker prevents repeated migration');
assert.equal(alreadyMigrated.capacityHandoffTurns, 260);

console.log('capacity-settings-migration.test.mjs: PASS');
