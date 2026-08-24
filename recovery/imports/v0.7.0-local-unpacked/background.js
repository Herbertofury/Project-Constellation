import './src/brain-core.js';
import './src/provider-core.js';

const brain = globalThis.ProjectConstellationBrainCore;
const providers = globalThis.ProjectConstellationProviders;

const DB_NAME = 'project-constellation-brain';
const DB_VERSION = 5;
const SETTINGS_KEY = 'projectConstellationBrainSettings';
const GITHUB_SECRET_KEY = 'projectConstellationGithubSecret';
const CATALOG_STATE_KEY = 'projectConstellationCatalogState';
const FULL_CAPTURE_STATE_KEY = 'projectConstellationFullCaptureState';
const DIRTY_KEY = 'projectConstellationDriveDirtyAt';
const EVENT_LIMIT = 12000;
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_ORIGIN = 'https://www.googleapis.com/*';
const DRIVE_SYNC_ALARM = 'project-constellation-drive-sync';
const CATALOG_ALARM = 'project-constellation-catalog-step';
const FULL_CAPTURE_ALARM = 'project-constellation-full-capture-step';
const STALL_ALARM = 'project-constellation-stall-watch';
const CATALOG_MAINTENANCE_ALARM = 'project-constellation-catalog-maintenance';

const defaultBrainSettings = Object.freeze({
  captureEnabled: true,
  deepDownloadTracking: false,
  stallThresholdMs: 120000,
  catalog: { autoSweep: true, idleOnly: true, intervalHours: 24, lastAutoSweepAt: 0, providerIds: [] },
  github: { owner: '', repo: '', branch: 'main', path: '.project-constellation/constellation.json', autoSync: false, lastSyncAt: 0 },
  drive: {
    autoSync: true,
    folderName: 'Project Constellation',
    snapshotName: 'Project-Constellation-Latest.json.gz',
    journalName: 'Project-Constellation-Journal.json.gz',
    indexName: 'Project-Constellation-Index.json',
    minSyncIntervalMs: 120000,
    fullSnapshotIntervalMs: 86400000,
    debounceMs: 15000,
    folderId: '', snapshotFileId: '', journalFileId: '', indexFileId: '',
    snapshotSha256: '', snapshotSize: 0, snapshotEncoding: 'gzip', journalSha256: '', journalSize: 0,
    lastSyncAt: 0, lastFullSyncAt: 0, lastRestoreAt: 0, lastRoundtripVerifyAt: 0, lastStatus: 'not-connected', lastError: ''
  }
});

const STORE_DEFS = Object.freeze({
  providers: [['updatedAt','updatedAt']],
  groups: [['updatedAt','updatedAt'],['parentId','parentId'],['pinned','pinned']],
  projects: [['updatedAt','updatedAt'],['groupId','groupId'],['sourceType','sourceType'],['pinned','pinned'],['archived','archived']],
  smartCollections: [['updatedAt','updatedAt'],['groupId','groupId'],['pinned','pinned']],
  chats: [['updatedAt','updatedAt'],['projectId','projectId'],['workspaceProjectId','workspaceProjectId'],['providerId','providerId'],['status','status'],['workspaceProjectStatus',['workspaceProjectId','status']],['pinned','pinned'],['favorite','favorite'],['organizedArchived','organizedArchived'],['tags','tags',{multiEntry:true}]],
  turns: [['updatedAt','updatedAt'],['chatId','chatId'],['providerId','providerId']],
  files: [['updatedAt','updatedAt'],['chatId','chatId'],['workspaceProjectId','workspaceProjectId'],['providerId','providerId']],
  events: [['updatedAt','updatedAt'],['chatId','chatId'],['type','type']],
  checkpoints: [['updatedAt','updatedAt']],
  syncReceipts: [['updatedAt','updatedAt'],['provider','provider']],
  catalogRuns: [['updatedAt','updatedAt'],['status','status']]
});

const SEARCH_STORE = 'searchDocs';
const SEARCH_MAX_TERMS = 160;
const SEARCH_RESULT_LIMIT = 120;

function tokenizeSearch(value, limit = SEARCH_MAX_TERMS) {
  return brain.searchTerms(value, limit);
}

function searchDoc(entityType, record = {}) {
  if (!record?.id) return null;
  const title = brain.normalizeText(record.title || record.name || record.projectName || record.role || entityType, 500);
  const body = brain.normalizeText(
    entityType === 'turn' ? record.text :
    entityType === 'chat' ? `${record.title || ''} ${record.projectName || ''} ${record.workspaceProjectName || ''} ${record.providerName || ''} ${(record.tags || []).join(' ')} ${record.note || ''} ${record.lastExcerpt || ''}` :
    entityType === 'project' ? `${record.name || ''} ${record.providerId || ''} ${record.description || ''} ${record.notes || ''} ${(record.tags || []).join(' ')}` :
    entityType === 'group' ? `${record.name || ''} ${record.description || ''}` :
    entityType === 'smart' ? `${record.name || ''} ${record.query || ''} ${record.description || ''}` :
    `${record.name || ''} ${record.href || ''} ${record.externalUrl || ''} ${record.externalProvider || ''}`,
    entityType === 'turn' ? 50000 : 12000
  );
  const terms = tokenizeSearch(`${title} ${body}`);
  return {
    id: `${entityType}:${record.id}`, entityType, entityId: record.id, chatId: record.chatId || (entityType === 'chat' ? record.id : ''),
    providerId: record.providerId || '', projectId: record.projectId || '', title, text: body, url: record.url || record.href || record.externalUrl || '',
    terms, updatedAt: record.updatedAt || Date.now()
  };
}


function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const [name, indexes] of Object.entries(STORE_DEFS)) {
        let store;
        if (!db.objectStoreNames.contains(name)) store = db.createObjectStore(name, { keyPath: 'id' });
        else store = request.transaction.objectStore(name);
        for (const [indexName, keyPath, options = {}] of indexes) if (!store.indexNames.contains(indexName)) store.createIndex(indexName, keyPath, options);
      }
      let searchStore;
      if (!db.objectStoreNames.contains(SEARCH_STORE)) searchStore = db.createObjectStore(SEARCH_STORE, { keyPath: 'id' });
      else searchStore = request.transaction.objectStore(SEARCH_STORE);
      for (const [indexName, keyPath, options] of [
        ['updatedAt','updatedAt',{}], ['entityType','entityType',{}], ['chatId','chatId',{}], ['providerId','providerId',{}], ['terms','terms',{ multiEntry: true }]
      ]) if (!searchStore.indexNames.contains(indexName)) searchStore.createIndex(indexName, keyPath, options);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getOne(storeName, id) {
  const db = await openDb();
  try { return await requestResult(db.transaction(storeName, 'readonly').objectStore(storeName).get(id)); }
  finally { db.close(); }
}

async function getAll(storeName) {
  const db = await openDb();
  try { return await requestResult(db.transaction(storeName, 'readonly').objectStore(storeName).getAll()); }
  finally { db.close(); }
}


async function getRecent(storeName, limit = 50, offset = 0) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 250));
  const safeOffset = Math.max(0, Number(offset) || 0);
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const source = store.indexNames.contains('updatedAt') ? store.index('updatedAt') : store;
      const out = []; let skipped = 0;
      const request = source.openCursor(null, 'prev');
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || out.length >= safeLimit) { resolve(out); return; }
        if (skipped < safeOffset) skipped += 1; else out.push(cursor.value);
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

async function getByIndex(storeName, indexName, value, limit = 250) {
  const db = await openDb();
  try {
    const store = db.transaction(storeName, 'readonly').objectStore(storeName);
    if (!store.indexNames.contains(indexName)) return [];
    const rows = await requestResult(store.index(indexName).getAll(IDBKeyRange.only(value), Math.max(1, Math.min(Number(limit) || 250, 2000))));
    return rows.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
  } finally { db.close(); }
}

async function getAllByIndex(storeName, indexName, value) {
  const db = await openDb();
  try {
    const store = db.transaction(storeName, 'readonly').objectStore(storeName);
    if (!store.indexNames.contains(indexName)) return [];
    const rows = await requestResult(store.index(indexName).getAll(IDBKeyRange.only(value)));
    return rows.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
  } finally { db.close(); }
}

async function putMany(storeName, records) {
  if (!records.length) return [];
  const unique = [...new Map(records.filter((record) => record?.id).map((record) => [record.id, record])).values()];
  if (!unique.length) return [];
  const db = await openDb();
  try {
    const existingTx = db.transaction(storeName, 'readonly');
    const existingStore = existingTx.objectStore(storeName);
    const previous = await Promise.all(unique.map((record) => requestResult(existingStore.get(record.id))));
    const merged = unique.map((record, index) => brain.mergeRecord(previous[index], record));
    await new Promise((resolve, reject) => {
      const writeTx = db.transaction(storeName, 'readwrite');
      const store = writeTx.objectStore(storeName);
      merged.forEach((record) => store.put(record));
      writeTx.oncomplete = resolve;
      writeTx.onerror = () => reject(writeTx.error);
    });
    return merged;
  } finally { db.close(); }
}

async function putManyChunked(storeName, records, chunkSize = 500) {
  const rows = records.filter((record) => record?.id);
  if (!rows.length) return [];
  const out = [];
  const size = Math.max(50, Math.min(Number(chunkSize) || 500, 1000));
  for (let index = 0; index < rows.length; index += size) out.push(...await putMany(storeName, rows.slice(index, index + size)));
  return out;
}

async function upsert(storeName, record) { return (await putMany(storeName, [record]))[0] || null; }

async function putSearchDocs(records) {
  const docs = records.filter(Boolean);
  if (!docs.length) return;
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(SEARCH_STORE, 'readwrite');
      const store = tx.objectStore(SEARCH_STORE);
      docs.forEach((doc) => store.put(doc));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}

async function clearStore(storeName) {
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite'); tx.objectStore(storeName).clear();
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}

async function indexStoreIntoSearch(sourceStore, entityType) {
  const db = await openDb();
  let count = 0;
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction([sourceStore, SEARCH_STORE], 'readwrite');
      const source = tx.objectStore(sourceStore); const target = tx.objectStore(SEARCH_STORE);
      const request = source.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const doc = searchDoc(entityType, cursor.value); if (doc) { target.put(doc); count += 1; }
        cursor.continue();
      };
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
  return count;
}

async function rebuildSearchIndex() {
  await clearStore(SEARCH_STORE);
  const counts = {};
  for (const [source, type] of [['groups','group'],['projects','project'],['smartCollections','smart'],['chats','chat'],['turns','turn'],['files','file']]) counts[type] = await indexStoreIntoSearch(source, type);
  return counts;
}

async function ensureSearchIndex() {
  const [docs, turns, chats, files] = await Promise.all([countStore(SEARCH_STORE), countStore('turns'), countStore('chats'), countStore('files')]);
  if (!docs && (turns || chats || files)) return rebuildSearchIndex();
  return null;
}

async function searchBrain(query, limit = 60) {
  const terms = tokenizeSearch(query, 12);
  if (!terms.length) return [];
  const db = await openDb();
  try {
    const tx = db.transaction(SEARCH_STORE, 'readonly');
    const index = tx.objectStore(SEARCH_STORE).index('terms');
    const lists = await Promise.all(terms.map((term) => requestResult(index.getAll(term, 500))));
    if (!lists.length || lists.some((list) => !list.length)) return [];
    const membership = lists.slice(1).map((list) => new Set(list.map((doc) => doc.id)));
    const q = String(query || '').toLocaleLowerCase().normalize('NFKC');
    return lists[0].filter((doc) => membership.every((set) => set.has(doc.id))).map((doc) => {
      const hay = `${doc.title || ''} ${doc.text || ''}`.toLocaleLowerCase();
      const titleHit = String(doc.title || '').toLocaleLowerCase().includes(q);
      const phraseHit = hay.includes(q);
      const score = (titleHit ? 100 : 0) + (phraseHit ? 60 : 0) + Math.min(terms.length * 8, 48) + Math.min((doc.updatedAt || 0) / 1e13, 10);
      const phraseAt = phraseHit ? hay.indexOf(q) : -1;
      const start = Math.max(0, phraseAt >= 0 ? phraseAt - 160 : 0);
      return { ...doc, score, excerpt: brain.normalizeText(String(doc.text || '').slice(start, start + 700), 700), terms: undefined, text: undefined };
    }).sort((a,b)=>b.score-a.score || (b.updatedAt||0)-(a.updatedAt||0)).slice(0, Math.min(Number(limit)||60, SEARCH_RESULT_LIMIT));
  } finally { db.close(); }
}


async function deleteAllStores() {
  const db = await openDb();
  try {
    for (const name of [...Object.keys(STORE_DEFS), SEARCH_STORE]) {
      await new Promise((resolve, reject) => {
        const transaction = db.transaction(name, 'readwrite');
        transaction.objectStore(name).clear();
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
      });
    }
  } finally { db.close(); }
}

async function addEvent(type, entityType, entityId, chatId, data = {}) {
  const now = Date.now();
  await upsert('events', { id: `${now}:${crypto.randomUUID()}`, type, entityType, entityId: entityId || '', chatId: chatId || '', data, createdAt: now, updatedAt: now });
}

