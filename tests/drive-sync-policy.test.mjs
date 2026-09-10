import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../extension/src/drive-sync-policy.js', import.meta.url), 'utf8');
const context = { globalThis: {} };
vm.runInNewContext(source, context);
const policy = context.globalThis.ProjectConstellationDriveSyncPolicy;

assert(policy, 'drive sync policy must export to globalThis');
assert.equal(policy.autoSyncEligible({ oauthProvisioned:true, drive:{ autoSync:true, lastStatus:'not-connected' } }), false, 'never-connected production OAuth must not auto-sync');
assert.equal(policy.autoSyncEligible({ oauthProvisioned:true, drive:{ autoSync:true, lastStatus:'disconnected', folderId:'stale-folder' } }), false, 'explicit disconnect must beat stale remote IDs');
assert.equal(policy.autoSyncEligible({ oauthProvisioned:true, drive:{ autoSync:true, lastStatus:'verified' } }), true, 'fresh verified connection can auto-sync before first folder is created');
assert.equal(policy.autoSyncEligible({ oauthProvisioned:true, drive:{ autoSync:true, lastStatus:'error', connectedAt:123 } }), true, 'transient error after an explicit connection remains retryable');
assert.equal(policy.autoSyncEligible({ oauthProvisioned:true, drive:{ autoSync:true, lastStatus:'error', folderId:'existing-folder' } }), true, 'upgraded connected installs without connectedAt remain retryable from remote identity evidence');
assert.equal(policy.autoSyncEligible({ oauthProvisioned:true, drive:{ autoSync:true, lastStatus:'error' } }), false, 'legacy never-connected error state must not retry forever');
assert.equal(policy.autoSyncEligible({ oauthProvisioned:false, drive:{ autoSync:true, lastStatus:'verified', connectedAt:123 } }), false, 'development build without OAuth must not schedule Drive');
assert.equal(policy.autoSyncEligible({ oauthProvisioned:true, drive:{ autoSync:false, lastStatus:'verified', connectedAt:123 } }), false, 'disabled auto-sync remains disabled');
assert.equal(policy.hasConnectionEvidence({ lastStatus:'synced' }), true);
assert.equal(policy.hasConnectionEvidence({ lastStatus:'syncing' }), false, 'orphaned operation state alone is not proof of a prior Drive connection');
assert.equal(policy.hasConnectionEvidence({ lastStatus:'restoring' }), false, 'orphaned restore state alone is not proof of a prior Drive connection');
assert.equal(policy.hasConnectionEvidence({ lastStatus:'', lastSyncAt:456 }), true);

const worker = fs.readFileSync(new URL('../extension/service-worker.js', import.meta.url), 'utf8');
const guard = fs.readFileSync(new URL('../extension/src/drive-sync-guard.js', import.meta.url), 'utf8');
const policyImport = worker.indexOf("import './src/drive-sync-policy.js'");
const guardImport = worker.indexOf("import './src/drive-sync-guard.js'");
const backgroundImport = worker.indexOf("import './background.js'");
assert(policyImport >= 0 && guardImport > policyImport && backgroundImport > guardImport, 'Drive policy/guard must load before background registers alarms');
assert.match(guard, /chrome\.alarms\.create = guardedCreate/, 'guard must gate Drive alarm creation');
assert.match(guard, /alarmEvent\.addListener = guardedAddListener/, 'guard must gate stale Drive alarm dispatch before background handles it');
assert.match(guard, /projectConstellationDriveAutoSyncConnectedAt/, 'guard must persist independent prior-connection evidence');
assert.match(guard, /originalClear\(DRIVE_SYNC_ALARM\)/, 'disconnect/never-connected states must clear pending Drive alarms');
assert.match(guard, /state\.dirtyAt/, 'automatic Drive work must require real dirty state');
assert.match(guard, /Date\.now\(\) \+ 1000/, 'reconnect must resume already-dirty work promptly');
assert.match(guard, /createPatched && listenerPatched/, 'guard health must report whether both Chrome API hooks are active');

console.log('drive-sync-policy.test.mjs: PASS');
