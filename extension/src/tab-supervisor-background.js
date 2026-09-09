import './tab-supervisor-core.js';

const core = globalThis.ProjectConstellationTabSupervisorCore;
const PORT_NAME = 'pc-tab-supervisor-v1';
const ALARM = 'project-constellation-tab-supervisor';
const SETTINGS_KEY = 'projectConstellationBrainSettings';
const STATE_KEY = 'projectConstellationReliabilitySupervisorState';
const DB_NAME = 'project-constellation-brain';
const ports = new Map();
let settingsCache = null;
let stateQueue = Promise.resolve();

function safeId(value) { return String(value || '').replace(/[^a-zA-Z0-9_.:-]+/g, '-').slice(0, 180); }
function isChatGptUrl(value) {
  try { return /^(chatgpt\.com|chat\.openai\.com)$/i.test(new URL(String(value || '')).hostname); } catch (_) { return false; }
}

async function settings() {
  if (settingsCache) return settingsCache;
  settingsCache = (await chrome.storage.local.get(SETTINGS_KEY))?.[SETTINGS_KEY] || {};
  return settingsCache;
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[SETTINGS_KEY]) settingsCache = changes[SETTINGS_KEY].newValue || {};
});

function defaultState() { return { version: 1, chats: {}, recoveries: 0, recoveryFailures: 0, lastTickAt: 0, updatedAt: 0 }; }
async function readState() {
  const stored = (await chrome.storage.local.get(STATE_KEY))?.[STATE_KEY];
  return { ...defaultState(), ...(stored || {}), chats: { ...(stored?.chats || {}) } };
}
async function writeState(state) {
  const next = { ...defaultState(), ...(state || {}), chats: { ...(state?.chats || {}) }, updatedAt: Date.now() };
  await chrome.storage.local.set({ [STATE_KEY]: next });
  return next;
}
function mutateState(operation) {
  const task = stateQueue.catch(() => {}).then(async () => operation(await readState()));
  stateQueue = task.then(() => undefined, () => undefined);
  return task;
}

async function notify(id, title, message) {
  try {
    await chrome.notifications.create(safeId(id), {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('assets/constellation-field.svg'),
      title: String(title || 'Project Constellation').slice(0, 120),
      message: String(message || '').slice(0, 420),
      priority: 2
    });
  } catch (_) {}
}

function recoveryConfig(cfg = {}) {
  const refresh = cfg.refreshRecovery || {};
  return core.normalizeConfig({
    staleRunningMs: Number(refresh.staleChatRescueMs || 2 * 60 * 60 * 1000),
    deadRecoveryMs: Number(refresh.deadRecoveryMs || 4 * 60 * 1000),
    failureRecoveryDelayMs: Number(refresh.failureRecoveryDelayMs || 3500),
    recoveryCooldownMs: Number(refresh.cooldownMs || 10 * 60 * 1000),
    maxRecoveriesPerChat: Number(refresh.maxRefreshesPerChat || 4)
  });
}

