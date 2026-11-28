import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const vaultSource = fs.readFileSync(new URL('../extension/src/chat-vault-core.js', import.meta.url), 'utf8');
const policySource = fs.readFileSync(new URL('../extension/src/command-center-action-core.js', import.meta.url), 'utf8');
const runtimeSource = fs.readFileSync(new URL('../extension/src/command-center-actions.js', import.meta.url), 'utf8');

const makeTab = (id, title, pinned = false) => ({
  id,
  windowId:1,
  title,
  pinned,
  url:`https://chatgpt.com/c/${String(id).repeat(8)}-${String(id).repeat(4)}-${String(id).repeat(4)}-${String(id).repeat(4)}-${String(id).repeat(12)}`
});

const tabs = [makeTab(1,'Running'),makeTab(2,'Finished'),makeTab(3,'Pinned finished',true)];
let storage = {};
let ignoreVaultWrite = false;
let removedBatches = [];
let createdTabs = [];
let runtimeMessageListener = null;
const contextMenuListeners = [];
const alarmListeners = [];
const menus = [];
const alarms = [];

const storageLocal = {
  async get(keys) {
    if (typeof keys === 'string') return { [keys]:storage[keys] };
    if (Array.isArray(keys)) return Object.fromEntries(keys.map((key) => [key,storage[key]]));
    if (!keys) return { ...storage };
    return Object.fromEntries(Object.keys(keys).map((key) => [key,storage[key] ?? keys[key]]));
  },
  async set(values) {
    for (const [key,value] of Object.entries(values || {})) {
      if (ignoreVaultWrite && key === 'projectConstellationChatVaultV1') continue;
      storage[key] = value;
    }
  }
};

const stateByTab = new Map([
  [1,{ chat:{status:'running',healthState:'working'},generation:{active:true} }],
  [2,{ chat:{status:'idle',healthState:''},generation:{active:false} }],
  [3,{ chat:{status:'idle',healthState:''},generation:{active:false} }]
]);

const chrome = {
  storage:{
    local:storageLocal,
    onChanged:{ addListener() {} }
  },
  tabs:{
    async query() { return tabs.map((tab) => ({...tab})); },
    async sendMessage(tabId,message) {
      if (message?.type === 'PC_GET_LIVE_SENTINEL_STATE') return stateByTab.get(Number(tabId)) ?? null;
      return null;
    },
    async remove(ids) {
      const batch = (Array.isArray(ids) ? ids : [ids]).map(Number);
      removedBatches.push(batch);
    },
    async create(input) {
      createdTabs.push({...input});
      return {id:100 + createdTabs.length,windowId:1,...input};
    }
  },
  runtime:{
    lastError:null,
    getURL(path) { return `chrome-extension://project-constellation/${path}`; },
    onInstalled:{ addListener() {} },
    onStartup:{ addListener() {} },
    onMessage:{ addListener(listener) { runtimeMessageListener = listener; } }
  },
  alarms:{
    create(name,options) { alarms.push({name,options}); },
    onAlarm:{ addListener(listener) { alarmListeners.push(listener); } }
  },
  contextMenus:{
    create(props,callback) { menus.push({...props}); callback?.(); },
    remove(_id,callback) { callback?.(); },
    onClicked:{ addListener(listener) { contextMenuListeners.push(listener); } }
  },
  notifications:{
    async clear() { return true; },
    async create() { return 'notice'; }
  }
};

const context = vm.createContext({
  URL,console,Date,Math,Promise,Set,Map,Object,Array,String,Number,Boolean,RegExp,JSON,
  chrome,
  setTimeout:() => 1,
  clearTimeout:() => {}
});
vm.runInContext(vaultSource,context,{filename:'chat-vault-core.js'});
vm.runInContext(policySource,context,{filename:'command-center-action-core.js'});
vm.runInContext(runtimeSource,context,{filename:'command-center-actions.js'});
assert.equal(typeof runtimeMessageListener,'function','quick-action runtime must register a message listener');
assert.ok(alarms.some((row) => row.name === 'pc-command-center-menu-reconcile-once'),'startup must schedule one-shot context-menu recovery');
assert.ok(alarmListeners.length >= 1,'quick-action runtime must listen for its one-shot menu recovery alarm');

function invoke(message) {
  return new Promise((resolve,reject) => {
    let settled = false;
    const sendResponse = (value) => { settled = true; resolve(value); };
    try {
      const keepAlive = runtimeMessageListener(message,{},sendResponse);
      assert.equal(keepAlive,true,`message ${message.type} should keep response channel alive`);
    } catch (error) { reject(error); }
    queueMicrotask(() => { if (!settled) void 0; });
  });
}

removedBatches = [];
createdTabs = [];
let result = await invoke({type:'PC_COMMAND_CENTER_RUN_QUICK_ACTION',mode:'smart-collapse',openCommandCenter:true});
assert.equal(result.ok,true);
assert.equal(result.saved,3);
assert.equal(result.closed,1,'smart collapse should close only the proven-finished unpinned tab');
assert.equal(result.workingKept,1);
assert.equal(result.pinnedKept,1);
assert.deepEqual(removedBatches.flat(),[2]);
assert.equal(createdTabs.length,1,'background must open Command Center after a popup-safe quick action');
assert.match(createdTabs[0].url,/chat-vault\.html$/);
assert.equal(storage.projectConstellationChatVaultV1.stacks[0].items.length,3,'all tabs must be saved before smart collapse closes anything');

removedBatches = [];
createdTabs = [];
result = await invoke({type:'PC_COMMAND_CENTER_RUN_QUICK_ACTION',mode:'stash-close',openCommandCenter:true});
assert.equal(result.ok,true);
assert.equal(result.saved,3);
assert.equal(result.closed,2,'OneTab-style stash should close every unpinned AI tab');
assert.equal(result.pinnedKept,1,'pinned AI tabs must remain open');
assert.deepEqual(removedBatches.flat().sort((a,b) => a-b),[1,2]);
assert.equal(createdTabs.length,1);

removedBatches = [];
createdTabs = [];
result = await invoke({type:'PC_COMMAND_CENTER_RUN_QUICK_ACTION',mode:'gather',openCommandCenter:true});
assert.equal(result.ok,true);
assert.equal(result.closed,0,'gather mode must preserve all live tabs');
assert.deepEqual(removedBatches,[]);
assert.equal(createdTabs.length,1);

// Failure injection: if the vault write cannot be read back, destructive modes must
// stop before chrome.tabs.remove is ever reached.
storage = {};
ignoreVaultWrite = true;
removedBatches = [];
createdTabs = [];
result = await invoke({type:'PC_COMMAND_CENTER_RUN_QUICK_ACTION',mode:'stash-close',openCommandCenter:true});
assert.equal(result.ok,false);
assert.match(result.error,/Safety verification failed/);
assert.deepEqual(removedBatches,[],'verification failure must close zero tabs');
assert.deepEqual(createdTabs,[],'failed destructive action must not navigate away as if it succeeded');
ignoreVaultWrite = false;

console.log('command-center-actions-runtime: ok');
