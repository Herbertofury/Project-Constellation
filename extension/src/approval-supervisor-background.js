const SETTINGS_KEY = 'projectConstellationBrainSettings';
const ALARM = 'project-constellation-approval-supervisor';
const SCHEDULES_URL = 'https://chatgpt.com/schedules';
const inFlightTabs = new Set();
let settingsCache = null;
let schedulesTabCreate = null;

function isChatGptUrl(value) {
  try { return /^(chatgpt\.com|chat\.openai\.com)$/i.test(new URL(String(value || '')).hostname); } catch (_) { return false; }
}

function isSchedulesUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return /^(chatgpt\.com|chat\.openai\.com)$/i.test(url.hostname) && /^\/schedules(?:\/|$)/i.test(url.pathname);
  } catch (_) { return false; }
}

async function settings() {
  if (settingsCache) return settingsCache;
  settingsCache = (await chrome.storage.local.get(SETTINGS_KEY))?.[SETTINGS_KEY] || {};
  return settingsCache;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[SETTINGS_KEY]) settingsCache = changes[SETTINGS_KEY].newValue || {};
});

async function scanApprovalTab(tab, cfg, forceSchedules = false) {
  if (!tab?.id || !isChatGptUrl(tab.url || '') || inFlightTabs.has(tab.id)) return null;
  const scheduledTaskRepair = forceSchedules || isSchedulesUrl(tab.url || '');
  inFlightTabs.add(tab.id);
  try {
    return await chrome.tabs.sendMessage(tab.id, {
      type:'PC_APPROVAL_RECOVERY_SCAN',
      options:{
        alwaysAllow:scheduledTaskRepair || cfg.approvalAutopilot?.alwaysAllow !== false,
        fallbackAllowOnce:scheduledTaskRepair || cfg.approvalAutopilot?.fallbackAllowOnce !== false,
        recoverPaused:scheduledTaskRepair || cfg.approvalAutopilot?.autoRecoverPaused !== false,
        scheduledTaskRepair
      }
    });
  } catch (_) {
    return null;
  } finally {
    inFlightTabs.delete(tab.id);
  }
}

async function waitForTabComplete(tabId, timeoutMs = 12000) {
  const current = await chrome.tabs.get(tabId).catch(() => null);
  if (current?.status === 'complete') return current;
  return await new Promise((resolve) => {
    let done = false;
    const finish = (tab) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(tab || null);
    };
    const listener = (updatedId, changeInfo, tab) => {
      if (updatedId === tabId && changeInfo.status === 'complete') finish(tab);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function ensureSchedulesTab() {
  const existing = (await chrome.tabs.query({})).find((tab) => tab?.id && isSchedulesUrl(tab.url || ''));
  if (existing) return existing;
  if (schedulesTabCreate) return schedulesTabCreate;
  schedulesTabCreate = (async () => {
    try {
      const created = await chrome.tabs.create({ url:SCHEDULES_URL, active:false });
      if (!created?.id) return created || null;
      return (await waitForTabComplete(created.id)) || created;
    } catch (_) {
      return null;
    } finally {
      schedulesTabCreate = null;
    }
  })();
  return schedulesTabCreate;
}

async function scanAllOpenChatGptTabs({ ensureSchedules = true } = {}) {
  const cfg = await settings();
  const normalEnabled = Boolean(cfg.approvalAutopilot?.enabled && cfg.approvalAutopilot?.acknowledged);
  if (ensureSchedules) await ensureSchedulesTab();

  const tabs = (await chrome.tabs.query({})).filter((tab) => tab?.id && isChatGptUrl(tab.url || ''));
  const eligible = tabs.filter((tab) => isSchedulesUrl(tab.url || '') || normalEnabled);
  const results = await Promise.allSettled(eligible.map((tab) => scanApprovalTab(tab, cfg, isSchedulesUrl(tab.url || ''))));
  const recoveredActions = new Set(['always-allow','allow-once','resume','scheduled-task-recovered']);
  const recovered = results.filter((result) => result.status === 'fulfilled' && recoveredActions.has(String(result.value?.action || ''))).length;
  return { scanned:eligible.length, recovered, scheduledTab:tabs.some((tab) => isSchedulesUrl(tab.url || '')), normalEnabled };
}

async function scanOneFromPort(port) {
  const cfg = await settings();
  const tab = port.sender?.tab;
  if (!tab?.id || !isChatGptUrl(tab.url || '')) return;
  if (!isSchedulesUrl(tab.url || '') && (!cfg.approvalAutopilot?.enabled || !cfg.approvalAutopilot?.acknowledged)) return;
  await scanApprovalTab(tab, cfg, isSchedulesUrl(tab.url || ''));
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'pc-tab-supervisor-v1' || !port.sender?.tab?.id) return;
  port.onMessage.addListener((message) => { if (message?.type === 'approval-scan') void scanOneFromPort(port); });
});

chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === ALARM) void scanAllOpenChatGptTabs({ ensureSchedules:true }); });
chrome.runtime.onInstalled.addListener(() => { void chrome.alarms.create(ALARM, { periodInMinutes:1 }); void scanAllOpenChatGptTabs({ ensureSchedules:true }); });
chrome.runtime.onStartup.addListener(() => { void chrome.alarms.create(ALARM, { periodInMinutes:1 }); void scanAllOpenChatGptTabs({ ensureSchedules:true }); });
void chrome.alarms.create(ALARM, { periodInMinutes:1 });
void scanAllOpenChatGptTabs({ ensureSchedules:true });