async function pruneEvents() {
  const events = await getAll('events');
  if (events.length <= EVENT_LIMIT) return;
  events.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const doomed = new Set(events.slice(EVENT_LIMIT).map((event) => event.id));
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('events', 'readwrite');
      const store = transaction.objectStore('events');
      doomed.forEach((id) => store.delete(id));
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

function deepMergeSettings(stored = {}) {
  return {
    ...defaultBrainSettings, ...stored,
    github: { ...defaultBrainSettings.github, ...(stored.github || {}) },
    drive: { ...defaultBrainSettings.drive, ...(stored.drive || {}) },
    catalog: { ...defaultBrainSettings.catalog, ...(stored.catalog || {}) }
  };
}

async function settings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return deepMergeSettings(stored[SETTINGS_KEY] || {});
}

async function saveSettings(next) {
  const merged = deepMergeSettings(next);
  await chrome.storage.local.set({ [SETTINGS_KEY]: merged });
  return merged;
}

async function patchSettings(patch) {
  const current = await settings();
  return saveSettings({
    ...current, ...patch,
    github: { ...current.github, ...(patch.github || {}) },
    drive: { ...current.drive, ...(patch.drive || {}) },
    catalog: { ...current.catalog, ...(patch.catalog || {}) }
  });
}

async function ingestBatch(items) {
  const cfg = await settings();
  if (!cfg.captureEnabled || !Array.isArray(items) || !items.length) return { ok: true, ignored: true };
  const now = Date.now();
  const providerRecords = [];
  const projects = [];
  const chats = [];
  const turns = [];
  const files = [];
  const statusEvents = [];
  const routeEvents = [];

  for (const item of items.slice(0, 1000)) {
    const type = item?.type;
    const data = item?.data || {};
    if (type === 'PROVIDER_SEEN' && data.id) providerRecords.push({ ...data, updatedAt: data.updatedAt || now });
    else if (type === 'CHAT_UPSERT' && data.id) {
      chats.push({ ...data, updatedAt: data.updatedAt || now });
      const projectId = data.projectId || `${data.providerId || 'unknown'}:inbox`;
      projects.push({ id: projectId, providerId: data.providerId || '', name: data.projectName || (projectId.endsWith(':inbox') ? 'Inbox' : projectId), sourceType: 'provider', updatedAt: now });
    } else if (type === 'TURN_UPSERT' && data.id) turns.push({ ...data, updatedAt: data.updatedAt || now });
    else if (type === 'FILE_UPSERT' && data.id) files.push({ ...data, updatedAt: data.updatedAt || now });
    else if (type === 'STATUS_EVENT' && data.chatId) statusEvents.push(data);
    else if (type === 'STATUS_HEARTBEAT' && data.chatId) chats.push({ id: data.chatId, providerId: data.providerId || '', status: data.status || 'running', lastActivityAt: data.lastActivityAt || now, lastSeenAt: now, url: data.url || '', updatedAt: now });
    else if (type === 'ROUTE_EVENT') routeEvents.push(data);
  }

  await Promise.all([
    putMany('providers', providerRecords), putMany('projects', projects), putMany('chats', chats), putMany('turns', turns), putMany('files', files)
  ]);

  // Maintain a dedicated multi-entry inverted index asynchronously inside IndexedDB.
  // This keeps full-history search off AI pages and avoids transcript-wide scans in the UI.
  await putSearchDocs([
    ...projects.map((record) => searchDoc('project', record)),
    ...chats.map((record) => searchDoc('chat', record)),
    ...turns.map((record) => searchDoc('turn', record)),
    ...files.map((record) => searchDoc('file', record))
  ]);

  if (turns.length) {
    const latestByChat = new Map();
    for (const turn of turns) {
      if (!turn.chatId) continue;
      const previous = latestByChat.get(turn.chatId);
      if (!previous || (turn.ordinal ?? 0) >= (previous.ordinal ?? 0)) latestByChat.set(turn.chatId, turn);
    }
    const latestChatUpdates = [...latestByChat.values()].map((turn) => ({ id: turn.chatId, providerId: turn.providerId || '', lastExcerpt: String(turn.text || '').slice(0, 1200), lastTurnAt: turn.updatedAt || now, lastActivityAt: turn.updatedAt || now, updatedAt: turn.updatedAt || now }));
    const mergedChatUpdates = await putMany('chats', latestChatUpdates);
    await putSearchDocs(mergedChatUpdates.map((record) => searchDoc('chat', record)));
  }

  for (const status of statusEvents) {
    const previous = await getOne('chats', status.chatId);
    const mergedStatusChat = await upsert('chats', { id: status.chatId, providerId: status.providerId || previous?.providerId || '', status: status.status, statusDetail: status.detail || '', url: status.url || previous?.url || '', lastSeenAt: now, lastActivityAt: now, updatedAt: now });
    await putSearchDocs([searchDoc('chat', mergedStatusChat)]);
    if (previous?.status !== status.status) await addEvent('chat-status', 'chat', status.chatId, status.chatId, { from: previous?.status || '', to: status.status, detail: (status.detail || '').slice(0, 500) });
  }

  for (const route of routeEvents.slice(-20)) {
    if (route.chatId && !route.chatId.endsWith(':home')) await addEvent('route', 'chat', route.chatId, route.chatId, { providerId: route.providerId || '', url: route.url || '', title: route.title || '' });
  }

  if (chats.length || turns.length || files.length || statusEvents.length) {
    await addEvent('capture-batch', 'brain', '', chats.at(-1)?.id || turns.at(-1)?.chatId || files.at(-1)?.chatId || '', { chats: chats.length, turns: turns.length, files: files.length, statuses: statusEvents.length });
    markDriveDirty().catch(() => {});
  }
  pruneEvents().catch(() => {});
  if (statusEvents.length) updateAttentionBadge().catch(() => {});
  return { ok: true, counts: { providers: providerRecords.length, projects: projects.length, chats: chats.length, turns: turns.length, files: files.length, statuses: statusEvents.length } };
}

async function ingest(payload) { return ingestBatch([payload]); }


async function countStore(storeName) {
  const db = await openDb();
  try { return await requestResult(db.transaction(storeName, 'readonly').objectStore(storeName).count()); }
  finally { db.close(); }
}

async function localStorageHealth() {
  let usage = 0, quota = 0, persisted = false;
  try {
    const estimate = await navigator.storage?.estimate?.();
    usage = Number(estimate?.usage || 0); quota = Number(estimate?.quota || 0);
    persisted = Boolean(await navigator.storage?.persisted?.());
  } catch (_) {}
  return { usage, quota, persisted, unlimitedStorage: chrome.runtime.getManifest().permissions?.includes('unlimitedStorage') || false };
}

async function ensurePersistentStorage() {
  try { await navigator.storage?.persist?.(); } catch (_) {}
  return localStorageHealth();
}

async function dashboard() {
  const [providerRecords, projects, chats, files, events, checkpoints, syncReceipts, catalogRuns, cfg, catalog, fullCapture, turnCount, searchDocCount] = await Promise.all([
    getAll('providers'), getAll('projects'), getAll('chats'), getAll('files'), getAll('events'), getAll('checkpoints'), getAll('syncReceipts'), getAll('catalogRuns'), settings(), catalogState(), fullCaptureState(), countStore('turns'), countStore(SEARCH_STORE)
  ]);
  const localStorage = await localStorageHealth();
  const organization = await organizationSummary();
  const sortedEvents = events.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 600);
  const statusCounts = Object.fromEntries(brain.CHAT_STATUSES.map((status) => [status, chats.filter((chat) => chat.status === status).length]));
  return {
    exportedAt: new Date().toISOString(), providers: providerRecords, projects, chats, files, events: sortedEvents,
    checkpoints: checkpoints.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0)).slice(0,100),
    syncReceipts: syncReceipts.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0)).slice(0,100),
    catalogRuns: catalogRuns.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0)).slice(0,50), catalog: publicCatalogState(catalog), fullCapture: publicFullCaptureState(fullCapture),
    summary: { providers: providerRecords.length, projects: projects.length, chats: chats.length, turns: turnCount, files: files.length, searchDocs: searchDocCount, statusCounts },
    localStorage,
    organization,
    sync: { drive: { ...cfg.drive, oauthProvisioned: googleOAuthProvisioned() }, github: { ...cfg.github, configured: Boolean(cfg.github.owner && cfg.github.repo) } }
  };
}



function normalizeTags(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(raw.map((tag) => brain.normalizeText(tag, 80).toLocaleLowerCase()).filter(Boolean))].slice(0, 32);
}

function localId(prefix) { return `local:${prefix}:${crypto.randomUUID()}`; }

async function organizationProjectMetrics(projectIds = []) {
  const ids=[...new Set(projectIds.filter(Boolean))]; if(!ids.length)return new Map();
  const db=await openDb();
  try {
    const tx=db.transaction(['chats','files'],'readonly'); const chats=tx.objectStore('chats'),files=tx.objectStore('files');
    const projectIndex=chats.index('workspaceProjectId'), statusIndex=chats.index('workspaceProjectStatus'), fileIndex=files.index('workspaceProjectId');
    const attentionStatuses=['blocked-approval','errored','stalled','auth-required','unavailable'];
    const entries=await Promise.all(ids.map(async(id)=>{
      const [chatCount,fileCount,...attention]=await Promise.all([
        requestResult(projectIndex.count(IDBKeyRange.only(id))),requestResult(fileIndex.count(IDBKeyRange.only(id))),
        ...attentionStatuses.map((status)=>requestResult(statusIndex.count(IDBKeyRange.only([id,status]))))
      ]); return [id,{chatCount,fileCount,attentionCount:attention.reduce((sum,n)=>sum+Number(n||0),0)}];
    })); return new Map(entries);
  } finally { db.close(); }
}

async function organizationTagCounts(limit=100) {
  const db=await openDb();
  try { return await new Promise((resolve,reject)=>{
    const tx=db.transaction('chats','readonly'); const index=tx.objectStore('chats').index('tags'); const out=[]; const request=index.openKeyCursor(null,'nextunique');
    request.onsuccess=()=>{const cursor=request.result;if(!cursor||out.length>=limit){resolve(out.sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name)));return;}const name=String(cursor.key||'');const countReq=index.count(IDBKeyRange.only(cursor.key));countReq.onsuccess=()=>{out.push({name,count:Number(countReq.result||0)});cursor.continue();};countReq.onerror=()=>reject(countReq.error);};request.onerror=()=>reject(request.error);
  }); } finally { db.close(); }
}

async function organizationSummary() {
  const [groups, projects, smartCollections, totalChats, pinnedChats, favoriteChats, tags] = await Promise.all([
    getAll('groups'), getAll('projects'), getAll('smartCollections'), countStore('chats'), getByIndex('chats','pinned',true,24), getByIndex('chats','favorite',true,24), organizationTagCounts(100)
  ]);
  const workspaceProjects = projects.filter((p) => p.sourceType === 'workspace' && !p.deletedAt);
  const providerProjects = projects.filter((p) => p.sourceType !== 'workspace' && !p.deletedAt);
  const metrics = await organizationProjectMetrics(workspaceProjects.map((p)=>p.id));
  const projectRows = workspaceProjects.map((p) => ({ ...p, ...(metrics.get(p.id) || {chatCount:0,fileCount:0,attentionCount:0}) }));
  const assignedCount=[...metrics.values()].reduce((sum,m)=>sum+Number(m.chatCount||0),0);
  return {
    groups: groups.filter((g) => !g.deletedAt).sort((a,b)=>Number(b.pinned||0)-Number(a.pinned||0)||(a.sortOrder||0)-(b.sortOrder||0)||(a.name||'').localeCompare(b.name||'')),
    projects: projectRows.sort((a,b)=>Number(b.pinned||0)-Number(a.pinned||0)||(a.sortOrder||0)-(b.sortOrder||0)||(b.updatedAt||0)-(a.updatedAt||0)),
    providerProjects: providerProjects.slice(0, 200),
    smartCollections: smartCollections.filter((c) => !c.deletedAt).sort((a,b)=>Number(b.pinned||0)-Number(a.pinned||0)||(a.sortOrder||0)-(b.sortOrder||0)),
    tags, pinnedChats: pinnedChats.filter((c)=>!c.organizedArchived), favoriteChats: favoriteChats.filter((c)=>!c.organizedArchived), unassignedCount: Math.max(0,totalChats-assignedCount)
  };
}

async function createGroup(input = {}) {
  const now = Date.now();
  const record = await upsert('groups', {
    id: localId('group'), name: brain.normalizeText(input.name || 'New group', 120), description: brain.normalizeText(input.description || '', 500),
    parentId: input.parentId || '', icon: brain.normalizeText(input.icon || '◇', 12), color: brain.normalizeText(input.color || '#6f8cff', 24), pinned: Boolean(input.pinned), sortOrder: Number(input.sortOrder || now), updatedAt: now
  });
  await putSearchDocs([searchDoc('group', record)]); await addEvent('organization-group-create','group',record.id,'',{name:record.name}); markDriveDirty().catch(()=>{}); return record;
}

