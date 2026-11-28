(() => {
  'use strict';

  const VERSION = '0.18.1';
  const SOURCE = 'project-constellation-scheduled-task-page-probe';
  const BRIDGE_SOURCE = 'project-constellation-scheduled-task-observer';
  const SNAPSHOT_KIND = 'scheduled-task-snapshot';
  const REFRESH_KIND = 'scheduled-task-refresh-request';
  const AUTH_TTL_MS = 4 * 60 * 1000;
  const MAX_OBJECTS = 900;
  const MAX_ROWS = 120;
  const CANDIDATE_PATH = /\/(?:backend-api|api)\//i;
  const TASK_HINT = /(?:schedul|task|automat|jawbone|notification|run|execution)/i;
  const BLOCKED_CHILD_KEY = /prompt|instructions|message|content|result|output|body|text/i;

  const prior = globalThis.ProjectConstellationScheduledTaskPageProbe;
  if (prior?.version === VERSION) return;
  try { prior?.dispose?.(); } catch (_) {}

  let disposed = false;
  let perfObserver = null;
  let domObserver = null;
  let domTimer = 0;
  let routeListener = null;
  let authCache = null;
  let authAt = 0;
  let lastSignature = '';
  const requestedPaths = new Map();

  const clean = (value, max = 180) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  const tok = (value, max = 80) => clean(value, max).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);
  const first = (obj, keys) => { for (const key of keys) if (own(obj, key) && obj[key] !== undefined && obj[key] !== null && obj[key] !== '') return obj[key]; return null; };
  const bool = (obj, keys) => { for (const key of keys) if (typeof obj?.[key] === 'boolean') return obj[key]; return null; };
  const time = (value) => {
    if (value === null || value === undefined || value === '') return 0;
    if (typeof value === 'number' || /^\d+(?:\.\d+)?$/.test(String(value))) {
      const n = Number(value); return Number.isFinite(n) && n > 0 ? (n < 1e10 ? Math.round(n * 1000) : Math.round(n)) : 0;
    }
    const parsed = Date.parse(String(value)); return Number.isFinite(parsed) ? parsed : 0;
  };
  const onScheduledRoute = () => /^\/(?:scheduled|schedules|tasks)(?:\/|$)/i.test(location.pathname || '');

  function sanitizedSourceUrl(value) {
    try {
      const url = new URL(String(value || ''), location.href);
      if (url.origin !== location.origin || !CANDIDATE_PATH.test(url.pathname) || !TASK_HINT.test(url.pathname)) return '';
      const safeQuery = new URLSearchParams();
      for (const key of ['limit','offset','cursor','page','status','state']) if (url.searchParams.has(key)) safeQuery.set(key, clean(url.searchParams.get(key), 120));
      const query = safeQuery.toString();
      return `${url.pathname}${query ? `?${query}` : ''}`.slice(0, 260);
    } catch (_) { return ''; }
  }

  function runFields(obj = {}) {
    const nested = first(obj, ['last_run','lastRun','last_execution','lastExecution','latest_run','latestRun','execution','run','last_result','lastResult']);
    const run = nested && typeof nested === 'object' && !Array.isArray(nested) ? nested : {};
    return {
      lastRunId: clean(first(obj,['last_run_id','lastRunId','run_id','runId','execution_id','executionId']) ?? first(run,['id','run_id','runId','execution_id','executionId']), 220),
      lastRunStatus: tok(first(obj,['last_run_status','lastRunStatus','run_status','runStatus']) ?? first(run,['status','state','result_status','resultStatus'])),
      lastRunAt: time(first(obj,['last_run_at','lastRunAt','last_execution_at','lastExecutionAt','completed_at','completedAt']) ?? first(run,['completed_at','completedAt','finished_at','finishedAt','updated_at','updatedAt','created_at','createdAt']))
    };
  }

  function scoreTaskObject(obj = {}) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return 0;
    const keys = Object.keys(obj);
    let score = 0;
    if (keys.some((key) => /^(?:id|task_id|taskId|jawbone_id|jawboneId|automation_id|automationId)$/.test(key))) score += 2;
    if (keys.some((key) => /^(?:is_enabled|enabled|active)$/.test(key))) score += 3;
    if (keys.some((key) => /(?:schedule|recurr|rrule|next_run|nextExecution|trigger)/i.test(key))) score += 3;
    if (keys.some((key) => /(?:last_run|lastExecution|run_status|execution)/i.test(key))) score += 2;
    if (keys.some((key) => /^(?:status|state|task_status|taskStatus)$/.test(key))) score += 1;
    if (keys.some((key) => /(?:approval|required|attention|pause_reason|failure_reason)/i.test(key))) score += 2;
    return score;
  }

  function summarizeObject(obj = {}) {
    const id = clean(first(obj,['id','task_id','taskId','jawbone_id','jawboneId','automation_id','automationId']), 220);
    const taskId = clean(first(obj,['task_id','taskId','jawbone_id','jawboneId','automation_id','automationId']), 220);
    const schedule = first(obj,['schedule','recurrence','rrule','recurring_schedule','recurringSchedule']);
    const enabled = bool(obj,['is_enabled','enabled','active']);
    const status = tok(first(obj,['status','state','task_status','taskStatus','lifecycle_status','lifecycleStatus']));
    const run = runFields(obj);
    const recordKind = taskId && !first(obj,['schedule','recurrence','rrule','next_run_at','nextRunAt','next_execution_at','nextExecutionAt']) && enabled === null ? 'run' : 'task';
    return {
      id: recordKind === 'run' ? taskId : id,
      title: clean(first(obj,['title','name','label','display_name','displayName']) || 'Scheduled task', 180),
      status,
      enabled,
      nextRunAt: time(first(obj,['next_run_at','nextRunAt','next_execution_at','nextExecutionAt','next_scheduled_at','nextScheduledAt'])),
      lastRunId: run.lastRunId,
      lastRunStatus: run.lastRunStatus || (recordKind === 'run' ? status : ''),
      lastRunAt: run.lastRunAt,
      recurring: typeof first(obj,['recurring','is_recurring','isRecurring']) === 'boolean' ? Boolean(first(obj,['recurring','is_recurring','isRecurring'])) : /rrule|freq=|recurr/i.test(String(schedule || '')),
      requiresAttention: Boolean(first(obj,['requires_attention','requiresAttention','needs_attention','needsAttention','approval_required','approvalRequired','action_required','actionRequired']) === true),
      attentionReason: clean(first(obj,['attention_reason','attentionReason','pause_reason','pauseReason','failure_reason','failureReason','status_reason','statusReason']) || '', 220),
      conversationId: clean(first(obj,['conversation_id','conversationId','chat_id','chatId']), 220),
      recordKind
    };
  }

  function collectTasks(payload) {
    const rows = [];
    const seen = new Set();
    const queue = [payload];
    let visited = 0;
    while (queue.length && visited < MAX_OBJECTS) {
      const value = queue.shift(); visited += 1;
      if (!value || typeof value !== 'object') continue;
      if (Array.isArray(value)) { for (const item of value.slice(0, 180)) queue.push(item); continue; }
      if (scoreTaskObject(value) >= 4) {
        const row = summarizeObject(value);
        if (row.id) {
          const signature = `${row.id}|${row.recordKind}|${row.lastRunId}|${row.lastRunAt}|${row.status}|${row.enabled}`;
          if (!seen.has(signature)) { seen.add(signature); rows.push(row); }
        }
      }
      for (const [key, child] of Object.entries(value)) {
        if (!child || typeof child !== 'object' || BLOCKED_CHILD_KEY.test(key)) continue;
        queue.push(child);
      }
    }
    return rows.slice(0, MAX_ROWS);
  }

  function emit(tasks, source, sourceUrl = '') {
    if (disposed || !tasks?.length) return;
    const compact = tasks.slice(0, MAX_ROWS).map((row) => ({ ...row }));
    const signature = JSON.stringify(compact.map((row) => [row.id,row.status,row.enabled,row.lastRunId,row.lastRunAt,row.lastRunStatus,row.requiresAttention]));
    if (signature === lastSignature && source !== 'refresh') return;
    lastSignature = signature;
    window.postMessage({
      source: SOURCE,
      kind: SNAPSHOT_KIND,
      version: VERSION,
      snapshot: { tasks: compact, source, sourceUrl: sanitizedSourceUrl(sourceUrl), observedAt: Date.now() }
    }, location.origin === 'null' ? '*' : location.origin);
  }

  async function authHeaders() {
    const now = Date.now();
    if (authCache && now - authAt < AUTH_TTL_MS) return authCache;
    const response = await fetch('/api/auth/session', { credentials:'include', cache:'no-store', headers:{ Accept:'application/json' } });
    if (!response.ok) throw new Error(`session-${response.status}`);
    const session = await response.json();
    const token = clean(session?.accessToken || session?.access_token || '', 12000);
    if (!token) throw new Error('session-token-missing');
    const accountId = clean(session?.account?.id || session?.accountId || session?.account_id || '', 220);
    authCache = { Authorization:`Bearer ${token}`, ...(accountId ? { 'chatgpt-account-id':accountId } : {}) };
    authAt = now;
    return authCache;
  }

  async function fetchEndpoint(path, source = 'refresh') {
    const safePath = sanitizedSourceUrl(path);
    if (!safePath || disposed) return { ok:false, error:'unsafe-endpoint' };
    let response = await fetch(safePath, { credentials:'include', cache:'no-store', headers:{ Accept:'application/json' } });
    if (response.status === 401 || response.status === 403) {
      const headers = await authHeaders();
      response = await fetch(safePath, { credentials:'include', cache:'no-store', headers:{ Accept:'application/json', ...headers } });
    }
    if (!response.ok) return { ok:false, error:`endpoint-${response.status}`, status:response.status };
    const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
    if (!contentType.includes('json')) return { ok:false, error:'endpoint-not-json' };
    const payload = await response.json();
    const tasks = collectTasks(payload);
    if (tasks.length) emit(tasks, source, safePath);
    return { ok:true, count:tasks.length, endpoint:safePath };
  }

  function considerResourceUrl(value) {
    const path = sanitizedSourceUrl(value);
    if (!path) return;
    const now = Date.now();
    const last = Number(requestedPaths.get(path) || 0);
    if (now - last < 30_000) return;
    requestedPaths.set(path, now);
    fetchEndpoint(path, 'network').catch(() => {});
  }

  function installPerformanceObserver() {
    try {
      for (const entry of performance.getEntriesByType?.('resource') || []) considerResourceUrl(entry?.name || '');
      if (typeof PerformanceObserver !== 'function') return;
      perfObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) considerResourceUrl(entry?.name || '');
      });
      perfObserver.observe({ type:'resource', buffered:true });
    } catch (_) { perfObserver = null; }
  }

  function scanDom() {
    if (disposed || !onScheduledRoute() || !document.body) return;
    const labels = [...document.querySelectorAll('button,[role="button"],span,p,div')].filter((node) => {
      const text = clean(node.textContent, 80).toLowerCase();
      return /^(?:paused|active|completed|failed|needs attention|action required|approval required|waiting for approval)$/.test(text);
    }).slice(0, 80);
    const tasks = [];
    for (const label of labels) {
      let card = label;
      for (let i = 0; i < 6 && card?.parentElement; i += 1) {
        if (card.matches?.('article,li,[role="listitem"],[data-testid*="task"],[data-testid*="schedule"]')) break;
        card = card.parentElement;
      }
      if (!card) continue;
      const text = clean(card.innerText || card.textContent, 1200);
      if (!text || text.length > 1200) continue;
      const heading = card.querySelector?.('h1,h2,h3,h4,[data-testid*="title"]');
      const title = clean(heading?.textContent || text.split('\n')[0] || 'Scheduled task', 180);
      const href = card.querySelector?.('a[href]')?.getAttribute('href') || '';
      const idMatch = String(href).match(/(?:task|automation|schedule)[\/=:-]([A-Za-z0-9_-]{6,})/i);
      const id = clean(card.getAttribute?.('data-task-id') || card.getAttribute?.('data-id') || idMatch?.[1] || `dom:${title.toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,80)}`, 220);
      const state = tok(label.textContent);
      tasks.push({ id, title, status:state, enabled:state === 'active' ? true : state === 'paused' ? false : null, nextRunAt:0, lastRunAt:0, lastRunId:'', lastRunStatus:'', recurring:false, requiresAttention:/needs-attention|action-required|approval-required|waiting-for-approval|failed/.test(state), attentionReason:'', conversationId:'', recordKind:'task' });
    }
    emit(tasks, 'dom', location.pathname);
  }

  function scheduleDomScan() { clearTimeout(domTimer); domTimer = setTimeout(scanDom, 180); }

  function syncDomObserver() {
    if (disposed) return;
    if (!onScheduledRoute()) {
      clearTimeout(domTimer); domTimer = 0;
      domObserver?.disconnect?.(); domObserver = null;
      return;
    }
    scheduleDomScan();
    if (domObserver || !document.documentElement) return;
    domObserver = new MutationObserver(scheduleDomScan);
    domObserver.observe(document.documentElement, { subtree:true, childList:true, characterData:true });
  }

  function installRouteListener() {
    routeListener = () => syncDomObserver();
    window.addEventListener('popstate', routeListener, false);
    window.addEventListener('hashchange', routeListener, false);
    try { globalThis.navigation?.addEventListener?.('currententrychange', routeListener); } catch (_) {}
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', syncDomObserver, { once:true }); else syncDomObserver();
  }

  function onBridgeMessage(event) {
    if (disposed || event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== BRIDGE_SOURCE || data.kind !== REFRESH_KIND) return;
    const nonce = clean(data.nonce, 120);
    const endpoint = sanitizedSourceUrl(data.endpoint);
    if (!nonce || !endpoint) return;
    fetchEndpoint(endpoint, 'refresh').then((result) => {
      if (disposed) return;
      window.postMessage({ source:SOURCE, kind:'scheduled-task-refresh-result', version:VERSION, nonce, result:{ ok:Boolean(result?.ok), count:Number(result?.count || 0), error:clean(result?.error,120) } }, '*');
    }).catch((error) => {
      if (disposed) return;
      window.postMessage({ source:SOURCE, kind:'scheduled-task-refresh-result', version:VERSION, nonce, result:{ ok:false, count:0, error:clean(error?.message || error,120) } }, '*');
    });
  }

  window.addEventListener('message', onBridgeMessage, false);
  installPerformanceObserver();
  installRouteListener();

  globalThis.ProjectConstellationScheduledTaskPageProbe = {
    version: VERSION,
    collectTasks,
    scanDom,
    fetchEndpoint,
    dispose() {
      disposed = true;
      clearTimeout(domTimer);
      perfObserver?.disconnect?.(); perfObserver = null;
      domObserver?.disconnect?.(); domObserver = null;
      window.removeEventListener('message', onBridgeMessage, false);
      if (routeListener) {
        window.removeEventListener('popstate', routeListener, false);
        window.removeEventListener('hashchange', routeListener, false);
        try { globalThis.navigation?.removeEventListener?.('currententrychange', routeListener); } catch (_) {}
      }
      routeListener = null;
      authCache = null;
      requestedPaths.clear();
    }
  };
})();
