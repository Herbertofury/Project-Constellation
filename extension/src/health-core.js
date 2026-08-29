(() => {
  'use strict';
  const VERSION = 10;
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
    capacityProfileVersion: 2,
    capacityWarningTurns: 120,
    capacityHandoffTurns: 180,
    capacityWarningChars: 160000,
    capacityHandoffChars: 280000
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

  const FAILURE_STATES = Object.freeze([
    'delivery-timeout',
    'connection-interrupted',
    'response-interrupted',
    'send-failed'
  ]);

  function classifyProviderFailure(text = '', hints = {}) {
    const raw = String(text || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 12000);
    const lower = raw.toLowerCase();
    const retryAvailable = Boolean(hints.retryAvailable);
    const retryLabel = shortLabel(hints.retryLabel || '', 80);
    const partialAssistantChars = Math.max(0, Number(hints.partialAssistantChars || 0));
    const toolActivitySeen = Boolean(hints.toolActivitySeen);
    const observedAfterUser = hints.observedAfterUser !== false;
    const common = (state, title, detail, status = state) => ({
      active:true, state, status, title, detail, rawText:raw.slice(0, 700),
      fingerprint:`${state}:${raw.slice(0, 500).toLowerCase()}`,
      retryAvailable, retryLabel, recommendedAction:retryAvailable ? 'retry' : 'refresh',
      partialAssistantChars, toolActivitySeen, observedAfterUser
    });

    if (/message delivery timed out|delivery timed out/.test(lower)) {
      return common('delivery-timeout','Message delivery timed out', retryAvailable
        ? 'ChatGPT stopped the current turn with an explicit delivery timeout. A native Retry control is available; Constellation will only use it when you click Retry.'
        : 'ChatGPT stopped the current turn with an explicit delivery timeout. Constellation preserved the interruption as Needs Attention and will not retry or refresh automatically.');
    }
    if (/connection interrupted|connection (?:was )?lost|network connection (?:was )?lost|reconnect(?:ion)? failed|a network error occurred|network error occurred|error occurred while connecting to the websocket|websocket (?:connection )?(?:error|failed|closed)/.test(lower)) {
      return common('connection-interrupted','Connection interrupted', retryAvailable
        ? 'The provider reported a network/connection interruption and exposes a native recovery control. Constellation will not activate it without an explicit click.'
        : 'The provider reported a network/connection interruption. The current tab is left untouched; refresh remains a manual fallback if no native recovery control appears.');
    }
    if (/failed to send (?:the )?(?:message|prompt)|message (?:was )?not sent|message failed to send|could(?:n['’]t| not) send (?:the )?(?:message|prompt)|failed to deliver your message/.test(lower)) {
      return common('send-failed','Message was not sent', retryAvailable
        ? 'The provider reports that the outgoing message was not delivered. A native Retry/Resend control is available and remains user-triggered.'
        : 'The provider reports that the outgoing message was not delivered. Constellation records the failure instead of assuming the prompt reached the model.');
    }
    if (/there was an error generating (?:a )?response|error generating (?:a )?response|failed to (?:generate|respond)|response generation failed|generation (?:was )?interrupted|response (?:was )?interrupted|something went wrong(?: while generating)?/.test(lower)) {
      return common('response-interrupted','Response interrupted', retryAvailable
        ? 'The provider ended the response with an explicit generation error. A native Retry/Regenerate control is available; Constellation leaves it manual to avoid duplicating side effects from tool calls.'
        : 'The provider ended the response with an explicit generation error. Constellation records the interruption and does not silently retry tool or model work.');
    }
    if (/failed to deliver message/.test(lower)) {
      const responseSide = observedAfterUser || toolActivitySeen || partialAssistantChars > 0;
      return common(responseSide ? 'response-interrupted' : 'send-failed', responseSide ? 'Response delivery failed' : 'Message delivery failed', retryAvailable
        ? 'The provider exposes a native Retry control for this delivery failure. Constellation will only activate it after an explicit user action.'
        : 'The provider reports a delivery failure. Constellation records it without guessing whether a retry is safe.');
    }
    return { active:false, state:'', status:'', title:'', detail:'', rawText:'', fingerprint:'', retryAvailable:false, retryLabel:'', recommendedAction:'', partialAssistantChars, toolActivitySeen, observedAfterUser };
  }

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
    const transcriptTurns = Math.max(0, Number(input.transcriptTurns || 0));
    const turnCount = Math.max(storedTurns, sessionTurns, mountedTurns, transcriptTurns);
    const suppliedBranchMessages = Math.max(0, Number(input.activeBranchMessages || 0));
    const activeBranchMessages = Math.max(turnCount, suppliedBranchMessages);
    const observedStructuredDelta = suppliedBranchMessages > 0 && transcriptTurns > 0 ? Math.max(0, suppliedBranchMessages - transcriptTurns) : 0;
    const structuredMessages = Math.max(0, Number(input.structuredMessages || 0), observedStructuredDelta);
    const toolMessages = Math.max(0, Math.min(activeBranchMessages, Number(input.toolMessages || 0)));
    const storedChars = Math.max(0, Number(input.storedChars || 0));
    const transcriptChars = Math.max(0, Number(input.transcriptChars || 0));
    const capturedChars = Math.max(0, Number(input.capturedChars || 0), Number(input.mountedChars || 0), storedChars, transcriptChars);
    const recentAverageChars = Math.max(0, Number(input.recentAverageChars || 0), Number(input.transcriptRecentAverageChars || 0));
    const explicitLimitSignal = Boolean(input.explicitLimitSignal);
    const explicitLimitText = String(input.explicitLimitText || '').slice(0, 240);
    const nearLimitSignal = Boolean(input.nearLimitSignal);
    const nearLimitText = String(input.nearLimitText || '').slice(0, 240);

    // ChatGPT tool/app work can add many branch messages while user/assistant text
    // remains deceptively small. Keep those pressure lanes separate rather than
    // pretending provider capacity is a single character counter.
    const branchWarningMessages = Math.max(cfg.capacityWarningTurns + 12, Math.round(cfg.capacityWarningTurns * 1.15));
    const branchHandoffMessages = Math.max(cfg.capacityHandoffTurns + 18, Math.round(cfg.capacityHandoffTurns * 1.15));
    const structuredWarningMessages = Math.max(24, Math.round(cfg.capacityWarningTurns * 0.40));
    const structuredHandoffMessages = Math.max(40, Math.round(cfg.capacityHandoffTurns * 0.40));
    const toolWarningMessages = Math.max(18, Math.round(cfg.capacityWarningTurns * 0.30));
    const toolHandoffMessages = Math.max(30, Math.round(cfg.capacityHandoffTurns * 0.30));

    const turnRatio = cfg.capacityHandoffTurns ? turnCount / cfg.capacityHandoffTurns : 0;
    const charRatio = cfg.capacityHandoffChars ? capturedChars / cfg.capacityHandoffChars : 0;
    const branchRatio = branchHandoffMessages ? activeBranchMessages / branchHandoffMessages : 0;
    const structuredRatio = structuredHandoffMessages ? structuredMessages / structuredHandoffMessages : 0;
    const toolRatio = toolHandoffMessages ? toolMessages / toolHandoffMessages : 0;
    const safetyLoad = Math.max(turnRatio, charRatio, branchRatio, structuredRatio, toolRatio);
    const safetyPercent = Math.max(0, Math.round(safetyLoad * 100));
    const remainingTurns = Math.max(0, cfg.capacityHandoffTurns - turnCount);
    const remainingChars = Math.max(0, cfg.capacityHandoffChars - capturedChars);
    const projectedMessages = recentAverageChars > 0 ? Math.max(0, remainingChars / recentAverageChars) : null;
    const predictiveWatch = Boolean(projectedMessages !== null && capturedChars >= Math.min(cfg.capacityWarningChars * 0.55, cfg.capacityHandoffChars * 0.45) && projectedMessages <= 3);
    const structuredPressure = Math.max(branchRatio, structuredRatio, toolRatio);
    const adaptiveWatch = Boolean(structuredPressure >= 0.66 && (structuredMessages > 0 || toolMessages > 0));
    const adaptiveHandoff = Boolean(structuredPressure >= 0.86 && (structuredMessages >= Math.max(12, Math.round(structuredWarningMessages * 0.60)) || toolMessages >= Math.max(9, Math.round(toolWarningMessages * 0.60))));
    const chips = [];
    if (turnCount) chips.push(`${turnCount} visible/stored message${turnCount === 1 ? '' : 's'}`);
    if (activeBranchMessages > turnCount) chips.push(`${activeBranchMessages} active-branch messages`);
    if (structuredMessages) chips.push(`${structuredMessages} structured/tool-app messages`);
    if (toolMessages) chips.push(`${toolMessages} tool messages`);
    if (capturedChars >= 1000) chips.push(`${Math.max(1, Math.round(capturedChars / 1000))}k measured chars`);
    if (transcriptTurns || transcriptChars || suppliedBranchMessages > 0) chips.push('full-branch measurement');
    if (predictiveWatch) chips.push('heavy-turn runway');
    if (adaptiveWatch || adaptiveHandoff) chips.push('structured branch pressure');

    const common = { turnCount, activeBranchMessages, structuredMessages, toolMessages, capturedChars, storedChars, transcriptChars, transcriptTurns, recentAverageChars, safetyLoad, safetyPercent, remainingTurns, remainingChars, projectedMessages, predictiveWatch, adaptiveWatch, adaptiveHandoff, branchWarningMessages, branchHandoffMessages, structuredWarningMessages, structuredHandoffMessages, toolWarningMessages, toolHandoffMessages, chips };
    if (!cfg.capacityGuardEnabled) return { state:'off', level:'healthy', score:LEVEL.healthy, title:'Capacity Guard off', detail:'Conversation Capacity Guard is disabled.', recommendedAction:'', ...common, chips:[] };
    if (explicitLimitSignal) return { state:'reached', level:'critical', score:LEVEL.critical, title:'Conversation maximum reached', detail:explicitLimitText || 'The provider says this conversation has reached its maximum length. Branch now; Constellation will not navigate or submit anything without your explicit action.', recommendedAction:'handoff', ...common, safetyLoad:Math.max(1, safetyLoad), safetyPercent:Math.max(100, safetyPercent), chips:[...chips,'provider hard limit'] };
    if (nearLimitSignal) return { state:'handoff', level:'danger', score:LEVEL.danger, title:'Branch now — provider runway warning', detail:nearLimitText || 'The provider is warning that this conversation is close to its usable limit. Secure a continuation now while the current branch is still available.', recommendedAction:'handoff', ...common, chips:[...chips,'provider near-limit signal'] };
    if (turnCount >= cfg.capacityHandoffTurns || capturedChars >= cfg.capacityHandoffChars || activeBranchMessages >= branchHandoffMessages || structuredMessages >= structuredHandoffMessages || toolMessages >= toolHandoffMessages || adaptiveHandoff) return { state:'handoff', level:'danger', score:LEVEL.danger, title:'Branch now — runway is tight', detail:'This chat crossed a proactive runway boundary. Constellation now counts the full active branch, including structured tool/app messages that can consume conversation capacity without adding much visible text.', recommendedAction:'handoff', ...common, chips:[...chips,adaptiveHandoff ? 'adaptive handoff zone' : 'handoff threshold'] };
    if (turnCount >= cfg.capacityWarningTurns || capturedChars >= cfg.capacityWarningChars || activeBranchMessages >= branchWarningMessages || structuredMessages >= structuredWarningMessages || toolMessages >= toolWarningMessages || predictiveWatch || adaptiveWatch) return { state:'watch', level:'warning', score:LEVEL.warning, title:'Branch soon — runway narrowing', detail:predictiveWatch ? 'Recent turns are unusually large, so Constellation is warning before the normal threshold. This is a conservative local runway estimate, not a claim about the provider’s exact remaining context.' : (adaptiveWatch ? 'Tool/app activity is expanding the active branch faster than visible turn counts suggest. Branch early while the chat is still healthy.' : 'This chat is getting large. Constellation is warning early from the strongest stored, transcript, character, and structured-message evidence.'), recommendedAction:'handoff', ...common, chips:[...chips,'early branch warning'] };
    return { state:'clear', level:'healthy', score:LEVEL.healthy, title:'Capacity runway clear', detail:'Conversation size is below your proactive warning thresholds.', recommendedAction:'', ...common };
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
    const provider = input.provider || {};
    const runtime = input.runtime || {};
    const findings = Array.isArray(input.integrityFindings) ? input.integrityFindings : [];
    const types = findingTypes(findings);
    const pending = Math.max(0, Number(network.pending || 0));
    const oldestPendingAt = Math.max(0, Number(network.oldestPendingAt || (pending ? network.lastStartAt : 0) || 0));
    const lastNetworkProgressAt = Math.max(Number(network.lastResponseAt || 0), Number(network.lastCompleteAt || 0), Number(network.lastErrorAt || 0));
    const lastNetworkAt = Math.max(Number(network.lastStartAt || 0), lastNetworkProgressAt);
    const providerObservedAt = Math.max(0, Number(provider.observedAt || provider.transcriptObservedAt || 0));
    const providerActivityAt = Math.max(0, Number(provider.lastActivityAt || provider.activityAt || 0), ...((Array.isArray(provider.activityTrail) ? provider.activityTrail : []).map((item) => Number(item?.observedAt || item?.at || 0))));
    const providerStatus = String(provider.status || provider.transcriptStatus || '').toLowerCase();
    const providerActiveClaim = ['running','in_progress','in-progress','streaming','thinking','generating','tool-running','active'].includes(providerStatus);
    const providerFinalClaim = ['final','finished','complete','completed','done','idle'].includes(providerStatus);
    const providerHeartbeatWindowMs = Math.max(12000, Math.min(30000, Math.round(cfg.softStallMs * 0.6)));
    const providerHeartbeatFresh = providerActiveClaim && providerObservedAt > 0 && age(now, providerObservedAt) <= providerHeartbeatWindowMs;
    const providerActivityFresh = providerActivityAt > 0 && age(now, providerActivityAt) <= cfg.hardStallMs;
    const currentTurnOwned = runtime.currentTurnOwned === true || provider.currentTurnOwned === true;
    const currentTurnRejected = runtime.currentTurnOwned === false || provider.currentTurnOwned === false;
    const requestLifecycleActive = runtime.requestActive === true || provider.requestActive === true;
    const stopControlActive = runtime.stopControl === true || provider.stopControl === true;
    const composerBusy = runtime.composerBusy === true || runtime.busy === true || provider.composerBusy === true;
    const lastProgressAt = Math.max(Number(input.lastTurnProgressAt || 0), Number(input.lastDomProgressAt || 0), Number(input.lastStatusChangeAt || 0), Number(tool.lastProgressAt || 0), providerActivityAt);
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
    const running = rawStatus === 'running' || Boolean(input.running) || providerHeartbeatFresh || requestLifecycleActive || stopControlActive || composerBusy;
    const freshResponse = Number(input.lastTurnProgressAt || 0) > 0 && age(now, Number(input.lastTurnProgressAt || 0)) <= cfg.hardStallMs;
    const freshDom = Number(input.lastDomProgressAt || 0) > 0 && age(now, Number(input.lastDomProgressAt || 0)) <= cfg.hardStallMs;
    const freshTool = toolPresent && Number(tool.lastProgressAt || tool.startedAt || 0) > 0 && toolAgeMs <= cfg.hardStallMs;
    const activeEvidenceScore = (providerHeartbeatFresh ? 5 : 0) + (providerActivityFresh ? 2 : 0) + (networkActive ? 3 : 0) + (freshResponse ? 2 : 0) + (freshDom ? 2 : 0) + (freshTool ? 2 : 0) + (currentTurnOwned ? 2 : 0) + (requestLifecycleActive ? 2 : 0) + (stopControlActive ? 1 : 0) + (composerBusy ? 1 : 0);
    const contradictionScore = (currentTurnRejected ? 4 : 0) + (providerFinalClaim ? 4 : 0);
    const consensusActive = providerHeartbeatFresh || activeEvidenceScore - contradictionScore >= 5;
    const consensusUncertain = running && !consensusActive && !networkSilent;

    const emit = (row) => {
      const merged = { ...row, capacity };
      const proofSources = [];
      if (network.observed || lastNetworkAt) proofSources.push({ kind:'network', label:networkActive ? `${pending || 1} live request${pending === 1 ? '' : 's'}` : 'provider network observed', active:networkActive, at:lastNetworkAt || 0 });
      if (toolPresent) proofSources.push({ kind:'tool', label:toolLabel || 'tool activity', active:toolActive, at:Number(tool.lastProgressAt || tool.startedAt || 0) });
      if (Number(input.lastTurnProgressAt || 0)) proofSources.push({ kind:'response', label:'rendered response progress', active:running, at:Number(input.lastTurnProgressAt || 0) });
      if (Number(input.lastDomProgressAt || 0)) proofSources.push({ kind:'dom', label:'page DOM progress', active:running, at:Number(input.lastDomProgressAt || 0) });
      if (providerObservedAt || providerStatus) proofSources.push({ kind:'provider', label:providerHeartbeatFresh ? `fresh provider heartbeat · ${providerStatus || 'active'}` : providerFinalClaim ? `provider reports ${providerStatus}` : `provider heartbeat ${providerStatus || 'observed'}`, active:providerHeartbeatFresh, at:providerObservedAt || providerActivityAt || 0 });
      if (currentTurnOwned || currentTurnRejected) proofSources.push({ kind:'ownership', label:currentTurnOwned ? 'activity belongs to current turn' : 'activity does not match current turn', active:currentTurnOwned, at:providerObservedAt || now });
      if (requestLifecycleActive) proofSources.push({ kind:'lifecycle', label:'current request lifecycle is active', active:true, at:lastNetworkAt || providerObservedAt || now });
      if (stopControlActive || composerBusy) proofSources.push({ kind:'controls', label:stopControlActive ? 'provider stop control is active' : 'composer reports busy', active:true, at:providerObservedAt || now });
      if (rawStatus !== 'idle') proofSources.push({ kind:'status', label:`page reports ${rawStatus.replaceAll('-', ' ')}`, active:false, at:Number(input.lastStatusChangeAt || 0) });
      if (page.catalogAhead || page.staleRevision || page.renderDegraded || page.refreshRequired || page.outputRegression?.active) proofSources.push({ kind:'page', label:page.outputRegression?.active ? 'saved output differs from page' : 'page integrity signal', active:false, at:now });
      const uniqueProof = [...new Map(proofSources.map((item) => [`${item.kind}:${item.label}`, item])).values()].slice(0, 8);
      const freshProof = uniqueProof.filter((item) => item.active || (item.at && now - item.at <= cfg.hardStallMs));
      merged.proof = {
        evidenceOnly:true,
        certainty:consensusActive ? (activeEvidenceScore >= 7 ? 'high' : 'medium') : freshProof.length ? 'limited' : 'unknown',
        verdict:consensusActive ? 'active' : consensusUncertain ? 'uncertain' : (providerFinalClaim || currentTurnRejected ? 'contradicted' : 'inactive'),
        activeScore:activeEvidenceScore,
        contradictionScore,
        sources:uniqueProof,
        lastObservedAt:Math.max(0, ...uniqueProof.map((item) => Number(item.at || 0)))
      };
      if (capacity.score >= LEVEL.warning) {
        merged.chips = [...new Set([...(merged.chips || []), ...(capacity.chips || []).slice(0, 2)])].slice(0, 8);
        if (capacity.score > Number(merged.score || 0) && !['delivery-timeout','connection-interrupted','response-interrupted','send-failed','refresh-required','rate-limited','blocked-approval','auth-required','unavailable','output-regressed','degraded','stale-page','project-rollback','tool-dead','dead'].includes(merged.state)) {
          merged.level = capacity.level; merged.score = capacity.score;
        }
        if (['healthy','follow-up'].includes(merged.state)) {
          merged.state = capacity.state === 'reached' ? 'capacity-reached' : capacity.state === 'handoff' ? 'capacity-handoff' : 'capacity-watch';
          merged.title = capacity.title; merged.detail = capacity.detail; merged.reason = 'conversation-capacity'; merged.recommendedAction = capacity.recommendedAction;
        }
      }
      return merged;
    };

    const providerFailure = input.failure?.active ? input.failure : (FAILURE_STATES.includes(rawStatus) ? { active:true, state:rawStatus, status:rawStatus } : null);
    if (providerFailure?.active) {
      const state = FAILURE_STATES.includes(String(providerFailure.state || providerFailure.status || '')) ? String(providerFailure.state || providerFailure.status) : 'response-interrupted';
      const titles = { 'delivery-timeout':'Message delivery timed out', 'connection-interrupted':'Connection interrupted', 'response-interrupted':'Response interrupted', 'send-failed':'Message was not sent' };
      const retryAvailable = Boolean(providerFailure.retryAvailable);
      const partial = Math.max(0, Number(providerFailure.partialAssistantChars || 0));
      const failureChips = [
        ...chips,
        retryAvailable ? `${shortLabel(providerFailure.retryLabel || 'Retry', 30)} available` : 'manual recovery',
        partial ? (partial < 1000 ? `${partial} partial chars preserved` : `${Math.round(partial / 100) / 10}k partial chars preserved`) : '',
        providerFailure.toolActivitySeen ? 'tool activity preceded failure' : ''
      ];
      return emit(result(state,'danger', providerFailure.title || titles[state] || 'Provider interruption', providerFailure.detail || 'The provider explicitly interrupted the current turn. Constellation recorded the failure and left recovery under user control.', {
        recommendedAction:providerFailure.recommendedAction || (retryAvailable ? 'retry' : 'refresh'), chips:failureChips, pageRisk:true, rawStatus:state, progressAgeMs, networkProgressAgeMs, pendingAgeMs, activity:toolActivity
      }));
    }

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
    if (page.outputRegression?.active) {
      return emit(result('output-regressed','critical','Saved output is missing',page.outputRegression.detail || 'One or more richer assistant responses, links, files, code blocks, or media items are missing from the currently rendered page. Open Output Vault to compare and recover them.',{ recommendedAction:'compare-output', chips:[...chips,'durable copy preserved'], pageRisk:true, rawStatus, progressAgeMs, networkProgressAgeMs, pendingAgeMs, activity:toolActivity }));
    }

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

    if (running || networkActive) {
      if (cfg.toolWatchdogEnabled && toolActive) {
        const noProof = (!pending && progressAgeMs >= cfg.hardStallMs && !consensusActive) || networkSilent;
        if (!networkSilent && providerHeartbeatFresh) {
          return emit(result('tool-running','active',`Tool working · ${toolLabel}`,'The visible tool card is quiet, but a fresh provider/transcript heartbeat confirms the current turn is still advancing.',{ chips:[...chips,'provider heartbeat'], networkActive, rawStatus, progressAgeMs, networkProgressAgeMs, pendingAgeMs, projectRisk, activity:toolActivity }));
        }
        if (!pending && noProof && consensusUncertain && toolAgeMs >= cfg.hardStallMs) {
          return emit(result('uncertain-working','info','Activity uncertain · do not interrupt yet',`The page still claims this tool is running, but Constellation has no fresh provider, network, response, or tool heartbeat proving either progress or a stall. The stale running label alone is not enough to call the run stuck.`,{ chips:[...chips,'stale running claim','waiting for corroboration'], rawStatus, progressAgeMs, networkProgressAgeMs, pendingAgeMs, projectRisk, activity:toolActivity }));
        }
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
      if (progressAgeMs >= cfg.hardStallMs && consensusUncertain) {
        return emit(result('uncertain-working','info','Activity uncertain · do not interrupt yet',`The page still reports active work, but there is no fresh provider heartbeat, owned request, response growth, DOM growth, or tool progress to prove what is happening. Constellation will not turn one stale running label into a stall warning.`,{ chips:[...chips,'no corroborating heartbeat'], rawStatus, progressAgeMs, networkProgressAgeMs, pendingAgeMs, projectRisk }));
      }
      if (progressAgeMs >= cfg.deadStallMs && consensusActive) {
        return emit(result('dead','critical','Chat appears dead',`Multiple signals still identify this as the active current turn, but no conversation, tool, or provider-network progress has been observed for ${Math.round(progressAgeMs / 1000)} seconds.`,{ chips:[...chips,'active turn · no progress'], rawStatus, progressAgeMs, networkProgressAgeMs, pendingAgeMs, projectRisk }));
      }
      if (progressAgeMs >= cfg.hardStallMs && consensusActive) {
        return emit(result('stalled','danger','Chat stalled',`Multiple current-turn signals still say work is active, but no observable progress has been seen for ${Math.round(progressAgeMs / 1000)} seconds.`,{ chips:[...chips,'active turn · no progress'], rawStatus, progressAgeMs, networkProgressAgeMs, pendingAgeMs, projectRisk }));
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
  const api = Object.freeze({ VERSION, DEFAULTS, FAILURE_STATES, classifyProviderFailure, normalizeSettings, deriveCapacity, deriveHealth });
  globalThis.ProjectConstellationHealthCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
