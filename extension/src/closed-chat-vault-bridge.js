(() => {
  'use strict';

  const vaultCore = globalThis.ProjectConstellationChatVaultCore;
  const watchCore = globalThis.ProjectConstellationClosedChatWatchCore;
  const watchRuntime = globalThis.ProjectConstellationClosedChatWatchRuntime;
  if (!vaultCore || !watchCore) return;

  let syncChain = Promise.resolve();

  function itemFromWatch(raw = {}) {
    const watch = watchCore.normalizeWatch(raw);
    if (!watch.key || !watch.url || !vaultCore.isSupportedChatUrl(watch.url)) return null;
    const provider = vaultCore.providerForUrl(watch.url);
    const stamp = Number(watch.closedAt || watch.createdAt || Date.now());
    return vaultCore.normalizeItem({
      id:`remote:${watchCore.hashText(watch.key)}`,
      key:watch.key,
      url:watch.url,
      title:watch.title || provider?.name || 'AI chat',
      providerId:watch.providerId || provider?.id || 'ai',
      providerName:watch.providerName || provider?.name || 'AI',
      sourceTabId:0,
      sourceWindowId:0,
      createdAt:stamp,
      updatedAt:Number(watch.updatedAt || stamp),
      lastSeenOpenAt:stamp,
      lastOpenedAt:0
    });
  }

  function vaultKeys(rawVault) {
    const vault = vaultCore.normalizeVault(rawVault);
    const keys = new Set();
    for (const stack of vault.stacks) for (const item of stack.items) if (item?.key) keys.add(item.key);
    return keys;
  }

  async function ensureWatchesVisible(rawState, onlyKeys = null) {
    const state = watchCore.pruneState(rawState || {});
    const rows = Object.values(state.watches || {}).filter((watch) => !onlyKeys || onlyKeys.has(watch.key));
    if (!rows.length) return {ok:true,added:0};

    const stored = await chrome.storage.local.get(vaultCore.VAULT_KEY).catch(() => ({}));
    let vault = vaultCore.normalizeVault(stored?.[vaultCore.VAULT_KEY]);
    const existing = vaultKeys(vault);
    const items = rows.map(itemFromWatch).filter((item) => item && !existing.has(item.key));
    if (!items.length) return {ok:true,added:0};

    const ensured = vaultCore.ensureStack(vault,vaultCore.LIVE_PROJECT_NAME,{select:false,color:'#8b5cf6'});
    vault = ensured.vault;
    const target = vault.stacks.find((stack) => stack.id === ensured.stack.id);
    if (!target) return {ok:false,added:0,error:'Live AI Sessions project unavailable'};

    target.items = vaultCore.mergeItems(target.items,items);
    target.updatedAt = Date.now();
    vault.updatedAt = Date.now();
    await chrome.storage.local.set({[vaultCore.VAULT_KEY]:vaultCore.normalizeVault(vault)});
    return {ok:true,added:items.length};
  }

  function enqueue(rawState,onlyKeys = null) {
    syncChain = syncChain.then(() => ensureWatchesVisible(rawState,onlyKeys)).catch(() => ({ok:false,added:0}));
    return syncChain;
  }

  chrome.storage.onChanged.addListener((changes,area) => {
    if (area !== 'local') return;

    if (changes?.[watchCore.WATCH_KEY]) {
      const previous = watchCore.pruneState(changes[watchCore.WATCH_KEY].oldValue || {});
      const current = watchCore.pruneState(changes[watchCore.WATCH_KEY].newValue || {});
      const before = new Set(Object.keys(previous.watches || {}));
      const added = new Set(Object.keys(current.watches || {}).filter((key) => !before.has(key)));
      if (added.size) enqueue(current,added);
    }

    if (changes?.[vaultCore.VAULT_KEY] && watchRuntime?.cancelWatch) {
      const before = vaultKeys(changes[vaultCore.VAULT_KEY].oldValue || {});
      const after = vaultKeys(changes[vaultCore.VAULT_KEY].newValue || {});
      for (const key of before) if (!after.has(key)) watchRuntime.cancelWatch(key).catch(() => {});
    }
  });

  chrome.storage.local.get(watchCore.WATCH_KEY).then((stored) => {
    enqueue(stored?.[watchCore.WATCH_KEY] || {});
  }).catch(() => {});

  globalThis.ProjectConstellationClosedChatVaultBridge = Object.freeze({
    ensureWatchesVisible,
    vaultKeys
  });
})();
