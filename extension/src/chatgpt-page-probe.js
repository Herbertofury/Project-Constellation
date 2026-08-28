(() => {
  'use strict';

  const VERSION = '0.14.11';
  const REQUEST_SOURCE = 'project-constellation';
  const RESPONSE_SOURCE = 'project-constellation-chatgpt-page-probe';
  const REQUEST_KIND = 'chatgpt-transcript-request';
  const RESPONSE_KIND = 'chatgpt-transcript-state';
  const READY_KIND = 'chatgpt-page-probe-ready';
  const CACHE_TTL_MS = 700;
  const AUTH_TTL_MS = 4 * 60 * 1000;
  const MAX_MAPPING_NODES = 10000;

  const prior = globalThis.ProjectConstellationChatGPTPageProbe;
  if (prior?.version === VERSION) return;
  try { prior?.dispose?.(); } catch (_) {}

  let disposed = false;
  let cachedConversationId = '';
  let cachedAt = 0;
  let cachedState = null;
  let authCache = null;
  let authAt = 0;
  let listener = null;

  const clean = (value, max = 180) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  const safeNumber = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
  const safeStatus = (value) => clean(value, 80).toLowerCase().replace(/[^a-z0-9_.:-]+/g, '-');

  function conversationIdFromLocation() {
    const path = String(location.pathname || '');
    const match = path.match(/(?:^|\/)c\/([0-9a-f-]{16,})(?:\/|$)/i);
    return match?.[1] || '';
  }

  function parseMaybeJson(value) {
    if (!value) return null;
    if (typeof value === 'object') return value;
    if (typeof value !== 'string') return null;
    const text = value.trim();
    if (!text || !/^[\[{]/.test(text)) return null;
    try { return JSON.parse(text); } catch (_) { return null; }
  }

  function findWidgetState(message) {
    const metadata = message?.metadata;
    if (!metadata || typeof metadata !== 'object') return null;
    const direct = metadata['chatgpt_sdk.widget_state'] ?? metadata?.chatgpt_sdk?.widget_state ?? metadata?.widget_state;
    const parsedDirect = parseMaybeJson(direct) || (direct && typeof direct === 'object' ? direct : null);
    if (parsedDirect) return parsedDirect;
    for (const [key, value] of Object.entries(metadata)) {
      if (!/widget[_ .-]?state/i.test(key)) continue;
      const parsed = parseMaybeJson(value) || (value && typeof value === 'object' ? value : null);
      if (parsed) return parsed;
    }
    return null;
  }

  function widgetStatus(widget) {
    if (!widget || typeof widget !== 'object') return '';
    return safeStatus(widget.status ?? widget.state ?? widget.task_status ?? widget.run_status ?? widget?.run?.status ?? widget?.task?.status);
  }

  function widgetProgress(widget) {
    if (!widget || typeof widget !== 'object') return null;
    const candidates = [
      widget.progress_percent, widget.percent, widget.percentage,
      widget?.progress?.percent, widget?.progress?.percentage, widget?.progress?.value,
      widget.progress
    ];
    for (const candidate of candidates) {
      if (candidate && typeof candidate === 'object') continue;
      const number = safeNumber(candidate);
      if (number === null) continue;
      const normalized = number >= 0 && number <= 1 ? number * 100 : number;
      if (normalized >= 0 && normalized <= 100) return Math.round(normalized * 10) / 10;
    }
    return null;
  }

  function nodeMessage(node) {
    return node?.message && typeof node.message === 'object' ? node.message : null;
  }

  function roleOf(message) {
    return safeStatus(message?.author?.role || message?.role || '');
  }

  function authorNameOf(message) {
    return clean(message?.author?.name || message?.recipient || message?.metadata?.tool_name || '', 120);
  }

  function messageStatus(message) {
    return safeStatus(message?.status || message?.metadata?.status || '');
  }

  function messageEndTurn(message) {
    return message?.end_turn === true || message?.metadata?.end_turn === true;
  }

  function messageComplete(message) {
    return message?.metadata?.is_complete === true || message?.metadata?.is_finished === true;
  }

  function messageTimeMs(message, key = 'create_time') {
    const raw = Number(message?.[key] ?? message?.metadata?.[key] ?? 0);
    if (!Number.isFinite(raw) || raw <= 0) return 0;
    return raw < 10_000_000_000 ? Math.round(raw * 1000) : Math.round(raw);
  }

  function messageTextChars(message) {
    const content = message?.content;
    if (!content || typeof content !== 'object') return 0;
    let total = 0;
    const add = (value) => {
      if (typeof value === 'string') total += value.length;
      else if (Array.isArray(value)) for (const item of value) add(item);
      else if (value && typeof value === 'object') {
        // Count only textual payload fields. Avoid serializing arbitrary metadata or
        // leaking content across the MAIN/isolated-world boundary.
        for (const key of ['text','content','caption','result','output']) if (key in value) add(value[key]);
      }
    };
    add(content.parts);
    add(content.text);
    if (!total && typeof content.result === 'string') total += content.result.length;
    return Math.max(0, Math.min(total, 50_000_000));
  }

  function modelSlugOf(message) {
    return clean(
      message?.metadata?.model_slug ||
      message?.metadata?.default_model_slug ||
      message?.metadata?.model ||
      message?.model_slug || '',
      100
    );
  }

  function asyncTaskIdOf(message) {
    return clean(message?.metadata?.async_task_id || message?.metadata?.task_id || '', 160);
  }

  function phaseFromMessage(message, widget = null) {
    const author = authorNameOf(message).toLowerCase();
    const contentType = clean(message?.content?.content_type || message?.metadata?.content_type || '', 100).toLowerCase();
    const asyncTask = asyncTaskIdOf(message).toLowerCase();
    const joined = `${author} ${contentType} ${asyncTask}`;
    if (/deep.?research|research[_ .-]?kickoff|research/.test(joined) || widget) return 'deep-research';
    if (/web|browser|search/.test(joined)) return 'web-search';
    if (/file|drive|document|retriev|read/.test(joined)) return 'retrieving';
    if (/python|terminal|shell|code|exec/.test(joined)) return 'executing';
    if (/image/.test(joined)) return 'image-tool';
    if (roleOf(message) === 'tool') return 'tool';
    if (roleOf(message) === 'assistant') return 'streaming-answer';
    return 'waiting-response';
  }

  function buildActiveChain(conversation) {
    const mapping = conversation?.mapping;
    if (!mapping || typeof mapping !== 'object') return [];
    const currentId = clean(conversation?.current_node || conversation?.currentNode || '', 200);
    if (!currentId || !mapping[currentId]) return [];
    const chain = [];
    const seen = new Set();
    let id = currentId;
    while (id && mapping[id] && !seen.has(id) && chain.length < MAX_MAPPING_NODES) {
      seen.add(id);
      const node = mapping[id];
      chain.push({ id, node, message:nodeMessage(node) });
      id = clean(node?.parent || '', 200);
    }
    chain.reverse();
    return chain;
  }

  function summarizeConversation(conversation, expectedConversationId) {
    const chain = buildActiveChain(conversation);
    const conversationId = clean(conversation?.id || expectedConversationId || '', 200);
    if (!chain.length) {
      return {
        ok:true, proof:'transcript', conversationId, transcriptStatus:'unknown', final:false, running:false,
        currentNodeId:clean(conversation?.current_node || '', 200), latestUserMessageId:'', latestAssistantMessageId:'',
        latestRole:'', latestMessageStatus:'', endTurn:false, isComplete:false, modelSlug:'', asyncTaskId:'',
        widgetStatus:'', progressPercent:null, toolCount:0, phase:'unknown', visibleTurnCount:0,
        activeBranchMessages:0, structuredBranchMessages:0, toolBranchMessages:0, contextChars:0, visibleChars:0, recentAverageChars:0,
        latestAssistantChars:0, responseStartedAt:0, latestUserCreatedAt:0, latestAssistantCreatedAt:0, latestAssistantUpdatedAt:0, observedAt:Date.now()
      };
    }

    let activeBranchMessages = 0;
    let visibleTurnCount = 0;
    let structuredBranchMessages = 0;
    let toolBranchMessages = 0;
    let contextChars = 0;
    let visibleChars = 0;
    const recentVisibleChars = [];
    for (const entry of chain) {
      if (!entry.message) continue;
      activeBranchMessages += 1;
      const chars = messageTextChars(entry.message);
      contextChars += chars;
      const role = roleOf(entry.message);
      if (role === 'tool') toolBranchMessages += 1;
      if (role !== 'user' && role !== 'assistant') structuredBranchMessages += 1;
      if (role === 'user' || role === 'assistant') {
        visibleTurnCount += 1;
        visibleChars += chars;
        if (chars > 0) recentVisibleChars.push(chars);
      }
    }
    const recentWindow = recentVisibleChars.slice(-12);
    const recentAverageChars = recentWindow.length
      ? Math.round(recentWindow.reduce((sum, value) => sum + value, 0) / recentWindow.length)
      : 0;

    let latestUserIndex = -1;
    for (let i = chain.length - 1; i >= 0; i -= 1) {
      if (roleOf(chain[i].message) === 'user') { latestUserIndex = i; break; }
    }
    const tail = latestUserIndex >= 0 ? chain.slice(latestUserIndex + 1) : chain;
    const latestUser = latestUserIndex >= 0 ? chain[latestUserIndex] : null;
    const latest = tail.length ? tail[tail.length - 1] : latestUser || chain[chain.length - 1];
    const assistantTail = tail.filter((entry) => roleOf(entry.message) === 'assistant');
    const latestAssistant = assistantTail.at(-1) || null;
    const toolTail = tail.filter((entry) => roleOf(entry.message) === 'tool');
    const responseStarts = tail.map((entry) => messageTimeMs(entry.message, 'create_time')).filter((value) => value > 0);
    const responseStartedAt = responseStarts.length ? Math.min(...responseStarts) : 0;

    let widget = null;
    let widgetMessage = null;
    let asyncTaskId = '';
    for (const entry of tail) {
      const candidate = findWidgetState(entry.message);
      if (candidate) { widget = candidate; widgetMessage = entry.message; }
      const taskId = asyncTaskIdOf(entry.message);
      if (taskId) asyncTaskId = taskId;
    }
    const wStatus = widgetStatus(widget);
    const widgetDone = /^(completed|complete|finished|succeeded|success|done)$/.test(wStatus);
    const widgetRunning = Boolean(wStatus) && !widgetDone && !/^(failed|error|cancelled|canceled|expired)$/.test(wStatus);

    const assistantMessage = latestAssistant?.message || null;
    const latestMessage = latest?.message || null;
    const assistantStatus = messageStatus(assistantMessage);
    const latestStatus = messageStatus(latestMessage);
    const endTurn = messageEndTurn(assistantMessage);
    const completeFlag = messageComplete(assistantMessage);
    const assistantFinal = Boolean(assistantMessage && endTurn && (assistantStatus === 'finished_successfully' || completeFlag || !assistantStatus));
    const explicitIncomplete = tail.some((entry) => {
      const status = messageStatus(entry.message);
      return ['in_progress','streaming','pending','running'].includes(status);
    });

    let final = assistantFinal;
    if (widget) final = widgetDone && (assistantFinal || Boolean(assistantMessage));
    let running = false;
    if (latestUser) {
      if (!tail.length) running = true;
      else if (widgetRunning) running = true;
      else if (explicitIncomplete) running = true;
      else if (!final) running = true;
    }
    if (final) running = false;

    const phaseMessage = widgetMessage || toolTail.at(-1)?.message || assistantMessage || latestMessage;
    const phase = final ? 'complete' : phaseFromMessage(phaseMessage, widget);
    const modelSlug = modelSlugOf(assistantMessage) || assistantTail.map((entry) => modelSlugOf(entry.message)).filter(Boolean).at(-1) || '';

    return {
      ok:true,
      proof:'transcript',
      conversationId,
      transcriptStatus:final ? 'finished' : running ? 'running' : 'unknown',
      final,
      running,
      currentNodeId:clean(conversation?.current_node || conversation?.currentNode || latest?.id || '', 200),
      latestUserMessageId:clean(latestUser?.message?.id || latestUser?.id || '', 200),
      latestAssistantMessageId:clean(latestAssistant?.message?.id || latestAssistant?.id || '', 200),
      latestRole:roleOf(latestMessage),
      latestMessageStatus:latestStatus || assistantStatus,
      endTurn:Boolean(endTurn),
      isComplete:Boolean(completeFlag),
      modelSlug,
      asyncTaskId,
      widgetStatus:wStatus,
      progressPercent:widgetProgress(widget),
      toolCount:toolTail.length,
      phase,
      visibleTurnCount,
      activeBranchMessages,
      structuredBranchMessages,
      toolBranchMessages,
      contextChars,
      visibleChars,
      recentAverageChars,
      latestAssistantChars:messageTextChars(assistantMessage),
      responseStartedAt,
      latestUserCreatedAt:messageTimeMs(latestUser?.message, 'create_time'),
      latestAssistantCreatedAt:messageTimeMs(assistantMessage, 'create_time'),
      latestAssistantUpdatedAt:messageTimeMs(assistantMessage, 'update_time') || messageTimeMs(assistantMessage, 'create_time'),
      observedAt:Date.now()
    };
  }

  async function authHeaders() {
    const at = Date.now();
    if (authCache && at - authAt < AUTH_TTL_MS) return authCache;
    const response = await fetch('/api/auth/session', { credentials:'include', cache:'no-store' });
    if (!response.ok) throw new Error(`session-${response.status}`);
    const session = await response.json();
    const token = clean(session?.accessToken || session?.access_token || '', 12000);
    if (!token) throw new Error('session-token-missing');
    const accountId = clean(session?.account?.id || session?.accountId || session?.account_id || '', 200);
    authCache = { Authorization:`Bearer ${token}`, ...(accountId ? { 'chatgpt-account-id':accountId } : {}) };
    authAt = at;
    return authCache;
  }

  async function fetchConversation(conversationId) {
    const url = `/backend-api/conversation/${encodeURIComponent(conversationId)}`;
    let response = await fetch(url, { credentials:'include', cache:'no-store', headers:{ Accept:'application/json' } });
    if (response.status === 401 || response.status === 403) {
      const headers = await authHeaders();
      response = await fetch(url, { credentials:'include', cache:'no-store', headers:{ Accept:'application/json', ...headers } });
    }
    if (!response.ok) throw new Error(`conversation-${response.status}`);
    return response.json();
  }

  async function readTranscript(conversationId, force = false) {
    const at = Date.now();
    if (!force && cachedState && cachedConversationId === conversationId && at - cachedAt < CACHE_TTL_MS) return cachedState;
    try {
      const conversation = await fetchConversation(conversationId);
      const state = summarizeConversation(conversation, conversationId);
      cachedConversationId = conversationId;
      cachedAt = Date.now();
      cachedState = state;
      return state;
    } catch (error) {
      return {
        ok:false,
        proof:'transcript',
        conversationId,
        transcriptStatus:'unavailable',
        final:false,
        running:false,
        error:clean(error?.message || error, 160),
        observedAt:Date.now()
      };
    }
  }

  listener = (event) => {
    if (disposed || event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== REQUEST_SOURCE || data.kind !== REQUEST_KIND) return;
    const nonce = clean(data.nonce || '', 120);
    const requestedId = clean(data.conversationId || conversationIdFromLocation(), 200);
    if (!nonce || !requestedId) return;
    readTranscript(requestedId, Boolean(data.force)).then((state) => {
      if (disposed) return;
      window.postMessage({ source:RESPONSE_SOURCE, kind:RESPONSE_KIND, version:VERSION, nonce, conversationId:requestedId, state }, location.origin === 'null' ? '*' : location.origin);
    });
  };

  window.addEventListener('message', listener, false);
  const api = {
    version:VERSION,
    summarizeConversation,
    readTranscript,
    dispose() {
      disposed = true;
      if (listener) window.removeEventListener('message', listener, false);
      listener = null;
      cachedState = null;
      authCache = null;
    }
  };
  globalThis.ProjectConstellationChatGPTPageProbe = api;
  window.postMessage({ source:RESPONSE_SOURCE, kind:READY_KIND, version:VERSION }, location.origin === 'null' ? '*' : location.origin);
})();
