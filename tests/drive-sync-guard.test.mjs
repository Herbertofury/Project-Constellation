import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const settingsKey = 'projectConstellationBrainSettings';
const dirtyKey = 'projectConstellationDriveDirtyAt';
const evidenceKey = 'projectConstellationDriveAutoSyncConnectedAt';
const alarmName = 'project-constellation-drive-sync';
const storage = new Map();
const alarms = new Map();
const storageListeners = [];
const alarmListeners = [];

const chrome = {
  runtime: { getManifest: () => ({ oauth2:{ client_id:'123456789012-abcdefghijklmnopqrstuvwxyz.apps.googleusercontent.com' } }) },
  storage: {
    local: {
      async get(keys) {
        const list = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(list.map((key) => [key, storage.get(key)]));
      },
      async set(values) {
        const changes = {};
        for (const [key, value] of Object.entries(values || {})) {
          changes[key] = { oldValue:storage.get(key), newValue:value };
          storage.set(key, value);
        }
        for (const listener of storageListeners) listener(changes, 'local');
      },
      async remove(key) {
        const keys = Array.isArray(key) ? key : [key];
        const changes = {};
        for (const item of keys) { changes[item] = { oldValue:storage.get(item), newValue:undefined }; storage.delete(item); }
        for (const listener of storageListeners) listener(changes, 'local');
      }
    },
    onChanged: { addListener(listener) { storageListeners.push(listener); } }
  },
  alarms: {
    async create(name, info) { alarms.set(name, info || {}); },
    async clear(name) { return alarms.delete(name); },
    onAlarm: {
      addListener(listener) { alarmListeners.push(listener); },
      removeListener(listener) { const i=alarmListeners.indexOf(listener); if(i>=0) alarmListeners.splice(i,1); }
    }
  }
};
const context = { chrome, console, setTimeout, clearTimeout };
vm.runInNewContext(fs.readFileSync(new URL('../extension/src/drive-sync-policy.js', import.meta.url), 'utf8'), context);
vm.runInNewContext(fs.readFileSync(new URL('../extension/src/drive-sync-guard.js', import.meta.url), 'utf8'), context);
const tick = () => new Promise((resolve) => setTimeout(resolve, 15));
await tick();

const guardStatus = storage.get('projectConstellationDriveSyncGuardStatus');
assert.equal(guardStatus?.active, true, 'guard must successfully wrap alarm creation and dispatch in an extension-like API object');
let backgroundDriveCalls = 0;
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm?.name === alarmName) backgroundDriveCalls += 1; });

await chrome.storage.local.set({
  [settingsKey]: { drive:{ autoSync:true, lastStatus:'not-connected', folderId:'', snapshotFileId:'', journalFileId:'', indexFileId:'', lastSyncAt:0, lastRestoreAt:0 } },
  [dirtyKey]: Date.now()
});
await tick();
await chrome.alarms.create(alarmName, { when:Date.now()+1000 });
assert.equal(alarms.has(alarmName), false, 'never-connected dirty state must not schedule Drive auto-sync');

alarms.set(alarmName, { when:Date.now() });
for (const listener of [...alarmListeners]) listener({ name:alarmName });
await tick();
assert.equal(backgroundDriveCalls, 0, 'stale Drive alarm must be swallowed before background sync handles it');
assert.equal(alarms.has(alarmName), false, 'swallowed stale Drive alarm must be cleared');

await chrome.storage.local.set({ [settingsKey]: { drive:{ autoSync:true, lastStatus:'verified' } } });
await tick();
assert(Number(storage.get(evidenceKey) || 0) > 0, 'verified connection must persist connection evidence');
assert.equal(alarms.has(alarmName), true, 'reconnect with dirty state must schedule pending Drive work');

await chrome.storage.local.set({ [settingsKey]: { drive:{ autoSync:true, lastStatus:'disconnected', folderId:'stale-id' } } });
await tick();
assert.equal(storage.has(evidenceKey), false, 'explicit disconnect must clear connection evidence');
assert.equal(alarms.has(alarmName), false, 'explicit disconnect must clear pending Drive work');

console.log('drive-sync-guard.test.mjs: PASS');
