(() => {
  'use strict';
  const VERSION = 4;
  const CHAT_STATUSES = Object.freeze(['idle','running','paused','waiting-user','blocked-approval','errored','stalled','auth-required','unavailable','archived']);
  const normalizeText = (value, max = 20000) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  const searchTerms = (value, limit = 160) => [...new Set(String(value ?? '').toLocaleLowerCase().normalize('NFKC').match(/[\p{L}\p{N}_-]{2,}/gu) || [])].slice(0, limit);
  const safeId = (value) => normalizeText(value, 500).replace(/[^a-zA-Z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '');
  function turnKey(chatId, messageId, role, ordinal) { return `${safeId(chatId)}:${safeId(messageId || `${role || 'unknown'}-${ordinal ?? 0}`)}`; }
  function fileKey(chatId, href, name) { return `${safeId(chatId)}:${safeId(href || name || 'file')}`.slice(0, 900); }
  function mergeRecord(oldRecord, next) {
    const now = Date.now();
    const createdAt = oldRecord?.createdAt || next?.createdAt || now;
    return { ...(oldRecord || {}), ...(next || {}), createdAt, updatedAt: Math.max(oldRecord?.updatedAt || 0, next?.updatedAt || 0, now) };
  }
  function classifyChatStatus(signals = {}) {
    const text = normalizeText(signals.text || '', 12000).toLowerCase();
    if (signals.authRequired || /(sign in|log in|login required|session expired)/i.test(text)) return 'auth-required';
    if (signals.unavailable || /(conversation.*(not found|unavailable|deleted)|page not found)/i.test(text)) return 'unavailable';
    if (signals.approval || /\b(allow|approve|permission|confirm)\b.{0,80}\b(drive|connector|access|continue|tool)\b/i.test(text)) return 'blocked-approval';
    if (signals.error || /(something went wrong|there was an error|try again|retry|failed to (generate|respond|send)|network error)/i.test(text)) return 'errored';
    if (signals.paused || /(continue generating|resume generation|resume response|continue response)/i.test(text)) return 'paused';
    if (signals.running || /(stop generating|stop response|generating|thinking|reasoning)/i.test(text)) return 'running';
    if (signals.waitingUser || /(waiting for you|your confirmation|choose an option)/i.test(text)) return 'waiting-user';
    return 'idle';
  }
  function makeSnapshot({ providers = [], chats = [], turns = [], files = [], projects = [], events = [], checkpoints = [], syncReceipts = [], catalogRuns = [], meta = {} } = {}) {
    const sortByUpdated = (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0);
    const statusCounts = Object.fromEntries(CHAT_STATUSES.map((status) => [status, chats.filter((chat) => chat.status === status).length]));
    return {
      schema: 'project-constellation', schemaVersion: VERSION, exportedAt: new Date().toISOString(), meta,
      summary: { providers: providers.length, projects: projects.length, chats: chats.length, turns: turns.length, files: files.length, events: events.length, checkpoints: checkpoints.length, statusCounts },
      providers: [...providers].sort(sortByUpdated), projects: [...projects].sort(sortByUpdated), chats: [...chats].sort(sortByUpdated),
      turns: [...turns].sort((a, b) => (a.chatId || '').localeCompare(b.chatId || '') || (a.ordinal || 0) - (b.ordinal || 0)),
      files: [...files].sort(sortByUpdated), events: [...events].sort(sortByUpdated).slice(0, 12000), checkpoints: [...checkpoints].sort(sortByUpdated).slice(0, 1000),
      syncReceipts: [...syncReceipts].sort(sortByUpdated).slice(0, 2000), catalogRuns: [...catalogRuns].sort(sortByUpdated).slice(0, 200)
    };
  }
  const api = Object.freeze({ VERSION, CHAT_STATUSES, normalizeText, searchTerms, safeId, turnKey, fileKey, mergeRecord, classifyChatStatus, makeSnapshot });
  globalThis.ProjectConstellationBrainCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
