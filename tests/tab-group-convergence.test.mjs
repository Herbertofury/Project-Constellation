import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');
const start = source.indexOf('function bucketPresentation(bucket, cfg)');
const end = source.indexOf('async function refreshAllTabPresentations()', start);
assert.ok(start >= 0 && end > start, 'group presentation implementation can be isolated');

const groups = new Map([
  [10, { id:10, windowId:1, title:'PC ✦ ⚠ Needs attention', color:'orange', collapsed:false }],
  [11, { id:11, windowId:1, title:'PC ✦ ✦ Active', color:'purple', collapsed:false }],
  [12, { id:12, windowId:1, title:'My work', color:'blue', collapsed:false }],
  [13, { id:13, windowId:1, title:'PC ✦ ✦ Atlas · Active', color:'purple', collapsed:false }]
]);
const tab = { id:7, windowId:1, groupId:10 };
let failNextManagedMove = false;
let groupMoveCalls = 0;
const timers = [];

const chrome = {
  tabs: {
    async get(id) { return Number(id) === tab.id ? { ...tab } : null; },
    async group(options) {
      groupMoveCalls += 1;
      if (failNextManagedMove) {
        failNextManagedMove = false;
        throw new Error('transient group API failure');
      }
      if (options.groupId !== undefined) {
        tab.groupId = Number(options.groupId);
        return tab.groupId;
      }
      const newId = 20;
      groups.set(newId, { id:newId, windowId:tab.windowId, title:'', color:'grey', collapsed:false });
      tab.groupId = newId;
      return newId;
    },
    async ungroup() { tab.groupId = -1; },
    async sendMessage(_id, message) {
      if (message.type === 'PC_TAB_BEACON_STATE') return { ok:true, version:'0.14.4' };
      if (message.type === 'PC_TAB_BEACON_APPLY') return { ok:true };
      return { ok:true };
    }
  },
  tabGroups: {
    async query({ windowId }) { return [...groups.values()].filter((row) => row.windowId === windowId).map((row) => ({ ...row })); },
    async get(id) { const group = groups.get(Number(id)); if (!group) throw new Error('group missing'); return { ...group }; },
    async update(id, patch) { const current = groups.get(Number(id)); if (!current) throw new Error('group missing'); Object.assign(current, patch); return { ...current }; }
  },
  scripting: { async executeScript() { return []; } }
};

const cfg = {
  tabBeaconsEnabled:true,
  tabTitleStatusEnabled:true,
  tabFaviconStatusEnabled:true,
  tabGroupingEnabled:true,
  activeEmoji:'✦', activeColor:'#7d73ff', activeGroupColor:'purple',
  staleEmoji:'⚠', staleColor:'#ff9f43', staleGroupColor:'orange',
  completedEmoji:'✓', completedColor:'#5ccf9d', completedGroupColor:'green'
};

const context = {
  console,
  chrome,
  TAB_GROUP_PREFIX:'PC ✦',
  TAB_BEACON_VERSION:'0.14.4',
  TAB_BEACON_FILE:'src/tab-beacon.js',
  tabGroupSyncQueue:Promise.resolve(),
  tabPresentationSignatures:new Map(),
  tabPresentationPendingSignatures:new Map(),
  tabPresentationRepairTimers:new Map(),
  liveTabStateByTab:new Map(),
  pulseUxSettings:async () => cfg,
  tabTagForRow:async () => '',
  setTimeout(fn, delay) { timers.push({ fn, delay }); return timers.length; },
  clearTimeout() {}
};
context.globalThis = context;

const isolated = source.slice(start, end) + `\nObject.assign(globalThis, { bucketPresentation, managedGroupBucket, managedGroupFor, verifyManagedTabGroup, syncTabGroupNow, syncTabGroup, scheduleTabPresentationRepair, syncTabPresentation });`;
vm.runInNewContext(isolated, context, { filename:'background-group-convergence.js' });

const activeRow = { tabId:7, bucket:'active' };

// Exact regression: a transient Chrome group-move failure must not become sticky.
failNextManagedMove = true;
let result = await context.syncTabGroupNow(activeRow, cfg);
assert.equal(result.ok, false, 'first transient move reports failure');
assert.equal(tab.groupId, 10, 'tab remains in Needs attention after failed Chrome mutation');

result = await context.syncTabGroupNow(activeRow, cfg);
assert.equal(result.ok, true, 'same desired active state is retryable');
assert.equal(tab.groupId, 11, 'second reconciliation moves tab into Active');
assert.equal(result.bucket, 'active', 'post-move verification confirms the actual managed bucket');

// Project + state mode keeps parallel project work in its own managed lane.
cfg.tabGroupingMode = 'project-status';
tab.groupId = 10;
const projectRow = { tabId:7, bucket:'active', context:{ projectName:'Atlas' } };
result = await context.syncTabGroupNow(projectRow, cfg);
assert.equal(result.ok, true, 'project-aware reconciliation succeeds');
assert.equal(tab.groupId, 13, 'project-aware mode moves the tab into Atlas Active rather than the global Active lane');
assert.equal(result.title, 'PC ✦ ✦ Atlas · Active');

// State-only remains a first-class compatibility option.
cfg.tabGroupingMode = 'status';

// User-created groups are immutable under automatic status sorting.
tab.groupId = 12;
const callsBeforeUserGroup = groupMoveCalls;
result = await context.syncTabGroupNow(activeRow, cfg);
assert.equal(result.ok, true);
assert.equal(result.skipped, 'user-group');
assert.equal(tab.groupId, 12, 'user-created group stays untouched');
assert.equal(groupMoveCalls, callsBeforeUserGroup, 'automatic grouping does not steal a user group');

// Presentation cache must only commit after Chrome confirms the move.
tab.groupId = 10;
context.liveTabStateByTab.set(7, activeRow);
context.tabPresentationSignatures.clear();
failNextManagedMove = true;
result = await context.syncTabPresentation(activeRow);
assert.equal(result.ok, false, 'presentation reports failed group reconciliation');
assert.equal(context.tabPresentationSignatures.has(7), false, 'failed move is not cached as applied');
assert.ok(timers.length >= 1, 'failed move schedules a bounded repair');

result = await context.syncTabPresentation(activeRow);
assert.equal(result.ok, true, 'identical healthy state is attempted again rather than suppressed');
assert.equal(tab.groupId, 11, 'retry converges the tab to Active');
assert.equal(context.tabPresentationSignatures.has(7), true, 'signature commits only after verified convergence');

console.log('tab-group-convergence.test.mjs: PASS');
