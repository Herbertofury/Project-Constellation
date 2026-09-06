(() => {
  'use strict';

  const VERSION = 2;
  const PULSE_UX_KEY = 'projectConstellationPulseUxSettings';
  const STATE_KEY = 'projectConstellationPulseNotificationRepairV2';
  const NOTIFICATION_PREFIX = 'pc-pulse-v2';
  const COMPLETE_STATUSES = new Set(['idle']);
  const ATTENTION_STATUSES = new Set([
    'paused','waiting-user','blocked-approval','delivery-timeout','connection-interrupted','response-interrupted',
    'send-failed','refresh-required','rate-limited','errored','stalled','auth-required','unavailable'
  ]);
  const ATTENTION_HEALTH = /^(?:tool-stalled|tool-dead|request-stalled|stalled|dead|capacity-watch|capacity-handoff|capacity-reached|delivery-timeout|connection-interrupted|response-interrupted|send-failed)$/i;
  const DEFAULTS = Object.freeze({ completionNotificationsEnabled:true, attentionNotificationsEnabled:true });
  const MAX_TRACKED_TABS = 180;
  const ATTENTION_REPEAT_MS = 20 * 60 * 1000;

  let cache = null;
  let writeChain = Promise.resolve();
  const clean = (value, max = 180) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

  function storageArea() {
    return chrome.storage.session || chrome.storage.local;
  }

  async function loadState() {
    if (cache) return cache;
    const area = storageArea();
    const stored = await area.get(STATE_KEY).catch(() => ({}));
    const source = stored?.[STATE_KEY];
    cache = source && typeof source === 'object' ? source : { version:VERSION, tabs:{}, updatedAt:0 };
    if (!cache.tabs || typeof cache.tabs !== 'object') cache.tabs = {};
    return cache;
  }

  function persistState() {
    writeChain = writeChain.then(async () => {
      const state = await loadState();
      const rows = Object.entries(state.tabs || {}).sort((a,b) => Number(b[1]?.observedAt || 0) - Number(a[1]?.observedAt || 0));
      state.tabs = Object.fromEntries(rows.slice(0, MAX_TRACKED_TABS));
      state.version = VERSION;
      state.updatedAt = Date.now();
      await storageArea().set({ [STATE_KEY]:state }).catch(() => {});
    });
    return writeChain;
  }

  async function pulseSettings() {
    const stored = await chrome.storage.local.get(PULSE_UX_KEY).catch(() => ({}));
    return { ...DEFAULTS, ...(stored?.[PULSE_UX_KEY] || {}) };
  }

  function identityFor(state = {}, tab = {}) {
    const chat = state.chat || {};
    return clean(chat.id || chat.url || tab.url || `tab:${tab.id || 0}`, 600);
  }

  function statusFor(state = {}) {
    return clean(state?.chat?.status || state?.chat?.rawStatus || 'idle', 80).toLowerCase();
  }

  function healthFor(state = {}) {
    return clean(state?.chat?.healthState || state?.health?.state || '', 100).toLowerCase();
  }

  function attentionKind(state = {}) {
    const status = statusFor(state);
    const health = healthFor(state);
    if (ATTENTION_STATUSES.has(status)) return status;
    if (ATTENTION_HEALTH.test(health)) return health;
    return '';
  }

  function displayTitle(state = {}, tab = {}) {
    const raw = clean(state?.chat?.title || tab.title || state?.provider?.name || 'AI chat', 160);
    return raw.replace(/^[\u2705\u26A0\uFE0F\u{1F7E3}\u{1F534}\u{1F7E0}\u{1F7E2}\s]+/u, '').trim() || 'AI chat';
  }

  async function focusTab(tabId, windowId) {
    if (windowId) await chrome.windows?.update?.(windowId, { focused:true }).catch(() => {});
    if (tabId) await chrome.tabs.update(tabId, { active:true }).catch(() => {});
  }

  function notificationId(kind, tabId) {
    return `${NOTIFICATION_PREFIX}:${kind}:${Number(tabId || 0)}`;
  }

  async function legacyNotificationPresent(kind, tabId) {
    if (!chrome.notifications?.getAll) return false;
    const all = await chrome.notifications.getAll().catch(() => ({}));
    const prefix = kind === 'complete' ? `pc-chat-complete:${Number(tabId || 0)}:` : `pc-chat-attention:${Number(tabId || 0)}:`;
    return Object.keys(all || {}).some((id) => id.startsWith(prefix));
  }

  async function createNotification(kind, tab, state, detail = '') {
    // The legacy background listener is still allowed to win while it is awake.
    // Its transition map is volatile across MV3 service-worker suspension; this
    // repair module persists transition memory and fills only the missed alerts.
    // Coalescing here avoids duplicate notifications during an awake-worker run.
    if (await legacyNotificationPresent(kind, tab.id)) return;
    const id = notificationId(kind, tab.id);
    const title = displayTitle(state, tab);
    const provider = clean(state?.provider?.name || 'AI', 60);
    const isComplete = kind === 'complete';
    const options = {
      type:'basic',
      iconUrl:chrome.runtime.getURL('assets/constellation-field.svg'),
      title:isComplete ? 'Chat complete' : 'Chat needs attention',
      message:isComplete ? `${title} finished on ${provider}.` : `${title} - ${detail || 'Open the chat to review what needs attention.'}`,
      contextMessage:'Project Constellation Pulse',
      priority:isComplete ? 0 : 1,
      requireInteraction:false,
      silent:false
    };
    await chrome.notifications.clear(id).catch(() => {});
    await chrome.notifications.create(id, options).catch(() => null);
  }

  async function handleLiveState(message, sender) {
    if (message?.type !== 'PC_LIVE_CHAT_STATE_PUSH' || !message?.state || !sender?.tab?.id) return;
    const tab = sender.tab;
    const state = message.state;
    const currentStatus = statusFor(state);
    const currentHealth = healthFor(state);
    const observedAt = Math.max(0, Number(state.observedAt || Date.now()));
    const identity = identityFor(state, tab);
    const settings = await pulseSettings();
    const persisted = await loadState();
    const key = String(tab.id);
    const previous = persisted.tabs[key] || null;
    const sameChat = previous?.identity === identity;
    const previousStatus = sameChat ? String(previous?.status || '') : '';
    const previousAttention = sameChat ? String(previous?.attention || '') : '';
    const attention = attentionKind(state);
    const wasRunning = sameChat && previousStatus === 'running';
    const completedNow = COMPLETE_STATUSES.has(currentStatus);

    const next = {
      identity,
      status:currentStatus,
      health:currentHealth,
      attention,
      observedAt,
      runningSince:currentStatus === 'running' ? (sameChat && Number(previous?.runningSince || 0) ? Number(previous.runningSince) : observedAt) : 0,
      lastCompletionNoticeAt:Number(previous?.lastCompletionNoticeAt || 0),
      lastAttentionNoticeAt:Number(previous?.lastAttentionNoticeAt || 0),
      lastAttentionKind:String(previous?.lastAttentionKind || '')
    };

    if (wasRunning && completedNow && settings.completionNotificationsEnabled !== false) {
      const runningFor = Math.max(0, observedAt - Number(previous.runningSince || previous.observedAt || observedAt));
      if (runningFor >= 750 && observedAt - next.lastCompletionNoticeAt > 4000) {
        next.lastCompletionNoticeAt = observedAt;
        setTimeout(() => createNotification('complete', tab, state).catch(() => {}), 280);
      }
    }

    if (attention && settings.attentionNotificationsEnabled !== false) {
      const newIncident = !sameChat || !previousAttention || previousAttention !== attention;
      const repeatDue = observedAt - Number(previous?.lastAttentionNoticeAt || 0) >= ATTENTION_REPEAT_MS;
      if (newIncident || repeatDue) {
        next.lastAttentionNoticeAt = observedAt;
        next.lastAttentionKind = attention;
        const detail = clean(state?.failure?.title || state?.health?.title || state?.failure?.detail || attention.replaceAll('-', ' '), 170);
        setTimeout(() => createNotification('attention', tab, state, detail).catch(() => {}), 280);
      }
    }

    persisted.tabs[key] = next;
    persistState().catch(() => {});
  }

  chrome.runtime.onMessage.addListener((message, sender) => {
    if (message?.type === 'PC_LIVE_CHAT_STATE_PUSH') handleLiveState(message, sender).catch(() => {});
    return false;
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    loadState().then((state) => {
      if (!state.tabs?.[String(tabId)]) return;
      delete state.tabs[String(tabId)];
      persistState().catch(() => {});
    }).catch(() => {});
  });

  chrome.notifications.onClicked.addListener((id) => {
    if (!String(id || '').startsWith(`${NOTIFICATION_PREFIX}:`)) return;
    const tabId = Number(String(id).split(':').at(-1) || 0);
    if (!tabId) return;
    chrome.tabs.get(tabId).then((tab) => focusTab(tabId, Number(tab?.windowId || 0))).catch(() => {});
    chrome.notifications.clear(id).catch(() => {});
  });
})();
