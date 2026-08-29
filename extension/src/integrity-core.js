(() => {
  'use strict';

  const VERSION = 2;
  const STOP = new Set('a an and are as at be been being by chat chats complete completed did do does done for from has have i in into is it its latest new of on or our project projects support supported supports that the this to user verified version was we with works working'.split(' '));

  const normalize = (value, max = 12000) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  const tokens = (value) => [...new Set(normalize(value).toLowerCase().normalize('NFKC').match(/[a-z0-9][a-z0-9._-]{1,}/g) || [])]
    .filter((token) => !STOP.has(token) && token.length > 1);

  function parseVersion(value, { requireContext = false } = {}) {
    const text = normalize(value, 4000);
    if (!text) return null;
    const re = /(?:\b(?:version|release|build)\s*[:#=-]?\s*|\bv(?=\d))?(\d{1,4}\.\d{1,4}(?:\.\d{1,4})?)/gi;
    const matches = [];
    let match;
    while ((match = re.exec(text))) {
      const raw = match[0];
      const version = match[1];
      const before = text.slice(Math.max(0, match.index - 30), match.index).toLowerCase();
      const contextual = /^v/i.test(raw.trim()) || /(?:version|release|build)\s*[:#=-]?\s*$/i.test(before) || /(?:^|[-_])v\d/i.test(text.slice(Math.max(0, match.index - 3), match.index + 2));
      if (requireContext && !contextual) continue;
      const parts = version.split(/[.+-]/)[0].split('.').map((part) => Number(part));
      if (parts.some((part) => !Number.isFinite(part))) continue;
      matches.push({ raw: version, version, parts, index: match.index, contextual });
    }
    return matches[0] || null;
  }

  function compareVersions(a, b) {
    const av = typeof a === 'string' ? parseVersion(`v${a}`) : a;
    const bv = typeof b === 'string' ? parseVersion(`v${b}`) : b;
    if (!av && !bv) return 0;
    if (!av) return -1;
    if (!bv) return 1;
    const len = Math.max(av.parts.length, bv.parts.length);
    for (let i = 0; i < len; i += 1) {
      const delta = (av.parts[i] || 0) - (bv.parts[i] || 0);
      if (delta) return delta < 0 ? -1 : 1;
    }
    return String(av.version).localeCompare(String(bv.version), undefined, { numeric: true, sensitivity: 'base' });
  }

  function projectTokens(project = {}) {
    return tokens(`${project.name || ''} ${(project.tags || []).join(' ')}`).filter((token) => token.length >= 3).slice(0, 16);
  }

  function projectScopedVersion(value, project = {}, { artifact = false } = {}) {
    const text = normalize(value, 4000);
    const pTokens = projectTokens(project);
    const lower = text.toLowerCase();
    const linked = !pTokens.length || pTokens.some((token) => lower.includes(token));
    const parsed = parseVersion(text, { requireContext: !artifact && !linked });
    if (!parsed) return null;
    if (artifact && pTokens.length && !linked && !/(checkpoint|release|build|source|artifact|package)/i.test(text)) return null;
    return parsed;
  }

  function normalizeArtifactStem(name = '') {
    return normalize(name, 500).toLowerCase()
      .replace(/\.(zip|jar|7z|rar|tar|gz|tgz|exe|msi|dmg|pkg|json|md|txt)$/i, '')
      .replace(/(?:^|[-_.\s])v?\d{1,4}\.\d{1,4}(?:\.\d{1,4})?(?:[-+][0-9a-z.-]+)?/ig, ' ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 180);
  }

  const POSITIVE_RE = /\b(implemented|added|fixed|working|works|verified|passed|supported|supports|completed|complete|ready)\b/i;
  const NEGATIVE_RE = /\b(regressed|regression|broken|broke|failing|failed|missing|removed|lost|corrupt(?:ed|ion)?|no longer works|stopped working|doesn't work|does not work|not working)\b/i;
  const FOLLOWUP_RE = /\b(todo|remaining|still need(?:s)?|needs? to|next step|follow[- ]?up|blocked on|waiting on|not yet|unfinished|pending)\b/i;
  const LIVE_HEALTH_STALE_MS = 15 * 60 * 1000;
  const EXECUTION_ACTIVE_STATES = new Set(['healthy','running','tool-running','quiet-working','tool-quiet','uncertain-working','waiting-user']);
  const EXECUTION_CRITICAL_STATES = new Set(['delivery-timeout','connection-interrupted','response-interrupted','send-failed','refresh-required','blocked-approval','dead','tool-dead','capacity-reached','degraded','stale-page']);
  const EXECUTION_WARNING_STATES = new Set(['rate-limited','errored','auth-required','unavailable','stalled','request-stalled','tool-stalled','capacity-watch','capacity-handoff']);

  function liveHealthFresh(chat = {}, now = Date.now()) {
    const observedAt = Number(chat.liveHealthUpdatedAt || 0);
    return Boolean(chat.liveHealthState && observedAt && now - observedAt <= LIVE_HEALTH_STALE_MS);
  }

  function executionState(chat = {}, now = Date.now()) {
    return String(liveHealthFresh(chat, now) ? chat.liveHealthState : (chat.status || 'idle')).toLowerCase();
  }

  function executionDetail(chat = {}, now = Date.now()) {
    return normalize(liveHealthFresh(chat, now) ? (chat.liveHealthDetail || chat.statusDetail || '') : (chat.statusDetail || chat.liveHealthDetail || ''), 1200);
  }

  function sentenceSignals(text, updatedAt = 0, sourceId = '') {
    const sentences = String(text || '').split(/(?<=[.!?\n])\s+/).map((part) => normalize(part, 600)).filter(Boolean).slice(0, 500);
    const out = [];
    for (const sentence of sentences) {
      const positive = POSITIVE_RE.test(sentence);
      const negative = NEGATIVE_RE.test(sentence);
      const followup = FOLLOWUP_RE.test(sentence);
      if (!positive && !negative && !followup) continue;
      const keyTokens = tokens(sentence).filter((token) => !/^(implemented|added|fixed|working|verified|passed|supported|completed|complete|ready|regressed|regression|broken|broke|failing|failed|missing|removed|lost|corrupted|corruption|todo|remaining|pending)$/.test(token)).slice(0, 18);
      if (!keyTokens.length) continue;
      out.push({ sentence, tokens: keyTokens, positive, negative, followup, updatedAt, sourceId });
    }
    return out;
  }

  function overlapScore(a = [], b = []) {
    const A = new Set(a), B = new Set(b);
    if (!A.size || !B.size) return 0;
    let intersection = 0;
    for (const token of A) if (B.has(token)) intersection += 1;
    return intersection / Math.min(A.size, B.size);
  }

  function analyzeProject({ project = {}, chats = [], files = [], turns = [], previousBaseline = null, now = Date.now() } = {}) {
    const findings = [];
    const versions = [];
    const addVersion = (parsed, sourceType, sourceId, updatedAt, label) => { if (parsed) versions.push({ ...parsed, sourceType, sourceId, updatedAt: Number(updatedAt || 0), label: normalize(label, 400) }); };

    if (project.version) addVersion(parseVersion(`v${project.version}`), 'project', project.id, project.updatedAt, project.name);
    for (const file of files) addVersion(projectScopedVersion(`${file.name || ''} ${file.href || file.externalUrl || ''}`, project, { artifact: true }), 'file', file.id, file.updatedAt, file.name);
    for (const chat of chats) addVersion(projectScopedVersion(`${chat.title || ''} ${chat.lastExcerpt || ''}`, project), 'chat', chat.id, chat.updatedAt, chat.title);
    versions.sort((a, b) => compareVersions(b, a) || (b.updatedAt || 0) - (a.updatedAt || 0));
    const latest = versions[0] || null;

    if (latest && previousBaseline?.latestVersion && compareVersions(latest.version, previousBaseline.latestVersion) < 0) {
      findings.push({
        type: 'project-version-rollback', severity: 'critical', projectId: project.id,
        title: `Project appears to have rolled back from v${previousBaseline.latestVersion} to v${latest.version}`,
        detail: 'The newest project state visible to Constellation is older than the previously verified project baseline. Check for a stale chat, overwritten artifact, deleted release, or corrupted restore before continuing work.',
        evidence: { previousVersion: previousBaseline.latestVersion, currentVersion: latest.version, previousSource: previousBaseline.latestVersionSource || '', currentSource: latest.label || latest.sourceId || '' }, updatedAt: now
      });
    }

    if (latest) {
      for (const chat of chats) {
        const state = executionState(chat, now);
        if (['archived','unavailable'].includes(state)) continue;
        const cv = projectScopedVersion(`${chat.title || ''} ${chat.lastExcerpt || ''}`, project);
        if (!cv || compareVersions(cv, latest) >= 0) continue;
        findings.push({
          type: 'old-version-chat', severity: (EXECUTION_ACTIVE_STATES.has(state) || EXECUTION_CRITICAL_STATES.has(state) || ['paused','stalled','request-stalled','tool-stalled'].includes(state)) ? 'critical' : 'warning',
          projectId: project.id, chatId: chat.id, title: `Chat appears to be on v${cv.version} while project is at v${latest.version}`,
          detail: `${chat.title || 'Untitled chat'} may be working from an older project state.`, evidence: { chatVersion: cv.version, latestVersion: latest.version, latestSource: latest.label || latest.sourceId }, updatedAt: now
        });
      }
    }

    const artifactGroups = new Map();
    for (const file of files) {
      const version = projectScopedVersion(`${file.name || ''} ${file.href || file.externalUrl || ''}`, project, { artifact: true });
      const stem = normalizeArtifactStem(file.name || file.href || file.externalUrl || 'artifact');
      if (!version || !stem) continue;
      const key = `${stem}@${version.version}`;
      const list = artifactGroups.get(key) || [];
      list.push(file); artifactGroups.set(key, list);
    }
    for (const [key, list] of artifactGroups) {
      if (list.length < 2) continue;
      const hashes = new Set(list.map((file) => String(file.sha256 || file.hash || '').toLowerCase()).filter(Boolean));
      const sizes = new Set(list.map((file) => Number(file.size || file.sizeBytes || 0)).filter((size) => size > 0));
      if (hashes.size > 1 || (!hashes.size && sizes.size > 1 && /checkpoint|source|release|build|package/.test(key))) {
        findings.push({
          type: hashes.size > 1 ? 'artifact-hash-conflict' : 'artifact-size-conflict', severity: hashes.size > 1 ? 'critical' : 'warning', projectId: project.id,
          title: `Conflicting artifacts detected for ${key.replace('@', ' v')}`,
          detail: hashes.size > 1 ? 'The same project artifact/version has multiple SHA-256 values.' : 'The same release/checkpoint identity has conflicting byte sizes.',
          fileIds: list.map((file) => file.id), evidence: { hashes: [...hashes], sizes: [...sizes] }, updatedAt: now
        });
      }
    }

    const chatById = new Map(chats.map((chat) => [chat.id, chat]));
    const signals = [];
    const orderedTurns = [...turns].sort((a,b)=>(a.updatedAt||0)-(b.updatedAt||0)||(a.ordinal||0)-(b.ordinal||0));
    for (const turn of orderedTurns) signals.push(...sentenceSignals(turn.text || '', turn.updatedAt, turn.chatId || turn.id));
    const positives = [];
    for (const signal of signals) {
      if (signal.positive && !signal.negative) positives.push(signal);
      if (!signal.negative) continue;
      const match = [...positives].reverse().find((positive) => positive.updatedAt <= signal.updatedAt && overlapScore(positive.tokens, signal.tokens) >= 0.55);
      if (!match) continue;
      findings.push({
        type: 'feature-regression-signal', severity: 'warning', projectId: project.id, chatId: signal.sourceId,
        title: 'Possible feature regression detected', detail: signal.sentence,
        evidence: { previousWorkingClaim: match.sentence, regressionSignal: signal.sentence, overlap: overlapScore(match.tokens, signal.tokens) }, updatedAt: now
      });
    }

    const turnsByChat = new Map();
    for (const turn of orderedTurns) { const list = turnsByChat.get(turn.chatId) || []; list.push(turn); turnsByChat.set(turn.chatId, list); }
    for (const [chatId, list] of turnsByChat) {
      const chat = chatById.get(chatId); if (!chat || !list.length) continue;
      const state = executionState(chat, now);
      if (['archived','unavailable'].includes(state)) continue;
      const last = list.at(-1);
      if (last?.role === 'user' && !EXECUTION_ACTIVE_STATES.has(state)) {
        findings.push({ type: 'unanswered-chat', severity: 'warning', projectId: project.id, chatId, title: 'Chat may need a follow-up', detail: `${chat.title || 'Untitled chat'} ends with a user turn and no later assistant turn was captured.`, updatedAt: now });
      } else if (last?.role === 'assistant' && FOLLOWUP_RE.test(last.text || '')) {
        findings.push({ type: 'follow-up-needed', severity: 'info', projectId: project.id, chatId, title: 'Assistant left follow-up work', detail: normalize(last.text, 320), updatedAt: now });
      }
    }

    for (const chat of chats) {
      const state = executionState(chat, now);
      const detail = executionDetail(chat, now);
      if (['delivery-timeout','connection-interrupted','response-interrupted','send-failed'].includes(state)) {
        const titles = { 'delivery-timeout':'Message delivery timed out', 'connection-interrupted':'Chat connection interrupted', 'response-interrupted':'Response interrupted', 'send-failed':'Message was not sent' };
        const recovery = chat.failureRetryAvailable ? `${chat.failureRetryLabel || 'Retry'} is available as an explicit user action in the already-open tab.` : 'No native retry is currently available; recovery remains manual.';
        findings.push({ type:`chat-${state}`, severity:'critical', projectId:project.id, chatId:chat.id, title:titles[state], detail:`${detail || 'The provider interrupted the current turn.'} ${recovery} Constellation never retries automatically.`, updatedAt:now });
      }
      else if (state === 'refresh-required') findings.push({ type: 'refresh-required', severity: 'critical', projectId: project.id, chatId: chat.id, title: 'Chat requires a browser refresh', detail: `${detail || 'The provider explicitly requires a page refresh.'} Recovery policy: manual browser refresh.`, updatedAt: now });
      else if (state === 'rate-limited') findings.push({ type: 'chat-rate-limited', severity: 'warning', projectId: project.id, chatId: chat.id, title: 'Chat is provider rate limited', detail: `${detail || 'Too many requests detected.'} Constellation will wait for the provider cooldown instead of retrying aggressively.`, updatedAt: now });
      else if (state === 'capacity-watch') findings.push({ type: 'chat-capacity-watch', severity: 'warning', projectId: project.id, chatId: chat.id, title: 'Conversation runway is getting low', detail: detail || 'Capacity Guard recommends preparing a continuation before provider limits become urgent.', updatedAt: now });
      else if (state === 'capacity-handoff') findings.push({ type: 'chat-capacity-handoff', severity: 'warning', projectId: project.id, chatId: chat.id, title: 'Conversation handoff is recommended now', detail: detail || 'Capacity Guard recommends creating a continuation checkpoint now.', updatedAt: now });
      else if (state === 'capacity-reached') findings.push({ type: 'chat-capacity-reached', severity: 'critical', projectId: project.id, chatId: chat.id, title: 'Conversation capacity was reached', detail: detail || 'The provider reports that this conversation can no longer continue normally.', updatedAt: now });
      else if (['dead','tool-dead','degraded','stale-page'].includes(state)) findings.push({ type: `chat-${state}`, severity: 'critical', projectId: project.id, chatId: chat.id, title: `Chat health is ${state.replace(/-/g,' ')}`, detail: detail || chat.title || 'The current run has corroborated critical health evidence.', updatedAt: now });
      else if (['blocked-approval','stalled','request-stalled','tool-stalled','errored','auth-required','unavailable'].includes(state)) findings.push({ type: `chat-${state}`, severity: state === 'blocked-approval' ? 'critical' : 'warning', projectId: project.id, chatId: chat.id, title: `Chat is ${state.replace(/-/g,' ')}`, detail: detail || chat.title || 'Chat needs attention.', updatedAt: now });
    }

    const deduped = [...new Map(findings.map((finding) => [`${finding.type}:${finding.chatId || ''}:${(finding.fileIds || []).join(',')}:${finding.title}`, finding])).values()];
    const severityRank = { critical: 0, warning: 1, info: 2 };
    deduped.sort((a,b)=>(severityRank[a.severity]??9)-(severityRank[b.severity]??9)||(b.updatedAt||0)-(a.updatedAt||0));
    return {
      baseline: { projectId: project.id, latestVersion: latest?.version || '', latestVersionSource: latest?.label || latest?.sourceId || '', chatCount: chats.length, fileCount: files.length, turnCount: turns.length, analyzedAt: now },
      findings: deduped
    };
  }

  const api = Object.freeze({ VERSION, parseVersion, compareVersions, projectScopedVersion, normalizeArtifactStem, sentenceSignals, overlapScore, liveHealthFresh, executionState, analyzeProject });
  globalThis.ProjectConstellationIntegrityCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