async function createWorkspaceProject(input = {}) {
  const now = Date.now();
  const record = await upsert('projects', {
    id: localId('project'), sourceType: 'workspace', providerId: '', name: brain.normalizeText(input.name || 'New project', 160), description: brain.normalizeText(input.description || '', 1200), notes: brain.normalizeText(input.notes || '', 4000),
    groupId: input.groupId || '', icon: brain.normalizeText(input.icon || '✦', 12), color: brain.normalizeText(input.color || '#7d92ff', 24), pinned: Boolean(input.pinned), archived: false, sortOrder: Number(input.sortOrder || now), updatedAt: now
  });
  await putSearchDocs([searchDoc('project', record)]); await addEvent('organization-project-create','project',record.id,'',{name:record.name}); markDriveDirty().catch(()=>{}); return record;
}

async function createSmartCollection(input = {}) {
  const now = Date.now();
  const record = await upsert('smartCollections', {
    id: localId('smart'), name: brain.normalizeText(input.name || 'Saved search', 160), query: brain.normalizeText(input.query || '', 600), description: brain.normalizeText(input.description || '', 500), groupId: input.groupId || '', icon: brain.normalizeText(input.icon || '⌕', 12), pinned: Boolean(input.pinned), sortOrder: Number(input.sortOrder || now), updatedAt: now
  });
  await putSearchDocs([searchDoc('smart', record)]); await addEvent('organization-smart-create','smart',record.id,'',{name:record.name,query:record.query}); markDriveDirty().catch(()=>{}); return record;
}

async function updateOrganizationEntity(kind, id, patch = {}) {
  const store = kind === 'group' ? 'groups' : kind === 'project' ? 'projects' : kind === 'smart' ? 'smartCollections' : '';
  if (!store || !id) throw new Error('Unsupported organization entity.');
  const existing = await getOne(store, id); if (!existing) throw new Error('Organization item not found.');
  if (kind === 'project' && existing.sourceType !== 'workspace') throw new Error('Provider projects are read-only mirrors.');
  const allowed = kind === 'group' ? ['name','description','parentId','icon','color','pinned','sortOrder'] : kind === 'project' ? ['name','description','notes','groupId','icon','color','pinned','archived','sortOrder'] : ['name','query','description','groupId','icon','pinned','sortOrder'];
  const next = { id, updatedAt: Date.now() };
  for (const key of allowed) if (Object.prototype.hasOwnProperty.call(patch,key)) next[key] = ['name','description','notes','query','icon','color'].includes(key) ? brain.normalizeText(patch[key], key==='notes'?4000:key==='description'?1200:600) : patch[key];
  const merged = await upsert(store, next); await putSearchDocs([searchDoc(kind, merged)]);
  if (kind === 'project' && (Object.prototype.hasOwnProperty.call(patch,'name') || Object.prototype.hasOwnProperty.call(patch,'groupId'))) {
    const chats = await getAllByIndex('chats','workspaceProjectId',id);
    const chatUpdates = chats.map((chat)=>({id:chat.id,workspaceProjectName:merged.name||'',workspaceGroupId:merged.groupId||'',updatedAt:Date.now()}));
    const mergedChats = await putManyChunked('chats',chatUpdates); await putSearchDocs(mergedChats.map((record)=>searchDoc('chat',record)));
  }
  await addEvent('organization-update',kind,id,'',{fields:Object.keys(next).filter(k=>!['id','updatedAt'].includes(k))}); markDriveDirty().catch(()=>{}); return merged;
}

async function deleteOrganizationEntity(kind, id) {
  const store = kind === 'group' ? 'groups' : kind === 'project' ? 'projects' : kind === 'smart' ? 'smartCollections' : '';
  if (!store || !id) throw new Error('Unsupported organization entity.');
  const existing = await getOne(store,id); if (!existing) return { id, missing: true };
  if (kind === 'project' && existing.sourceType !== 'workspace') throw new Error('Provider projects are read-only mirrors.');
  const now = Date.now(); await upsert(store,{id,deletedAt:now,updatedAt:now});
  if (kind === 'project') {
    const chats = await getAllByIndex('chats','workspaceProjectId',id);
    await putManyChunked('chats', chats.map((chat)=>({id:chat.id,workspaceProjectId:'',workspaceProjectName:'',workspaceGroupId:'',updatedAt:now})));
    const files = await getAllByIndex('files','workspaceProjectId',id); await putManyChunked('files',files.map((file)=>({id:file.id,workspaceProjectId:'',updatedAt:now})));
  } else if (kind === 'group') {
    const projects = await getAllByIndex('projects','groupId',id);
    await putManyChunked('projects', projects.filter((p)=>p.sourceType==='workspace').map((p)=>({id:p.id,groupId:'',updatedAt:now})));
    const children = await getAllByIndex('groups','parentId',id);
    await putManyChunked('groups', children.map((g)=>({id:g.id,parentId:'',updatedAt:now})));
  }
  await addEvent('organization-delete',kind,id,'',{name:existing.name||''}); markDriveDirty().catch(()=>{}); return { id, deleted: true };
}

async function patchChatOrganization(chatIds = [], patch = {}) {
  const ids = [...new Set((Array.isArray(chatIds)?chatIds:[chatIds]).filter(Boolean))].slice(0,2000);
  if (!ids.length) return [];
  const now = Date.now(); let project = null;
  if (Object.prototype.hasOwnProperty.call(patch,'workspaceProjectId') && patch.workspaceProjectId) {
    project = await getOne('projects',patch.workspaceProjectId);
    if (!project || project.sourceType !== 'workspace' || project.deletedAt) throw new Error('Target Constellation project not found.');
  }
  const updates=[];
  for (const id of ids) {
    const old=await getOne('chats',id); if(!old)continue;
    const next={id,updatedAt:now};
    if(Object.prototype.hasOwnProperty.call(patch,'workspaceProjectId')){next.workspaceProjectId=project?.id||'';next.workspaceProjectName=project?.name||'';next.workspaceGroupId=project?.groupId||'';}
    if(Object.prototype.hasOwnProperty.call(patch,'tags')) next.tags=normalizeTags(patch.tags);
    if(Object.prototype.hasOwnProperty.call(patch,'addTags')) next.tags=normalizeTags([...(old.tags||[]),...normalizeTags(patch.addTags)]);
    if(Object.prototype.hasOwnProperty.call(patch,'removeTag')) next.tags=normalizeTags(old.tags).filter((tag)=>tag!==String(patch.removeTag||'').toLocaleLowerCase());
    for(const key of ['pinned','favorite','organizedArchived']) if(Object.prototype.hasOwnProperty.call(patch,key)) next[key]=Boolean(patch[key]);
    if(Object.prototype.hasOwnProperty.call(patch,'note')) next.note=brain.normalizeText(patch.note||'',2000);
    updates.push(next);
  }
  const merged=await putMany('chats',updates); await putSearchDocs(merged.map((record)=>searchDoc('chat',record)));
  if(Object.prototype.hasOwnProperty.call(patch,'workspaceProjectId')){
    const fileUpdates=[];for(const chat of merged){const related=await getAllByIndex('files','chatId',chat.id);for(const file of related)fileUpdates.push({id:file.id,workspaceProjectId:chat.workspaceProjectId||'',updatedAt:now});}
    if(fileUpdates.length)await putManyChunked('files',fileUpdates);
  }
  await addEvent('organization-chat-update','chat',ids[0],ids[0],{count:merged.length,projectId:project?.id||'',fields:Object.keys(patch)}); markDriveDirty().catch(()=>{}); return merged;
}

async function organizationChats(filters = {}) {
  const limit=Math.max(1,Math.min(Number(filters.limit)||120,500)); let rows;
  if(filters.workspaceProjectId) rows=await getByIndex('chats','workspaceProjectId',filters.workspaceProjectId,Math.max(limit,500));
  else if(filters.tag) rows=await getByIndex('chats','tags',String(filters.tag).toLocaleLowerCase(),Math.max(limit,500));
  else if(filters.mode==='pinned') rows=await getByIndex('chats','pinned',true,Math.max(limit,500));
  else if(filters.mode==='favorites') rows=await getByIndex('chats','favorite',true,Math.max(limit,500));
  else if(filters.mode==='archived') rows=await getByIndex('chats','organizedArchived',true,Math.max(limit,500));
  else rows=await getRecent('chats',Math.max(limit,300));
  if(filters.groupId) rows=rows.filter((c)=>c.workspaceGroupId===filters.groupId);
  if(filters.mode==='unassigned') rows=rows.filter((c)=>!c.workspaceProjectId);
  if(filters.mode==='attention') rows=rows.filter((c)=>['blocked-approval','errored','stalled','auth-required','unavailable'].includes(c.status));
  if(filters.mode!=='archived' && !filters.includeArchived) rows=rows.filter((c)=>!c.organizedArchived);
  if(filters.providerId) rows=rows.filter((c)=>c.providerId===filters.providerId);
  if(filters.status) rows=rows.filter((c)=>c.status===filters.status);
  const sort=filters.sort||'recent';
  rows.sort(sort==='title'?(a,b)=>(a.title||'').localeCompare(b.title||''):sort==='oldest'?(a,b)=>(a.updatedAt||0)-(b.updatedAt||0):(a,b)=>Number(b.pinned||0)-Number(a.pinned||0)||(b.updatedAt||0)-(a.updatedAt||0));
  return rows.slice(0,limit);
}

const HOME_STOPWORDS = new Set(['the','and','for','with','from','this','that','chat','project','help','make','into','your','have','what','how','can','use','using','new','fix','update','build','create','please','need','want','about','more','like','just','all','its','are','was','you','me','my','our','not','but']);

function buildTopicHints(chats = [], projects = []) {
  const counts = new Map();
  const add = (text, weight = 1) => {
    for (const term of tokenizeSearch(text, 80)) {
      if (term.length < 3 || HOME_STOPWORDS.has(term) || /^\d+$/.test(term)) continue;
      counts.set(term, (counts.get(term) || 0) + weight);
    }
  };
  projects.forEach((p) => add(p.name || '', 4));
  chats.forEach((c) => add(`${c.title || ''} ${c.projectName || ''}`, 1));
  return [...counts.entries()].sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0])).slice(0, 24).map(([term,count]) => ({ term, count }));
}

async function homeSummary() {
  const [providerCount, projectCount, chatCount, turnCount, fileCount, recentChats, recentFiles, recentProjects, recentEvents, topicChats, historyGranted, cfg, catalog, fullCapture, organization] = await Promise.all([
    countStore('providers'), countStore('projects'), countStore('chats'), countStore('turns'), countStore('files'),
    getRecent('chats', 18), getRecent('files', 18), getRecent('projects', 18), getRecent('events', 24), getRecent('chats', 500), hasHistoryPermission(), settings(), catalogState(), fullCaptureState(), organizationSummary()
  ]);
  const attentionStatuses = ['blocked-approval','errored','stalled','auth-required','unavailable'];
  const liveStatuses = ['running','paused','waiting-user'];
  const attentionGroups = await Promise.all(attentionStatuses.map((status) => getByIndex('chats','status',status,10)));
  const liveGroups = await Promise.all(liveStatuses.map((status) => getByIndex('chats','status',status,10)));
  const statusCounts = {};
  const db = await openDb();
  try {
    const tx = db.transaction('chats','readonly'); const index = tx.objectStore('chats').index('status');
    await Promise.all(brain.CHAT_STATUSES.map(async (status) => { statusCounts[status] = await requestResult(index.count(IDBKeyRange.only(status))); }));
  } finally { db.close(); }
  return {
    counts: { providers: providerCount, projects: projectCount, chats: chatCount, turns: turnCount, files: fileCount }, statusCounts,
    recentChats, recentFiles, recentProjects, recentEvents,
    attention: attentionGroups.flat().sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0)).slice(0,30),
    live: liveGroups.flat().sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0)).slice(0,30),
    topics: buildTopicHints(topicChats, recentProjects),
    catalog: publicCatalogState(catalog), fullCapture: publicFullCaptureState(fullCapture), discovery: { browserHistoryGranted: historyGranted, mode: 'zero-tab-default', hiddenTabs: false, manualFullCapture: true },
    organization,
    sync: { drive: { ...cfg.drive, oauthProvisioned: googleOAuthProvisioned() }, github: { ...cfg.github, configured: Boolean(cfg.github.owner && cfg.github.repo) } }
  };
}

async function listBrainEntities(entityType, limit = 80, offset = 0) {
  const map = { project: 'projects', chat: 'chats', file: 'files', event: 'events', checkpoint: 'checkpoints' };
  const store = map[entityType];
  if (!store) throw new Error('Unsupported entity list type.');
  return getRecent(store, limit, offset);
}

async function groupedHomeSearch(query, limit = 40) {
  const hits = await searchBrain(query, 120);
  const groups = new Map();
  const standalone = [];
  for (const hit of hits) {
    const chatId = hit.chatId || (hit.entityType === 'chat' ? hit.entityId : '');
    if (!chatId) { standalone.push(hit); continue; }
    const group = groups.get(chatId) || { chatId, score: 0, hits: [] };
    group.score = Math.max(group.score, hit.score || 0); group.hits.push(hit); groups.set(chatId, group);
  }
  const enriched = [];
  for (const group of [...groups.values()].sort((a,b)=>b.score-a.score).slice(0, Math.min(Number(limit)||40,60))) {
    const [chat, files] = await Promise.all([getOne('chats', group.chatId), getByIndex('files','chatId',group.chatId,40)]);
    if (!chat) continue;
    enriched.push({
      chat, score: group.score,
      matches: group.hits.slice(0,8).map((hit) => ({ entityType: hit.entityType, title: hit.title, excerpt: hit.excerpt, updatedAt: hit.updatedAt })),
      files: files.slice(0,12)
    });
  }
  return { groups: enriched, standalone: standalone.slice(0,20), totalHits: hits.length };
}

