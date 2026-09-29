import './core.js';
const C = globalThis.PCXTaskRecoveryCore;
const ALARM = 'pcx-task-recovery-check-v1';
const CONFIG_KEY = C.KEY + '.config';
const FILE_ROOT = new URL('.', import.meta.url).pathname.slice(1);
let flight = null, pending = false, pendingTimer = null;
const now = () => new Date().toISOString();
async function load() {
  const values = await chrome.storage.local.get([C.KEY, CONFIG_KEY]);
  const state = values[C.KEY] || C.initial();
  state.config = C.config(values[CONFIG_KEY] || state.config);
  state.incidents ||= {}; state.sessions ||= {}; state.history ||= []; state.scannedKeys ||= [];
  return state;
}
async function save(state) {
  const current = (await chrome.storage.local.get(CONFIG_KEY))[CONFIG_KEY];
  if (current) state.config = C.config(current);
  await chrome.storage.local.set({[C.KEY]: state});
}
async function isEnabled() { return (await chrome.storage.local.get(CONFIG_KEY))[CONFIG_KEY]?.enabled !== false; }
async function ensureAlarm() {
  const state = await load(), previous = await chrome.alarms.get(ALARM);
  if (!state.config.enabled) { if (previous) await chrome.alarms.clear(ALARM); return; }
  if (!previous || previous.periodInMinutes !== state.config.intervalMinutes) {
    // Recreated on every service worker/browser start; compatible before Chrome 150 too.
    await chrome.alarms.create(ALARM, {delayInMinutes: 1, periodInMinutes: state.config.intervalMinutes});
  }
}
async function getTab(id) { if (!Number.isInteger(id)) return null; try { return await chrome.tabs.get(id); } catch { return null; } }
async function message(tabId, data) {
  try { return await chrome.tabs.sendMessage(tabId, data, {frameId: 0}); }
  catch (error) {
    // Only a read can be retried after listener injection. A lost action receipt
    // may mean the click already happened; resending would duplicate it.
    if (data.type !== 'PCX_RECOVERY_INSPECT') throw error;
    const tab = await getTab(tabId);
    if (!tab || !C.site(tab.url || tab.pendingUrl)) throw new Error('Managed page unavailable or outside ChatGPT');
    await chrome.scripting.executeScript({target: {tabId, frameIds: [0]}, files: [FILE_ROOT + 'core.js', FILE_ROOT + 'page.js', FILE_ROOT + 'content.js']});
    return chrome.tabs.sendMessage(tabId, data, {frameId: 0});
  }
}
async function ensureScheduler(state) {
  const current = await getTab(state.schedulerTabId);
  if (current && C.schedule(current.url || current.pendingUrl)) return current;
  // An unexpected navigation is user-owned. Never commandeer that tab.
  if (current) C.audit(state, 'SCHEDULER_NAVIGATED_AWAY', {tabId: current.id});
  const tab = await chrome.tabs.create({url: 'https://chatgpt.com/schedules', active: false});
  state.schedulerTabId = tab.id; state.lastRefresh = now(); state.scannedKeys = [];
  C.audit(state, 'CONTROL_TAB_CREATED', {tabId: tab.id});
  await save(state);
  return tab;
}
async function perform(state, tabId, session, plan) {
  const incident = state.incidents[plan.key];
  incident.actions ||= {};
  incident.actions[plan.actionKey] = {at: now(), status: 'INTENT_PERSISTED'};
  session.lastActionAt = Date.now();
  session.status = 'ACTION_INTENT_PERSISTED';
  C.audit(state, 'ACTION_INTENT', {task: session.title, kind: plan.action.kind, tabId});
  // Write before clicking. If Chrome dies between dispatch and receipt, no blind replay.
  await save(state);
  if (!await isEnabled()) return;
  const ack = await message(tabId, {type: 'PCX_RECOVERY_ACT', action: plan.action, active: session})
    .catch(error => ({ok: false, reason: 'ACK_UNAVAILABLE: ' + error.message}));
  incident.actions[plan.actionKey].status = ack?.ok ? 'CLICK_DISPATCHED_NOT_VERIFIED' : 'NOT_EXECUTED_OR_UNCERTAIN';
  session.status = ack?.ok ? 'WAITING_FOR_RUN_EVIDENCE' : 'ACTION_NOT_VERIFIED';
  C.audit(state, 'ACTION_RESULT', {task: session.title, kind: plan.action.kind, ok: !!ack?.ok, reason: ack?.reason || ''});
  await save(state);
  requestWake('post-action', 500);
}
function observe(state, session, status) {
  if (session.status !== status) C.audit(state, 'RUN_OBSERVATION', {task: session.title, status});
  session.status = status; session.lastObserved = now();
  const incident = state.incidents[session.key];
  if (incident) {
    incident.status = status;
    incident.lastObserved = session.lastObserved;
    if (status === 'RUNNING_OBSERVED' || status === 'UI_COMPLETION_OBSERVED') incident.resetByHealthy = true;
  }
}
async function checkSession(state, tabId, session) {
  const tab = await getTab(tabId);
  if (!tab) { observe(state, session, 'RECOVERY_TAB_CLOSED'); delete state.sessions[tabId]; return; }
  if (!C.site(tab.url || tab.pendingUrl)) { observe(state, session, 'USER_NAVIGATED_AWAY'); delete state.sessions[tabId]; return; }
  if (tab.status === 'loading') return;
  // Bind only the conversation reached directly by this controller's Follow-up action.
  if (!session.conversationUrl && C.conversation(tab.url) && session.openedByController) session.conversationUrl = tab.url;
  if (session.conversationUrl && C.conversation(tab.url) && new URL(tab.url).pathname !== new URL(session.conversationUrl).pathname) {
    observe(state, session, 'USER_NAVIGATED_TO_ANOTHER_RUN'); delete state.sessions[tabId]; return;
  }
  const snapshot = await message(tabId, {type: 'PCX_RECOVERY_INSPECT', active: session});
  const plan = C.plan(snapshot, state, session);
  if (plan.status === 'ACTION_READY') { await perform(state, tabId, session, plan); return; }
  // Asynchronously mounted dialogs/routes need time, not another Follow-up click.
  if (!C.safety(snapshot) && !snapshot.running && !snapshot.completed && Date.now() - session.lastActionAt < 8000) {
    session.status = 'WAITING_FOR_UI_TRANSITION'; requestWake('transition', 500); return;
  }
  observe(state, session, plan.status);
  if (state.schedulerTabId === tabId) state.schedulerTabId = null;
  if (plan.status === 'UI_COMPLETION_OBSERVED') {
    // A positively completed, controller-owned idle tab can be retired without altering the task.
    if (!tab.active && !tab.pinned && !snapshot.draft) { await chrome.tabs.remove(tabId); delete state.sessions[tabId]; }
  }
  // Other sessions remain under observation, including those waiting for legitimate consent.
  // When consent changes, this very same method resumes safe continuation automatically.
}
async function scanScheduler(state, reason) {
  const tab = await ensureScheduler(state);
  if (tab.status === 'loading') { state.status = 'PAGE_LOADING'; return; }
  const snapshot = await message(tab.id, {type: 'PCX_RECOVERY_INSPECT'});
  const unsafe = C.safety(snapshot);
  if (unsafe) { state.status = unsafe; return; }
  if ((reason === 'alarm' || reason === 'startup') && Date.now() - Date.parse(state.lastRefresh || 0) > state.config.intervalMinutes * 60000 && !snapshot.running) {
    state.lastRefresh = now(); state.coverage = 'REFRESHING'; state.scannedKeys = [];
    await save(state); await chrome.tabs.reload(tab.id); return;
  }
  for (const task of snapshot.tasks || []) {
    const k = C.key(task);
    if (!state.scannedKeys.includes(k)) state.scannedKeys.push(k);
    const incident = state.incidents[k];
    if (incident && (task.running || task.completed) && !task.attention && !task.paused) incident.resetByHealthy = true;
  }
  const plan = C.plan(snapshot, state);
  state.lastInspection = now(); state.status = plan.status;
  state.coverage = 'SCANNING_VISIBLE_LIST';
  if (plan.status === 'ACTION_READY') {
    const session = {key: plan.key, title: plan.task.title, id: plan.task.id, runId: plan.task.runId,
      openedByController: true, openedAt: now(), lastActionAt: Date.now(), status: 'OPENING_FOLLOWUP'};
    state.incidents[plan.key] = {title: plan.task.title, fingerprint: plan.task.fingerprint,
      wasAttention: true, resetByHealthy: false, actions: {}, status: session.status};
    state.sessions[tab.id] = session;
    // Reserve the origin tab before the click to prevent duplicate handling after a crash.
    await perform(state, tab.id, session, plan);
    return;
  }
  if (snapshot.recognized) {
    const more = await message(tab.id, {type: 'PCX_RECOVERY_SCAN_MORE'});
    state.coverage = more.status;
    if (['SCROLLED', 'MORE_TASKS_REQUESTED', 'NEXT_PAGE_REQUESTED', 'LOADING_MORE'].includes(more.status)) requestWake('list-discovery', 600);
  }
}
async function cycle(reason) {
  const state = await load();
  if (!state.config.enabled) return;
  const started = Date.now();
  // Round-robin cursor keeps many blocked runs from starving later ones.
  const ids = Object.keys(state.sessions);
  const offset = ids.length ? (state.sessionCursor || 0) % ids.length : 0;
  for (let n = 0; n < ids.length; n++) {
    if (!await isEnabled()) return;
    const index = (offset + n) % ids.length, id = ids[index];
    try { await checkSession(state, Number(id), state.sessions[id]); }
    catch (error) { observe(state, state.sessions[id], 'INSPECTION_UNAVAILABLE'); C.audit(state, 'INSPECTION_ERROR', {message: String(error.message)}); }
    state.sessionCursor = (index + 1) % ids.length;
    await save(state);
    // This is a resumable work lease, not a cap on tasks inspected.
    if (Date.now() - started > 18000) { requestWake('session-continuation', 500); return; }
  }
  if (!await isEnabled()) return;
  if (state.schedulerTabId !== null && state.sessions[state.schedulerTabId]) { await save(state); return; }
  try { await scanScheduler(state, reason); }
  catch (error) { state.status = 'PAGE_NOT_READY'; C.audit(state, 'SCHEDULE_INSPECTION_ERROR', {message: String(error.message)}); }
  await save(state);
  const blockers = Object.values(state.sessions).filter(x => /REQUIRED|AMBIGUOUS|UNVERIFIED|NO_SAFE|NOT_VERIFIED/.test(x.status));
  await chrome.action.setBadgeText({text: blockers.length ? '!' : Object.values(state.sessions).some(s => s.status === 'RUNNING_OBSERVED') ? '>' : ''}).catch(() => {});
}
function requestWake(reason, ms = 250) {
  if (pendingTimer) return;
  pendingTimer = setTimeout(() => { pendingTimer = null; void kick(reason); }, ms);
}
function kick(reason) {
  if (flight) { pending = true; return flight; }
  flight = (async () => {
    try { await cycle(reason); }
    catch (error) {
      const state = await load(); state.status = 'CONTROLLER_ERROR';
      C.audit(state, 'CONTROLLER_ERROR', {message: String(error.message)}); await save(state);
    } finally { flight = null; if (pending) { pending = false; requestWake('coalesced-event'); } }
  })();
  return flight;
}
chrome.alarms.onAlarm.addListener(a => { if (a.name === ALARM) void kick('alarm'); });
chrome.runtime.onStartup.addListener(() => { void ensureAlarm().then(() => kick('startup')); });
chrome.runtime.onInstalled.addListener(() => { void ensureAlarm().then(() => kick('installed')); });
chrome.tabs.onUpdated.addListener((id, changes) => {
  if (changes.status !== 'complete') return;
  void load().then(s => { if (s.schedulerTabId === id || s.sessions[id]) requestWake('page-ready'); });
});
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return;
  if (msg?.type === 'PCX_RECOVERY_DOM_CHANGED' && sender.tab && sender.frameId === 0) {
    void load().then(s => { if (s.schedulerTabId === sender.tab.id || s.sessions[sender.tab.id]) requestWake('dom-change'); });
    return;
  }
  if (!sender.url?.startsWith(chrome.runtime.getURL(''))) return;
  if (msg?.type === 'PCX_RECOVERY_STATE') { load().then(reply); return true; }
  if (msg?.type === 'PCX_RECOVERY_CHECK') { kick('user-check').then(load).then(reply); return true; }
  if (msg?.type === 'PCX_RECOVERY_CONFIG') {
    (async () => {
      const state = await load(), cfg = C.config({...state.config, ...msg.config});
      await chrome.storage.local.set({[CONFIG_KEY]: cfg}); await ensureAlarm(); reply({ok: true, config: cfg});
      if (cfg.enabled) requestWake('configuration');
    })(); return true;
  }
});
void chrome.storage.local.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'}).catch(() => {});
void ensureAlarm();
