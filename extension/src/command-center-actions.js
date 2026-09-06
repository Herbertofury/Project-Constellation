(() => {
  'use strict';

  const vaultCore = globalThis.ProjectConstellationChatVaultCore;
  const actionCore = globalThis.ProjectConstellationCommandCenterActionCore;
  if (!vaultCore || !actionCore) return;

  const MENU = Object.freeze({
    open:'pc-command-center-open',
    run:'pc-command-center-run',
    stashNow:'pc-command-center-stash-now',
    sep:'pc-command-center-separator',
    modeRoot:'pc-command-center-mode-root',
    modePrefix:'pc-command-center-mode:'
  });
  const MENU_RECONCILE_ALARM = 'pc-command-center-menu-reconcile-once';
  const RECONCILE_DELAYS = Object.freeze([250,2200,6500]);
  const ERROR_NOTIFICATION_ID = 'pc-command-center-quick-action-error';
  let menuTimers = [];

  const clean = vaultCore.clean;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve,ms));

  function withTimeout(promise,ms,fallback = null) {
    return Promise.race([
      Promise.resolve(promise).catch(() => fallback),
      wait(ms).then(() => fallback)
    ]);
  }

  async function readMode() {
    const stored = await chrome.storage.local.get(actionCore.QUICK_ACTION_KEY).catch(() => ({}));
    return actionCore.normalizeMode(stored?.[actionCore.QUICK_ACTION_KEY]);
  }

  async function writeMode(value) {
    const mode = actionCore.normalizeMode(value);
    await chrome.storage.local.set({ [actionCore.QUICK_ACTION_KEY]:mode });
    scheduleMenuReconcile(80);
    return mode;
  }

  async function recordResult(result) {
    const row = { ...(result || {}),finishedAt:Number(result?.finishedAt || Date.now()) };
    await chrome.storage.local.set({ [actionCore.LAST_ACTION_KEY]:row }).catch(() => {});
    return row;
  }

  async function querySupportedTabs() {
    const tabs = await chrome.tabs.query({});
    return tabs.filter((tab) => tab?.id && vaultCore.isSupportedChatUrl(tab.url || ''));
  }

  async function resolveProject(vaultInput,prefs = {}) {
    let vault = vaultCore.normalizeVault(vaultInput);
    let target = prefs?.view === 'project' ? vault.stacks.find((stack) => stack.id === vault.selectedStackId) || null : null;
    if (!target) {
      const ensured = vaultCore.ensureStack(vault,vaultCore.LIVE_PROJECT_NAME,{select:true,color:'#8b5cf6'});
      vault = ensured.vault;
      target = ensured.stack;
    }
    return { vault,target };
  }

  async function saveAndVerifyTabs(tabs) {
    const stamp = Date.now();
    const items = tabs.map((tab) => vaultCore.tabToItem(tab,stamp)).filter(Boolean);
    const stored = await chrome.storage.local.get([vaultCore.VAULT_KEY,vaultCore.COMMAND_CENTER_PREFS_KEY]);
    const prefs = stored?.[vaultCore.COMMAND_CENTER_PREFS_KEY] || {};
    let { vault,target } = await resolveProject(stored?.[vaultCore.VAULT_KEY],prefs);

    for (const item of items) {
      for (const stack of vault.stacks) {
        if (stack.id !== target.id) stack.items = stack.items.filter((row) => row.key !== item.key);
      }
    }
    target = vault.stacks.find((stack) => stack.id === target.id) || target;
    target.items = vaultCore.mergeItems(target.items,items);
    target.updatedAt = stamp;
    vault.selectedStackId = target.id;
    vault.updatedAt = stamp;

    const nextPrefs = {
      ...prefs,
      view:'project',
      attentionFirst:prefs?.attentionFirst !== false
    };
    await chrome.storage.local.set({
      [vaultCore.VAULT_KEY]:vault,
      [vaultCore.COMMAND_CENTER_PREFS_KEY]:nextPrefs
    });

    const verify = await chrome.storage.local.get(vaultCore.VAULT_KEY);
    const savedVault = vaultCore.normalizeVault(verify?.[vaultCore.VAULT_KEY]);
    const saved = savedVault.stacks.find((stack) => stack.id === target.id);
    const savedKeys = new Set(saved?.items?.map((item) => item.key) || []);
    const verified = items.length > 0 && items.every((item) => savedKeys.has(item.key));
    return { verified,items,target:saved || target,vault:savedVault };
  }

  async function sentinelState(tabId) {
    if (!tabId) return null;
    return withTimeout(chrome.tabs.sendMessage(tabId,{type:'PC_GET_LIVE_SENTINEL_STATE'}),850,null);
  }

  async function dispositionsFor(mode,tabs) {
    if (mode === 'gather') return tabs.map((tab) => ({tab,state:null,...actionCore.closeDisposition(mode,tab,null)}));
    if (mode === 'stash-close') return tabs.map((tab) => ({tab,state:null,...actionCore.closeDisposition(mode,tab,null)}));
    const states = await Promise.all(tabs.map((tab) => sentinelState(tab.id)));
    return tabs.map((tab,index) => ({tab,state:states[index],...actionCore.closeDisposition(mode,tab,states[index])}));
  }

  async function closeTabIds(ids) {
    const unique = [...new Set(ids.map(Number).filter(Boolean))];
    if (!unique.length) return [];
    try {
      await chrome.tabs.remove(unique);
      return unique;
    } catch (_) {
      const closed = [];
      for (const id of unique) {
        try { await chrome.tabs.remove(id); closed.push(id); } catch (_) {}
      }
      return closed;
    }
  }

  async function runQuickAction(modeOverride = '') {
    const mode = actionCore.normalizeMode(modeOverride || await readMode());
    const tabs = await querySupportedTabs();
    if (!tabs.length) return recordResult({ ok:false,error:'No open supported AI chat tabs found.',mode,saved:0,closed:0,kept:0 });

    const saved = await saveAndVerifyTabs(tabs);
    if (!saved.verified) {
      return recordResult({ ok:false,error:'Safety verification failed. No AI tabs were closed.',mode,saved:0,closed:0,kept:tabs.length });
    }

    const dispositions = await dispositionsFor(mode,tabs);
    const closeRows = dispositions.filter((row) => row.close);
    const closeIds = closeRows.map((row) => row.tab.id);
    const closedIds = await closeTabIds(closeIds);
    const closedSet = new Set(closedIds.map(Number));
    const keptRows = dispositions.filter((row) => !closedSet.has(Number(row.tab.id)));
    const failedCloseRows = closeRows.filter((row) => !closedSet.has(Number(row.tab.id)));
    const reasons = keptRows.reduce((out,row) => {
      out[row.reason] = Number(out[row.reason] || 0) + 1;
      return out;
    },{});

    return recordResult({
      ok:true,
      mode,
      modeLabel:actionCore.modeMeta(mode).shortLabel,
      projectId:saved.target?.id || '',
      projectName:saved.target?.name || vaultCore.LIVE_PROJECT_NAME,
      saved:saved.items.length,
      closed:closedIds.length,
      closeFailed:failedCloseRows.length,
      kept:keptRows.length,
      pinnedKept:Number(reasons.pinned || 0),
      workingKept:Number(reasons.working || 0),
      attentionKept:Number(reasons.attention || 0),
      uncertainKept:Number(reasons.unproven || 0) + Number(reasons.uncertain || 0),
      reasons
    });
  }

  function resultMessage(result) {
    if (!result?.ok) return clean(result?.error || 'Quick action failed.',180);
    if (result.mode === 'gather') return `Gathered ${result.saved} AI chat${result.saved === 1 ? '' : 's'} into ${result.projectName}. Tabs stayed live.`;
    if (result.mode === 'smart-collapse') {
      const kept = [];
      if (result.workingKept) kept.push(`${result.workingKept} working`);
      if (result.attentionKept) kept.push(`${result.attentionKept} attention`);
      if (result.pinnedKept) kept.push(`${result.pinnedKept} pinned`);
      if (result.uncertainKept) kept.push(`${result.uncertainKept} uncertain`);
      if (result.closeFailed) kept.push(`${result.closeFailed} close failed`);
      return `Smart-collapsed ${result.closed} finished AI tab${result.closed === 1 ? '' : 's'} after saving ${result.saved}.${kept.length ? ` Kept ${kept.join(', ')} open.` : ''}`;
    }
    const tail = [];
    if (result.pinnedKept) tail.push(`${result.pinnedKept} pinned stayed open`);
    if (result.closeFailed) tail.push(`${result.closeFailed} could not be closed`);
    return `Stashed ${result.saved} AI chat${result.saved === 1 ? '' : 's'} and closed ${result.closed} unpinned tab${result.closed === 1 ? '' : 's'}${tail.length ? `; ${tail.join(', ')}` : ''}.`;
  }

  async function notifyContextFailure(result) {
    if (result?.ok || !chrome.notifications?.create) return;
    const message = clean(result?.error || 'The AI tab quick action stopped safely.',220);
    await chrome.notifications.clear(ERROR_NOTIFICATION_ID).catch(() => {});
    await chrome.notifications.create(ERROR_NOTIFICATION_ID,{
      type:'basic',
      iconUrl:chrome.runtime.getURL('assets/constellation-field.svg'),
      title:'AI tab action stopped safely',
      message,
      contextMessage:'Project Constellation Command Center',
      priority:1,
      requireInteraction:false
    }).catch(() => null);
  }

  function contextCreate(props) {
    return new Promise((resolve) => {
      if (!chrome.contextMenus?.create) return resolve(false);
      try {
        chrome.contextMenus.create(props,() => { void chrome.runtime.lastError; resolve(true); });
      } catch (_) { resolve(false); }
    });
  }

  function contextRemove(id) {
    return new Promise((resolve) => {
      if (!chrome.contextMenus?.remove) return resolve(false);
      try {
        chrome.contextMenus.remove(id,() => { void chrome.runtime.lastError; resolve(true); });
      } catch (_) { resolve(false); }
    });
  }

  async function ensureActionMenus() {
    if (!chrome.contextMenus?.create) return;
    const mode = await readMode();
    const meta = actionCore.modeMeta(mode);
    const modeIds = actionCore.MODES.map((value) => `${MENU.modePrefix}${value}`);
    for (const id of [...modeIds,MENU.modeRoot,MENU.sep,MENU.stashNow,MENU.run,MENU.open]) await contextRemove(id);

    await contextCreate({ id:MENU.open,title:'Open AI Command Center',contexts:['action'] });
    await contextCreate({ id:MENU.run,title:`Run quick action: ${meta.shortLabel}`,contexts:['action'] });
    await contextCreate({ id:MENU.stashNow,title:'Stash + close AI chats now',contexts:['action'] });
    await contextCreate({ id:MENU.sep,type:'separator',contexts:['action'] });
    await contextCreate({ id:MENU.modeRoot,title:'One-click AI tabs behavior',contexts:['action'] });
    for (const value of actionCore.MODES) {
      const row = actionCore.modeMeta(value);
      await contextCreate({
        id:`${MENU.modePrefix}${value}`,
        parentId:MENU.modeRoot,
        title:row.menuLabel,
        type:'radio',
        checked:value === mode,
        contexts:['action']
      });
    }
  }

  function scheduleMenuReconcile(delay = 0) {
    const timer = setTimeout(() => ensureActionMenus().catch(() => {}),Math.max(0,Number(delay || 0)));
    menuTimers.push(timer);
    if (menuTimers.length > 12) menuTimers = menuTimers.slice(-12);
  }

  function scheduleStartupReconcile() {
    for (const delay of RECONCILE_DELAYS) scheduleMenuReconcile(delay);
    chrome.alarms?.create?.(MENU_RECONCILE_ALARM,{when:Date.now() + 8000}).catch?.(() => {});
  }

  async function openCommandCenter() {
    return chrome.tabs.create({ url:chrome.runtime.getURL('chat-vault.html'),active:true });
  }

  async function runFromContext(mode = '') {
    const result = await runQuickAction(mode);
    if (result?.ok) await openCommandCenter().catch(() => {});
    else await notifyContextFailure(result);
    return result;
  }

  chrome.runtime.onInstalled.addListener(scheduleStartupReconcile);
  chrome.runtime.onStartup.addListener(scheduleStartupReconcile);
  chrome.alarms?.onAlarm?.addListener((alarm) => {
    if (alarm?.name === MENU_RECONCILE_ALARM) ensureActionMenus().catch(() => {});
  });
  scheduleStartupReconcile();

  chrome.storage.onChanged.addListener((changes,area) => {
    if (area === 'local' && changes?.[actionCore.QUICK_ACTION_KEY]) scheduleMenuReconcile(80);
  });

  chrome.contextMenus?.onClicked?.addListener((info) => {
    const id = String(info?.menuItemId || '');
    if (id === MENU.open) { openCommandCenter().catch(() => {}); return; }
    if (id === MENU.run) { runFromContext('').catch(() => {}); return; }
    if (id === MENU.stashNow) { runFromContext('stash-close').catch(() => {}); return; }
    if (id.startsWith(MENU.modePrefix)) {
      const mode = id.slice(MENU.modePrefix.length);
      writeMode(mode).catch(() => {});
    }
  });

  chrome.runtime.onMessage.addListener((message,_sender,sendResponse) => {
    if (message?.type === 'PC_COMMAND_CENTER_GET_QUICK_ACTION') {
      readMode().then((mode) => sendResponse({ok:true,mode,meta:actionCore.modeMeta(mode)})).catch((error) => sendResponse({ok:false,error:clean(error?.message || error,180)}));
      return true;
    }
    if (message?.type === 'PC_COMMAND_CENTER_SET_QUICK_ACTION') {
      writeMode(message.mode).then((mode) => sendResponse({ok:true,mode,meta:actionCore.modeMeta(mode)})).catch((error) => sendResponse({ok:false,error:clean(error?.message || error,180)}));
      return true;
    }
    if (message?.type === 'PC_COMMAND_CENTER_RUN_QUICK_ACTION') {
      runQuickAction(message.mode || '').then(async (result) => {
        if (result?.ok && message.openCommandCenter) await openCommandCenter().catch(() => {});
        sendResponse({...result,message:resultMessage(result)});
      }).catch((error) => sendResponse({ok:false,error:clean(error?.message || error,180)}));
      return true;
    }
    return false;
  });
})();
