(() => {
  'use strict';

  const STORAGE_KEY = 'projectConstellationPerformanceSettings';
  const PULSE_UX_KEY = 'projectConstellationPulseUxSettings';
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const constrainedDevice = Number(navigator.hardwareConcurrency || 8) <= 4 || Number(navigator.deviceMemory || 8) <= 4;
  document.body.dataset.atmosphere = reducedMotion ? 'off' : constrainedDevice ? 'static' : 'animated';

  const DEFAULTS = { enabled:true, responsiveScrolling:true, adaptiveMotionRelief:false, pressureWindowMs:5000, highPressureLongTaskMs:350, highPressureLongTaskCount:5, recoveryQuietMs:3500 };
  const PULSE_DEFAULTS = {
    statusPinEnabled:true,
    outputWarningsEnabled:true,
    outputWarningStrictness:'balanced',
    branchReviewBeforeSend:true,
    completionNotificationsEnabled:true,
    tabBeaconsEnabled:true,
    tabTitleStatusEnabled:true,
    tabFaviconStatusEnabled:true,
    tabGroupingEnabled:true,
    activeEmoji:'🟣', staleEmoji:'⚠️', completedEmoji:'✅',
    activeColor:'#8b5cf6', staleColor:'#e0a458', completedColor:'#45bd8c',
    activeGroupColor:'purple', staleGroupColor:'orange', completedGroupColor:'green'
  };
  const NATIVE_GROUP_COLORS = ['grey','blue','red','yellow','green','pink','purple','cyan','orange'];
  const ACTIVE_STATUSES = new Set(['running']);
  const STALE_STATUSES = new Set(['paused','waiting-user','blocked-approval','refresh-required','rate-limited','errored','stalled','auth-required','unavailable']);

  const ids = [
    'enabled','responsiveScrolling','adaptiveMotionRelief','pressure','status','longTasks','maxTask','provider','chatState','resetMetrics',
    'openHome','openConstellation','openAccounts','chatPulse','chatPulseHint','activeSummary','staleSummary','completedSummary','activeCount','staleCount','completedCount',
    'activeLatest','staleLatest','completedLatest','statusPinEnabled','outputWarningsEnabled','outputWarningStrictness','branchReviewBeforeSend','completionNotificationsEnabled',
    'tabBeaconsEnabled','tabTitleStatusEnabled','tabFaviconStatusEnabled','tabGroupingEnabled','activeEmoji','staleEmoji','completedEmoji','activeColor','staleColor','completedColor',
    'activeGroupColor','staleGroupColor','completedGroupColor','customTabTag','applyTabTag','clearTabTag','tabTagHint','tagPresets','chatListPanel','chatListEyebrow','chatListTitle','chatList','closeChatList'
  ];
  const els = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
  let currentSettings = { ...DEFAULTS };
  let pulseSettings = { ...PULSE_DEFAULTS };
  let brainOverview = null;
  let currentTabId = null;
  let currentTabTag = '';
  let selectedChatBucket = '';

  const safe = (value, max = 90) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  const statusBucket = (status = 'idle') => ACTIVE_STATUSES.has(status) ? 'active' : STALE_STATUSES.has(status) ? 'stale' : 'completed';
  const primaryChatLabel = (status = 'idle') => statusBucket(status) === 'completed' ? 'complete' : statusBucket(status) === 'stale' ? 'needs attention' : status.replaceAll('-', ' ');
  const groupLabel = (value) => value[0].toUpperCase() + value.slice(1);

  for (const id of ['activeGroupColor','staleGroupColor','completedGroupColor']) {
    for (const value of NATIVE_GROUP_COLORS) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = groupLabel(value);
      els[id].appendChild(option);
    }
  }

  function renderSettings() {
    for (const key of ['enabled','responsiveScrolling','adaptiveMotionRelief']) els[key].checked = Boolean(currentSettings[key]);
    for (const key of ['statusPinEnabled','outputWarningsEnabled','branchReviewBeforeSend','completionNotificationsEnabled','tabBeaconsEnabled','tabTitleStatusEnabled','tabFaviconStatusEnabled','tabGroupingEnabled']) els[key].checked = pulseSettings[key] !== false;
    els.outputWarningStrictness.value = ['relaxed','balanced','strict'].includes(pulseSettings.outputWarningStrictness) ? pulseSettings.outputWarningStrictness : 'balanced';
    for (const key of ['activeEmoji','staleEmoji','completedEmoji','activeColor','staleColor','completedColor','activeGroupColor','staleGroupColor','completedGroupColor']) els[key].value = pulseSettings[key] || PULSE_DEFAULTS[key];
    els.chatPulse.hidden = pulseSettings.statusPinEnabled === false;
  }

  function renderStatus(status) {
    if (!status) {
      els.pressure.textContent = 'offline'; els.pressure.dataset.state = 'offline'; els.provider.textContent = '—'; els.chatState.textContent = '—';
      els.status.textContent = 'Open a supported AI chat to see live performance. The Command Center remains available.';
      return;
    }
    const state = status.pressure?.pressure || 'normal';
    els.pressure.textContent = state; els.pressure.dataset.state = state;
    const health = status.chat?.health;
    const rawStatus = String(status.chat?.status || 'idle');
    const outputOnly = health?.state === 'output-regressed' || /^saved output is missing/i.test(String(health?.title || ''));
    els.provider.textContent = status.provider?.name || 'AI';
    els.chatState.textContent = outputOnly ? primaryChatLabel(rawStatus) : (health?.title || rawStatus);
    els.longTasks.textContent = status.metrics?.totalLongTasks || 0;
    els.maxTask.textContent = `${status.metrics?.maxLongTaskMs || 0} ms`;
    els.status.textContent = outputOnly ? `Chat is ${primaryChatLabel(rawStatus)}. Saved/page differences are tracked separately in Output Vault.` : (health?.detail || 'Performance protection and continuity capture are active on this tab.');
  }

  function rowDetail(row, bucket) {
    if (!row) return `No ${bucket} chats`;
    const generation = row.generation || {};
    if (bucket === 'active') {
      const title = safe(row.title || 'Active chat', 42);
      const phase = safe(generation.phase || generation.toolPhase || 'working', 24).replaceAll('-', ' ');
      const model = safe(generation.modelSlug || '', 22);
      const proof = generation.transcriptProof ? 'transcript' : 'live page';
      return `${title} · ${phase}${model ? ` · ${model}` : ''} · ${proof}`;
    }
    if (bucket === 'stale') return `${safe(row.title || 'Needs attention', 45)} · ${safe(row.status || 'stale', 18).replaceAll('-', ' ')}`;
    return safe(row.title || 'Completed chat', 58);
  }

  const bucketTitle = (bucket) => bucket === 'active' ? 'Active chats' : bucket === 'stale' ? 'Needs attention' : 'Completed chats';
  const bucketEmoji = (bucket) => bucket === 'active' ? (pulseSettings.activeEmoji || '🟣') : bucket === 'stale' ? (pulseSettings.staleEmoji || '⚠️') : (pulseSettings.completedEmoji || '✅');
  function relativeAge(value) {
    const ms = Math.max(0, Date.now() - Number(value || 0));
    if (!value) return '';
    if (ms < 60000) return 'now';
    if (ms < 3600000) return `${Math.max(1, Math.round(ms / 60000))}m`;
    if (ms < 86400000) return `${Math.max(1, Math.round(ms / 3600000))}h`;
    return `${Math.max(1, Math.round(ms / 86400000))}d`;
  }
  function chatContextLine(row, bucket) {
    const context = row?.context || {};
    const task = safe(context.taskHint || '', 118);
    const live = safe(context.liveActivity || row?.generation?.toolLabel || '', 100);
    const title = safe(row?.title || '', 118).toLowerCase();
    if (task && task.toLowerCase() !== title) return `${bucket === 'completed' ? 'Last task' : 'Task'} · ${task}`;
    if (live && !/^(working|thinking|complete|reconnecting|called tool)$/i.test(live)) return `${bucket === 'completed' ? 'Last activity' : 'Working on'} · ${live}`;
    const project = safe(context.projectName || '', 80);
    return project ? `Project · ${project}` : '';
  }

  function renderChatList() {
    const panel = els.chatListPanel;
    if (!panel) return;
    if (!selectedChatBucket) { panel.hidden = true; return; }
    const groups = brainOverview?.groups || {};
    const rows = Array.isArray(groups[selectedChatBucket]) ? groups[selectedChatBucket] : [];
    panel.hidden = false;
    panel.dataset.bucket = selectedChatBucket;
    els.chatListEyebrow.textContent = `${bucketEmoji(selectedChatBucket)} ${selectedChatBucket === 'stale' ? 'NEEDS ATTENTION' : selectedChatBucket.toUpperCase()}`;
    els.chatListTitle.textContent = `${bucketTitle(selectedChatBucket)} · ${rows.length}`;
    els.chatList.replaceChildren();
    if (!rows.length) {
      const empty = document.createElement('div'); empty.className = 'chat-list-empty'; empty.textContent = `No ${bucketTitle(selectedChatBucket).toLowerCase()} right now.`; els.chatList.appendChild(empty); return;
    }
    for (const row of rows) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'chat-list-row'; button.dataset.tabId = String(row.tabId || ''); button.dataset.windowId = String(row.windowId || ''); button.dataset.url = row.url || '';
      const dot = document.createElement('span'); dot.className = `chat-list-dot ${selectedChatBucket}`;
      const body = document.createElement('span'); body.className = 'chat-list-copy';
      const title = document.createElement('strong'); title.textContent = safe(row.title || row.providerName || 'AI chat', 90);
      const contextLine = document.createElement('span'); contextLine.className = 'chat-list-context'; contextLine.textContent = chatContextLine(row, selectedChatBucket); contextLine.hidden = !contextLine.textContent;
      const meta = document.createElement('span'); meta.className = 'chat-list-meta';
      const generation = row.generation || {};
      const context = row.context || {};
      const pieces = [];
      if (context.projectName) pieces.push(`Project: ${safe(context.projectName, 34)}`);
      if (selectedChatBucket === 'active' && context.liveActivity && safe(context.liveActivity, 90).toLowerCase() !== safe(context.taskHint, 90).toLowerCase()) pieces.push(`Now: ${safe(context.liveActivity, 34)}`);
      pieces.push(safe(row.providerName || row.providerId || 'AI', 24));
      if (selectedChatBucket === 'active') pieces.push(safe(generation.phase || generation.toolPhase || 'working', 24).replaceAll('-', ' '));
      else if (selectedChatBucket === 'stale') pieces.push(row.reconnecting ? 'reconnecting' : safe(row.status || 'attention', 22).replaceAll('-', ' '));
      else pieces.push('complete');
      if (generation.modelSlug) pieces.push(safe(generation.modelSlug, 24));
      if (row.tabGroup?.title) pieces.push(row.tabGroup.managed ? 'PC sorted' : `Group: ${safe(row.tabGroup.title, 30)}`);
      const age = relativeAge(row.lastActivityAt || row.observedAt); if (age) pieces.push(age);
      meta.textContent = pieces.filter(Boolean).join(' · ');
      body.append(title, contextLine, meta);
      const arrow = document.createElement('span'); arrow.className = 'chat-list-arrow'; arrow.textContent = '↗';
      button.append(dot, body, arrow);
      button.addEventListener('click', async () => {
        const result = await chrome.runtime.sendMessage({ type:'PC_FOCUS_LIVE_CHAT', tabId:Number(row.tabId || 0), windowId:Number(row.windowId || 0), url:row.url || '' }).catch(() => null);
        if (result?.ok) window.close();
      });
      els.chatList.appendChild(button);
    }
  }

  function selectChatBucket(bucket) {
    selectedChatBucket = selectedChatBucket === bucket ? '' : bucket;
    for (const key of ['active','stale','completed']) {
      const card = els[key === 'completed' ? 'completedSummary' : `${key}Summary`];
      card.classList.toggle('selected', selectedChatBucket === key);
      card.setAttribute('aria-expanded', selectedChatBucket === key ? 'true' : 'false');
    }
    renderChatList();
  }

  function renderChatPulse() {
    els.chatPulse.hidden = pulseSettings.statusPinEnabled === false;
    if (els.chatPulse.hidden) return;
    const snapshot = brainOverview || {};
    const groups = snapshot.groups && typeof snapshot.groups === 'object'
      ? { active:[...(snapshot.groups.active || [])], stale:[...(snapshot.groups.stale || [])], completed:[...(snapshot.groups.completed || [])] }
      : { active:[], stale:[], completed:[] };
    if (!snapshot.groups) for (const chat of (Array.isArray(snapshot.recentChats) ? snapshot.recentChats : [])) groups[statusBucket(String(chat?.status || 'idle'))].push(chat);
    const totals = snapshot.counts && typeof snapshot.counts === 'object'
      ? { active:Number(snapshot.counts.active || 0), stale:Number(snapshot.counts.stale || 0), completed:Number(snapshot.counts.completed || 0) }
      : { active:groups.active.length, stale:groups.stale.length, completed:groups.completed.length };

    for (const bucket of ['active','stale','completed']) {
      const latest = groups[bucket][0] || null;
      els[`${bucket}Count`].textContent = String(totals[bucket] || 0);
      els[`${bucket}Latest`].textContent = rowDetail(latest, bucket);
      if (bucket === 'active' && latest?.generation?.transcriptProof) els.activeLatest.classList.add('deep-proof'); else els[`${bucket}Latest`].classList.remove('deep-proof');
      const card = els[bucket === 'completed' ? 'completedSummary' : `${bucket}Summary`];
      card.dataset.url = latest?.url || '';
      card.dataset.tabId = latest?.tabId ? String(latest.tabId) : '';
      card.dataset.windowId = latest?.windowId ? String(latest.windowId) : '';
      card.disabled = totals[bucket] <= 0;
      card.title = totals[bucket] > 0 ? `Browse all ${totals[bucket]} ${bucket === 'stale' ? 'attention' : bucket} chat${totals[bucket] === 1 ? '' : 's'}` : `No ${bucket} chat is available`;
    }
    const open = Number(snapshot.openChatTabs || totals.active + totals.stale + totals.completed);
    const partial = Boolean(snapshot.partial);
    const transcriptActive = groups.active.filter((row) => row?.generation?.transcriptProof).length;
    els.chatPulseHint.textContent = partial
      ? `${open} open AI chat tab${open === 1 ? '' : 's'} detected · a tab is still reconnecting to Constellation.`
      : totals.active || totals.stale
        ? `${open} open AI tab${open === 1 ? '' : 's'} · ${transcriptActive ? `${transcriptActive} active with ChatGPT transcript proof · ` : ''}live state, not catalog history.`
        : `${open} open AI chat tab${open === 1 ? '' : 's'} · nothing is currently running or stuck.`;
    renderChatList();
  }

  async function activeTab() {
    const [tab] = await chrome.tabs.query({ active:true, currentWindow:true });
    return tab?.id ? tab : null;
  }

  async function refreshTagState() {
    if (!currentTabId) { currentTabTag = ''; els.customTabTag.value = ''; els.tabTagHint.textContent = 'Open a supported AI chat to tag it.'; return; }
    try {
      const state = await chrome.runtime.sendMessage({ type:'PC_TAB_TAG_GET', tabId:currentTabId });
      if (!state?.ok) throw new Error(state?.error || 'not-supported');
      currentTabTag = state.tag || '';
      els.customTabTag.value = currentTabTag;
      els.tabTagHint.textContent = currentTabTag ? `Current tag: ${currentTabTag}` : 'No manual tag · choose a preset or enter your own.';
    } catch (_) {
      currentTabTag = ''; els.customTabTag.value = ''; els.tabTagHint.textContent = 'This tab is not a supported AI chat.';
    }
  }

  async function refresh() {
    const tab = await activeTab();
    currentTabId = tab?.id || null;
    if (!currentTabId) { renderStatus(null); await refreshTagState(); return; }
    try { renderStatus(await chrome.tabs.sendMessage(currentTabId, { type:'PC_GET_STATUS' })); }
    catch (_) { renderStatus(null); }
    await refreshTagState();
  }

  async function refreshBrainOverview() {
    if (!chrome.runtime?.sendMessage) { brainOverview = null; renderChatPulse(); return; }
    try {
      const response = await chrome.runtime.sendMessage({ type:'PC_LIVE_CHAT_PULSE', force:true });
      brainOverview = response?.ok ? response : null;
    } catch (_) { brainOverview = null; }
    renderChatPulse();
  }

  async function savePerformance() {
    currentSettings = { ...currentSettings, enabled:els.enabled.checked, responsiveScrolling:els.responsiveScrolling.checked, adaptiveMotionRelief:els.adaptiveMotionRelief.checked };
    await chrome.storage.local.set({ [STORAGE_KEY]:currentSettings });
    await refresh();
  }

  async function savePulseUx() {
    pulseSettings = {
      ...pulseSettings,
      statusPinEnabled:els.statusPinEnabled.checked,
      outputWarningsEnabled:els.outputWarningsEnabled.checked,
      outputWarningStrictness:['relaxed','balanced','strict'].includes(els.outputWarningStrictness.value) ? els.outputWarningStrictness.value : 'balanced',
      branchReviewBeforeSend:els.branchReviewBeforeSend.checked,
      completionNotificationsEnabled:els.completionNotificationsEnabled.checked,
      tabBeaconsEnabled:els.tabBeaconsEnabled.checked,
      tabTitleStatusEnabled:els.tabTitleStatusEnabled.checked,
      tabFaviconStatusEnabled:els.tabFaviconStatusEnabled.checked,
      tabGroupingEnabled:els.tabGroupingEnabled.checked,
      activeEmoji:safe(els.activeEmoji.value, 12) || PULSE_DEFAULTS.activeEmoji,
      staleEmoji:safe(els.staleEmoji.value, 12) || PULSE_DEFAULTS.staleEmoji,
      completedEmoji:safe(els.completedEmoji.value, 12) || PULSE_DEFAULTS.completedEmoji,
      activeColor:els.activeColor.value || PULSE_DEFAULTS.activeColor,
      staleColor:els.staleColor.value || PULSE_DEFAULTS.staleColor,
      completedColor:els.completedColor.value || PULSE_DEFAULTS.completedColor,
      activeGroupColor:els.activeGroupColor.value,
      staleGroupColor:els.staleGroupColor.value,
      completedGroupColor:els.completedGroupColor.value
    };
    await chrome.storage.local.set({ [PULSE_UX_KEY]:pulseSettings });
    renderSettings(); renderChatPulse();
    chrome.runtime.sendMessage({ type:'PC_TAB_BEACON_REFRESH' }).catch(() => {});
  }

  async function applyTag(tag) {
    if (!currentTabId) return;
    const result = await chrome.runtime.sendMessage({ type:'PC_TAB_TAG_SET', tabId:currentTabId, tag:safe(tag, 24) }).catch(() => null);
    if (result?.ok) { currentTabTag = result.tag || ''; els.customTabTag.value = currentTabTag; els.tabTagHint.textContent = currentTabTag ? `Current tag: ${currentTabTag}` : 'Manual tag cleared.'; }
  }

  for (const key of ['enabled','responsiveScrolling','adaptiveMotionRelief']) els[key].addEventListener('change', savePerformance);
  for (const key of ['statusPinEnabled','outputWarningsEnabled','outputWarningStrictness','branchReviewBeforeSend','completionNotificationsEnabled','tabBeaconsEnabled','tabTitleStatusEnabled','tabFaviconStatusEnabled','tabGroupingEnabled','activeEmoji','staleEmoji','completedEmoji','activeColor','staleColor','completedColor','activeGroupColor','staleGroupColor','completedGroupColor']) els[key].addEventListener('change', savePulseUx);

  for (const card of [els.activeSummary,els.staleSummary,els.completedSummary]) card.addEventListener('click', () => {
    const bucket = card.dataset.chatBucket || (card === els.completedSummary ? 'completed' : card === els.staleSummary ? 'stale' : 'active');
    selectChatBucket(bucket);
  });
  els.closeChatList?.addEventListener('click', () => { selectedChatBucket = ''; renderChatList(); for (const card of [els.activeSummary,els.staleSummary,els.completedSummary]) { card.classList.remove('selected'); card.setAttribute('aria-expanded','false'); } });

  els.tagPresets.addEventListener('click', (event) => { const tag = event.target?.closest?.('button[data-tag]')?.dataset?.tag; if (tag) applyTag(tag).catch(() => {}); });
  els.applyTabTag.addEventListener('click', () => applyTag(els.customTabTag.value).catch(() => {}));
  els.clearTabTag.addEventListener('click', () => applyTag('').catch(() => {}));
  els.customTabTag.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); applyTag(els.customTabTag.value).catch(() => {}); } });
  els.resetMetrics.addEventListener('click', async () => { if (currentTabId) { try { renderStatus(await chrome.tabs.sendMessage(currentTabId, { type:'PC_RESET_METRICS' })); } catch (_) { renderStatus(null); } } });
  els.openHome.addEventListener('click', async () => { await chrome.tabs.create({ url:chrome.runtime.getURL('home.html'), active:true }); window.close(); });
  els.openConstellation.addEventListener('click', async () => { const [tab] = await chrome.tabs.query({ active:true, currentWindow:true }); let opened = false; if (tab?.windowId && chrome.sidePanel?.open) { try { await chrome.sidePanel.open({ windowId:tab.windowId }); opened = true; } catch (_) {} } if (!opened) await chrome.tabs.create({ url:chrome.runtime.getURL('sidepanel.html'), active:true }); window.close(); });
  els.openAccounts.addEventListener('click', async () => { await chrome.tabs.create({ url:chrome.runtime.getURL('home.html?view=connections'), active:true }); window.close(); });

  (async () => {
    const stored = await chrome.storage.local.get([STORAGE_KEY,PULSE_UX_KEY]);
    currentSettings = { ...DEFAULTS, ...(stored[STORAGE_KEY] || {}) };
    pulseSettings = { ...PULSE_DEFAULTS, ...(stored[PULSE_UX_KEY] || {}) };
    renderSettings();
    await Promise.all([refresh(), refreshBrainOverview()]);
  })();
})();
