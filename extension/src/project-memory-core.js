(() => {
  'use strict';

  const VERSION = 1;
  const ACTIVE = new Set(['running']);
  const ATTENTION = new Set(['paused','waiting-user','blocked-approval','delivery-timeout','connection-interrupted','response-interrupted','send-failed','refresh-required','rate-limited','errored','stalled','auth-required','unavailable']);
  const FOCUS_STOP = new Set(['the','and','for','with','from','this','that','chat','project','help','make','into','your','have','what','how','can','use','using','new','fix','update','build','create','please','need','want','about','more','like','just','all','its','are','was','you','me','my','our','not','but','work','working','continue','latest']);
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

  function focusTerms(chat = {}, limit = 24) {
    const source=text(`${chat.title||''} ${chat.note||''} ${chat.lastUserExcerpt||''} ${chat.lastExcerpt||''}`,2600).toLocaleLowerCase();
    const out=[]; const seen=new Set();
    for(const raw of source.match(/[\p{L}\p{N}][\p{L}\p{N}._+#-]{1,47}/gu)||[]){const token=raw.replace(/^[-_.]+|[-_.]+$/g,'');if(!token||token.length<3||FOCUS_STOP.has(token)||/^\d+$/.test(token)||seen.has(token))continue;seen.add(token);out.push(token);if(out.length>=limit)break;}
    return out;
  }
  function coordination(chats = []) {
    const working=chats.filter((chat)=>['active','attention'].includes(bucket(chat))).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0)).slice(0,18);
    const vectors=new Map(working.map((chat)=>[chat.id,new Set(focusTerms(chat))]));
    const pairs=[]; const termCounts=new Map();
    for(const set of vectors.values())for(const token of set)termCounts.set(token,(termCounts.get(token)||0)+1);
    for(let i=0;i<working.length;i++)for(let j=i+1;j<working.length;j++){
      const a=working[i],b=working[j],ta=vectors.get(a.id),tb=vectors.get(b.id);if(!ta?.size||!tb?.size)continue;
      const shared=[...ta].filter((token)=>tb.has(token)); const denominator=Math.max(1,Math.min(ta.size,tb.size)); const overlap=shared.length/denominator;
      const sameTitle=text(a.title,180).toLocaleLowerCase()===text(b.title,180).toLocaleLowerCase();
      if(!sameTitle && (shared.length<2 || overlap<.32))continue;
      const aBucket=bucket(a),bBucket=bucket(b); const kind=aBucket==='active'&&bBucket==='active'?'parallel-overlap':aBucket==='attention'||bBucket==='attention'?'handoff-risk':'related-work';
      pairs.push({id:`${a.id}|${b.id}`,kind,score:Number(Math.min(1,sameTitle?1:overlap).toFixed(3)),sharedTerms:shared.slice(0,6),left:{id:a.id,title:text(a.title||'Untitled chat',180),url:a.url||'',bucket:aBucket,updatedAt:Number(a.updatedAt||0)},right:{id:b.id,title:text(b.title||'Untitled chat',180),url:b.url||'',bucket:bBucket,updatedAt:Number(b.updatedAt||0)}});
    }
    pairs.sort((a,b)=>b.score-a.score||Math.max(b.left.updatedAt,b.right.updatedAt)-Math.max(a.left.updatedAt,a.right.updatedAt));
    const sharedFocus=[...termCounts.entries()].filter(([,count])=>count>1).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,10).map(([term,count])=>({term,count}));
    return {workingChats:working.length,pairs:pairs.slice(0,12),sharedFocus};
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
      workingSet, sections, activeChats, coordination:coordination(chats), history,
      latestArtifact:latestArtifact ? { id:latestArtifact.id, name:latestArtifact.name || 'Artifact', url:latestArtifact.externalUrl || latestArtifact.href || '', chatId:latestArtifact.chatId || '', updatedAt:Number(latestArtifact.updatedAt || 0) } : null
    };
  }

  globalThis.ProjectConstellationProjectMemoryCore = Object.freeze({ VERSION, ACTIVE, ATTENTION, bucket, disposition, itemScore, focusTerms, coordination, compileProjectBrain });
  if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.ProjectConstellationProjectMemoryCore;
})();
