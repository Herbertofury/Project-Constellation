(() => {
  'use strict';

  const vaultCore = globalThis.ProjectConstellationChatVaultCore;
  const watchCore = globalThis.ProjectConstellationClosedChatWatchCore;
  if (!vaultCore || !watchCore) return;

  const grid = document.getElementById('chatGrid');
  const monitorMode = document.getElementById('monitorMode');
  if (!grid) return;

  let watchState = {version:watchCore.VERSION,updatedAt:0,watches:{}};
  let frame = 0;

  function ageLabel(stamp) {
    const value = Number(stamp || 0);
    if (!value) return 'not checked yet';
    const seconds = Math.max(0,Math.round((Date.now() - value) / 1000));
    if (seconds < 10) return 'just now';
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    return `${hours}h ago`;
  }

  function activeRemoteCount() {
    return Object.values(watchState.watches || {}).filter((watch) => watch?.active).length;
  }

  function applyMonitorMode() {
    if (!monitorMode) return;
    const active = activeRemoteCount();
    if (active > 0) {
      const base = String(monitorMode.textContent || 'sentinel').replace(/\s*\+\s*remote(?:\s*\d+)?$/i,'').trim() || 'sentinel';
      const label = `${base} + remote ${active}`;
      if (monitorMode.textContent !== label) monitorMode.textContent = label;
    }
  }

  async function checkNow(button,key) {
    if (!key) return;
    const old = button.textContent;
    button.disabled = true;
    button.textContent = 'Checking…';
    try {
      await chrome.runtime.sendMessage({type:'PC_CLOSED_CHAT_WATCH_NOW',key});
      await loadState();
    } catch (_) {}
    button.disabled = false;
    button.textContent = old;
    scheduleApply();
  }

  function applyCard(card) {
    const url = card.querySelector('.chat-url')?.textContent || '';
    const key = vaultCore.chatKey(url);
    const watch = key ? watchState.watches?.[key] : null;
    if (!watch) return;
    const age = card.querySelector('.live-age');
    const remotelyOwned = card.dataset.pcRemoteWatch === '1';
    if (!remotelyOwned && String(age?.textContent || '').trim().toLowerCase() !== 'tab closed') return;

    const live = watchCore.presentation(watch);
    card.dataset.pcRemoteWatch = '1';
    card.dataset.state = live.state;
    const pill = card.querySelector('.state-pill');
    if (pill) {
      pill.className = `state-pill ${live.tone || live.state}`;
      pill.textContent = live.label || live.state;
    }
    if (age) age.textContent = watch.active ? `remote · ${ageLabel(watch.lastCheckedAt || watch.updatedAt)}` : ageLabel(watch.lastCheckedAt || watch.updatedAt);
    const detail = card.querySelector('.chat-detail');
    if (detail) {
      const headline = detail.querySelector('strong');
      if (headline) headline.textContent = live.detail || live.label;
      let activity = detail.querySelector('.activity');
      if (live.activity) {
        if (!activity) { activity = document.createElement('span'); activity.className = 'activity'; detail.appendChild(activity); }
        activity.textContent = live.activity;
      } else if (activity) activity.remove();
    }

    const actions = card.querySelector('.chat-actions-row');
    if (actions && watch.active && !actions.querySelector('[data-pc-heartbeat-now]')) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.pcHeartbeatNow = '1';
      button.textContent = 'Heartbeat now';
      button.title = 'Run one remote heartbeat check now without opening a provider tab';
      button.addEventListener('click',(event) => {
        event.preventDefault();
        event.stopPropagation();
        checkNow(button,key).catch(() => {});
      });
      actions.insertBefore(button,actions.children[1] || null);
    }
  }

  function apply() {
    frame = 0;
    applyMonitorMode();
    for (const card of grid.querySelectorAll('.chat-card')) applyCard(card);
  }

  function scheduleApply() {
    if (frame) return;
    frame = requestAnimationFrame(apply);
  }

  async function loadState() {
    const stored = await chrome.storage.local.get(watchCore.WATCH_KEY).catch(() => ({}));
    watchState = watchCore.pruneState(stored?.[watchCore.WATCH_KEY] || {});
    return watchState;
  }

  chrome.storage.onChanged.addListener((changes,area) => {
    if (area !== 'local' || !changes?.[watchCore.WATCH_KEY]) return;
    watchState = watchCore.pruneState(changes[watchCore.WATCH_KEY].newValue || {});
    scheduleApply();
  });

  const observer = new MutationObserver(scheduleApply);
  observer.observe(grid,{childList:true,subtree:true});
  if (monitorMode) observer.observe(monitorMode,{childList:true,characterData:true,subtree:true});

  loadState().then(scheduleApply).catch(() => {});
})();
