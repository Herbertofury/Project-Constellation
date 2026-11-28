(() => {
  'use strict';

  const VERSION = 1;
  function clean(value, max = 500) { return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max); }
  function hash(value) {
    const text = String(value || '');
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  function fingerprint(input = {}) {
    const signature = [clean(input.kind, 100), clean(input.scope, 160), clean(input.signature || input.message, 500), clean(input.environment, 300)].join('|').toLowerCase();
    return hash(signature);
  }

  function normalize(input = {}, now = Date.now()) {
    const fp = clean(input.fingerprint, 64) || fingerprint(input);
    return {
      id: clean(input.id, 120) || `incident:${fp}`,
      fingerprint: fp,
      kind: clean(input.kind || 'unknown', 100),
      scope: clean(input.scope || '', 160),
      signature: clean(input.signature || input.message || '', 500),
      environment: clean(input.environment || '', 300),
      status: ['open', 'resolved', 'superseded'].includes(input.status) ? input.status : 'open',
      occurrences: Math.max(1, Number(input.occurrences || 1) || 1),
      firstSeenAt: Number(input.firstSeenAt || now),
      lastSeenAt: Number(input.lastSeenAt || now),
      updatedAt: Number(input.updatedAt || now),
      cause: clean(input.cause || '', 1200),
      failedRoutes: Array.isArray(input.failedRoutes) ? input.failedRoutes.map((v) => clean(v, 600)).filter(Boolean).slice(-20) : [],
      recipe: input.recipe && typeof input.recipe === 'object' ? { ...input.recipe } : null,
      verification: clean(input.verification || '', 1200),
      invalidationConditions: clean(input.invalidationConditions || '', 1200),
      regressionProtection: clean(input.regressionProtection || '', 1200),
      supersedes: clean(input.supersedes || '', 120),
      version: VERSION
    };
  }

  function merge(existing, incoming = {}, now = Date.now()) {
    const next = normalize({ ...existing, ...incoming }, now);
    if (existing) {
      next.id = existing.id || next.id;
      next.fingerprint = existing.fingerprint || next.fingerprint;
      next.firstSeenAt = Number(existing.firstSeenAt || next.firstSeenAt);
      next.occurrences = Math.max(1, Number(existing.occurrences || 1)) + 1;
      next.recipe = incoming.recipe || existing.recipe || null;
      next.verification = clean(incoming.verification || existing.verification || '', 1200);
      next.failedRoutes = [...(existing.failedRoutes || []), ...(incoming.failedRoutes || [])].map((v) => clean(v, 600)).filter(Boolean).slice(-20);
      if (existing.status === 'resolved' && !incoming.status) next.status = 'open';
    }
    next.lastSeenAt = now;
    next.updatedAt = now;
    return next;
  }

  function resolve(existing, resolution = {}, now = Date.now()) {
    if (!existing) return null;
    const verification = clean(resolution.verification || '', 1200);
    if (!verification) throw new Error('A verified incident recipe requires verification evidence.');
    return normalize({
      ...existing,
      ...resolution,
      status: 'resolved',
      recipe: resolution.recipe || existing.recipe || null,
      verification,
      lastSeenAt: Number(existing.lastSeenAt || now),
      updatedAt: now
    }, now);
  }

  function bestMatch(rows = [], query = {}) {
    const fp = clean(query.fingerprint, 64) || fingerprint(query);
    return rows.find((row) => row?.fingerprint === fp && row?.status === 'resolved' && row?.recipe && row?.verification) || null;
  }

  globalThis.ProjectConstellationIncidentBrainCore = Object.freeze({ VERSION, fingerprint, normalize, merge, resolve, bestMatch, hash });
})();
