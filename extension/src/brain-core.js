(() => {
  'use strict';
  const VERSION = 7;
  const CHAT_STATUSES = Object.freeze(['idle','running','paused','waiting-user','blocked-approval','refresh-required','rate-limited','errored','stalled','auth-required','unavailable','archived']);
  const normalizeText = (value, max = 20000) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  function hashString(value) {
    let hash = 2166136261;
    for (const character of String(value ?? '')) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619); }
    return (hash >>> 0).toString(36);
  }
  const searchTerms = (value, limit = 160) => [...new Set(String(value ?? '').toLocaleLowerCase().normalize('NFKC').match(/[\p{L}\p{N}_-]{2,}/gu) || [])].slice(0, limit);
  const safeId = (value) => normalizeText(value, 500).replace(/[^a-zA-Z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '');
  function turnKey(chatId, messageId, role, ordinal) { return `${safeId(chatId)}:${safeId(messageId || `${role || 'unknown'}-${ordinal ?? 0}`)}`; }
  function fileKey(chatId, href, name) { return `${safeId(chatId)}:${safeId(href || name || 'file')}`.slice(0, 900); }
  function mergeRecord(oldRecord, next) {
    const now = Date.now();
    const createdAt = oldRecord?.createdAt || next?.createdAt || now;
    return { ...(oldRecord || {}), ...(next || {}), createdAt, updatedAt: Math.max(oldRecord?.updatedAt || 0, next?.updatedAt || 0, now) };
  }
  function turnFingerprint(record = {}) {
    const links = (Array.isArray(record.links) ? record.links : []).slice(0, 64).map((item) => [String(item?.href || item?.url || ''), normalizeText(item?.text || '', 260)]);
    const code = (Array.isArray(record.codeBlocks) ? record.codeBlocks : []).slice(0, 24).map((item) => [String(item?.language || ''), String(item?.text || '').slice(0, 32000)]);
    const assets = (Array.isArray(record.assets) ? record.assets : []).slice(0, 32).map((item) => [String(item?.kind || ''), String(item?.url || item?.href || ''), normalizeText(item?.alt || item?.name || '', 320)]);
    const payload = JSON.stringify([String(record.role || ''), String(record.text || ''), links, code, assets]);
    return `${hashString(`output:v1:${payload}`)}-${hashString(`${payload}:constellation`)}-${payload.length.toString(36)}`;
  }
  function turnRichnessScore(record = {}) {
    const text = String(record.text || '');
    const links = Array.isArray(record.links) ? record.links.length : 0;
    const assets = Array.isArray(record.assets) ? record.assets.length : 0;
    const code = Array.isArray(record.codeBlocks) ? record.codeBlocks : [];
    const codeCharacters = code.reduce((sum, item) => sum + String(item?.text || '').length, 0);
    const toolMarkers = (text.match(/(?:called tool|calling tool|searched \d+ websites?|used [^\n]{0,80} skill|verified [^\n]{0,120}|updated [^\n]{0,120}|built [^\n]{0,120})/gi) || []).length;
    const toolHeavy = toolMarkers >= 4 && toolMarkers * 22 >= Math.max(1, text.length * 0.16);
    const base = toolHeavy ? Math.round(text.length * 0.42) : text.length;
    return Math.max(0, Math.round(base + links * 700 + assets * 1400 + code.length * 420 + codeCharacters * 0.72));
  }
  function outputObservationFingerprint(turns = []) {
    const payload = (Array.isArray(turns) ? turns : []).map((turn) => `${turn?.id || ''}:${turn?.fingerprint || turnFingerprint(turn)}:${Number(turn?.ordinal || 0)}`).join('|');
    return `${hashString(`tail:v1:${payload}`)}-${hashString(`${payload}:saved`)}-${payload.length.toString(36)}`;
  }
  function classifyChatStatus(signals = {}) {
    const text = normalizeText(signals.text || '', 12000).toLowerCase();
    if (signals.authRequired || /(sign in|log in|login required|session expired)/i.test(text)) return 'auth-required';
    if (signals.unavailable || /(conversation.*(not found|unavailable|deleted)|page not found)/i.test(text)) return 'unavailable';
    if (signals.approval || /\b(allow|approve|permission|confirm)\b.{0,80}\b(drive|connector|access|continue|tool)\b/i.test(text)) return 'blocked-approval';
    if (signals.refreshRequired || /(message delivery timed out|connection interrupted|connection (?:was )?lost|network connection (?:was )?lost|reconnect(?:ion)? failed|failed to deliver message)/i.test(text)) return 'refresh-required';
    if (signals.rateLimited || /(too many requests|rate limit(?:ed| exceeded)?|http\s*429|error\s*429|status\s*429)/i.test(text)) return 'rate-limited';
    if (signals.error || /(something went wrong|there was an error|try again|retry|failed to (generate|respond|send)|network error)/i.test(text)) return 'errored';
    if (signals.paused || /(continue generating|resume generation|resume response|continue response)/i.test(text)) return 'paused';
    if (signals.running || /(stop generating|stop response|generating|thinking|reasoning)/i.test(text)) return 'running';
    if (signals.waitingUser || /(waiting for you|your confirmation|choose an option)/i.test(text)) return 'waiting-user';
    return 'idle';
  }
  function makeSnapshot({ providers = [], chats = [], turns = [], turnRevisions = [], outputSnapshots = [], files = [], projects = [], events = [], checkpoints = [], syncReceipts = [], catalogRuns = [], knowledgeItems = [], knowledgeSources = [], projectContinuity = [], meta = {} } = {}) {
    const sortByUpdated = (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0);
    const statusCounts = Object.fromEntries(CHAT_STATUSES.map((status) => [status, chats.filter((chat) => chat.status === status).length]));
    return {
      schema: 'project-constellation', schemaVersion: VERSION, exportedAt: new Date().toISOString(), meta,
      summary: { providers: providers.length, projects: projects.length, chats: chats.length, turns: turns.length, turnRevisions: turnRevisions.length, outputSnapshots: outputSnapshots.length, files: files.length, knowledgeItems: knowledgeItems.length, continuityProjects: projectContinuity.length, events: events.length, checkpoints: checkpoints.length, statusCounts },
      providers: [...providers].sort(sortByUpdated), projects: [...projects].sort(sortByUpdated), chats: [...chats].sort(sortByUpdated),
      turns: [...turns].sort((a, b) => (a.chatId || '').localeCompare(b.chatId || '') || (a.ordinal || 0) - (b.ordinal || 0)),
      turnRevisions: [...turnRevisions].sort(sortByUpdated), outputSnapshots: [...outputSnapshots].sort(sortByUpdated),
      files: [...files].sort(sortByUpdated), knowledgeItems: [...knowledgeItems].sort(sortByUpdated), knowledgeSources: [...knowledgeSources].sort(sortByUpdated), projectContinuity: [...projectContinuity].sort(sortByUpdated),
      events: [...events].sort(sortByUpdated).slice(0, 12000), checkpoints: [...checkpoints].sort(sortByUpdated).slice(0, 1000),
      syncReceipts: [...syncReceipts].sort(sortByUpdated).slice(0, 2000), catalogRuns: [...catalogRuns].sort(sortByUpdated).slice(0, 200)
    };
  }
  const api = Object.freeze({ VERSION, CHAT_STATUSES, normalizeText, hashString, searchTerms, safeId, turnKey, fileKey, mergeRecord, turnFingerprint, turnRichnessScore, outputObservationFingerprint, classifyChatStatus, makeSnapshot });
  globalThis.ProjectConstellationBrainCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
