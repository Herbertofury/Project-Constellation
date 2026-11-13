/* Dependency-free recovery policy. Web content is evidence, never authority. */
(function (root) {
  'use strict';
  const VERSION = '1.0.0';
  const KEY = 'pcx.taskRecovery.v1';
  const TASKS = [
    'Minecraft Mod Catalogue Updater', 'JetSetCraft Daily Improvement',
    'GameSync Performance Pass', 'Scheduled Task Watchdog',
    'Scheduled Task Failsafe', 'Minecraft Catalogue Librarian',
    'PIEE Login Reminder', 'Hidden Mob Gems Watch'
  ];
  const normal = s => String(s || '').replace(/[\u2010-\u2015]/g, '-').replace(/\s+/g, ' ').trim();
  const tombstone = s => /^(REPLACED|RETIRED|LEGACY)\s*[-:]/i.test(normal(s));
  const site = u => { try { return new URL(u).origin === 'https://chatgpt.com'; } catch { return false; } };
  const schedule = u => site(u) && /^\/(schedules|tasks)(\/|$)/.test(new URL(u).pathname);
  const conversation = u => site(u) && /^\/c\/[^/?#]+\/?$/.test(new URL(u).pathname);
  function hash(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); }
  function config(v = {}) {
    return {enabled: v.enabled !== false, discoverAttention: v.discoverAttention !== false,
      intervalMinutes: Math.max(1, Math.min(60, Number(v.intervalMinutes) || 1)),
      allowContinuation: v.allowContinuation !== false,
      managedTitles: Array.isArray(v.managedTitles) ? v.managedTitles.map(normal).filter(Boolean) : [...TASKS]};
  }
  function initial() { return {schema: 1, version: VERSION, config: config(), schedulerTabId: null,
    sessions: {}, incidents: {}, history: [], lastInspection: null, status: 'NOT_YET_INSPECTED', coverage: 'NOT_INSPECTED'}; }
  function key(task) { return normal(task.title) + '|' + (task.id || '') + '|' + (task.runId || 'unidentified-run'); }
  function allowed(task, cfg) {
    return !!task && !tombstone(task.title) && (cfg.managedTitles.some(t => normal(t) === normal(task.title)) ||
      (cfg.discoverAttention && task.attention === true));
  }
  function safety(s) {
    if (!site(s.url)) return 'OUTSIDE_CHATGPT';
    if (s.auth) return 'SIGN_IN_REQUIRED';
    if (s.challenge) return 'BROWSER_VERIFICATION_REQUIRED';
    if (s.approval) return 'SECURITY_APPROVAL_REQUIRED';
    if (s.draft) return 'USER_DRAFT_PRESENT';
    if (s.ambiguous) return 'AMBIGUOUS_UI';
    return null;
  }
  function plan(s, state, active = null) {
    const cfg = config(state.config);
    if (!cfg.enabled) return {status: 'PAUSED_BY_USER'};
    const reason = safety(s);
    if (reason) return {status: reason};
    if (active) {
      if (!s.bound) return {status: 'TASK_BINDING_UNVERIFIED'};
      if (s.running) return {status: 'RUNNING_OBSERVED'};
      if (s.completed) return {status: 'UI_COMPLETION_OBSERVED'};
      if (!s.action) return {status: s.recognized ? 'NO_SAFE_CONTINUATION' : 'UI_UNRECOGNIZED'};
      if (!['resume', 'continue-generating', 'continue-run'].includes(s.action.kind)) return {status: 'UNSUPPORTED_ACTION'};
      if (s.action.kind === 'continue-run' && !cfg.allowContinuation) return {status: 'CONTINUATION_DISABLED'};
      const actionKey = active.key + '|' + s.action.kind + '|' + s.fingerprint;
      if (state.incidents[active.key]?.actions?.[actionKey]) return {status: 'ACTION_ALREADY_ATTEMPTED'};
      return {status: 'ACTION_READY', key: active.key, actionKey, action: s.action};
    }
    if (!schedule(s.url) || !s.recognized) return {status: 'UI_UNRECOGNIZED'};
    const eligible = (s.tasks || []).filter(t => allowed(t, cfg));
    for (const task of eligible) {
      if (!task.attention || !task.openAction) continue;
      const k = key(task), prior = state.incidents[k];
      if (Object.values(state.sessions || {}).some(session => session.key === k)) continue;
      if (prior && prior.fingerprint === task.fingerprint && !prior.resetByHealthy) continue;
      return {status: 'ACTION_READY', task, key: k, actionKey: k + '|open|' + task.fingerprint, action: task.openAction};
    }
    if (eligible.some(t => t.attention)) return {status: 'BLOCKERS_RECORDED'};
    // A missing selector is never evidence that the page has no blocked tasks.
    if (!eligible.length && !s.explicitEmpty) return {status: 'NO_TASKS_IDENTIFIED'};
    return {status: 'NO_ATTENTION_IN_INSPECTED_TASKS'};
  }
  function audit(state, event, detail = {}) {
    state.history.push({at: new Date().toISOString(), event, ...detail});
    // This bounds local diagnostic history only, never task or result coverage.
    if (state.history.length > 1000) state.history.splice(0, state.history.length - 1000);
  }
  const api = {VERSION, KEY, TASKS, normal, tombstone, site, schedule, conversation, hash, config, initial, key, allowed, safety, plan, audit};
  root.PCXTaskRecoveryCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
