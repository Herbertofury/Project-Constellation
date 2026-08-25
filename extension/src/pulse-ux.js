(() => {
  'use strict';
  if (globalThis.__PROJECT_CONSTELLATION_PULSE_UX__) return;
  globalThis.__PROJECT_CONSTELLATION_PULSE_UX__ = true;

  const SETTINGS_KEY = 'projectConstellationPulseUxSettings';
  const DEFAULTS = Object.freeze({
    statusPinEnabled: true,
    outputWarningsEnabled: true,
    outputWarningStrictness: 'balanced'
  });
  const ACTIVE_STATUSES = new Set(['running', 'paused', 'waiting-user', 'blocked-approval']);
  const STALE_STATUSES = new Set(['refresh-required', 'rate-limited', 'errored', 'stalled', 'auth-required', 'unavailable']);
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
    const counts = snapshot.statusCounts || {};
    const sum = (statuses) => [...statuses].reduce((total, status) => total + number(counts[status]), 0);
    return {
      active: sum(ACTIVE_STATUSES),
      stale: sum(STALE_STATUSES),
      completed: sum(COMPLETED_STATUSES)
    };
  }

  async function refreshCounts(force = false) {
    const now = Date.now();
    if (!force && countSnapshot && now - countFetchedAt < 15000) return countSnapshot;
    if (countRequest) return countRequest;
    countRequest = chrome.runtime.sendMessage({ type: 'PC_BRAIN_COUNTS' }).then((response) => {
      if (response?.ok) {
        countSnapshot = response.counts || response;
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

  function ensureHudUi(host) {
    const shadow = host?.shadowRoot;
    if (!shadow) return null;
    if (!shadow.getElementById('pcxPulseUxStyle')) {
      const style = document.createElement('style');
      style.id = 'pcxPulseUxStyle';
      style.textContent = `
        .pcx-chat-pin{display:none;align-items:center;gap:3px;flex:0 0 auto;border:0;background:transparent;color:#cfd6ea;padding:0;margin:0;font:700 7px/1 system-ui;cursor:pointer}
        .pcx-chat-pin span{display:inline-flex;align-items:center;gap:3px;border:1px solid rgba(255,255,255,.1);border-radius:999px;padding:4px 5px;background:rgba(255,255,255,.035);white-space:nowrap}
        .pcx-chat-pin i{width:5px;height:5px;border-radius:50%;display:inline-block;background:#7e8aa8;box-shadow:0 0 8px rgba(126,138,168,.32)}
        .pcx-chat-pin .active i{background:#67b7ff;box-shadow:0 0 8px rgba(103,183,255,.48)}
        .pcx-chat-pin .stale i{background:#efb45f;box-shadow:0 0 8px rgba(239,180,95,.48)}
        .pcx-chat-pin .complete i{background:#63d6a7;box-shadow:0 0 8px rgba(99,214,167,.42)}
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
        @media(max-width:620px){:host([data-collapsed="1"][data-pcx-status-pin="1"]) .pcx-chat-pin span{padding:4px}.pcx-chat-pin .label{display:none}}
      `;
      shadow.appendChild(style);
    }
    let pin = shadow.getElementById('pcxChatPin');
    if (!pin) {
      pin = document.createElement('button');
      pin.id = 'pcxChatPin';
      pin.type = 'button';
      pin.className = 'pcx-chat-pin';
      pin.setAttribute('aria-label', 'Open chat status overview');
      const tools = shadow.querySelector('.tools');
      tools?.parentNode?.insertBefore(pin, tools);
      pin.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'PC_OPEN_CONSTELLATION_PAGE', view: 'attention' }).catch(() => {}));
    }
    let signal = shadow.getElementById('pcxVaultSignal');
    if (!signal) {
      signal = document.createElement('button');
      signal.id = 'pcxVaultSignal';
      signal.type = 'button';
      signal.className = 'pcx-vault-signal';
      signal.dataset.visible = '0';
      signal.textContent = 'Output Vault check';
      const vaultButton = shadow.getElementById('pcHealthVault');
      vaultButton?.parentNode?.insertBefore(signal, vaultButton);
      signal.addEventListener('click', () => shadow.getElementById('pcHealthVault')?.click());
    }
    if (hudObservedRoot !== shadow) {
      hudObserver?.disconnect();
      hudObservedRoot = shadow;
      hudObserver = new MutationObserver(() => scheduleDecorate(30));
      hudObserver.observe(shadow, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-urgent', 'hidden'] });
    }
    return { shadow, pin, signal };
  }

  function renderPin(pin, snapshot) {
    if (!pin) return;
    const counts = countsFromSnapshot(snapshot || {});
    const signature = `${counts.active}|${counts.stale}|${counts.completed}`;
    if (pin.dataset.signature === signature) return;
    pin.dataset.signature = signature;
    pin.innerHTML = `<span class="active" title="Active chats"><i></i><b class="label">Active</b> ${counts.active}</span><span class="stale" title="Stale or attention chats"><i></i><b class="label">Stale</b> ${counts.stale}</span><span class="complete" title="Completed or idle chats"><i></i><b class="label">Done</b> ${counts.completed}</span>`;
    pin.title = `Active ${counts.active} · Stale ${counts.stale} · Completed ${counts.completed}`;
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
  }, 20000);

  loadSettings().then(() => {
    refreshCounts().catch(() => {});
    scheduleDecorate(0);
  }).catch(() => scheduleDecorate(0));
})();