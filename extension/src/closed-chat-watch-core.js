(() => {
  'use strict';

  const VERSION = 1;
  const WATCH_KEY = 'projectConstellationClosedChatWatchesV1';
  const ALARM_NAME = 'pc-closed-chat-watch-next';
  const MAX_WATCHES = 120;
  const TERMINAL_RETENTION_MS = 24 * 60 * 60 * 1000;
  const NO_PROGRESS_MAX_MS = 90 * 60 * 1000;
  const ABSOLUTE_MAX_MS = 6 * 60 * 60 * 1000;
  const PHASES = Object.freeze(['queued','baseline','heartbeat','progress','settling','settled','attention','unsupported','dormant']);

  const clean = (value,max = 240) => String(value ?? '').replace(/\s+/g,' ').trim().slice(0,max);
  const clampTime = (value) => Math.max(0,Number(value || 0));

  function hashText(value) {
    const text = String(value || '');
    let h = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h,16777619);
    }
    return (h >>> 0).toString(36);
  }

  function parsedFingerprint(parsed = {}, htmlFingerprint = '') {
    const turns = Array.isArray(parsed?.turns) ? parsed.turns : [];
    if (turns.length) {
      const tail = turns.slice(-8).map((turn) => {
        const text = String(turn?.text || '');
        return `${clean(turn?.id || turn?.messageId || '',180)}:${clean(turn?.role || '',20)}:${text.length}:${hashText(text)}`;
      }).join('|');
      return {
        fingerprint:`turns:${turns.length}:${hashText(tail)}`,
        signal:'turns',
        turnCount:turns.length,
        assistantCount:turns.filter((turn) => String(turn?.role || '').toLowerCase() === 'assistant').length,
        textLength:Math.max(0,Number(parsed?.textLength || 0))
      };
    }
    const fallback = clean(htmlFingerprint,160) || `page:${Math.max(0,Number(parsed?.textLength || 0))}`;
    return {
      fingerprint:`page:${fallback}`,
      signal:'page',
      turnCount:0,
      assistantCount:0,
      textLength:Math.max(0,Number(parsed?.textLength || 0))
    };
  }

  function normalizeWatch(input = {}) {
    const phase = PHASES.includes(String(input.phase || '')) ? String(input.phase) : 'queued';
    return {
      key:clean(input.key || '',1200),
      url:clean(input.url || '',1800),
      title:clean(input.title || 'AI chat',300),
      providerId:clean(input.providerId || 'ai',80),
      providerName:clean(input.providerName || 'AI',120),
      phase,
      sourceReason:clean(input.sourceReason || 'closed-tab',80),
      active:input.active !== false && !['settled','attention','unsupported','dormant'].includes(phase),
      closedAt:clampTime(input.closedAt || Date.now()),
      createdAt:clampTime(input.createdAt || input.closedAt || Date.now()),
      updatedAt:clampTime(input.updatedAt || Date.now()),
      nextCheckAt:clampTime(input.nextCheckAt || 0),
      lastCheckedAt:clampTime(input.lastCheckedAt || 0),
      lastProgressAt:clampTime(input.lastProgressAt || 0),
      settledAt:clampTime(input.settledAt || 0),
      fingerprint:clean(input.fingerprint || '',300),
      signal:input.signal === 'turns' ? 'turns' : input.signal === 'page' ? 'page' : '',
      turnCount:Math.max(0,Number(input.turnCount || 0)),
      assistantCount:Math.max(0,Number(input.assistantCount || 0)),
      textLength:Math.max(0,Number(input.textLength || 0)),
      probeCount:Math.max(0,Number(input.probeCount || 0)),
      unchangedChecks:Math.max(0,Number(input.unchangedChecks || 0)),
      errorCount:Math.max(0,Number(input.errorCount || 0)),
      seenProgress:Boolean(input.seenProgress),
      etag:clean(input.etag || '',300),
      lastModified:clean(input.lastModified || '',300),
      detail:clean(input.detail || '',600),
      lastError:clean(input.lastError || '',500),
      notificationId:clean(input.notificationId || '',180)
    };
  }

  function delayFor(input = {}) {
    const watch = normalizeWatch(input);
    if (!watch.active) return 0;
    if (watch.phase === 'progress') return 60 * 1000;
    if (watch.phase === 'settling') return 3 * 60 * 1000;
    if (watch.errorCount) return Math.min(30 * 60 * 1000,Math.max(2 * 60 * 1000,2 * 60 * 1000 * Math.pow(2,Math.min(4,watch.errorCount - 1))));
    const ladder = [90 * 1000,2 * 60 * 1000,5 * 60 * 1000,10 * 60 * 1000,15 * 60 * 1000];
    return ladder[Math.min(ladder.length - 1,watch.unchangedChecks)];
  }

  function presentation(input = {}) {
    const watch = normalizeWatch(input);
    const common = {
      observedAt:watch.lastCheckedAt || watch.updatedAt,
      lastActivityAt:watch.lastProgressAt || watch.lastCheckedAt || watch.closedAt,
      open:false,
      pending:0,
      activity:watch.signal === 'turns' && watch.turnCount ? `${watch.turnCount} persisted turn${watch.turnCount === 1 ? '' : 's'} observed remotely` : 'No hidden tab; authenticated background heartbeat only',
      retryAvailable:false,
      failureTitle:''
    };
    if (watch.phase === 'progress') return { ...common,state:'watching',label:'Remote progress',tone:'watching',detail:watch.detail || 'New persisted output was observed after the provider tab closed.',attention:false };
    if (watch.phase === 'settling') return { ...common,state:'watching',label:'Remote settling',tone:'watching',detail:watch.detail || 'Remote output changed and is now quiet; Constellation is confirming it stays settled.',attention:false };
    if (watch.phase === 'settled') return { ...common,state:'done',label:'Remote settled',tone:'done',detail:watch.detail || 'Persisted output stopped changing across conservative heartbeat checks.',attention:false };
    if (watch.phase === 'attention') return { ...common,state:'blocked',label:'Remote watch needs attention',tone:'blocked',detail:watch.detail || watch.lastError || 'The provider no longer allows a trustworthy background heartbeat.',attention:true };
    if (watch.phase === 'unsupported') return { ...common,state:'offline',label:'Saved',tone:'offline',detail:watch.detail || 'This provider does not expose a safe background HTML heartbeat. Reopen the chat for live monitoring.',attention:false };
    if (watch.phase === 'dormant') return { ...common,state:'offline',label:'Saved',tone:'offline',detail:watch.detail || 'Remote heartbeat went dormant after its low-impact watch window. Reopen the chat to resume live monitoring.',attention:false };
    return { ...common,state:'watching',label:'Remote heartbeat',tone:'watching',detail:watch.detail || 'The tab is closed. Constellation is checking for persisted provider-side progress on an adaptive backoff.',attention:false };
  }

  function reduceProbe(input = {}, probe = {}, stamp = Date.now()) {
    const watch = normalizeWatch(input);
    const now = clampTime(stamp || Date.now());
    const age = Math.max(0,now - watch.closedAt);
    const next = { ...watch,updatedAt:now,lastCheckedAt:now,probeCount:watch.probeCount + 1 };

    if (probe.unsupported) return normalizeWatch({ ...next,phase:'unsupported',active:false,detail:probe.detail || 'Provider does not support safe closed-tab background monitoring.',nextCheckAt:0 });
    if (probe.authRequired) return normalizeWatch({ ...next,phase:'attention',active:false,errorCount:watch.errorCount + 1,lastError:'Authentication required',detail:probe.detail || 'Provider session needs attention before remote heartbeat can continue.',nextCheckAt:0 });
    if (probe.error) {
      const errors = watch.errorCount + 1;
      if (errors >= 4) return normalizeWatch({ ...next,phase:'attention',active:false,errorCount:errors,lastError:probe.error,detail:'Remote heartbeat stopped after repeated provider errors to avoid wasteful retries.',nextCheckAt:0 });
      const retryMs = Math.max(Number(probe.retryAfterMs || 0),delayFor({ ...watch,errorCount:errors }));
      return normalizeWatch({ ...next,phase:'heartbeat',active:true,errorCount:errors,lastError:probe.error,detail:'Heartbeat temporarily backed off after a provider error.',nextCheckAt:now + retryMs });
    }

    const fp = clean(probe.fingerprint || '',300);
    const signal = probe.signal === 'turns' ? 'turns' : 'page';
    const changed = Boolean(watch.fingerprint && fp && watch.fingerprint !== fp);
    next.errorCount = 0;
    next.lastError = '';
    next.etag = clean(probe.etag || watch.etag || '',300);
    next.lastModified = clean(probe.lastModified || watch.lastModified || '',300);
    next.fingerprint = fp || watch.fingerprint;
    next.signal = signal || watch.signal;
    next.turnCount = Math.max(0,Number(probe.turnCount ?? watch.turnCount ?? 0));
    next.assistantCount = Math.max(0,Number(probe.assistantCount ?? watch.assistantCount ?? 0));
    next.textLength = Math.max(0,Number(probe.textLength ?? watch.textLength ?? 0));

    if (!watch.fingerprint && fp) {
      next.phase = 'baseline';
      next.active = true;
      next.unchangedChecks = 0;
      next.detail = signal === 'turns' ? 'Remote baseline captured; watching for persisted turn changes without keeping a tab open.' : 'Provider is reachable; watching a lightweight page fingerprint because no persisted turns were parseable.';
      next.nextCheckAt = now + delayFor(next);
      return normalizeWatch(next);
    }

    if (changed && signal === 'turns') {
      next.phase = 'progress';
      next.active = true;
      next.seenProgress = true;
      next.lastProgressAt = now;
      next.unchangedChecks = 0;
      next.detail = 'New persisted turn content was observed after the provider tab closed.';
      next.nextCheckAt = now + delayFor(next);
      return normalizeWatch(next);
    }

    next.unchangedChecks = watch.unchangedChecks + 1;
    if (watch.seenProgress) {
      const quietFor = Math.max(0,now - Number(watch.lastProgressAt || now));
      if (quietFor >= 12 * 60 * 1000 && next.unchangedChecks >= 4) {
        next.phase = 'settled';
        next.active = false;
        next.settledAt = now;
        next.detail = 'Persisted output remained unchanged across conservative follow-up checks. Provider terminal state was not fabricated.';
        next.nextCheckAt = 0;
        return normalizeWatch(next);
      }
      if (quietFor >= 3 * 60 * 1000 && next.unchangedChecks >= 2) {
        next.phase = 'settling';
        next.active = true;
        next.detail = 'Remote output is quiet after observed progress; confirming it remains settled before stopping checks.';
      } else {
        next.phase = 'heartbeat';
        next.active = true;
        next.detail = changed ? 'Provider page changed, but no new persisted turn delta was trustworthy yet.' : 'No new persisted output on this heartbeat.';
      }
      next.nextCheckAt = now + delayFor(next);
      return normalizeWatch(next);
    }

    if (age >= NO_PROGRESS_MAX_MS || age >= ABSOLUTE_MAX_MS) {
      next.phase = 'dormant';
      next.active = false;
      next.detail = 'No trustworthy persisted progress appeared during the low-impact watch window. Monitoring stopped instead of polling forever.';
      next.nextCheckAt = 0;
      return normalizeWatch(next);
    }

    next.phase = 'heartbeat';
    next.active = true;
    next.detail = changed ? 'Provider page changed, but no new persisted turn delta was trustworthy yet.' : 'Provider reachable; no new persisted output on this heartbeat.';
    next.nextCheckAt = now + delayFor(next);
    return normalizeWatch(next);
  }

  function pruneState(input = {}, stamp = Date.now()) {
    const now = clampTime(stamp || Date.now());
    const rows = Object.values(input?.watches && typeof input.watches === 'object' ? input.watches : input || {}).map(normalizeWatch).filter((watch) => watch.key && watch.url);
    const kept = rows.filter((watch) => watch.active || now - Math.max(watch.updatedAt,watch.settledAt,watch.lastCheckedAt,watch.closedAt) <= TERMINAL_RETENTION_MS)
      .sort((a,b) => Number(b.updatedAt || b.closedAt) - Number(a.updatedAt || a.closedAt)).slice(0,MAX_WATCHES);
    return { version:VERSION,updatedAt:now,watches:Object.fromEntries(kept.map((watch) => [watch.key,watch])) };
  }

  globalThis.ProjectConstellationClosedChatWatchCore = Object.freeze({
    VERSION,WATCH_KEY,ALARM_NAME,MAX_WATCHES,TERMINAL_RETENTION_MS,NO_PROGRESS_MAX_MS,ABSOLUTE_MAX_MS,PHASES,
    clean,hashText,parsedFingerprint,normalizeWatch,delayFor,presentation,reduceProbe,pruneState
  });
})();
