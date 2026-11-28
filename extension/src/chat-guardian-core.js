(() => {
  'use strict';

  const VERSION = 1;
  const DEFAULTS = Object.freeze({
    enabled: true,
    prompt: 'Continue the unfinished task.',
    failureDelayMs: 1800,
    cooldownMs: 45 * 1000,
    maxContinuationsPerFingerprint: 6,
    minStallRecoveryMs: 3 * 60 * 1000,
    activeFallbackMs: 60 * 1000,
    idleFallbackMs: 2 * 60 * 1000
  });

  const FAILURE_STATES = new Set(['delivery-timeout','connection-interrupted','response-interrupted','send-failed']);
  const HARD_STOP_STATES = new Set(['paused','refresh-required','dead','tool-dead','request-dead']);
  const STALL_STATES = new Set(['stalled','tool-stalled','request-stalled']);
  const HOLD_STATES = new Set(['provider-review','blocked-approval','rate-limited','auth-required','unavailable','capacity-watch','capacity-handoff','capacity-reached']);

  const clamp = (value, fallback, min, max) => Math.max(min, Math.min(max, Number(value) || fallback));
  const clean = (value, max = 700) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
  const hash = (value) => {
    const text = String(value || '');
    let h = 2166136261;
    for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36);
  };

  function normalizeSettings(input = {}) {
    const cfg = { ...DEFAULTS, ...(input || {}) };
    cfg.enabled = cfg.enabled !== false;
    cfg.prompt = clean(cfg.prompt || DEFAULTS.prompt, 80) || DEFAULTS.prompt;
    cfg.failureDelayMs = clamp(cfg.failureDelayMs, DEFAULTS.failureDelayMs, 500, 30 * 1000);
    cfg.cooldownMs = clamp(cfg.cooldownMs, DEFAULTS.cooldownMs, 10 * 1000, 30 * 60 * 1000);
    cfg.maxContinuationsPerFingerprint = Math.max(1, Math.min(20, Math.round(Number(cfg.maxContinuationsPerFingerprint) || DEFAULTS.maxContinuationsPerFingerprint)));
    cfg.minStallRecoveryMs = clamp(cfg.minStallRecoveryMs, DEFAULTS.minStallRecoveryMs, 60 * 1000, 30 * 60 * 1000);
    cfg.activeFallbackMs = clamp(cfg.activeFallbackMs, DEFAULTS.activeFallbackMs, 30 * 1000, 10 * 60 * 1000);
    cfg.idleFallbackMs = clamp(cfg.idleFallbackMs, DEFAULTS.idleFallbackMs, cfg.activeFallbackMs, 30 * 60 * 1000);
    return cfg;
  }

  function stateTokens(row = {}) {
    return [...new Set([
      clean(row.status, 80).toLowerCase(),
      clean(row.rawStatus, 80).toLowerCase(),
      clean(row.healthState, 80).toLowerCase(),
      clean(row.failure?.state || row.failure?.status, 80).toLowerCase()
    ].filter(Boolean))];
  }

  function recoverySignal(row = {}, settings = {}, now = Date.now()) {
    const cfg = normalizeSettings(settings);
    if (!cfg.enabled) return { recover:false, reason:'disabled' };
    if (String(row.providerId || '').toLowerCase() !== 'chatgpt') return { recover:false, reason:'non-chatgpt' };
    if (!Number(row.tabId || 0)) return { recover:false, reason:'no-tab' };
    if (!String(row.chatId || '')) return { recover:false, reason:'no-chat' };

    const tokens = stateTokens(row);
    const hold = tokens.find((token) => HOLD_STATES.has(token));
    if (hold) return { recover:false, reason:'hold', state:hold };

    const failureState = tokens.find((token) => FAILURE_STATES.has(token));
    const failure = row.failure?.active || failureState ? (row.failure || {}) : null;
    if (failure) {
      const detectedAt = Math.max(0, Number(failure.detectedAt || row.failureDetectedAt || 0));
      if (detectedAt && Number(now) - detectedAt < cfg.failureDelayMs) return { recover:false, reason:'failure-settling', state:failureState || clean(failure.state || failure.status, 80) };
      return { recover:true, reason:failureState || clean(failure.state || failure.status, 80) || 'response-interrupted', severity:'failure' };
    }

    if (Number(row.network?.pending || 0) > 0) return { recover:false, reason:'network-active' };
    const hard = tokens.find((token) => HARD_STOP_STATES.has(token));
    if (hard) return { recover:true, reason:hard, severity:'hard-stop' };

    const stalled = tokens.find((token) => STALL_STATES.has(token));
    if (stalled) {
      const quietForMs = Math.max(0, Number(row.generation?.quietForMs || row.progressAgeMs || 0));
      if (quietForMs < cfg.minStallRecoveryMs) return { recover:false, reason:'stall-settling', state:stalled, quietForMs };
      return { recover:true, reason:stalled, severity:'stalled' };
    }

    return { recover:false, reason:'healthy' };
  }

  function fingerprint(row = {}, signal = {}) {
    const failure = row.failure || {};
    const basis = [
      row.chatId || row.tabId || '',
      signal.reason || '',
      failure.fingerprint || '',
      failure.rawText || failure.title || failure.detail || '',
      row.healthState || row.status || ''
    ].map((value) => clean(value, 700)).join('|');
    return hash(basis);
  }

  function shouldAttempt(row = {}, history = {}, settings = {}, now = Date.now()) {
    const cfg = normalizeSettings(settings);
    const signal = recoverySignal(row, cfg, now);
    if (!signal.recover) return { ...signal, fingerprint:'' };
    const fp = fingerprint(row, signal);
    const same = String(history.fingerprint || '') === fp;
    const attempts = same ? Math.max(0, Number(history.attempts || 0)) : 0;
    const lastAttemptAt = same ? Math.max(0, Number(history.lastAttemptAt || 0)) : 0;
    if (lastAttemptAt && Number(now) - lastAttemptAt < cfg.cooldownMs) return { recover:false, reason:'cooldown', state:signal.reason, fingerprint:fp, attempts };
    if (attempts >= cfg.maxContinuationsPerFingerprint) return { recover:false, reason:'attempt-cap', state:signal.reason, fingerprint:fp, attempts };
    return { ...signal, fingerprint:fp, attempts, prompt:cfg.prompt };
  }

  function nextFallbackMs(rows = [], settings = {}) {
    const cfg = normalizeSettings(settings);
    const active = (Array.isArray(rows) ? rows : []).some((row) => {
      const tokens = stateTokens(row);
      return Boolean(row?.generation?.active || Number(row?.network?.pending || 0) > 0 || tokens.some((token) => FAILURE_STATES.has(token) || HARD_STOP_STATES.has(token) || STALL_STATES.has(token)));
    });
    return active ? cfg.activeFallbackMs : cfg.idleFallbackMs;
  }

  const api = Object.freeze({ VERSION, DEFAULTS, FAILURE_STATES, HARD_STOP_STATES, STALL_STATES, HOLD_STATES, normalizeSettings, stateTokens, recoverySignal, fingerprint, shouldAttempt, nextFallbackMs });
  globalThis.ProjectConstellationChatGuardianCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