async function snapshot() {
  const [providerRecords, groups, projects, smartCollections, chats, turns, files, events, checkpoints, syncReceipts, catalogRuns, cfg, dirty] = await Promise.all([
    getAll('providers'), getAll('groups'), getAll('projects'), getAll('smartCollections'), getAll('chats'), getAll('turns'), getAll('files'), getAll('events'), getAll('checkpoints'), getAll('syncReceipts'), getAll('catalogRuns'), settings(), chrome.storage.local.get(DIRTY_KEY)
  ]);
  const manifest = chrome.runtime.getManifest();
  const out = brain.makeSnapshot({
    providers: providerRecords, projects, chats, turns, files, events, checkpoints, syncReceipts, catalogRuns,
    meta: {
      extension: { name: manifest.name, version: manifest.version },
      github: { ...cfg.github, configured: Boolean(cfg.github.owner && cfg.github.repo) },
      drive: { ...cfg.drive, oauthProvisioned: googleOAuthProvisioned(), dirtyAt: dirty[DIRTY_KEY] || 0 },
      performanceEngine: 'Project Constellation Performance Engine'
    }
  });
  out.groups = groups; out.smartCollections = smartCollections;
  out.summary.groups = groups.filter((g)=>!g.deletedAt).length;
  out.summary.smartCollections = smartCollections.filter((c)=>!c.deletedAt).length;
  return out;
}

function base64Utf8(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

async function githubSync() {
  const cfg = await settings();
  const secret = (await chrome.storage.local.get(GITHUB_SECRET_KEY))[GITHUB_SECRET_KEY] || '';
  const gh = cfg.github;
  if (!secret || !gh.owner || !gh.repo || !gh.path) throw new Error('GitHub token, owner, repository, and path are required.');
  const ref = encodeURIComponent(gh.branch || 'main');
  const api = `https://api.github.com/repos/${encodeURIComponent(gh.owner)}/${encodeURIComponent(gh.repo)}/contents/${gh.path.split('/').map(encodeURIComponent).join('/')}?ref=${ref}`;
  const headers = { Authorization: `Bearer ${secret}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  let sha;
  const existing = await fetch(api, { headers });
  if (existing.ok) sha = (await existing.json()).sha;
  else if (existing.status !== 404) throw new Error(`GitHub read failed: ${existing.status}`);
  const body = await snapshot();
  const content = JSON.stringify(body, null, 2) + '\n';
  const write = await fetch(api.replace(/\?ref=.*$/, ''), {
    method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: `Update Project Constellation (${new Date().toISOString()})`, content: base64Utf8(content), branch: gh.branch || 'main', ...(sha ? { sha } : {}) })
  });
  if (!write.ok) throw new Error(`GitHub write failed: ${write.status} ${(await write.text()).slice(0, 300)}`);
  const result = await write.json();
  const now = Date.now();
  await patchSettings({ github: { lastSyncAt: now } });
  await upsert('syncReceipts', { id: `github:${now}`, provider: 'github', status: 'verified-write', remoteId: result.commit?.sha || '', url: result.content?.html_url || '', updatedAt: now });
  await addEvent('github-sync', 'checkpoint', result.commit?.sha || '', '', { path: gh.path, repo: `${gh.owner}/${gh.repo}` });
  return { ok: true, commit: result.commit?.sha || '', url: result.content?.html_url || '' };
}

function googleOAuthClientId() { return chrome.runtime.getManifest()?.oauth2?.client_id || ''; }
function googleOAuthProvisioned() {
  const id = googleOAuthClientId();
  return Boolean(id && id.endsWith('.apps.googleusercontent.com') && !id.includes('PROJECT_CONSTELLATION_GOOGLE_OAUTH_CLIENT_ID'));
}

async function googleToken(interactive = false) {
  if (!googleOAuthProvisioned()) throw new Error('Google OAuth client is not provisioned in this build. Set PROJECT_CONSTELLATION_GOOGLE_OAUTH_CLIENT_ID when building the extension.');
  const result = await chrome.identity.getAuthToken({ interactive, scopes: [DRIVE_SCOPE], enableGranularPermissions: true });
  if (!result?.token) throw new Error('Google OAuth did not return an access token.');
  return result.token;
}

async function googleFetch(url, options = {}, interactive = false, retry = true) {
  const token = await googleToken(interactive);
  const response = await fetch(url, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` } });
  if (response.status === 401 && retry) {
    await chrome.identity.removeCachedAuthToken({ token }).catch(() => {});
    return googleFetch(url, options, interactive, false);
  }
  return response;
}

function driveQ(value) { return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

async function ensureDriveFolder(interactive = false) {
  const cfg = await settings();
  if (cfg.drive.folderId) return cfg.drive.folderId;
  const q = encodeURIComponent(`name='${driveQ(cfg.drive.folderName)}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const list = await googleFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,webViewLink)&pageSize=10`, {}, interactive);
  if (!list.ok) throw new Error(`Drive folder lookup failed: ${list.status}`);
  const files = (await list.json()).files || [];
  let folderId = files[0]?.id || '';
  if (!folderId) {
    const create = await googleFetch('https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: cfg.drive.folderName, mimeType: 'application/vnd.google-apps.folder' })
    }, interactive);
    if (!create.ok) throw new Error(`Drive folder creation failed: ${create.status} ${(await create.text()).slice(0, 240)}`);
    folderId = (await create.json()).id;
  }
  await patchSettings({ drive: { folderId } });
  return folderId;
}

async function findDriveFileInFolder(folderId, name, interactive = false) {
  const q = encodeURIComponent(`name='${driveQ(name)}' and '${driveQ(folderId)}' in parents and trashed=false`);
  const response = await googleFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,size,modifiedTime,webViewLink,description)&orderBy=modifiedTime desc&pageSize=10`, {}, interactive);
  if (!response.ok) throw new Error(`Drive file lookup failed: ${response.status}`);
  return ((await response.json()).files || [])[0] || null;
}

async function resolveDriveArtifacts(interactive = false) {
  const folderId = await ensureDriveFolder(interactive);
  let cfg = await settings();
  let snapshotFileId = cfg.drive.snapshotFileId || '';
  let journalFileId = cfg.drive.journalFileId || '';
  let indexFileId = cfg.drive.indexFileId || '';
  let snapshot = null, journal = null, index = null;
  if (!snapshotFileId) { snapshot = await findDriveFileInFolder(folderId, cfg.drive.snapshotName, interactive); snapshotFileId = snapshot?.id || ''; }
  if (!journalFileId) { journal = await findDriveFileInFolder(folderId, cfg.drive.journalName, interactive); journalFileId = journal?.id || ''; }
  if (!indexFileId) { index = await findDriveFileInFolder(folderId, cfg.drive.indexName, interactive); indexFileId = index?.id || ''; }
  if (snapshotFileId !== cfg.drive.snapshotFileId || journalFileId !== cfg.drive.journalFileId || indexFileId !== cfg.drive.indexFileId) {
    await patchSettings({ drive: { folderId, snapshotFileId, journalFileId, indexFileId } });
    cfg = await settings();
  }
  return { folderId, snapshotFileId, journalFileId, indexFileId, snapshot, journal, index, cfg };
}

async function sha256Blob(blob) {
  const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function gzipText(text) {
  const raw = new Blob([text], { type: 'application/json' });
  if (typeof CompressionStream !== 'function') return { blob: raw, contentType: 'application/json', encoding: 'identity' };
  const stream = raw.stream().pipeThrough(new CompressionStream('gzip'));
  return { blob: await new Response(stream).blob(), contentType: 'application/gzip', encoding: 'gzip' };
}

async function decodeSnapshotBlob(blob) {
  const bytes = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  const gzip = bytes[0] === 0x1f && bytes[1] === 0x8b;
  if (!gzip) return blob.text();
  if (typeof DecompressionStream !== 'function') throw new Error('This browser cannot decompress the Drive snapshot.');
  return new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).text();
}

async function mergeRemoteNewer(storeName, records = []) {
  let merged = 0;
  for (let offset = 0; offset < records.length; offset += 400) {
    const chunk = records.slice(offset, offset + 400).filter((record) => record?.id);
    const candidates = [];
    for (const record of chunk) {
      const local = await getOne(storeName, record.id);
      if (!local || Number(record.updatedAt || 0) >= Number(local.updatedAt || 0)) candidates.push(record);
    }
    if (candidates.length) { await putMany(storeName, candidates); merged += candidates.length; }
  }
  return merged;
}

async function downloadVerifiedDriveJson(fileId, interactive = false, label = 'Drive artifact') {
  const metadataResponse = await googleFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,size,modifiedTime,webViewLink,description`, {}, interactive);
  if (!metadataResponse.ok) throw new Error(`${label} metadata failed: ${metadataResponse.status}`);
  const metadata = await metadataResponse.json();
  const media = await googleFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, {}, interactive);
  if (!media.ok) throw new Error(`${label} download failed: ${media.status}`);
  const blob = await media.blob();
  if (Number(metadata.size || -1) !== blob.size) throw new Error(`${label} size mismatch: metadata ${metadata.size}, downloaded ${blob.size}`);
  const sha256 = await sha256Blob(blob);
  const expected = String(metadata.description || '').match(/sha256=([a-f0-9]{64})/i)?.[1]?.toLowerCase() || '';
  if (expected && expected !== sha256) throw new Error(`${label} SHA-256 verification failed.`);
  const parsed = JSON.parse(await decodeSnapshotBlob(blob));
  return { metadata, blob, sha256, parsed };
}

async function restoreFromDrive({ interactive = false } = {}) {
  await patchSettings({ drive: { lastStatus: 'restoring', lastError: '' } });
  try {
    const artifacts = await resolveDriveArtifacts(interactive);
    if (!artifacts.snapshotFileId) throw new Error('No Project Constellation Drive snapshot exists for this Google account yet.');
    const full = await downloadVerifiedDriveJson(artifacts.snapshotFileId, interactive, 'Drive snapshot');
    const recovered = full.parsed;
    if (recovered?.schema !== 'project-constellation' || !Number(recovered.schemaVersion)) throw new Error('Remote file is not a valid Project Constellation snapshot.');

    const storeNames = ['providers','groups','projects','smartCollections','chats','turns','files','events','checkpoints','syncReceipts','catalogRuns'];
    const counts = Object.fromEntries(storeNames.map((name) => [name, 0]));
    for (const storeName of storeNames) {
      counts[storeName] += await mergeRemoteNewer(storeName, Array.isArray(recovered[storeName]) ? recovered[storeName] : []);
    }

    let journal = null;
    if (artifacts.journalFileId) {
      const candidate = await downloadVerifiedDriveJson(artifacts.journalFileId, interactive, 'Drive journal');
      const delta = candidate.parsed;
      const snapshotExportedAt = Date.parse(recovered.exportedAt || '') || 0;
      const baseFullSyncAt = Number(delta?.baseFullSyncAt || 0);
      const appliesToRecoveredSnapshot = delta?.schema === 'project-constellation-delta' && Number(delta.schemaVersion) && baseFullSyncAt >= Math.max(0, snapshotExportedAt - 5000);
      if (appliesToRecoveredSnapshot) {
        for (const storeName of storeNames) counts[storeName] += await mergeRemoteNewer(storeName, Array.isArray(delta[storeName]) ? delta[storeName] : []);
        journal = { fileId: artifacts.journalFileId, sha256: candidate.sha256, size: candidate.blob.size, baseFullSyncAt, exportedAt: delta.exportedAt || '', applied: true };
      } else {
        journal = { fileId: artifacts.journalFileId, sha256: candidate.sha256, size: candidate.blob.size, baseFullSyncAt, exportedAt: delta?.exportedAt || '', applied: false, reason: 'journal predates current full snapshot' };
      }
    }

    const searchCounts = await rebuildSearchIndex();
    counts.search = searchCounts;
    const now = Date.now();
    await patchSettings({ drive: {
      folderId: artifacts.folderId, snapshotFileId: artifacts.snapshotFileId, journalFileId: artifacts.journalFileId,
      indexFileId: artifacts.indexFileId, snapshotSha256: full.sha256, snapshotSize: full.blob.size,
      journalSha256: journal?.sha256 || artifacts.cfg.drive.journalSha256 || '', journalSize: journal?.size || artifacts.cfg.drive.journalSize || 0,
      lastRestoreAt: now, lastStatus: 'verified', lastError: ''
    } });
    await upsert('syncReceipts', { id: `drive-restore:${now}`, provider: 'google-drive', status: 'roundtrip-restored', remoteId: artifacts.snapshotFileId, url: full.metadata.webViewLink || '', sha256: full.sha256, size: full.blob.size, updatedAt: now });
    await addEvent('drive-restore', 'checkpoint', artifacts.snapshotFileId, '', { sha256: full.sha256, size: full.blob.size, counts, journal });
    await updateAttentionBadge();
    return { ok: true, fileId: artifacts.snapshotFileId, url: full.metadata.webViewLink || '', sha256: full.sha256, size: full.blob.size, counts, journal, exportedAt: recovered.exportedAt || '' };
  } catch (error) {
    await patchSettings({ drive: { lastStatus: 'error', lastError: String(error?.message || error) } });
    throw error;
  }
}

