(() => {
  'use strict';
  if (globalThis.__PROJECT_CONSTELLATION_PULSE_UX__) return;
  globalThis.__PROJECT_CONSTELLATION_PULSE_UX__ = true;

  const SETTINGS_KEY = 'projectConstellationPulseUxSettings';
  const DEFAULTS = Object.freeze({
    statusPinEnabled: true,
    outputWarningsEnabled: true,
    outputWarningStrictness: 'balanced',
    branchReviewBeforeSend: true,
    completionNotificationsEnabled: true
  });
  const ACTIVE_STATUSES = new Set(['running']);
  const STALE_STATUSES = new Set(['paused', 'waiting-user', 'blocked-approval', 'refresh-required', 'rate-limited', 'errored', 'stalled', 'auth-required', 'unavailable']);
  const COMPLETED_STATUSES = new Set(['idle', 'archived']);
  const STRICTNESS = new Set(['relaxed', 'balanced', 'strict']);

  let settings = { ...DEFAULTS };
  let countSnapshot = null;
  let countFetchedAt = 0;
  let countRequest = null;
  let contextSnapshot = null;
  let contextFetchedAt = 0;
  let contextRequest = null;
  let decorateTimer = 0;
  let hudObserver = null;
  let hudObservedRoot = null;
  let vaultObserver = null;
  let vaultObservedRoot = null;

  const safeText = (value, max = 220) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  const number = (value) => Math.max(0, Number(value) || 0);
  const normalizeSettings = (input = {}) => {
    const next = { ...DEFAULTS, ...(input || {}) };
    next.statusPinEnabled = next.statusPinEnabled !== false;
    next.outputWarningsEnabled = next.outputWarningsEnabled !== false;
    next.outputWarningStrictness = STRICTNESS.has(String(next.outputWarningStrictness || '')) ? String(next.outputWarningStrictness) : DEFAULTS.outputWarningStrictness;
    return next;
  };

  function statusBucket(status = 'idle') {
    const value = String(status || 'idle');
    if (ACTIVE_STATUSES.has(value)) return 'active';
    if (STALE_STATUSES.has(value)) return 'stale';
    if (COMPLETED_STATUSES.has(value)) return 'completed';
    return value === 'running' ? 'active' : 'completed';
  }

  function countsFromSnapshot(snapshot = {}) {
    if (snapshot.counts && typeof snapshot.counts === 'object') return { active:number(snapshot.counts.active), stale:number(snapshot.counts.stale), completed:number(snapshot.counts.completed) };
    const counts = snapshot.statusCounts || {};
    const sum = (statuses) => [...statuses].reduce((total, status) => total + number(counts[status]), 0);
    return { active:sum(ACTIVE_STATUSES), stale:sum(STALE_STATUSES), completed:sum(COMPLETED_STATUSES) };
  }

  async function refreshCounts(force = false) {
    const now = Date.now();
    if (!force && countSnapshot && now - countFetchedAt < 4000) return countSnapshot;
    if (countRequest) return countRequest;
    countRequest = chrome.runtime.sendMessage({ type: 'PC_LIVE_CHAT_PULSE', force }).then((response) => {
      if (response?.ok) {
        countSnapshot = response;
        countFetchedAt = Date.now();
      }
      return countSnapshot;
    }).catch(() => countSnapshot).finally(() => { countRequest = null; });
    return countRequest;
  }

  async function refreshContext(force = false) {
    const now = Date.now();
    if (!force && contextSnapshot && now - contextFetchedAt < 3500) return contextSnapshot;
    if (contextRequest) return contextRequest;
    contextRequest = chrome.runtime.sendMessage({ type: 'PC_LIVE_HEALTH_CONTEXT' }).then((response) => {
      if (response?.ok) {
        contextSnapshot = response;
        contextFetchedAt = Date.now();
      }
      return contextSnapshot;
    }).catch(() => contextSnapshot).finally(() => { contextRequest = null; });
    return contextRequest;
  }

  function regressionEvidence(regression = {}) {
    const rawActive = Boolean(regression?.active);
    const missingTurns = Array.isArray(regression?.missingTurns) ? regression.missingTurns : [];
    const changedTurns = Array.isArray(regression?.changedTurns) ? regression.changedTurns : [];
    const resourceLoss = number(regression?.missingAssets) + number(regression?.missingLinks) + number(regression?.missingCodeBlocks);
    let medium = 0;
    let strong = resourceLoss > 0 ? 1 : 0;
    let lowConfidence = 0;

    for (const row of missingTurns) {
      const textLength = number(row?.textLength);
      const savedScore = number(row?.savedScore);
      const ratio = textLength ? savedScore / textLength : 1;
      const richResources = number(row?.assetCount) + number(row?.linkCount) + number(row?.codeBlocks);
      const toolHeavy = richResources === 0 && textLength >= 48 && ratio > 0 && ratio < 0.68;
      if (toolHeavy) { lowConfidence += 1; continue; }
      if (richResources > 0 || textLength >= 700 || savedScore >= 1000) strong += 1;
      else if (textLength >= 260 || savedScore >= 360) medium += 1;
      else lowConfidence += 1;
    }

    for (const row of changedTurns) {
      const savedLength = number(row?.savedTextLength);
      const currentLength = number(row?.currentTextLength);
      const loss = Math.max(0, savedLength - currentLength);
      const lossRatio = savedLength ? loss / savedLength : 0;
      const savedScore = number(row?.savedScore);
      const scoreRatio = savedLength ? savedScore / savedLength : 1;
      const richResources = number(row?.lostAssets) + number(row?.lostLinks) + number(row?.lostCode);
      const toolHeavy = richResources === 0 && savedLength >= 48 && scoreRatio > 0 && scoreRatio < 0.68;
      if (toolHeavy && loss < 650) { lowConfidence += 1; continue; }
      if (richResources > 0 || (loss >= 600 && lossRatio >= 0.3)) strong += 1;
      else if (loss >= 240 && lossRatio >= 0.14) medium += 1;
      else lowConfidence += 1;
    }

    const affected = missingTurns.length + changedTurns.length;
    return { rawActive, affected, resourceLoss, strong, medium, lowConfidence };
  }

  function warningDecision(regression = {}) {
    const evidence = regressionEvidence(regression);
    if (!settings.outputWarningsEnabled || !evidence.rawActive) return { ...evidence, surface: false, reason: settings.outputWarningsEnabled ? 'clear' : 'disabled' };
    if (settings.outputWarningStrictness === 'strict') return { ...evidence, surface: true, reason: 'strict' };
    if (settings.outputWarningStrictness === 'relaxed') {
      const surface = evidence.strong >= 1 || evidence.resourceLoss >= 1;
      return { ...evidence, surface, reason: surface ? 'strong-evidence' : 'low-confidence' };
    }
    const surface = evidence.strong >= 1 || evidence.medium >= 1 || (evidence.affected >= 2 && evidence.lowConfidence < evidence.affected);
    return { ...evidence, surface, reason: surface ? 'balanced-evidence' : 'low-confidence' };
  }

  function stateDescriptor(chat = {}) {
    const status = String(chat?.status || 'idle');
    const bucket = statusBucket(status);
    if (bucket === 'active') {
      if (status === 'paused') return { bucket, title: 'Chat paused', detail: safeText(chat?.statusDetail) || 'The provider has a paused response ready to resume.' };
      if (status === 'waiting-user') return { bucket, title: 'Waiting for you', detail: safeText(chat?.statusDetail) || 'The provider is waiting for your input.' };
      if (status === 'blocked-approval') return { bucket, title: 'Waiting for approval', detail: safeText(chat?.statusDetail) || 'A visible provider approval is blocking the current step.' };
      return { bucket, title: 'Chat active', detail: safeText(chat?.statusDetail) || 'Observable provider activity is still in progress.' };
    }
    if (bucket === 'stale') return { bucket, title: 'Chat needs attention', detail: safeText(chat?.statusDetail) || `The provider reports ${status.replaceAll('-', ' ')}.` };
    return { bucket: 'completed', title: 'Chat complete', detail: safeText(chat?.statusDetail) || 'The provider is idle. Saved-output checks are tracked separately in Output Vault.' };
  }

  function setText(root, id, value) {
    const node = root?.getElementById?.(id);
    if (node && node.textContent !== value) node.textContent = value;
  }

  function rowsForBucket(snapshot = {}, bucket = 'active') {
    if (snapshot?.groups && Array.isArray(snapshot.groups[bucket])) return snapshot.groups[bucket];
    return (Array.isArray(snapshot?.recentChats) ? snapshot.recentChats : []).filter((row) => statusBucket(row?.status) === bucket);
  }

  function pinRowMeta(row = {}, bucket = 'active') {
    const generation = row.generation || {};
    const bits = [safeText(row.providerName || row.providerId || 'AI', 22)];
    if (bucket === 'active') bits.push(safeText(generation.phase || generation.toolPhase || 'working', 22).replaceAll('-', ' '));
    else if (bucket === 'stale') bits.push(row.reconnecting ? 'reconnecting' : safeText(row.status || 'attention', 22).replaceAll('-', ' '));
    else bits.push('complete');
    if (generation.modelSlug) bits.push(safeText(generation.modelSlug, 22));
    if (row.tabGroup?.title) bits.push(row.tabGroup.managed ? 'PC sorted' : `Group: ${safeText(row.tabGroup.title, 28)}`);
    return bits.filter(Boolean).join(' · ');
  }

  function renderPinList(list, snapshot, bucket) {
    if (!list || list.dataset.visible !== '1') return;
    const rows = rowsForBucket(snapshot || {}, bucket);
    const heading = list.querySelector('.pcx-chat-list-title');
    const body = list.querySelector('.pcx-chat-list-body');
    if (heading) heading.textContent = `${bucket === 'stale' ? 'Needs attention' : bucket === 'completed' ? 'Completed chats' : 'Active chats'} · ${rows.length}`;
    if (!body) return;
    body.replaceChildren();
    if (!rows.length) {
      const empty = document.createElement('div'); empty.className = 'pcx-chat-list-empty'; empty.textContent = 'No chats in this state right now.'; body.appendChild(empty); return;
    }
    for (const row of rows.slice(0, 50)) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'pcx-chat-list-row';
      const dot = document.createElement('i'); dot.className = `pcx-list-dot ${bucket}`;
      const copy = document.createElement('span'); copy.className = 'pcx-list-copy';
      const title = document.createElement('strong'); title.textContent = safeText(row.title || row.providerName || 'AI chat', 92);
      const meta = document.createElement('span'); meta.textContent = pinRowMeta(row, bucket);
      const arrow = document.createElement('b'); arrow.textContent = '↗';
      copy.append(title, meta); button.append(dot, copy, arrow);
      button.addEventListener('click', async () => {
        const result = await chrome.runtime.sendMessage({ type:'PC_FOCUS_LIVE_CHAT', tabId:Number(row.tabId || 0), windowId:Number(row.windowId || 0), url:String(row.url || '') }).catch(() => null);
        if (result?.ok) list.dataset.visible = '0';
      });
      body.appendChild(button);
    }
  }

  async function openPinBucket(ui, bucket) {
    if (!ui?.list) return;
    const alreadyOpen = ui.list.dataset.visible === '1' && ui.list.dataset.bucket === bucket;
    if (alreadyOpen) { ui.list.dataset.visible = '0'; return; }
    ui.list.dataset.bucket = bucket;
    ui.list.dataset.visible = '1';
    const fresh = await refreshCounts(true).catch(() => countSnapshot);
    renderPin(ui.pin, fresh);
    renderPinList(ui.list, fresh, bucket);
  }

  function ensureHudUi(host) {
    const shadow = host?.shadowRoot;
    if (!shadow) return null;
    if (!shadow.getElementById('pcxPulseUxStyle')) {
      const style = document.createElement('style');
      style.id = 'pcxPulseUxStyle';
      style.textContent = `
        .hud{position:relative!important;overflow:visible!important}
        .pcx-chat-pin{display:none;align-items:center;gap:3px;flex:0 0 auto;border:0;background:transparent;color:#cfd6ea;padding:0;margin:0;font:700 7px/1 system-ui}
        .pcx-chat-chip{width:auto!important;min-width:0!important;min-height:0!important;display:inline-flex;align-items:center;gap:3px;border:1px solid rgba(255,255,255,.1)!important;border-radius:999px!important;padding:4px 5px!important;background:rgba(255,255,255,.035)!important;color:#cfd6ea!important;white-space:nowrap;cursor:pointer;font:700 7px/1 system-ui!important}
        .pcx-chat-chip:hover,.pcx-chat-chip[aria-expanded="true"]{background:rgba(102,118,208,.16)!important;border-color:rgba(135,130,235,.38)!important}
        .pcx-chat-chip i{width:5px;height:5px;border-radius:50%;display:inline-block;background:#7e8aa8;box-shadow:0 0 8px rgba(126,138,168,.32)}
        .pcx-chat-chip.active i{background:#67b7ff;box-shadow:0 0 8px rgba(103,183,255,.48)}
        .pcx-chat-chip.stale i{background:#efb45f;box-shadow:0 0 8px rgba(239,180,95,.48)}
        .pcx-chat-chip.complete i{background:#63d6a7;box-shadow:0 0 8px rgba(99,214,167,.42)}
        .pcx-chat-list{display:none;position:absolute;z-index:2147483647;right:6px;top:calc(100% + 8px);width:min(360px,calc(100vw - 24px));border:1px solid rgba(129,141,224,.3);border-radius:13px;background:linear-gradient(155deg,rgba(13,18,48,.985),rgba(8,12,32,.99));box-shadow:0 20px 60px rgba(0,0,0,.48),inset 0 1px 0 rgba(255,255,255,.04);overflow:hidden;color:#eaf0ff}
        .pcx-chat-list[data-visible="1"]{display:block}
        .pcx-chat-list-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 10px;border-bottom:1px solid rgba(123,139,205,.15);background:linear-gradient(90deg,rgba(113,77,223,.1),rgba(60,125,218,.05))}
        .pcx-chat-list-title{font:800 9px/1.2 system-ui;color:#e9edff}.pcx-chat-list-close{width:24px!important;min-width:24px!important;min-height:24px!important;border:0!important;border-radius:7px!important;background:transparent!important;color:#8994ba!important;font-size:15px!important;cursor:pointer}
        .pcx-chat-list-body{display:grid;gap:4px;padding:6px;max-height:330px;overflow:auto;scrollbar-width:thin;scrollbar-color:#3d4775 transparent}
        .pcx-chat-list-row{width:100%!important;min-height:47px!important;display:grid!important;grid-template-columns:8px minmax(0,1fr) 14px!important;align-items:center!important;gap:7px!important;padding:7px 8px!important;border:1px solid rgba(126,145,210,.12)!important;border-radius:9px!important;background:rgba(255,255,255,.022)!important;color:#eef2ff!important;text-align:left!important;cursor:pointer!important}
        .pcx-chat-list-row:hover{background:rgba(90,105,190,.12)!important;border-color:rgba(136,127,235,.3)!important}.pcx-list-dot{width:7px;height:7px;border-radius:50%;box-shadow:0 0 9px currentColor}.pcx-list-dot.active{background:#67b7ff;color:#67b7ff}.pcx-list-dot.stale{background:#efb45f;color:#efb45f}.pcx-list-dot.completed{background:#63d6a7;color:#63d6a7}
        .pcx-list-copy{min-width:0;display:grid;gap:3px}.pcx-list-copy strong{font:750 9px/1.15 system-ui;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pcx-list-copy span{font:600 7.2px/1.2 system-ui;color:#7f89ad;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pcx-chat-list-row>b{color:#6875a4;font:700 10px/1 system-ui}.pcx-chat-list-empty{padding:18px 12px;text-align:center;color:#7f89ad;font:650 8px/1.4 system-ui}
        .pcx-vault-signal{display:none;align-items:center;gap:6px;border:1px solid rgba(239,180,95,.38);border-radius:8px;background:rgba(137,91,22,.12);color:#f2ca8b;padding:6px 8px;font:700 8px/1.1 system-ui;cursor:pointer}
        .pcx-vault-signal[data-visible="1"]{display:inline-flex}
        .pcx-vault-signal::before{content:"";width:6px;height:6px;border-radius:50%;background:#efb45f;box-shadow:0 0 9px rgba(239,180,95,.48)}
        :host([data-collapsed="1"][data-pcx-status-pin="1"]) .pcx-chat-pin{display:flex}
        :host([data-collapsed="1"][data-pcx-status-pin="1"]) .substate{display:none}
        :host([data-collapsed="1"][data-pcx-status-pin="1"]) .brand{max-width:112px}
        :host([data-pcx-output-secondary="1"][data-pcx-main-state="active"]){--pc-level:#67b7ff!important}
        :host([data-pcx-output-secondary="1"][data-pcx-main-state="stale"]){--pc-level:#efb45f!important}
        :host([data-pcx-output-secondary="1"][data-pcx-main-state="completed"]){--pc-level:#63d6a7!important}
        :host([data-pcx-output-secondary="1"]) .btn.vault[data-urgent="1"],:host([data-pcx-output-secondary="1"]) .quickVault[data-urgent="1"]{border-color:rgba(239,180,95,.45)!important;box-shadow:none!important;background:linear-gradient(135deg,rgba(137,91,22,.16),rgba(67,69,150,.18))!important}
        @media(max-width:620px){:host([data-collapsed="1"][data-pcx-status-pin="1"]) .pcx-chat-chip{padding:4px!important}.pcx-chat-chip .label{display:none}.pcx-chat-list{right:0;width:min(330px,calc(100vw - 16px))}}
      `;
      shadow.appendChild(style);
    }
    let pin = shadow.getElementById('pcxChatPin');
    if (pin?.tagName === 'BUTTON') { const replacement = document.createElement('div'); replacement.id = 'pcxChatPin'; replacement.className = 'pcx-chat-pin'; pin.replaceWith(replacement); pin = replacement; }
    if (!pin) {
      pin = document.createElement('div'); pin.id = 'pcxChatPin'; pin.className = 'pcx-chat-pin'; pin.setAttribute('role','group'); pin.setAttribute('aria-label','Chat status filters');
      const tools = shadow.querySelector('.tools'); tools?.parentNode?.insertBefore(pin, tools);
    }
    if (!pin.querySelector('[data-bucket="active"]')) {
      pin.innerHTML = `<button type="button" class="pcx-chat-chip active" data-bucket="active" aria-expanded="false" title="Browse active chats"><i></i><b class="label">Active</b><em data-count>0</em></button><button type="button" class="pcx-chat-chip stale" data-bucket="stale" aria-expanded="false" title="Browse chats needing attention"><i></i><b class="label">Stale</b><em data-count>0</em></button><button type="button" class="pcx-chat-chip complete" data-bucket="completed" aria-expanded="false" title="Browse completed chats"><i></i><b class="label">Done</b><em data-count>0</em></button>`;
    }
    let list = shadow.getElementById('pcxChatList');
    if (!list) {
      list = document.createElement('div'); list.id = 'pcxChatList'; list.className = 'pcx-chat-list'; list.dataset.visible = '0'; list.dataset.bucket = 'active';
      list.innerHTML = `<div class="pcx-chat-list-head"><strong class="pcx-chat-list-title">Active chats</strong><button type="button" class="pcx-chat-list-close" aria-label="Close chat list">×</button></div><div class="pcx-chat-list-body"></div>`;
      (shadow.querySelector('.hud') || shadow.firstElementChild || shadow).appendChild(list);
      list.querySelector('.pcx-chat-list-close')?.addEventListener('click', () => { list.dataset.visible = '0'; for (const chip of pin.querySelectorAll('[data-bucket]')) chip.setAttribute('aria-expanded','false'); });
    }
    if (pin.dataset.pcxNavBound !== '1') {
      pin.dataset.pcxNavBound = '1';
      pin.addEventListener('click', (event) => {
        const chip = event.target?.closest?.('[data-bucket]'); if (!chip) return;
        const bucket = chip.dataset.bucket; for (const node of pin.querySelectorAll('[data-bucket]')) node.setAttribute('aria-expanded', node === chip && !(list.dataset.visible === '1' && list.dataset.bucket === bucket) ? 'true' : 'false');
        openPinBucket({ shadow, pin, list }, bucket).catch(() => {});
      });
    }
    let signal = shadow.getElementById('pcxVaultSignal');
    if (!signal) {
      signal = document.createElement('button'); signal.id = 'pcxVaultSignal'; signal.type = 'button'; signal.className = 'pcx-vault-signal'; signal.dataset.visible = '0'; signal.textContent = 'Output Vault check';
      const vaultButton = shadow.getElementById('pcHealthVault'); vaultButton?.parentNode?.insertBefore(signal, vaultButton); signal.addEventListener('click', () => shadow.getElementById('pcHealthVault')?.click());
    }
    if (hudObservedRoot !== shadow) {
      hudObserver?.disconnect(); hudObservedRoot = shadow; hudObserver = new MutationObserver(() => scheduleDecorate(30));
      hudObserver.observe(shadow, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-urgent', 'hidden'] });
    }
    return { shadow, pin, list, signal };
  }

  function renderPin(pin, snapshot) {
    if (!pin) return;
    const counts = countsFromSnapshot(snapshot || {});
    for (const [bucket, count] of Object.entries(counts)) {
      const chip = pin.querySelector(`[data-bucket="${bucket}"]`); const node = chip?.querySelector('[data-count]');
      if (node && node.textContent !== String(count)) node.textContent = String(count);
      if (chip) chip.disabled = count <= 0;
    }
    pin.title = `Active ${counts.active} · Stale ${counts.stale} · Completed ${counts.completed}`;
    const list = pin.getRootNode()?.getElementById?.('pcxChatList');
    if (list?.dataset.visible === '1') renderPinList(list, snapshot || {}, list.dataset.bucket || 'active');
  }

  async function applyHudPolicy(host) {
    const ui = ensureHudUi(host);
    if (!ui) return;
    host.dataset.pcxStatusPin = settings.statusPinEnabled ? '1' : '0';
    renderPin(ui.pin, countSnapshot);

    const rawRegressionState = host.dataset.state === 'output-regressed' || /^saved output is missing/i.test(safeText(ui.shadow.getElementById('pcHealthTitle')?.textContent));
    if (!rawRegressionState) {
      host.dataset.pcxOutputSecondary = '0';
      delete host.dataset.pcxMainState;
      ui.signal.dataset.visible = '0';
      return;
    }

    const context = contextSnapshot || await refreshContext();
    const regression = context?.chat?.outputRegression || null;
    const decision = warningDecision(regression || { active: true });
    const main = stateDescriptor(context?.chat || {});
    host.dataset.pcxOutputSecondary = '1';
    host.dataset.pcxMainState = main.bucket;
    setText(ui.shadow, 'pcHealthTitle', main.title);
    setText(ui.shadow, 'pcHealthDetail', main.detail);
    setText(ui.shadow, 'pcHealthPage', decision.surface ? 'vault check' : 'current');
    const differenceLabel = decision.affected ? `${decision.affected} difference${decision.affected === 1 ? '' : 's'}` : 'saved/page difference';
    setText(ui.shadow, 'pcHealthMini', decision.surface ? `${main.title} · Output Vault: ${differenceLabel}` : `${main.title} · Output Vault warning suppressed by ${settings.outputWarningStrictness} sensitivity`);
    ui.signal.dataset.visible = decision.surface ? '1' : '0';
    ui.signal.textContent = decision.surface ? `Output Vault · ${differenceLabel}` : 'Output Vault check';
    ui.signal.title = decision.surface ? `${safeText(regression?.detail) || 'Saved output differs from the mounted page.'} This warning is secondary and does not replace chat health.` : 'Low-confidence saved/page differences remain available in Output Vault without taking over the main chat label.';
    for (const id of ['pcHealthVault', 'pcHealthVaultQuick']) {
      const button = ui.shadow.getElementById(id);
      if (!button) continue;
      button.dataset.urgent = '0';
      button.title = decision.surface ? `Output Vault · ${safeText(regression?.detail) || differenceLabel}` : 'Open Output Vault';
    }
  }

  function ensureVaultUi(host) {
    const shadow = host?.shadowRoot;
    if (!shadow) return null;
    if (!shadow.getElementById('pcxVaultPolicyStyle')) {
      const style = document.createElement('style');
      style.id = 'pcxVaultPolicyStyle';
      style.textContent = `
        .pcx-policy{margin-top:12px;padding:10px;border:1px solid rgba(151,164,244,.13);border-radius:11px;background:rgba(63,68,140,.08)}
        .pcx-policy-title{font-size:7.5px;text-transform:uppercase;letter-spacing:.1em;color:#838ead;margin-bottom:7px}
        .pcx-policy-row{display:grid;gap:5px;color:#aeb8d1;font-size:8.5px}.pcx-policy-row+ .pcx-policy-row{margin-top:8px}
        .pcx-policy select{width:100%;border:1px solid rgba(154,171,255,.18);border-radius:8px;background:#0b1029;color:#eef1ff;padding:7px 8px;font:650 8.5px/1.2 system-ui;outline:none}
        .pcx-policy-check{display:flex;align-items:center;gap:7px}.pcx-policy-check input{accent-color:#8e72f5}
        .pcx-policy-note{margin-top:8px;color:#7f8aa7;font-size:7.5px;line-height:1.4}
        .alert[data-pcx-secondary="1"]{border-color:rgba(239,180,95,.36)!important;background:linear-gradient(135deg,rgba(137,91,22,.18),rgba(66,54,120,.13))!important;color:#f4d7a8!important}
      `;
      shadow.appendChild(style);
    }
    let panel = shadow.getElementById('pcxVaultPolicy');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'pcxVaultPolicy';
      panel.className = 'pcx-policy';
      panel.innerHTML = `<div class="pcx-policy-title">Output warning sensitivity</div><label class="pcx-policy-row"><span>Strictness</span><select id="pcxVaultStrictness"><option value="relaxed">Relaxed · only strong losses</option><option value="balanced">Balanced · ignore low-confidence/tool noise</option><option value="strict">Strict · flag every saved/page difference</option></select></label><label class="pcx-policy-row pcx-policy-check"><input id="pcxVaultWarnings" type="checkbox"><span>Show saved/page mismatch warnings</span></label><div class="pcx-policy-note" id="pcxVaultPolicyNote">Raw saved revisions are always preserved regardless of warning sensitivity.</div>`;
      const rail = shadow.querySelector('.rail');
      const note = rail?.querySelector('.railNote');
      if (note) rail.insertBefore(panel, note); else rail?.appendChild(panel);
      panel.querySelector('#pcxVaultStrictness')?.addEventListener('change', async (event) => {
        settings.outputWarningStrictness = STRICTNESS.has(event.target.value) ? event.target.value : DEFAULTS.outputWarningStrictness;
        await chrome.storage.local.set({ [SETTINGS_KEY]: { ...settings } }).catch(() => {});
        scheduleDecorate(0);
      });
      panel.querySelector('#pcxVaultWarnings')?.addEventListener('change', async (event) => {
        settings.outputWarningsEnabled = Boolean(event.target.checked);
        await chrome.storage.local.set({ [SETTINGS_KEY]: { ...settings } }).catch(() => {});
        scheduleDecorate(0);
      });
    }
    if (vaultObservedRoot !== shadow) {
      vaultObserver?.disconnect();
      vaultObservedRoot = shadow;
      vaultObserver = new MutationObserver(() => scheduleDecorate(30));
      vaultObserver.observe(shadow, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-active'] });
    }
    return { shadow, panel };
  }

  async function applyVaultPolicy(host) {
    const ui = ensureVaultUi(host);
    if (!ui) return;
    const strictness = ui.shadow.getElementById('pcxVaultStrictness');
    const enabled = ui.shadow.getElementById('pcxVaultWarnings');
    if (strictness && strictness.value !== settings.outputWarningStrictness) strictness.value = settings.outputWarningStrictness;
    if (enabled && enabled.checked !== settings.outputWarningsEnabled) enabled.checked = settings.outputWarningsEnabled;

    const context = contextSnapshot || await refreshContext();
    const regression = context?.chat?.outputRegression || null;
    const decision = warningDecision(regression || {});
    const alert = ui.shadow.getElementById('pcVaultAlert');
    const note = ui.shadow.getElementById('pcxVaultPolicyNote');
    if (!alert) return;
    if (!regression?.active) {
      alert.dataset.pcxSecondary = '0';
      if (note) note.textContent = 'Raw saved revisions are preserved. No saved/page mismatch is currently active.';
      return;
    }
    alert.dataset.pcxSecondary = '1';
    alert.dataset.active = decision.surface ? '1' : '0';
    if (decision.surface) {
      setText(ui.shadow, 'pcVaultAlertTitle', 'Saved/page mismatch detected');
      if (note) note.textContent = `${settings.outputWarningStrictness[0].toUpperCase()}${settings.outputWarningStrictness.slice(1)} sensitivity is showing this warning. It stays secondary to the main chat-health label.`;
    } else if (note) {
      note.textContent = `${settings.outputWarningStrictness[0].toUpperCase()}${settings.outputWarningStrictness.slice(1)} sensitivity suppressed ${decision.affected || 'this'} low-confidence difference${decision.affected === 1 ? '' : 's'} (commonly tool/activity-card churn). The raw revisions are still available here.`;
    }
  }

  async function decorate() {
    decorateTimer = 0;
    const hud = document.getElementById('projectConstellationHealthHud');
    const vault = document.getElementById('projectConstellationOutputVault');
    if (settings.statusPinEnabled && hud && hud.dataset.collapsed === '1') await refreshCounts();
    if (hud?.dataset.state === 'output-regressed' || vault) await refreshContext();
    if (hud) await applyHudPolicy(hud);
    if (vault) await applyVaultPolicy(vault);
  }

  function scheduleDecorate(delay = 0) {
    if (decorateTimer) clearTimeout(decorateTimer);
    decorateTimer = setTimeout(() => { decorate().catch(() => {}); }, Math.max(0, delay));
  }

  async function loadSettings() {
    const stored = await chrome.storage.local.get(SETTINGS_KEY).catch(() => ({}));
    settings = normalizeSettings(stored?.[SETTINGS_KEY] || {});
  }

  chrome.storage?.onChanged?.addListener?.((changes, area) => {
    if (area !== 'local' || !changes?.[SETTINGS_KEY]) return;
    settings = normalizeSettings(changes[SETTINGS_KEY].newValue || {});
    scheduleDecorate(0);
  });

  const documentObserver = new MutationObserver(() => scheduleDecorate(50));
  documentObserver.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { countFetchedAt = 0; contextFetchedAt = 0; scheduleDecorate(0); }
  });
  window.addEventListener('focus', () => { countFetchedAt = 0; contextFetchedAt = 0; scheduleDecorate(0); }, { passive: true });

  setInterval(() => {
    const hud = document.getElementById('projectConstellationHealthHud');
    if (document.hidden || !settings.statusPinEnabled || !hud || hud.dataset.collapsed !== '1') return;
    countFetchedAt = 0;
    refreshCounts(true).then(() => scheduleDecorate(0)).catch(() => {});
  }, 7000);

  loadSettings().then(() => {
    refreshCounts().catch(() => {});
    scheduleDecorate(0);
  }).catch(() => scheduleDecorate(0));
})();