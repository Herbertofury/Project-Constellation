(() => {
  'use strict';

  const VERSION = '0.18.1';
  const PAGE_SOURCE = 'project-constellation-scheduled-task-page-probe';
  const BRIDGE_SOURCE = 'project-constellation-scheduled-task-observer';
  const SNAPSHOT_KIND = 'scheduled-task-snapshot';
  const REFRESH_KIND = 'scheduled-task-refresh-request';
  const prior = globalThis.ProjectConstellationScheduledTaskObserver;
  if (prior?.version === VERSION) return;
  try { prior?.dispose?.(); } catch (_) {}

  const pending = new Map();
  const clean = (value, max = 240) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  const safeEndpoint = (value) => {
    try {
      const url = new URL(String(value || ''), location.href);
      if (url.origin !== location.origin || !/^\/(?:backend-api|api)\//i.test(url.pathname) || !/(?:schedul|task|automat|jawbone|notification|run|execution)/i.test(url.pathname)) return '';
      return `${url.pathname}${url.search}`.slice(0, 260);
    } catch (_) { return ''; }
  };

  function sanitizeTasks(rows) {
    return Array.isArray(rows) ? rows.slice(0, 120).map((row) => ({
      id:clean(row?.id,220), title:clean(row?.title || 'Scheduled task',180), status:clean(row?.status,80), enabled:typeof row?.enabled === 'boolean' ? row.enabled : null,
      nextRunAt:Number(row?.nextRunAt || 0), lastRunAt:Number(row?.lastRunAt || 0), lastRunId:clean(row?.lastRunId,220), lastRunStatus:clean(row?.lastRunStatus,80),
      recurring:Boolean(row?.recurring), requiresAttention:Boolean(row?.requiresAttention), attentionReason:clean(row?.attentionReason,220), conversationId:clean(row?.conversationId,220), recordKind:row?.recordKind === 'run' ? 'run' : 'task'
    })).filter((row) => row.id) : [];
  }

  const pageListener = (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== PAGE_SOURCE) return;
    if (data.kind === SNAPSHOT_KIND && data.snapshot) {
      const snapshot = data.snapshot;
      const tasks = sanitizeTasks(snapshot.tasks);
      if (!tasks.length) return;
      chrome.runtime.sendMessage({ type:'PC_SCHEDULE_GUARDIAN_TASK_SNAPSHOT', snapshot:{ tasks, source:clean(snapshot.source,40), sourceUrl:safeEndpoint(snapshot.sourceUrl), observedAt:Number(snapshot.observedAt || Date.now()) } }).catch(() => {});
      return;
    }
    if (data.kind === 'scheduled-task-refresh-result') {
      const nonce = clean(data.nonce,120);
      const resolver = pending.get(nonce);
      if (!resolver) return;
      pending.delete(nonce);
      clearTimeout(resolver.timer);
      resolver.resolve({ ok:Boolean(data.result?.ok), count:Number(data.result?.count || 0), error:clean(data.result?.error,120) });
    }
  };

  const runtimeListener = (message, _sender, sendResponse) => {
    if (message?.type !== 'PC_SCHEDULE_GUARDIAN_REFRESH_FROM_PAGE') return undefined;
    const endpoint = safeEndpoint(message.endpoint);
    if (!endpoint) { sendResponse({ ok:false, error:'Unsafe Scheduled endpoint.' }); return false; }
    const nonce = crypto.randomUUID();
    const promise = new Promise((resolve) => {
      const timer = setTimeout(() => { pending.delete(nonce); resolve({ ok:false, error:'Scheduled refresh timed out.' }); }, 10_000);
      pending.set(nonce,{ resolve,timer });
      window.postMessage({ source:BRIDGE_SOURCE, kind:REFRESH_KIND, version:VERSION, nonce, endpoint }, '*');
    });
    promise.then(sendResponse);
    return true;
  };

  window.addEventListener('message', pageListener, false);
  chrome.runtime.onMessage.addListener(runtimeListener);
  globalThis.ProjectConstellationScheduledTaskObserver = {
    version:VERSION,
    dispose() {
      window.removeEventListener('message',pageListener,false);
      chrome.runtime.onMessage.removeListener(runtimeListener);
      for (const row of pending.values()) { clearTimeout(row.timer); row.resolve({ ok:false, error:'Scheduled observer disposed.' }); }
      pending.clear();
    }
  };
})();