async function driveUploadBlob({ fileId = '', name, blob, mimeType, parentId = '', description = '', interactive = false }) {
  const fields = 'id,name,size,modifiedTime,webViewLink,md5Checksum,description';
  const target = fileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=resumable&fields=${encodeURIComponent(fields)}`
    : `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=${encodeURIComponent(fields)}`;
  const metadata = fileId ? { name, description } : { name, description, ...(parentId ? { parents: [parentId] } : {}) };
  const init = await googleFetch(target, {
    method: fileId ? 'PATCH' : 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mimeType, 'X-Upload-Content-Length': String(blob.size) },
    body: JSON.stringify(metadata)
  }, interactive);
  if (!init.ok) throw new Error(`Drive resumable upload init failed: ${init.status} ${(await init.text()).slice(0, 280)}`);
  const sessionUrl = init.headers.get('Location');
  if (!sessionUrl) throw new Error('Drive resumable upload did not return a session URL.');
  const token = await googleToken(interactive);
  const upload = await fetch(sessionUrl, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': mimeType, 'Content-Length': String(blob.size) }, body: blob });
  if (!upload.ok) throw new Error(`Drive upload failed: ${upload.status} ${(await upload.text()).slice(0, 280)}`);
  return upload.json();
}

async function verifyDriveFile(fileId, expectedSize, expectedSha256 = '', fullRoundtrip = false, interactive = false) {
  const metadataResponse = await googleFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,size,modifiedTime,webViewLink,md5Checksum,description`, {}, interactive);
  if (!metadataResponse.ok) throw new Error(`Drive verification metadata failed: ${metadataResponse.status}`);
  const metadata = await metadataResponse.json();
  if (Number(metadata.size || -1) !== Number(expectedSize)) throw new Error(`Drive size verification failed: local ${expectedSize}, remote ${metadata.size}`);
  let roundtripSha256 = '';
  if (fullRoundtrip) {
    const media = await googleFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, {}, interactive);
    if (!media.ok) throw new Error(`Drive round-trip download failed: ${media.status}`);
    roundtripSha256 = await sha256Blob(await media.blob());
    if (expectedSha256 && roundtripSha256 !== expectedSha256) throw new Error('Drive SHA-256 round-trip verification failed.');
  }
  return { metadata, roundtripSha256 };
}

async function getUpdatedSince(storeName, since) {
  const db = await openDb();
  try {
    const store = db.transaction(storeName, 'readonly').objectStore(storeName);
    if (!store.indexNames.contains('updatedAt')) return await requestResult(store.getAll());
    const range = IDBKeyRange.lowerBound(Number(since || 0), true);
    return await requestResult(store.index('updatedAt').getAll(range));
  } finally { db.close(); }
}

async function deltaSnapshotSince(since) {
  const names = ['providers','groups','projects','smartCollections','chats','turns','files','events','checkpoints','syncReceipts','catalogRuns'];
  const values = await Promise.all(names.map((name) => getUpdatedSince(name, since)));
  const delta = Object.fromEntries(names.map((name, index) => [name, values[index]]));
  return { schema: 'project-constellation-delta', schemaVersion: 1, baseFullSyncAt: since, exportedAt: new Date().toISOString(), ...delta };
}

async function uploadDriveIndex({ cfg, folderId, summary, snapshotMeta, journalMeta, interactive = false, forceRoundtrip = false }) {
  const index = {
    schema: 'project-constellation-drive-index', schemaVersion: 2, updatedAt: new Date().toISOString(),
    snapshot: snapshotMeta, journal: journalMeta || null, summary, extension: { name: chrome.runtime.getManifest().name, version: chrome.runtime.getManifest().version }
  };
  const blob = new Blob([JSON.stringify(index, null, 2) + '\n'], { type: 'application/json' });
  const sha256 = await sha256Blob(blob);
  const upload = await driveUploadBlob({ fileId: cfg.drive.indexFileId, name: cfg.drive.indexName, blob, mimeType: 'application/json', parentId: folderId, description: `Project Constellation index; sha256=${sha256}`, interactive });
  const verified = await verifyDriveFile(upload.id, blob.size, sha256, forceRoundtrip, interactive);
  return { fileId: upload.id, url: upload.webViewLink || verified.metadata.webViewLink || '', sha256, size: blob.size };
}

function recordCountFromDelta(delta) {
  return ['providers','groups','projects','smartCollections','chats','turns','files','events','checkpoints','syncReceipts','catalogRuns'].reduce((sum, key) => sum + (Array.isArray(delta[key]) ? delta[key].length : 0), 0);
}

async function driveSync({ interactive = false, forceRoundtrip = false } = {}) {
  const startedAt = Date.now();
  await patchSettings({ drive: { lastStatus: 'syncing', lastError: '' } });
  try {
    let cfg = await settings();
    const artifacts = await resolveDriveArtifacts(interactive);
    const folderId = artifacts.folderId;
    cfg = artifacts.cfg;
    const doFull = interactive || forceRoundtrip || !artifacts.snapshotFileId || !cfg.drive.lastFullSyncAt || startedAt - cfg.drive.lastFullSyncAt >= cfg.drive.fullSnapshotIntervalMs;

    if (!doFull) {
      const delta = await deltaSnapshotSince(cfg.drive.lastFullSyncAt);
      const deltaCount = recordCountFromDelta(delta);
      if (!deltaCount) {
        await chrome.storage.local.remove(DIRTY_KEY);
        await patchSettings({ drive: { lastSyncAt: startedAt, lastStatus: 'verified', lastError: '' } });
        return { ok: true, mode: 'journal', unchanged: true, size: 0, sha256: cfg.drive.journalSha256 || '', fileId: cfg.drive.journalFileId || '' };
      }
      const packed = await gzipText(JSON.stringify(delta) + '\n');
      const sha256 = await sha256Blob(packed.blob);
      const description = `Project Constellation cumulative journal; sha256=${sha256}; baseFullSyncAt=${cfg.drive.lastFullSyncAt}; exportedAt=${delta.exportedAt}`;
      const uploaded = await driveUploadBlob({ fileId: cfg.drive.journalFileId, name: cfg.drive.journalName, blob: packed.blob, mimeType: packed.contentType, parentId: folderId, description, interactive });
      const verified = await verifyDriveFile(uploaded.id, packed.blob.size, sha256, forceRoundtrip, interactive);
      const snapshotMeta = { fileId: cfg.drive.snapshotFileId, name: cfg.drive.snapshotName, size: cfg.drive.snapshotSize || 0, sha256: cfg.drive.snapshotSha256 || '', encoding: cfg.drive.snapshotEncoding || 'gzip', lastFullSyncAt: cfg.drive.lastFullSyncAt, webViewLink: '' };
      const journalMeta = { fileId: uploaded.id, name: uploaded.name, size: Number(uploaded.size || packed.blob.size), sha256, encoding: packed.encoding, baseFullSyncAt: cfg.drive.lastFullSyncAt, recordCount: deltaCount, webViewLink: uploaded.webViewLink || verified.metadata.webViewLink || '' };
      const indexUpload = await uploadDriveIndex({ cfg, folderId, summary: (await dashboard()).summary, snapshotMeta, journalMeta, interactive, forceRoundtrip: false });
      const now = Date.now();
      await patchSettings({ drive: { folderId, journalFileId: uploaded.id, indexFileId: indexUpload.fileId, journalSha256: sha256, journalSize: packed.blob.size, lastSyncAt: now, lastStatus: 'verified', lastError: '' } });
      await chrome.storage.local.remove(DIRTY_KEY);
      await upsert('syncReceipts', { id: `drive-journal:${now}`, provider: 'google-drive', status: 'journal-verified', remoteId: uploaded.id, url: journalMeta.webViewLink, sha256, size: packed.blob.size, updatedAt: now });
      await addEvent('drive-journal-sync', 'checkpoint', uploaded.id, '', { recordCount: deltaCount, sha256, baseFullSyncAt: cfg.drive.lastFullSyncAt });
      return { ok: true, mode: 'journal', fileId: uploaded.id, url: journalMeta.webViewLink, size: packed.blob.size, sha256, recordCount: deltaCount, indexFileId: indexUpload.fileId, indexUrl: indexUpload.url };
    }

    const snap = await snapshot();
    const packed = await gzipText(JSON.stringify(snap) + '\n');
    const sha256 = await sha256Blob(packed.blob);
    const description = `Project Constellation verified full snapshot; sha256=${sha256}; schema=${snap.schemaVersion}; exportedAt=${snap.exportedAt}`;
    const uploaded = await driveUploadBlob({ fileId: cfg.drive.snapshotFileId, name: cfg.drive.snapshotName, blob: packed.blob, mimeType: packed.contentType, parentId: folderId, description, interactive });
    const fullRoundtrip = forceRoundtrip || !cfg.drive.lastRoundtripVerifyAt || startedAt - cfg.drive.lastRoundtripVerifyAt > 86400000;
    const verified = await verifyDriveFile(uploaded.id, packed.blob.size, sha256, fullRoundtrip, interactive);
    const now = Date.now();
    const snapshotMeta = { fileId: uploaded.id, name: uploaded.name, size: Number(uploaded.size || packed.blob.size), sha256, encoding: packed.encoding, lastFullSyncAt: now, webViewLink: uploaded.webViewLink || verified.metadata.webViewLink || '' };

    // Reset the cumulative journal to the new full-checkpoint boundary. Subsequent automatic
    // syncs replace it with all records changed since this full checkpoint.
    const emptyJournal = { schema: 'project-constellation-delta', schemaVersion: 1, baseFullSyncAt: now, exportedAt: new Date(now).toISOString(), providers: [], groups: [], projects: [], smartCollections: [], chats: [], turns: [], files: [], events: [], checkpoints: [], syncReceipts: [], catalogRuns: [] };
    const journalPacked = await gzipText(JSON.stringify(emptyJournal) + '\n');
    const journalSha256 = await sha256Blob(journalPacked.blob);
    const journalDescription = `Project Constellation cumulative journal; sha256=${journalSha256}; baseFullSyncAt=${now}; exportedAt=${emptyJournal.exportedAt}`;
    const journalUpload = await driveUploadBlob({ fileId: cfg.drive.journalFileId, name: cfg.drive.journalName, blob: journalPacked.blob, mimeType: journalPacked.contentType, parentId: folderId, description: journalDescription, interactive });
    const journalVerified = await verifyDriveFile(journalUpload.id, journalPacked.blob.size, journalSha256, false, interactive);
    const journalMeta = { fileId: journalUpload.id, name: journalUpload.name, size: Number(journalUpload.size || journalPacked.blob.size), sha256: journalSha256, encoding: journalPacked.encoding, baseFullSyncAt: now, recordCount: 0, webViewLink: journalUpload.webViewLink || journalVerified.metadata.webViewLink || '' };

    const indexUpload = await uploadDriveIndex({ cfg, folderId, summary: snap.summary, snapshotMeta, journalMeta, interactive, forceRoundtrip });
    await patchSettings({ drive: {
      folderId, snapshotFileId: uploaded.id, journalFileId: journalUpload.id, indexFileId: indexUpload.fileId,
      snapshotSha256: sha256, snapshotSize: packed.blob.size, snapshotEncoding: packed.encoding,
      journalSha256, journalSize: journalPacked.blob.size,
      lastSyncAt: now, lastFullSyncAt: now, lastRoundtripVerifyAt: fullRoundtrip ? now : cfg.drive.lastRoundtripVerifyAt, lastStatus: 'verified', lastError: ''
    } });
    await chrome.storage.local.remove(DIRTY_KEY);
    const checkpointId = `drive:${now}`;
    await upsert('checkpoints', { id: checkpointId, kind: 'drive-full-snapshot', sha256, size: packed.blob.size, remoteId: uploaded.id, url: snapshotMeta.webViewLink, summary: snap.summary, updatedAt: now });
    await upsert('syncReceipts', { id: `drive:${now}`, provider: 'google-drive', status: fullRoundtrip ? 'roundtrip-verified' : 'metadata-verified', remoteId: uploaded.id, url: snapshotMeta.webViewLink, sha256, size: packed.blob.size, updatedAt: now });
    await addEvent('drive-sync', 'checkpoint', checkpointId, '', { snapshotFileId: uploaded.id, indexFileId: indexUpload.fileId, fullRoundtrip, sha256, mode: 'full' });
    return { ok: true, mode: 'full', fileId: uploaded.id, url: snapshotMeta.webViewLink, size: packed.blob.size, sha256, fullRoundtrip, indexFileId: indexUpload.fileId, indexUrl: indexUpload.url };
  } catch (error) {
    await patchSettings({ drive: { lastStatus: 'error', lastError: String(error?.message || error) } });
    throw error;
  }
}

async function markDriveDirty() {
  const now = Date.now();
  await chrome.storage.local.set({ [DIRTY_KEY]: now });
  const cfg = await settings();
  if (!cfg.drive.autoSync || !googleOAuthProvisioned()) return;
  const earliest = Math.max(now + cfg.drive.debounceMs, (cfg.drive.lastSyncAt || 0) + cfg.drive.minSyncIntervalMs);
  await chrome.alarms.create(DRIVE_SYNC_ALARM, { when: earliest });
}

