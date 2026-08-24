(() => {
  'use strict';
  const VERSION = 3;
  const DEFAULTS = Object.freeze({
    enabled: true,
    showHealthy: true,
    corner: 'bottom-right',
    density: 'compact',
    softStallMs: 45000,
    hardStallMs: 120000,
    deadStallMs: 240000,
    pollActiveMs: 2500,
    pollIdleMs: 12000,
    hydrationGraceMs: 8000,
    networkObservation: true,
    toolWatchdogEnabled: true,
    capacityGuardEnabled: true,
    capacityWarningTurns: 180,
    capacityHandoffTurns: 260,
    capacityWarningChars: 240000,
    capacityHandoffChars: 400000
  });

  const LEVEL = Object.freeze({ healthy: 0, info: 1, active: 2, warning: 3, danger: 4, critical: 5 });
  const clampMs = (value, fallback, min = 1000, max = 60 * 60 * 1000) => Math.max(min, Math.min(max, Number(value) || fallback));
  const age = (now, at) => at ? Math.max(0, now - Number(at || 0)) : Number.POSITIVE_INFINITY;
  const first = (items = [], predicate = () => true) => items.find(predicate) || null;
  const findingTypes = (items = []) => new Set(items.map((row) => String(row?.type || '')));
  const shortLabel = (value, max = 72) => {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, Math.max(1, max - 1)).trimEnd()}…` : text;
  };

  function normalizeSettings(input = {}) {
    const settings = { ...DEFAULTS, ...(input || {}) };
    settings.softStallMs = clampMs(settings.softStallMs, DEFAULTS.softStallMs, 5000, 15 * 60 * 1000);
    settings.hardStallMs = clampMs(settings.hardStallMs, DEFAULTS.hardStallMs, settings.softStallMs + 5000, 30 * 60 * 1000);
    settings.deadStallMs = clampMs(settings.deadStallMs, Math.max(DEFAULTS.deadStallMs, settings.hardStallMs * 2), settings.hardStallMs + 30000, 60 * 60 * 1000);
    settings.pollActiveMs = clampMs(settings.pollActiveMs, DEFAULTS.pollActiveMs, 750, 15000);
    settings.pollIdleMs = clampMs(settings.pollIdleMs, DEFAULTS.pollIdleMs, 3000, 30000);
    settings.hydrationGraceMs = clampMs(settings.hydrationGraceMs, DEFAULTS.hydrationGraceMs, 0, 60000);
    const positiveInt = (value, fallback, min, max) => Math.max(min, Math.min(max, Math.round(Number(value) || fallback)));
    settings.capacityWarningTurns = positiveInt(settings.capacityWarningTurns, DEFAULTS.capacityWarningTurns, 40, 1000);
    settings.capacityHandoffTurns = positiveInt(settings.capacityHandoffTurns, DEFAULTS.capacityHandoffTurns, settings.capacityWarningTurns + 20, 1600);
    settings.capacityWarningChars = positiveInt(settings.capacityWarningChars, DEFAULTS.capacityWarningChars, 50000, 4000000);
    settings.capacityHandoffChars = positiveInt(settings.capacityHandoffChars, DEFAULTS.capacityHandoffChars, settings.capacityWarningChars + 25000, 6000000);
    settings.toolWatchdogEnabled = settings.toolWatchdogEnabled !== false;
    settings.capacityGuardEnabled = settings.capacityGuardEnabled !== false;
    settings.corner = ['bottom-right','bottom-left','top-right','top-left'].includes(settings.corner) ? settings.corner : DEFAULTS.corner;
    settings.density = ['compact','comfortable'].includes(settings.density) ? settings.density : DEFAULTS.density;
    return settings;
  }

  function deriveCapacity(input = {}, settings = DEFAULTS) {
    const cfg = normalizeSettings(settings);
    const storedTurns = Math.max(0, Number(input.storedTurns || 0));
    const sessionTurns = Math.max(0, Number(input.sessionTurns || 0));
    const mountedTurns = Math.max(0, Number(input.mountedTurns || 0));
    const turnCount = Math.max(storedTurns, sessionTurns, mountedTurns);
    const capturedChars = Math.max(0, Number(input.capturedChars || input.mountedChars || 0));
    const explicitLimitSignal = Boolean(input.explicitLimitSignal);
    const explicitLimitText = String(input.explicitLimitText || '').slice(0, 240);
    const turnRatio = cfg.capacityHandoffTurns ? turnCount / cfg.capacityHandoffTurns : 0;
    const charRatio = cfg.capacityHandoffChars ? capturedChars / cfg.capacityHandoffChars : 0;
    const safetyLoad = Math.max(turnRatio, charRatio);
    const chips = [];
    if (turnCount) chips.push(`${turnCount} captured turn${turnCount === 1 ? '' : 's'}`);
    if (capturedChars >= 1000) chips.push(`${Math.max(1, Math.round(capturedChars / 1000))}k captured chars`);

    if (!cfg.capacityGuardEnabled) return { state:'off', level:'healthy', score:LEVEL.healthy, title:'Capacity Guard off', detail:'Conversation Capacity Guard is disabled.', recommendedAction:'', turnCount, capturedChars, safetyLoad, chips:[] };
    if (explicitLimitSignal) return { state:'reached', level:'critical', score:LEVEL.critical, title:'Provider limit signal detected', detail:explicitLimitText || 'The provider is signaling that this conversation has reached or is very near its usable limit. Secure a handoff before continuing elsewhere.', recommendedAction:'handoff', turnCount, capturedChars, safetyLoad:Math.max(1, safetyLoad), chips:[...chips,'provider limit signal'] };
    if (turnCount >= cfg.capacityHandoffTurns || capturedChars >= cfg.capacityHandoffChars) return { state:'handoff', level:'danger', score:LEVEL.danger, title:'Secure a handoff now', detail:'This conversation crossed your proactive handoff threshold. Provider limits vary by model and are not exposed exactly; this is a safety threshold, not a claim about the provider’s exact remaining context.', recommendedAction:'handoff', turnCount, capturedChars, safetyLoad, chips:[...chips,'handoff threshold'] };
    if (turnCount >= cfg.capacityWarningTurns || capturedChars >= cfg.capacityWarningChars) return { state:'watch', level:'warning', score:LEVEL.warning, title:'Conversation runway narrowing', detail:'This chat is getting large. Constellation is warning early so you can secure a handoff before a provider-specific conversation limit becomes disruptive.', recommendedAction:'handoff', turnCount, capturedChars, safetyLoad, chips:[...chips,'early warning'] };
    return { state:'clear', level:'healthy', score:LEVEL.healthy, title:'Capacity runway clear', detail:'Conversation size is below your proactive warning thresholds.', recommendedAction:'', turnCount, capturedChars, safetyLoad, chips };
  }

  function result(state, level, title, detail, extras = {}) {
    return {
      state, level, score: LEVEL[level] ?? LEVEL.info, title, detail,
      recommendedAction: extras.recommendedAction || '',
      reason: extras.reason || state,
      chips: [...new Set((extras.chips || []).filter(Boolean))].slice(0, 8),
      networkActive: Boolean(extras.networkActive),
      progressAgeMs: Number.isFinite(extras.progressAgeMs) ? extras.progressAgeMs : 0,
      networkProgressAgeMs: Number.isFinite(extras.networkProgressAgeMs) ? extras.networkProgressAgeMs : 0,
      pendingAgeMs: Number.isFinite(extras.pendingAgeMs) ? extras.pendingAgeMs : 0,
      projectRisk: Boolean(extras.projectRisk),
      pageRisk: Boolean(extras.pageRisk),
      rawStatus: extras.rawStatus || 'idle',
      activity: extras.activity || null
    };
  }

  function deriveHealth(input = {}) {
    const now = Number(input.now || Date.now());
    const cfg = normalizeSettings(input.settings);
    const capacity = deriveCapacity(input.capacity || {}, cfg);
    const rawStatus = String(input.chatStatus || 'idle');
    const network = input.network || {};
    const page = input.page || {};
    const tool = input.tool || {};
    const findings = Array.isArray(input.integrityFindings) ? input.integrityFindings : [];
    const types = findingTypes(findings);
    const pending = Math.max(0, Number(network.pending || 0));
    const oldestPendingAt = Math.max(0, Number(network.oldestPendingAt || (pending ? network.lastStartAt : 0) || 0));
    const lastNetworkProgressAt = Math.max(Number(network.lastResponseAt || 0), Number(network.lastCompleteAt || 0), Number(network.lastErrorAt || 0));
    const lastNetworkAt = Math.max(Number(network.lastStartAt || 0), lastNetworkProgressAt);
    const lastProgressAt = Math.max(Number(input.lastTurnProgressAt || 0), Number(input.lastDomProgressAt || 0), Number(input.lastStatusChangeAt || 0), Number(tool.lastProgressAt || 0));
    const progressAgeMs = age(now, lastProgressAt);
    const networkAgeMs = age(now, lastNetworkAt);
    const networkProgressAgeMs = age(now, lastNetworkProgressAt || network.lastStartAt);
    const pendingAgeMs = pending ? age(now, oldestPendingAt || network.lastStartAt) : Number.POSITIVE_INFINITY;
    const networkActive = pending > 0 || (network.streamLikely && networkAgeMs < Math.max(cfg.softStallMs, 30000));
    const networkSilent = pending > 0 && pendingAgeMs >= cfg.hardStallMs && networkProgressAgeMs >= cfg.hardStallMs && progressAgeMs >= cfg.hardStallMs;
    const toolPresent = Boolean(tool.present || tool.active || tool.label);
    const toolActive = Boolean(tool.active || tool.busy || ((rawStatus === 'running' || input.running) && toolPresent));
    const toolAgeMs = age(now, Number(tool.lastProgressAt || tool.startedAt || lastProgressAt || 0));
    const toolLabel = shortLabel(tool.label || tool.phaseLabel || 'Tool call', 74);
    const toolPhase = shortLabel(tool.phase || '', 34);
    const toolEntryCount = Math.max(0, Number(tool.entryCount || 0));
    const toolActivity = toolPresent ? { kind:'tool', label:toolLabel || 'Tool call', phase:toolPhase || 'tool', ageMs:Number.isFinite(toolAgeMs) ? toolAgeMs : 0, entryCount:toolEntryCount, generic:Boolean(tool.generic), busy:Boolean(tool.busy) } : null;
    const chips = [];
    if (pending) chips.push(`${pending} live request${pending === 1 ? '' : 's'}`);
    if (toolPresent) chips.push(toolLabel || 'tool activity');
    if (toolEntryCount > 1) chips.push(`${toolEntryCount} tool steps seen`);
    if (input.baselineVersion) chips.push(`project v${input.baselineVersion}`);

    const emit = (row) => {
      const merged = { ...row, capacity };
      if (capacity.score >= LEVEL.warning) {
        merged.chips = [...new Set([...(merged.chips || []), ...(capacity.chips || []).slice(0, 2)])].slice(0, 8);
        if (capacity.score > Number(merged.score || 0) && !['refresh-required','rate-limited','blocked-approval','auth-required','unavailable','degraded','stale-page','project-rollback','tool-dead','dead'].includes(merged.state)) {
          merged.level = capacity.level; merged.score = capacity.score;
        }
        if (['healthy','follow-up'].includes(merged.state)) {
          merged.state = capacity.state === 'reached' ? 'capacity-reached' : capacity.state === 'handoff' ? 'capacity-handoff' : 'capacity-watch';
          merged.title = capacity.title; merged.detail = capacity.detail; merged.reason = 'conversation-capacity'; merged.recommendedAction = capacity.recommendedAction;
        }
      }
      return merged;
    };

    if (rawStatus === 'refresh-required' || page.refreshRequired) {
      return emit(result('refresh-required','critical','Refresh required','The page hit a delivery/connection state that Constellation classifies as browser-refresh recovery. Retry is not used.',{ recommendedAction:'refresh', chips, pageRisk:true, rawStatus, progressAgeMs, networkProgressAgeMs, pendingAgeMs, activity:toolActivity }));
    }
    if (rawStatus === 'rate-limited' || network.rateLimited) {
      return emit(result('rate-limited','danger','Provider cooling down','The provider reported too many requests. Constellation has paused its own provider work until the shared cooldown expires.',{ chips:[...chips,'request governor'], rawStatus, progressAgeMs, networkProgressAgeMs, pendingAgeMs, activity:toolActivity }));
    }
    if (rawStatus === 'blocked-approval') {
      return emit(result('blocked-approval','danger','Waiting for approval','This chat is blocked on a connected-app/tool approval. Approval Recovery can resolve it according to your Constellation settings.',{ chips, rawStatus, progressAgeMs, networkProgressAgeMs, pendingAgeMs, activity:toolActivity }));
    }
    if (rawStatus === 'auth-required') return emit(result('auth-required','danger','Sign-in required','This provider session is no longer authenticated.',{ chips, rawStatus, progressAgeMs, networkProgressAgeMs, pendingAgeMs, activity:toolActivity }));
    if (rawStatus === 'unavailable') return emit(result('unavailable','critical','Chat unavailable','The provider no longer exposes this conversation, but Constellation keeps its captured history and artifact lineage.',{ chips, rawStatus, progressAgeMs, networkProgressAgeMs, pendingAgeMs, activity:toolActivity }));

    if (page.renderDegraded) {
      return emit(result('degraded','critical','Page render degraded','Conversation content exists in the page structure but is no longer rendering normally. A clean refresh is recommended; Constellation preserves the catalogued copy.',{ recommendedAction:'refresh', chips:[...chips,'render mismatch'], pageRisk:true, rawStatus, progressAgeMs, networkProgressAgeMs, pendingAgeMs, activity:toolActivity }));
    }
    if (page.catalogAhead || page.staleRevision) {
      return emit(result('stale-page','critical','This tab is behind','Constellation has a newer captured revision than the conversation currently rendered in this tab. Refresh to load the latest chat state.',{ recommendedAction:'refresh', chips:[...chips,'newer catalog state'], pageRisk:true, rawStatus, progressAgeMs, networkProgressAgeMs, pendingAgeMs, activity:toolActivity }));
    }

    const rollback = first(findings, (row) => row?.type === 'project-version-rollback');
    if (rollback) return emit(result('project-rollback','critical','Project rollback detected',rollback.detail || rollback.title || 'This project appears older than its previously verified baseline.',{ chips:[...chips,'project integrity'], projectRisk:true, rawStatus, progressAgeMs, networkProgressAgeMs, pendingAgeMs, activity:toolActivity }));
    const oldVersion = first(findings, (row) => row?.type === 'old-version-chat');
    const regression = first(findings, (row) => row?.type === 'feature-regression-signal');
    const conflict = first(findings, (row) => row?.type === 'artifact-hash-conflict' || row?.type === 'artifact-size-conflict');
    const projectRisk = Boolean(oldVersion || regression || conflict);

    const running = rawStatus === 'running' || Boolean(input.running);
    if (running || networkActive) {
      if (cfg.toolWatchdogEnabled && toolActive) {
        const noProof = (!pending && progressAgeMs >= cfg.hardStallMs) || networkSilent;
        if (noProof && toolAgeMs >= cfg.deadStallMs && progressAgeMs >= cfg.deadStallMs) {
          return emit(result('tool-dead','critical',`Tool call appears dead · ${toolLabel}`,`The current tool step has shown no tool-card, conversation, or provider-network progress for ${Math.round(Math.max(toolAgeMs, progressAgeMs) / 1000)} seconds. Constellation is not auto-clicking Retry or pretending the tool is still healthy.`,{ chips:[...chips,'no proof of progress'], networkActive, rawStatus, progressAgeMs, networkProgressAgeMs, pendingAgeMs, projectRisk, activity:toolActivity }));
        }
        if (noProof && toolAgeMs >= cfg.hardStallMs) {
          return emit(result('tool-stalled','danger',`Tool call looks stuck · ${toolLabel}`,pending ? `A provider request is still open, but this tool step and the response stream have not produced observable progress for ${Math.round(toolAgeMs / 1000)} seconds.` : `The tool step is still on screen, but there is no live provider request and no observable tool/chat progress for ${Math.round(toolAgeMs / 1000)} seconds.`,{ chips:[...chips,pending ? 'open request · no progress' : 'no live request'], networkActive, rawStatus, progressAgeMs, networkProgressAgeMs, pendingAgeMs, projectRisk, activity:toolActivity }));
        }
        if (!pending && toolAgeMs >= cfg.softStallMs && progressAgeMs >= cfg.softStallMs) {
          return emit(result('tool-quiet','warning',`Tool quiet · ${toolLabel}`,`No new tool-card or conversation progress has appeared for ${Math.round(toolAgeMs / 1000)} seconds. Constellation is watching before calling it stuck.`,{ chips:[...chips,'watching tool'], rawStatus, progressAgeMs, networkProgressAgeMs, pendingAgeMs, projectRisk, activity:toolActivity }));
        }
        const liveDetail = pending ? 'A provider request is in flight and the current tool step is still producing live evidence.' : 'The current tool step has recent DOM/tool progress. No stall signal is present.';
        return emit(result('tool-running','active',`Tool working · ${toolLabel}`,liveDetail,{ chips:[...chips,pending ? 'network active' : 'tool heartbeat'], networkActive, rawStatus, progressAgeMs, networkProgressAgeMs, pendingAgeMs, projectRisk, activity:toolActivity }));
      }

      if (networkActive) {
        if (networkSilent && progressAgeMs >= cfg.deadStallMs) {
          return emit(result('dead','critical','Chat appears dead',`A provider request is still technically open, but neither the response stream nor the page has shown progress for ${Math.round(progressAgeMs / 1000)} seconds. This is a local dead-chat signal, not a claim that the provider backend definitively terminated.`,{ chips:[...chips,'zombie request suspected'], networkActive:true, rawStatus, progressAgeMs, networkProgressAgeMs, pendingAgeMs, projectRisk }));
        }
        if (networkSilent) {
          return emit(result('request-stalled','danger','Request looks stuck',`A provider request is still open, but there has been no response-stream, tool, or DOM progress for ${Math.round(progressAgeMs / 1000)} seconds.`,{ chips:[...chips,'open request · no progress'], networkActive:true, rawStatus, progressAgeMs, networkProgressAgeMs, pendingAgeMs, projectRisk }));
        }
        return emit(result('working','active','Chat is still working',pending ? 'The page may look quiet, but a provider request is in flight and recent progress evidence is still healthy.' : 'Recent provider network activity says the chat is still alive.',{ chips:[...chips,'network active'], networkActive:true, rawStatus, progressAgeMs, networkProgressAgeMs, pendingAgeMs, projectRisk, activity:{ kind:'model', label:'Model / provider', phase:'working', ageMs:progressAgeMs } }));
      }
      if (progressAgeMs >= cfg.deadStallMs) {
        return emit(result('dead','critical','Chat appears dead',`No conversation, tool, or provider-network progress has been observed for ${Math.round(progressAgeMs / 1000)} seconds even though the page still reports active work.`,{ chips:[...chips,'no live request','no progress'], rawStatus, progressAgeMs, networkProgressAgeMs, pendingAgeMs, projectRisk }));
      }
      if (progressAgeMs >= cfg.hardStallMs) {
        return emit(result('stalled','danger','Chat stalled',`No conversation, tool, or provider-network progress has been observed for ${Math.round(progressAgeMs / 1000)} seconds while the chat still reports active work.`,{ chips:[...chips,'no live request'], rawStatus, progressAgeMs, networkProgressAgeMs, pendingAgeMs, projectRisk }));
      }
      if (progressAgeMs >= cfg.softStallMs) {
        return emit(result('quiet-working','warning','Working quietly',`The UI has been quiet for ${Math.round(progressAgeMs / 1000)} seconds. Constellation is watching for network, tool-card, or DOM progress before declaring a stall.`,{ chips, rawStatus, progressAgeMs, networkProgressAgeMs, pendingAgeMs, projectRisk }));
      }
      return emit(result('working','active','Thinking / generating','Live activity is still moving normally.',{ chips, rawStatus, progressAgeMs, networkProgressAgeMs, pendingAgeMs, projectRisk, activity:{ kind:'model', label:'Model / provider', phase:'thinking', ageMs:progressAgeMs } }));
    }

    if (rawStatus === 'paused') return emit(result('paused','warning','Generation paused','This chat exposes a Continue/Resume action and can be recovered by Constellation.',{ chips, rawStatus, progressAgeMs, networkProgressAgeMs, pendingAgeMs, activity:toolActivity }));
    if (rawStatus === 'stalled') return emit(result('stalled','danger','Chat stalled','The background watchdog already classified this chat as stalled.',{ chips, rawStatus, progressAgeMs, networkProgressAgeMs, pendingAgeMs, activity:toolActivity }));
    if (rawStatus === 'errored') return emit(result('errored','danger','Chat error detected','The page reports an error that is not in the browser-refresh-only class.',{ chips, rawStatus, progressAgeMs, networkProgressAgeMs, pendingAgeMs, activity:toolActivity }));

    if (oldVersion) return emit(result('old-project-version','warning','Older project version',oldVersion.detail || oldVersion.title || 'This chat appears to be working against an older project version than the current baseline.',{ chips:[...chips,'project integrity'], projectRisk:true, rawStatus, progressAgeMs, networkProgressAgeMs, pendingAgeMs, activity:toolActivity }));
    if (regression) return emit(result('regression-risk','warning','Regression signal',regression.detail || regression.title || 'A previously working project feature appears to have regressed in this chat.',{ chips:[...chips,'project integrity'], projectRisk:true, rawStatus, progressAgeMs, networkProgressAgeMs, pendingAgeMs, activity:toolActivity }));
    if (conflict) return emit(result('project-conflict','warning','Project artifact conflict',conflict.detail || conflict.title || 'Conflicting project artifacts need review.',{ chips:[...chips,'artifact conflict'], projectRisk:true, rawStatus, progressAgeMs, networkProgressAgeMs, pendingAgeMs, activity:toolActivity }));
    if (types.has('unanswered-chat') || types.has('follow-up-work')) return emit(result('follow-up','info','Follow-up remains','Project Integrity has unfinished work associated with this chat.',{ chips:[...chips,'follow-up'], projectRisk:true, rawStatus, progressAgeMs, networkProgressAgeMs, pendingAgeMs, activity:toolActivity }));

    return emit(result('healthy','healthy','Chat healthy','The rendered conversation, provider activity, and catalogued project state look consistent.',{ chips, rawStatus, progressAgeMs, networkProgressAgeMs, pendingAgeMs, activity:toolActivity }));
  }
  const api = Object.freeze({ VERSION, DEFAULTS, normalizeSettings, deriveCapacity, deriveHealth });
  globalThis.ProjectConstellationHealthCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
