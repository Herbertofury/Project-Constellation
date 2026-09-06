(() => {
  'use strict';

  const core = globalThis.ProjectConstellationChatVaultCore;
  if (!core) return;

  const $ = (id) => document.getElementById(id);
  const els = Object.fromEntries([
    'gatherOpenChats','refreshLive','newProject','newProjectSide','importChats','exportVault','vaultSearch','monitorMode',
    'liveFilters','liveAll','liveActive','liveAttention','liveDone','liveSaved','allCount','activeCount','attentionCount','doneCount','savedCount',
    'totalSavedCount','projectList','viewEyebrow','viewTitle','viewMeta','renameProject','openMissing','organizeTabs','deleteProject',
    'metricOpen','metricOpenDetail','metricRunning','metricAttention','metricDone','metricSaved','activeViewLabel','attentionFirst','lastLiveUpdate',
    'emptyState','emptyGather','searchSummary','chatGrid','vaultStatus',
    'projectDialog','projectForm','projectDialogTitle','projectNameInput','projectColorInput','saveProjectDialog',
    'importDialog','importForm','urlImportText','jsonImportFile','importCountHint','runTextImport',
    'styleDialog','styleForm','styleChatTitle','styleEmoji','styleEmojiPresets','styleColor','styleColorEnabled','styleText','clearStyle','saveStyle'
  ].map((id) => [id,$(id)]));

  const PRESET_EMOJI = ['🔥','📌','💡','🧪','✅','🧠','💻','🎮','🌟','🚀','💜','📚','🔨','🧹','🚧','💎'];
  const VIEW_COPY = Object.freeze({
    all:['ALL AI CHATS','Mission control','Showing every organized and currently open AI chat.'],
    active:['WORKING NOW','Live work','Generating responses, running tools, or being watched for progress.'],
    attention:['NEEDS ATTENTION','Intervention queue','Blocked, stalled, dead, paused, or provider-failed chats that need a human decision.'],
    done:['COMPLETED','Finished work','Chats whose latest turn is complete and healthy.'],
    saved:['SAVED / OFFLINE','Parked work','Organized chats whose provider tab is currently closed.']
  });

  let vault = core.emptyVault();
  let decorations = {};
  let prefs = { view:'all', attentionFirst:true };
  let liveSnapshot = { ok:true, generatedAt:0, openChatTabs:0, recentChats:[], counts:{active:0,stale:0,completed:0} };
  let liveByKey = new Map();
  let editingProjectId = '';
  let stylingItem = null;
  let liveTimer = 0;
  let statusTimer = 0;
  let refreshPromise = null;

  const clean = core.clean;

  function setStatus(message, kind = '') {
    if (!els.vaultStatus) return;
    els.vaultStatus.textContent = message;
    els.vaultStatus.className = kind;
    if (statusTimer) clearTimeout(statusTimer);
    if (kind && kind !== 'busy') statusTimer = setTimeout(() => {
      els.vaultStatus.className = '';
      els.vaultStatus.textContent = 'Ready.';
    }, 4400);
  }

  function dateLabel(stamp = Date.now()) {
    try { return new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(stamp)); }
    catch (_) { return new Date(stamp).toLocaleString(); }
  }

  function ageLabel(stamp) {
    const value = Number(stamp || 0);
    if (!value) return 'no activity yet';
    const seconds = Math.max(0,Math.round((Date.now() - value) / 1000));
    if (seconds < 8) return 'just now';
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 48) return `${hours}h ago`;
    return dateLabel(value);
  }

  function selectedProject() {
    return vault.stacks.find((stack) => stack.id === vault.selectedStackId) || null;
  }

  async function saveVault(next = vault) {
    vault = core.normalizeVault(next);
    vault.updatedAt = Date.now();
    await chrome.storage.local.set({ [core.VAULT_KEY]:vault });
    return vault;
  }

  async function saveDecorations() {
    decorations = core.normalizeDecorations(decorations);
    await chrome.storage.local.set({ [core.DECORATIONS_KEY]:decorations });
  }

  async function savePrefs() {
    prefs = {
      view:['all','active','attention','done','saved','project'].includes(prefs.view) ? prefs.view : 'all',
      attentionFirst:prefs.attentionFirst !== false
    };
    await chrome.storage.local.set({ [core.COMMAND_CENTER_PREFS_KEY]:prefs });
  }

  function liveForItem(item) {
    const row = liveByKey.get(item.key || core.chatKey(item.url));
    return row ? core.livePresentation(row) : core.normalizeLive({ state:'offline', label:'Saved', detail:'Saved in Project Constellation. Open the chat to resume live monitoring.' });
  }

  function styleForItem(item) {
    return core.normalizeDecoration(decorations[core.decorationKey(item.url)] || {});
  }

  function savedEntries() {
    const out = [];
    const seen = new Set();
    for (const stack of vault.stacks) {
      for (const item of stack.items) {
        const normalized = core.normalizeItem(item);
        if (!normalized || seen.has(normalized.key)) continue;
        seen.add(normalized.key);
        out.push({ item:normalized, stack });
      }
    }
    return out;
  }

  function itemFromLiveRow(row) {
    const url = core.canonicalUrl(row?.url || '');
    if (!url || !core.isSupportedChatUrl(url)) return null;
    const provider = core.providerForUrl(url);
    const stamp = Number(row.observedAt || Date.now());
    return core.normalizeItem({
      id:`live:${core.chatKey(url)}`,
      key:core.chatKey(url),
      url,
      title:row.title || provider?.name || 'AI chat',
      providerId:row.providerId || provider?.id || 'ai',
      providerName:row.providerName || provider?.name || 'AI chat',
      sourceTabId:row.tabId,
      sourceWindowId:row.windowId,
      createdAt:stamp,
      updatedAt:stamp,
      lastSeenOpenAt:stamp,
      live:core.livePresentation(row)
    });
  }

  function allEntries() {
    const entries = savedEntries();
    const byKey = new Map(entries.map((entry) => [entry.item.key,entry]));
    for (const row of liveSnapshot.recentChats || []) {
      const item = itemFromLiveRow(row);
      if (!item || byKey.has(item.key)) continue;
      const entry = { item, stack:null };
      entries.push(entry);
      byKey.set(item.key,entry);
    }
    return entries;
  }

  function displayEntries() {
    const q = clean(els.vaultSearch?.value || '',180).toLowerCase();
    let entries = allEntries();
    if (q) {
      entries = entries.filter(({item,stack}) => `${item.title} ${item.url} ${item.providerName} ${stack?.name || ''} ${(item.tags || []).join(' ')} ${item.note || ''}`.toLowerCase().includes(q));
    } else if (prefs.view === 'project') {
      const project = selectedProject();
      entries = project ? project.items.map((item) => ({ item:core.normalizeItem(item), stack:project })).filter((entry) => entry.item) : [];
    } else if (prefs.view !== 'all') {
      entries = entries.filter(({item}) => {
        const state = liveForItem(item).state;
        if (prefs.view === 'active') return state === 'running' || state === 'watching';
        if (prefs.view === 'attention') return core.ATTENTION_STATES.includes(state);
        if (prefs.view === 'done') return state === 'done';
        if (prefs.view === 'saved') return state === 'offline';
        return true;
      });
    }
    if (prefs.attentionFirst) entries.sort((a,b) => {
      const pa = core.LIVE_PRIORITY[liveForItem(a.item).state] ?? 99;
      const pb = core.LIVE_PRIORITY[liveForItem(b.item).state] ?? 99;
      return pa - pb || Number(liveForItem(b.item).lastActivityAt || b.item.updatedAt || 0) - Number(liveForItem(a.item).lastActivityAt || a.item.updatedAt || 0);
    });
    return entries;
  }

  function stateTotals() {
    const entries = allEntries();
    const counts = core.stateCounts(entries.map((entry) => ({ ...entry.item, live:liveForItem(entry.item) })));
    counts.total = entries.length;
    counts.open = Number(liveSnapshot.openChatTabs || 0);
    counts.active = Number(counts.running || 0) + Number(counts.watching || 0);
    counts.saved = Number(counts.offline || 0);
    return counts;
  }

  function setView(view, { persist = true } = {}) {
    prefs.view = ['all','active','attention','done','saved','project'].includes(view) ? view : 'all';
    if (persist) savePrefs().catch(() => {});
    render();
  }

  function renderLiveFilters(counts) {
    els.allCount.textContent = String(counts.total || 0);
    els.activeCount.textContent = String(counts.active || 0);
    els.attentionCount.textContent = String(counts.attention || 0);
    els.doneCount.textContent = String(counts.done || 0);
    els.savedCount.textContent = String(counts.saved || 0);
    for (const button of els.liveFilters.querySelectorAll('[data-view]')) button.classList.toggle('active',button.dataset.view === prefs.view);
  }

  function projectLiveCounts(stack) {
    return core.stateCounts((stack?.items || []).map((item) => ({ ...item, live:liveForItem(item) })));
  }

  function renderProjectList() {
    els.projectList.replaceChildren();
    for (const stack of vault.stacks) {
      const counts = projectLiveCounts(stack);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `stack-row${prefs.view === 'project' && stack.id === vault.selectedStackId ? ' active' : ''}`;
      button.dataset.stackId = stack.id;
      const color = document.createElement('span'); color.className = 'stack-color'; color.style.setProperty('--stack-color',stack.color);
      const copy = document.createElement('span'); copy.className = 'stack-copy';
      const name = document.createElement('strong'); name.textContent = stack.name;
      const updated = document.createElement('small');
      const liveBits = [];
      if (counts.running || counts.watching) liveBits.push(`${Number(counts.running||0)+Number(counts.watching||0)} working`);
      if (counts.attention) liveBits.push(`${counts.attention} attention`);
      updated.textContent = liveBits.length ? liveBits.join(' · ') : `updated ${dateLabel(stack.updatedAt)}`;
      copy.append(name,updated);
      const count = document.createElement('span'); count.className = 'stack-count';
      const number = document.createElement('span'); number.textContent = String(stack.items.length);
      const dot = document.createElement('em'); dot.className = counts.attention ? 'attention' : (counts.running || counts.watching) ? 'running' : '';
      count.append(number,dot);
      button.append(color,copy,count);
      button.addEventListener('click', async () => {
        vault.selectedStackId = stack.id;
        prefs.view = 'project';
        await Promise.all([saveVault(vault),savePrefs()]);
        render();
      });
      button.addEventListener('dragover',(event) => { event.preventDefault(); button.classList.add('drag-over'); });
      button.addEventListener('dragleave',() => button.classList.remove('drag-over'));
      button.addEventListener('drop', async (event) => {
        event.preventDefault(); button.classList.remove('drag-over');
        const payload = event.dataTransfer?.getData('application/x-project-constellation-chat');
        if (!payload) return;
        try {
          const data = JSON.parse(payload);
          await assignItemToProject(data.item,stack.id);
          prefs.view = 'project'; vault.selectedStackId = stack.id;
          await Promise.all([saveVault(vault),savePrefs()]); render();
          setStatus(`Moved chat to ${stack.name}.`,'success');
        } catch (_) { setStatus('Could not move that chat.','error'); }
      });
      els.projectList.appendChild(button);
    }
    els.totalSavedCount.textContent = `${core.stackCount(vault)} chats`;
  }

  function renderHeader() {
    const project = selectedProject();
    if (prefs.view === 'project' && project) {
      els.viewEyebrow.textContent = 'AI PROJECT';
      els.viewTitle.textContent = project.name;
      const counts = projectLiveCounts(project);
      const bits = [`${project.items.length} organized chat${project.items.length === 1 ? '' : 's'}`];
      if (counts.running || counts.watching) bits.push(`${Number(counts.running||0)+Number(counts.watching||0)} working`);
      if (counts.attention) bits.push(`${counts.attention} need attention`);
      els.viewMeta.textContent = bits.join(' · ');
    } else {
      const copy = VIEW_COPY[prefs.view] || VIEW_COPY.all;
      els.viewEyebrow.textContent = copy[0]; els.viewTitle.textContent = copy[1]; els.viewMeta.textContent = copy[2];
    }
    const projectMode = prefs.view === 'project' && Boolean(project);
    els.renameProject.hidden = !projectMode;
    els.deleteProject.hidden = !projectMode;
    els.openMissing.hidden = !projectMode;
  }

  function renderMetrics(counts) {
    els.metricOpen.textContent = String(counts.open || 0);
    els.metricRunning.textContent = String(counts.active || 0);
    els.metricAttention.textContent = String(counts.attention || 0);
    els.metricDone.textContent = String(counts.done || 0);
    els.metricSaved.textContent = String(counts.saved || 0);
    els.metricOpenDetail.textContent = counts.open === 1 ? 'provider tab' : 'provider tabs';
  }

  function chatDetail(live) {
    const detail = document.createElement('div'); detail.className = 'chat-detail';
    const headline = document.createElement('strong'); headline.textContent = live.detail || live.label;
    detail.appendChild(headline);
    if (live.activity) {
      const activity = document.createElement('span'); activity.className = 'activity'; activity.textContent = live.activity;
      detail.appendChild(activity);
    } else if (live.open && live.pending) {
      const activity = document.createElement('span'); activity.className = 'activity'; activity.textContent = `${live.pending} provider request${live.pending === 1 ? '' : 's'} in flight`;
      detail.appendChild(activity);
    }
    return detail;
  }

  function createChatCard(entry) {
    const {item,stack} = entry;
    const decoration = styleForItem(item);
    const live = liveForItem(item);
    const card = document.createElement('article');
    card.className = 'chat-card'; card.dataset.state = live.state; card.draggable = Boolean(stack);
    card.dataset.itemId = item.id; card.dataset.stackId = stack?.id || '';
    card.style.setProperty('--chat-color',decoration.color || stack?.color || '#8b5cf6');

    const head = document.createElement('div'); head.className = 'chat-head';
    const titleWrap = document.createElement('div'); titleWrap.className = 'chat-title';
    const emoji = document.createElement('span'); emoji.className = 'chat-emoji'; emoji.textContent = decoration.emoji || '✦';
    const titleCopy = document.createElement('div'); titleCopy.className = 'chat-title-copy';
    const title = document.createElement('strong'); title.textContent = item.title; title.className = `style-${decoration.style}`;
    const meta = document.createElement('small'); meta.textContent = `${stack?.name || 'Unassigned live chat'} · ${item.providerName || 'AI'}`;
    titleCopy.append(title,meta); titleWrap.append(emoji,titleCopy);
    const provider = document.createElement('span'); provider.className = 'provider-badge'; provider.textContent = item.providerName || item.providerId || 'AI';
    head.append(titleWrap,provider);

    const liveLine = document.createElement('div'); liveLine.className = 'live-line';
    const pill = document.createElement('span'); pill.className = `state-pill ${live.tone || live.state}`; pill.textContent = live.label || live.state;
    const age = document.createElement('span'); age.className = 'live-age'; age.textContent = live.open ? ageLabel(live.lastActivityAt || live.observedAt) : 'tab closed';
    liveLine.append(pill,age);

    const url = document.createElement('span'); url.className = 'chat-url'; url.textContent = item.url; url.title = item.url;
    const actions = document.createElement('div'); actions.className = 'chat-actions-row';
    const focus = document.createElement('button'); focus.type = 'button'; focus.className = live.open ? 'focus-chat' : 'open-chat'; focus.textContent = live.open ? 'Focus' : 'Open';
    focus.addEventListener('click',() => (live.open ? focusLive(item,live) : openItem(item)).catch((error) => setStatus(clean(error?.message || error,180),'error')));
    actions.appendChild(focus);

    if (live.retryAvailable && live.tabId) {
      const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'retry-chat'; retry.textContent = 'Retry'; retry.title = 'Use the provider\'s visible native retry control';
      retry.addEventListener('click',() => retryLive(live).catch((error) => setStatus(clean(error?.message || error,180),'error')));
      actions.appendChild(retry);
    }

    const style = document.createElement('button'); style.type = 'button'; style.textContent = '✦ Style'; style.addEventListener('click',() => openStyleDialog(item)); actions.appendChild(style);
    if (stack) {
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove'; remove.addEventListener('click',() => removeItem(stack.id,item.id).catch(() => {})); actions.appendChild(remove);
    }
    const move = document.createElement('select'); move.className = 'move-select'; move.title = 'Assign to project';
    const choose = document.createElement('option'); choose.value = ''; choose.textContent = stack ? 'Move…' : 'Assign…'; move.appendChild(choose);
    for (const target of vault.stacks.filter((row) => row.id !== stack?.id)) {
      const option = document.createElement('option'); option.value = target.id; option.textContent = target.name; move.appendChild(option);
    }
    move.addEventListener('change',async () => {
      if (!move.value) return;
      await assignItemToProject(item,move.value); render(); setStatus('Chat assigned to project.','success');
    });
    actions.appendChild(move);
    card.append(head,liveLine,chatDetail(live),url,actions);

    if (stack) {
      card.addEventListener('dragstart',(event) => {
        card.classList.add('dragging');
        event.dataTransfer?.setData('application/x-project-constellation-chat',JSON.stringify({ item, stackId:stack.id }));
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
      });
      card.addEventListener('dragend',() => card.classList.remove('dragging'));
    }
    return card;
  }

  function renderChats() {
    els.chatGrid.replaceChildren();
    const entries = displayEntries();
    const searching = Boolean(clean(els.vaultSearch.value,180));
    els.searchSummary.hidden = !searching;
    if (searching) els.searchSummary.textContent = `${entries.length} result${entries.length === 1 ? '' : 's'} across organized and live chats.`;
    for (const entry of entries) els.chatGrid.appendChild(createChatCard(entry));
    els.emptyState.hidden = Boolean(entries.length || vault.stacks.length || liveSnapshot.openChatTabs || searching);
    const labels = { all:'Showing every organized and live AI chat', active:'Showing chats that are actively working or being watched', attention:'Showing blocked, stalled, and dead chats', done:'Showing completed chats', saved:'Showing saved chats whose tabs are closed', project:`Showing ${selectedProject()?.name || 'selected project'}` };
    els.activeViewLabel.textContent = searching ? `Search results · ${entries.length} chats` : labels[prefs.view] || labels.all;
  }

  function render() {
    const counts = stateTotals();
    renderLiveFilters(counts); renderProjectList(); renderHeader(); renderMetrics(counts); renderChats();
    els.attentionFirst.checked = prefs.attentionFirst !== false;
  }

  async function focusLive(item,live) {
    if (!live.tabId) return openItem(item);
    const result = await chrome.runtime.sendMessage({ type:'PC_FOCUS_LIVE_CHAT', tabId:live.tabId });
    if (!result?.ok) throw new Error(result?.error || 'That live tab is no longer available.');
  }

  async function retryLive(live) {
    if (!live.tabId || !live.retryAvailable) return;
    setStatus('Using the provider\'s visible native retry control…','busy');
    const result = await chrome.runtime.sendMessage({ type:'PC_RETRY_LIVE_CHAT_FAILURE', tabId:live.tabId });
    if (!result?.ok) throw new Error(result?.error || 'Retry was unavailable.');
    setStatus('Retry requested. Monitoring resumed.','success');
    setTimeout(() => refreshLive(true).catch(() => {}),500);
  }

  async function openItem(item) {
    const tab = await chrome.tabs.create({ url:item.url, active:true });
    for (const stack of vault.stacks) {
      const row = stack.items.find((candidate) => candidate.key === item.key);
      if (row) { row.lastOpenedAt = Date.now(); row.sourceTabId = Number(tab?.id || 0); row.sourceWindowId = Number(tab?.windowId || 0); stack.updatedAt = Date.now(); }
    }
    await saveVault(vault); render();
    setTimeout(() => refreshLive(true).catch(() => {}),600);
    return tab;
  }

  async function removeItem(stackId,itemId) {
    const stack = vault.stacks.find((row) => row.id === stackId);
    if (!stack) return;
    stack.items = stack.items.filter((item) => item.id !== itemId); stack.updatedAt = Date.now();
    await saveVault(vault); render(); setStatus('Removed from project. The provider chat was not deleted.','success');
  }

  async function assignItemToProject(rawItem,targetId) {
    const item = core.normalizeItem(rawItem);
    const target = vault.stacks.find((stack) => stack.id === targetId);
    if (!item || !target) return false;
    for (const stack of vault.stacks) {
      if (stack.id === targetId) continue;
      const before = stack.items.length;
      stack.items = stack.items.filter((row) => row.key !== item.key);
      if (before !== stack.items.length) stack.updatedAt = Date.now();
    }
    target.items = core.mergeItems(target.items,[item]); target.updatedAt = Date.now(); vault.selectedStackId = target.id;
    await saveVault(vault);
    return true;
  }

  async function queryOpenChatTabs() {
    const tabs = await chrome.tabs.query({});
    return tabs.filter((tab) => core.isSupportedChatUrl(tab.url || ''));
  }

  async function gatherOpenChats() {
    setStatus('Gathering open AI chats without closing them…','busy');
    const tabs = await queryOpenChatTabs();
    if (!tabs.length) { setStatus('No open supported AI chat tabs were found.','error'); return null; }
    const stamp = Date.now();
    const items = tabs.map((tab) => core.tabToItem(tab,stamp)).filter(Boolean);
    let target = selectedProject();
    if (!target || prefs.view !== 'project') {
      const ensured = core.ensureStack(vault,core.LIVE_PROJECT_NAME,{select:true,color:'#8b5cf6'});
      vault = ensured.vault; target = ensured.stack;
    }
    for (const item of items) {
      for (const stack of vault.stacks) if (stack.id !== target.id) stack.items = stack.items.filter((row) => row.key !== item.key);
    }
    target = vault.stacks.find((stack) => stack.id === target.id) || target;
    target.items = core.mergeItems(target.items,items); target.updatedAt = Date.now(); vault.selectedStackId = target.id; prefs.view = 'project';
    await Promise.all([saveVault(vault),savePrefs()]);
    const verify = await chrome.storage.local.get(core.VAULT_KEY);
    const saved = core.normalizeVault(verify?.[core.VAULT_KEY]).stacks.find((stack) => stack.id === target.id);
    const keys = new Set(saved?.items?.map((item) => item.key) || []);
    if (!items.every((item) => keys.has(item.key))) { setStatus('Safety verification failed. No tabs were touched.','error'); return null; }
    await chrome.runtime.sendMessage({ type:'PC_TAB_BEACON_REFRESH' }).catch(() => null);
    await refreshLive(true);
    setStatus(`Gathered ${items.length} live AI chat${items.length === 1 ? '' : 's'} into ${target.name}. Tabs stayed open and signed in.`,'success');
    return target;
  }

  async function openMissingChats() {
    const project = selectedProject();
    if (!project?.items?.length) return;
    const openTabs = await queryOpenChatTabs();
    const openKeys = new Set(openTabs.map((tab) => core.chatKey(tab.url || '')).filter(Boolean));
    const missing = project.items.filter((item) => !openKeys.has(item.key));
    if (!missing.length) { setStatus('Every chat in this project is already open.','success'); return; }
    let opened = 0;
    for (const item of missing) {
      try { await chrome.tabs.create({ url:item.url, active:false, pinned:Boolean(item.pinned) }); opened += 1; } catch (_) {}
    }
    await chrome.runtime.sendMessage({ type:'PC_TAB_BEACON_REFRESH' }).catch(() => null);
    setStatus(`Opened ${opened} missing chat${opened === 1 ? '' : 's'} without duplicating tabs that were already live.`,'success');
    setTimeout(() => refreshLive(true).catch(() => {}),700);
  }

  async function organizeLiveTabs() {
    setStatus('Organizing live AI tabs by Constellation state…','busy');
    const result = await chrome.runtime.sendMessage({ type:'PC_TAB_BEACON_REFRESH' });
    if (!result?.ok) throw new Error(result?.error || 'Tab organization was unavailable.');
    setStatus(`Organized ${Number(result.tabs || 0)} live AI tab${Number(result.tabs || 0) === 1 ? '' : 's'} into Constellation-managed state groups.`,'success');
    await refreshLive(true);
  }

  function scheduleRefresh() {
    if (liveTimer) clearTimeout(liveTimer);
    liveTimer = 0;
    if (document.hidden) return;
    const states = [...liveByKey.values()].map((row) => core.livePresentation(row).state);
    const delay = states.some((state) => state === 'running' || state === 'watching') ? 2500 : states.some((state) => core.ATTENTION_STATES.includes(state)) ? 6000 : 12000;
    liveTimer = setTimeout(() => refreshLive(false).catch(() => {}),delay);
  }

  async function refreshLive(force = false) {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      if (!document.hidden || force) els.lastLiveUpdate.textContent = 'Checking live state…';
      const snapshot = await chrome.runtime.sendMessage({ type:'PC_LIVE_CHAT_PULSE', force:Boolean(force) });
      if (!snapshot?.ok) throw new Error(snapshot?.error || 'Live Chat Pulse is unavailable.');
      liveSnapshot = snapshot;
      liveByKey = new Map();
      for (const row of snapshot.recentChats || []) {
        const key = core.chatKey(row.url || '');
        if (key) liveByKey.set(key,row);
      }
      els.monitorMode.textContent = snapshot.partial ? 'partial' : 'sentinel';
      els.lastLiveUpdate.textContent = `Updated ${ageLabel(snapshot.generatedAt || Date.now())}${snapshot.partial ? ' · some tabs quiet' : ''}`;
      render();
      return snapshot;
    })().catch((error) => {
      els.lastLiveUpdate.textContent = 'Live state unavailable';
      setStatus(clean(error?.message || error,220),'error');
      return null;
    }).finally(() => {
      refreshPromise = null;
      scheduleRefresh();
    });
    return refreshPromise;
  }

  function openProjectDialog(mode = 'new') {
    const project = selectedProject();
    editingProjectId = mode === 'rename' ? (project?.id || '') : '';
    els.projectDialogTitle.textContent = editingProjectId ? 'Rename project' : 'New project';
    els.projectNameInput.value = editingProjectId ? project.name : '';
    els.projectColorInput.value = editingProjectId ? project.color : core.SAFE_COLORS[vault.stacks.length % core.SAFE_COLORS.length];
    els.projectDialog.showModal();
    setTimeout(() => { els.projectNameInput.focus(); els.projectNameInput.select(); },40);
  }

  async function commitProjectDialog(event) {
    event.preventDefault();
    const name = clean(els.projectNameInput.value,120) || 'AI project';
    const color = els.projectColorInput.value;
    if (editingProjectId) {
      const project = vault.stacks.find((row) => row.id === editingProjectId);
      if (project) { project.name = name; project.color = color; project.updatedAt = Date.now(); }
    } else {
      const project = core.createStack(name,[],{color}); vault = core.addStack(vault,project,{select:true}); prefs.view = 'project';
    }
    await Promise.all([saveVault(vault),savePrefs()]); els.projectDialog.close(); render(); setStatus('Project saved.','success');
  }

  async function deleteSelectedProject() {
    const project = selectedProject();
    if (!project) return;
    if (!confirm(`Delete the project "${project.name}"? This removes only Command Center organization; provider chats and open tabs stay untouched.`)) return;
    vault = core.removeStack(vault,project.id); prefs.view = 'all';
    await Promise.all([saveVault(vault),savePrefs()]); render(); setStatus('Project removed. Provider chats were left untouched.','success');
  }

  async function importText() {
    const items = core.parseUrlList(els.urlImportText.value);
    if (!items.length) { els.importCountHint.textContent = 'No supported AI chat URLs found.'; return; }
    const project = core.createStack(`Imported ${dateLabel()}`,items);
    vault = core.addStack(vault,project,{select:true}); prefs.view = 'project';
    await Promise.all([saveVault(vault),savePrefs()]); els.urlImportText.value = ''; els.importDialog.close(); render();
    setStatus(`Imported ${items.length} chat${items.length === 1 ? '' : 's'} into a new project.`,'success');
  }

  async function importJsonFile(file) {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const imported = core.normalizeVault(parsed?.vault || parsed);
      if (!imported.stacks.length) throw new Error('Backup contains no AI projects.');
      for (const stack of [...imported.stacks].reverse()) {
        const copy = core.createStack(stack.name,stack.items,{createdAt:stack.createdAt,color:stack.color});
        vault = core.addStack(vault,copy,{select:false});
      }
      if (parsed?.decorations && typeof parsed.decorations === 'object') decorations = { ...decorations,...core.normalizeDecorations(parsed.decorations) };
      await Promise.all([saveVault(vault),saveDecorations()]); els.importDialog.close(); render();
      setStatus(`Imported ${imported.stacks.length} project${imported.stacks.length === 1 ? '' : 's'} from backup.`,'success');
    } catch (error) { setStatus(clean(error?.message || 'Could not import that JSON backup.',220),'error'); }
  }

  function exportBackup() {
    const payload = JSON.stringify({ format:'project-constellation-ai-command-center',version:2,exportedAt:new Date().toISOString(),vault,decorations },null,2);
    const blob = new Blob([payload],{type:'application/json'}); const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = `Project-Constellation-AI-Command-Center-${new Date().toISOString().slice(0,10)}.json`; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url),1000); setStatus('Command Center backup exported.','success');
  }

  function openStyleDialog(item) {
    stylingItem = item; const decoration = styleForItem(item);
    els.styleChatTitle.textContent = item.title; els.styleEmoji.value = decoration.emoji; els.styleColor.value = decoration.color || '#8b5cf6'; els.styleColorEnabled.checked = Boolean(decoration.color); els.styleText.value = decoration.style;
    els.styleDialog.showModal();
  }

  async function commitStyle(event) {
    event.preventDefault(); if (!stylingItem) return;
    const key = core.decorationKey(stylingItem.url);
    const decoration = core.normalizeDecoration({ emoji:els.styleEmoji.value,color:els.styleColorEnabled.checked ? els.styleColor.value : '',style:els.styleText.value,updatedAt:Date.now() });
    if (!decoration.emoji && !decoration.color && decoration.style === 'clean') delete decorations[key]; else decorations[key] = decoration;
    await saveDecorations(); els.styleDialog.close(); stylingItem = null; render(); setStatus('Chat style saved.','success');
  }

  async function clearStyle(event) {
    event.preventDefault(); if (!stylingItem) return;
    delete decorations[core.decorationKey(stylingItem.url)]; await saveDecorations(); els.styleDialog.close(); stylingItem = null; render(); setStatus('Chat style cleared.','success');
  }

  async function load() {
    const stored = await chrome.storage.local.get([core.VAULT_KEY,core.DECORATIONS_KEY,core.COMMAND_CENTER_PREFS_KEY]);
    vault = core.normalizeVault(stored?.[core.VAULT_KEY]); decorations = core.normalizeDecorations(stored?.[core.DECORATIONS_KEY]);
    prefs = { ...prefs,...(stored?.[core.COMMAND_CENTER_PREFS_KEY] || {}) };
    if (!['all','active','attention','done','saved','project'].includes(prefs.view)) prefs.view = 'all';
    render(); await refreshLive(true);
  }

  for (const emoji of PRESET_EMOJI) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = emoji; button.addEventListener('click',() => { els.styleEmoji.value = emoji; }); els.styleEmojiPresets.appendChild(button);
  }

  els.gatherOpenChats.addEventListener('click',() => gatherOpenChats().catch((error) => setStatus(clean(error?.message || error,220),'error')));
  els.emptyGather.addEventListener('click',() => els.gatherOpenChats.click());
  els.refreshLive.addEventListener('click',() => refreshLive(true));
  els.organizeTabs.addEventListener('click',() => organizeLiveTabs().catch((error) => setStatus(clean(error?.message || error,220),'error')));
  els.openMissing.addEventListener('click',() => openMissingChats().catch((error) => setStatus(clean(error?.message || error,220),'error')));
  els.newProject.addEventListener('click',() => openProjectDialog('new')); els.newProjectSide.addEventListener('click',() => openProjectDialog('new')); els.renameProject.addEventListener('click',() => openProjectDialog('rename'));
  els.deleteProject.addEventListener('click',() => deleteSelectedProject().catch(() => {}));
  els.importChats.addEventListener('click',() => { els.importCountHint.textContent = ''; els.importDialog.showModal(); setTimeout(() => els.urlImportText.focus(),40); });
  els.exportVault.addEventListener('click',exportBackup); els.vaultSearch.addEventListener('input',render); els.projectForm.addEventListener('submit',commitProjectDialog);
  els.runTextImport.addEventListener('click',(event) => { event.preventDefault(); importText().catch(() => {}); });
  els.urlImportText.addEventListener('input',() => { els.importCountHint.textContent = `${core.parseUrlList(els.urlImportText.value).length} supported chats`; });
  els.jsonImportFile.addEventListener('change',() => importJsonFile(els.jsonImportFile.files?.[0]));
  els.styleForm.addEventListener('submit',commitStyle); els.clearStyle.addEventListener('click',clearStyle);
  els.attentionFirst.addEventListener('change',() => { prefs.attentionFirst = els.attentionFirst.checked; savePrefs().catch(() => {}); render(); });

  for (const button of document.querySelectorAll('[data-view]')) button.addEventListener('click',() => setView(button.dataset.view));

  document.addEventListener('visibilitychange',() => {
    if (document.hidden) { if (liveTimer) clearTimeout(liveTimer); liveTimer = 0; }
    else refreshLive(true).catch(() => {});
  });

  chrome.storage.onChanged.addListener((changes,area) => {
    if (area !== 'local') return;
    let changed = false;
    if (changes[core.VAULT_KEY]) { vault = core.normalizeVault(changes[core.VAULT_KEY].newValue); changed = true; }
    if (changes[core.DECORATIONS_KEY]) { decorations = core.normalizeDecorations(changes[core.DECORATIONS_KEY].newValue); changed = true; }
    if (changes[core.COMMAND_CENTER_PREFS_KEY]) { prefs = { ...prefs,...(changes[core.COMMAND_CENTER_PREFS_KEY].newValue || {}) }; changed = true; }
    if (changed) render();
  });

  load().catch((error) => setStatus(clean(error?.message || error || 'Could not load AI Command Center.',220),'error'));
})();