async function disconnectDrive() {
  await chrome.identity.clearAllCachedAuthTokens().catch(() => {});
  await patchSettings({ drive: { lastStatus: 'disconnected', lastError: '' } });
  return { ok: true };
}

async function driveConnectionStatus() {
  const cfg = await settings();
  return { oauthProvisioned: googleOAuthProvisioned(), clientId: googleOAuthClientId(), folderId: cfg.drive.folderId, snapshotFileId: cfg.drive.snapshotFileId, journalFileId: cfg.drive.journalFileId, indexFileId: cfg.drive.indexFileId, lastSyncAt: cfg.drive.lastSyncAt, lastFullSyncAt: cfg.drive.lastFullSyncAt, lastRestoreAt: cfg.drive.lastRestoreAt, lastStatus: cfg.drive.lastStatus, lastError: cfg.drive.lastError };
}

const OFFSCREEN_PATH = 'offscreen.html';
let offscreenCreatePromise = null;

async function ensureOffscreenParser() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_PATH);
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [offscreenUrl] }).catch(() => []);
  if (contexts.length) return true;
  if (!offscreenCreatePromise) {
    offscreenCreatePromise = chrome.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: ['DOM_PARSER'],
      justification: 'Parse authenticated provider HTML and exported conversation documents without opening visible or hidden browser tabs.'
    }).finally(() => { offscreenCreatePromise = null; });
  }
  await offscreenCreatePromise;
  return true;
}

async function parseProviderHtml(providerId, url, html) {
  await ensureOffscreenParser();
  return chrome.runtime.sendMessage({ type: 'PC_OFFSCREEN_PARSE_HTML', target: 'pc-offscreen-parser', payload: { providerId, url, html } });
}

async function fetchProviderHtml(provider, url, { timeoutMs = 25000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET', credentials: 'include', redirect: 'follow', cache: 'no-store', signal: controller.signal,
      headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' }
    });
    if (!response.ok) {
      const error = new Error(`${provider.name} background fetch failed: HTTP ${response.status}`);
      error.name = 'ProviderFetchError';
      error.status = response.status;
      error.url = response.url || url;
      throw error;
    }
    const contentType = response.headers.get('content-type') || '';
    if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) throw new Error(`${provider.name} returned non-HTML content (${contentType || 'unknown'}).`);
    const finalProvider = providers.detectProvider(response.url);
    if (!finalProvider || finalProvider.id !== provider.id) throw new Error(`${provider.name} background fetch redirected outside the provider.`);
    const html = await response.text();
    return { responseUrl: response.url, parsed: await parseProviderHtml(provider.id, response.url, html) };
  } finally { clearTimeout(timeout); }
}

async function hasHistoryPermission() {
  return chrome.permissions?.contains ? chrome.permissions.contains({ permissions: ['history'] }).catch(() => false) : false;
}

async function discoverFromBrowserHistory(provider) {
  if (!(await hasHistoryPermission()) || !chrome.history?.search) return [];
  const found = new Map();
  for (const host of provider.hosts) {
    const rows = await chrome.history.search({ text: host, startTime: 0, maxResults: 100000 }).catch(() => []);
    for (const row of rows) {
      const url = providers.canonicalChatUrl(row.url || '', provider.id);
      if (!providers.isLikelyChatUrl(url, provider.id)) continue;
      const id = providers.chatIdFromUrl(url, provider.id);
      if (!id) continue;
      const previous = found.get(url);
      found.set(url, {
        id, url, providerId: provider.id, title: brain.normalizeText(row.title || previous?.title || 'Untitled chat', 300),
        lastVisitTime: Number(row.lastVisitTime || previous?.lastVisitTime || 0), visitCount: Number(row.visitCount || previous?.visitCount || 0),
        source: 'browser-history'
      });
    }
  }
  return [...found.values()].sort((a,b)=>(b.lastVisitTime||0)-(a.lastVisitTime||0));
}

async function discoverFromBackgroundHome(provider) {
  if (!provider.catalog?.backgroundHtml) return { chats: [], authRequired: false, error: '' };
  try {
    const result = await fetchProviderHtml(provider, provider.home);
    return { chats: result.parsed?.chats || [], authRequired: Boolean(result.parsed?.authRequired), error: '' };
  } catch (error) {
    return { chats: [], authRequired: false, error: String(error?.message || error) };
  }
}

async function discoverKnownChats(provider) {
  return (await getAll('chats')).filter((chat) => chat.providerId === provider.id && providers.isLikelyChatUrl(chat.url || '', provider.id)).map((chat) => ({
    id: chat.id, url: providers.canonicalChatUrl(chat.url, provider.id), title: chat.title || 'Untitled chat', providerId: provider.id, source: 'local-catalog'
  }));
}

async function pingAlreadyOpenProviderTabs(provider) {
  if (!chrome.tabs?.query) return 0;
  const patterns = provider.hosts.flatMap((host) => [`https://${host}/*`]);
  const tabs = await chrome.tabs.query({ url: patterns }).catch(() => []);
  let touched = 0;
  for (const tab of tabs) {
    if (!tab.id) continue;
    try { await chrome.tabs.sendMessage(tab.id, { type: 'PC_RESCAN' }); touched += 1; } catch (_) {}
  }
  return touched;
}

async function discoverProviderZeroTab(provider) {
  const [historyChats, homeResult, knownChats, liveTabs] = await Promise.all([
    discoverFromBrowserHistory(provider), discoverFromBackgroundHome(provider), discoverKnownChats(provider), pingAlreadyOpenProviderTabs(provider)
  ]);
  const merged = new Map();
  for (const chat of [...knownChats, ...homeResult.chats, ...historyChats]) {
    const url = providers.canonicalChatUrl(chat.url || '', provider.id);
    if (!url || !providers.isLikelyChatUrl(url, provider.id)) continue;
    const existing = merged.get(url) || {};
    merged.set(url, { ...existing, ...chat, url, id: providers.chatIdFromUrl(url, provider.id), providerId: provider.id });
  }
  return {
    chats: [...merged.values()], authRequired: homeResult.authRequired, homeError: homeResult.error, liveTabs,
    sources: { browserHistory: historyChats.length, backgroundHome: homeResult.chats.length, existingCatalog: knownChats.length, liveTabs }
  };
}

async function captureChatZeroTab(provider, chat) {
  try {
    const result = await fetchProviderHtml(provider, chat.url);
    const parsed = result.parsed || {};
    if (parsed.authRequired) return { ok: false, authRequired: true, metadataOnly: true, turns: 0, files: 0 };
    const now = Date.now();
    const chatId = providers.chatIdFromUrl(chat.url, provider.id) || chat.id;
    const title = brain.normalizeText(parsed.title || chat.title || 'Untitled chat', 300);
    const payload = [
      { type: 'CHAT_UPSERT', data: { ...chat, id: chatId, providerId: provider.id, providerName: provider.name, title, url: chat.url, projectId: chat.projectId || `${provider.id}:inbox`, projectName: chat.projectName || 'Inbox', source: 'zero-tab-background-fetch', lastSeenAt: now, updatedAt: now, coverage: parsed.turns?.length ? 'server-rendered-content' : 'metadata-only' } },
      ...(parsed.turns || []).map((turn) => ({ type: 'TURN_UPSERT', data: turn })),
      ...(parsed.files || []).map((file) => ({ type: 'FILE_UPSERT', data: file }))
    ];
    await ingestBatch(payload);
    return { ok: true, authRequired: false, metadataOnly: !(parsed.turns || []).length, turns: parsed.turns?.length || 0, files: parsed.files?.length || 0 };
  } catch (error) {
    const statusCode = Number(error?.status || 0);
    if ((statusCode === 404 || statusCode === 410) && chat?.id) {
      const now = Date.now();
      await ingestBatch([{ type: 'CHAT_UPSERT', data: {
        ...chat, id: chat.id, providerId: provider.id, providerName: provider.name,
        source: 'zero-tab-background-fetch', status: 'unavailable',
        statusDetail: `Provider returned HTTP ${statusCode}. Archived Constellation content is preserved locally and in configured remote checkpoints.`,
        coverage: chat.coverage || 'archived', updatedAt: now
      } }]);
    } else if ((statusCode === 401 || statusCode === 403) && chat?.id) {
      const now = Date.now();
      await ingestBatch([{ type: 'CHAT_UPSERT', data: {
        ...chat, id: chat.id, providerId: provider.id, providerName: provider.name,
        source: 'zero-tab-background-fetch', status: 'auth-required',
        statusDetail: `Provider requires authentication before background catalog refresh can continue (HTTP ${statusCode}).`,
        updatedAt: now
      } }]);
    }
    return { ok: false, authRequired: false, metadataOnly: true, turns: 0, files: 0, error: String(error?.message || error) };
  }
}

async function catalogState() { return (await chrome.storage.local.get(CATALOG_STATE_KEY))[CATALOG_STATE_KEY] || null; }
function publicCatalogState(state) { if (!state) return null; const { queue, ...rest } = state; return { ...rest, queueLength: Array.isArray(queue) ? queue.length : 0 }; }
async function saveCatalogState(state) { state.updatedAt = Date.now(); await chrome.storage.local.set({ [CATALOG_STATE_KEY]: state }); if (state.id) await upsert('catalogRuns', { ...state, queue: undefined, updatedAt: state.updatedAt }); return state; }
async function scheduleCatalogStep(delay = 600) { await chrome.alarms.create(CATALOG_ALARM, { when: Date.now() + delay }); }

async function startCatalog(providerIds = [], options = {}) {
  const selected = (providerIds.length ? providerIds : providers.PROVIDERS.map((provider) => provider.id)).filter((id) => providers.byId[id]);
  const existing = await catalogState();
  if (existing?.status === 'running') return { ok: true, state: existing };
  const state = {
    id: `catalog:${Date.now()}`, status: 'running', mode: 'zero-tab', autoTriggered: Boolean(options.autoTriggered), waitingForIdle: false,
    providerIds: selected, providerIndex: 0, stage: 'discover', queue: [], chatIndex: 0, discovered: 0, captured: 0, metadataOnly: 0,
    turnsCaptured: 0, filesCaptured: 0, errors: [], sourceCounts: {}, currentProviderId: '', currentUrl: '', startedAt: Date.now(), updatedAt: Date.now()
  };
  await saveCatalogState(state);
  await addEvent('catalog-start', 'catalog', state.id, '', { providers: selected, mode: 'zero-tab' });
  await scheduleCatalogStep(100);
  return { ok: true, state };
}

async function pauseCatalog() { const state = await catalogState(); if (!state) return { ok: true, state: null }; state.status = 'paused'; await saveCatalogState(state); await chrome.alarms.clear(CATALOG_ALARM); return { ok: true, state }; }
async function resumeCatalog() { const state = await catalogState(); if (!state) return startCatalog(); state.status = 'running'; await saveCatalogState(state); await scheduleCatalogStep(100); return { ok: true, state }; }
async function stopCatalog() { const state = await catalogState(); if (!state) return { ok: true, state: null }; state.status = 'stopped'; await saveCatalogState(state); await chrome.alarms.clear(CATALOG_ALARM); await markDriveDirty(); return { ok: true, state }; }

