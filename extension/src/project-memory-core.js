(() => {
  'use strict';

  const VERSION = 1;
  const ACTIVE = new Set(['running']);
  const ATTENTION = new Set(['paused','waiting-user','blocked-approval','delivery-timeout','connection-interrupted','response-interrupted','send-failed','refresh-required','rate-limited','errored','stalled','auth-required','unavailable']);
  const SECTION_KINDS = Object.freeze({
    decisions: new Set(['decision']),
    nextActions: new Set(['follow-up']),
    strategies: new Set(['recommendation','idea']),
    procedures: new Set(['command','code']),
    resources: new Set(['repository','package','mod','document','link','media','reference']),
    versions: new Set(['version'])
  });

  function text(value, max = 5000) { return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max); }
  function hashString(input) { let hash = 2166136261; for (const ch of String(input || '')) { hash ^= ch.charCodeAt(0); hash = Math.imul(hash, 16777619); } return (hash >>> 0).toString(16).padStart(8, '0'); }
  function bucket(chat = {}) {
    if (chat.organizedArchived) return 'archived';
    const status = String(chat.status || 'idle');
    if (ACTIVE.has(status)) return 'active';
    if (ATTENTION.has(status)) return 'attention';
    return 'completed';
  }
  function disposition(item = {}) { return ['ignored','superseded'].includes(item.memoryDisposition) ? item.memoryDisposition : 'active'; }
  function itemScore(item = {}, now = Date.now()) {
    const ageDays = Math.max(0, (now - Number(item.updatedAt || 0)) / 86400000);
    const recency = Math.max(0, 1 - Math.min(ageDays, 180) / 180);
    const kindWeight = item.kind === 'decision' ? 1.35 : item.kind === 'follow-up' ? 1.3 : item.kind === 'repository' || item.kind === 'document' ? 1.12 : item.kind === 'version' ? 1.08 : 1;
    const roleWeight = item.sourceRole === 'user' ? 1.1 : 1;
    const pinWeight = item.memoryPinned ? 1.8 : 1;
    return Number(item.confidence ?? 0.8) * kindWeight * roleWeight * pinWeight * (0.72 + recency * 0.28);
  }
  function memoryEntry(item = {}, chats = new Map(), now = Date.now()) {
    const chat = chats.get(item.chatId) || {};
    return {
      id:item.id, kind:item.kind || '', title:text(item.title || item.text, 260), text:text(item.text || item.title, 900), url:item.url || '',
      confidence:Number(item.confidence ?? 0.8), disposition:disposition(item), pinned:Boolean(item.memoryPinned), score:itemScore(item, now), updatedAt:Number(item.updatedAt || 0), memoryUpdatedAt:Number(item.memoryUpdatedAt || 0),
      source:{ chatId:item.chatId || '', chatTitle:chat.title || '', chatUrl:chat.url || item.sourceUrl || '', turnId:item.sourceTurnId || '', role:item.sourceRole || '', providerId:item.providerId || chat.providerId || '' }
    };
  }
  function section(items, allowedKinds, chats, limit, now) {
    const seen = new Set();
    const rows = [];
    for (const item of items) {
      if (!allowedKinds.has(item.kind) || disposition(item) !== 'active') continue;
      const key = String(item.canonicalKey || `${item.kind}:${text(item.title || item.text, 180).toLowerCase()}`);
      if (seen.has(key)) continue;
      seen.add(key); rows.push(memoryEntry(item, chats, now));
    }
    rows.sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.score-a.score||b.updatedAt-a.updatedAt);
    return rows.slice(0, limit);
  }
  function compileProjectBrain({ project = {}, chats = [], items = [], files = [], now = Date.now() } = {}) {
    const chatMap = new Map(chats.map((chat)=>[chat.id,chat]));
    const counts = { active:0, attention:0, completed:0, archived:0, total:chats.length };
    for (const chat of chats) counts[bucket(chat)] += 1;
    const sections = {
      decisions: section(items, SECTION_KINDS.decisions, chatMap, 10, now),
      nextActions: section(items, SECTION_KINDS.nextActions, chatMap, 12, now),
      strategies: section(items, SECTION_KINDS.strategies, chatMap, 10, now),
      procedures: section(items, SECTION_KINDS.procedures, chatMap, 8, now),
      resources: section(items, SECTION_KINDS.resources, chatMap, 12, now),
      versions: section(items, SECTION_KINDS.versions, chatMap, 8, now)
    };
    const workingPool = [...sections.nextActions, ...sections.decisions, ...sections.strategies, ...sections.resources]
      .sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.score-a.score||b.updatedAt-a.updatedAt);
    const workingSet = [...new Map(workingPool.map((row)=>[row.id,row])).values()].slice(0, 12);
    const activeChats = chats.filter((chat)=>['active','attention'].includes(bucket(chat))).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0)).slice(0,16).map((chat)=>({
      id:chat.id,title:text(chat.title || 'Untitled chat',180),url:chat.url || '',providerId:chat.providerId || '',status:chat.status || 'idle',bucket:bucket(chat),updatedAt:Number(chat.updatedAt || 0),detail:text(chat.statusDetail || chat.healthDetail || '',300)
    }));
    const history=items.filter((item)=>disposition(item)!=='active').map((item)=>memoryEntry(item,chatMap,now)).sort((a,b)=>(b.memoryUpdatedAt||b.updatedAt)-(a.memoryUpdatedAt||a.updatedAt)).slice(0,12);
    const ignoredCount = items.filter((item)=>disposition(item)==='ignored').length;
    const supersededCount = items.filter((item)=>disposition(item)==='superseded').length;
    const pinnedCount = items.filter((item)=>item.memoryPinned && disposition(item)==='active').length;
    const latestArtifact = [...files].sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0))[0] || null;
    const fingerprint = hashString(JSON.stringify({
      v:VERSION, projectId:project.id || '',
      chats:chats.map((c)=>[c.id,c.status,Boolean(c.organizedArchived),c.updatedAt,c.workspaceProjectId]).sort(),
      items:items.map((i)=>[i.id,i.updatedAt,i.memoryDisposition || '',Boolean(i.memoryPinned),i.fingerprint || '']).sort(),
      files:files.map((f)=>[f.id,f.updatedAt]).sort()
    }));
    return {
      schema:'project-constellation-project-brain', version:VERSION, fingerprint, projectId:project.id || '', projectName:project.name || 'Project', compiledAt:now,
      counts, coverage:{ knowledgeItems:items.length, sourceChats:new Set(items.map((i)=>i.chatId).filter(Boolean)).size, files:files.length, ignored:ignoredCount, superseded:supersededCount, pinned:pinnedCount },
      workingSet, sections, activeChats, history,
      latestArtifact:latestArtifact ? { id:latestArtifact.id, name:latestArtifact.name || 'Artifact', url:latestArtifact.externalUrl || latestArtifact.href || '', chatId:latestArtifact.chatId || '', updatedAt:Number(latestArtifact.updatedAt || 0) } : null
    };
  }

  globalThis.ProjectConstellationProjectMemoryCore = Object.freeze({ VERSION, ACTIVE, ATTENTION, bucket, disposition, itemScore, compileProjectBrain });
  if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.ProjectConstellationProjectMemoryCore;
})();
