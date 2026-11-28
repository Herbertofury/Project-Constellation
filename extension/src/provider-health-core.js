(() => {
  'use strict';

  const VERSION = 1;
  const HEALTHY_SCORE = 75;
  const DEGRADED_SCORE = 45;
  const CAPABILITY_WEIGHTS = Object.freeze({
    providerDetected: 12,
    routeDetected: 10,
    chatDetected: 10,
    composerDetected: 20,
    sendControlDetected: 14,
    messageSurfaceDetected: 16,
    streamingSignalObserved: 8,
    projectContextDetected: 10
  });

  function bool(value) { return Boolean(value); }
  function clean(value, max = 240) { return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max); }
  function hash(value) {
    const text = String(value || '');
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  function normalizeCapabilities(input = {}) {
    const out = {};
    for (const key of Object.keys(CAPABILITY_WEIGHTS)) out[key] = bool(input[key]);
    return out;
  }

  function evaluate(input = {}, options = {}) {
    const capabilities = normalizeCapabilities(input.capabilities || input);
    const ageMs = Math.max(0, Number(input.ageMs ?? options.ageMs ?? 0) || 0);
    const hydrationMs = Math.max(1000, Number(options.hydrationMs ?? 8000) || 8000);
    const providerId = clean(input.providerId || options.providerId || 'unknown', 80) || 'unknown';
    const url = clean(input.url || options.url || '', 1000);
    const chatExpected = bool(input.chatExpected ?? options.chatExpected);
    const projectExpected = bool(input.projectExpected ?? options.projectExpected);
    const required = ['providerDetected', 'routeDetected', 'composerDetected'];
    if (chatExpected) required.push('chatDetected', 'messageSurfaceDetected');
    if (projectExpected) required.push('projectContextDetected');

    let weighted = 0;
    let total = 0;
    for (const [key, weight] of Object.entries(CAPABILITY_WEIGHTS)) {
      if (key === 'projectContextDetected' && !projectExpected) continue;
      if (key === 'streamingSignalObserved') continue; // observational only; never a health requirement
      total += weight;
      if (capabilities[key]) weighted += weight;
    }
    const score = total ? Math.round((weighted / total) * 100) : 0;
    const missing = required.filter((key) => !capabilities[key]);
    const warming = ageMs < hydrationMs && capabilities.providerDetected && missing.length > 0;
    const status = !capabilities.providerDetected ? 'unavailable' : warming ? 'warming' : missing.length === 0 && score >= HEALTHY_SCORE ? 'healthy' : score >= DEGRADED_SCORE ? 'degraded' : 'broken';
    const signature = `${providerId}|${status}|${missing.join(',')}|${url.replace(/[?#].*$/, '')}`;
    return {
      version: VERSION,
      providerId,
      status,
      score,
      missing,
      capabilities,
      chatExpected,
      projectExpected,
      ageMs,
      hydrationMs,
      fingerprint: hash(signature),
      observedAt: Number(input.observedAt || Date.now()),
      url
    };
  }

  function transition(previous, next) {
    if (!next) return { changed: false, degraded: false, recovered: false };
    const priorStatus = String(previous?.status || '');
    const nextStatus = String(next.status || '');
    const changed = !previous || priorStatus !== nextStatus || previous.fingerprint !== next.fingerprint;
    return {
      changed,
      degraded: changed && ['degraded', 'broken', 'unavailable'].includes(nextStatus),
      recovered: changed && priorStatus && !['healthy', 'warming'].includes(priorStatus) && nextStatus === 'healthy'
    };
  }

  globalThis.ProjectConstellationProviderHealthCore = Object.freeze({ VERSION, CAPABILITY_WEIGHTS, normalizeCapabilities, evaluate, transition, hash });
})();