async function processCatalogStep() {
  const state = await catalogState();
  if (!state || state.status !== 'running') return;
  if (state.autoTriggered) {
    const cfg = await settings();
    if (cfg.catalog.idleOnly && chrome.idle?.queryState) {
      const idleState = await chrome.idle.queryState(120).catch(() => 'active');
      if (idleState === 'active') { state.waitingForIdle = true; await saveCatalogState(state); await scheduleCatalogStep(5 * 60 * 1000); return; }
      if (state.waitingForIdle) { state.waitingForIdle = false; await saveCatalogState(state); }
    }
  }

  if (state.providerIndex >= state.providerIds.length) {
    state.status = 'completed'; state.stage = 'done';
    if (state.autoTriggered) await patchSettings({ catalog: { lastAutoSweepAt: Date.now() } });
    await saveCatalogState(state);
    await addEvent('catalog-complete', 'catalog', state.id, '', { discovered: state.discovered, captured: state.captured, metadataOnly: state.metadataOnly, turnsCaptured: state.turnsCaptured, filesCaptured: state.filesCaptured, errors: state.errors.length, mode: 'zero-tab' });
    await markDriveDirty();
    const cfg = await settings();
    if (cfg.drive.autoSync && googleOAuthProvisioned()) chrome.alarms.create(DRIVE_SYNC_ALARM, { when: Date.now() + 1000 });
    return;
  }

  const providerId = state.providerIds[state.providerIndex];
  const provider = providers.byId[providerId];
  state.currentProviderId = providerId;

  try {
    if (state.stage === 'discover') {
      state.currentUrl = provider.home;
      const discovery = await discoverProviderZeroTab(provider);
      state.sourceCounts[providerId] = discovery.sources;
      if (discovery.authRequired && !discovery.chats.length) {
        await upsert('providers', { id: provider.id, name: provider.name, home: provider.home, catalogStatus: 'auth-required', catalogMode: 'zero-tab', updatedAt: Date.now() });
      }
      if (discovery.homeError) state.errors.push({ providerId, type: 'background-home', message: discovery.homeError, at: Date.now() });
      const unique = [...new Map(discovery.chats.map((chat) => [chat.url, chat])).values()];
      state.queue = unique;
      state.discovered += unique.length;
      state.chatIndex = 0;
      state.stage = 'capture';
      await upsert('providers', { id: provider.id, name: provider.name, home: provider.home, catalogStatus: 'cataloguing', catalogMode: 'zero-tab', sourceCounts: discovery.sources, updatedAt: Date.now() });
      await ingestBatch(unique.map((chat) => ({ type: 'CHAT_UPSERT', data: { ...chat, providerName: provider.name, projectId: chat.projectId || `${providerId}:inbox`, projectName: chat.projectName || 'Inbox', source: chat.source || 'zero-tab-discovery', lastSeenAt: chat.lastVisitTime || Date.now(), updatedAt: Date.now() } })));
      await saveCatalogState(state);
      await scheduleCatalogStep(80);
      return;
    }

    if (state.stage === 'capture') {
      if (state.chatIndex >= state.queue.length) {
        await upsert('providers', { id: provider.id, name: provider.name, home: provider.home, catalogStatus: 'complete', catalogMode: 'zero-tab', sourceCounts: state.sourceCounts[providerId] || {}, updatedAt: Date.now() });
        state.providerIndex += 1; state.stage = 'discover'; state.queue = []; state.chatIndex = 0; state.currentUrl = '';
        await saveCatalogState(state); await scheduleCatalogStep(80); return;
      }
      const chat = state.queue[state.chatIndex];
      state.currentUrl = chat.url;
      const captured = await captureChatZeroTab(provider, chat);
      if (captured.ok) {
        state.captured += 1; state.turnsCaptured += captured.turns || 0; state.filesCaptured += captured.files || 0;
        if (captured.metadataOnly) state.metadataOnly += 1;
      } else {
        state.metadataOnly += 1;
        if (captured.authRequired) state.errors.push({ providerId, url: chat.url, type: 'auth-required', at: Date.now() });
        else if (captured.error) state.errors.push({ providerId, url: chat.url, type: 'background-fetch', message: captured.error, at: Date.now() });
      }
      state.chatIndex += 1;
      if (state.errors.length > 300) state.errors = state.errors.slice(-300);
      await saveCatalogState(state);
      await scheduleCatalogStep(60);
    }
  } catch (error) {
    state.errors.push({ providerId, url: state.currentUrl, message: String(error?.message || error), at: Date.now() });
    if (state.errors.length > 300) state.errors = state.errors.slice(-300);
    if (state.stage === 'capture') state.chatIndex += 1;
    else { state.providerIndex += 1; state.stage = 'discover'; state.queue = []; state.chatIndex = 0; }
    await saveCatalogState(state);
    await addEvent('catalog-error', 'catalog', state.id, '', { providerId, url: state.currentUrl, error: String(error?.message || error), mode: 'zero-tab' });
    await scheduleCatalogStep(250);
  }
}


let fullCaptureProcessing = false;

async function fullCaptureState() {
  return (await chrome.storage.local.get(FULL_CAPTURE_STATE_KEY))[FULL_CAPTURE_STATE_KEY] || null;
}

function publicFullCaptureState(state) {
  if (!state) return null;
  const { queue, ...rest } = state;
  return { ...rest, queueLength: Array.isArray(queue) ? queue.length : 0 };
}

async function saveFullCaptureState(state) {
  state.updatedAt = Date.now();
  await chrome.storage.local.set({ [FULL_CAPTURE_STATE_KEY]: state });
  if (state.id) await upsert('catalogRuns', { ...state, queue: undefined, updatedAt: state.updatedAt });
  return state;
}

async function scheduleFullCaptureStep(delay = 250) {
  await chrome.alarms.create(FULL_CAPTURE_ALARM, { when: Date.now() + Math.max(50, delay) });
}

async function closeFullCaptureWindow(state = null) {
  const current = state || await fullCaptureState();
  if (current?.windowId && chrome.windows?.remove) await chrome.windows.remove(current.windowId).catch(() => {});
  if (current) {
    current.windowId = 0;
    current.tabId = 0;
    await saveFullCaptureState(current);
  }
}

async function captureWindowStillExists(state) {
  if (!state?.windowId || !state?.tabId) return false;
  try {
    const [win, tab] = await Promise.all([chrome.windows.get(state.windowId), chrome.tabs.get(state.tabId)]);
    return Boolean(win && tab && tab.windowId === state.windowId);
  } catch (_) { return false; }
}

async function ensureFullCaptureWindow(state, initialUrl) {
  if (await captureWindowStillExists(state)) return state;
  const win = await chrome.windows.create({
    url: initialUrl || 'about:blank', type: 'normal', focused: false, state: 'minimized'
  });
  if (!win?.id) throw new Error('Chrome did not create the dedicated full-capture window.');
  let tab = win.tabs?.[0];
  if (!tab?.id) tab = (await chrome.tabs.query({ windowId: win.id }))[0];
  if (!tab?.id) { await chrome.windows.remove(win.id).catch(() => {}); throw new Error('Full-capture window was created without a usable tab.'); }
  state.windowId = win.id;
  state.tabId = tab.id;
  await saveFullCaptureState(state);
  return state;
}

