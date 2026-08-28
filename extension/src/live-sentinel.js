(() => {
  'use strict';

  const VERSION = '0.14.9';
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
  const CHATGPT_TRANSCRIPT_FRESH_MS = 6500;
  const CHATGPT_TRANSCRIPT_RUNNING_POLL_MS = 4500;
  const CHATGPT_TRANSCRIPT_IDLE_POLL_MS = 15000;
  const CHATGPT_PAGE_PROBE_RESPONSE_SOURCE = 'project-constellation-chatgpt-page-probe';
  const HEALTH_CORE_VERSION = '7';
  const BRAIN_SETTINGS_KEY = 'projectConstellationBrainSettings';
  const FAILURE_PRIMARY_STATES = new Set(['delivery-timeout','connection-interrupted','response-interrupted','send-failed']);
  const WATCHDOG_PRIMARY_STATES = new Set(['tool-stalled','tool-dead','request-stalled','stalled','dead','capacity-watch','capacity-handoff','capacity-reached',...FAILURE_PRIMARY_STATES]);
  const CHATGPT_PAGE_PROBE_REQUEST_SOURCE = 'project-constellation';


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
  let responseStartedAt = 0;
  let lastResponseDurationMs = 0;
  let lastResponseCompletedAt = 0;
  let lastToolProgressSignature = '';
  let lastTranscriptProgressSignature = '';
  let lastState = null;
  let lastPushSignature = '';
  let lastPushAt = 0;
  let scanCount = 0;
  let transitionCount = 0;
  let transcriptState = null;
  let transcriptPending = false;
  let transcriptRequestedAt = 0;
  let transcriptBackoffUntil = 0;
  let transcriptNonce = '';
  let transcriptTimer = 0;
  let pageMessageListener = null;
  let storageListener = null;
  let healthSettings = null;
  let lastFailureFingerprint = '';
  let failureDetectedAt = 0;
  let lastFailureClearedAt = 0;
  let failureRetryAttempts = 0;


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
    const turnRole = node?.getAttribute?.('data-turn');
    if (turnRole) return String(turnRole).toLowerCase();
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
    const chatgpt = [...document.querySelectorAll('article[data-turn][data-testid^="conversation-turn-"],[data-testid^="conversation-turn-"]')];
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

  function chatgptConversationId() {
    if (providerInfo().id !== 'chatgpt') return '';
    const match = String(location.pathname || '').match(/(?:^|\/)c\/([0-9a-f-]{16,})(?:\/|$)/i);
    return match?.[1] || '';
  }

  function turnMessageId(node) {
    if (!node) return '';
    return clean(
      node.getAttribute?.('data-turn-id') ||
      node.getAttribute?.('data-message-id') ||
      node.querySelector?.('[data-message-id]')?.getAttribute?.('data-message-id') || '',
      220
    );
  }

  function transcriptAligned(frontier, state = transcriptState) {
    if (!state?.ok || state.proof !== 'transcript') return false;
    const expectedConversation = chatgptConversationId();
    if (expectedConversation && state.conversationId && state.conversationId !== expectedConversation) return false;
    const domUserId = turnMessageId(frontier?.latestUser);
    const transcriptUserId = clean(state.latestUserMessageId || '', 220);
    if (domUserId && transcriptUserId && domUserId !== transcriptUserId) return false;
    return true;
  }

  function freshTranscript(frontier, at = now()) {
    if (!transcriptAligned(frontier)) return null;
    if (at - Number(transcriptState?.observedAt || 0) > CHATGPT_TRANSCRIPT_FRESH_MS) return null;
    return transcriptState;
  }

  function scheduleTranscript(delay) {
    if (providerInfo().id !== 'chatgpt' || !chatgptConversationId()) return;
    if (transcriptTimer) clearTimeout(transcriptTimer);
    transcriptTimer = setTimeout(() => {
      transcriptTimer = 0;
      requestTranscript(false);
    }, Math.max(250, Number(delay || 0)));
  }

  function requestTranscript(force = false) {
    if (providerInfo().id !== 'chatgpt') return false;
    const conversationId = chatgptConversationId();
    if (!conversationId || transcriptPending || now() < transcriptBackoffUntil) return false;
    const at = now();
    const minGap = stableStatus === 'running' ? CHATGPT_TRANSCRIPT_RUNNING_POLL_MS : CHATGPT_TRANSCRIPT_IDLE_POLL_MS;
    if (!force && at - transcriptRequestedAt < minGap) {
      scheduleTranscript(minGap - (at - transcriptRequestedAt));
      return false;
    }
    transcriptPending = true;
    transcriptRequestedAt = at;
    transcriptNonce = `${at.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    window.postMessage({
      source:CHATGPT_PAGE_PROBE_REQUEST_SOURCE,
      kind:'chatgpt-transcript-request',
      version:VERSION,
      nonce:transcriptNonce,
      conversationId,
      force:Boolean(force)
    }, location.origin);
    setTimeout(() => {
      if (!transcriptPending || at !== transcriptRequestedAt) return;
      transcriptPending = false;
      transcriptBackoffUntil = now() + 1800;
      scheduleTranscript(stableStatus === 'running' ? 1800 : 8000);
    }, 4500);
    return true;
  }

  function currentAssistantBusy(frontier) {
    const assistant = frontier?.assistantAfterUser;
    if (!assistant || !isUsable(assistant)) return false;
    if (assistant.getAttribute?.('aria-busy') === 'true') return true;
    return Boolean([...assistant.querySelectorAll?.('[aria-busy="true"],[data-is-streaming="true"],[data-state="streaming"]') || []].find(isUsable));
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
    const finalControls = Boolean(assistant.querySelector?.('button[data-testid="copy-turn-action-button"]'))
      || controls.some((node) => /^(copy response|copy|read aloud|good response|bad response|share|regenerate|retry)/i.test(clean(node.getAttribute?.('aria-label') || node.textContent, 120)))
      || Boolean(assistant.querySelector?.('[data-testid*="feedback" i],[data-testid*="regenerate" i]'));
    const text = clean(assistant.textContent || '', 200000);
    const fingerprint = `${text.length}|${text.slice(-180)}|${finalControls ? 1 : 0}`;
    return { hasAssistant:true, finalControls, textLength:text.length, fingerprint };
  }

  function nodeKey(node) {
    if (!node) return '';
    return clean(node.getAttribute?.('data-message-id') || node.getAttribute?.('data-testid') || node.textContent || '', 300);
  }

  function toolProgressSignature(rows = []) {
    return rows.slice(-12).map((row) => `${clean(row.label || '', 180)}|${row.phase || ''}|${row.activeLabel ? 1 : 0}|${row.busy ? 1 : 0}|${row.finishedLabel ? 1 : 0}`).join('||');
  }

  function updateProgressClocks(frontier, completion, rows, at) {
    const userKey = nodeKey(frontier.latestUser);
    const rowSignature = toolProgressSignature(rows);
    if (!initialized) {
      lastUserKey = userKey;
      lastAssistantFingerprint = completion.fingerprint || '';
      lastToolProgressSignature = rowSignature;
      if (userKey) lastProgressAt = at;
      return;
    }
    if (userKey && userKey !== lastUserKey) {
      lastUserKey = userKey;
      lastUserStartedAt = at;
      responseStartedAt = at;
      lastAssistantFingerprint = '';
      lastAssistantGrowthAt = 0;
      lastProgressAt = at;
      lastActivityAt = at;
      lastToolProgressSignature = '';
      lastTranscriptProgressSignature = '';
    }
    if (completion.hasAssistant && completion.fingerprint && completion.fingerprint !== lastAssistantFingerprint) {
      if (!completion.finalControls) {
        lastAssistantGrowthAt = at;
        lastProgressAt = at;
        lastActivityAt = at;
      }
      lastAssistantFingerprint = completion.fingerprint;
    }
    // A persistent spinner/active label is proof that the provider still *claims* work is
    // active, not proof of forward progress. Only a changed current-tool signature resets
    // the stall clock. This is what lets the watchdog distinguish slow work from a zombie UI.
    if (rowSignature && rowSignature !== lastToolProgressSignature) {
      lastToolProgressSignature = rowSignature;
      lastProgressAt = at;
      lastActivityAt = at;
    } else if (!rowSignature) {
      lastToolProgressSignature = '';
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

  const FAILURE_RECOVERY_CONTROL_PATTERN = /^(?:retry|try again|regenerate(?: response)?|resend(?: message)?|reconnect)$/i;

  function failureControlLabel(node) {
    return clean(node?.getAttribute?.('aria-label') || node?.getAttribute?.('title') || node?.textContent || '', 120);
  }

  function recoveryControlNear(surface) {
    const scopes = [];
    let cursor = surface instanceof Element ? surface : null;
    for (let depth = 0; cursor && cursor !== document.body && depth < 5; depth += 1, cursor = cursor.parentElement) scopes.push(cursor);
    for (const scope of scopes) {
      const controls = [...(scope.querySelectorAll?.('button,[role="button"]') || [])].filter((node) => !isOwnedNode(node) && isUsable(node));
      const exact = controls.find((node) => FAILURE_RECOVERY_CONTROL_PATTERN.test(failureControlLabel(node)));
      if (exact) return exact;
    }
    return null;
  }

  function failureSurfaceEvidence(frontier = null, rows = [], transcript = null) {
    const core = healthCore();
    if (!core?.classifyProviderFailure) return { active:false };
    const nodes = [...document.querySelectorAll(ALERT_SELECTOR)].slice(-80).reverse();
    for (const node of nodes) {
      if (isOwnedNode(node) || !isUsable(node) || !isCurrentFrontierNode(node, frontier)) continue;
      const text = clean(node.getAttribute?.('aria-label') || node.textContent || '', 1600);
      if (!text) continue;
      const control = recoveryControlNear(node);
      const retryLabel = failureControlLabel(control);
      const partialAssistantChars = Math.max(0, Number(transcript?.latestAssistantChars || 0), String(frontier?.assistantAfterUser?.textContent || '').length);
      const failure = core.classifyProviderFailure(text, {
        retryAvailable:Boolean(control),
        retryLabel,
        partialAssistantChars,
        toolActivitySeen:Boolean(rows?.length),
        observedAfterUser:Boolean(frontier?.latestUser)
      });
      if (!failure?.active) continue;
      const at = now();
      if (failure.fingerprint !== lastFailureFingerprint) {
        lastFailureFingerprint = failure.fingerprint;
        failureDetectedAt = at;
        failureRetryAttempts = 0;
        lastActivityAt = at;
      }
      return {
        ...failure,
        control,
        detectedAt:Number(failureDetectedAt || at),
        ageMs:Math.max(0, at - Number(failureDetectedAt || at)),
        retryAttempts:Number(failureRetryAttempts || 0),
        clearedAt:0
      };
    }
    if (lastFailureFingerprint) {
      lastFailureClearedAt = now();
      lastFailureFingerprint = '';
      failureDetectedAt = 0;
      failureRetryAttempts = 0;
    }
    return { active:false, clearedAt:Number(lastFailureClearedAt || 0) };
  }

  function nonRunningStatus(text) {
    const lower = String(text || '').toLowerCase();
    if (/continue generating|resume generation|resume response/.test(lower)) return 'paused';
    if (/allow chatgpt to use|permission required|approval required/.test(lower)) return 'blocked-approval';
    const failure = healthCore()?.classifyProviderFailure?.(text, {});
    if (failure?.active) return failure.status || failure.state;
    if (/message delivery timed out|delivery timed out/.test(lower)) return 'delivery-timeout';
    if (/connection interrupted|connection (?:was )?lost|network connection (?:was )?lost|reconnect(?:ion)? failed/.test(lower)) return 'connection-interrupted';
    if (/failed to deliver message|response (?:was )?interrupted|generation (?:was )?interrupted/.test(lower)) return 'response-interrupted';
    if (/too many requests|rate limit(?:ed| exceeded)?|http\s*429|error\s*429|status\s*429/.test(lower)) return 'rate-limited';
    if (/something went wrong|there was an error|network error|failed to (generate|respond|send)/.test(lower)) return 'errored';
    if (/session expired/.test(lower)) return 'auth-required';
    if (/conversation.{0,30}(not found|unavailable|deleted)|page not found/.test(lower)) return 'unavailable';
    return 'idle';
  }

  function healthCore() {
    const core = globalThis.ProjectConstellationHealthCore;
    return core?.deriveHealth && core?.deriveCapacity ? core : null;
  }

  function normalizedHealthSettings() {
    const core = healthCore();
    if (!core) return null;
    try { return core.normalizeSettings?.({ ...(core.DEFAULTS || {}), ...(healthSettings || {}) }) || { ...(core.DEFAULTS || {}), ...(healthSettings || {}) }; }
    catch (_) { return { ...(core.DEFAULTS || {}), ...(healthSettings || {}) }; }
  }

  function refreshHealthSettings() {
    if (!chrome?.storage?.local?.get) return;
    Promise.resolve(chrome.storage.local.get(BRAIN_SETTINGS_KEY)).then((stored) => {
      const core = healthCore();
      if (!core) return;
      healthSettings = core.normalizeSettings?.({ ...(core.DEFAULTS || {}), ...(stored?.[BRAIN_SETTINGS_KEY]?.liveHealth || {}) }) || { ...(core.DEFAULTS || {}), ...(stored?.[BRAIN_SETTINGS_KEY]?.liveHealth || {}) };
      scheduleScan(20);
    }).catch(() => {});
  }

  function explicitCapacitySignal() {
    const text = statusSurfaceText();
    const match = text.match(/(?:maximum conversation length|conversation (?:is )?too long|this conversation has reached.{0,80}limit|start a new chat to continue|context length (?:is )?(?:exceeded|too long)|maximum context length|conversation limit (?:reached|exceeded)|message is too long for this conversation|conversation has become too long)/i);
    return { explicitLimitSignal:Boolean(match), explicitLimitText:match ? clean(match[0], 220) : '' };
  }

  function standaloneHealth({ at, status, rows, transcript, frontier, progressiveTool, toolBusy, toolLabel, toolPhase, failure }) {
    const core = healthCore();
    const settings = normalizedHealthSettings();
    if (!core || !settings || settings.enabled === false) return null;
    const explicit = explicitCapacitySignal();
    const transcriptTurns = Math.max(0, Number(transcript?.visibleTurnCount || 0));
    const capacityInput = {
      storedTurns:0,
      sessionTurns:Math.max(0, Number(frontier?.turns?.length || 0)),
      mountedTurns:Math.max(0, Number(frontier?.turns?.length || 0)),
      capturedChars:0,
      transcriptTurns,
      transcriptChars:Math.max(0, Number(transcript?.contextChars || transcript?.visibleChars || 0)),
      recentAverageChars:Math.max(0, Number(transcript?.recentAverageChars || 0)),
      transcriptRecentAverageChars:Math.max(0, Number(transcript?.recentAverageChars || 0)),
      ...explicit
    };
    const toolPresent = Boolean(rows?.length || progressiveTool || toolBusy || toolLabel);
    const derived = core.deriveHealth({
      now:at,
      settings,
      chatStatus:status,
      running:status === 'running',
      network:{ pending:0, observed:false },
      tool:{
        present:toolPresent,
        active:Boolean(progressiveTool),
        busy:Boolean(toolBusy),
        label:toolLabel || '',
        phase:toolPhase || '',
        lastProgressAt:Number(lastProgressAt || 0),
        startedAt:Number(responseStartedAt || 0),
        entryCount:Math.max(0, Number(rows?.length || 0))
      },
      capacity:capacityInput,
      failure:failure?.active ? {
        active:true,
        state:String(failure.state || failure.status || ''),
        status:String(failure.status || failure.state || ''),
        title:clean(failure.title || '', 180),
        detail:clean(failure.detail || '', 420),
        retryAvailable:Boolean(failure.retryAvailable),
        retryLabel:clean(failure.retryLabel || '', 80),
        recommendedAction:String(failure.recommendedAction || ''),
        partialAssistantChars:Math.max(0, Number(failure.partialAssistantChars || 0)),
        toolActivitySeen:Boolean(failure.toolActivitySeen)
      } : null,
      lastTurnProgressAt:Number(lastProgressAt || 0),
      lastDomProgressAt:Number(lastProgressAt || 0),
      lastStatusChangeAt:0
    });
    const capacity = derived?.capacity || core.deriveCapacity(capacityInput, settings);
    const capacityAttention = ['watch','handoff','reached'].includes(capacity?.state || '');
    const severe = new Set(['tool-stalled','tool-dead','request-stalled','stalled','dead','refresh-required','rate-limited','blocked-approval','auth-required','unavailable','errored',...FAILURE_PRIMARY_STATES]);
    if (capacityAttention && !severe.has(String(derived?.state || ''))) {
      return {
        ...derived,
        state:capacity.state === 'reached' ? 'capacity-reached' : capacity.state === 'handoff' ? 'capacity-handoff' : 'capacity-watch',
        level:capacity.level || derived?.level || 'warning',
        title:capacity.title || derived?.title || 'Conversation runway narrowing',
        detail:capacity.detail || derived?.detail || '',
        recommendedAction:capacity.recommendedAction || derived?.recommendedAction || 'handoff',
        capacity
      };
    }
    return derived ? { ...derived, capacity } : null;
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
    const busyNode = null;
    const progressiveTool = Boolean(currentActive);
    const toolBusy = Boolean(currentBusy);
    const assistantBusy = currentAssistantBusy(frontier);
    const toolBusyEvidence = toolBusy && !(completion.finalControls && !progressiveTool);
    const assistantBusyEvidence = assistantBusy && !(completion.finalControls && !progressiveTool);
    const assistantGrowing = Boolean(frontier.assistantAfterUser && !completion.finalControls && lastAssistantGrowthAt && at - lastAssistantGrowthAt < ASSISTANT_GROWTH_GRACE_MS);
    const awaitingResponse = Boolean(initialized && frontier.latestUser && !frontier.assistantAfterUser && lastUserStartedAt && at - lastUserStartedAt < NEW_USER_GRACE_MS);

    // ChatGPT-specific deep proof: the conversation transcript is the same state tree the
    // UI renders. Its explicit finished_successfully + end_turn signal outranks stale
    // stop/aria-busy controls, while an unfinished current branch outranks a temporarily
    // settled DOM. This is deliberately metadata-only; answer text never leaves MAIN world.
    const transcript = freshTranscript(frontier, at);
    const transcriptFinal = Boolean(transcript?.final && transcript?.transcriptStatus === 'finished');
    const transcriptRunning = Boolean(transcript?.running && transcript?.transcriptStatus === 'running');
    const failure = failureSurfaceEvidence(frontier, rows, transcript);
    const domActive = Boolean(stopControl || streamingNode || assistantBusyEvidence || progressiveTool || toolBusyEvidence || assistantGrowing || awaitingResponse);
    const rawActive = failure.active ? false : transcriptFinal ? false : transcriptRunning ? true : domActive;

    if (providerInfo().id === 'chatgpt') requestTranscript(rawActive && !transcript);
    const inactiveStatus = failure.active ? String(failure.status || failure.state || 'errored') : nonRunningStatus(statusSurfaceText());
    let resolved;
    if (failure.active) {
      idleCandidateSince = 0;
      setStableStatus(inactiveStatus, at);
      resolved = { status:inactiveStatus, settling:false };
    } else resolved = resolveStatus(rawActive, inactiveStatus, at);
    const status = resolved.status;
    if (status === 'running') {
      const transcriptStart = Number(transcript?.responseStartedAt || transcript?.latestAssistantCreatedAt || transcript?.latestUserCreatedAt || 0);
      if (!responseStartedAt) responseStartedAt = transcriptStart > 0 && transcriptStart <= at ? transcriptStart : (lastUserStartedAt || stableSince || at);
      else if (transcriptStart > 0 && transcriptStart <= at && transcriptStart < responseStartedAt) responseStartedAt = transcriptStart;
      if (!lastProgressAt) lastProgressAt = responseStartedAt || at;
    } else if (responseStartedAt) {
      lastResponseDurationMs = Math.max(0, at - responseStartedAt);
      lastResponseCompletedAt = at;
      responseStartedAt = 0;
    }
    const provider = providerInfo();
    const toolLabel = clean((currentActive || currentBusy || informative)?.label || '', 160);
    const toolPhase = transcript?.phase || (currentActive || currentBusy || informative)?.phase || '';
    const fallbackHealth = standaloneHealth({ at, status, rows, transcript, frontier, progressiveTool, toolBusy, toolLabel, toolPhase, failure });
    const watchdogState = watchdogHudState();
    const healthState = watchdogState || String(fallbackHealth?.state || '') || (status === 'running' ? (progressiveTool || toolBusy ? 'tool-running' : 'working') : status === 'idle' ? 'healthy' : status);
    const stale = WATCHDOG_PRIMARY_STATES.has(healthState) || (status !== 'running' && status !== 'idle');
    const source = failure.active ? 'provider-failure-surface'
      : transcriptFinal ? 'chatgpt-transcript-finished'
      : transcriptRunning ? 'chatgpt-transcript-running'
      : stopControl ? 'stop-control'
      : streamingNode ? 'streaming-marker'
      : assistantBusyEvidence ? 'current-assistant-busy'
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
      assistantBusy:assistantBusyEvidence,
      awaitingResponse,
      toolLabel,
      toolPhase,
      phase:failure.active ? 'interrupted' : transcript?.phase || (currentActive || currentBusy || informative)?.phase || (status === 'running' ? 'thinking' : 'complete'),
      modelSlug:clean(transcript?.modelSlug || '', 100),
      progressPercent:Number.isFinite(Number(transcript?.progressPercent)) ? Number(transcript.progressPercent) : null,
      transcriptStatus:transcript?.transcriptStatus || 'unavailable',
      transcriptProof:Boolean(transcript),
      transcriptObservedAt:Number(transcript?.observedAt || 0),
      asyncTaskId:clean(transcript?.asyncTaskId || '', 160),
      toolCount:Number(transcript?.toolCount || 0),
      conversationTurnCount:Number(transcript?.visibleTurnCount || frontier.turns.length || 0),
      activeBranchMessages:Number(transcript?.activeBranchMessages || 0),
      conversationChars:Number(transcript?.contextChars || transcript?.visibleChars || 0),
      visibleChars:Number(transcript?.visibleChars || 0),
      recentAverageChars:Number(transcript?.recentAverageChars || 0),
      latestAssistantChars:Number(transcript?.latestAssistantChars || 0),
      responseStartedAt:Number(transcript?.responseStartedAt || 0),
      latestUserCreatedAt:Number(transcript?.latestUserCreatedAt || 0),
      latestAssistantCreatedAt:Number(transcript?.latestAssistantCreatedAt || 0),
      latestAssistantUpdatedAt:Number(transcript?.latestAssistantUpdatedAt || 0),
      startedAt:Number(responseStartedAt || 0),
      elapsedMs:status === 'running' && responseStartedAt ? Math.max(0, at - responseStartedAt) : Number(lastResponseDurationMs || 0),
      lastProgressAt:Number(lastProgressAt || 0),
      quietForMs:lastProgressAt ? Math.max(0, at - lastProgressAt) : 0,
      completedAt:Number(lastResponseCompletedAt || 0),
      finalControls:Boolean(completion.finalControls),
      frontierTool:Boolean(currentActive || currentBusy || informative),
      source,
      capacityState:String(fallbackHealth?.capacity?.state || 'clear'),
      capacitySafetyPercent:Math.max(0, Number(fallbackHealth?.capacity?.safetyPercent || 0)),
      capacityTurnCount:Math.max(0, Number(fallbackHealth?.capacity?.turnCount || 0)),
      capacityChars:Math.max(0, Number(fallbackHealth?.capacity?.capturedChars || 0)),
      interrupted:Boolean(failure.active),
      failureState:String(failure.active ? (failure.state || failure.status || '') : ''),
      failureDetectedAt:Number(failure.detectedAt || 0),
      failureAgeMs:Math.max(0, Number(failure.ageMs || 0)),
      retryAvailable:Boolean(failure.retryAvailable),
      retryLabel:clean(failure.retryLabel || '', 80)
    };
    const state = {
      ok:true,
      source:'live-sentinel',
      sentinel:true,
      version:VERSION,
      provider,
      chat:{
        id:chatgptConversationId(),
        status,
        rawStatus:status,
        title:document.title || provider.name,
        url:location.href,
        lastActivityAt,
        hasConversation:frontier.turns.length > 0,
        turnCount:frontier.turns.length,
        healthState,
        failure:failure.active ? {
          active:true,
          state:String(failure.state || failure.status || ''),
          status:String(failure.status || failure.state || ''),
          title:clean(failure.title || '', 180),
          detail:clean(failure.detail || '', 420),
          rawText:clean(failure.rawText || '', 700),
          detectedAt:Number(failure.detectedAt || 0),
          ageMs:Math.max(0, Number(failure.ageMs || 0)),
          retryAvailable:Boolean(failure.retryAvailable),
          retryLabel:clean(failure.retryLabel || '', 80),
          recommendedAction:String(failure.recommendedAction || ''),
          retryAttempts:Math.max(0, Number(failure.retryAttempts || 0)),
          partialAssistantChars:Math.max(0, Number(failure.partialAssistantChars || 0)),
          toolActivitySeen:Boolean(failure.toolActivitySeen)
        } : null
      },
      failure:failure.active ? {
        active:true,
        state:String(failure.state || failure.status || ''),
        status:String(failure.status || failure.state || ''),
        title:clean(failure.title || '', 180),
        detail:clean(failure.detail || '', 420),
        rawText:clean(failure.rawText || '', 700),
        detectedAt:Number(failure.detectedAt || 0),
        ageMs:Math.max(0, Number(failure.ageMs || 0)),
        retryAvailable:Boolean(failure.retryAvailable),
        retryLabel:clean(failure.retryLabel || '', 80),
        recommendedAction:String(failure.recommendedAction || ''),
        retryAttempts:Math.max(0, Number(failure.retryAttempts || 0)),
        partialAssistantChars:Math.max(0, Number(failure.partialAssistantChars || 0)),
        toolActivitySeen:Boolean(failure.toolActivitySeen)
      } : null,
      generation,
      health:fallbackHealth ? { state:String(fallbackHealth.state || ''), level:String(fallbackHealth.level || ''), title:clean(fallbackHealth.title || '', 180), detail:clean(fallbackHealth.detail || '', 360), recommendedAction:String(fallbackHealth.recommendedAction || ''), progressAgeMs:Math.max(0, Number(fallbackHealth.progressAgeMs || 0)), capacity:fallbackHealth.capacity || null } : null,
      tool:{
        present:Boolean(informative || currentActive || currentBusy),
        current:Boolean(currentActive || currentBusy || informative),
        busy:toolBusy,
        active:progressiveTool,
        label:toolLabel,
        phase:transcript?.phase || (currentActive || currentBusy || informative)?.phase || '',
        lastProgressAt:Number(lastProgressAt || 0),
        entryCount:rows.length
      },
      healthActive:status === 'running' && !stale,
      healthStale:stale,
      observedAt:at,
      hidden:document.hidden,
      diagnostics:{ scanCount, transitionCount, stableSince, idleCandidateSince, initialized, transcriptPending, transcriptRequestedAt, transcriptBackoffUntil, transcriptProof:Boolean(transcript), transcriptStatus:transcript?.transcriptStatus || 'unavailable' }
    };

    initialized = true;
    lastState = state;
    const signature = `${status}|${healthState}|${source}|${toolLabel}|${generation.finalControls ? 1 : 0}|${frontier.turns.length}`;
    patchLegacyHud(state);
    maybePush(state, signature);
    schedulePulse(status === 'running' ? (document.hidden ? 1500 : 900) : (document.hidden ? 10000 : 5000));
    if (provider.id === 'chatgpt') scheduleTranscript(status === 'running' ? CHATGPT_TRANSCRIPT_RUNNING_POLL_MS : CHATGPT_TRANSCRIPT_IDLE_POLL_MS);
    return state;
  }

  function retryCurrentFailure() {
    const frontier = conversationFrontier();
    const transcript = freshTranscript(frontier, now());
    const failure = failureSurfaceEvidence(frontier, toolRows(frontier), transcript);
    if (!failure?.active || !failure.retryAvailable || !failure.control || !isUsable(failure.control)) {
      return { ok:false, action:'retry-unavailable', error:'The provider no longer exposes a current-turn Retry control. Constellation left the tab untouched.' };
    }
    failureRetryAttempts += 1;
    const label = failure.retryLabel || 'Retry';
    failure.control.click();
    lastActivityAt = now();
    lastProgressAt = lastActivityAt;
    scheduleScan(80);
    return { ok:true, action:'retry', state:String(failure.state || failure.status || ''), label, attempt:failureRetryAttempts };
  }

  function setIfChanged(node, value) {
    const text = String(value ?? '');
    if (node && node.textContent !== text) node.textContent = text;
  }

  function watchdogHudState() {
    const host = document.getElementById('projectConstellationHealthHud');
    if (!host || host.dataset.watchdog !== HEALTH_CORE_VERSION) return '';
    const state = String(host.dataset.state || '');
    return WATCHDOG_PRIMARY_STATES.has(state) ? state : '';
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
    let retryButton = shadow.getElementById('pcHealthRetry');
    const actions = shadow.querySelector?.('.actions');
    if (!retryButton && actions) {
      retryButton = document.createElement('button');
      retryButton.className = 'btn primary';
      retryButton.id = 'pcHealthRetry';
      retryButton.hidden = true;
      retryButton.textContent = 'Retry response';
      retryButton.addEventListener('click', () => {
        retryButton.disabled = true;
        const result = retryCurrentFailure();
        if (!result?.ok) retryButton.disabled = false;
      });
      actions.insertBefore(retryButton, actions.firstChild || null);
    }
    const status = state.chat.status;
    const label = state.tool?.label || '';
    const toolActive = Boolean(state.tool?.active || state.tool?.busy);
    const capacityAttention = ['watch','handoff','reached'].includes(host.dataset.capacity || '');
    const authoritativeWatchdog = host.dataset.watchdog === HEALTH_CORE_VERSION;
    const sentinelHealthState = String(state.chat?.healthState || '');
    const sentinelPrimary = WATCHDOG_PRIMARY_STATES.has(sentinelHealthState);
    // The current v7 renderer remains authoritative when it already owns a watchdog/capacity
    // warning. On a hot-upgraded legacy tab, however, the Sentinel carries v7 health logic
    // itself so the old renderer cannot erase a real stall/runway warning until page reload.
    if ((authoritativeWatchdog && WATCHDOG_PRIMARY_STATES.has(host.dataset.state || '')) || (authoritativeWatchdog && capacityAttention)) return;

    hudApplying = true;
    try {
      host.dataset.liveSentinel = VERSION;
      if (sentinelPrimary) {
        const health = state.health || {};
        const capacity = health.capacity || {};
        const failure = state.failure?.active ? state.failure : state.chat?.failure?.active ? state.chat.failure : null;
        const level = health.level || (['tool-dead','dead'].includes(sentinelHealthState) ? 'critical' : FAILURE_PRIMARY_STATES.has(sentinelHealthState) ? 'danger' : 'warning');
        if (host.dataset.level !== level) host.dataset.level = level;
        if (host.dataset.state !== sentinelHealthState) host.dataset.state = sentinelHealthState;
        if (sentinelHealthState.startsWith('capacity-')) host.dataset.capacity = String(capacity.state || state.generation?.capacityState || 'watch');
        setIfChanged(title, health.title || sentinelHealthState.replaceAll('-', ' '));
        setIfChanged(mini, health.detail || `Runway Sentinel · ${sentinelHealthState.replaceAll('-', ' ')}`);
        setIfChanged(nowTitle, failure?.active ? (failure.title || 'Provider interruption') : label || (sentinelHealthState.startsWith('capacity-') ? 'Conversation runway' : 'No meaningful progress'));
        setIfChanged(nowDetail, failure?.active ? `${Math.round(Number(failure.ageMs || 0) / 1000)}s since detected${Number(failure.partialAssistantChars || 0) ? ` · ${Number(failure.partialAssistantChars || 0)} partial chars preserved` : ''}${failure.retryAvailable ? ' · Retry available.' : ' · Manual recovery.'}` : sentinelHealthState.startsWith('capacity-') ? `Measured branch load ${Math.max(0, Number(state.generation?.capacitySafetyPercent || 0))}% of the configured safety threshold.` : `Response elapsed ${Math.round(Number(state.generation?.elapsedMs || 0) / 1000)}s · no meaningful progress ${Math.round(Number(state.generation?.quietForMs || 0) / 1000)}s.`);
        setIfChanged(activity, toolActive ? 'tool' : sentinelHealthState.startsWith('capacity-') ? 'runway' : 'model');
        setIfChanged(tool, toolActive ? `${Math.max(1, Number(state.tool?.entryCount || 1))} live step${Number(state.tool?.entryCount || 1) === 1 ? '' : 's'}` : '—');
        const capacityNode = shadow.getElementById('pcHealthCapacity');
        if (capacityNode && sentinelHealthState.startsWith('capacity-')) setIfChanged(capacityNode, capacity.state === 'reached' ? 'provider limit' : `${Math.max(0, Number(capacity.safetyPercent || state.generation?.capacitySafetyPercent || 0))}% · ${capacity.state === 'handoff' ? 'secure' : 'watch'}`);
        const handoff = shadow.getElementById('pcHealthHandoff');
        if (handoff && ['capacity-handoff','capacity-reached'].includes(sentinelHealthState)) handoff.hidden = false;
        if (retryButton) {
          if (failure?.retryAvailable) {
            if (retryButton.hidden) retryButton.hidden = false;
            if (retryButton.disabled) retryButton.disabled = false;
            setIfChanged(retryButton, failure.retryLabel || 'Retry response');
            const retryTitle = `Use ChatGPT’s visible ${failure.retryLabel || 'Retry'} control once. Constellation never retries automatically.`;
            if (retryButton.title !== retryTitle) retryButton.title = retryTitle;
          } else {
            if (!retryButton.hidden) retryButton.hidden = true;
            if (retryButton.disabled) retryButton.disabled = false;
            setIfChanged(retryButton, 'Retry response');
          }
        }
        const refreshButton = shadow.getElementById('pcHealthRefresh');
        if (refreshButton && failure?.active) {
          const shouldHide = failure.recommendedAction === 'retry';
          if (refreshButton.hidden !== shouldHide) refreshButton.hidden = shouldHide;
        }
        return;
      }
      if (status === 'running') {
        if (retryButton && !retryButton.hidden) retryButton.hidden = true;
        if (host.dataset.level !== 'active') host.dataset.level = 'active';
        const liveState = toolActive ? 'tool-running' : 'working';
        if (host.dataset.state !== liveState) host.dataset.state = liveState;
        setIfChanged(title, toolActive && label ? `Tool working · ${label}` : 'Chat is still working');
        setIfChanged(mini, `${state.generation.transcriptProof ? 'Transcript proof' : state.generation.source.replaceAll('-', ' ')}${state.generation.modelSlug ? ` · ${state.generation.modelSlug}` : ''}`);
        setIfChanged(nowTitle, label || 'Response in progress');
        setIfChanged(nowDetail, state.generation.progressPercent !== null ? `${state.generation.phase.replaceAll('-', ' ')} · ${state.generation.progressPercent}% reported by ChatGPT` : `${state.generation.phase.replaceAll('-', ' ')} · ${state.generation.transcriptProof ? 'conversation transcript' : 'live page evidence'}`);
        setIfChanged(activity, toolActive ? 'tool' : 'model');
        setIfChanged(tool, toolActive ? `${Math.max(1, Number(state.tool?.entryCount || 1))} live step${Number(state.tool?.entryCount || 1) === 1 ? '' : 's'}` : '—');
      } else if (status === 'idle') {
        if (retryButton && !retryButton.hidden) retryButton.hidden = true;
        if (host.dataset.level !== 'healthy') host.dataset.level = 'healthy';
        if (host.dataset.state !== 'healthy') host.dataset.state = 'healthy';
        setIfChanged(title, 'Chat complete');
        setIfChanged(mini, state.generation.transcriptProof ? `Transcript finished${state.generation.modelSlug ? ` · ${state.generation.modelSlug}` : ''}` : 'Current response settled · live sentinel');
        setIfChanged(nowTitle, 'Response complete');
        setIfChanged(nowDetail, 'No current-turn generation or structured tool activity is present.');
        setIfChanged(activity, 'idle');
        setIfChanged(tool, '—');
      } else {
        const danger = ['errored','refresh-required','rate-limited','unavailable',...FAILURE_PRIMARY_STATES].includes(status);
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
        if (element.matches?.(`${STOP_SELECTOR},${STREAMING_SELECTOR},${BUSY_SELECTOR},${FAST_TOOL_SELECTOR},${ALERT_SELECTOR}`)) return true;
        if (element.querySelector?.(`${STOP_SELECTOR},${STREAMING_SELECTOR},${BUSY_SELECTOR},${FAST_TOOL_SELECTOR},${ALERT_SELECTOR}`)) return true;
        const text = clean(element.textContent || '', 320);
        if (text && (ACTIVE_PROGRESS_LINE_PATTERN.test(text) || FINISHED_PROGRESS_LINE_PATTERN.test(text) || GENERIC_TOOL_PATTERN.test(text))) return true;
      }
    }
    return false;
  }

  function startObserver() {
    pageObserver?.disconnect();
    pageObserver = new MutationObserver((mutations) => {
      if (mutations.some(mutationRelevant)) {
        scheduleScan(70);
        if (providerInfo().id === 'chatgpt') requestTranscript(false);
      }
    });
    pageObserver.observe(document.documentElement, {
      subtree:true,
      childList:true,
      characterData:true,
      attributes:true,
      attributeFilter:['aria-busy','aria-label','data-state','data-is-streaming','data-loading','data-testid','class']
    });
  }

  pageMessageListener = (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== CHATGPT_PAGE_PROBE_RESPONSE_SOURCE) return;
    if (data.kind === 'chatgpt-page-probe-ready') {
      if (providerInfo().id === 'chatgpt') requestTranscript(true);
      return;
    }
    if (data.kind !== 'chatgpt-transcript-state' || clean(data.nonce || '', 120) !== transcriptNonce) return;
    transcriptPending = false;
    const state = data.state && typeof data.state === 'object' ? data.state : null;
    if (state?.ok) {
      transcriptState = state;
      transcriptBackoffUntil = 0;
      const transcriptSignature = [state.currentNodeId,state.latestAssistantMessageId,state.latestMessageStatus,state.endTurn ? 1 : 0,state.isComplete ? 1 : 0,state.progressPercent ?? '',state.toolCount,state.phase,state.widgetStatus,state.transcriptStatus,state.latestAssistantChars,state.responseStartedAt,state.latestAssistantUpdatedAt].join('|');
      if (state.running && transcriptSignature !== lastTranscriptProgressSignature) {
        lastTranscriptProgressSignature = transcriptSignature;
        const at = now();
        lastActivityAt = at;
        lastProgressAt = Math.max(at, Number(state.latestAssistantUpdatedAt || 0));
        const transcriptStart = Number(state.responseStartedAt || state.latestAssistantCreatedAt || state.latestUserCreatedAt || 0);
        if (!responseStartedAt && transcriptStart > 0 && transcriptStart <= at) responseStartedAt = transcriptStart;
      } else if (!state.running) {
        lastTranscriptProgressSignature = transcriptSignature;
      }
    } else {
      transcriptBackoffUntil = now() + 4500;
    }
    scheduleScan(35);
  };
  window.addEventListener('message', pageMessageListener, false);

  messageListener = (message, _sender, sendResponse) => {
    if (message?.type === 'PC_LIVE_SENTINEL_REFRESH_TRANSCRIPT') {
      const requested = providerInfo().id === 'chatgpt' ? requestTranscript(true) : false;
      sendResponse({ ok:true, requested, state:scan(true) });
      return false;
    }
    if (message?.type === 'PC_LIVE_SENTINEL_RETRY_FAILURE') {
      sendResponse(retryCurrentFailure());
      return false;
    }
    if (message?.type !== 'PC_GET_LIVE_SENTINEL_STATE') return false;
    sendResponse(scan(true));
    return false;
  };
  chrome?.runtime?.onMessage?.addListener?.(messageListener);

  storageListener = (changes, areaName) => {
    if (areaName !== 'local' || !changes?.[BRAIN_SETTINGS_KEY]) return;
    const core = healthCore();
    if (!core) return;
    healthSettings = core.normalizeSettings?.({ ...(core.DEFAULTS || {}), ...(changes[BRAIN_SETTINGS_KEY].newValue?.liveHealth || {}) }) || { ...(core.DEFAULTS || {}), ...(changes[BRAIN_SETTINGS_KEY].newValue?.liveHealth || {}) };
    scheduleScan(20);
  };
  chrome?.storage?.onChanged?.addListener?.(storageListener);
  refreshHealthSettings();

  const api = {
    version:VERSION,
    getState:(force = false) => scan(Boolean(force)),
    peek:() => lastState || scan(true),
    rescan:() => scan(true),
    diagnostics:() => ({ scanCount, transitionCount, stableStatus, stableSince, idleCandidateSince, lastProgressAt, lastActivityAt, responseStartedAt, lastResponseDurationMs, lastResponseCompletedAt, lastToolProgressSignature, lastTranscriptProgressSignature, lastFailureFingerprint, failureDetectedAt, lastFailureClearedAt, failureRetryAttempts, transcriptState, transcriptPending, transcriptRequestedAt, transcriptBackoffUntil }),
    retryFailure:() => retryCurrentFailure(),
    dispose:() => {
      pageObserver?.disconnect(); pageObserver = null;
      hudHostObserver?.disconnect(); hudHostObserver = null;
      hudShadowObserver?.disconnect(); hudShadowObserver = null;
      guardedHud = null;
      if (scanTimer) clearTimeout(scanTimer); scanTimer = 0;
      if (pulseTimer) clearTimeout(pulseTimer); pulseTimer = 0;
      if (transcriptTimer) clearTimeout(transcriptTimer); transcriptTimer = 0;
      try { window.removeEventListener('message', pageMessageListener, false); } catch (_) {}
      try { chrome?.runtime?.onMessage?.removeListener?.(messageListener); } catch (_) {}
      try { chrome?.storage?.onChanged?.removeListener?.(storageListener); } catch (_) {}
    }
  };
  globalThis.ProjectConstellationLiveSentinel = api;
  startObserver();
  scan(true);
  if (providerInfo().id === 'chatgpt') requestTranscript(true);
})();
