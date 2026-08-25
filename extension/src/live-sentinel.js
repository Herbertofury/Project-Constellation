(() => {
  'use strict';

  const VERSION = '0.14.2';
  const existing = globalThis.ProjectConstellationLiveSentinel;
  if (existing?.version === VERSION) return;
  try { existing?.dispose?.(); } catch (_) {}

  const TOOL_EVENT_PATTERN = /(?:called tool|calling tool|tool call|used [^|\n]{0,80} skill|search(?:ed|ing)|web search|retriev(?:ed|ing)|fet(?:ched|ching)|inspect(?:ed|ing)|read(?:ing)?|brows(?:ed|ing)|run(?:ning)? tool|using [^|\n]{0,100}tool|audit(?:ed|ing)|patch(?:ed|ing)|analyz(?:ed|ing)|updat(?:ed|ing)|upload(?:ed|ing)|download(?:ed|ing)|verif(?:ied|ying)|test(?:ed|ing)|build(?:ing|t)|packag(?:ed|ing)|execut(?:ed|ing)|terminal|creat(?:ed|ing)|compar(?:ed|ing)|review(?:ed|ing)|check(?:ed|ing)|enhanc(?:ed|ing)|persist(?:ed|ing)|port(?:ed|ing)|modif(?:ied|ying)|compil(?:ed|ing)|trigger(?:ed|ing)|open(?:ed|ing)|click(?:ed|ing)|typ(?:ed|ing)|implement(?:ed|ing)|fix(?:ed|ing)|process(?:ed|ing)|writ(?:ten|ing)|edit(?:ed|ing))/i;
  const ACTIVE_TOOL_LABEL_PATTERN = /\b(searching|retrieving|fetching|reading|browsing|inspecting|checking|analyzing|analysing|reviewing|comparing|auditing|running|executing|building|compiling|packaging|verifying|testing|updating|editing|writing|creating|uploading|downloading|processing|calling|generating|patching|modifying|implementing|fixing|enhancing|persisting|porting|opening|clicking|typing|triggering)\b/i;
  const FINISHED_TOOL_LABEL_PATTERN = /\b(searched|retrieved|fetched|read|browsed|inspected|checked|analyzed|analysed|reviewed|compared|audited|ran|executed|built|compiled|packaged|verified|tested|updated|edited|wrote|written|created|uploaded|downloaded|processed|called|used|generated|patched|modified|implemented|fixed|enhanced|persisted|ported|opened|clicked|typed|triggered|completed|finished)\b/i;
  const GENERIC_TOOL_PATTERN = /^(?:called tool|calling tool|tool call|used [^|\n]{0,80} skill|ran tool|running tool)$/i;
  const FAST_TOOL_SELECTOR = [
    '[data-testid*="tool" i]', '[data-testid*="search" i]', '[data-testid*="browse" i]', '[data-testid*="progress" i]',
    '[aria-label*="tool" i]', '[data-message-author-role="tool"]', '[role="status"]', '[aria-live="polite"]',
    '.group\\/tool-message', '[class*="tool-message" i]', '[data-state*="loading" i]', '[data-state*="pending" i]',
    '[aria-busy="true"]', '.loading-shimmer-tertiary', '[class*="loading-shimmer" i]',
    '[class*="text-token-text-tertiary"]', '[class*="text-token-text-secondary"]'
  ].join(',');
  const STOP_SELECTOR = [
    '[data-testid="stop-button"]', '[data-testid*="stop" i]', '[data-testid*="cancel" i]',
    'button[aria-label*="stop generating" i]', 'button[aria-label*="stop streaming" i]', 'button[aria-label*="stop response" i]',
    'button[aria-label*="cancel generation" i]', 'button[aria-label*="cancel response" i]', 'button[aria-label="Stop" i]'
  ].join(',');
  const STREAMING_SELECTOR = '[data-is-streaming="true"],[data-testid*="streaming" i],[data-state="streaming" i],.result-streaming,[class*="result-streaming" i]';
  const BUSY_SELECTOR = '[aria-busy="true"],[data-state="loading" i],[data-state="pending" i],[data-loading="true"]';
  const STALE_STATUS_PATTERN = /(message delivery timed out|connection interrupted|connection (?:was )?lost|network connection (?:was )?lost|reconnect(?:ion)? failed|failed to deliver message|too many requests|rate limit(?:ed| exceeded)?|http\s*429|error\s*429|status\s*429|something went wrong|there was an error|network error|failed to (generate|respond|send)|session expired|conversation.{0,30}(not found|unavailable|deleted)|page not found)/i;

  let observer = null;
  let scanTimer = 0;
  let pulseTimer = 0;
  let lastStrongActiveAt = 0;
  let lastProgressAt = 0;
  let lastActivityAt = Date.now();
  let lastState = null;
  let lastStateSignature = '';
  let lastPushSignature = '';
  let hudWasPatched = false;
  let messageListener = null;

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

  function isUsable(node) {
    if (!node || node.disabled || node.getAttribute?.('aria-disabled') === 'true') return false;
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
    if (/user|human|prompt/.test(label)) return 'user';
    if (/assistant|model|response|bot/.test(label)) return 'assistant';
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
    if (!node) return false;
    const { latestUser, assistantAfterUser } = frontier;
    if (!latestUser) return true;
    if (latestUser.contains?.(node)) return false;
    if (assistantAfterUser?.contains?.(node)) return true;
    return follows(node, latestUser);
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

  function rowFromNode(node, frontier) {
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
      busy,
      current:isCurrentFrontierNode(node, frontier),
      activeLabel,
      finishedLabel,
      generic:GENERIC_TOOL_PATTERN.test(label),
      phase:toolPhase(label)
    };
  }

  function toolRows(frontier) {
    const root = mainRoot();
    if (!root) return [];
    const seen = new Set();
    const rows = [];
    const add = (node) => {
      if (!node || seen.has(node)) return;
      seen.add(node);
      const row = rowFromNode(node, frontier);
      if (row) rows.push(row);
    };
    for (const node of [...root.querySelectorAll(FAST_TOOL_SELECTOR)].slice(-420)) add(node);

    // ChatGPT changes the wrappers/classes around tool progress frequently. When the
    // fast selectors do not expose the current live verb, inspect only the tail of
    // small text-bearing nodes after the latest user turn. This is bounded and only
    // runs as a fallback, so it survives DOM churn without turning into a full-page scan.
    const fallback = [...root.querySelectorAll('div,span,p,button,[role="status"],[aria-live]')].slice(-420);
    for (const node of fallback) {
      if (node.childElementCount > 6) continue;
      if (!isCurrentFrontierNode(node, frontier)) continue;
      const text = clean(node.getAttribute?.('aria-label') || node.textContent || '', 260);
      if (!text || text.length > 240 || !TOOL_EVENT_PATTERN.test(text)) continue;
      add(node);
    }
    return rows;
  }

  function completionEvidence(frontier) {
    const assistant = frontier.assistantAfterUser || (!frontier.latestUser ? frontier.latestAssistant : null);
    if (!assistant) return { hasAssistant:false, finalControls:false, textLength:0 };
    const controls = [...assistant.querySelectorAll?.('button,[role="button"]') || []];
    const finalControls = controls.some((node) => /^(copy|read aloud|good response|bad response|share|regenerate|retry)/i.test(clean(node.getAttribute?.('aria-label') || node.textContent, 120)))
      || Boolean(assistant.querySelector?.('[data-testid*="copy" i],[data-testid*="feedback" i],[data-testid*="regenerate" i]'));
    return { hasAssistant:true, finalControls, textLength:clean(assistant.textContent || '', 200000).length };
  }

  function statusFromText(active, text) {
    if (active) return 'running';
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

  function scan(force = false) {
    const at = now();
    if (!force && lastState && at - Number(lastState.observedAt || 0) < 180) return lastState;
    const root = mainRoot();
    const frontier = conversationFrontier();
    const rows = toolRows(frontier);
    const currentRows = rows.filter((row) => row.current);
    const currentActive = [...currentRows].reverse().find((row) => row.activeLabel && !row.generic) || null;
    const currentBusy = [...currentRows].reverse().find((row) => row.busy && !row.generic) || null;
    const currentInformative = [...currentRows].reverse().find((row) => !row.generic) || currentRows.at(-1) || null;
    const observedTool = currentActive || currentBusy || currentInformative || [...rows].reverse().find((row) => !row.generic) || rows.at(-1) || null;
    const completion = completionEvidence(frontier);
    const stopControl = [...document.querySelectorAll(STOP_SELECTOR)].find(isUsable) || null;
    const streamingNode = root?.querySelector?.(STREAMING_SELECTOR) || null;
    const busyNode = [...(root?.querySelectorAll?.(BUSY_SELECTOR) || [])].reverse().find((node) => isCurrentFrontierNode(node, frontier) && isUsable(node)) || null;
    const progressiveTool = Boolean(currentActive);
    const toolBusy = Boolean(currentBusy);
    const assistantPending = Boolean(frontier.assistantAfterUser && !completion.finalControls && completion.textLength > 0);
    const strongActive = Boolean(stopControl || streamingNode || busyNode || progressiveTool || toolBusy || assistantPending);
    if (strongActive) {
      lastStrongActiveAt = at;
      lastActivityAt = at;
      if (progressiveTool || toolBusy) lastProgressAt = at;
    }
    const settleGrace = !completion.finalControls && at - lastStrongActiveAt < 2800;
    const active = strongActive || settleGrace;
    const statusText = clean(root?.innerText || root?.textContent || '', 30000);
    const status = statusFromText(active, statusText);
    const stale = status !== 'running' && status !== 'idle';
    const provider = providerInfo();
    const toolLabel = clean(observedTool?.label || '', 160);
    const generation = {
      active:status === 'running',
      stopControl:Boolean(stopControl),
      streaming:Boolean(streamingNode),
      busyNode:Boolean(busyNode),
      toolBusy,
      progressiveTool,
      assistantPending,
      toolLabel,
      toolPhase:observedTool?.phase || '',
      finalControls:Boolean(completion.finalControls),
      frontierTool:Boolean(observedTool?.current),
      source:stopControl ? 'stop-control' : streamingNode ? 'streaming-marker' : busyNode ? 'busy-marker' : progressiveTool ? 'current-progress-label' : toolBusy ? 'current-tool-busy' : assistantPending ? 'unfinished-current-assistant' : settleGrace ? 'settle-grace' : 'settled'
    };
    const state = {
      ok:true,
      source:'live-sentinel',
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
        healthState:status === 'running' ? (toolLabel ? 'tool-running' : 'working') : status === 'idle' ? 'healthy' : status
      },
      generation,
      tool:{
        present:Boolean(observedTool),
        current:Boolean(observedTool?.current),
        busy:Boolean(currentBusy),
        active:Boolean(currentActive),
        label:toolLabel,
        phase:observedTool?.phase || '',
        lastProgressAt:Number(lastProgressAt || 0),
        entryCount:currentRows.length || rows.length
      },
      healthActive:status === 'running',
      healthStale:stale,
      observedAt:at,
      hidden:document.hidden
    };
    const signature = `${state.chat.status}|${generation.source}|${toolLabel}|${generation.finalControls ? 1 : 0}|${frontier.turns.length}`;
    lastState = state;
    lastStateSignature = signature;
    patchLegacyHud(state);
    maybePush(state, signature);
    schedulePulse(state.chat.status === 'running' ? (document.hidden ? 1400 : 700) : (document.hidden ? 9000 : 3500));
    return state;
  }

  function patchLegacyHud(state) {
    const host = document.getElementById('projectConstellationHealthHud');
    const shadow = host?.shadowRoot;
    if (!host || !shadow) return;
    const title = shadow.getElementById('pcHealthTitle');
    const mini = shadow.getElementById('pcHealthMini');
    const nowTitle = shadow.getElementById('pcHealthNowTitle');
    const nowDetail = shadow.getElementById('pcHealthNowDetail');
    const activity = shadow.getElementById('pcHealthActivity');
    const tool = shadow.getElementById('pcHealthTool');
    if (state.chat.status === 'running') {
      const label = state.tool?.label || '';
      const toolActive = Boolean(state.tool?.active || state.tool?.busy);
      host.dataset.level = 'active';
      host.dataset.state = toolActive ? 'tool-running' : 'working';
      host.dataset.liveSentinel = VERSION;
      if (title) title.textContent = toolActive && label ? `Tool working · ${label}` : 'Chat is still working';
      if (mini) mini.textContent = `${state.generation.source.replaceAll('-', ' ')} · live sentinel`;
      if (nowTitle) nowTitle.textContent = label || 'Live response activity';
      if (nowDetail) nowDetail.textContent = toolActive ? 'Current response frontier still exposes active tool progress.' : 'Current response has not reached a settled completion state.';
      if (activity) activity.textContent = toolActive ? 'tool' : 'model';
      if (tool && toolActive) tool.textContent = `${Math.max(1, Number(state.tool?.entryCount || 1))} live step${Number(state.tool?.entryCount || 1) === 1 ? '' : 's'}`;
      hudWasPatched = true;
    } else if (hudWasPatched) {
      host.dataset.liveSentinel = VERSION;
      if (state.chat.status === 'idle') {
        host.dataset.level = 'healthy';
        host.dataset.state = 'healthy';
        if (title) title.textContent = 'Chat complete';
        if (mini) mini.textContent = 'Current response frontier settled · live sentinel';
      }
      hudWasPatched = false;
    }
  }

  function maybePush(state, signature) {
    if (!chrome?.runtime?.sendMessage) return;
    if (signature === lastPushSignature && now() - Number(state.observedAt || 0) < 1000) return;
    lastPushSignature = signature;
    chrome.runtime.sendMessage({ type:'PC_LIVE_CHAT_STATE_PUSH', state:{ ...state, sentinel:true } }).catch?.(() => {});
  }

  function scheduleScan(delay = 80) {
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = setTimeout(() => { scanTimer = 0; scan(true); }, Math.max(30, Number(delay || 0)));
  }

  function schedulePulse(delay = 3500) {
    if (pulseTimer) clearTimeout(pulseTimer);
    pulseTimer = setTimeout(() => { pulseTimer = 0; scan(true); }, Math.max(300, Number(delay || 0)));
  }

  function mutationRelevant(mutation) {
    if (mutation.type === 'characterData') {
      const parent = mutation.target?.parentElement;
      const text = clean(parent?.textContent || mutation.target?.textContent || '', 280);
      return Boolean(text && TOOL_EVENT_PATTERN.test(text));
    }
    if (mutation.type === 'attributes') {
      const name = String(mutation.attributeName || '');
      if (/^(aria-busy|aria-label|data-state|data-is-streaming|data-loading|data-testid|class)$/.test(name)) return true;
    }
    if (mutation.type === 'childList') {
      for (const node of mutation.addedNodes || []) {
        if (!(node instanceof Element)) continue;
        if (node.matches?.(`${STOP_SELECTOR},${STREAMING_SELECTOR},${BUSY_SELECTOR},${FAST_TOOL_SELECTOR}`)) return true;
        const text = clean(node.textContent || '', 320);
        if (text && TOOL_EVENT_PATTERN.test(text)) return true;
        if (node.querySelector?.(`${STOP_SELECTOR},${STREAMING_SELECTOR},${BUSY_SELECTOR},${FAST_TOOL_SELECTOR}`)) return true;
      }
      for (const node of mutation.removedNodes || []) {
        if (node instanceof Element && (node.matches?.(`${STOP_SELECTOR},${STREAMING_SELECTOR},${BUSY_SELECTOR},${FAST_TOOL_SELECTOR}`) || TOOL_EVENT_PATTERN.test(clean(node.textContent || '', 320)))) return true;
      }
    }
    return false;
  }

  function startObserver() {
    observer?.disconnect();
    observer = new MutationObserver((mutations) => {
      if (mutations.some(mutationRelevant)) scheduleScan(55);
    });
    observer.observe(document.documentElement, {
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
    dispose:() => {
      observer?.disconnect(); observer = null;
      if (scanTimer) clearTimeout(scanTimer); scanTimer = 0;
      if (pulseTimer) clearTimeout(pulseTimer); pulseTimer = 0;
      try { chrome?.runtime?.onMessage?.removeListener?.(messageListener); } catch (_) {}
    }
  };
  globalThis.ProjectConstellationLiveSentinel = api;
  startObserver();
  scan(true);
})();
