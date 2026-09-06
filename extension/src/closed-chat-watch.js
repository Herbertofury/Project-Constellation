(() => {
  'use strict';

  const vaultCore = globalThis.ProjectConstellationChatVaultCore;
  const actionCore = globalThis.ProjectConstellationCommandCenterActionCore;
  const watchCore = globalThis.ProjectConstellationClosedChatWatchCore;
  const providers = globalThis.ProjectConstellationProviders;
  if (!vaultCore || !actionCore || !watchCore || !providers) return;

  const GOVERNOR_KEY = 'projectConstellationRequestGovernor';
  const PULSE_UX_KEY = 'projectConstellationPulseUxSettings';
  const OFFSCREEN_PATH = 'offscreen.html';
  const MAX_PROBES_PER_RUN = 2;
  const FETCH_TIMEOUT_MS = 12000;
  const PREFLIGHT_TIMEOUT_MS = 500;
  const PREFLIGHT_TTL_MS = 15000;
  const INITIAL_DELAY_MS = 45 * 1000;
  const NOTIFICATION_PREFIX = 'pc-closed-watch';

  const tabMeta = new Map();
  const liveStateByTab = new Map();
  const preflightByTab = new Map();
  let stateCache = null;
  let writeChain = Promise.resolve();
  let runPromise = null;
  let offscreenCreatePromise = null;

  const clean = watchCore.clean;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve,ms));

  function withTimeout(promise,ms,fallback = null) {
    return Promise.race([
      Promise.resolve(promise).catch(() => fallback),
      wait(ms).then(() => fallback)
    ]);
  }

  function tabRecord(tab = {}) {
    const url = vaultCore.canonicalUrl(tab.url || '');
    if (!tab?.id || !url || !vaultCore.isSupportedChatUrl(url)) return null;
    const provider = vaultCore.providerForUrl(url);
    return {
      tabId:Number(tab.id || 0),
      windowId:Number(tab.windowId || 0),
      url,
      key:vaultCore.chatKey(url),
      title:clean(tab.title || provider?.name || 'AI chat',300),
      providerId:provider?.id || 'ai',
      providerName:provider?.name || 'AI',
      pinned:Boolean(tab.pinned),
      observedAt:Date.now()
    };
  }

  function rememberTab(tab = {}) {
    const row = tabRecord(tab);
    if (row) tabMeta.set(row.tabId,row);
    return row;
  }

  async function loadState() {
    if (stateCache) return stateCache;
    const stored = await chrome.storage.local.get(watchCore.WATCH_KEY).catch(() => ({}));
    stateCache = watchCore.pruneState(stored?.[watchCore.WATCH_KEY] || {});
    return stateCache;
  }

  function scheduleAlarmFrom(state) {
    const rows = Object.values(state?.watches || {}).filter((watch) => watch?.active && Number(watch.nextCheckAt || 0) > 0);
    chrome.alarms.clear(watchCore.ALARM_NAME).catch(() => {});
    if (!rows.length) return;
    const next = Math.min(...rows.map((watch) => Number(watch.nextCheckAt || 0)));
    const when = Math.max(Date.now() + 30000,next);
    try { chrome.alarms.create(watchCore.ALARM_NAME,{when}); } catch (_) {}
  }

  function persistState(nextState) {
    writeChain = writeChain.then(async () => {
      stateCache = watchCore.pruneState(nextState || stateCache || {});
      await chrome.storage.local.set({ [watchCore.WATCH_KEY]:stateCache });
      scheduleAlarmFrom(stateCache);
      return stateCache;
    }).catch(() => stateCache);
    return writeChain;
  }

  async function mutateState(mutator) {
    const state = await loadState();
    const draft = watchCore.pruneState(state);
    const result = await mutator(draft);
    await persistState(draft);
    return result;
  }

  function sourceInfo(state) {
    if (!state) return {known:false,active:false,attention:false,complete:false};
    const info = actionCore.sentinelInfo(state);
    return { known:true,...info };
  }

  function shouldWatch(state,{explicit = false} = {}) {
    const info = sourceInfo(state);
    if (info.known && info.complete) return false;
    if (info.active || info.attention) return true;
    return Boolean(explicit && !info.known);
  }

  async function registerClosed(meta,state,{reason = 'closed-tab',explicit = false} = {}) {
    if (!meta?.key || !meta?.url || !shouldWatch(state,{explicit})) return null;
    const provider = providers.byId[meta.providerId] || providers.detectProvider(meta.url);
    const now = Date.now();
    const supported = Boolean(provider?.catalog?.backgroundHtml);
    const watch = watchCore.normalizeWatch({
      key:meta.key,
      url:meta.url,
      title:meta.title,
      providerId:meta.providerId,
      providerName:meta.providerName,
      phase:supported ? 'queued' : 'unsupported',
      sourceReason:reason,
      active:supported,
      closedAt:now,
      createdAt:now,
      updatedAt:now,
      nextCheckAt:supported ? now + INITIAL_DELAY_MS : 0,
      detail:supported
        ? 'Provider tab closed; adaptive remote heartbeat armed. No hidden tab will be kept alive.'
        : 'This provider does not expose safe background HTML monitoring. Constellation will not create a hidden tab just to watch it.'
    });
    await mutateState((draft) => {
      const current = draft.watches[watch.key];
      if (current?.active && Number(current.closedAt || 0) >= now - 5000) return current;
      draft.watches[watch.key] = watch;
      draft.updatedAt = now;
      return watch;
    });
    return watch;
  }

  async function cancelWatch(key) {
    const safe = clean(key,1200);
    if (!safe) return false;
    return mutateState((draft) => {
      if (!draft.watches[safe]) return false;
      delete draft.watches[safe];
      draft.updatedAt = Date.now();
      return true;
    });
  }

  async function reconcileOpenTabs() {
    const tabs = await chrome.tabs.query({}).catch(() => []);
    const openKeys = new Set();
    for (const tab of tabs) {
      const meta = rememberTab(tab);
      if (meta?.key) openKeys.add(meta.key);
    }
    await mutateState((draft) => {
      for (const key of openKeys) delete draft.watches[key];
      draft.updatedAt = Date.now();
    });
  }

  async function readConfiguredMode(modeHint = '') {
    if (modeHint) return actionCore.normalizeMode(modeHint);
    const stored = await chrome.storage.local.get(actionCore.QUICK_ACTION_KEY).catch(() => ({}));
    return actionCore.normalizeMode(stored?.[actionCore.QUICK_ACTION_KEY]);
  }

  async function captureQuickAction(modeHint = '') {
    const mode = await readConfiguredMode(modeHint);
    if (mode !== 'stash-close') return 0;
    const tabs = (await chrome.tabs.query({}).catch(() => [])).filter((tab) => vaultCore.isSupportedChatUrl(tab.url || '') && !tab.pinned);
    const stamp = Date.now();
    const rows = await Promise.all(tabs.map(async (tab) => {
      const meta = rememberTab(tab);
      if (!meta) return null;
      const state = await withTimeout(chrome.tabs.sendMessage(tab.id,{type:'PC_GET_LIVE_SENTINEL_STATE'}),PREFLIGHT_TIMEOUT_MS,null);
      preflightByTab.set(Number(tab.id),{ meta,state,explicit:true,capturedAt:stamp,expiresAt:stamp + PREFLIGHT_TTL_MS });
      return meta;
    }));
    return rows.filter(Boolean).length;
  }

  async function governorDelay(providerId) {
    const stored = await chrome.storage.local.get(GOVERNOR_KEY).catch(() => ({}));
    const row = stored?.[GOVERNOR_KEY]?.providers?.[providerId] || {};
    const until = Math.max(Number(row.backoffUntil || 0),Number(row.nextAllowedAt || 0));
    return Math.max(0,until - Date.now());
  }

  function retryAfterMs(value = '') {
    const text = String(value || '').trim();
    if (!text) return 0;
    if (/^\d+(?:\.\d+)?$/.test(text)) return Math.max(0,Math.round(Number(text) * 1000));
    const stamp = Date.parse(text);
    return Number.isFinite(stamp) ? Math.max(0,stamp - Date.now()) : 0;
  }

  async function ensureOffscreenParser() {
    const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_PATH);
    const contexts = await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT'],documentUrls:[offscreenUrl]}).catch(() => []);
    if (contexts.length) return true;
    if (!offscreenCreatePromise) {
      offscreenCreatePromise = chrome.offscreen.createDocument({
        url:OFFSCREEN_PATH,
        reasons:['DOM_PARSER'],
        justification:'Parse authenticated provider HTML for adaptive closed-chat heartbeat checks without opening visible or hidden provider tabs.'
      }).catch(async () => {
        const retry = await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT'],documentUrls:[offscreenUrl]}).catch(() => []);
        if (!retry.length) throw new Error('Offscreen parser unavailable');
      }).finally(() => { offscreenCreatePromise = null; });
    }
    await offscreenCreatePromise;
    return true;
  }

  async function parseHtml(providerId,url,html) {
    await ensureOffscreenParser();
    return chrome.runtime.sendMessage({type:'PC_OFFSCREEN_PARSE_HTML',target:'pc-offscreen-parser',payload:{providerId,url,html}});
  }

  async function fetchProbe(watch) {
    const provider = providers.byId[watch.providerId] || providers.detectProvider(watch.url);
    if (!provider?.catalog?.backgroundHtml) return {unsupported:true,detail:'Provider has no safe background HTML channel.'};
    const cooling = await governorDelay(provider.id);
    if (cooling > 0) return {deferUntil:Date.now() + cooling,detail:'Provider request governor is cooling down.'};

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(),FETCH_TIMEOUT_MS);
    try {
      const headers = {Accept:'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5'};
      if (watch.etag) headers['If-None-Match'] = watch.etag;
      if (watch.lastModified) headers['If-Modified-Since'] = watch.lastModified;
      const response = await fetch(watch.url,{method:'GET',credentials:'include',redirect:'follow',cache:'no-store',signal:controller.signal,headers});
      const etag = response.headers.get('etag') || watch.etag || '';
      const lastModified = response.headers.get('last-modified') || watch.lastModified || '';
      if (response.status === 304) return {
        fingerprint:watch.fingerprint,
        signal:watch.signal || 'page',
        turnCount:watch.turnCount,
        assistantCount:watch.assistantCount,
        textLength:watch.textLength,
        etag,lastModified
      };
      if (!response.ok) {
        const retry = retryAfterMs(response.headers.get('retry-after') || '');
        return {error:`HTTP ${response.status}`,retryAfterMs:retry || ([429,503].includes(response.status) ? 10 * 60 * 1000 : 0)};
      }
      const finalProvider = providers.detectProvider(response.url || watch.url);
      if (!finalProvider || finalProvider.id !== provider.id) return {authRequired:true,detail:'Provider redirected the closed-chat heartbeat outside the signed-in chat origin.'};
      const contentType = response.headers.get('content-type') || '';
      if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) return {error:`Non-HTML response (${clean(contentType,100)})`};
      const html = await response.text();
      const sampleHash = watchCore.hashText(`${html.length}:${html.slice(0,65536)}:${html.slice(-65536)}`);
      const parsed = await parseHtml(provider.id,response.url || watch.url,html).catch((error) => ({ok:false,error:String(error?.message || error)}));
      if (!parsed?.ok) return {error:clean(parsed?.error || 'Could not parse provider heartbeat response.',300)};
      if (parsed.authRequired) return {authRequired:true,detail:'Provider session appears signed out or expired; reopen the chat to refresh authentication.'};
      const fp = watchCore.parsedFingerprint(parsed,sampleHash);
      return { ...fp,etag,lastModified,title:clean(parsed.title || '',300) };
    } catch (error) {
      const message = error?.name === 'AbortError' ? 'Heartbeat request timed out' : clean(error?.message || error,300);
      return {error:message};
    } finally {
      clearTimeout(timeout);
    }
  }

  async function pulseSettings() {
    const stored = await chrome.storage.local.get(PULSE_UX_KEY).catch(() => ({}));
    return {completionNotificationsEnabled:true,attentionNotificationsEnabled:true,...(stored?.[PULSE_UX_KEY] || {})};
  }

  async function notifyWatch(watch,kind) {
    const settings = await pulseSettings();
    if (kind === 'settled' && settings.completionNotificationsEnabled === false) return;
    if (kind === 'attention' && settings.attentionNotificationsEnabled === false) return;
    const id = `${NOTIFICATION_PREFIX}:${watchCore.hashText(watch.key)}`;
    const title = kind === 'settled' ? 'Closed chat has new output' : 'Closed-chat heartbeat needs attention';
    const message = kind === 'settled'
      ? `${watch.title} changed after its tab closed and has now stayed settled across conservative heartbeat checks.`
      : `${watch.title} - ${watch.detail || watch.lastError || 'remote monitoring stopped safely'}`;
    await chrome.notifications.clear(id).catch(() => {});
    await chrome.notifications.create(id,{
      type:'basic',
      iconUrl:chrome.runtime.getURL('assets/constellation-field.svg'),
      title,
      message:clean(message,260),
      contextMessage:'Project Constellation · no hidden tab',
      priority:kind === 'attention' ? 1 : 0,
      requireInteraction:false
    }).catch(() => null);
    await mutateState((draft) => {
      if (draft.watches[watch.key]) draft.watches[watch.key].notificationId = id;
    });
  }

  async function probeOne(rawWatch) {
    const watch = watchCore.normalizeWatch(rawWatch);
    if (!watch.active) return watch;
    const probe = await fetchProbe(watch);
    if (probe.deferUntil) {
      const deferred = watchCore.normalizeWatch({...watch,updatedAt:Date.now(),nextCheckAt:Math.max(Number(probe.deferUntil || 0),Date.now() + 30000),detail:probe.detail || watch.detail});
      await mutateState((draft) => { draft.watches[watch.key] = deferred; });
      return deferred;
    }
    const next = watchCore.reduceProbe(watch,probe,Date.now());
    await mutateState((draft) => { draft.watches[watch.key] = next; });
    if (next.phase === 'settled' && watch.phase !== 'settled' && next.seenProgress) await notifyWatch(next,'settled');
    if (next.phase === 'attention' && watch.phase !== 'attention') await notifyWatch(next,'attention');
    return next;
  }

  async function runDueWatches({forceKey = ''} = {}) {
    if (runPromise) return runPromise;
    runPromise = (async () => {
      const state = await loadState();
      const now = Date.now();
      const rows = Object.values(state.watches || {})
        .filter((watch) => watch?.active && (forceKey ? watch.key === forceKey : Number(watch.nextCheckAt || 0) <= now))
        .sort((a,b) => Number(a.nextCheckAt || 0) - Number(b.nextCheckAt || 0))
        .slice(0,forceKey ? 1 : MAX_PROBES_PER_RUN);
      for (let i = 0; i < rows.length; i += 1) {
        await probeOne(rows[i]);
        if (i + 1 < rows.length) await wait(250);
      }
      const current = await loadState();
      scheduleAlarmFrom(current);
      return {ok:true,checked:rows.length,state:watchCore.pruneState(current)};
    })().finally(() => { runPromise = null; });
    return runPromise;
  }

  function cleanPreflight() {
    const now = Date.now();
    for (const [tabId,row] of preflightByTab.entries()) if (Number(row?.expiresAt || 0) < now) preflightByTab.delete(tabId);
  }

  chrome.runtime.onMessage.addListener((message,sender,sendResponse) => {
    if (message?.type === 'PC_LIVE_CHAT_STATE_PUSH' && sender?.tab?.id) {
      const meta = rememberTab(sender.tab);
      if (meta) liveStateByTab.set(Number(sender.tab.id),{state:message.state || null,observedAt:Date.now(),meta});
      return false;
    }
    if (message?.type === 'PC_COMMAND_CENTER_RUN_QUICK_ACTION') {
      captureQuickAction(message.mode || '').catch(() => {});
      return false;
    }
    if (message?.type === 'PC_CLOSED_CHAT_WATCH_SNAPSHOT') {
      loadState().then((state) => sendResponse({ok:true,...watchCore.pruneState(state)})).catch((error) => sendResponse({ok:false,error:clean(error?.message || error,220)}));
      return true;
    }
    if (message?.type === 'PC_CLOSED_CHAT_WATCH_NOW') {
      const key = clean(message.key || vaultCore.chatKey(message.url || ''),1200);
      runDueWatches({forceKey:key}).then(sendResponse).catch((error) => sendResponse({ok:false,error:clean(error?.message || error,220)}));
      return true;
    }
    if (message?.type === 'PC_CLOSED_CHAT_WATCH_CANCEL') {
      const key = clean(message.key || vaultCore.chatKey(message.url || ''),1200);
      cancelWatch(key).then((removed) => sendResponse({ok:true,removed})).catch((error) => sendResponse({ok:false,error:clean(error?.message || error,220)}));
      return true;
    }
    return false;
  });

  chrome.contextMenus?.onClicked?.addListener((info) => {
    const id = String(info?.menuItemId || '');
    if (id === 'pc-command-center-stash-now') captureQuickAction('stash-close').catch(() => {});
    else if (id === 'pc-command-center-run') captureQuickAction('').catch(() => {});
  });

  chrome.tabs.onCreated.addListener((tab) => { rememberTab(tab); });
  chrome.tabs.onUpdated.addListener((tabId,changeInfo,tab) => {
    if (changeInfo.url || changeInfo.status === 'complete') {
      const meta = rememberTab(tab);
      if (meta?.key) cancelWatch(meta.key).catch(() => {});
    } else if (tabMeta.has(Number(tabId)) && tab?.title) {
      const current = tabMeta.get(Number(tabId));
      tabMeta.set(Number(tabId),{...current,title:clean(tab.title,300),pinned:Boolean(tab.pinned)});
    }
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    cleanPreflight();
    const id = Number(tabId || 0);
    const preflight = preflightByTab.get(id) || null;
    const live = liveStateByTab.get(id) || null;
    const meta = preflight?.meta || live?.meta || tabMeta.get(id) || null;
    const state = preflight?.state || live?.state || null;
    const explicit = Boolean(preflight?.explicit);
    if (meta) registerClosed(meta,state,{reason:explicit ? 'one-tab-style-stash' : 'manual-close',explicit}).catch(() => {});
    preflightByTab.delete(id);
    liveStateByTab.delete(id);
    tabMeta.delete(id);
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm?.name === watchCore.ALARM_NAME) runDueWatches().catch(() => {});
  });

  chrome.notifications.onClicked.addListener((id) => {
    if (!String(id || '').startsWith(`${NOTIFICATION_PREFIX}:`)) return;
    loadState().then((state) => {
      const watch = Object.values(state.watches || {}).find((row) => row?.notificationId === id);
      if (!watch?.url) return;
      chrome.tabs.create({url:watch.url,active:true}).catch(() => {});
      chrome.notifications.clear(id).catch(() => {});
    }).catch(() => {});
  });

  chrome.runtime.onStartup.addListener(() => reconcileOpenTabs().catch(() => {}));
  chrome.runtime.onInstalled.addListener(() => reconcileOpenTabs().catch(() => {}));

  globalThis.ProjectConstellationClosedChatWatchRuntime = Object.freeze({
    VERSION:watchCore.VERSION,
    captureQuickAction,
    registerClosed,
    cancelWatch,
    runDueWatches,
    snapshot:async () => watchCore.pruneState(await loadState())
  });

  reconcileOpenTabs().catch(() => {
    loadState().then(scheduleAlarmFrom).catch(() => {});
  });
})();