async function waitForTabComplete(tabId, timeoutMs = 90000) {
  const existing = await chrome.tabs.get(tabId).catch(() => null);
  if (existing?.status === 'complete') return existing;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('Timed out waiting for capture page to finish loading.')); }, timeoutMs);
    const listener = (updatedTabId, changeInfo, tab) => {
      if (updatedTabId !== tabId || changeInfo.status !== 'complete') return;
      cleanup(); resolve(tab);
    };
    const cleanup = () => { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(listener); };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function waitForCaptureContent(tabId, expectedProviderId, timeoutMs = 25000) {
  const started = Date.now();
  let lastError = '';
  while (Date.now() - started < timeoutMs) {
    try {
      const result = await chrome.tabs.sendMessage(tabId, { type: 'PC_GET_PROVIDER' });
      if (result?.ok && (!expectedProviderId || result.provider?.id === expectedProviderId)) return result;
    } catch (error) { lastError = String(error?.message || error); }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Capture content script did not become ready${lastError ? `: ${lastError}` : '.'}`);
}

async function navigateCaptureTab(state, provider, url) {
  state = await ensureFullCaptureWindow(state, url);
  const current = await chrome.tabs.get(state.tabId).catch(() => null);
  if (!current || current.url !== url) await chrome.tabs.update(state.tabId, { url, active: true });
  await waitForTabComplete(state.tabId);
  await waitForCaptureContent(state.tabId, provider.id);
  return state;
}

async function sendCaptureControl(state, action) {
  if (!state?.tabId) return;
  await chrome.tabs.sendMessage(state.tabId, { type: 'PC_MANUAL_CAPTURE_CONTROL', action }).catch(() => {});
}

function fullCaptureSpeed(value) {
  return ['gentle','balanced','fast'].includes(value) ? value : 'balanced';
}

async function startFullCapture(providerIds = [], options = {}) {
  const selected = (providerIds.length ? providerIds : providers.PROVIDERS.map((provider) => provider.id)).filter((id) => providers.byId[id]);
  const existing = await fullCaptureState();
  if (existing?.status === 'running' || existing?.status === 'paused') return { ok: true, state: publicFullCaptureState(existing) };
  if (existing?.windowId) await closeFullCaptureWindow(existing);
  const state = {
    id: `full-capture:${Date.now()}`, mode: 'manual-full-capture', status: 'running', speed: fullCaptureSpeed(options.speed),
    providerIds: selected, providerIndex: 0, stage: 'discover', queue: [], chatIndex: 0,
    discovered: 0, captured: 0, completeChats: 0, partialChats: 0, turnsCaptured: 0, filesCaptured: 0,
    errors: [], currentProviderId: '', currentUrl: '', currentTitle: '', windowId: 0, tabId: 0,
    startedAt: Date.now(), updatedAt: Date.now(), userInitiated: true
  };
  await saveFullCaptureState(state);
  await addEvent('full-capture-start', 'catalog', state.id, '', { providers: selected, speed: state.speed, mode: state.mode });
  await scheduleFullCaptureStep(100);
  return { ok: true, state: publicFullCaptureState(state) };
}

async function pauseFullCapture() {
  const state = await fullCaptureState();
  if (!state) return { ok: true, state: null };
  state.status = 'paused';
  await saveFullCaptureState(state);
  await chrome.alarms.clear(FULL_CAPTURE_ALARM);
  await sendCaptureControl(state, 'pause');
  return { ok: true, state: publicFullCaptureState(state) };
}

async function resumeFullCapture() {
  const state = await fullCaptureState();
  if (!state || ['completed','stopped'].includes(state.status)) return startFullCapture();
  state.status = 'running';
  await saveFullCaptureState(state);
  await sendCaptureControl(state, 'run');
  await scheduleFullCaptureStep(100);
  return { ok: true, state: publicFullCaptureState(state) };
}

async function stopFullCapture() {
  const state = await fullCaptureState();
  if (!state) return { ok: true, state: null };
  state.status = 'stopped';
  await saveFullCaptureState(state);
  await chrome.alarms.clear(FULL_CAPTURE_ALARM);
  await sendCaptureControl(state, 'stop');
  await closeFullCaptureWindow(state);
  await addEvent('full-capture-stop', 'catalog', state.id, '', { captured: state.captured, completeChats: state.completeChats, partialChats: state.partialChats });
  await markDriveDirty();
  return { ok: true, state: publicFullCaptureState(await fullCaptureState()) };
}

async function processFullCaptureStep() {
  if (fullCaptureProcessing) return;
  fullCaptureProcessing = true;
  try {
    let state = await fullCaptureState();
    if (!state || state.status !== 'running') return;
    if (state.providerIndex >= state.providerIds.length) {
      state.status = 'completed'; state.stage = 'done'; state.currentProviderId = ''; state.currentUrl = ''; state.currentTitle = '';
      await saveFullCaptureState(state);
      await closeFullCaptureWindow(state);
      await addEvent('full-capture-complete', 'catalog', state.id, '', { discovered: state.discovered, captured: state.captured, completeChats: state.completeChats, partialChats: state.partialChats, turnsCaptured: state.turnsCaptured, filesCaptured: state.filesCaptured, errors: state.errors.length });
      await markDriveDirty();
      const cfg = await settings();
      if (cfg.drive.autoSync && googleOAuthProvisioned()) chrome.alarms.create(DRIVE_SYNC_ALARM, { when: Date.now() + 1000 });
      return;
    }

    const providerId = state.providerIds[state.providerIndex];
    const provider = providers.byId[providerId];
    state.currentProviderId = providerId;

    if (state.stage === 'discover') {
      state.currentUrl = provider.home; state.currentTitle = `${provider.name} history discovery`;
      await saveFullCaptureState(state);
      state = await navigateCaptureTab(state, provider, provider.home);
      const [manual, passive] = await Promise.all([
        chrome.tabs.sendMessage(state.tabId, { type: 'PC_MANUAL_DISCOVER_CHATS', options: { speed: state.speed } }).catch((error) => ({ ok: false, error: String(error?.message || error), chats: [] })),
        discoverProviderZeroTab(provider).catch((error) => ({ chats: [], homeError: String(error?.message || error), sources: {} }))
      ]);
      const latest = await fullCaptureState();
      if (!latest || latest.id !== state.id || latest.status !== 'running') return;
      state = latest;
      const merged = new Map();
      for (const chat of [...(passive.chats || []), ...(manual.chats || [])]) {
        const url = providers.canonicalChatUrl(chat.url || '', provider.id);
        if (!url || !providers.isLikelyChatUrl(url, provider.id)) continue;
        merged.set(url, { ...chat, id: providers.chatIdFromUrl(url, provider.id), url, providerId: provider.id, providerName: provider.name });
      }
      const queue = [...merged.values()];
      state.queue = queue; state.chatIndex = 0; state.discovered += queue.length; state.stage = 'capture';
      if (!manual?.ok && manual?.error) state.errors.push({ providerId, type: 'manual-discovery', message: manual.error, at: Date.now() });
      if (passive?.homeError) state.errors.push({ providerId, type: 'zero-tab-discovery', message: passive.homeError, at: Date.now() });
      await ingestBatch(queue.map((chat) => ({ type: 'CHAT_UPSERT', data: { ...chat, source: chat.source || 'manual-full-discovery', projectId: chat.projectId || `${providerId}:inbox`, projectName: chat.projectName || 'Inbox', lastSeenAt: chat.lastSeenAt || Date.now(), updatedAt: Date.now() } })));
      await upsert('providers', { id: provider.id, name: provider.name, home: provider.home, catalogStatus: 'full-capture', catalogMode: 'manual-full-capture', updatedAt: Date.now() });
      await saveFullCaptureState(state);
      await scheduleFullCaptureStep(200);
      return;
    }

    if (state.stage === 'capture') {
      if (state.chatIndex >= state.queue.length) {
        await upsert('providers', { id: provider.id, name: provider.name, home: provider.home, catalogStatus: 'complete', catalogMode: 'manual-full-capture', updatedAt: Date.now() });
        state.providerIndex += 1; state.stage = 'discover'; state.queue = []; state.chatIndex = 0; state.currentUrl = ''; state.currentTitle = '';
        await saveFullCaptureState(state); await scheduleFullCaptureStep(150); return;
      }
      const chat = state.queue[state.chatIndex];
      state.currentUrl = chat.url; state.currentTitle = chat.title || 'Untitled chat';
      await saveFullCaptureState(state);
      try {
        state = await navigateCaptureTab(state, provider, chat.url);
        const result = await chrome.tabs.sendMessage(state.tabId, { type: 'PC_MANUAL_FULL_CAPTURE', options: { speed: state.speed, maxSteps: 10000 } });
        const latest = await fullCaptureState();
        if (!latest || latest.id !== state.id || latest.status !== 'running') return;
        state = latest;
        if (!result?.ok) throw new Error(result?.error || 'Full capture did not complete.');
        state.captured += 1;
        state.turnsCaptured += Number(result.totalTurnsObserved || result.turns || 0);
        state.filesCaptured += Number(result.totalFilesObserved || result.files || 0);
        if (result.complete) state.completeChats += 1; else state.partialChats += 1;
        state.chatIndex += 1;
      } catch (error) {
        const latest = await fullCaptureState();
        if (!latest || latest.id !== state.id || latest.status !== 'running') return;
        state = latest;
        state.errors.push({ providerId, url: chat.url, type: 'manual-full-capture', message: String(error?.message || error), at: Date.now() });
        state.partialChats += 1; state.chatIndex += 1;
      }
      if (state.errors.length > 300) state.errors = state.errors.slice(-300);
      await saveFullCaptureState(state);
      await scheduleFullCaptureStep(state.speed === 'gentle' ? 1200 : state.speed === 'fast' ? 180 : 450);
    }
  } catch (error) {
    const state = await fullCaptureState();
    if (state?.status === 'running') {
      state.errors.push({ providerId: state.currentProviderId, url: state.currentUrl, type: 'manual-full-capture-engine', message: String(error?.message || error), at: Date.now() });
      if (state.errors.length > 300) state.errors = state.errors.slice(-300);
      if (state.stage === 'capture') state.chatIndex += 1;
      else { state.providerIndex += 1; state.stage = 'discover'; state.queue = []; state.chatIndex = 0; }
      await saveFullCaptureState(state);
      await addEvent('full-capture-error', 'catalog', state.id, '', { providerId: state.currentProviderId, url: state.currentUrl, error: String(error?.message || error) });
      await scheduleFullCaptureStep(1000);
    }
  } finally { fullCaptureProcessing = false; }
}


async function maybeStartAutomaticCatalog() {
  const cfg = await settings();
  if (!cfg.catalog.autoSweep) return { ok: true, skipped: 'disabled' };
  const current = await catalogState();
  if (current && ['running','paused'].includes(current.status)) return { ok: true, skipped: 'already-running' };
  const minAge = Math.max(1, Number(cfg.catalog.intervalHours || 24)) * 60 * 60 * 1000;
  if (cfg.catalog.lastAutoSweepAt && Date.now() - cfg.catalog.lastAutoSweepAt < minAge) return { ok: true, skipped: 'fresh' };
  if (cfg.catalog.idleOnly && chrome.idle?.queryState) {
    const idleState = await chrome.idle.queryState(120).catch(() => 'active');
    if (idleState === 'active') return { ok: true, skipped: 'active' };
  }
  const providerIds = Array.isArray(cfg.catalog.providerIds) && cfg.catalog.providerIds.length ? cfg.catalog.providerIds : providers.PROVIDERS.map((provider) => provider.id);
  return startCatalog(providerIds, { autoTriggered: true });
}

async function updateAttentionBadge() {
  const chats = await getAll('chats');
  const attentionStates = new Set(['blocked-approval','errored','stalled','auth-required','unavailable']);
  const count = chats.filter((chat) => attentionStates.has(chat.status)).length;
  await chrome.action.setBadgeText({ text: count ? String(Math.min(count, 99)) : '' }).catch(() => {});
  await chrome.action.setTitle({ title: count ? `Project Constellation · ${count} chat${count === 1 ? '' : 's'} need attention` : 'Project Constellation · all tracked chats clear' }).catch(() => {});
}

async function watchForStalls() {
  const cfg = await settings();
  const chats = await getAll('chats');
  const now = Date.now();
  const stalled = chats.filter((chat) => chat.status === 'running' && chat.lastActivityAt && now - chat.lastActivityAt > cfg.stallThresholdMs);
  for (const chat of stalled) {
    const stalledChat = await upsert('chats', { id: chat.id, status: 'stalled', statusDetail: `No observed activity for ${Math.round((now - chat.lastActivityAt) / 1000)} seconds.`, updatedAt: now });
    await putSearchDocs([searchDoc('chat', stalledChat)]);
    await addEvent('chat-stalled', 'chat', chat.id, chat.id, { providerId: chat.providerId || '', lastActivityAt: chat.lastActivityAt });
  }
  if (stalled.length) { await markDriveDirty(); await updateAttentionBadge(); }
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
  await chrome.alarms.create(STALL_ALARM, { periodInMinutes: 1 });
  await chrome.alarms.create(CATALOG_MAINTENANCE_ALARM, { periodInMinutes: 60 });
  await ensurePersistentStorage();
  await ensureSearchIndex();
  await updateAttentionBadge();
});

chrome.runtime.onStartup.addListener(async () => {
  await chrome.alarms.create(STALL_ALARM, { periodInMinutes: 1 });
  await chrome.alarms.create(CATALOG_MAINTENANCE_ALARM, { periodInMinutes: 60 });
  await ensurePersistentStorage();
  await ensureSearchIndex();
  await updateAttentionBadge();
  const state = await catalogState();
  if (state?.status === 'running') await scheduleCatalogStep(1000);
  const heavyState = await fullCaptureState();
  if (heavyState?.status === 'running') await scheduleFullCaptureStep(1000);
  const dirty = (await chrome.storage.local.get(DIRTY_KEY))[DIRTY_KEY];
  const cfg = await settings();
  if (dirty && cfg.drive.autoSync && googleOAuthProvisioned()) await chrome.alarms.create(DRIVE_SYNC_ALARM, { when: Date.now() + 3000 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === CATALOG_ALARM) processCatalogStep().catch(() => {});
  else if (alarm.name === FULL_CAPTURE_ALARM) processFullCaptureStep().catch(() => {});
  else if (alarm.name === STALL_ALARM) watchForStalls().catch(() => {});
  else if (alarm.name === CATALOG_MAINTENANCE_ALARM) maybeStartAutomaticCatalog().catch(() => {});
  else if (alarm.name === DRIVE_SYNC_ALARM) driveSync({ interactive: false }).catch(async () => {
    const dirty = (await chrome.storage.local.get(DIRTY_KEY))[DIRTY_KEY];
    if (dirty) chrome.alarms.create(DRIVE_SYNC_ALARM, { when: Date.now() + 30 * 60 * 1000 });
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case 'PC_BRAIN_INGEST': return ingest(message.payload);
      case 'PC_BRAIN_INGEST_BATCH': return ingestBatch(message.payload || []);
      case 'PC_BRAIN_SNAPSHOT': return { ok: true, snapshot: await snapshot() };
      case 'PC_BRAIN_DASHBOARD': return { ok: true, dashboard: await dashboard() };
      case 'PC_BRAIN_SEARCH': return { ok: true, results: await searchBrain(message.query || '', message.limit || 60) };
      case 'PC_HOME_SUMMARY': return { ok: true, home: await homeSummary() };
      case 'PC_HOME_SEARCH': return { ok: true, result: await groupedHomeSearch(message.query || '', message.limit || 40) };
      case 'PC_ORG_SUMMARY': return { ok: true, organization: await organizationSummary() };
      case 'PC_ORG_CHATS': return { ok: true, items: await organizationChats(message.filters || {}) };
      case 'PC_ORG_GROUP_CREATE': return { ok: true, item: await createGroup(message.input || {}) };
      case 'PC_ORG_PROJECT_CREATE': return { ok: true, item: await createWorkspaceProject(message.input || {}) };
      case 'PC_ORG_SMART_CREATE': return { ok: true, item: await createSmartCollection(message.input || {}) };
      case 'PC_ORG_ENTITY_UPDATE': return { ok: true, item: await updateOrganizationEntity(message.kind, message.id, message.patch || {}) };
      case 'PC_ORG_ENTITY_DELETE': return { ok: true, result: await deleteOrganizationEntity(message.kind, message.id) };
      case 'PC_ORG_CHAT_PATCH': return { ok: true, items: await patchChatOrganization(message.chatIds || [], message.patch || {}) };
      case 'PC_BRAIN_LIST': return { ok: true, items: await listBrainEntities(message.entityType || 'chat', message.limit || 80, message.offset || 0) };
      case 'PC_HISTORY_STATUS': return { ok: true, granted: await hasHistoryPermission(), hiddenTabs: false, mode: 'zero-tab' };
      case 'PC_STORAGE_HEALTH': return { ok: true, storage: await ensurePersistentStorage() };
      case 'PC_SEARCH_REBUILD': return { ok: true, counts: await rebuildSearchIndex() };
      case 'PC_PROVIDER_LIST': return { ok: true, providers: providers.PROVIDERS };
      case 'PC_BRAIN_SETTINGS_GET': {
        const cfg = await settings();
        const hasGithubToken = Boolean((await chrome.storage.local.get(GITHUB_SECRET_KEY))[GITHUB_SECRET_KEY]);
        return { ok: true, settings: cfg, hasGithubToken, drive: await driveConnectionStatus(), catalog: publicCatalogState(await catalogState()) };
      }
      case 'PC_BRAIN_SETTINGS_SET': {
        const current = await settings();
        const next = await saveSettings({ ...current, ...(message.settings || {}), github: { ...current.github, ...(message.settings?.github || {}) }, drive: { ...current.drive, ...(message.settings?.drive || {}) }, catalog: { ...current.catalog, ...(message.settings?.catalog || {}) } });
        if (typeof message.githubToken === 'string' && message.githubToken) await chrome.storage.local.set({ [GITHUB_SECRET_KEY]: message.githubToken });
        if (message.clearGithubToken) await chrome.storage.local.remove(GITHUB_SECRET_KEY);
        return { ok: true, settings: next };
      }
      case 'PC_GITHUB_SYNC': return githubSync();
      case 'PC_DRIVE_CONNECT': {
        await googleToken(true);
        await patchSettings({ drive: { lastStatus: 'connected', lastError: '' } });
        return { ok: true, connection: await driveConnectionStatus() };
      }
      case 'PC_DRIVE_SYNC': return driveSync({ interactive: Boolean(message.interactive), forceRoundtrip: Boolean(message.forceRoundtrip) });
      case 'PC_DRIVE_RESTORE': return restoreFromDrive({ interactive: Boolean(message.interactive) });
      case 'PC_DRIVE_DISCONNECT': return disconnectDrive();
      case 'PC_DRIVE_STATUS': return { ok: true, connection: await driveConnectionStatus() };
      case 'PC_CATALOG_START': return startCatalog(message.providerIds || []);
      case 'PC_CATALOG_PAUSE': return pauseCatalog();
      case 'PC_CATALOG_RESUME': return resumeCatalog();
      case 'PC_CATALOG_STOP': return stopCatalog();
      case 'PC_CATALOG_GET': return { ok: true, state: publicCatalogState(await catalogState()) };
      case 'PC_FULL_CAPTURE_START': return startFullCapture(message.providerIds || [], { speed: message.speed });
      case 'PC_FULL_CAPTURE_PAUSE': return pauseFullCapture();
      case 'PC_FULL_CAPTURE_RESUME': return resumeFullCapture();
      case 'PC_FULL_CAPTURE_STOP': return stopFullCapture();
      case 'PC_FULL_CAPTURE_GET': return { ok: true, state: publicFullCaptureState(await fullCaptureState()) };
      case 'PC_BRAIN_CLEAR': await deleteAllStores(); await chrome.storage.local.remove([CATALOG_STATE_KEY, FULL_CAPTURE_STATE_KEY, DIRTY_KEY]); await updateAttentionBadge(); return { ok: true };
      default: return { ok: false, error: 'Unknown message' };
    }
  })().then(sendResponse).catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
  return true;
});

if (chrome.downloads?.onCreated) {
  chrome.downloads.onCreated.addListener(async (item) => {
    const cfg = await settings();
    if (!cfg.deepDownloadTracking) return;
    const source = item.referrer || item.finalUrl || item.url || '';
    const provider = providers.detectProvider(item.referrer || item.url || '');
    if (!provider) return;
    const chatId = providers.chatIdFromUrl(item.referrer || '', provider.id) || `${provider.id}:downloads`;
    const external = providers.classifyExternalUrl(item.url || '');
    const file = {
      id: `download:${item.id}`, providerId: provider.id, chatId, name: item.filename || `download-${item.id}`,
      href: item.finalUrl || item.url || '', externalUrl: external.external ? (item.finalUrl || item.url || '') : '', externalProvider: external.provider,
      kind: 'download', source: 'downloads-api', sourcePage: source, updatedAt: Date.now()
    };
    await upsert('files', file);
    await addEvent('download-created', 'file', file.id, chatId, { filename: file.name, providerId: provider.id });
    await markDriveDirty();
  });
}
