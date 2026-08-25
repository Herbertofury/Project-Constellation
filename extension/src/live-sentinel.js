(() => {
  'use strict';

  const VERSION = '0.14.3';
  const existing = globalThis.ProjectConstellationLiveSentinel;
  if (existing?.version === VERSION) return;
  try { existing?.dispose?.(); } catch (_) {}

  const ACTIVE_TOOL_LABEL_PATTERN = /\b(searching|retrieving|fetching|reading|browsing|inspecting|checking|analyzing|analysing|reviewing|comparing|auditing|running|executing|building|compiling|packaging|verifying|testing|updating|editing|writing|creating|uploading|downloading|processing|calling|generating|patching|modifying|implementing|fixing|enhancing|persisting|porting|opening|clicking|typing|triggering)\b/i;
  const FINISHED_TOOL_LABEL_PATTERN = /\b(searched|retrieved|fetched|read|browsed|inspected|checked|analyzed|analysed|reviewed|compared|audited|ran|executed|built|compiled|packaged|verified|tested|updated|edited|wrote|written|created|uploaded|downloaded|processed|called|used|generated|patched|modified|implemented|fixed|enhanced|persisted|ported|opened|clicked|typed|triggered|completed|finished|passed)\b/i;
  const TOOL_EVENT_PATTERN = new RegExp(`(?:called tool|calling tool|tool call|used [^|\\n]{0,80} skill|${ACTIVE_TOOL_LABEL_PATTERN.source}|${FINISHED_TOOL_LABEL_PATTERN.source}|terminal|web search)`, 'i');
  const GENERIC_TOOL_PATTERN = /^(?:called tool|calling tool|tool call|used [^|\n]{0,80} skill|ran tool|running tool)$/i;
  const ACTIVE_PROGRESS_LINE_PATTERN = /^(?:searching|retrieving|fetching|reading|browsing|inspecting|checking|analyzing|analysing|reviewing|comparing|auditing|running|executing|building|compiling|packaging|verifying|testing|updating|editing|writing|creating|uploading|downloading|processing|calling|generating|patching|modifying|implementing|fixing|enhancing|persisting|porting|opening|clicking|typing|triggering)\b/i;
  const FINISHED_PROGRESS_LINE_PATTERN = /^(?:searched|retrieved|fetched|read|browsed|inspected|checked|analyzed|analysed|reviewed|compared|audited|ran|executed|built|compiled|packaged|verified|tested|updated|edited|wrote|written|created|uploaded|downloaded|processed|called|used|generated|patched|modified|implemented|fixed|enhanced|persisted|ported|opened|clicked|typed|triggered|completed|finished|passed)\b/i;
  const PROGRESS_LINE_PATTERN = new RegExp(`(?:${ACTIVE_PROGRESS_LINE_PATTERN.source}|${FINISHED_PROGRESS_LINE_PATTERN.source}|${GENERIC_TOOL_PATTERN.source})`, 'i');

  // Strong selectors identify UI that is semantically a tool/progress surface. Weak
  // selectors are ChatGPT's tertiary progress rows; they are accepted only when they
  // are not ordinary assistant prose.
  const STRONG_TOOL_SELECTOR = [
    '[data-testid*="tool" i]', '[data-testid*="search" i]', '[data-testid*="browse" i]', '[data-testid*="progress" i]',
    '[aria-label*="tool" i]', '[data-message-author-role="tool"]', '[role="status"]', '[aria-live="polite"]',
    '.group\\/tool-message', '[class*="tool-message" i]', '[class*="loading-shimmer" i]'
  ].join(',');
  const WEAK_PROGRESS_SELECTOR = '[class*="text-token-text-tertiary"],[class*="text-token-text-secondary"]';
  const FAST_TOOL_SELECTOR = `${STRONG_TOOL_SELECTOR},${WEAK_PROGRESS_SELECTOR}`;
  const STOP_SELECTOR = [
    '[data-testid="stop-button"]', '[data-testid*="stop" i]', '[data-testid*="cancel" i]',
    'button[aria-label*="stop generating" i]', 'button[aria-label*="stop streaming" i]', 'button[aria-label*="stop response" i]',
    'button[aria-label*="cancel generation" i]', 'button[aria-label*="cancel response" i]', 'button[aria-label="Stop" i]'
  ].join(',');
  const STREAMING_SELECTOR = '[data-is-streaming="true"],[data-testid*="streaming" i],[data-state="streaming" i],.result-streaming,[class*="result-streaming" i]';
  const BUSY_SELECTOR = '[aria-busy="true"],[data-state="loading" i],[data-state="pending" i],[data-loading="true"]';
  const OWNED_SELECTOR = '[id^="projectConstellation"],[data-project-constellation-owned="1"]';
  const ALERT_SELECTOR = '[role="alert"],[aria-live="assertive"],[data-testid*="error" i],[data-testid*="warning" i],[data-testid*="notice" i]';

  const IDLE_SETTLE_MS = 2200;
  const ASSISTANT_GROWTH_GRACE_MS = 1400;
  const NEW_USER_GRACE_MS = 9000;

  let pageObserver = null;
  let scanTimer = 0;
  let pulseTimer = 0;
  let messageListener = null;
  let hudHostObserver = null;
  let hudShadowObserver = null;
  let guardedHud = null;
  let hudApplying = false;

  let initialized = false;
  let lastUserKey = '';
  let lastUserStartedAt = 0;
  let lastAssistantFingerprint = '';
  let lastAssistantGrowthAt = 0;
  let lastStrongActiveAt = 0;
  let idleCandidateSince = 0;
  let stableStatus = 'idle';
  let stableSince = Date.now();
  let lastProgressAt = 0;
  let lastActivityAt = Date.now();
  let lastState = null;
  let lastPushSignature = '';
  let lastPushAt = 0;
  let scanCount = 0;
  let transitionCount = 0;

  const clean = (value, max = 240) => String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  const now = () => Date.now();

  function providerInfo() {
    const host = location.hostname.toLowerCase();
    if (host === 'chatgpt.com' || host === 'chat.openai.com') return { id:'chatgpt', name:'ChatGPT' };
    if (host === 'claude.ai') return { id:'claude', name:'Claude' };
    if (host === 'gemini.google.com') return { id:'gemini', name:'Gemini' };
    if (host === 'grok.com') return { id:'grok', name:'Grok' };
    if (host === 'chat.deepseek.com') return { id:'deepseek', name:'DeepSeek' };
    if (host.endsWith('perplexity.ai')) return { id:'perplexity', name:'Perplexity' };
    if (host === 'copilot.microsoft.com') return { id:'copilot', name:'Microsoft Copilot' };
    if (host === 'chat.mistral.ai') return { id:'mistral', name:'Le Chat' };
    if (host === 'poe.com') return { id:'poe', name:'Poe' };
    if (host.endsWith('meta.ai')) return { id:'metaai', name:'Meta AI' };
    if (host === 'chat.qwen.ai') return { id:'qwen', name:'Qwen Chat' };
    if (host.endsWith('kimi.com')) return { id:'kimi', name:'Kimi' };
    if (host.endsWith('character.ai')) return { id:'characterai', name:'Character.AI' };
    if (host === 'huggingface.co') return { id:'huggingchat', name:'HuggingChat' };
    if (host.endsWith('you.com')) return { id:'you', name:'You.com Chat' };
    if (host.endsWith('pi.ai')) return { id:'pi', name:'Pi' };
    if (host === 'duck.ai') return { id:'duckai', name:'Duck.ai' };
    return { id:'ai', name:'AI chat' };
  }

  function mainRoot() { return document.querySelector('main') || document.body || document.documentElement; }

  function elementFor(node) {
    if (!node) return null;
    if (node.nodeType === Node.ELEMENT_NODE) return node;
    return node.parentElement || null;
  }

  function isOwnedNode(node) {
    const element = elementFor(node);
    return Boolean(element && (element.matches?.(OWNED_SELECTOR) || element.closest?.(OWNED_SELECTOR)));
  }

  function isUsable(node) {
    if (!node || isOwnedNode(node) || node.disabled || node.getAttribute?.('aria-disabled') === 'true') return false;
    try {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || 1) <= 0.01) return false;
    } catch (_) {}
    const rect = node.getBoundingClientRect?.();
    return !rect || rect.width > 0 || rect.height > 0;
  }

  function roleForTurn(node) {
    const direct = node?.getAttribute?.('data-message-author-role') || node?.getAttribute?.('data-author') || node?.getAttribute?.('data-role');
    if (direct) return String(direct).toLowerCase();
    const nested = node?.querySelector?.('[data-message-author-role],[data-author],[data-role]');
    const nestedRole = nested?.getAttribute?.('data-message-author-role') || nested?.getAttribute?.('data-author') || nested?.getAttribute?.('data-role');
    if (nestedRole) return String(nestedRole).toLowerCase();
    const label = clean(`${node?.getAttribute?.('data-testid') || ''} ${node?.getAttribute?.('aria-label') || ''} ${node?.className || ''}`, 300).toLowerCase();
    if (/\b(user|human|prompt)\b/.test(label)) return 'user';
    if (/\b(assistant|model|response|bot)\b/.test(label)) return 'assistant';
    return '';
  }

  function turnNodes() {
    const chatgpt = [...document.querySelectorAll('[data-testid^="conversation-turn-"]')];
    if (chatgpt.length) return chatgpt;
    return [...document.querySelectorAll('[data-message-author-role][data-message-id],[data-author][data-message-id],[data-role="user"],[data-role="assistant"],[role="article"][aria-label]')];
  }

  function follows(node, boundary) {
    if (!node || !boundary || node === boundary || boundary.contains?.(node)) return false;
    try { return Boolean(boundary.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING); }
    catch (_) { return false; }
  }

  function conversationFrontier() {
    const turns = turnNodes();
    const users = turns.filter((node) => roleForTurn(node) === 'user');
    const assistants = turns.filter((node) => roleForTurn(node) === 'assistant');
    const latestUser = users.at(-1) || null;
    const assistantAfterUser = latestUser ? [...assistants].reverse().find((node) => follows(node, latestUser)) || null : assistants.at(-1) || null;
    const latestAssistant = assistantAfterUser || assistants.at(-1) || null;
    return { turns, latestUser, latestAssistant, assistantAfterUser };
  }

  function isCurrentFrontierNode(node, frontier) {
    if (!node || isOwnedNode(node)) return false;
    const { latestUser, assistantAfterUser } = frontier;
    if (!latestUser) return true;
    if (latestUser.contains?.(node)) return false;
    if (assistantAfterUser?.contains?.(node)) return true;
    return follows(node, latestUser);
  }

  function turnOwner(node) {
    const element = elementFor(node);
    if (!element) return null;
    return element.closest?.('[data-testid^="conversation-turn-"],[data-message-author-role][data-message-id],[data-author][data-message-id],[data-role="user"],[data-role="assistant"]') || null;
  }

  function isAssistantProse(node) {
    const element = elementFor(node);
    if (!element) return false;
    const owner = turnOwner(element);
    if (!owner || roleForTurn(owner) !== 'assistant') return false;
    if (element.matches?.(STRONG_TOOL_SELECTOR) || element.closest?.(STRONG_TOOL_SELECTOR)) return false;
    if (element.matches?.(WEAK_PROGRESS_SELECTOR) && !element.closest?.('p,li,pre,code,blockquote,[class*="markdown" i],[class*="prose" i]')) return false;
    return Boolean(element.closest?.('p,li,pre,code,blockquote,h1,h2,h3,h4,h5,h6,[class*="markdown" i],[class*="prose" i]')) || true;
  }

  function toolPhase(label = '') {
    const text = String(label || '').toLowerCase();
    if (/search|brows/.test(text)) return 'searching';
    if (/fetch|retriev|download|read/.test(text)) return 'retrieving';
    if (/inspect|audit|analyz|analys|compar|review|check/.test(text)) return 'inspecting';
    if (/verif|test|smoke/.test(text)) return 'verifying';
    if (/build|packag|compil/.test(text)) return 'building';
    if (/patch|updat|edit|writ|creat|enhanc|persist|port|modif|implement|fix/.test(text)) return 'editing';
    if (/terminal|execut|run/.test(text)) return 'executing';
    if (/call(?:ed|ing) tool|tool call/.test(text)) return 'tool call';
    return 'tool';
  }

  function nodeLabel(node) {
    const aria = clean(node?.getAttribute?.('aria-label') || '', 260);
    const title = clean(node?.getAttribute?.('title') || '', 260);
    const text = clean(node?.textContent || '', 280);
    const candidates = [aria, title, text].filter(Boolean);
    return candidates.find((value) => value.length <= 240 && TOOL_EVENT_PATTERN.test(value)) || '';
  }

  function toolSurfaceConfidence(node, frontier, { fallback = false } = {}) {
    const element = elementFor(node);
    if (!element || isOwnedNode(element) || !isCurrentFrontierNode(element, frontier)) return 0;
    if (element.matches?.(STRONG_TOOL_SELECTOR) || element.closest?.(STRONG_TOOL_SELECTOR)) return 3;
    if (element.matches?.(WEAK_PROGRESS_SELECTOR) || element.closest?.(WEAK_PROGRESS_SELECTOR)) {
      const label = clean(element.getAttribute?.('aria-label') || element.textContent || '', 260);
      return !isAssistantProse(element) && PROGRESS_LINE_PATTERN.test(label) ? 2 : 0;
    }
    if (fallback && !turnOwner(element) && !isAssistantProse(element)) {
      const label = clean(element.getAttribute?.('aria-label') || element.textContent || '', 260);
      return ACTIVE_PROGRESS_LINE_PATTERN.test(label) ? 1 : 0;
    }
    return 0;
  }

  function rowFromNode(node, frontier, options = {}) {
    const confidence = toolSurfaceConfidence(node, frontier, options);
    if (!confidence) return null;
    const label = nodeLabel(node);
    if (!label || /^worked for\b/i.test(label)) return null;
    const stateText = clean(`${node?.getAttribute?.('data-state') || ''} ${node?.getAttribute?.('aria-busy') || ''} ${node?.getAttribute?.('aria-expanded') || ''} ${node?.className || ''}`, 260);
    const busy = node?.getAttribute?.('aria-busy') === 'true'
      || /\b(loading|pending|running|streaming|progress)\b/i.test(stateText)
      || Boolean(node?.querySelector?.('[aria-busy="true"],[data-state*="loading" i],[data-state*="pending" i],[data-is-streaming="true"],[class*="spinner" i],[class*="loading" i]'));
    const activeLabel = ACTIVE_TOOL_LABEL_PATTERN.test(label) && !FINISHED_TOOL_LABEL_PATTERN.test(label);
    const finishedLabel = FINISHED_TOOL_LABEL_PATTERN.test(label) && !activeLabel;
    return {
      node,
      label,
      confidence,
      busy,
      current:true,
      activeLabel,
      finishedLabel,
      generic:GENERIC_TOOL_PATTERN.test(label),
      phase:toolPhase(label)
    };
  }

  function toolRows(frontier) {
    const root = mainRoot();
    if (!root) return [];
    const seenNodes = new Set();
    const rows = [];
    const add = (node, options = {}) => {
      if (!node || seenNodes.has(node) || isOwnedNode(node)) return;
      seenNodes.add(node);
      const row = rowFromNode(node, frontier, options);
      if (row) rows.push(row);
    };
    for (const node of [...root.querySelectorAll(FAST_TOOL_SELECTOR)].slice(-360)) add(node);

    // Fallback only examines small nodes outside recognized assistant turns. This is the
    // key guard against treating ordinary final-answer prose ("passed verification",
    // "building...", etc.) as live tool activity.
    for (const node of [...root.querySelectorAll('div,span,button,[role="status"],[aria-live]')].slice(-360)) {
      if (node.childElementCount > 4 || isOwnedNode(node) || !isCurrentFrontierNode(node, frontier)) continue;
      const text = clean(node.getAttribute?.('aria-label') || node.textContent || '', 260);
      if (!text || text.length > 200 || !ACTIVE_PROGRESS_LINE_PATTERN.test(text) || FINISHED_TOOL_LABEL_PATTERN.test(text)) continue;
      add(node, { fallback:true });
    }

    // Collapse wrapper/child duplicates by normalized label. Keep the last/highest-confidence row.
    const deduped = new Map();
    for (const row of rows) {
      const key = clean(row.label, 180).toLowerCase();
      const prior = deduped.get(key);
      if (!prior || row.confidence >= prior.confidence) deduped.set(key, row);
    }
    return [...deduped.values()];
  }

  function completionEvidence(frontier) {
    const assistant = frontier.assistantAfterUser || (!frontier.latestUser ? frontier.latestAssistant : null);
    if (!assistant) return { hasAssistant:false, finalControls:false, textLength:0, fingerprint:'' };
    const controls = [...assistant.querySelectorAll?.('button,[role="button"]') || []];
    const finalControls = controls.some((node) => /^(copy|read aloud|good response|bad response|share|regenerate|retry)/i.test(clean(node.getAttribute?.('aria-label') || node.textContent, 120)))
      || Boolean(assistant.querySelector?.('[data-testid*="copy" i],[data-testid*="feedback" i],[data-testid*="regenerate" i]'));
    const text = clean(assistant.textContent || '', 200000);
    const fingerprint = `${text.length}|${text.slice(-180)}|${finalControls ? 1 : 0}`;
    return { hasAssistant:true, finalControls, textLength:text.length, fingerprint };
  }

  function nodeKey(node) {
    if (!node) return '';
    return clean(node.getAttribute?.('data-message-id') || node.getAttribute?.('data-testid') || node.textContent || '', 300);
  }

  function updateProgressClocks(frontier, completion, rows, at) {
    const userKey = nodeKey(frontier.latestUser);
    if (!initialized) {
      lastUserKey = userKey;
      lastAssistantFingerprint = completion.fingerprint || '';
      return;
    }
    if (userKey && userKey !== lastUserKey) {
      lastUserKey = userKey;
      lastUserStartedAt = at;
      lastAssistantFingerprint = '';
      lastAssistantGrowthAt = 0;
      lastActivityAt = at;
    }
    if (completion.hasAssistant && completion.fingerprint && completion.fingerprint !== lastAssistantFingerprint) {
      if (!completion.finalControls) {
        lastAssistantGrowthAt = at;
        lastActivityAt = at;
      }
      lastAssistantFingerprint = completion.fingerprint;
    }
    if (rows.some((row) => row.activeLabel || row.busy)) {
      lastProgressAt = at;
      lastActivityAt = at;
    }
  }

  function statusSurfaceText() {
    const values = [];
    for (const node of [...document.querySelectorAll(ALERT_SELECTOR)].slice(-60)) {
      if (isOwnedNode(node) || !isUsable(node)) continue;
      const text = clean(node.getAttribute?.('aria-label') || node.textContent || '', 600);
      if (text) values.push(text);
    }
    return values.join(' | ').slice(-12000);
  }

  function nonRunningStatus(text) {
    const lower = String(text || '').toLowerCase();
    if (/continue generating|resume generation|resume response/.test(lower)) return 'paused';
    if (/allow chatgpt to use|permission required|approval required/.test(lower)) return 'blocked-approval';
    if (/message delivery timed out|connection interrupted|connection (?:was )?lost|network connection (?:was )?lost|reconnect(?:ion)? failed|failed to deliver message/.test(lower)) return 'refresh-required';
    if (/too many requests|rate limit(?:ed| exceeded)?|http\s*429|error\s*429|status\s*429/.test(lower)) return 'rate-limited';
    if (/something went wrong|there was an error|network error|failed to (generate|respond|send)/.test(lower)) return 'errored';
    if (/session expired/.test(lower)) return 'auth-required';
    if (/conversation.{0,30}(not found|unavailable|deleted)|page not found/.test(lower)) return 'unavailable';
    return 'idle';
  }

  function setStableStatus(next, at) {
    if (stableStatus === next) return;
    stableStatus = next;
    stableSince = at;
    transitionCount += 1;
  }

  function resolveStatus(rawActive, inactiveStatus, at) {
    if (rawActive) {
      lastStrongActiveAt = at;
      idleCandidateSince = 0;
      setStableStatus('running', at);
      return { status:'running', settling:false };
    }

    if (stableStatus === 'running') {
      if (!idleCandidateSince) idleCandidateSince = at;
      if (at - idleCandidateSince < IDLE_SETTLE_MS) return { status:'running', settling:true };
    }
    idleCandidateSince = 0;
    setStableStatus(inactiveStatus, at);
    return { status:inactiveStatus, settling:false };
  }

  function scan(force = false) {
    const at = now();
    if (!force && lastState && at - Number(lastState.observedAt || 0) < 180) return lastState;
    scanCount += 1;
    const root = mainRoot();
    const frontier = conversationFrontier();
    const rows = toolRows(frontier);
    const completion = completionEvidence(frontier);
    updateProgressClocks(frontier, completion, rows, at);

    const currentActive = [...rows].reverse().find((row) => row.activeLabel && !row.generic && row.confidence >= 1) || null;
    const currentBusy = [...rows].reverse().find((row) => row.busy && !row.generic && row.confidence >= 2) || null;
    const informative = [...rows].reverse().find((row) => !row.generic && row.confidence >= 2) || rows.at(-1) || null;

    const stopControl = [...document.querySelectorAll(STOP_SELECTOR)].find(isUsable) || null;
    const streamingNode = [...(root?.querySelectorAll?.(STREAMING_SELECTOR) || [])].reverse().find((node) => isCurrentFrontierNode(node, frontier) && isUsable(node)) || null;
    // Generic aria-busy/data-loading surfaces are deliberately NOT independent active
    // evidence. ChatGPT can leave busy attributes on large response/layout wrappers
    // after completion. A busy bit only counts when it belongs to a row already
    // proven to be a semantic tool/progress surface (currentBusy above).
    const busyNode = null;
    const progressiveTool = Boolean(currentActive);
    const toolBusy = Boolean(currentBusy);
    // A final-control set on the CURRENT assistant response is a strong completion
    // boundary. It only suppresses leftover busy bits, never a fresh present-tense
    // progress label or a real stop/streaming control. This fixes sticky aria-busy
    // wrappers without reintroducing the v0.14.1 bug where an OLD Copy button won.
    const toolBusyEvidence = toolBusy && !(completion.finalControls && !progressiveTool);
    const assistantGrowing = Boolean(frontier.assistantAfterUser && !completion.finalControls && lastAssistantGrowthAt && at - lastAssistantGrowthAt < ASSISTANT_GROWTH_GRACE_MS);
    const awaitingResponse = Boolean(initialized && frontier.latestUser && !frontier.assistantAfterUser && lastUserStartedAt && at - lastUserStartedAt < NEW_USER_GRACE_MS);
    const rawActive = Boolean(stopControl || streamingNode || progressiveTool || toolBusyEvidence || assistantGrowing || awaitingResponse);

    const inactiveStatus = nonRunningStatus(statusSurfaceText());
    const resolved = resolveStatus(rawActive, inactiveStatus, at);
    const status = resolved.status;
    const stale = status !== 'running' && status !== 'idle';
    const provider = providerInfo();
    const toolLabel = clean((currentActive || currentBusy || informative)?.label || '', 160);
    const source = stopControl ? 'stop-control'
      : streamingNode ? 'streaming-marker'
      : busyNode ? 'busy-marker'
      : progressiveTool ? 'current-progress-label'
      : toolBusy ? 'current-tool-busy'
      : assistantGrowing ? 'assistant-growth'
      : awaitingResponse ? 'awaiting-response'
      : resolved.settling ? 'settle-hysteresis'
      : 'settled';

    const generation = {
      active:status === 'running',
      rawActive,
      settling:Boolean(resolved.settling),
      stopControl:Boolean(stopControl),
      streaming:Boolean(streamingNode),
      busyNode:Boolean(busyNode),
      toolBusy:toolBusyEvidence,
      progressiveTool,
      assistantPending:assistantGrowing || awaitingResponse,
      assistantGrowing,
      awaitingResponse,
      toolLabel,
      toolPhase:(currentActive || currentBusy || informative)?.phase || '',
      finalControls:Boolean(completion.finalControls),
      frontierTool:Boolean(currentActive || currentBusy || informative),
      source
    };
    const state = {
      ok:true,
      source:'live-sentinel',
      sentinel:true,
      version:VERSION,
      provider,
      chat:{
        id:'',
        status,
        rawStatus:status,
        title:document.title || provider.name,
        url:location.href,
        lastActivityAt,
        hasConversation:frontier.turns.length > 0,
        turnCount:frontier.turns.length,
        healthState:status === 'running' ? (progressiveTool || toolBusy ? 'tool-running' : 'working') : status === 'idle' ? 'healthy' : status
      },
      generation,
      tool:{
        present:Boolean(informative || currentActive || currentBusy),
        current:Boolean(currentActive || currentBusy || informative),
        busy:toolBusy,
        active:progressiveTool,
        label:toolLabel,
        phase:(currentActive || currentBusy || informative)?.phase || '',
        lastProgressAt:Number(lastProgressAt || 0),
        entryCount:rows.length
      },
      healthActive:status === 'running',
      healthStale:stale,
      observedAt:at,
      hidden:document.hidden,
      diagnostics:{ scanCount, transitionCount, stableSince, idleCandidateSince, initialized }
    };

    initialized = true;
    lastState = state;
    const signature = `${status}|${source}|${toolLabel}|${generation.finalControls ? 1 : 0}|${frontier.turns.length}`;
    patchLegacyHud(state);
    maybePush(state, signature);
    schedulePulse(status === 'running' ? (document.hidden ? 1500 : 900) : (document.hidden ? 10000 : 5000));
    return state;
  }

  function setIfChanged(node, value) {
    const text = String(value ?? '');
    if (node && node.textContent !== text) node.textContent = text;
  }

  function bindHudGuard(host) {
    if (!host?.shadowRoot || guardedHud === host) return;
    hudHostObserver?.disconnect();
    hudShadowObserver?.disconnect();
    guardedHud = host;
    const repair = () => {
      if (hudApplying || !lastState || !guardedHud?.isConnected) return;
      queueMicrotask(() => {
        if (!hudApplying && lastState && guardedHud?.isConnected) patchLegacyHud(lastState);
      });
    };
    hudHostObserver = new MutationObserver(repair);
    hudHostObserver.observe(host, { attributes:true, attributeFilter:['data-level','data-state'] });
    hudShadowObserver = new MutationObserver(repair);
    hudShadowObserver.observe(host.shadowRoot, { subtree:true, childList:true, characterData:true });
  }

  function patchLegacyHud(state) {
    const host = document.getElementById('projectConstellationHealthHud');
    const shadow = host?.shadowRoot;
    if (!host || !shadow) return;
    bindHudGuard(host);
    const title = shadow.getElementById('pcHealthTitle');
    const mini = shadow.getElementById('pcHealthMini');
    const nowTitle = shadow.getElementById('pcHealthNowTitle');
    const nowDetail = shadow.getElementById('pcHealthNowDetail');
    const activity = shadow.getElementById('pcHealthActivity');
    const tool = shadow.getElementById('pcHealthTool');
    const status = state.chat.status;
    const label = state.tool?.label || '';
    const toolActive = Boolean(state.tool?.active || state.tool?.busy);

    hudApplying = true;
    try {
      host.dataset.liveSentinel = VERSION;
      if (status === 'running') {
        if (host.dataset.level !== 'active') host.dataset.level = 'active';
        const liveState = toolActive ? 'tool-running' : 'working';
        if (host.dataset.state !== liveState) host.dataset.state = liveState;
        setIfChanged(title, toolActive && label ? `Tool working · ${label}` : 'Chat is still working');
        setIfChanged(mini, `${state.generation.source.replaceAll('-', ' ')} · live sentinel`);
        setIfChanged(nowTitle, label || 'Response in progress');
        setIfChanged(nowDetail, toolActive ? 'Current response has structured live tool progress.' : 'Current response has authoritative live generation evidence.');
        setIfChanged(activity, toolActive ? 'tool' : 'model');
        setIfChanged(tool, toolActive ? `${Math.max(1, Number(state.tool?.entryCount || 1))} live step${Number(state.tool?.entryCount || 1) === 1 ? '' : 's'}` : '—');
      } else if (status === 'idle') {
        if (host.dataset.level !== 'healthy') host.dataset.level = 'healthy';
        if (host.dataset.state !== 'healthy') host.dataset.state = 'healthy';
        setIfChanged(title, 'Chat complete');
        setIfChanged(mini, 'Current response settled · live sentinel');
        setIfChanged(nowTitle, 'Response complete');
        setIfChanged(nowDetail, 'No current-turn generation or structured tool activity is present.');
        setIfChanged(activity, 'idle');
        setIfChanged(tool, '—');
      } else {
        const danger = ['errored','refresh-required','rate-limited','unavailable'].includes(status);
        const level = danger ? 'danger' : 'warning';
        if (host.dataset.level !== level) host.dataset.level = level;
        if (host.dataset.state !== status) host.dataset.state = status;
        setIfChanged(title, `Chat ${status.replaceAll('-', ' ')}`);
        setIfChanged(mini, `Authoritative live sentinel · ${status.replaceAll('-', ' ')}`);
      }
    } finally {
      hudApplying = false;
    }
  }

  function maybePush(state, signature) {
    if (!chrome?.runtime?.sendMessage) return;
    const at = now();
    if (signature === lastPushSignature && at - lastPushAt < (state.chat.status === 'running' ? 3000 : 8000)) return;
    lastPushSignature = signature;
    lastPushAt = at;
    chrome.runtime.sendMessage({ type:'PC_LIVE_CHAT_STATE_PUSH', state:{ ...state, sentinel:true } }).catch?.(() => {});
  }

  function scheduleScan(delay = 80) {
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = setTimeout(() => { scanTimer = 0; scan(true); }, Math.max(40, Number(delay || 0)));
  }

  function schedulePulse(delay = 5000) {
    if (pulseTimer) clearTimeout(pulseTimer);
    pulseTimer = setTimeout(() => { pulseTimer = 0; scan(true); }, Math.max(400, Number(delay || 0)));
  }

  function currentTurnMutation(node) {
    const owner = turnOwner(node);
    if (!owner) return false;
    const frontier = conversationFrontier();
    return roleForTurn(owner) === 'assistant' && isCurrentFrontierNode(owner, frontier);
  }

  function mutationRelevant(mutation) {
    if (isOwnedNode(mutation.target)) return false;
    if (mutation.type === 'characterData') {
      if (currentTurnMutation(mutation.target)) return true;
      const text = clean(mutation.target?.parentElement?.textContent || mutation.target?.textContent || '', 280);
      return Boolean(text && (ACTIVE_PROGRESS_LINE_PATTERN.test(text) || FINISHED_PROGRESS_LINE_PATTERN.test(text) || GENERIC_TOOL_PATTERN.test(text)));
    }
    if (mutation.type === 'attributes') {
      return /^(aria-busy|aria-label|data-state|data-is-streaming|data-loading|data-testid|class)$/.test(String(mutation.attributeName || ''));
    }
    if (mutation.type === 'childList') {
      const nodes = [...(mutation.addedNodes || []), ...(mutation.removedNodes || [])];
      for (const node of nodes) {
        if (isOwnedNode(node)) continue;
        const element = elementFor(node);
        if (!element) continue;
        if (currentTurnMutation(element)) return true;
        if (element.matches?.(`${STOP_SELECTOR},${STREAMING_SELECTOR},${BUSY_SELECTOR},${FAST_TOOL_SELECTOR}`)) return true;
        if (element.querySelector?.(`${STOP_SELECTOR},${STREAMING_SELECTOR},${BUSY_SELECTOR},${FAST_TOOL_SELECTOR}`)) return true;
        const text = clean(element.textContent || '', 320);
        if (text && (ACTIVE_PROGRESS_LINE_PATTERN.test(text) || FINISHED_PROGRESS_LINE_PATTERN.test(text) || GENERIC_TOOL_PATTERN.test(text))) return true;
      }
    }
    return false;
  }

  function startObserver() {
    pageObserver?.disconnect();
    pageObserver = new MutationObserver((mutations) => {
      if (mutations.some(mutationRelevant)) scheduleScan(70);
    });
    pageObserver.observe(document.documentElement, {
      subtree:true,
      childList:true,
      characterData:true,
      attributes:true,
      attributeFilter:['aria-busy','aria-label','data-state','data-is-streaming','data-loading','data-testid','class']
    });
  }

  messageListener = (message, _sender, sendResponse) => {
    if (message?.type !== 'PC_GET_LIVE_SENTINEL_STATE') return false;
    sendResponse(scan(true));
    return false;
  };
  chrome?.runtime?.onMessage?.addListener?.(messageListener);

  const api = {
    version:VERSION,
    getState:(force = false) => scan(Boolean(force)),
    peek:() => lastState || scan(true),
    rescan:() => scan(true),
    diagnostics:() => ({ scanCount, transitionCount, stableStatus, stableSince, idleCandidateSince, lastProgressAt, lastActivityAt }),
    dispose:() => {
      pageObserver?.disconnect(); pageObserver = null;
      hudHostObserver?.disconnect(); hudHostObserver = null;
      hudShadowObserver?.disconnect(); hudShadowObserver = null;
      guardedHud = null;
      if (scanTimer) clearTimeout(scanTimer); scanTimer = 0;
      if (pulseTimer) clearTimeout(pulseTimer); pulseTimer = 0;
      try { chrome?.runtime?.onMessage?.removeListener?.(messageListener); } catch (_) {}
    }
  };
  globalThis.ProjectConstellationLiveSentinel = api;
  startObserver();
  scan(true);
})();