async function beginRecovery(port, snapshot, row, decision, state) {
  const tabId = Number(port.sender?.tab?.id || 0);
  if (!tabId || !isChatGptUrl(snapshot.url)) return false;
  const recoveryId = `${snapshot.chatId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();
  const pending = {
    recoveryId,
    prompt: core.buildContinuationPrompt({ reason: decision.reason, projectName: snapshot.projectName, title: snapshot.title }),
    reason: decision.reason,
    status: 'reload-issued',
    issuedAt: now,
    tabId,
    resumeAttempts: 0
  };
  const nextRow = { ...row, lastRecoveryAt: now, recoveryCount: Number(row.recoveryCount || 0) + 1, pending, updatedAt: now };
  state.chats[snapshot.chatId] = nextRow;
  state.recoveries = Number(state.recoveries || 0) + 1;
  await writeState(state);
  await notify(`pc-recover-${snapshot.chatId}`, 'Project Constellation rescued a stuck chat', `${snapshot.title || 'Chat'}: ${decision.reason.replace(/-/g, ' ')}. Reloading and continuing from preserved state.`);
  try {
    await chrome.tabs.reload(tabId, { bypassCache: false });
    return true;
  } catch (error) {
    nextRow.pending = { ...pending, status: 'reload-failed', error: String(error?.message || error).slice(0, 240) };
    state.recoveryFailures = Number(state.recoveryFailures || 0) + 1;
    await writeState(state);
    await notify(`pc-recover-fail-${snapshot.chatId}`, 'Project Constellation rescue needs attention', `Could not reload ${snapshot.title || 'the chat'}. Open the tab and continue manually.`);
    return false;
  }
}

async function handleSnapshot(port, snapshot = {}) {
  if (!snapshot?.chatId || !isChatGptUrl(snapshot.url || port.sender?.tab?.url || '')) return;
  const cfg = await settings();
  await mutateState(async (state) => {
    const now = Date.now();
    const previous = state.chats[snapshot.chatId] || { chatId: snapshot.chatId, recoveryCount: 0 };
    const signatureChanged = snapshot.signature && snapshot.signature !== previous.signature;
    const failureChanged = String(snapshot.failureKind || '') !== String(previous.failureKind || '');
    let lastProgressAt = Number(previous.lastProgressAt || 0);
    if (!lastProgressAt || signatureChanged) lastProgressAt = now;
    let failureDetectedAt = Number(previous.failureDetectedAt || 0);
    if (snapshot.failureKind && (failureChanged || !failureDetectedAt)) failureDetectedAt = now;
    if (!snapshot.failureKind) failureDetectedAt = 0;
    let wasRunning = Boolean(previous.wasRunning);
    if (snapshot.running || snapshot.status === 'running' || /stalled|dead/.test(String(snapshot.status || ''))) wasRunning = true;
    if (snapshot.status === 'idle' && snapshot.lastRole === 'assistant' && !snapshot.failureKind) wasRunning = false;

    const row = {
      ...previous,
      chatId: snapshot.chatId,
      url: snapshot.url,
      title: snapshot.title,
      projectId: snapshot.projectId || previous.projectId || '',
      projectName: snapshot.projectName || previous.projectName || '',
      signature: snapshot.signature || previous.signature || '',
      status: snapshot.status || previous.status || 'idle',
      failureKind: snapshot.failureKind || '',
      failureDetectedAt,
      lastProgressAt,
      lastObservedAt: now,
      wasRunning,
      unresolvedUser: Boolean(snapshot.unresolvedUser),
      hidden: Boolean(snapshot.hidden),
      turnCount: Number(snapshot.turnCount || 0),
      charCount: Number(snapshot.charCount || 0),
      updatedAt: now
    };

    const capacity = String(snapshot.capacity || core.capacityLevel(snapshot, cfg.liveHealth || {}));
    if (capacity !== 'clear' && capacity !== row.lastCapacityNotice) {
      row.lastCapacityNotice = capacity;
      await notify(`pc-capacity-${snapshot.chatId}-${capacity}`, capacity === 'handoff' ? 'Project Constellation: branch now' : 'Project Constellation: branch soon', capacity === 'handoff' ? `${snapshot.title || 'This chat'} reached the proactive handoff boundary. Secure a continuation before the provider cuts it off.` : `${snapshot.title || 'This chat'} is getting large. Constellation is warning early while there is still runway.`);
    }
    if (capacity === 'clear' && row.lastCapacityNotice) row.lastCapacityNotice = '';

    state.chats[snapshot.chatId] = row;
    state.lastTickAt = now;
    await writeState(state);

    const decision = core.shouldRecover({
      enabled: cfg.refreshRecovery?.enabled === true,
      chatId: snapshot.chatId,
      now,
      status: row.status,
      failureKind: row.failureKind,
      failureDetectedAt: row.failureDetectedAt,
      lastProgressAt: row.lastProgressAt,
      lastRecoveryAt: row.lastRecoveryAt,
      recoveryCount: row.recoveryCount,
      wasRunning: row.wasRunning,
      unresolvedUser: row.unresolvedUser,
      config: recoveryConfig(cfg)
    });
    if (decision.recover && !row.pending) await beginRecovery(port, snapshot, row, decision, state);
  });
}

async function handleResumeResult(message = {}) {
  if (!message.chatId || !message.recoveryId) return;
  await mutateState(async (state) => {
    const row = state.chats[message.chatId];
    if (!row?.pending || row.pending.recoveryId !== message.recoveryId) return writeState(state);
    const status = String(message.status || 'failed');
    if (status === 'sent') {
      row.pending = null;
      row.wasRunning = true;
      row.unresolvedUser = false;
      row.lastProgressAt = Date.now();
      row.lastResumeStatus = 'sent';
      row.lastResumeAt = Date.now();
    } else {
      row.pending = { ...row.pending, status, resultAt: Date.now() };
      row.lastResumeStatus = status;
      if (status === 'composer-busy') await notify(`pc-resume-busy-${message.chatId}`, 'Project Constellation preserved your draft', 'The rescued chat has text in the composer, so Constellation did not overwrite it.');
    }
    row.updatedAt = Date.now();
    state.chats[message.chatId] = row;
    return writeState(state);
  });
}

async function maybeSendResume(port, chatId) {
  if (!chatId) return;
  const state = await readState();
  const row = state.chats[chatId];
  const pending = row?.pending;
  if (!pending || !['reload-issued', 'failed', 'prefilled'].includes(String(pending.status || ''))) return;
  if (Number(pending.resumeAttempts || 0) >= 3) return;
  pending.resumeAttempts = Number(pending.resumeAttempts || 0) + 1;
  pending.lastResumeAttemptAt = Date.now();
  row.pending = pending;
  state.chats[chatId] = row;
  await writeState(state);
  try { port.postMessage({ type: 'resume', chatId, recoveryId: pending.recoveryId, prompt: pending.prompt, reason: pending.reason }); } catch (_) {}
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function projectTerms(project) {
  return [...new Set(`${project.name || ''} ${project.providerProjectId || ''}`.toLowerCase().split(/[^a-z0-9_-]+/).filter((x) => x.length > 1))].slice(0, 80);
}
async function upsertProviderProject(project = {}) {
  if (!project?.id || !project?.name) return { ok:false, error:'invalid-project' };
  const db = await openDb();
  try {
    if (!db.objectStoreNames.contains('projects')) return { ok:false, error:'brain-schema-not-ready' };
    await new Promise((resolve, reject) => {
      const stores = db.objectStoreNames.contains('searchDocs') ? ['projects', 'searchDocs'] : ['projects'];
      const tx = db.transaction(stores, 'readwrite');
      const store = tx.objectStore('projects');
      const get = store.get(project.id);
      get.onsuccess = () => {
        const merged = { ...(get.result || {}), ...project, sourceType: 'provider', providerId: 'chatgpt', updatedAt: Number(project.updatedAt || Date.now()) };
        store.put(merged);
        if (stores.includes('searchDocs')) tx.objectStore('searchDocs').put({ id: `project:${merged.id}`, entityType: 'project', entityId: merged.id, providerId: 'chatgpt', title: merged.name, text: `${merged.name} ${merged.url || ''}`, url: merged.url || '', terms: projectTerms(merged), updatedAt: merged.updatedAt });
      };
      get.onerror = () => reject(get.error);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    const dirtyAt = Date.now();
    await chrome.storage.local.set({ projectConstellationDriveDirtyAt: dirtyAt });
    const cfg = await settings();
    if (cfg.drive?.autoSync) {
      const debounce = Math.max(3000, Number(cfg.drive?.debounceMs || 15000));
      await chrome.alarms.create('project-constellation-drive-sync', { when: dirtyAt + debounce });
    }
    return { ok:true };
  } catch (error) {
    return { ok:false, error:String(error?.message || error || 'project-upsert-failed').slice(0,240) };
  } finally { db.close(); }
}

async function openChatGptTabs() {
  return (await chrome.tabs.query({})).filter((tab) => tab?.id && isChatGptUrl(tab.url || ''));
}
async function bootstrapTab(tab) {
  if (!tab?.id || !isChatGptUrl(tab.url || '')) return false;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/provider-core.js', 'src/tab-supervisor-core.js', 'src/tab-supervisor.js'] });
    return true;
  } catch (_) { return false; }
}

async function wakeSupervisor(tab, now) {
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'PC_TAB_SUPERVISOR_TICK', at: now });
    if (response?.ok !== true || response?.supervisor !== PORT_NAME || !response?.snapshot?.chatId) return false;
    await handleSnapshot({ sender:{ tab } }, response.snapshot);
    return true;
  } catch (_) { return false; }
}

async function superviseOpenTabs() {
  const tabs = await openChatGptTabs();
  const cfg = await settings();
  const now = Date.now();
  const responsiveTabIds = new Set();
  const wakeResults = await Promise.allSettled(tabs.map(async (tab) => {
    let woke = await wakeSupervisor(tab, now);
    if (!woke && !tab.discarded) {
      const injected = await bootstrapTab(tab);
      if (injected) woke = await wakeSupervisor(tab, now);
    }
    return { tabId:tab.id, woke };
  }));
  for (const result of wakeResults) {
    if (result.status === 'fulfilled' && result.value?.woke) responsiveTabIds.add(result.value.tabId);
  }

  await mutateState(async (state) => {
    for (const tab of tabs) {
      if (responsiveTabIds.has(tab.id)) continue;
      const chatId = core.chatIdFromUrl(tab.url || '');
      if (!chatId) continue;
      const row = state.chats[chatId];
      if (!row || row.pending) continue;
      const observerAge = row.lastObservedAt ? now - Number(row.lastObservedAt) : Number.POSITIVE_INFINITY;
      if (observerAge < 90_000) continue;
      const decision = core.shouldRecover({
        enabled: cfg.refreshRecovery?.enabled === true,
        chatId,
        now,
        status: row.status,
        failureKind: row.failureKind,
        failureDetectedAt: row.failureDetectedAt,
        lastProgressAt: row.lastProgressAt,
        lastRecoveryAt: row.lastRecoveryAt,
        recoveryCount: row.recoveryCount,
        wasRunning: row.wasRunning,
        unresolvedUser: row.unresolvedUser,
        config: recoveryConfig(cfg)
      });
      if (!decision.recover) continue;
      const snapshot = { chatId, url: tab.url || row.url || '', title: tab.title || row.title || 'ChatGPT', projectName: row.projectName || '' };
      await beginRecovery({ sender: { tab } }, snapshot, row, decision, state);
    }
    state.lastTickAt = now;
    return writeState(state);
  });

  return { tabs: tabs.length, responsive:responsiveTabIds.size };
}

async function ensureAlarm() { await chrome.alarms.create(ALARM, { periodInMinutes: 1 }); }
async function bootstrapOpenTabs() {
  const tabs = await openChatGptTabs();
  await Promise.allSettled(tabs.filter((tab) => !tab.discarded).map((tab) => bootstrapTab(tab)));
  await superviseOpenTabs();
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PORT_NAME || !port.sender?.tab?.id || !isChatGptUrl(port.sender.tab.url || '')) return;
  const tabId = Number(port.sender.tab.id);
  ports.set(tabId, port);
  port.onMessage.addListener((message) => {
    if (message?.type === 'hello') void maybeSendResume(port, message.chatId || core.chatIdFromUrl(message.url || port.sender?.tab?.url || ''));
    else if (message?.type === 'snapshot') void handleSnapshot(port, message.snapshot || {});
    else if (message?.type === 'resume-result') void handleResumeResult(message);
    else if (message?.type === 'project-upsert') void upsertProviderProject(message.project || {}).then((result) => {
      try { port.postMessage({ type:'project-upsert-result', projectId:String(message.project?.id || ''), signature:String(message.signature || ''), ok:result?.ok === true, error:String(result?.error || '') }); } catch (_) {}
    });
  });
  port.onDisconnect.addListener(() => { if (ports.get(tabId) === port) ports.delete(tabId); });
  try { port.postMessage({ type: 'tick', now: Date.now() }); } catch (_) {}
});

chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === ALARM) void superviseOpenTabs(); });
chrome.runtime.onInstalled.addListener(() => { void ensureAlarm(); void bootstrapOpenTabs(); });
chrome.runtime.onStartup.addListener(() => { void ensureAlarm(); void bootstrapOpenTabs(); });
void ensureAlarm();
void superviseOpenTabs();
