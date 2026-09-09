const SETTINGS_KEY = 'projectConstellationBrainSettings';
const ALARM = 'project-constellation-approval-supervisor';
const inFlightTabs = new Set();
let settingsCache = null;

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

async function scanApprovalTab(tab, cfg) {
  if (!tab?.id || !isChatGptUrl(tab.url || '') || inFlightTabs.has(tab.id)) return null;
  inFlightTabs.add(tab.id);
  try {
    return await chrome.tabs.sendMessage(tab.id, {
      type:'PC_APPROVAL_RECOVERY_SCAN',
      options:{
        alwaysAllow:cfg.approvalAutopilot?.alwaysAllow !== false,
        fallbackAllowOnce:cfg.approvalAutopilot?.fallbackAllowOnce !== false,
        recoverPaused:cfg.approvalAutopilot?.autoRecoverPaused !== false
      }
    });
  } catch (_) {
    return null;
  } finally {
    inFlightTabs.delete(tab.id);
  }
}

async function scanAllOpenChatGptTabs() {
  const cfg = await settings();
  if (!cfg.approvalAutopilot?.enabled || !cfg.approvalAutopilot?.acknowledged) return { scanned:0, disabled:true };
  const tabs = (await chrome.tabs.query({})).filter((tab) => tab?.id && isChatGptUrl(tab.url || ''));
  const results = await Promise.allSettled(tabs.map((tab) => scanApprovalTab(tab, cfg)));
  const recovered = results.filter((result) => result.status === 'fulfilled' && ['always-allow','allow-once','resume'].includes(String(result.value?.action || ''))).length;
  return { scanned:tabs.length, recovered };
}

async function scanOneFromPort(port) {
  const cfg = await settings();
  if (!cfg.approvalAutopilot?.enabled || !cfg.approvalAutopilot?.acknowledged) return;
  const tab = port.sender?.tab;
  if (tab?.id && isChatGptUrl(tab.url || '')) await scanApprovalTab(tab, cfg);
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'pc-tab-supervisor-v1' || !port.sender?.tab?.id) return;
  port.onMessage.addListener((message) => { if (message?.type === 'approval-scan') void scanOneFromPort(port); });
});

chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === ALARM) void scanAllOpenChatGptTabs(); });
chrome.runtime.onInstalled.addListener(() => { void chrome.alarms.create(ALARM, { periodInMinutes:1 }); void scanAllOpenChatGptTabs(); });
chrome.runtime.onStartup.addListener(() => { void chrome.alarms.create(ALARM, { periodInMinutes:1 }); void scanAllOpenChatGptTabs(); });
void chrome.alarms.create(ALARM, { periodInMinutes:1 });
void scanAllOpenChatGptTabs();
