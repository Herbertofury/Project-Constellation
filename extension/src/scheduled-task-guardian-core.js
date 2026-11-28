(() => {
  'use strict';

  const VERSION = 2;
  const SCHEDULE_URL = 'https://chatgpt.com/schedules';
  const LEGACY_SCHEDULE_URLS = Object.freeze(['https://chatgpt.com/schedules', 'https://chatgpt.com/tasks']);
  const PREMIUM_FEATURE_ID = 'scheduled-task-guardian';
  const DEFAULTS = Object.freeze({
    enabled: false,
    premium: true,
    keepEmbeddedWorkspace: true,
    autoRepair: true,
    cadenceMinutes: 30,
    frameRetryHours: 24,
    observeTaskState: true,
    desktopNotifications: true,
    notifyRunCompleted: true,
    notifyStateChanges: true,
    notificationMuteMinutes: 60
  });
  const CADENCES = Object.freeze([15, 30, 60, 180]);
  const SUCCESS_RUN = /^(?:complete|completed|done|finished|finished-successfully|success|succeeded|successful)$/;
  const FAILED_RUN = /(?:fail|error|cancel|expired|timeout|blocked)/;
  const PAUSED_STATE = /(?:paused|disabled|suspended|inactive|stopped)/;
  const ATTENTION_STATE = /(?:needs?-?attention|needs?-?action|action-?required|approval-?required|waiting-?approval|blocked|failed|error|auth-?required|permission-?required)/;

  function normalizeScheduleUrl(value = SCHEDULE_URL) {
    try {
      const url = new URL(String(value || SCHEDULE_URL));
      if (url.protocol !== 'https:' || url.hostname !== 'chatgpt.com') return SCHEDULE_URL;
      const path = url.pathname.replace(/\/+$/, '') || '/';
      if (!['/scheduled', '/schedules', '/tasks'].includes(path)) return SCHEDULE_URL;
      return SCHEDULE_URL;
    } catch (_) { return SCHEDULE_URL; }
  }

  function normalizeCadence(value) {
    const n = Number(value || DEFAULTS.cadenceMinutes);
    return CADENCES.reduce((best, current) => Math.abs(current - n) < Math.abs(best - n) ? current : best, CADENCES[0]);
  }

  function normalizeSettings(input = {}) {
    const source = input && typeof input === 'object' ? input : {};
    return {
      enabled: Boolean(source.enabled),
      premium: true,
      keepEmbeddedWorkspace: source.keepEmbeddedWorkspace !== false,
      autoRepair: source.autoRepair !== false,
      cadenceMinutes: normalizeCadence(source.cadenceMinutes),
      frameRetryHours: Math.max(1, Math.min(168, Number(source.frameRetryHours || DEFAULTS.frameRetryHours))),
      observeTaskState: source.observeTaskState !== false,
      desktopNotifications: source.desktopNotifications !== false,
      notifyRunCompleted: source.notifyRunCompleted !== false,
      notifyStateChanges: source.notifyStateChanges !== false,
      notificationMuteMinutes: Math.max(15, Math.min(720, Number(source.notificationMuteMinutes || DEFAULTS.notificationMuteMinutes)))
    };
  }

  function headerValue(headers = [], name = '') {
    const needle = String(name || '').toLowerCase();
    return (headers || []).filter((row) => String(row?.name || '').toLowerCase() === needle).map((row) => String(row?.value || '')).join('; ');
  }

  function frameBlockReason(headers = []) {
    const xfo = headerValue(headers, 'x-frame-options').toLowerCase();
    if (/(^|[,; ]+)deny([,; ]+|$)/.test(xfo)) return 'x-frame-options-deny';
    if (/(^|[,; ]+)sameorigin([,; ]+|$)/.test(xfo)) return 'x-frame-options-sameorigin';
    const csp = headerValue(headers, 'content-security-policy');
    const match = csp.match(/(?:^|;)\s*frame-ancestors\s+([^;]+)/i);
    if (match) {
      const sources = String(match[1] || '').trim().toLowerCase();
      if (sources === "'none'") return 'csp-frame-ancestors';
      if (!sources.includes('*') && !sources.includes('chrome-extension:')) return 'csp-frame-ancestors';
    }
    return '';
  }

  function authRequired({ status = 0, finalUrl = '' } = {}) {
    const code = Number(status || 0);
    if (code === 401 || code === 403) return true;
    try {
      const url = new URL(String(finalUrl || ''));
      return /\b(auth|login|signin|sign-in)\b/i.test(`${url.hostname}${url.pathname}`);
    } catch (_) { return false; }
  }

  function deriveRuntime(input = {}) {
    const cfg = normalizeSettings(input.settings || input);
    if (!cfg.enabled) return { status: 'disabled', level: 'offline', title: 'Guardian off', detail: 'Scheduled Task Guardian is disabled.' };
    if (input.authRequired || authRequired(input)) return { status: 'auth-required', level: 'warning', title: 'Sign-in needed', detail: 'ChatGPT Scheduled needs an authenticated browser session before Guardian can verify the workspace.' };
    if (input.error && !Number(input.httpStatus || input.status || 0)) return { status: 'degraded', level: 'danger', title: 'Guardian degraded', detail: String(input.error || 'The Scheduled workspace could not be reached.').slice(0, 500) };
    const code = Number(input.httpStatus || input.status || 0);
    if (code >= 500) return { status: 'degraded', level: 'danger', title: 'Scheduled unavailable', detail: `ChatGPT Scheduled returned HTTP ${code}. Guardian will retry on its bounded cadence.` };
    if (code >= 400) return { status: 'degraded', level: 'warning', title: 'Scheduled needs attention', detail: `ChatGPT Scheduled returned HTTP ${code}.` };
    if (input.frameBlocked) return { status: 'heartbeat', level: 'healthy', title: 'Protected by heartbeat', detail: 'ChatGPT blocks extension framing, so Guardian uses the lighter authenticated reachability path instead of keeping a full hidden page alive.' };
    if (input.frameReady) return { status: 'embedded', level: 'healthy', title: 'Embedded workspace warm', detail: 'The hidden Scheduled workspace is loaded inside Constellation\'s existing offscreen document.' };
    if (code >= 200 && code < 400) return { status: 'reachable', level: 'healthy', title: 'Scheduled reachable', detail: 'The Scheduled workspace responded successfully. Guardian will repair its offscreen workspace if Chrome discards it.' };
    return { status: 'starting', level: 'active', title: 'Guardian starting', detail: 'Preparing the offscreen Scheduled workspace.' };
  }

  function token(value = '') {
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  }

  function timestamp(value) {
    if (value === null || value === undefined || value === '') return 0;
    if (typeof value === 'number' || /^\d+(?:\.\d+)?$/.test(String(value))) {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) return 0;
      return n < 10_000_000_000 ? Math.round(n * 1000) : Math.round(n);
    }
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function normalizeObservedTask(input = {}) {
    const source = input && typeof input === 'object' ? input : {};
    const id = String(source.id || source.taskId || source.task_id || source.jawboneId || source.jawbone_id || source.automationId || source.automation_id || '').trim().slice(0, 220);
    const title = String(source.title || source.name || source.label || 'Scheduled task').replace(/\s+/g, ' ').trim().slice(0, 180) || 'Scheduled task';
    const status = token(source.status || source.state || source.taskStatus || source.task_status || '');
    const lastRunStatus = token(source.lastRunStatus || source.last_run_status || source.runStatus || source.run_status || '');
    const enabled = typeof source.enabled === 'boolean' ? source.enabled : typeof source.is_enabled === 'boolean' ? source.is_enabled : null;
    const nextRunAt = timestamp(source.nextRunAt ?? source.next_run_at ?? source.nextExecutionAt ?? source.next_execution_at);
    const lastRunAt = timestamp(source.lastRunAt ?? source.last_run_at ?? source.lastExecutionAt ?? source.last_execution_at ?? source.completedAt ?? source.completed_at);
    const lastRunId = String(source.lastRunId || source.last_run_id || source.runId || source.run_id || source.executionId || source.execution_id || '').trim().slice(0, 220);
    const attentionReason = String(source.attentionReason || source.attention_reason || source.pauseReason || source.pause_reason || source.failureReason || source.failure_reason || '').replace(/\s+/g, ' ').trim().slice(0, 220);
    const conversationId = String(source.conversationId || source.conversation_id || source.chatId || source.chat_id || '').trim().slice(0, 220);
    const recurring = typeof source.recurring === 'boolean' ? source.recurring : /rrule|freq=|recurr/i.test(String(source.schedule || source.recurrence || source.rrule || ''));
    const requiresAttention = source.requiresAttention === true || source.requires_attention === true || source.needsAttention === true || source.needs_attention === true || source.approvalRequired === true || source.approval_required === true || ATTENTION_STATE.test(`${status} ${lastRunStatus} ${attentionReason}`);
    return { id, title, status, enabled, nextRunAt, lastRunAt, lastRunId, lastRunStatus, attentionReason, conversationId, recurring, requiresAttention };
  }

  function taskHealth(input = {}) {
    const task = normalizeObservedTask(input);
    const paused = task.enabled === false || PAUSED_STATE.test(task.status);
    const runFailed = FAILED_RUN.test(task.lastRunStatus);
    const runSucceeded = SUCCESS_RUN.test(task.lastRunStatus);
    const attention = Boolean(task.requiresAttention || runFailed || ATTENTION_STATE.test(`${task.status} ${task.attentionReason}`));
    const completed = /(?:complete|completed|done|finished)/.test(task.status) && task.enabled !== true;
    return { paused, attention, completed, runFailed, runSucceeded };
  }

  function runKey(input = {}) {
    const task = normalizeObservedTask(input);
    return task.lastRunId || (task.lastRunAt ? `${task.lastRunAt}:${task.lastRunStatus || 'run'}` : '');
  }

  function deriveTaskEvents(previousInput, currentInput) {
    const previous = previousInput ? normalizeObservedTask(previousInput) : null;
    const current = normalizeObservedTask(currentInput);
    if (!current.id) return [];
    if (!previous) return [];
    const before = taskHealth(previous);
    const after = taskHealth(current);
    const prevRun = runKey(previous);
    const nextRun = runKey(current);
    const runChanged = Boolean(nextRun && nextRun !== prevRun);
    const becamePaused = !before.paused && after.paused;
    const becameAttention = !before.attention && after.attention;
    const resumed = before.paused && !after.paused && current.enabled !== false;
    const events = [];

    if (runChanged && after.runFailed && becamePaused) events.push({ type:'run-failed-paused', level:'danger' });
    else if (runChanged && after.runSucceeded && becamePaused) events.push({ type:'run-completed-paused', level:'warning' });
    else {
      if (runChanged && after.runFailed) events.push({ type:'run-failed', level:'danger' });
      else if (runChanged && after.runSucceeded) events.push({ type:'run-completed', level:'success' });
      if (becamePaused) events.push({ type:'paused', level:'warning' });
    }
    if (becameAttention && !events.some((event) => /failed|paused/.test(event.type))) events.push({ type:'needs-attention', level:'danger' });
    if (resumed) events.push({ type:'resumed', level:'info' });
    return events.map((event) => ({ ...event, taskId:current.id, title:current.title, runKey:nextRun, at:Date.now() }));
  }

  function eventPresentation(event = {}, taskInput = {}) {
    const task = normalizeObservedTask(taskInput);
    const name = task.title || event.title || 'Scheduled task';
    const reason = task.attentionReason ? ` ${task.attentionReason}` : '';
    const map = {
      'run-completed': { title:'Scheduled run completed', message:`${name} finished a run successfully.`, important:false },
      'run-failed': { title:'Scheduled run failed', message:`${name} encountered a failed run.${reason}`, important:true },
      'run-completed-paused': { title:'Run completed · task is paused', message:`${name} completed its run, but the task is now paused. Review it before the next expected run.`, important:true },
      'run-failed-paused': { title:'Run failed · task is paused', message:`${name} failed and is now paused.${reason}`, important:true },
      paused: { title:'Scheduled task paused', message:`${name} is paused and will not run again until it is resumed.${reason}`, important:true },
      'needs-attention': { title:'Scheduled task needs attention', message:`${name} needs action before it can continue normally.${reason}`, important:true },
      resumed: { title:'Scheduled task resumed', message:`${name} is active again.`, important:false },
      'baseline-attention': { title:'Scheduled Guardian found tasks needing attention', message:String(event.message || 'Open Scheduled to review paused or attention-required tasks.'), important:true }
    };
    return map[event.type] || { title:'Scheduled Task Guardian', message:`${name} changed state.`, important:false };
  }

  const api = Object.freeze({
    VERSION, SCHEDULE_URL, LEGACY_SCHEDULE_URLS, PREMIUM_FEATURE_ID, DEFAULTS, CADENCES,
    normalizeScheduleUrl, normalizeCadence, normalizeSettings, frameBlockReason, authRequired, deriveRuntime,
    normalizeObservedTask, taskHealth, runKey, deriveTaskEvents, eventPresentation
  });
  globalThis.ProjectConstellationScheduledTaskGuardianCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
