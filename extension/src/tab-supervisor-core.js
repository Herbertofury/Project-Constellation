(() => {
  'use strict';

  const VERSION = 1;
  const DEFAULTS = Object.freeze({
    staleRunningMs: 2 * 60 * 60 * 1000,
    deadRecoveryMs: 4 * 60 * 1000,
    failureRecoveryDelayMs: 3500,
    recoveryCooldownMs: 10 * 60 * 1000,
    maxRecoveriesPerChat: 4,
    capacityWarningTurns: 120,
    capacityHandoffTurns: 180,
    capacityWarningChars: 160000,
    capacityHandoffChars: 280000
  });

  const FAILURE_STATES = new Set(['delivery-timeout', 'connection-interrupted', 'response-interrupted', 'send-failed']);
  const DEAD_STATES = new Set(['dead', 'tool-dead', 'request-dead', 'stalled', 'tool-stalled', 'request-stalled', 'refresh-required', 'stale-page']);
  const BLOCKED_STATES = new Set(['blocked-approval', 'rate-limited', 'auth-required', 'unavailable']);

  function safeUrl(value) {
    try { return new URL(String(value || '')); } catch (_) { return null; }
  }

  function chatIdFromUrl(value) {
    const url = safeUrl(value);
    if (!url) return '';
    const match = url.pathname.match(/(?:^|\/)c\/([a-zA-Z0-9-]+)/);
    return match?.[1] ? `chatgpt:${match[1]}` : '';
  }

  function projectFromUrl(value) {
    const url = safeUrl(value);
    if (!url) return null;
    const match = url.pathname.match(/(?:^|\/)g\/(g-p-[a-zA-Z0-9_-]+)/);
    if (!match?.[1]) return null;
    return { providerProjectId: match[1], id: `chatgpt:project:${match[1]}` };
  }

  function cleanProjectName(value = '') {
    const text = String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text || /^(projects?|chats?|new project|show more|show less)$/i.test(text)) return '';
    return text.slice(0, 180);
  }

  function classifyFailureText(value = '') {
    const text = String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!text) return '';
    if (/message delivery timed out|delivery timed out/.test(text)) return 'delivery-timeout';
    if (/connection interrupted|connection (?:was )?lost|network error|websocket (?:connection )?(?:error|failed|closed)/.test(text)) return 'connection-interrupted';
    if (/message (?:was )?not sent|failed to send|failed to deliver your message/.test(text)) return 'send-failed';
    if (/error generating (?:a )?response|failed to (?:generate|respond)|response (?:was )?interrupted|generation (?:was )?interrupted|something went wrong/.test(text)) return 'response-interrupted';
    return '';
  }

  function normalizeConfig(input = {}) {
    const cfg = { ...DEFAULTS, ...(input || {}) };
    const clamp = (value, fallback, min, max) => Math.max(min, Math.min(max, Number(value) || fallback));
    cfg.staleRunningMs = clamp(cfg.staleRunningMs, DEFAULTS.staleRunningMs, 10 * 60 * 1000, 24 * 60 * 60 * 1000);
    cfg.deadRecoveryMs = clamp(cfg.deadRecoveryMs, DEFAULTS.deadRecoveryMs, 60 * 1000, 60 * 60 * 1000);
    cfg.failureRecoveryDelayMs = clamp(cfg.failureRecoveryDelayMs, DEFAULTS.failureRecoveryDelayMs, 1000, 60 * 1000);
    cfg.recoveryCooldownMs = clamp(cfg.recoveryCooldownMs, DEFAULTS.recoveryCooldownMs, 60 * 1000, 6 * 60 * 60 * 1000);
    cfg.maxRecoveriesPerChat = Math.max(1, Math.min(12, Math.round(Number(cfg.maxRecoveriesPerChat) || DEFAULTS.maxRecoveriesPerChat)));
    return cfg;
  }

  function capacityLevel(snapshot = {}, settings = {}) {
    const cfg = { ...DEFAULTS, ...(settings || {}) };
    const turns = Math.max(0, Number(snapshot.turnCount || 0));
    const chars = Math.max(0, Number(snapshot.charCount || 0));
    if (snapshot.explicitLimitSignal || turns >= Number(cfg.capacityHandoffTurns) || chars >= Number(cfg.capacityHandoffChars)) return 'handoff';
    if (snapshot.nearLimitSignal || turns >= Number(cfg.capacityWarningTurns) || chars >= Number(cfg.capacityWarningChars)) return 'watch';
    return 'clear';
  }

  function shouldRecover(input = {}) {
    const cfg = normalizeConfig(input.config);
    const now = Number(input.now || Date.now());
    if (!input.enabled) return { recover: false, reason: 'disabled' };
    if (!input.chatId) return { recover: false, reason: 'no-chat' };
    if (BLOCKED_STATES.has(String(input.status || ''))) return { recover: false, reason: 'blocked-state' };
    if (Number(input.recoveryCount || 0) >= cfg.maxRecoveriesPerChat) return { recover: false, reason: 'recovery-cap' };
    const lastRecoveryAt = Number(input.lastRecoveryAt || 0);
    if (lastRecoveryAt && now - lastRecoveryAt < cfg.recoveryCooldownMs) return { recover: false, reason: 'cooldown' };

    const failureKind = String(input.failureKind || '');
    const failureDetectedAt = Number(input.failureDetectedAt || input.lastProgressAt || now);
    if (FAILURE_STATES.has(failureKind) && now - failureDetectedAt >= cfg.failureRecoveryDelayMs) {
      return { recover: true, reason: failureKind, severity: 'failure' };
    }

    const status = String(input.status || '');
    const lastProgressAt = Number(input.lastProgressAt || 0);
    const age = lastProgressAt ? Math.max(0, now - lastProgressAt) : 0;
    if (DEAD_STATES.has(status) && age >= cfg.deadRecoveryMs) return { recover: true, reason: status, severity: 'dead' };
    if ((input.wasRunning || input.unresolvedUser) && lastProgressAt && age >= cfg.staleRunningMs) {
      return { recover: true, reason: input.unresolvedUser ? 'unanswered-user-turn' : 'stale-running-2h', severity: 'stale' };
    }
    return { recover: false, reason: 'healthy' };
  }

  function buildContinuationPrompt(input = {}) {
    const reason = String(input.reason || 'interrupted chat').replace(/-/g, ' ');
    const project = cleanProjectName(input.projectName || '');
    const title = String(input.title || '').replace(/\s+/g, ' ').trim().slice(0, 180);
    const context = [project ? `Project: ${project}.` : '', title ? `Chat: ${title}.` : '', `Recovery reason: ${reason}.`].filter(Boolean).join(' ');
    return [
      'Continue this work as the direct continuation of the interrupted/stale chat. Do not restart the project, discard established decisions, repeat completed side effects, or merely summarize the prior work.',
      context,
      'First inspect the latest visible messages and any Project Constellation checkpoint/rescue state. Treat the last attempted tool/write action as possibly partially completed: verify whether it actually happened before repeating it.',
      'Preserve the exact objective, accepted decisions, project/repository/file/Drive/GitHub identities, paths, hashes, run/job IDs, tests already passed, blockers, no-repeat history, and the exact unfinished next action.',
      'Resume from that exact next action immediately. Resolve any safe permission/tool prompt needed to proceed. Continue autonomously until the current task is complete or a genuinely user-only blocker remains.'
    ].filter(Boolean).join('\n\n');
  }

  const api = Object.freeze({ VERSION, DEFAULTS, FAILURE_STATES, DEAD_STATES, BLOCKED_STATES, chatIdFromUrl, projectFromUrl, cleanProjectName, classifyFailureText, normalizeConfig, capacityLevel, shouldRecover, buildContinuationPrompt });
  globalThis.ProjectConstellationTabSupervisorCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
