import './src/brain-core.js';
import './src/provider-core.js';
import './src/integrity-core.js';
import './src/knowledge-core.js';
import './src/health-core.js';

const brain = globalThis.ProjectConstellationBrainCore;
const providers = globalThis.ProjectConstellationProviders;
const integrity = globalThis.ProjectConstellationIntegrityCore;
const knowledge = globalThis.ProjectConstellationKnowledgeCore;
const health = globalThis.ProjectConstellationHealthCore;

const DB_NAME = 'project-constellation-brain';
const DB_VERSION = 10;
const SETTINGS_KEY = 'projectConstellationBrainSettings';
const GITHUB_SECRET_KEY = 'projectConstellationGithubSecret';
const GITHUB_REFRESH_KEY = 'projectConstellationGithubRefresh';
const GITHUB_TOKEN_META_KEY = 'projectConstellationGithubTokenMeta';
const GITHUB_OAUTH_PENDING_KEY = 'projectConstellationGithubOauthPending';
const BUILT_GITHUB_CLIENT_ID = 'PROJECT_CONSTELLATION_GITHUB_CLIENT_ID';
const CATALOG_STATE_KEY = 'projectConstellationCatalogState';
const FULL_CAPTURE_STATE_KEY = 'projectConstellationFullCaptureState';
const DIRTY_KEY = 'projectConstellationDriveDirtyAt';
const EVENT_LIMIT = 12000;
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_SYNC_ALARM = 'project-constellation-drive-sync';
const CATALOG_ALARM = 'project-constellation-catalog-step';
const FULL_CAPTURE_ALARM = 'project-constellation-full-capture-step';
const STALL_ALARM = 'project-constellation-stall-watch';
const CATALOG_MAINTENANCE_ALARM = 'project-constellation-catalog-maintenance';
const APPROVAL_RECOVERY_STATE_KEY = 'projectConstellationApprovalRecoveryState';
const APPROVAL_RECOVERY_ALARM = 'project-constellation-approval-recovery-step';
const REQUEST_GOVERNOR_KEY = 'projectConstellationRequestGovernor';
const REFRESH_RECOVERY_KEY = 'projectConstellationRefreshRecovery';
const INTEGRITY_DEBOUNCE_ALARM = 'project-constellation-integrity-debounce';
const INTEGRITY_MAINTENANCE_ALARM = 'project-constellation-integrity-maintenance';
const KNOWLEDGE_INDEX_ALARM = 'project-constellation-knowledge-index';
const KNOWLEDGE_BACKFILL_KEY = 'projectConstellationKnowledgeBackfill';
const LIVE_HEALTH_CONTEXT_TTL_MS = 5000;
const LIVE_NETWORK_TTL_MS = 10 * 60 * 1000;
const BRANCH_CONTINUATION_KEY = 'projectConstellationPendingBranch';
const BRANCH_LINEAGE_KEY = 'projectConstellationBranchLineage';
const PULSE_UX_KEY = 'projectConstellationPulseUxSettings';
const LIVE_CHAT_PULSE_TTL_MS = 1800;
const liveNetworkByTab = new Map();
const liveTabStateByTab = new Map();
const liveNetworkReconcileTimers = new Map();
let liveChatPulseCache = null;
let liveChatPulseCacheAt = 0;
let liveChatPulseRequest = null;
const liveHealthContextCache = new Map();

const defaultBrainSettings = Object.freeze({
  captureEnabled: true,
  deepDownloadTracking: false,
  stallThresholdMs: 120000,
  catalog: {
    autoSweep: true, idleOnly: true, intervalHours: 24, lastAutoSweepAt: 0, providerIds: [],
    minRequestIntervalMs: 4000, freshChatMs: 6 * 60 * 60 * 1000, autoFreshChatMs: 24 * 60 * 60 * 1000,
    homeFreshMs: 6 * 60 * 60 * 1000, maxBackoffMs: 30 * 60 * 1000, maxRetries: 3, conditionalRequests: true
  },
  refreshRecovery: { enabled: true, maxRefreshesPerChat: 2, cooldownMs: 10 * 60 * 1000, recoveredCount: 0, failedCount: 0, lastRecoveredAt: 0 },
  projectIntegrity: { enabled: true, autoScan: true, scanIntervalMinutes: 15, lastScanAt: 0, latestSeverity: 'healthy' },
  knowledge: { enabled: true, extractionBatchSize: 28, activeExtractionBatchSize: 6, backfillBatchSize: 180, idleBackfillOnly: true, lastBackfillAt: 0, extractionVersion: knowledge.VERSION },
  liveHealth: { ...health.DEFAULTS },
  approvalAutopilot: {
    enabled: false, acknowledged: false, alwaysAllow: true, fallbackAllowOnce: true, autoRecoverPaused: true,
    backgroundRecovery: true, attentionNavigationIntervalMs: 4500, fullSweepNavigationIntervalMs: 8000, autoRescanFreshMs: 24 * 60 * 60 * 1000, lastSweepAt: 0, lastRecoveredAt: 0, recoveredCount: 0, failedCount: 0
  },
  github: { owner: '', repo: '', branch: 'main', path: '.project-constellation/constellation.json', autoSync: false, lastSyncAt: 0, clientId: '', authType: '', oauthUser: '', oauthAvatar: '', oauthScopes: '', connectedAt: 0 },
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
  groups: [['updatedAt','updatedAt'],['parentId','parentId'],['pinned','pinnedKey']],
  projects: [['updatedAt','updatedAt'],['groupId','groupId'],['sourceType','sourceType'],['pinned','pinnedKey'],['archived','archivedKey']],
  smartCollections: [['updatedAt','updatedAt'],['groupId','groupId'],['pinned','pinnedKey']],
  chats: [['updatedAt','updatedAt'],['projectId','projectId'],['workspaceProjectId','workspaceProjectId'],['providerId','providerId'],['status','status'],['workspaceProjectStatus',['workspaceProjectId','status']],['pinned','pinnedKey'],['favorite','favoriteKey'],['organizedArchived','organizedArchivedKey'],['tags','tags',{multiEntry:true}]],
  turns: [['updatedAt','updatedAt'],['chatId','chatId'],['providerId','providerId'],['chatOrdinal',['chatId','ordinal']],['chatUpdatedAt',['chatId','updatedAt']]],
  turnRevisions: [['updatedAt','updatedAt'],['chatId','chatId'],['turnId','turnId'],['chatOrdinal',['chatId','ordinal']],['turnUpdatedAt',['turnId','updatedAt']]],
  outputSnapshots: [['updatedAt','updatedAt'],['chatId','chatId'],['chatUpdatedAt',['chatId','updatedAt']],['fingerprint','fingerprint']],
  files: [['updatedAt','updatedAt'],['chatId','chatId'],['workspaceProjectId','workspaceProjectId'],['providerId','providerId']],
  events: [['updatedAt','updatedAt'],['chatId','chatId'],['type','type']],
  checkpoints: [['updatedAt','updatedAt']],
  syncReceipts: [['updatedAt','updatedAt'],['provider','provider']],
  catalogRuns: [['updatedAt','updatedAt'],['status','status']],
  projectBaselines: [['updatedAt','updatedAt'],['projectId','projectId']],
  integrityFindings: [['updatedAt','updatedAt'],['projectId','projectId'],['severity','severity'],['type','type'],['resolved','resolved']],
  knowledgeItems: [['updatedAt','updatedAt'],['chatId','chatId'],['providerId','providerId'],['projectId','projectId'],['workspaceProjectId','workspaceProjectId'],['kind','kind'],['sourceTurnId','sourceTurnId'],['canonicalKey','canonicalKey'],['kindUpdatedAt',['kind','updatedAt']],['projectUpdatedAt',['projectId','updatedAt']],['workspaceProjectUpdatedAt',['workspaceProjectId','updatedAt']]],
  knowledgeSources: [['updatedAt','updatedAt'],['chatId','chatId'],['status','status'],['statusUpdatedAt',['status','updatedAt']]],
  projectContinuity: [['updatedAt','updatedAt'],['projectId','projectId']]
});

const SEARCH_STORE = 'searchDocs';
const SEARCH_MAX_TERMS = 160;
const SEARCH_RESULT_LIMIT = 120;
const VALID_FLAG_INDEX_KEYS = Object.freeze({
  groups: Object.freeze({ pinned: 'pinnedKey' }),
  projects: Object.freeze({ pinned: 'pinnedKey', archived: 'archivedKey' }),
  smartCollections: Object.freeze({ pinned: 'pinnedKey' }),
  chats: Object.freeze({ pinned: 'pinnedKey', favorite: 'favoriteKey', organizedArchived: 'organizedArchivedKey' })
});

function withValidFlagIndexKeys(storeName, record = {}) {
  const fields = VALID_FLAG_INDEX_KEYS[storeName];
  if (!fields) return record;
  const next = { ...record };
  for (const [field, keyField] of Object.entries(fields)) {
    if (Boolean(next[field])) next[keyField] = 1;
    else delete next[keyField];
  }
  return next;
}

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
    entityType === 'knowledge' ? `${record.kind || ''} ${record.subtype || ''} ${record.title || ''} ${record.text || ''} ${(record.symbols || []).join(' ')} ${(record.fileRefs || []).join(' ')} ${(record.versions || []).join(' ')} ${(record.tags || []).join(' ')} ${record.url || ''}` :
    `${record.name || ''} ${record.href || ''} ${record.externalUrl || ''} ${record.externalProvider || ''}`,
    entityType === 'turn' || entityType === 'knowledge' ? 50000 : 12000
  );
  const terms = tokenizeSearch(`${title} ${body}`);
  return {
    id: `${entityType}:${record.id}`, entityType, entityId: record.id, chatId: record.chatId || (entityType === 'chat' ? record.id : ''),
    providerId: record.providerId || '', projectId: record.projectId || '', workspaceProjectId: record.workspaceProjectId || '', kind: record.kind || '', sourceTurnId: record.sourceTurnId || '', canonicalKey: record.canonicalKey || '',
    title, text: body, url: record.url || record.href || record.externalUrl || '', terms, updatedAt: record.updatedAt || Date.now()
  };
}


function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      const oldVersion = Number(event?.oldVersion || 0);
      for (const [name, indexes] of Object.entries(STORE_DEFS)) {
        let store;
        if (!db.objectStoreNames.contains(name)) store = db.createObjectStore(name, { keyPath: 'id' });
        else store = request.transaction.objectStore(name);
        for (const [indexName, keyPath, options = {}] of indexes) {
          if (store.indexNames.contains(indexName) && oldVersion > 0) {
            const existing = store.index(indexName);
            if (JSON.stringify(existing.keyPath) !== JSON.stringify(keyPath)) store.deleteIndex(indexName);
          }
          if (!store.indexNames.contains(indexName)) store.createIndex(indexName, keyPath, options);
        }
      }
      let searchStore;
      if (!db.objectStoreNames.contains(SEARCH_STORE)) searchStore = db.createObjectStore(SEARCH_STORE, { keyPath: 'id' });
      else searchStore = request.transaction.objectStore(SEARCH_STORE);
      for (const [indexName, keyPath, options] of [
        ['updatedAt','updatedAt',{}], ['entityType','entityType',{}], ['chatId','chatId',{}], ['providerId','providerId',{}], ['terms','terms',{ multiEntry: true }]
      ]) if (!searchStore.indexNames.contains(indexName)) searchStore.createIndex(indexName, keyPath, options);
      if (oldVersion > 0 && oldVersion < 9) {
        for (const storeName of Object.keys(VALID_FLAG_INDEX_KEYS)) {
          const store = request.transaction.objectStore(storeName);
          const cursorRequest = store.openCursor();
          cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result;
            if (!cursor) return;
            cursor.update(withValidFlagIndexKeys(storeName, cursor.value));
            cursor.continue();
          };
        }
      }
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

function isValidIndexedDbKey(value) {
  if (typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (value instanceof Date) return Number.isFinite(value.getTime());
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return true;
  if (Array.isArray(value)) return value.every(isValidIndexedDbKey);
  return false;
}

function indexedDbOnly(value, context = 'IndexedDB query') {
  if (!isValidIndexedDbKey(value)) throw new TypeError(`${context} received an invalid IndexedDB key.`);
  return IDBKeyRange.only(value);
}

async function getOne(storeName, id) {
  const db = await openDb();
  try { return await requestResult(db.transaction(storeName, 'readonly').objectStore(storeName).get(id)); }
  finally { db.close(); }
}

async function getManyInOrder(storeName, ids = []) {
  const keys = ids.filter(isValidIndexedDbKey);
  if (!keys.length) return [];
  const db = await openDb();
  try {
    const store = db.transaction(storeName, 'readonly').objectStore(storeName);
    return await Promise.all(keys.map((id) => requestResult(store.get(id))));
  } finally { db.close(); }
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
  if (!isValidIndexedDbKey(value)) return [];
  const db = await openDb();
  try {
    const store = db.transaction(storeName, 'readonly').objectStore(storeName);
    if (!store.indexNames.contains(indexName)) return [];
    const rows = await requestResult(store.index(indexName).getAll(indexedDbOnly(value, `${storeName}.${indexName}`), Math.max(1, Math.min(Number(limit) || 250, 2000))));
    return rows.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
  } finally { db.close(); }
}

async function getAllByIndex(storeName, indexName, value) {
  if (!isValidIndexedDbKey(value)) return [];
  const db = await openDb();
  try {
    const store = db.transaction(storeName, 'readonly').objectStore(storeName);
    if (!store.indexNames.contains(indexName)) return [];
    const rows = await requestResult(store.index(indexName).getAll(indexedDbOnly(value, `${storeName}.${indexName}`)));
    return rows.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
  } finally { db.close(); }
}

async function latestTurnsForChat(chatId, limit = 5) {
  if (!chatId) return [];
  const safeLimit = Math.max(1, Math.min(Number(limit) || 5, 12));
  const db = await openDb();
  try {
    const store = db.transaction('turns', 'readonly').objectStore('turns');
    const out = [];
    const indexName = store.indexNames.contains('chatOrdinal') ? 'chatOrdinal' : 'chatUpdatedAt';
    if (!store.indexNames.contains(indexName)) return [];
    const index = store.index(indexName);
    const upper = indexName === 'chatOrdinal' ? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
    const range = IDBKeyRange.bound([chatId, 0], [chatId, upper]);
    await new Promise((resolve, reject) => {
      const request = index.openCursor(range, 'prev');
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || out.length >= safeLimit) { resolve(); return; }
        const row = cursor.value || {};
        out.push({ id: row.id || '', messageId: row.messageId || '', role: row.role || '', ordinal: Number(row.ordinal || 0), textHash: providers.hashString(brain.normalizeText(row.text || '', 100000)), textLength: brain.normalizeText(row.text || '', 100000).length, updatedAt: Number(row.updatedAt || 0), source: row.source || '' });
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });
    return out;
  } finally { db.close(); }
}

async function recentTurnRecordsForChat(chatId, limit = 12) {
  if (!chatId) return [];
  const safeLimit = Math.max(1, Math.min(Number(limit) || 12, 96));
  const db = await openDb();
  try {
    const store = db.transaction('turns', 'readonly').objectStore('turns');
    const out = [];
    const indexName = store.indexNames.contains('chatOrdinal') ? 'chatOrdinal' : 'chatUpdatedAt';
    if (!store.indexNames.contains(indexName)) return [];
    const index = store.index(indexName);
    const range = IDBKeyRange.bound([chatId, 0], [chatId, Number.MAX_SAFE_INTEGER]);
    await new Promise((resolve, reject) => {
      const request = index.openCursor(range, 'prev');
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || out.length >= safeLimit) { resolve(); return; }
        out.push(cursor.value || {}); cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });
    return out;
  } finally { db.close(); }
}

function networkStateForTab(tabId) {
  const row = liveNetworkByTab.get(Number(tabId));
  if (!row) return { pending: 0, pendingTotal:0, auxiliaryPending:0, observed: false, oldestPendingAt: 0, newestPendingAt: 0, lastStartAt: 0, lastResponseAt: 0, lastCompleteAt: 0, lastErrorAt: 0, lastStatusCode: 0, rateLimited: false, streamLikely: false, inflight: [], auxiliaryInflight:[], events: [] };
  const now = Date.now();
  for (const [requestId, item] of row.inflight) if (now - Number(item.startedAt || 0) > LIVE_NETWORK_TTL_MS) row.inflight.delete(requestId);
  const allInflight = [...row.inflight.values()];
  const inflight = allInflight.filter((item) => item.activityBearing);
  const pending = inflight.length;
  const starts = inflight.map((item) => Number(item.startedAt || 0)).filter(Boolean);
  const oldestPendingAt = starts.length ? Math.min(...starts) : 0;
  const newestPendingAt = starts.length ? Math.max(...starts) : 0;
  return {
    pending, pendingTotal:allInflight.length, auxiliaryPending:Math.max(0, allInflight.length - pending), observed: true, oldestPendingAt, newestPendingAt,
    lastStartAt: row.lastStartAt || 0, lastResponseAt: row.lastResponseAt || 0, lastCompleteAt: row.lastCompleteAt || 0, lastErrorAt: row.lastErrorAt || 0,
    lastStatusCode: row.lastStatusCode || 0,
    rateLimited: Number(row.lastStatusCode || 0) === 429 && now - Number(row.lastStatusAt || 0) < 15 * 60 * 1000,
    streamLikely: pending > 0 && inflight.some((item) => item.method !== 'GET' || /conversation|response|message|completion|generate|tool|stream|backend-api|\/api\//i.test(item.url || '')),
    inflight: inflight.slice(-12).map((item) => ({ id:item.id || '', category:item.category || 'provider request', method:item.method || 'GET', startedAt:Number(item.startedAt || 0) })),
    auxiliaryInflight: allInflight.filter((item) => !item.activityBearing).slice(-8).map((item) => ({ id:item.id || '', category:item.category || 'site background', method:item.method || 'GET', startedAt:Number(item.startedAt || 0) })),
    events: (row.events || []).slice(-16).map((item) => ({ ...item }))
  };
}

async function liveHealthContext(chatId, tabId) {
  const id = String(chatId || '');
  const now = Date.now();
  let cached = liveHealthContextCache.get(id);
  if (!cached || now - cached.at > LIVE_HEALTH_CONTEXT_TTL_MS) {
    const chat = id ? await getOne('chats', id) : null;
    const [latestTurns, storedTurns] = id ? await Promise.all([latestTurnsForChat(id, 5), countByIndex('turns', 'chatId', id)]) : [[], 0];
    const projectId = chat?.workspaceProjectId || chat?.projectId || '';
    let findings = [];
    let baseline = null;
    if (projectId) {
      findings = (await getAllByIndex('integrityFindings', 'projectId', projectId)).filter((row) => !row.resolved && (!row.chatId || row.chatId === id)).slice(0, 24);
      baseline = await getOne('projectBaselines', projectId);
    }
    cached = { at: now, chat: chat ? { id: chat.id, title: chat.title || '', status: chat.status || 'idle', statusDetail: chat.statusDetail || '', projectId: chat.projectId || '', projectName: chat.projectName || '', workspaceProjectId: chat.workspaceProjectId || '', workspaceProjectName: chat.workspaceProjectName || '', lastActivityAt: chat.lastActivityAt || 0, updatedAt: chat.updatedAt || 0, integrityHealth: chat.integrityHealth || '', coverage: chat.coverage || '', source: chat.source || '', catalogFetchedAt: chat.catalogFetchedAt || 0, outputRegression:chat.outputRegression || null } : null, latestTurns, capacity: { storedTurns }, findings, baseline: baseline ? { projectId: baseline.projectId || projectId, projectName: baseline.projectName || '', latestVersion: baseline.latestVersion || '', health: baseline.health || '', counts: baseline.counts || {}, updatedAt: baseline.updatedAt || 0 } : null };
    liveHealthContextCache.set(id, cached);
  }
  const cfg = await settings();
  return { ok: true, now, chat: cached.chat, latestTurns: cached.latestTurns, capacity: cached.capacity || { storedTurns: 0 }, integrityFindings: cached.findings, baseline: cached.baseline, network: networkStateForTab(tabId), settings: cfg.liveHealth };
}

function boundedOutputObservation(message = {}) {
  const chatId = String(message.chatId || '').slice(0, 900);
  const turns = (Array.isArray(message.turns) ? message.turns : []).slice(-64).map((turn) => ({
    id:String(turn?.id || '').slice(0, 900), messageId:String(turn?.messageId || '').slice(0, 500),
    role:brain.normalizeText(turn?.role || 'unknown', 24), ordinal:Number(turn?.ordinal || 0),
    fingerprint:String(turn?.fingerprint || '').slice(0, 180), score:Math.max(0, Number(turn?.score || 0)),
    textLength:Math.max(0, Number(turn?.textLength || 0)), excerpt:String(turn?.excerpt || '').slice(0, 6000),
    links:(Array.isArray(turn?.links) ? turn.links : []).slice(0, 64).map((item) => ({ href:String(item?.href || '').slice(0,8000), text:brain.normalizeText(item?.text || '',320) })).filter((item)=>item.href),
    assets:(Array.isArray(turn?.assets) ? turn.assets : []).slice(0, 32).map((item) => ({ kind:brain.normalizeText(item?.kind || 'media',32), url:String(item?.url || '').slice(0,8000), alt:brain.normalizeText(item?.alt || '',320) })).filter((item)=>item.url),
    codeBlocks:Math.max(0, Number(turn?.codeBlocks || 0))
  })).filter((turn) => turn.id);
  return {
    chatId, providerId:String(message.providerId || '').slice(0,80), url:String(message.url || '').slice(0,8000),
    hydrated:Boolean(message.hydrated), atBottom:Boolean(message.atBottom), running:Boolean(message.running),
    turns, fingerprint:String(message.fingerprint || brain.outputObservationFingerprint(turns)).slice(0,180), observedAt:Number(message.observedAt || Date.now())
  };
}

function outputTurnKey(turn = {}) { return `${String(turn.role || '')}:${Number(turn.ordinal || 0)}`; }

function compareObservedOutput(storedTurns = [], observation = {}) {
  const observed = Array.isArray(observation.turns) ? observation.turns : [];
  const observedById = new Map(observed.map((turn) => [turn.id, turn]));
  const observedByOrdinal = new Map(observed.map((turn) => [outputTurnKey(turn), turn]));
  const observedOrdinals = observed.map((turn) => Number(turn.ordinal || 0));
  const observedMin = observedOrdinals.length ? Math.min(...observedOrdinals) : Number.MAX_SAFE_INTEGER;
  const observedMax = observedOrdinals.length ? Math.max(...observedOrdinals) : -1;
  const relevant = storedTurns.filter((turn) => turn.role === 'assistant' && (Number(turn.ordinal || 0) >= observedMin || Number(turn.ordinal || 0) > observedMax));
  const missingTurns = [];
  const changedTurns = [];
  let missingAssets = 0;
  let missingLinks = 0;
  let missingCodeBlocks = 0;
  for (const saved of relevant) {
    const current = observedById.get(saved.id) || observedByOrdinal.get(outputTurnKey(saved));
    const savedFingerprint = String(saved.bestRevisionFingerprint || saved.contentFingerprint || brain.turnFingerprint(saved));
    const savedScore = Number(saved.bestRevisionScore || saved.richnessScore || brain.turnRichnessScore(saved));
    if (!current) {
      missingTurns.push({ turnId:saved.id, ordinal:Number(saved.ordinal || 0), savedFingerprint, savedScore, textLength:String(saved.text || '').length, assetCount:(saved.assets || []).length, linkCount:(saved.links || []).length, codeBlocks:(saved.codeBlocks || []).length });
      missingAssets += (saved.assets || []).length; missingLinks += (saved.links || []).length; missingCodeBlocks += (saved.codeBlocks || []).length;
      continue;
    }
    const currentScore = Number(current.score || 0);
    const fingerprintChanged = Boolean(current.fingerprint && current.fingerprint !== savedFingerprint);
    const meaningfulLoss = savedScore - currentScore >= Math.max(180, Math.round(savedScore * 0.08));
    if (fingerprintChanged && meaningfulLoss) {
      const currentAssets = new Set((current.assets || []).map((item) => item.url));
      const currentLinks = new Set((current.links || []).map((item) => item.href));
      const lostAssets = (saved.assets || []).filter((item) => !currentAssets.has(item.url)).length;
      const lostLinks = (saved.links || []).filter((item) => !currentLinks.has(item.href)).length;
      const lostCode = Math.max(0, (saved.codeBlocks || []).length - Number(current.codeBlocks || 0));
      missingAssets += lostAssets; missingLinks += lostLinks; missingCodeBlocks += lostCode;
      changedTurns.push({ turnId:saved.id, ordinal:Number(saved.ordinal || 0), savedFingerprint, currentFingerprint:current.fingerprint, savedScore, currentScore, savedTextLength:String(saved.text || '').length, currentTextLength:current.textLength, currentExcerpt:current.excerpt || '', lostAssets, lostLinks, lostCode });
    }
  }
  const active = Boolean(missingTurns.length || changedTurns.length);
  const parts = [];
  if (missingTurns.length) parts.push(`${missingTurns.length} missing response${missingTurns.length === 1 ? '' : 's'}`);
  if (changedTurns.length) parts.push(`${changedTurns.length} shortened response${changedTurns.length === 1 ? '' : 's'}`);
  if (missingAssets) parts.push(`${missingAssets} media item${missingAssets === 1 ? '' : 's'}`);
  if (missingLinks) parts.push(`${missingLinks} link${missingLinks === 1 ? '' : 's'}`);
  return { active, missingTurns, changedTurns, missingAssets, missingLinks, missingCodeBlocks, title:active ? 'Saved output is missing from this page' : 'Output matches the saved vault', detail:active ? parts.join(' · ') : `${observed.length} mounted turn${observed.length === 1 ? '' : 's'} match the durable capture.` };
}

async function pruneOutputSnapshots(chatId, limit = 24) {
  const rows = await getAllByIndex('outputSnapshots', 'chatId', chatId);
  for (const row of rows.slice(limit)) await deleteOneRecord('outputSnapshots', row.id);
}

async function observeOutput(message = {}) {
  const observation = boundedOutputObservation(message);
  if (!observation.chatId || observation.chatId.endsWith(':home') || !observation.hydrated || !observation.atBottom || observation.running || !observation.turns.length) return { ok:true, ignored:true, reason:'not-authoritative' };
  const storedTurns = (await recentTurnRecordsForChat(observation.chatId, 96)).sort((a,b)=>Number(a.ordinal||0)-Number(b.ordinal||0));
  if (!storedTurns.length) return { ok:true, ignored:true, reason:'no-saved-turns' };
  const comparison = compareObservedOutput(storedTurns, observation);
  const snapshotId = `${observation.chatId}:output:${observation.fingerprint}`;
  await upsert('outputSnapshots', { id:snapshotId, ...observation, comparison, updatedAt:observation.observedAt });
  pruneOutputSnapshots(observation.chatId).catch(() => {});
  const chat = await getOne('chats', observation.chatId);
  const previous = chat?.outputRegression || null;
  const signature = brain.hashString(JSON.stringify([comparison.missingTurns.map((row)=>row.turnId),comparison.changedTurns.map((row)=>[row.turnId,row.currentFingerprint]),comparison.missingAssets,comparison.missingLinks]));
  const outputRegression = {
    ...comparison, signature, detectedAt:comparison.active ? Number(previous?.active && previous?.signature === signature ? previous.detectedAt : observation.observedAt) : 0,
    checkedAt:observation.observedAt, observationFingerprint:observation.fingerprint, snapshotId
  };
  await upsert('chats', { id:observation.chatId, providerId:observation.providerId || chat?.providerId || '', url:observation.url || chat?.url || '', outputRegression, outputVaultCheckedAt:observation.observedAt, updatedAt:Math.max(Number(chat?.updatedAt||0),observation.observedAt) });
  if (comparison.active && (!previous?.active || previous.signature !== signature)) {
    await addEvent('output-regression-detected', 'chat', observation.chatId, observation.chatId, { signature, missingTurns:comparison.missingTurns.length, changedTurns:comparison.changedTurns.length, missingAssets:comparison.missingAssets, missingLinks:comparison.missingLinks, snapshotId });
  } else if (!comparison.active && previous?.active) {
    await addEvent('output-regression-cleared', 'chat', observation.chatId, observation.chatId, { previousSignature:previous.signature || '', snapshotId });
  }
  liveHealthContextCache.delete(observation.chatId);
  updateAttentionBadge().catch(() => {});
  if (comparison.active) markDriveDirty().catch(() => {});
  return { ok:true, regression:outputRegression };
}

function markdownSafeLabel(value) { return brain.normalizeText(value || '', 320).replace(/[\[\]]/g, '') || 'Open saved output'; }

function outputTurnMarkdown(turn = {}) {
  const lines = [`## ${turn.role === 'user' ? 'User' : 'Assistant'} · turn ${Number(turn.ordinal || 0) + 1}`, '', String(turn.formattedText || turn.text || '').trim() || '_No rendered text was captured._'];
  for (const block of turn.codeBlocks || []) lines.push('', `\`\`\`${brain.normalizeText(block.language || '', 40)}`, String(block.text || ''), '\`\`\`');
  if ((turn.links || []).length) {
    lines.push('', '### Links', '');
    for (const link of turn.links) lines.push(`- [${markdownSafeLabel(link.text || link.href)}](${String(link.href || '').replace(/\)/g,'%29')})`);
  }
  if ((turn.assets || []).length) {
    lines.push('', '### Media and outputs', '');
    for (const asset of turn.assets) lines.push(`- ${brain.normalizeText(asset.kind || 'media',32)}: [${markdownSafeLabel(asset.alt || asset.url)}](${String(asset.url || '').replace(/\)/g,'%29')})`);
  }
  return lines.join('\n');
}

async function outputVaultReport(chatId, options = {}) {
  const id = String(chatId || '');
  if (!id) throw new Error('A chat is required to open Output Vault.');
  const [chat, allTurns, files, snapshots] = await Promise.all([getOne('chats', id), getAllByIndex('turns','chatId',id), getAllByIndex('files','chatId',id), getAllByIndex('outputSnapshots','chatId',id)]);
  const assistantTurns = allTurns.filter((turn)=>turn.role === 'assistant').sort((a,b)=>Number(a.ordinal||0)-Number(b.ordinal||0));
  const offset = Math.max(0, Number(options.offset || 0));
  const limit = Math.max(20, Math.min(Number(options.limit || 120), 200));
  const start = Math.max(0, assistantTurns.length - offset - limit);
  const end = assistantTurns.length - offset;
  const pageTurns = assistantTurns.slice(start, Math.max(start,end));
  const latestSnapshot = snapshots[0] || null;
  const currentById = new Map((latestSnapshot?.turns || []).map((turn)=>[turn.id,turn]));
  const currentByOrdinal = new Map((latestSnapshot?.turns || []).map((turn)=>[outputTurnKey(turn),turn]));
  const embeddedByTurn = new Map();
  for (const file of files) if (file.parentTurnId && file.embeddedDataUrl) {
    const list=embeddedByTurn.get(file.parentTurnId)||[]; list.push(file); embeddedByTurn.set(file.parentTurnId,list);
  }
  const affected = new Set([...(chat?.outputRegression?.missingTurns || []).map((row)=>row.turnId),...(chat?.outputRegression?.changedTurns || []).map((row)=>row.turnId)]);
  const items = pageTurns.map((turn)=>{
    const embeddedFiles=embeddedByTurn.get(turn.id)||[];
    const assets=(turn.assets||[]).map((asset)=>{const file=embeddedFiles.find((row)=>row.href===asset.url||row.sourceUrl===asset.sourceUrl)||(embeddedFiles.length===1?embeddedFiles[0]:null);return file?{...asset,embeddedDataUrl:file.embeddedDataUrl,embeddedMimeType:file.embeddedMimeType||''}:asset;});
    return { ...turn, assets, current:currentById.get(turn.id) || currentByOrdinal.get(outputTurnKey(turn)) || null, affected:affected.has(turn.id) };
  });
  const markdownParts = [`# Project Constellation Output Vault`, '', `Chat: ${chat?.title || id}`, `Source: ${chat?.url || ''}`, `Captured: ${new Date().toISOString()}`, '', `This export contains the richest saved assistant revision for every captured response.`, ''];
  let markdownLength = markdownParts.join('\n').length;
  for (const turn of assistantTurns) {
    const section = outputTurnMarkdown(turn);
    if (markdownLength + section.length > 5_000_000) { markdownParts.push('', '_Export stopped at the 5 MB safety boundary. Earlier output remains available inside Output Vault._'); break; }
    markdownParts.push(section, ''); markdownLength += section.length;
  }
  if (files.length) {
    markdownParts.push('## Captured files', '');
    for (const file of files.slice(0,1000)) markdownParts.push(`- [${markdownSafeLabel(file.name || file.href || file.kind)}](${String(file.href || file.externalUrl || '').replace(/\)/g,'%29')})`);
  }
  return { ok:true, chat:chat || { id, title:'Captured chat', url:'' }, regression:chat?.outputRegression || { active:false, title:'Output Vault ready', detail:`${assistantTurns.length} saved assistant outputs.` }, items, files:files.slice(0,500), total:assistantTurns.length, offset, hasMore:start > 0, nextOffset:offset + pageTurns.length, latestSnapshot:latestSnapshot ? { id:latestSnapshot.id, observedAt:latestSnapshot.observedAt, fingerprint:latestSnapshot.fingerprint } : null, markdown:markdownParts.join('\n') };
}

async function outputTurnRevisions(turnId) {
  const id = String(turnId || '');
  if (!id) return { ok:false, revisions:[] };
  const [turn, revisions] = await Promise.all([getOne('turns',id),getAllByIndex('turnRevisions','turnId',id)]);
  return { ok:true, turn, revisions:revisions.sort((a,b)=>Number(b.capturedAt||b.updatedAt||0)-Number(a.capturedAt||a.updatedAt||0)) };
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
    const merged = unique.map((record, index) => withValidFlagIndexKeys(storeName, brain.mergeRecord(previous[index], record)));
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

function boundedTurnForVault(record = {}) {
  const links = (Array.isArray(record.links) ? record.links : []).slice(0, 64).map((item) => ({
    href:String(item?.href || item?.url || '').slice(0, 8000),
    text:brain.normalizeText(item?.text || item?.name || '', 320),
    context:brain.normalizeText(item?.context || '', 900)
  })).filter((item) => item.href);
  const codeBlocks = (Array.isArray(record.codeBlocks) ? record.codeBlocks : []).slice(0, 24).map((item) => ({
    language:brain.normalizeText(item?.language || '', 40), text:String(item?.text || '').slice(0, 32000)
  })).filter((item) => item.text);
  const assets = (Array.isArray(record.assets) ? record.assets : []).slice(0, 32).map((item) => ({
    id:String(item?.id || '').slice(0, 180), kind:brain.normalizeText(item?.kind || 'media', 32),
    url:String(item?.url || item?.href || '').slice(0, 8000), sourceUrl:String(item?.sourceUrl || '').slice(0, 8000),
    alt:brain.normalizeText(item?.alt || item?.name || '', 320), width:Math.max(0, Number(item?.width || 0)), height:Math.max(0, Number(item?.height || 0))
  })).filter((item) => item.url);
  const next = { ...record, text:String(record.text || '').slice(0, 120000), formattedText:String(record.formattedText || '').slice(0, 120000), links, codeBlocks, assets };
  next.contentFingerprint = brain.turnFingerprint(next);
  next.richnessScore = brain.turnRichnessScore(next);
  return next;
}

function turnRevisionRecord(turn = {}, capturedAt = Date.now()) {
  const bounded = boundedTurnForVault(turn);
  return {
    ...bounded,
    id:`${bounded.id}:revision:${bounded.contentFingerprint}`,
    turnId:bounded.id,
    capturedAt:Number(capturedAt || Date.now()),
    updatedAt:Number(capturedAt || Date.now())
  };
}

async function pruneTurnRevisions(turnId, keepId = '', limit = 12) {
  const rows = await getAllByIndex('turnRevisions', 'turnId', turnId);
  if (rows.length <= limit) return;
  const keep = new Set(rows.slice(0, Math.max(1, limit - 1)).map((row) => row.id));
  if (keepId) keep.add(keepId);
  for (const row of rows) if (!keep.has(row.id)) await deleteOneRecord('turnRevisions', row.id);
}

async function preserveTurnRevisions(records = []) {
  const unique = [...new Map(records.filter((record) => record?.id).map((record) => [record.id, boundedTurnForVault(record)])).values()];
  if (!unique.length) return { turns:[], revisions:[], regressions:[] };
  const previousRows = await getManyInOrder('turns', unique.map((record) => record.id));
  const revisions = [];
  const canonical = [];
  const regressions = [];
  for (let index = 0; index < unique.length; index += 1) {
    const incoming = unique[index];
    const previous = previousRows[index] ? boundedTurnForVault(previousRows[index]) : null;
    const incomingRevision = turnRevisionRecord(incoming, incoming.updatedAt || Date.now());
    const previousRevision = previous ? turnRevisionRecord(previous, previous.bestRevisionCapturedAt || previous.updatedAt || Date.now()) : null;
    if (previousRevision) revisions.push(previousRevision);
    revisions.push(incomingRevision);
    const previousScore = Number(previous?.bestRevisionScore || previous?.richnessScore || 0);
    const incomingScore = Number(incoming.richnessScore || 0);
    const previousFingerprint = String(previous?.bestRevisionFingerprint || previous?.contentFingerprint || '');
    const different = Boolean(previous && previousFingerprint && previousFingerprint !== incoming.contentFingerprint);
    const meaningfulLoss = different && previousScore - incomingScore >= Math.max(180, Math.round(previousScore * 0.08));
    const keepPrevious = Boolean(previous && incoming.role === 'assistant' && previous.role === 'assistant' && previousScore > incomingScore);
    const best = keepPrevious ? previous : incoming;
    const bestFingerprint = keepPrevious ? previousFingerprint : incoming.contentFingerprint;
    const bestScore = keepPrevious ? previousScore : incomingScore;
    const bestRevisionId = `${incoming.id}:revision:${bestFingerprint}`;
    const newObservation = !previous || String(previous.lastObservedFingerprint || previous.contentFingerprint || '') !== incoming.contentFingerprint;
    const revisionCount = Math.max(Number(previous?.revisionCount || 0), previous ? 1 : 0) + (newObservation ? 1 : 0);
    canonical.push({
      ...(previous || {}), ...incoming,
      text:best.text || '', formattedText:best.formattedText || '', links:best.links || [], codeBlocks:best.codeBlocks || [], assets:best.assets || [],
      contentFingerprint:bestFingerprint, richnessScore:bestScore,
      bestRevisionId, bestRevisionFingerprint:bestFingerprint, bestRevisionScore:bestScore,
      bestRevisionCapturedAt:keepPrevious ? Number(previous?.bestRevisionCapturedAt || previous?.updatedAt || Date.now()) : Number(incoming.updatedAt || Date.now()),
      lastObservedRevisionId:incomingRevision.id, lastObservedFingerprint:incoming.contentFingerprint, lastObservedScore:incomingScore,
      lastObservedAt:Number(incoming.updatedAt || Date.now()), revisionCount,
      outputRegressionCandidate:Boolean(meaningfulLoss), updatedAt:Number(incoming.updatedAt || Date.now())
    });
    if (meaningfulLoss && incoming.role === 'assistant') regressions.push({ turnId:incoming.id, chatId:incoming.chatId || '', ordinal:Number(incoming.ordinal || 0), savedScore:previousScore, currentScore:incomingScore, savedFingerprint:previousFingerprint, currentFingerprint:incoming.contentFingerprint });
  }
  const existingRevisionIds = new Set((await getMany('turnRevisions', revisions.map((record) => record.id))).filter(Boolean).map((record) => record.id));
  const savedRevisions = await putMany('turnRevisions', revisions.filter((record) => !existingRevisionIds.has(record.id)));
  const savedTurns = await putMany('turns', canonical);
  for (const turn of savedTurns.slice(-40)) pruneTurnRevisions(turn.id, turn.bestRevisionId, 12).catch(() => {});
  return { turns:savedTurns, revisions:savedRevisions, regressions };
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
  for (const [source, type] of [['groups','group'],['projects','project'],['smartCollections','smart'],['chats','chat'],['turns','turn'],['files','file'],['knowledgeItems','knowledge']]) counts[type] = await indexStoreIntoSearch(source, type);
  return counts;
}

async function ensureSearchIndex() {
  const [docs, turns, chats, files, knowledgeItems] = await Promise.all([countStore(SEARCH_STORE), countStore('turns'), countStore('chats'), countStore('files'), countStore('knowledgeItems')]);
  if (!docs && (turns || chats || files || knowledgeItems)) return rebuildSearchIndex();
  return null;
}

async function searchBrain(query, limit = 60) {
  const terms = tokenizeSearch(query, 12);
  if (!terms.length) return [];
  const db = await openDb();
  try {
    const tx = db.transaction(SEARCH_STORE, 'readonly');
    const index = tx.objectStore(SEARCH_STORE).index('terms');
    const lists = await Promise.all(terms.map((term) => requestResult(index.getAll(term, 450))));
    const candidates = new Map();
    lists.forEach((list, termIndex) => {
      for (const doc of list) {
        const row = candidates.get(doc.id) || { doc, matched: new Set() };
        row.matched.add(termIndex); candidates.set(doc.id, row);
      }
    });
    const q = String(query || '').toLocaleLowerCase().normalize('NFKC');
    const minOverlap = terms.length <= 2 ? 1 : Math.max(2, Math.ceil(terms.length * 0.5));
    const typeBoost = { knowledge: 24, chat: 16, project: 12, file: 12, turn: 6, group: 4, smart: 4 };
    return [...candidates.values()].filter((row) => row.matched.size >= minOverlap).map(({ doc, matched }) => {
      const hay = `${doc.title || ''} ${doc.text || ''}`.toLocaleLowerCase();
      const titleHay = String(doc.title || '').toLocaleLowerCase();
      const titleHit = titleHay.includes(q);
      const phraseHit = hay.includes(q);
      const overlap = matched.size / terms.length;
      const score = (titleHit ? 120 : 0) + (phraseHit ? 80 : 0) + Math.round(overlap * 90) + matched.size * 12 + (typeBoost[doc.entityType] || 0) + Math.min((doc.updatedAt || 0) / 1e13, 10);
      const phraseAt = phraseHit ? hay.indexOf(q) : -1;
      const firstTermAt = phraseAt < 0 ? terms.map((term) => hay.indexOf(term)).filter((value) => value >= 0).sort((a,b)=>a-b)[0] ?? 0 : phraseAt;
      const start = Math.max(0, firstTermAt - 160);
      return { ...doc, score, matchCount: matched.size, queryTermCount: terms.length, excerpt: brain.normalizeText(String(doc.text || '').slice(start, start + 760), 760), terms: undefined, text: undefined };
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
    catalog: { ...defaultBrainSettings.catalog, ...(stored.catalog || {}) },
    refreshRecovery: { ...defaultBrainSettings.refreshRecovery, ...(stored.refreshRecovery || {}) },
    projectIntegrity: { ...defaultBrainSettings.projectIntegrity, ...(stored.projectIntegrity || {}) },
    knowledge: { ...defaultBrainSettings.knowledge, ...(stored.knowledge || {}) },
    liveHealth: health.normalizeSettings({ ...defaultBrainSettings.liveHealth, ...(stored.liveHealth || {}) }),
    approvalAutopilot: { ...defaultBrainSettings.approvalAutopilot, ...(stored.approvalAutopilot || {}) }
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

let settingsMutationQueue = Promise.resolve();
function mutateSettings(operation) {
  const pending = settingsMutationQueue.catch(() => {}).then(operation);
  settingsMutationQueue = pending.then(() => undefined, () => undefined);
  return pending;
}

async function patchSettings(patch) {
  return mutateSettings(async () => {
    const current = await settings();
    return saveSettings({
      ...current, ...patch,
      github: { ...current.github, ...(patch.github || {}) },
      drive: { ...current.drive, ...(patch.drive || {}) },
      catalog: { ...current.catalog, ...(patch.catalog || {}) },
      refreshRecovery: { ...current.refreshRecovery, ...(patch.refreshRecovery || {}) },
      projectIntegrity: { ...current.projectIntegrity, ...(patch.projectIntegrity || {}) },
      knowledge: { ...current.knowledge, ...(patch.knowledge || {}) },
      liveHealth: health.normalizeSettings({ ...current.liveHealth, ...(patch.liveHealth || {}) }),
      approvalAutopilot: { ...current.approvalAutopilot, ...(patch.approvalAutopilot || {}) }
    });
  });
}

function defaultRequestGovernorState() {
  return { providers: {}, totalRequests: 0, totalThrottles: 0, totalFreshSkips: 0, totalNotModified: 0, updatedAt: 0 };
}

async function requestGovernorState() {
  const stored = (await chrome.storage.local.get(REQUEST_GOVERNOR_KEY))[REQUEST_GOVERNOR_KEY];
  return { ...defaultRequestGovernorState(), ...(stored || {}), providers: { ...(stored?.providers || {}) } };
}

async function saveRequestGovernorState(next) {
  const state = { ...defaultRequestGovernorState(), ...(next || {}), providers: { ...(next?.providers || {}) }, updatedAt: Date.now() };
  await chrome.storage.local.set({ [REQUEST_GOVERNOR_KEY]: state });
  return state;
}

function retryAfterMs(value) {
  const raw = String(value || '').trim();
  if (!raw) return 0;
  if (/^\d+(?:\.\d+)?$/.test(raw)) return Math.max(0, Math.round(Number(raw) * 1000));
  const stamp = Date.parse(raw);
  return Number.isFinite(stamp) ? Math.max(0, stamp - Date.now()) : 0;
}

async function requestBudget(providerId) {
  const cfg = await settings();
  const state = await requestGovernorState();
  const row = state.providers[providerId] || {};
  const now = Date.now();
  const waitMs = Math.max(0, Number(row.backoffUntil || 0) - now, Number(row.nextAllowedAt || 0) - now);
  return { ready: waitMs <= 0, waitMs, provider: row, config: cfg.catalog };
}

async function noteProviderRequest(providerId, { status = 0, retryAfter = '', error = '', notModified = false } = {}) {
  const cfg = await settings();
  const state = await requestGovernorState();
  const current = state.providers[providerId] || {};
  const now = Date.now();
  const throttled = status === 429 || status === 503;
  const penalty = throttled ? Math.min(8, Number(current.penalty || 0) + 1) : Math.max(0, Number(current.penalty || 0) - 1);
  const base = Math.max(750, Number(cfg.catalog.minRequestIntervalMs || 2500));
  const retryMs = retryAfterMs(retryAfter);
  const backoff = throttled ? Math.min(Number(cfg.catalog.maxBackoffMs || 1800000), Math.max(retryMs, base * Math.pow(2, Math.min(penalty, 7)))) : 0;
  const jitter = Math.round(base * (0.08 + Math.random() * 0.14));
  const nextAllowedAt = now + base + jitter;
  state.providers[providerId] = {
    ...current, penalty, nextAllowedAt, backoffUntil: throttled ? now + backoff : Math.max(0, Number(current.backoffUntil || 0) < now ? 0 : Number(current.backoffUntil || 0)),
    lastRequestAt: now, lastStatus: status || 0, lastError: error ? String(error).slice(0, 400) : '',
    requests: Number(current.requests || 0) + 1, throttles: Number(current.throttles || 0) + (throttled ? 1 : 0), notModified: Number(current.notModified || 0) + (notModified ? 1 : 0)
  };
  state.totalRequests = Number(state.totalRequests || 0) + 1;
  state.totalThrottles = Number(state.totalThrottles || 0) + (throttled ? 1 : 0);
  state.totalNotModified = Number(state.totalNotModified || 0) + (notModified ? 1 : 0);
  return saveRequestGovernorState(state);
}

async function noteFreshCatalogSkip(providerId, count = 1) {
  const state = await requestGovernorState();
  const current = state.providers[providerId] || {};
  state.providers[providerId] = { ...current, freshSkips: Number(current.freshSkips || 0) + Number(count || 0) };
  state.totalFreshSkips = Number(state.totalFreshSkips || 0) + Number(count || 0);
  return saveRequestGovernorState(state);
}

async function noteProviderRateLimit(providerId, waitMs = 15 * 60 * 1000, detail = '', source = 'browser-page') {
  const state = await requestGovernorState(); const current = state.providers[providerId] || {}; const now = Date.now();
  const bounded = Math.max(30_000, Math.min(60 * 60 * 1000, Number(waitMs || 0) || 15 * 60 * 1000));
  state.providers[providerId] = { ...current, penalty: Math.max(2, Number(current.penalty || 0)), backoffUntil: Math.max(Number(current.backoffUntil || 0), now + bounded), nextAllowedAt: Math.max(Number(current.nextAllowedAt || 0), now + bounded), lastStatus: 429, lastError: String(detail || 'Provider rate limit detected').slice(0, 400), pageThrottles: Number(current.pageThrottles || 0) + 1, lastPageThrottleAt: now, lastPageThrottleSource: source };
  state.totalThrottles = Number(state.totalThrottles || 0) + 1;
  return saveRequestGovernorState(state);
}

function publicRequestGovernor(state) {
  const now = Date.now();
  return {
    totalRequests: Number(state?.totalRequests || 0), totalThrottles: Number(state?.totalThrottles || 0), totalFreshSkips: Number(state?.totalFreshSkips || 0), totalNotModified: Number(state?.totalNotModified || 0), updatedAt: Number(state?.updatedAt || 0),
    providers: Object.fromEntries(Object.entries(state?.providers || {}).map(([id,row]) => [id, { ...row, waitMs: Math.max(0, Number(row.backoffUntil || 0) - now, Number(row.nextAllowedAt || 0) - now) }]))
  };
}

function defaultRefreshRecoveryState() {
  return { chats: {}, attempts: 0, recovered: 0, failed: 0, lastActionAt: 0, updatedAt: 0 };
}

async function refreshRecoveryState() {
  const stored = (await chrome.storage.local.get(REFRESH_RECOVERY_KEY))[REFRESH_RECOVERY_KEY];
  return { ...defaultRefreshRecoveryState(), ...(stored || {}), chats: { ...(stored?.chats || {}) } };
}

async function saveRefreshRecoveryState(next) {
  const state = { ...defaultRefreshRecoveryState(), ...(next || {}), chats: { ...(next?.chats || {}) }, updatedAt: Date.now() };
  await chrome.storage.local.set({ [REFRESH_RECOVERY_KEY]: state });
  return state;
}

function publicRefreshRecoveryState(state) {
  return { attempts: Number(state?.attempts || 0), recovered: Number(state?.recovered || 0), failed: Number(state?.failed || 0), lastActionAt: Number(state?.lastActionAt || 0), updatedAt: Number(state?.updatedAt || 0) };
}

async function noteRefreshRecoveryCleared(chatId, status = 'idle') {
  if (!chatId) return;
  const state = await refreshRecoveryState();
  const row = state.chats[chatId];
  if (!row?.pending || Date.now() - Number(row.lastAttemptAt || 0) > 2 * 60 * 1000) return;
  state.chats[chatId] = { ...row, pending: false, clearedAt: Date.now(), clearedStatus: status };
  state.recovered = Number(state.recovered || 0) + 1; state.lastActionAt = Date.now();
  await saveRefreshRecoveryState(state);
  const cfg = await settings();
  await patchSettings({ refreshRecovery: { recoveredCount: Number(cfg.refreshRecovery.recoveredCount || 0) + 1, lastRecoveredAt: Date.now() } });
  await addEvent('chat-browser-refresh-cleared', 'chat', chatId, chatId, { status });
}

async function recoverTabByRefresh(tabId, chatId, url = '', detail = '', source = 'live-tab') {
  const cfg = await settings();
  if (cfg.refreshRecovery.enabled === false) return { ok: true, skipped: true, reason: 'refresh-recovery-disabled' };
  if (!tabId || !chatId) return { ok: false, error: 'Refresh recovery needs a real chat tab and chat id.' };

  const approvalState = await approvalRecoveryState();
  if (approvalState.status === 'running' && Number(approvalState.tabId || 0) === Number(tabId)) {
    return { ok: true, delegated: true, reason: 'hidden-recovery-lane-owns-tab' };
  }

  const state = await refreshRecoveryState();
  const now = Date.now();
  const cooldownMs = Math.max(30_000, Number(cfg.refreshRecovery.cooldownMs || 10 * 60 * 1000));
  const maxAttempts = Math.max(1, Number(cfg.refreshRecovery.maxRefreshesPerChat || 2));
  let row = { ...(state.chats[chatId] || {}) };
  if (!row.windowStartedAt || now - Number(row.windowStartedAt || 0) >= cooldownMs) row = { windowStartedAt: now, attempts: 0, lastAttemptAt: 0, pending: false };
  if (now - Number(row.lastAttemptAt || 0) < 8_000) return { ok: true, deduped: true, waitMs: 8_000 - (now - Number(row.lastAttemptAt || 0)) };
  if (Number(row.attempts || 0) >= maxAttempts) {
    if (!row.failureRecorded) {
      state.failed = Number(state.failed || 0) + 1;
      row.failureRecorded = true;
      const brainCfg = await settings();
      await patchSettings({ refreshRecovery: { failedCount: Number(brainCfg.refreshRecovery.failedCount || 0) + 1 } });
    }
    state.chats[chatId] = row; await saveRefreshRecoveryState(state);
    return { ok: false, exhausted: true, error: 'Browser refresh recovery reached its per-chat cooldown budget.' };
  }

  row = { ...row, attempts: Number(row.attempts || 0) + 1, lastAttemptAt: now, pending: true, url, detail: String(detail || '').slice(0, 500), source, failureRecorded: false };
  state.chats[chatId] = row; state.attempts = Number(state.attempts || 0) + 1; state.lastActionAt = now;
  await saveRefreshRecoveryState(state);
  const existing = await getOne('chats', chatId);
  await upsert('chats', { id: chatId, providerId: existing?.providerId || 'chatgpt', url: url || existing?.url || '', status: 'refresh-required', statusDetail: detail || existing?.statusDetail || 'Browser refresh required', recoveryKind: 'browser-refresh', retryForbidden: true, refreshRecoveryLastAttemptAt: now, updatedAt: now });
  await addEvent('chat-browser-refresh', 'chat', chatId, chatId, { url: url || existing?.url || '', source, reason: String(detail || 'delivery/connection timeout').slice(0, 500), attempt: row.attempts });
  await chrome.tabs.reload(tabId, { bypassCache: false });
  return { ok: true, refreshed: true, attempt: row.attempts, maxAttempts };
}

const ATTENTION_STATUSES = Object.freeze(['blocked-approval','refresh-required','rate-limited','errored','stalled','auth-required','unavailable']);
const RECOVERY_STATUSES = Object.freeze(['blocked-approval','refresh-required','rate-limited','stalled','paused']);

async function chatsForStatuses(statuses = ATTENTION_STATUSES) {
  const groups = await Promise.all(statuses.map((status) => getAllByIndex('chats', 'status', status)));
  return [...new Map(groups.flat().filter(Boolean).map((chat) => [chat.id, chat])).values()]
    .sort((a,b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

async function updateAttentionBadge() {
  const [statusChats, allChats] = await Promise.all([chatsForStatuses(ATTENTION_STATUSES), getAll('chats')]);
  const chats = [...new Map([...statusChats, ...allChats.filter((chat)=>chat.outputRegression?.active)].map((chat)=>[chat.id,chat])).values()];
  const count = chats.length;
  const text = count > 99 ? '99+' : count ? String(count) : '';
  try { await chrome.action?.setBadgeText?.({ text }); } catch (_) {}
  try { await chrome.action?.setTitle?.({ title: count ? `Project Constellation · ${count} chat${count === 1 ? '' : 's'} need attention` : 'Project Constellation' }); } catch (_) {}
  return { count };
}

function defaultApprovalRecoveryState() {
  return {
    status: 'idle', mode: 'attention', queue: [], index: 0, startedAt: 0, updatedAt: 0, finishedAt: 0,
    currentChatId: '', currentUrl: '', windowId: 0, tabId: 0, stage: 'idle', autoTriggered: false,
    itemStartedAt: 0, itemAttempts: 0, itemRefreshes: 0,
    scanned: 0, recovered: 0, alwaysAllowed: 0, allowedOnce: 0, resumed: 0, refreshed: 0, unchanged: 0, failed: 0,
    lastResult: null, error: ''
  };
}

async function approvalRecoveryState() {
  const stored = (await chrome.storage.local.get(APPROVAL_RECOVERY_STATE_KEY))[APPROVAL_RECOVERY_STATE_KEY];
  return { ...defaultApprovalRecoveryState(), ...(stored || {}) };
}

async function saveApprovalRecoveryState(next) {
  const state = { ...defaultApprovalRecoveryState(), ...(next || {}), updatedAt: Date.now() };
  await chrome.storage.local.set({ [APPROVAL_RECOVERY_STATE_KEY]: state });
  return state;
}

function publicApprovalRecoveryState(state) {
  const s = { ...defaultApprovalRecoveryState(), ...(state || {}) };
  return {
    status: s.status, mode: s.mode, index: s.index, total: s.queue.length, scanned: s.scanned, recovered: s.recovered,
    alwaysAllowed: s.alwaysAllowed, allowedOnce: s.allowedOnce, resumed: s.resumed, refreshed: s.refreshed, unchanged: s.unchanged, failed: s.failed,
    currentChatId: s.currentChatId, currentUrl: s.currentUrl, autoTriggered: s.autoTriggered, startedAt: s.startedAt,
    itemAttempts: s.itemAttempts, itemRefreshes: s.itemRefreshes, updatedAt: s.updatedAt, finishedAt: s.finishedAt, lastResult: s.lastResult, error: s.error
  };
}

async function buildApprovalRecoveryQueue(mode = 'attention', { autoTriggered = false } = {}) {
  const cfg = await settings();
  const now = Date.now();
  let chats;
  if (mode === 'all-known') chats = (await getAll('chats')).filter((chat) => chat.providerId === 'chatgpt');
  else chats = (await chatsForStatuses(RECOVERY_STATUSES)).filter((chat) => chat.providerId === 'chatgpt');
  const seen = new Set();
  const attentionRank = { 'blocked-approval': 0, 'refresh-required': 1, stalled: 2, paused: 3, 'rate-limited': 8, running: 4, idle: 5 };
  return chats.filter((chat) => {
    if (!chat?.id || !chat?.url || seen.has(chat.url)) return false;
    if (!providers.isLikelyChatUrl(chat.url, 'chatgpt')) return false;
    const lastAttempt = Number(chat.approvalRecoveryLastAttemptAt || 0);
    if (chat.status === 'rate-limited' && Number(chat.rateLimitUntil || 0) > now) return false;
    if (mode !== 'all-known' && lastAttempt && now - lastAttempt < 15 * 60 * 1000) return false;
    if (mode === 'all-known' && autoTriggered && lastAttempt && now - lastAttempt < Math.max(60 * 60 * 1000, Number(cfg.approvalAutopilot.autoRescanFreshMs || 24 * 60 * 60 * 1000)) && !RECOVERY_STATUSES.includes(chat.status)) return false;
    seen.add(chat.url); return true;
  }).sort((a,b) => (attentionRank[a.status] ?? 9) - (attentionRank[b.status] ?? 9) || (b.updatedAt || 0) - (a.updatedAt || 0))
    .map((chat) => ({ id: chat.id, url: chat.url, title: chat.title || 'Untitled chat', status: chat.status || 'idle', recoveryKind: chat.recoveryKind || '', retryForbidden: Boolean(chat.retryForbidden), providerId: chat.providerId || 'chatgpt' }));
}

async function closeApprovalRecoveryWindow(state) {
  if (state?.windowId) { try { await chrome.windows?.remove?.(state.windowId); } catch (_) {} }
}

async function ensureApprovalRecoveryWindow(state) {
  if (state.windowId && state.tabId) {
    try { await chrome.tabs.get(state.tabId); return state; } catch (_) {}
  }
  const item = state.queue[state.index];
  if (!item?.url) return state;
  const win = await chrome.windows.create({ url: item.url, type: 'popup', state: 'minimized', focused: false });
  const tab = win.tabs?.[0] || (await chrome.tabs.query({ windowId: win.id }))[0];
  if (!tab?.id) throw new Error('Could not create the hidden approval-recovery tab.');
  return saveApprovalRecoveryState({ ...state, windowId: win.id, tabId: tab.id, stage: 'load', currentChatId: item.id, currentUrl: item.url, itemStartedAt: Date.now(), itemAttempts: 0, itemRefreshes: 0 });
}

function approvalNavigationDelay(state, cfg, { hydration = false } = {}) {
  const base = state?.mode === 'all-known'
    ? Math.max(4000, Number(cfg?.approvalAutopilot?.fullSweepNavigationIntervalMs || 8000))
    : Math.max(2500, Number(cfg?.approvalAutopilot?.attentionNavigationIntervalMs || 4500));
  if (hydration) return Math.max(900, Math.min(base, 2200));
  return base + Math.round(base * (0.05 + Math.random() * 0.12));
}

async function scheduleApprovalRecoveryStep(delay = 800) {
  await chrome.alarms.create(APPROVAL_RECOVERY_ALARM, { when: Date.now() + Math.max(250, Number(delay) || 800) });
}

async function finishApprovalRecovery(state, status = 'completed', error = '') {
  await closeApprovalRecoveryWindow(state);
  const next = await saveApprovalRecoveryState({ ...state, status, stage: 'idle', windowId: 0, tabId: 0, currentChatId: '', currentUrl: '', finishedAt: Date.now(), error });
  const cfg = await settings();
  await patchSettings({ approvalAutopilot: { lastSweepAt: Date.now(), lastRecoveredAt: next.recovered ? Date.now() : cfg.approvalAutopilot.lastRecoveredAt, recoveredCount: Number(cfg.approvalAutopilot.recoveredCount || 0) + next.recovered, failedCount: Number(cfg.approvalAutopilot.failedCount || 0) + next.failed } });
  await updateAttentionBadge();
  if (next.recovered) markDriveDirty().catch(() => {});
  return next;
}

async function startApprovalRecovery({ mode = 'attention', autoTriggered = false } = {}) {
  const cfg = await settings();
  if (!cfg.approvalAutopilot.enabled || !cfg.approvalAutopilot.acknowledged) {
    throw new Error('Approval Autopilot is not enabled and acknowledged in Project Constellation.');
  }
  const existing = await approvalRecoveryState();
  if (existing.status === 'running') return { ok: true, state: publicApprovalRecoveryState(existing), alreadyRunning: true };
  const queue = await buildApprovalRecoveryQueue(mode, { autoTriggered });
  let state = await saveApprovalRecoveryState({ ...defaultApprovalRecoveryState(), status: queue.length ? 'running' : 'completed', mode, queue, startedAt: Date.now(), finishedAt: queue.length ? 0 : Date.now(), autoTriggered });
  if (!queue.length) return { ok: true, state: publicApprovalRecoveryState(state) };
  state = await ensureApprovalRecoveryWindow(state);
  await scheduleApprovalRecoveryStep(approvalNavigationDelay(state, cfg));
  return { ok: true, state: publicApprovalRecoveryState(state) };
}

async function stopApprovalRecovery() {
  const state = await approvalRecoveryState();
  await chrome.alarms.clear(APPROVAL_RECOVERY_ALARM).catch(() => {});
  const next = await finishApprovalRecovery(state, 'stopped');
  return { ok: true, state: publicApprovalRecoveryState(next) };
}

async function processApprovalRecoveryStep() {
  let state = await approvalRecoveryState();
  if (state.status !== 'running') return;
  if (state.index >= state.queue.length) { await finishApprovalRecovery(state); return; }
  state = await ensureApprovalRecoveryWindow(state);
  const item = state.queue[state.index];
  if (!item) { await finishApprovalRecovery(state); return; }
  try {
    let tab = await chrome.tabs.get(state.tabId);
    if (state.currentUrl !== item.url || tab.url !== item.url) {
      await chrome.tabs.update(state.tabId, { url: item.url, active: false });
      await saveApprovalRecoveryState({ ...state, currentChatId: item.id, currentUrl: item.url, stage: 'load', itemStartedAt: Date.now(), itemAttempts: 0, itemRefreshes: 0 });
      await scheduleApprovalRecoveryStep(approvalNavigationDelay(state, await settings()));
      return;
    }
    if (tab.status !== 'complete') {
      const loadAge = Date.now() - Number(state.itemStartedAt || Date.now());
      if (loadAge > 45000) {
        if (Number(state.itemAttempts || 0) < 2) {
          await chrome.tabs.update(state.tabId, { url: item.url, active: false });
          await saveApprovalRecoveryState({ ...state, itemAttempts: Number(state.itemAttempts || 0) + 1, itemStartedAt: Date.now(), stage: 'reload' });
          await scheduleApprovalRecoveryStep(approvalNavigationDelay(state, await settings()));
          return;
        }
        throw new Error('Timed out waiting for the recovery chat to finish loading.');
      }
      await scheduleApprovalRecoveryStep(1200); return;
    }
    const cfg = await settings();
    let result;
    try {
      result = await chrome.tabs.sendMessage(state.tabId, {
        type: 'PC_APPROVAL_RECOVERY_SCAN',
        options: {
          alwaysAllow: cfg.approvalAutopilot.alwaysAllow !== false,
          fallbackAllowOnce: cfg.approvalAutopilot.fallbackAllowOnce !== false,
          recoverPaused: cfg.approvalAutopilot.autoRecoverPaused !== false
        }
      });
    } catch (error) {
      const reason = String(error?.message || error);
      const attempts = Number(state.itemAttempts || 0);
      if (attempts < 3) {
        if (attempts >= 1) await chrome.tabs.update(state.tabId, { url: item.url, active: false }).catch(() => {});
        await saveApprovalRecoveryState({ ...state, itemAttempts: attempts + 1, itemStartedAt: attempts >= 1 ? Date.now() : state.itemStartedAt, stage: attempts >= 1 ? 'reload' : 'retry', error: reason });
        await scheduleApprovalRecoveryStep(attempts >= 1 ? 2200 : 900);
        return;
      }
      result = { ok: false, action: 'failed', error: reason };
    }
    if (result?.action === 'rate-limited') {
      const waitMs = Math.max(30_000, Math.min(60 * 60 * 1000, Number(result.waitMs || 0) || 15 * 60 * 1000));
      const until = Date.now() + waitMs;
      await noteProviderRateLimit('chatgpt', waitMs, result?.reason || 'Too many requests', 'hidden-recovery');
      await upsert('chats', { id: item.id, status: 'rate-limited', statusDetail: result?.reason || 'ChatGPT rate limit detected.', recoveryKind: 'provider-cooldown', retryForbidden: true, rateLimitUntil: until, approvalRecoveryLastAttemptAt: Date.now(), approvalRecoveryLastAction: 'rate-limited', updatedAt: Date.now() });
      await addEvent('provider-rate-limited', 'chat', item.id, item.id, { providerId: 'chatgpt', waitMs, until, source: 'hidden-recovery', url: item.url });
      await closeApprovalRecoveryWindow(state);
      state = await saveApprovalRecoveryState({ ...state, windowId: 0, tabId: 0, stage: 'rate-limit-wait', error: '', lastResult: { chatId: item.id, title: item.title, action: 'rate-limited', reason: result?.reason || 'Provider cooldown' } });
      await scheduleApprovalRecoveryStep(waitMs);
      await updateAttentionBadge();
      return;
    }
    if (result?.action === 'refresh-required') {
      const refreshCfg = (await settings()).refreshRecovery;
      const refreshes = Number(state.itemRefreshes || 0);
      if (refreshCfg.enabled !== false && refreshes < Math.max(1, Number(refreshCfg.maxRefreshesPerChat || 2))) {
        await chrome.tabs.reload(state.tabId, { bypassCache: false });
        await saveApprovalRecoveryState({ ...state, itemRefreshes: refreshes + 1, itemAttempts: 0, itemStartedAt: Date.now(), stage: 'browser-refresh', error: '' });
        await addEvent('chat-browser-refresh', 'chat', item.id, item.id, { url: item.url, source: 'hidden-recovery', reason: result?.reason || 'delivery/connection timeout' });
        await scheduleApprovalRecoveryStep(2200);
        return;
      }
      result = { ok: false, action: 'failed', error: 'Browser refresh did not clear the connection/delivery error within the configured retry budget.' };
    }
    if (result?.action === 'not-ready') {
      const attempts = Number(state.itemAttempts || 0);
      if (attempts < 3) {
        await saveApprovalRecoveryState({ ...state, itemAttempts: attempts + 1, stage: 'hydrate', error: '' });
        await scheduleApprovalRecoveryStep(900 + attempts * 450);
        return;
      }
    }
    let action = String(result?.action || 'none');
    if (action === 'none' && Number(state.itemRefreshes || 0) > 0) action = 'refreshed';
    const recovered = ['always-allow','allow-once','resume','refreshed'].includes(action);
    const patch = {
      id: item.id, approvalRecoveryLastAttemptAt: Date.now(), approvalRecoveryLastAction: action,
      approvalRecoveryLastResult: result?.reason || result?.error || '', updatedAt: Date.now()
    };
    if (recovered) {
      patch.status = 'idle'; patch.statusDetail = `Recovered by Project Constellation (${action})`;
      patch.approvalRecoveredAt = Date.now();
      if (action === 'always-allow') patch.approvalPersistentAt = Date.now();
      await addEvent('approval-recovery', 'chat', item.id, item.id, { action, connector: result?.connector || '', mode: state.mode, url: item.url });
    }
    await upsert('chats', patch);
    const next = {
      ...state, index: state.index + 1, scanned: state.scanned + 1, recovered: state.recovered + (recovered ? 1 : 0),
      alwaysAllowed: state.alwaysAllowed + (action === 'always-allow' ? 1 : 0), allowedOnce: state.allowedOnce + (action === 'allow-once' ? 1 : 0),
      resumed: state.resumed + (action === 'resume' ? 1 : 0), refreshed: Number(state.refreshed || 0) + (action === 'refreshed' ? 1 : 0), unchanged: state.unchanged + (action === 'none' ? 1 : 0),
      failed: state.failed + (result?.ok === false ? 1 : 0), lastResult: { chatId: item.id, title: item.title, action, connector: result?.connector || '', reason: result?.reason || result?.error || '' },
      stage: 'load', itemAttempts: 0, itemRefreshes: 0, itemStartedAt: 0
    };
    state = await saveApprovalRecoveryState(next);
    if (state.index >= state.queue.length) { await finishApprovalRecovery(state); return; }
    const upcoming = state.queue[state.index];
    await chrome.tabs.update(state.tabId, { url: upcoming.url, active: false });
    await saveApprovalRecoveryState({ ...state, currentChatId: upcoming.id, currentUrl: upcoming.url, stage: 'load', itemStartedAt: Date.now(), itemAttempts: 0, itemRefreshes: 0, error: '' });
    await scheduleApprovalRecoveryStep(approvalNavigationDelay(state, await settings()));
  } catch (error) {
    const next = await saveApprovalRecoveryState({ ...state, failed: state.failed + 1, index: state.index + 1, error: String(error?.message || error), lastResult: { chatId: item.id, title: item.title, action: 'failed', reason: String(error?.message || error) } });
    if (next.index >= next.queue.length) await finishApprovalRecovery(next); else await scheduleApprovalRecoveryStep(approvalNavigationDelay(next, await settings()));
  }
}


function knowledgeInputFingerprint(turn = {}) {
  const links = (Array.isArray(turn.links) ? turn.links : []).slice(0, 96).map((item) => [item?.href || item?.url || '', item?.text || '', item?.context || '']);
  const codeBlocks = (Array.isArray(turn.codeBlocks) ? turn.codeBlocks : []).slice(0, 24).map((item) => [item?.language || '', knowledge.hashString(String(item?.text || '').slice(0, 32000))]);
  return knowledge.hashString(JSON.stringify({ v: knowledge.VERSION, role: turn.role || '', text: String(turn.text || ''), links, codeBlocks }));
}

async function getMany(storeName, ids = []) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return [];
  const db = await openDb();
  try {
    const tx = db.transaction(storeName, 'readonly'); const store = tx.objectStore(storeName);
    const rows = await Promise.all(unique.map((id) => requestResult(store.get(id))));
    return rows.filter(Boolean);
  } finally { db.close(); }
}

async function deleteSearchDocs(ids = []) {
  const unique = [...new Set(ids.filter(Boolean))]; if (!unique.length) return;
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(SEARCH_STORE, 'readwrite'); const store = tx.objectStore(SEARCH_STORE);
      unique.forEach((id) => store.delete(id)); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}

async function countByIndex(storeName, indexName, value) {
  if (!isValidIndexedDbKey(value)) return 0;
  const db = await openDb();
  try {
    const store = db.transaction(storeName, 'readonly').objectStore(storeName);
    if (!store.indexNames.contains(indexName)) return 0;
    return Number(await requestResult(store.index(indexName).count(indexedDbOnly(value, `${storeName}.${indexName}`))) || 0);
  } finally { db.close(); }
}

async function recentByCompoundIndex(storeName, indexName, prefix, limit = 80, offset = 0) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 80, 250)); const safeOffset = Math.max(0, Number(offset) || 0);
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly'); const store = tx.objectStore(storeName); const index = store.index(indexName);
      const range = IDBKeyRange.bound([prefix, 0], [prefix, Number.MAX_SAFE_INTEGER]); const out = []; let skipped = 0;
      const request = index.openCursor(range, 'prev');
      request.onsuccess = () => { const cursor = request.result; if (!cursor || out.length >= safeLimit) { resolve(out); return; } if (skipped < safeOffset) skipped += 1; else out.push(cursor.value); cursor.continue(); };
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

async function updateProjectContinuity(items = [], chat = null) {
  if (!chat || !items.length) return;
  const projectId = chat.workspaceProjectId || chat.projectId || '';
  if (!projectId) return;
  const now = Math.max(...items.map((item) => Number(item.updatedAt || 0)), Date.now());
  const existing = await getOne('projectContinuity', projectId) || { id: projectId, projectId };
  const next = { ...existing, id: projectId, projectId, projectName: chat.workspaceProjectName || chat.projectName || existing.projectName || 'Project', providerId: chat.providerId || existing.providerId || '', latestChatId: chat.id, latestChatTitle: chat.title || existing.latestChatTitle || '', latestChatUrl: chat.url || existing.latestChatUrl || '', lastKnowledgeAt: Math.max(Number(existing.lastKnowledgeAt || 0), now), updatedAt: Math.max(Number(existing.updatedAt || 0), now) };
  const fieldMap = { recommendation: 'latestRecommendation', decision: 'latestDecision', 'follow-up': 'latestFollowUp', idea: 'latestIdea', code: 'latestCode', command: 'latestCode', version: 'latestVersion', repository: 'latestReference', mod: 'latestReference', package: 'latestReference', document: 'latestReference', link: 'latestReference' };
  for (const item of items) {
    const field = fieldMap[item.kind]; if (!field) continue;
    const stampField = `${field}At`; if (Number(next[stampField] || 0) > Number(item.updatedAt || 0)) continue;
    next[field] = { itemId: item.id, kind: item.kind, title: item.title || item.text || '', text: String(item.text || '').slice(0, 800), url: item.url || '', chatId: chat.id, chatTitle: chat.title || '', chatUrl: chat.url || '', turnId: item.sourceTurnId || '', updatedAt: item.updatedAt || now };
    next[stampField] = item.updatedAt || now;
  }
  await upsert('projectContinuity', next);
}

async function deleteOneRecord(storeName, id) {
  if (!id) return false;
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite'); tx.objectStore(storeName).delete(id);
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
    return true;
  } finally { db.close(); }
}

async function rebuildWorkspaceContinuity(projectId) {
  if (!projectId) return null;
  const project = await getOne('projects', projectId);
  if (!project || project.deletedAt) { await deleteOneRecord('projectContinuity', projectId); return null; }
  const [items, files] = await Promise.all([
    recentByCompoundIndex('knowledgeItems', 'workspaceProjectUpdatedAt', projectId, 320, 0),
    getAllByIndex('files', 'workspaceProjectId', projectId)
  ]);
  files.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
  if (!items.length && !files.length) { await deleteOneRecord('projectContinuity', projectId); return null; }
  const chatIds = [...new Set([...items.map((item)=>item.chatId), ...files.map((file)=>file.chatId)].filter(Boolean))];
  const chats = new Map((await getMany('chats', chatIds)).map((chat)=>[chat.id, chat]));
  const row = { id: projectId, projectId, projectName: project.name || 'Project', updatedAt: 0, lastKnowledgeAt: 0, lastArtifactAt: 0 };
  const fieldMap = { recommendation: 'latestRecommendation', decision: 'latestDecision', 'follow-up': 'latestFollowUp', idea: 'latestIdea', code: 'latestCode', command: 'latestCode', version: 'latestVersion', repository: 'latestReference', mod: 'latestReference', package: 'latestReference', document: 'latestReference', link: 'latestReference', media: 'latestReference', reference: 'latestReference' };
  for (const item of items) {
    const field = fieldMap[item.kind]; if (!field || row[field]) continue;
    const chat = chats.get(item.chatId) || {};
    row[field] = { itemId:item.id, kind:item.kind, title:item.title||item.text||'', text:String(item.text||'').slice(0,800), url:item.url||'', chatId:item.chatId||'', chatTitle:chat.title||'', chatUrl:chat.url||item.sourceUrl||'', turnId:item.sourceTurnId||'', updatedAt:item.updatedAt||0 };
    row[`${field}At`] = Number(item.updatedAt||0); row.lastKnowledgeAt = Math.max(row.lastKnowledgeAt, Number(item.updatedAt||0)); row.updatedAt = Math.max(row.updatedAt, Number(item.updatedAt||0));
  }
  const file = files[0];
  if (file) {
    const chat = chats.get(file.chatId) || {}; const stamp=Number(file.updatedAt||0);
    row.latestArtifact={fileId:file.id,title:file.name||'Artifact',url:file.externalUrl||file.href||'',chatId:file.chatId||'',chatTitle:chat.title||'',chatUrl:chat.url||file.sourcePage||'',updatedAt:stamp}; row.latestArtifactAt=stamp; row.lastArtifactAt=stamp; row.updatedAt=Math.max(row.updatedAt,stamp);
  }
  const latestCandidates=[...items.slice(0,12).map((item)=>({chatId:item.chatId,at:Number(item.updatedAt||0)})),...files.slice(0,12).map((fileRow)=>({chatId:fileRow.chatId,at:Number(fileRow.updatedAt||0)}))].filter((x)=>x.chatId).sort((a,b)=>b.at-a.at);
  const latestChat=latestCandidates.length?chats.get(latestCandidates[0].chatId):null;
  if (latestChat) { row.providerId=latestChat.providerId||''; row.latestChatId=latestChat.id; row.latestChatTitle=latestChat.title||''; row.latestChatUrl=latestChat.url||''; }
  await upsert('projectContinuity', row); return row;
}

async function updateContinuityFromFiles(files = []) {
  if (!files.length) return;
  const byChat = new Map();
  for (const file of files) if (file?.chatId) { const list = byChat.get(file.chatId) || []; list.push(file); byChat.set(file.chatId, list); }
  const chats = new Map((await getMany('chats', [...byChat.keys()])).map((chat) => [chat.id, chat]));
  for (const [chatId, rows] of byChat) {
    const chat = chats.get(chatId); if (!chat) continue;
    const projectId = chat.workspaceProjectId || chat.projectId || ''; if (!projectId) continue;
    rows.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0)); const file = rows[0]; const existing = await getOne('projectContinuity', projectId) || { id: projectId, projectId };
    const stamp = Number(file.updatedAt || Date.now());
    const next = { ...existing, id: projectId, projectId, projectName: chat.workspaceProjectName || chat.projectName || existing.projectName || 'Project', providerId: chat.providerId || existing.providerId || '', latestChatId: chat.id, latestChatTitle: chat.title || existing.latestChatTitle || '', latestChatUrl: chat.url || existing.latestChatUrl || '', lastArtifactAt: Math.max(Number(existing.lastArtifactAt || 0), stamp), updatedAt: Math.max(Number(existing.updatedAt || 0), stamp) };
    if (stamp >= Number(existing.latestArtifactAt || 0)) {
      next.latestArtifact = { fileId: file.id, title: file.name || 'Artifact', url: file.externalUrl || file.href || '', chatId: chat.id, chatTitle: chat.title || '', chatUrl: chat.url || '', updatedAt: stamp }; next.latestArtifactAt = stamp;
    }
    await upsert('projectContinuity', next);
  }
}

async function replaceKnowledgeForTurn(turn, sourceRecord = null) {
  if (!turn?.id || !turn?.chatId) return { items: 0, skipped: true };
  const inputFingerprint = knowledgeInputFingerprint(turn);
  const source = sourceRecord || await getOne('knowledgeSources', turn.id);
  if (source?.status === 'done' && source.inputFingerprint === inputFingerprint && Number(source.extractionVersion || 0) === knowledge.VERSION) return { items: Number(source.itemCount || 0), skipped: true };
  const chat = await getOne('chats', turn.chatId);
  const result = knowledge.extractTurnKnowledge(turn, { providerId: chat?.providerId || turn.providerId || '', projectId: chat?.projectId || '', workspaceProjectId: chat?.workspaceProjectId || '', workspaceProjectName: chat?.workspaceProjectName || '', chatUrl: chat?.url || turn.url || '' });
  const previous = await getAllByIndex('knowledgeItems', 'sourceTurnId', turn.id);
  if (previous.length) {
    await deleteByIndex('knowledgeItems', 'sourceTurnId', turn.id);
    await deleteSearchDocs(previous.map((item) => `knowledge:${item.id}`));
  }
  if (result.items.length) {
    await putManyChunked('knowledgeItems', result.items, 220);
    await putSearchDocs(result.items.map((item) => searchDoc('knowledge', item)));
    await updateProjectContinuity(result.items, chat);
  }
  await upsert('knowledgeSources', { id: turn.id, chatId: turn.chatId, providerId: turn.providerId || chat?.providerId || '', status: 'done', inputFingerprint, extractionFingerprint: result.fingerprint, extractionVersion: knowledge.VERSION, itemCount: result.items.length, extractedAt: Date.now(), updatedAt: Date.now() });
  return { items: result.items.length, skipped: false };
}

async function enqueueKnowledgeExtraction(turns = []) {
  const cfg = await settings(); if (!cfg.knowledge?.enabled || !Array.isArray(turns) || !turns.length) return { queued: 0 };
  const unique = [...new Map(turns.filter((turn) => turn?.id).map((turn) => [turn.id, turn])).values()]; if (!unique.length) return { queued: 0 };
  const existing = new Map((await getMany('knowledgeSources', unique.map((turn) => turn.id))).map((row) => [row.id, row]));
  const pending = [];
  for (const turn of unique) {
    const inputFingerprint = knowledgeInputFingerprint(turn); const old = existing.get(turn.id);
    if (old?.status === 'done' && old.inputFingerprint === inputFingerprint && Number(old.extractionVersion || 0) === knowledge.VERSION) continue;
    pending.push({ id: turn.id, chatId: turn.chatId || '', providerId: turn.providerId || '', status: 'pending', inputFingerprint, extractionVersion: knowledge.VERSION, attempts: old?.inputFingerprint === inputFingerprint ? Number(old.attempts || 0) : 0, updatedAt: Number(turn.updatedAt || Date.now()) });
  }
  if (pending.length) { await putMany('knowledgeSources', pending); await chrome.alarms.create(KNOWLEDGE_INDEX_ALARM, { when: Date.now() + 250 }); }
  return { queued: pending.length };
}

async function pendingKnowledgeSources(limit = 28) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 28, 120));
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('knowledgeSources', 'readonly'); const index = tx.objectStore('knowledgeSources').index('statusUpdatedAt');
      const range = IDBKeyRange.bound(['pending', 0], ['pending', Number.MAX_SAFE_INTEGER]); const out = [];
      const request = index.openCursor(range, 'next');
      request.onsuccess = () => { const cursor = request.result; if (!cursor || out.length >= safeLimit) { resolve(out); return; } out.push(cursor.value); cursor.continue(); };
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

async function knowledgeBackfillState() {
  return (await chrome.storage.local.get(KNOWLEDGE_BACKFILL_KEY))[KNOWLEDGE_BACKFILL_KEY] || { active: false, lastKey: '', queued: 0, startedAt: 0, updatedAt: 0, completedAt: 0 };
}

async function saveKnowledgeBackfillState(state) {
  const next = { active: false, lastKey: '', queued: 0, startedAt: 0, updatedAt: 0, completedAt: 0, ...(state || {}), updatedAt: Date.now() };
  await chrome.storage.local.set({ [KNOWLEDGE_BACKFILL_KEY]: next }); return next;
}

async function startKnowledgeBackfillIfNeeded({ force = false } = {}) {
  const cfg = await settings(); if (!cfg.knowledge?.enabled) return { active: false };
  const [turns, sources] = await Promise.all([countStore('turns'), countStore('knowledgeSources')]);
  const state = await knowledgeBackfillState();
  if (!force && !state.active && sources >= turns && Number(cfg.knowledge.extractionVersion || 0) >= knowledge.VERSION) return state;
  const next = await saveKnowledgeBackfillState({ active: true, lastKey: force ? '' : (state.active ? state.lastKey || '' : ''), queued: force ? 0 : Number(state.queued || 0), startedAt: state.active && state.startedAt ? state.startedAt : Date.now(), completedAt: 0 });
  await chrome.alarms.create(KNOWLEDGE_INDEX_ALARM, { when: Date.now() + 400 }); return next;
}

async function nextTurnBackfillChunk(afterKey = '', limit = 180) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('turns', 'readonly'); const store = tx.objectStore('turns'); const out = [];
      const range = afterKey ? IDBKeyRange.lowerBound(afterKey, true) : null; const request = store.openCursor(range, 'next');
      request.onsuccess = () => { const cursor = request.result; if (!cursor || out.length >= limit) { resolve(out); return; } out.push(cursor.value); cursor.continue(); };
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

let knowledgeProcessing = false;
async function processKnowledgeWork() {
  if (knowledgeProcessing) return { busy: true }; knowledgeProcessing = true;
  try {
    const cfg = await settings(); if (!cfg.knowledge?.enabled) return { disabled: true };
    const idleState = await chrome.idle?.queryState?.(45).catch(() => 'active') || 'active';
    const isIdle = idleState !== 'active';
    const normalBatch = Math.max(4, Math.min(Number(cfg.knowledge.extractionBatchSize || 28), 80));
    const activeBatch = Math.max(2, Math.min(Number(cfg.knowledge.activeExtractionBatchSize || 6), 12));
    const batchSize = isIdle ? normalBatch : Math.min(normalBatch, activeBatch);
    const pending = await pendingKnowledgeSources(batchSize); let extracted = 0, failed = 0;
    for (let index = 0; index < pending.length; index += 1) {
      const source = pending[index];
      try {
        const turn = await getOne('turns', source.id);
        if (!turn) { await upsert('knowledgeSources', { id: source.id, status: 'missing', updatedAt: Date.now() }); continue; }
        const result = await replaceKnowledgeForTurn(turn, source); extracted += Number(result.items || 0);
      } catch (error) {
        failed += 1; await upsert('knowledgeSources', { id: source.id, status: 'error', error: String(error?.message || error).slice(0, 500), attempts: Number(source.attempts || 0) + 1, updatedAt: Date.now() });
      }
      if (index && index % 5 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const backfill = await knowledgeBackfillState(); let backfillQueued = 0;
    const allowBackfill = backfill.active && (!cfg.knowledge.idleBackfillOnly || isIdle);
    if (allowBackfill && pending.length < batchSize) {
      const rows = await nextTurnBackfillChunk(backfill.lastKey || '', Math.max(40, Math.min(Number(cfg.knowledge.backfillBatchSize || 180), 500)));
      if (rows.length) {
        backfillQueued = (await enqueueKnowledgeExtraction(rows)).queued;
        const lastKey = rows.at(-1)?.id || backfill.lastKey || '';
        const done = rows.length < Math.max(40, Math.min(Number(cfg.knowledge.backfillBatchSize || 180), 500));
        await saveKnowledgeBackfillState({ ...backfill, active: !done, lastKey, queued: Number(backfill.queued || 0) + rows.length, completedAt: done ? Date.now() : 0 });
        if (done) await patchSettings({ knowledge: { lastBackfillAt: Date.now(), extractionVersion: knowledge.VERSION } });
      } else {
        await saveKnowledgeBackfillState({ ...backfill, active: false, completedAt: Date.now() });
        await patchSettings({ knowledge: { lastBackfillAt: Date.now(), extractionVersion: knowledge.VERSION } });
      }
    }
    const remaining = await countByIndex('knowledgeSources', 'status', 'pending'); const nextBackfill = await knowledgeBackfillState();
    if (remaining || nextBackfill.active) {
      const wait = !isIdle && nextBackfill.active ? 15000 : remaining > 200 ? 700 : 1200;
      await chrome.alarms.create(KNOWLEDGE_INDEX_ALARM, { when: Date.now() + wait });
    }
    if (extracted) { markDriveDirty().catch(() => {}); }
    return { extracted, failed, remaining, backfillQueued, backfill: nextBackfill, idleState, batchSize };
  } finally { knowledgeProcessing = false; }
}

async function knowledgeKindCounts(kinds = []) {
  if (!kinds.length) return {};
  const db = await openDb();
  try {
    const index = db.transaction('knowledgeItems', 'readonly').objectStore('knowledgeItems').index('kind');
    const counts = await Promise.all(kinds.map((kind) => requestResult(index.count(indexedDbOnly(kind, 'knowledgeItems.kind')))));
    return Object.fromEntries(kinds.map((kind, index) => [kind, Number(counts[index] || 0)]));
  } finally { db.close(); }
}

async function knowledgeSummary(limit = 24) {
  const kinds = knowledge.KINDS || [];
  const [total, pending, recent, continuity, kindCounts] = await Promise.all([
    countStore('knowledgeItems'), countByIndex('knowledgeSources', 'status', 'pending'), getRecent('knowledgeItems', limit), getRecent('projectContinuity', 18), knowledgeKindCounts(kinds)
  ]);
  return { total, pending, kinds: kindCounts, recent, continuity, backfill: await knowledgeBackfillState(), extractionVersion: knowledge.VERSION };
}

async function knowledgeList(filters = {}) {
  const limit = Math.max(1, Math.min(Number(filters.limit) || 80, 200)); const offset = Math.max(0, Number(filters.offset) || 0); const kind = String(filters.kind || '');
  const workspaceProjectId=String(filters.workspaceProjectId||''); const projectId=String(filters.projectId||''); let items = [];
  if (filters.query) {
    const hits = (await searchBrain(String(filters.query || ''), SEARCH_RESULT_LIMIT)).filter((hit) => hit.entityType === 'knowledge');
    const score = new Map(hits.map((hit) => [hit.entityId, hit.score || 0]));
    items = await getMany('knowledgeItems', hits.map((hit) => hit.entityId));
    if(kind)items=items.filter((item)=>item.kind===kind); if(workspaceProjectId)items=items.filter((item)=>item.workspaceProjectId===workspaceProjectId); if(projectId)items=items.filter((item)=>item.projectId===projectId||item.workspaceProjectId===projectId);
    items.sort((a,b)=>(score.get(b.id)||0)-(score.get(a.id)||0)||(b.updatedAt||0)-(a.updatedAt||0)); items=items.slice(offset,offset+limit);
  } else if (workspaceProjectId) {
    items = await recentByCompoundIndex('knowledgeItems','workspaceProjectUpdatedAt',workspaceProjectId,Math.min(250,limit+offset+120),0); if(kind)items=items.filter((item)=>item.kind===kind); items=items.slice(offset,offset+limit);
  } else if (projectId) {
    const [workspaceRows,sourceRows]=await Promise.all([recentByCompoundIndex('knowledgeItems','workspaceProjectUpdatedAt',projectId,Math.min(250,limit+offset+120),0),recentByCompoundIndex('knowledgeItems','projectUpdatedAt',projectId,Math.min(250,limit+offset+120),0)]);
    items=[...new Map([...workspaceRows,...sourceRows].map((item)=>[item.id,item])).values()].sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));if(kind)items=items.filter((item)=>item.kind===kind);items=items.slice(offset,offset+limit);
  } else if (kind) items = await recentByCompoundIndex('knowledgeItems', 'kindUpdatedAt', kind, limit, offset);
  else items = await getRecent('knowledgeItems', limit, offset);
  const chats = new Map((await getMany('chats', items.map((item) => item.chatId))).map((chat) => [chat.id, chat]));
  return items.map((item) => ({ ...item, chat: chats.get(item.chatId) ? { id: item.chatId, title: chats.get(item.chatId).title || 'Untitled chat', url: chats.get(item.chatId).url || item.sourceUrl || '', providerId: chats.get(item.chatId).providerId || item.providerId || '', projectId: chats.get(item.chatId).workspaceProjectId || chats.get(item.chatId).projectId || '', projectName: chats.get(item.chatId).workspaceProjectName || chats.get(item.chatId).projectName || '' } : null }));
}

async function resetKnowledgeIndex() {
  await Promise.all([clearStore('knowledgeItems'), clearStore('knowledgeSources'), clearStore('projectContinuity')]);
  const docs = await getAll(SEARCH_STORE); await deleteSearchDocs(docs.filter((doc) => doc.entityType === 'knowledge').map((doc) => doc.id));
  await saveKnowledgeBackfillState({ active: true, lastKey: '', queued: 0, startedAt: Date.now(), completedAt: 0 });
  await chrome.alarms.create(KNOWLEDGE_INDEX_ALARM, { when: Date.now() + 300 });
  return { ok: true, state: await knowledgeBackfillState() };
}

async function watchForStalls() {
  const cfg = await settings();
  const now = Date.now();
  const running = await getAllByIndex('chats', 'status', 'running');
  const stale = [];
  for (const chat of running) {
    // createdAt is an ingest timestamp for newly catalogued records and can be much
    // newer than the conversation's last real activity. Stall detection must only
    // consider semantic activity timestamps or it will keep old running chats alive.
    const activity = Math.max(Number(chat.lastActivityAt || 0), Number(chat.lastTurnAt || 0));
    if (!activity || now - activity < Math.max(30000, Number(cfg.stallThresholdMs || 120000))) continue;
    const merged = await upsert('chats', { id: chat.id, status: 'stalled', statusDetail: `No semantic activity for ${Math.round((now - activity) / 1000)} seconds`, stalledAt: now, updatedAt: now });
    stale.push(merged);
    await addEvent('chat-stalled', 'chat', chat.id, chat.id, { inactivityMs: now - activity, previousStatus: 'running' });
  }
  await updateAttentionBadge();
  if (cfg.approvalAutopilot.enabled && cfg.approvalAutopilot.acknowledged && cfg.approvalAutopilot.backgroundRecovery) {
    const state = await approvalRecoveryState();
    if (state.status !== 'running') {
      const candidates = await buildApprovalRecoveryQueue('attention');
      if (candidates.length) startApprovalRecovery({ mode: 'attention', autoTriggered: true }).catch(() => {});
    }
  }
  return { stalled: stale.length };
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
    else if (type === 'FILE_UPSERT' && data.id) {
      const file = { ...data, id:String(data.id).slice(0,900), name:brain.normalizeText(data.name || '',500), href:String(data.href || '').slice(0,8000), externalUrl:String(data.externalUrl || '').slice(0,8000), sourceUrl:String(data.sourceUrl || '').slice(0,8000), updatedAt:data.updatedAt || now };
      if (typeof data.embeddedDataUrl === 'string' && /^data:[^;,]{1,160}(?:;[^,]{0,120})?,/i.test(data.embeddedDataUrl) && data.embeddedDataUrl.length <= 12 * 1024 * 1024) file.embeddedDataUrl = data.embeddedDataUrl;
      else delete file.embeddedDataUrl;
      files.push(file);
    }
    else if (type === 'STATUS_EVENT' && data.chatId) statusEvents.push(data);
    else if (type === 'STATUS_HEARTBEAT' && data.chatId) chats.push({ id: data.chatId, providerId: data.providerId || '', status: data.status || 'running', lastActivityAt: data.lastActivityAt || now, lastSeenAt: now, url: data.url || '', updatedAt: now });
    else if (type === 'ROUTE_EVENT') routeEvents.push(data);
  }

  await Promise.all([
    putMany('providers', providerRecords), putMany('projects', projects), putMany('chats', chats), putMany('files', files)
  ]);
  const preserved = await preserveTurnRevisions(turns);
  const canonicalTurns = preserved.turns;

  // Maintain a dedicated multi-entry inverted index asynchronously inside IndexedDB.
  // This keeps full-history search off AI pages and avoids transcript-wide scans in the UI.
  await putSearchDocs([
    ...projects.map((record) => searchDoc('project', record)),
    ...chats.map((record) => searchDoc('chat', record)),
    ...canonicalTurns.map((record) => searchDoc('turn', record)),
    ...files.map((record) => searchDoc('file', record))
  ]);
  if (canonicalTurns.length) await enqueueKnowledgeExtraction(canonicalTurns);
  if (files.length) await updateContinuityFromFiles(files);

  if (canonicalTurns.length) {
    const latestByChat = new Map();
    for (const turn of canonicalTurns) {
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
    const mergedStatusChat = await upsert('chats', { id: status.chatId, providerId: status.providerId || previous?.providerId || '', status: status.status, statusDetail: status.detail || '', url: status.url || previous?.url || '', approvalConnector: status.approvalConnector || previous?.approvalConnector || '', recoveryKind: status.status === 'refresh-required' ? (status.recoveryKind || 'browser-refresh') : (status.recoveryKind || ''), retryForbidden: Boolean(status.status === 'refresh-required' && (status.retryForbidden !== false)), lastSeenAt: now, lastActivityAt: now, updatedAt: now });
    await putSearchDocs([searchDoc('chat', mergedStatusChat)]);
    if (previous?.status !== status.status) await addEvent('chat-status', 'chat', status.chatId, status.chatId, { from: previous?.status || '', to: status.status, detail: (status.detail || '').slice(0, 500) });
    if (previous?.status === 'refresh-required' && status.status !== 'refresh-required') noteRefreshRecoveryCleared(status.chatId, status.status).catch(() => {});
  }

  for (const route of routeEvents.slice(-20)) {
    if (route.chatId && !route.chatId.endsWith(':home')) await addEvent('route', 'chat', route.chatId, route.chatId, { providerId: route.providerId || '', url: route.url || '', title: route.title || '' });
  }

  if (chats.length || turns.length || files.length || statusEvents.length) {
    await addEvent('capture-batch', 'brain', '', chats.at(-1)?.id || turns.at(-1)?.chatId || files.at(-1)?.chatId || '', { chats: chats.length, turns: turns.length, files: files.length, statuses: statusEvents.length });
    markDriveDirty().catch(() => {});
    scheduleIntegrityScan(5000).catch(() => {});
  }
  pruneEvents().catch(() => {});
  if (statusEvents.length) updateAttentionBadge().catch(() => {});
  return { ok: true, counts: { providers: providerRecords.length, projects: projects.length, chats: chats.length, turns: turns.length, turnRevisions: preserved.revisions.length, files: files.length, statuses: statusEvents.length } };
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
  const [providerRecords, projects, chats, files, events, checkpoints, syncReceipts, catalogRuns, cfg, catalog, fullCapture, turnCount, searchDocCount, approvalRecovery, governor, integrityState, knowledgeState] = await Promise.all([
    getAll('providers'), getAll('projects'), getAll('chats'), getAll('files'), getAll('events'), getAll('checkpoints'), getAll('syncReceipts'), getAll('catalogRuns'), settings(), catalogState(), fullCaptureState(), countStore('turns'), countStore(SEARCH_STORE), approvalRecoveryState(), requestGovernorState(), integritySummary(), knowledgeSummary(12)
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
    summary: { providers: providerRecords.length, projects: projects.length, chats: chats.length, turns: turnCount, files: files.length, knowledge: knowledgeState.total || 0, searchDocs: searchDocCount, statusCounts },
    localStorage,
    organization, integrity: integrityState, knowledge: knowledgeState, requestGovernor: publicRequestGovernor(governor),
    projectIntegrity: { ...cfg.projectIntegrity }, liveHealth: { ...cfg.liveHealth }, approvalAutopilot: { ...cfg.approvalAutopilot }, approvalRecovery: publicApprovalRecoveryState(approvalRecovery), refreshRecovery: { ...cfg.refreshRecovery, runtime: publicRefreshRecoveryState(await refreshRecoveryState()) },
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
    const attentionStatuses=['blocked-approval','refresh-required','errored','stalled','auth-required','unavailable'];
    const entries=await Promise.all(ids.map(async(id)=>{
      const [chatCount,fileCount,...attention]=await Promise.all([
        requestResult(projectIndex.count(indexedDbOnly(id, 'chats.workspaceProjectId'))),requestResult(fileIndex.count(indexedDbOnly(id, 'files.workspaceProjectId'))),
        ...attentionStatuses.map((status)=>requestResult(statusIndex.count(indexedDbOnly([id,status], 'chats.workspaceProjectStatus'))))
      ]); return [id,{chatCount,fileCount,attentionCount:attention.reduce((sum,n)=>sum+Number(n||0),0)}];
    })); return new Map(entries);
  } finally { db.close(); }
}

async function organizationTagCounts(limit=100) {
  const db=await openDb();
  try { return await new Promise((resolve,reject)=>{
    const tx=db.transaction('chats','readonly'); const index=tx.objectStore('chats').index('tags'); const out=[]; const request=index.openKeyCursor(null,'nextunique');
    request.onsuccess=()=>{const cursor=request.result;if(!cursor||out.length>=limit){resolve(out.sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name)));return;}const name=String(cursor.key||'');const countReq=index.count(indexedDbOnly(cursor.key, 'chats.tags'));countReq.onsuccess=()=>{out.push({name,count:Number(countReq.result||0)});cursor.continue();};countReq.onerror=()=>reject(countReq.error);};request.onerror=()=>reject(request.error);
  }); } finally { db.close(); }
}

async function organizationSummary() {
  const [groups, projects, smartCollections, totalChats, pinnedChats, favoriteChats, tags] = await Promise.all([
    getAll('groups'), getAll('projects'), getAll('smartCollections'), countStore('chats'), getByIndex('chats','pinned',1,24), getByIndex('chats','favorite',1,24), organizationTagCounts(100)
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
    const knowledgeRows = await getAllByIndex('knowledgeItems','workspaceProjectId',id);
    if (knowledgeRows.length) {
      const updatedKnowledge = knowledgeRows.map((item)=>({...item,workspaceProjectName:merged.name||''}));
      await putManyChunked('knowledgeItems',updatedKnowledge,220); await putSearchDocs(updatedKnowledge.map((record)=>searchDoc('knowledge',record)));
    }
    await rebuildWorkspaceContinuity(id);
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
    const clearedChats=await putManyChunked('chats', chats.map((chat)=>({id:chat.id,workspaceProjectId:'',workspaceProjectName:'',workspaceGroupId:'',updatedAt:now}))); await putSearchDocs(clearedChats.map((record)=>searchDoc('chat',record)));
    const files = await getAllByIndex('files','workspaceProjectId',id); const clearedFiles=await putManyChunked('files',files.map((file)=>({id:file.id,workspaceProjectId:'',updatedAt:now}))); if(clearedFiles.length)await putSearchDocs(clearedFiles.map((record)=>searchDoc('file',record)));
    const knowledgeRows=await getAllByIndex('knowledgeItems','workspaceProjectId',id); if(knowledgeRows.length){const clearedKnowledge=knowledgeRows.map((item)=>({...item,workspaceProjectId:'',workspaceProjectName:''}));await putManyChunked('knowledgeItems',clearedKnowledge,220);await putSearchDocs(clearedKnowledge.map((record)=>searchDoc('knowledge',record)));}
    await deleteOneRecord('projectContinuity',id);
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
  const now = Date.now(); let project = null; const oldWorkspaceProjects = new Set();
  if (Object.prototype.hasOwnProperty.call(patch,'workspaceProjectId') && patch.workspaceProjectId) {
    project = await getOne('projects',patch.workspaceProjectId);
    if (!project || project.sourceType !== 'workspace' || project.deletedAt) throw new Error('Target Constellation project not found.');
  }
  const updates=[];
  for (const id of ids) {
    const old=await getOne('chats',id); if(!old)continue; if(old.workspaceProjectId)oldWorkspaceProjects.add(old.workspaceProjectId);
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
    const fileUpdates=[]; const knowledgeUpdates=[];
    for(const chat of merged){
      const relatedFiles=await getAllByIndex('files','chatId',chat.id);for(const file of relatedFiles)fileUpdates.push({id:file.id,workspaceProjectId:chat.workspaceProjectId||'',updatedAt:now});
      const relatedKnowledge=await getAllByIndex('knowledgeItems','chatId',chat.id);for(const item of relatedKnowledge)knowledgeUpdates.push({...item,workspaceProjectId:chat.workspaceProjectId||'',workspaceProjectName:chat.workspaceProjectName||''});
    }
    if(fileUpdates.length){const mergedFiles=await putManyChunked('files',fileUpdates);await putSearchDocs(mergedFiles.map((record)=>searchDoc('file',record)));}
    if(knowledgeUpdates.length){await putManyChunked('knowledgeItems',knowledgeUpdates,220);await putSearchDocs(knowledgeUpdates.map((record)=>searchDoc('knowledge',record)));}
    const affected=new Set([...oldWorkspaceProjects,project?.id||'']);for(const projectId of affected)if(projectId)await rebuildWorkspaceContinuity(projectId);
    scheduleIntegrityScan(1600).catch(()=>{});
  }
  await addEvent('organization-chat-update','chat',ids[0],ids[0],{count:merged.length,projectId:project?.id||'',fields:Object.keys(patch)}); markDriveDirty().catch(()=>{}); return merged;
}

async function organizationChats(filters = {}) {
  const limit=Math.max(1,Math.min(Number(filters.limit)||120,500)); let rows;
  if(filters.workspaceProjectId) rows=await getByIndex('chats','workspaceProjectId',filters.workspaceProjectId,Math.max(limit,500));
  else if(filters.tag) rows=await getByIndex('chats','tags',String(filters.tag).toLocaleLowerCase(),Math.max(limit,500));
  else if(filters.mode==='pinned') rows=await getByIndex('chats','pinned',1,Math.max(limit,500));
  else if(filters.mode==='favorites') rows=await getByIndex('chats','favorite',1,Math.max(limit,500));
  else if(filters.mode==='archived') rows=await getByIndex('chats','organizedArchived',1,Math.max(limit,500));
  else rows=await getRecent('chats',Math.max(limit,300));
  if(filters.groupId) rows=rows.filter((c)=>c.workspaceGroupId===filters.groupId);
  if(filters.mode==='unassigned') rows=rows.filter((c)=>!c.workspaceProjectId);
  if(filters.mode==='attention') rows=rows.filter((c)=>['blocked-approval','refresh-required','errored','stalled','auth-required','unavailable'].includes(c.status));
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


async function deleteByIndex(storeName, indexName, value) {
  if (!isValidIndexedDbKey(value)) return;
  const db = await openDb();
  try {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName); const index = store.index(indexName);
    const rows = await requestResult(index.getAll(indexedDbOnly(value, `${storeName}.${indexName}`)));
    await new Promise((resolve, reject) => {
      for (const row of rows) if (row?.id) store.delete(row.id);
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}

async function projectIntegrityInput(projectId, { maxChats = 240, maxTurnsPerChat = 80 } = {}) {
  const db = await openDb();
  try {
    const tx = db.transaction(['chats','files','turns'], 'readonly');
    const chatStore = tx.objectStore('chats'), fileStore = tx.objectStore('files'), turnStore = tx.objectStore('turns');
    const chats = await requestResult(chatStore.index('workspaceProjectId').getAll(indexedDbOnly(projectId, 'chats.workspaceProjectId')));
    const files = await requestResult(fileStore.index('workspaceProjectId').getAll(indexedDbOnly(projectId, 'files.workspaceProjectId')));
    chats.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0)); files.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
    const selected = chats.slice(0, Math.max(1, maxChats));
    const turnIndex = turnStore.index('chatId');
    const chunks = await Promise.all(selected.map((chat) => requestResult(turnIndex.getAll(indexedDbOnly(chat.id, 'turns.chatId'), Math.max(1, maxTurnsPerChat))).catch(() => [])));
    return { chats, files, turns: chunks.flat() };
  } finally { db.close(); }
}

function integrityFingerprint(project, input) {
  const max = (rows) => rows.reduce((value,row)=>Math.max(value,Number(row.updatedAt||0)),0);
  return [brain.normalizeText(`${project.name||''}|${project.description||''}|${project.notes||''}`,2400),input.chats.length,max(input.chats),input.files.length,max(input.files),input.turns.length,max(input.turns)].join(':');
}

async function integritySummary(limit = 80) {
  const findings = (await getRecent('integrityFindings', Math.max(1, Math.min(Number(limit)||80,250)))).filter((row)=>!row.resolved);
  const counts = { critical: 0, warning: 0, info: 0 };
  for (const row of findings) if (Object.prototype.hasOwnProperty.call(counts,row.severity)) counts[row.severity] += 1;
  const baselines = await getRecent('projectBaselines', 120);
  return { counts, total: findings.length, findings, baselines, severity: counts.critical ? 'critical' : counts.warning ? 'warning' : counts.info ? 'info' : 'healthy' };
}

async function runProjectIntegrityScan({ projectIds = [], force = false } = {}) {
  const cfg = await settings();
  if (!cfg.projectIntegrity.enabled) return { ok: true, skipped: true, summary: await integritySummary() };
  let projects = (await getAll('projects')).filter((project)=>project.sourceType === 'workspace' && !project.deletedAt && !project.archived);
  if (projectIds.length) { const wanted = new Set(projectIds); projects = projects.filter((project)=>wanted.has(project.id)); }
  const now = Date.now(); let scanned = 0, skipped = 0, findingCount = 0;
  for (const project of projects) {
    const input = await projectIntegrityInput(project.id);
    const fingerprint = integrityFingerprint(project,input);
    const previousBaseline = await getOne('projectBaselines', project.id);
    if (!force && previousBaseline?.inputFingerprint === fingerprint) { skipped += 1; continue; }
    const before = await getAllByIndex('integrityFindings','projectId',project.id);
    const beforeIds = new Set(before.filter((row)=>!row.resolved).map((row)=>row.id));
    const analysis = integrity.analyzeProject({ project, ...input, previousBaseline, now });
    await deleteByIndex('integrityFindings','projectId',project.id);
    const chatMap = new Map(input.chats.map((chat) => [chat.id, chat]));
    const findings = analysis.findings.map((row,index)=>({
      ...row, id: `integrity:${brain.safeId(project.id)}:${brain.safeId(row.type)}:${brain.safeId(row.chatId || (row.fileIds||[]).join('-') || index)}`,
      projectId: project.id, projectName: project.name || 'Untitled project', chatTitle: row.chatId ? (chatMap.get(row.chatId)?.title || '') : '', chatUrl: row.chatId ? (chatMap.get(row.chatId)?.url || '') : '',
      resolved: false, createdAt: now, updatedAt: now
    }));
    if (findings.length) await putManyChunked('integrityFindings', findings);
    const counts = { critical: findings.filter((row)=>row.severity==='critical').length, warning: findings.filter((row)=>row.severity==='warning').length, info: findings.filter((row)=>row.severity==='info').length };
    const health = counts.critical ? 'critical' : counts.warning ? 'warning' : counts.info ? 'attention' : 'healthy';
    await upsert('projectBaselines', { ...analysis.baseline, id: project.id, projectId: project.id, projectName: project.name || 'Untitled project', inputFingerprint: fingerprint, health, counts, updatedAt: now });
    await upsert('projects', { id: project.id, integrityHealth: health, integrityCounts: counts, integrityLatestVersion: analysis.baseline.latestVersion || '', integrityUpdatedAt: now, updatedAt: Math.max(Number(project.updatedAt||0),now) });
    for (const row of findings) if (!beforeIds.has(row.id) && ['critical','warning'].includes(row.severity)) await addEvent('project-integrity-finding','project',project.id,row.chatId||'',{type:row.type,severity:row.severity,title:row.title});
    scanned += 1; findingCount += findings.length;
  }
  const summary = await integritySummary();
  await patchSettings({ projectIntegrity: { lastScanAt: now, latestSeverity: summary.severity } });
  return { ok: true, scanned, skipped, findings: findingCount, summary };
}

async function scheduleIntegrityScan(delay = 5000) {
  const cfg = await settings(); if (!cfg.projectIntegrity.enabled || !cfg.projectIntegrity.autoScan) return false;
  await chrome.alarms.create(INTEGRITY_DEBOUNCE_ALARM, { when: Date.now() + Math.max(1000, Number(delay)||5000) });
  return true;
}

async function homeSummary() {
  const [providerCount, projectCount, chatCount, turnCount, fileCount, knowledgeCount, recentChats, recentFiles, recentProjects, recentEvents, topicChats, historyGranted, cfg, catalog, fullCapture, organization, approvalRecovery, governor, integrityState, knowledgeState] = await Promise.all([
    countStore('providers'), countStore('projects'), countStore('chats'), countStore('turns'), countStore('files'), countStore('knowledgeItems'),
    getRecent('chats', 18), getRecent('files', 18), getRecent('projects', 18), getRecent('events', 24), getRecent('chats', 500), hasHistoryPermission(), settings(), catalogState(), fullCaptureState(), organizationSummary(), approvalRecoveryState(), requestGovernorState(), integritySummary(), knowledgeSummary(18)
  ]);
  const attentionStatuses = ['blocked-approval','refresh-required','rate-limited','errored','stalled','auth-required','unavailable'];
  const liveStatuses = ['running','paused','waiting-user'];
  const attentionGroups = await Promise.all(attentionStatuses.map((status) => getByIndex('chats','status',status,10)));
  const liveGroups = await Promise.all(liveStatuses.map((status) => getByIndex('chats','status',status,10)));
  const statusCounts = {};
  const db = await openDb();
  try {
    const tx = db.transaction('chats','readonly'); const index = tx.objectStore('chats').index('status');
    await Promise.all(brain.CHAT_STATUSES.map(async (status) => { statusCounts[status] = await requestResult(index.count(indexedDbOnly(status, 'chats.status'))); }));
  } finally { db.close(); }
  return {
    counts: { providers: providerCount, projects: projectCount, chats: chatCount, turns: turnCount, files: fileCount, knowledge: knowledgeCount }, statusCounts,
    recentChats, recentFiles, recentProjects, recentEvents,
    attention: [...new Map([...attentionGroups.flat(), ...topicChats.filter((chat)=>chat.outputRegression?.active)].map((chat)=>[chat.id,chat])).values()].sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0)).slice(0,30),
    live: liveGroups.flat().sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0)).slice(0,30),
    topics: buildTopicHints(topicChats, recentProjects),
    catalog: publicCatalogState(catalog), fullCapture: publicFullCaptureState(fullCapture), discovery: { browserHistoryGranted: historyGranted, mode: 'zero-tab-default', hiddenTabs: false, manualFullCapture: true },
    organization, integrity: integrityState, knowledge: knowledgeState, requestGovernor: publicRequestGovernor(governor),
    projectIntegrity: { ...cfg.projectIntegrity }, liveHealth: { ...cfg.liveHealth }, approvalAutopilot: { ...cfg.approvalAutopilot }, approvalRecovery: publicApprovalRecoveryState(approvalRecovery), refreshRecovery: { ...cfg.refreshRecovery, runtime: publicRefreshRecoveryState(await refreshRecoveryState()) },
    sync: { drive: { ...cfg.drive, oauthProvisioned: googleOAuthProvisioned() }, github: { ...cfg.github, configured: Boolean(cfg.github.owner && cfg.github.repo) } }
  };
}

async function brainCounts() {
  const [providers, projects, chats, turns, files, knowledge] = await Promise.all([
    countStore('providers'), countStore('projects'), countStore('chats'),
    countStore('turns'), countStore('files'), countStore('knowledgeItems')
  ]);
  return { providers, projects, chats, turns, files, knowledge };
}

async function listBrainEntities(entityType, limit = 80, offset = 0) {
  const map = { project: 'projects', chat: 'chats', file: 'files', knowledge: 'knowledgeItems', continuity: 'projectContinuity', event: 'events', checkpoint: 'checkpoints' };
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
      matches: group.hits.slice(0,8).map((hit) => ({ entityType: hit.entityType, title: hit.title, excerpt: hit.excerpt, updatedAt: hit.updatedAt, kind: hit.kind || '', url: hit.url || '' })),
      files: files.slice(0,12)
    });
  }
  return { groups: enriched, standalone: standalone.slice(0,20), totalHits: hits.length };
}

async function snapshot() {
  const [providerRecords, groups, projects, smartCollections, chats, turns, turnRevisions, outputSnapshots, files, knowledgeItems, knowledgeSources, projectContinuity, events, checkpoints, syncReceipts, catalogRuns, baselines, integrityFindings, governor, cfg, dirty] = await Promise.all([
    getAll('providers'), getAll('groups'), getAll('projects'), getAll('smartCollections'), getAll('chats'), getAll('turns'), getAll('turnRevisions'), getAll('outputSnapshots'), getAll('files'), getAll('knowledgeItems'), getAll('knowledgeSources'), getAll('projectContinuity'), getAll('events'), getAll('checkpoints'), getAll('syncReceipts'), getAll('catalogRuns'), getAll('projectBaselines'), getAll('integrityFindings'), requestGovernorState(), settings(), chrome.storage.local.get(DIRTY_KEY)
  ]);
  const manifest = chrome.runtime.getManifest();
  const out = brain.makeSnapshot({
    providers: providerRecords, projects, chats, turns, turnRevisions, outputSnapshots, files, knowledgeItems, knowledgeSources, projectContinuity, events, checkpoints, syncReceipts, catalogRuns,
    meta: {
      extension: { name: manifest.name, version: manifest.version },
      github: { ...cfg.github, configured: Boolean(cfg.github.owner && cfg.github.repo) },
      drive: { ...cfg.drive, oauthProvisioned: googleOAuthProvisioned(), dirtyAt: dirty[DIRTY_KEY] || 0 },
      requestGovernor: publicRequestGovernor(governor), projectIntegrity: { ...cfg.projectIntegrity }, refreshRecovery: { ...cfg.refreshRecovery },
      performanceEngine: 'Project Constellation Performance Engine'
    }
  });
  out.groups = groups; out.smartCollections = smartCollections; out.projectBaselines = baselines; out.integrityFindings = integrityFindings;
  out.summary.groups = groups.filter((g)=>!g.deletedAt).length; out.summary.integrityFindings = integrityFindings.filter((row)=>!row.resolved).length;
  out.summary.smartCollections = smartCollections.filter((c)=>!c.deletedAt).length;
  return out;
}

function base64Utf8(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function githubClientId(cfg = null) {
  const dynamic = String(cfg?.github?.clientId || '').trim();
  if (dynamic) return dynamic;
  return BUILT_GITHUB_CLIENT_ID && !BUILT_GITHUB_CLIENT_ID.includes('PROJECT_CONSTELLATION_GITHUB_CLIENT_ID') ? BUILT_GITHUB_CLIENT_ID : '';
}

function transientStorage() { return chrome.storage.session || chrome.storage.local; }

async function githubTokenValue() {
  const stored = await chrome.storage.local.get([GITHUB_SECRET_KEY, GITHUB_REFRESH_KEY, GITHUB_TOKEN_META_KEY]);
  const token = String(stored[GITHUB_SECRET_KEY] || '');
  const meta = stored[GITHUB_TOKEN_META_KEY] || {};
  if (!token) return '';
  if (Number(meta.accessExpiresAt || 0) > 0 && Number(meta.accessExpiresAt) <= Date.now() + 60000 && stored[GITHUB_REFRESH_KEY]) {
    return githubRefreshAccessToken(String(stored[GITHUB_REFRESH_KEY] || ''));
  }
  return token;
}

let githubRefreshPromise = null;
async function githubRefreshAccessToken(refreshOverride = '') {
  if (githubRefreshPromise) return githubRefreshPromise;
  githubRefreshPromise = (async () => {
    const cfg = await settings();
    const clientId = githubClientId(cfg);
    const stored = await chrome.storage.local.get([GITHUB_REFRESH_KEY, GITHUB_TOKEN_META_KEY]);
    const refreshToken = String(refreshOverride || stored[GITHUB_REFRESH_KEY] || '');
    const meta = stored[GITHUB_TOKEN_META_KEY] || {};
    if (!clientId || !refreshToken) throw new Error('GitHub authorization expired. Sign in again to continue.');
    if (Number(meta.refreshExpiresAt || 0) > 0 && Number(meta.refreshExpiresAt) <= Date.now()) {
      await chrome.storage.local.remove([GITHUB_SECRET_KEY, GITHUB_REFRESH_KEY, GITHUB_TOKEN_META_KEY]);
      throw new Error('GitHub refresh authorization expired. Sign in again to continue.');
    }
    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, grant_type: 'refresh_token', refresh_token: refreshToken }).toString()
    });
    if (!response.ok) throw new Error(`GitHub token refresh failed: ${response.status}`);
    const data = await response.json();
    if (data.error || !data.access_token) {
      if (['bad_refresh_token','incorrect_client_credentials'].includes(String(data.error || ''))) {
        await chrome.storage.local.remove([GITHUB_SECRET_KEY, GITHUB_REFRESH_KEY, GITHUB_TOKEN_META_KEY]);
      }
      throw new Error(data.error_description || data.error || 'GitHub did not return a refreshed access token.');
    }
    const now = Date.now();
    const nextMeta = {
      accessExpiresAt: data.expires_in ? now + Number(data.expires_in) * 1000 : 0,
      refreshExpiresAt: data.refresh_token_expires_in ? now + Number(data.refresh_token_expires_in) * 1000 : Number(meta.refreshExpiresAt || 0),
      tokenType: data.token_type || meta.tokenType || 'bearer', refreshedAt: now
    };
    await chrome.storage.local.set({
      [GITHUB_SECRET_KEY]: data.access_token,
      [GITHUB_REFRESH_KEY]: data.refresh_token || refreshToken,
      [GITHUB_TOKEN_META_KEY]: nextMeta
    });
    if (data.scope) await patchSettings({ github: { oauthScopes: data.scope } });
    return String(data.access_token);
  })().finally(() => { githubRefreshPromise = null; });
  return githubRefreshPromise;
}

async function githubApi(path, options = {}, retry = true) {
  let token = await githubTokenValue();
  if (!token) throw new Error('GitHub is not connected. Sign in with GitHub first.');
  let response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', Authorization: `Bearer ${token}`, ...(options.headers || {}) }
  });
  if (response.status === 401 && retry) {
    token = await githubRefreshAccessToken();
    response = await fetch(`https://api.github.com${path}`, {
      ...options,
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', Authorization: `Bearer ${token}`, ...(options.headers || {}) }
    });
  }
  if (response.status === 401) throw new Error('GitHub authorization expired or was revoked. Sign in again.');
  return response;
}

async function githubConnectionStatus({ verify = false } = {}) {
  const cfg = await settings();
  const clientId = githubClientId(cfg);
  const token = await githubTokenValue();
  let user = cfg.github.oauthUser ? { login: cfg.github.oauthUser, avatar_url: cfg.github.oauthAvatar || '' } : null;
  let error = '';
  if (verify && token) {
    try {
      const response = await githubApi('/user');
      if (!response.ok) throw new Error(`GitHub user lookup failed: ${response.status}`);
      user = await response.json();
      await patchSettings({ github: { oauthUser: user.login || '', oauthAvatar: user.avatar_url || '', authType: cfg.github.authType || 'oauth-device' } });
    } catch (e) { error = String(e?.message || e); }
  }
  const pending = (await transientStorage().get(GITHUB_OAUTH_PENDING_KEY))[GITHUB_OAUTH_PENDING_KEY] || null;
  return {
    configured: Boolean(cfg.github.owner && cfg.github.repo), clientConfigured: Boolean(clientId), clientId,
    connected: Boolean(token && !error), authType: cfg.github.authType || (token ? 'token' : ''),
    user: user ? { login: user.login || '', avatarUrl: user.avatar_url || cfg.github.oauthAvatar || '' } : null,
    owner: cfg.github.owner || '', repo: cfg.github.repo || '', branch: cfg.github.branch || 'main', path: cfg.github.path || '.project-constellation/constellation.json',
    scopes: cfg.github.oauthScopes || '', lastSyncAt: cfg.github.lastSyncAt || 0, pending: pending ? { userCode: pending.userCode, verificationUri: pending.verificationUri, expiresAt: pending.expiresAt, nextPollAt: pending.nextPollAt } : null,
    error
  };
}

async function githubOAuthStart(clientIdOverride = '') {
  const cfg = await settings();
  if (clientIdOverride && clientIdOverride.trim() !== cfg.github.clientId) await patchSettings({ github: { clientId: clientIdOverride.trim() } });
  const latest = await settings();
  const clientId = githubClientId(latest);
  if (!clientId) throw new Error('GitHub OAuth client ID is not configured. Add the Project Constellation GitHub OAuth App client ID in Connections.');
  const response = await fetch('https://github.com/login/device/code', {
    method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, scope: 'repo read:user offline_access' }).toString()
  });
  if (!response.ok) throw new Error(`GitHub device authorization failed: ${response.status} ${(await response.text()).slice(0,240)}`);
  const data = await response.json();
  if (!data.device_code || !data.user_code || !data.verification_uri) throw new Error(data.error_description || data.error || 'GitHub did not return a device authorization code.');
  const now = Date.now();
  const pending = {
    clientId, deviceCode: data.device_code, userCode: data.user_code, verificationUri: data.verification_uri,
    expiresAt: now + Number(data.expires_in || 900) * 1000, intervalMs: Math.max(5000, Number(data.interval || 5) * 1000), nextPollAt: now
  };
  await transientStorage().set({ [GITHUB_OAUTH_PENDING_KEY]: pending });
  return { ok: true, userCode: pending.userCode, verificationUri: pending.verificationUri, expiresAt: pending.expiresAt, intervalMs: pending.intervalMs };
}

async function githubOAuthPoll() {
  const area = transientStorage();
  const pending = (await area.get(GITHUB_OAUTH_PENDING_KEY))[GITHUB_OAUTH_PENDING_KEY];
  if (!pending) return { ok: false, state: 'not-started', error: 'No GitHub sign-in is pending.' };
  const now = Date.now();
  if (now >= pending.expiresAt) { await area.remove(GITHUB_OAUTH_PENDING_KEY); return { ok: false, state: 'expired', error: 'GitHub sign-in code expired. Start again.' }; }
  if (now < Number(pending.nextPollAt || 0)) return { ok: true, state: 'pending', retryAfterMs: pending.nextPollAt - now, userCode: pending.userCode, verificationUri: pending.verificationUri };
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: pending.clientId, device_code: pending.deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }).toString()
  });
  if (!response.ok) throw new Error(`GitHub token exchange failed: ${response.status}`);
  const data = await response.json();
  if (data.error) {
    if (data.error === 'authorization_pending' || data.error === 'slow_down') {
      pending.intervalMs += data.error === 'slow_down' ? 5000 : 0;
      pending.nextPollAt = Date.now() + pending.intervalMs;
      await area.set({ [GITHUB_OAUTH_PENDING_KEY]: pending });
      return { ok: true, state: 'pending', retryAfterMs: pending.intervalMs, userCode: pending.userCode, verificationUri: pending.verificationUri };
    }
    await area.remove(GITHUB_OAUTH_PENDING_KEY);
    throw new Error(data.error_description || data.error);
  }
  if (!data.access_token) throw new Error('GitHub did not return an access token.');
  const tokenNow = Date.now();
  const tokenUpdate = {
    [GITHUB_SECRET_KEY]: data.access_token,
    [GITHUB_TOKEN_META_KEY]: {
      accessExpiresAt: data.expires_in ? tokenNow + Number(data.expires_in) * 1000 : 0,
      refreshExpiresAt: data.refresh_token_expires_in ? tokenNow + Number(data.refresh_token_expires_in) * 1000 : 0,
      tokenType: data.token_type || 'bearer', connectedAt: tokenNow
    }
  };
  if (data.refresh_token) tokenUpdate[GITHUB_REFRESH_KEY] = data.refresh_token;
  else await chrome.storage.local.remove(GITHUB_REFRESH_KEY);
  await chrome.storage.local.set(tokenUpdate);
  await area.remove(GITHUB_OAUTH_PENDING_KEY);
  const userResponse = await githubApi('/user');
  if (!userResponse.ok) throw new Error(`GitHub identity verification failed: ${userResponse.status}`);
  const user = await userResponse.json();
  await patchSettings({ github: { authType: 'oauth-device', oauthUser: user.login || '', oauthAvatar: user.avatar_url || '', oauthScopes: data.scope || '', connectedAt: Date.now() } });
  return { ok: true, state: 'connected', user: { login: user.login || '', avatarUrl: user.avatar_url || '' }, scopes: data.scope || '' };
}

async function githubOAuthDisconnect() {
  await chrome.storage.local.remove([GITHUB_SECRET_KEY, GITHUB_REFRESH_KEY, GITHUB_TOKEN_META_KEY]);
  await transientStorage().remove(GITHUB_OAUTH_PENDING_KEY).catch(() => {});
  await patchSettings({ github: { authType: '', oauthUser: '', oauthAvatar: '', oauthScopes: '', connectedAt: 0 } });
  return { ok: true, connection: await githubConnectionStatus() };
}

async function githubRepositories() {
  const response = await githubApi('/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member');
  if (!response.ok) throw new Error(`GitHub repository lookup failed: ${response.status}`);
  const repos = await response.json();
  return { ok: true, repositories: repos.map((repo) => ({ id: repo.id, fullName: repo.full_name, owner: repo.owner?.login || '', name: repo.name, private: Boolean(repo.private), defaultBranch: repo.default_branch || 'main', url: repo.html_url || '', permissions: repo.permissions || {} })) };
}

async function githubSync() {
  const cfg = await settings();
  const gh = cfg.github;
  if (!await githubTokenValue() || !gh.owner || !gh.repo || !gh.path) throw new Error('GitHub authorization, owner, repository, and path are required.');
  const ref = encodeURIComponent(gh.branch || 'main');
  const api = `/repos/${encodeURIComponent(gh.owner)}/${encodeURIComponent(gh.repo)}/contents/${gh.path.split('/').map(encodeURIComponent).join('/')}?ref=${ref}`;
  let sha;
  const existing = await githubApi(api);
  if (existing.ok) sha = (await existing.json()).sha;
  else if (existing.status !== 404) throw new Error(`GitHub read failed: ${existing.status}`);
  const body = await snapshot();
  const content = JSON.stringify(body, null, 2) + '\n';
  const write = await githubApi(api.replace(/\?ref=.*$/, ''), {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
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
  if (!googleOAuthProvisioned()) throw new Error('Google OAuth client is not provisioned in this build. Set PROJECT_CONSTELLATION_GOOGLE_CLIENT_ID when building the extension.');
  const result = await chrome.identity.getAuthToken({ interactive, scopes: [DRIVE_SCOPE], enableGranularPermissions: true });
  if (!result?.token) throw new Error('Google OAuth did not return an access token.');
  if (Array.isArray(result.grantedScopes) && !result.grantedScopes.includes(DRIVE_SCOPE)) {
    await chrome.identity.removeCachedAuthToken({ token: result.token }).catch(() => {});
    throw new Error('Google Drive permission was not granted. Reconnect and allow the Project Constellation Drive scope.');
  }
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

    const storeNames = ['providers','groups','projects','smartCollections','chats','turns','turnRevisions','outputSnapshots','files','knowledgeItems','knowledgeSources','projectContinuity','events','checkpoints','syncReceipts','catalogRuns','projectBaselines','integrityFindings'];
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
  const names = ['providers','groups','projects','smartCollections','chats','turns','turnRevisions','outputSnapshots','files','knowledgeItems','knowledgeSources','projectContinuity','events','checkpoints','syncReceipts','catalogRuns','projectBaselines','integrityFindings'];
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
  return ['providers','groups','projects','smartCollections','chats','turns','turnRevisions','outputSnapshots','files','knowledgeItems','knowledgeSources','projectContinuity','events','checkpoints','syncReceipts','catalogRuns','projectBaselines','integrityFindings'].reduce((sum, key) => sum + (Array.isArray(delta[key]) ? delta[key].length : 0), 0);
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
    const emptyJournal = { schema: 'project-constellation-delta', schemaVersion: 1, baseFullSyncAt: now, exportedAt: new Date(now).toISOString(), providers: [], groups: [], projects: [], smartCollections: [], chats: [], turns: [], turnRevisions: [], outputSnapshots: [], files: [], knowledgeItems: [], knowledgeSources: [], projectContinuity: [], events: [], checkpoints: [], syncReceipts: [], catalogRuns: [], projectBaselines: [], integrityFindings: [] };
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

async function driveConnectionStatus({ verify = false } = {}) {
  const cfg = await settings();
  let user = null; let connected = ['connected','verified','synced'].includes(cfg.drive.lastStatus); let error = cfg.drive.lastError || '';
  if (verify && googleOAuthProvisioned()) {
    connected = false;
    try {
      const response = await googleFetch('https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress,photoLink)', {}, false);
      if (response.ok) { const payload = await response.json(); user = payload.user || null; connected = true; error = ''; }
      else error = `Google Drive verification failed: ${response.status} ${(await response.text()).slice(0,180)}`.trim();
    } catch (e) { error = String(e?.message || e); }
  }
  return { oauthProvisioned: googleOAuthProvisioned(), clientId: googleOAuthClientId(), connected, user, folderId: cfg.drive.folderId, snapshotFileId: cfg.drive.snapshotFileId, journalFileId: cfg.drive.journalFileId, indexFileId: cfg.drive.indexFileId, lastSyncAt: cfg.drive.lastSyncAt, lastFullSyncAt: cfg.drive.lastFullSyncAt, lastRestoreAt: cfg.drive.lastRestoreAt, lastStatus: cfg.drive.lastStatus, lastError: error };
}

function providerMatchPatterns(provider) {
  return provider.hosts.flatMap((host) => [`https://${host}/*`]);
}

async function providerSessionStatus(providerId, { network = false } = {}) {
  const provider = providers.byId[providerId];
  if (!provider) throw new Error('Unknown AI provider.');
  const tabs = await chrome.tabs.query({ url: providerMatchPatterns(provider) }).catch(() => []);
  for (const tab of tabs) {
    if (!tab.id) continue;
    try {
      const status = await chrome.tabs.sendMessage(tab.id, { type: 'PC_AUTH_STATUS' });
      if (status?.ok && status.state && status.state !== 'unknown') return { ...status, providerId, name: provider.name, tabId: tab.id, source: 'open-tab', loginUrl: provider.login || provider.home, historyAccess: provider.connection?.historyAccess || 'browser-session' };
    } catch (_) {}
  }
  const record = await getOne('providers', providerId);
  if (network) {
    try {
      const result = await fetchProviderHtml(provider, provider.home, { timeoutMs: 12000 });
      if (result?.parsed?.authRequired) return { ok: true, state: 'login-required', providerId, name: provider.name, source: 'background-html', loginUrl: provider.login || provider.home, historyAccess: provider.connection?.historyAccess || 'browser-session', checkedAt: Date.now() };
      if ((result?.parsed?.chats || []).length) return { ok: true, state: 'connected', providerId, name: provider.name, source: 'background-html', loginUrl: provider.login || provider.home, historyAccess: provider.connection?.historyAccess || 'browser-session', checkedAt: Date.now() };
    } catch (error) {
      if (error?.name === 'ProviderBudgetWait') return { ok: true, state: record?.catalogStatus === 'auth-required' ? 'login-required' : 'unknown', providerId, name: provider.name, source: 'request-governor', coolingDown: true, retryAfterMs: Number(error.waitMs || 0), loginUrl: provider.login || provider.home, historyAccess: provider.connection?.historyAccess || 'browser-session', checkedAt: Date.now() };
    }
  }
  const state = record?.catalogStatus === 'auth-required' ? 'login-required' : 'unknown';
  return { ok: true, state, providerId, name: provider.name, source: record ? 'catalog-record' : 'none', loginUrl: provider.login || provider.home, historyAccess: provider.connection?.historyAccess || 'browser-session', checkedAt: Date.now() };
}

async function connectionsStatus({ network = false, verifyRemote = false, providerNetwork = false } = {}) {
  // Global connection refresh intentionally avoids fan-out HTTP probes across every AI provider.
  // Provider web-session probes are explicit per-provider actions so Connections stays cheap.
  const providerStatuses = await Promise.all(providers.PROVIDERS.map((provider) => providerSessionStatus(provider.id, { network: Boolean(providerNetwork) })));
  return {
    ok: true,
    extensionId: chrome.runtime.id,
    google: await driveConnectionStatus({ verify: verifyRemote }),
    github: await githubConnectionStatus({ verify: verifyRemote }),
    providers: providerStatuses
  };
}

async function openProviderLogin(providerId) {
  const provider = providers.byId[providerId];
  if (!provider) throw new Error('Unknown AI provider.');
  const tab = await chrome.tabs.create({ url: provider.login || provider.home, active: true });
  return { ok: true, providerId, tabId: tab?.id || 0, url: provider.login || provider.home };
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

const providerRequestLocks = new Map();

async function withProviderRequestLock(providerId, task) {
  const key = String(providerId || 'unknown');
  const previous = providerRequestLocks.get(key) || Promise.resolve();
  let release = () => {};
  const current = new Promise((resolve) => { release = resolve; });
  providerRequestLocks.set(key, current);
  try {
    await previous.catch(() => {});
    return await task();
  } finally {
    release();
    if (providerRequestLocks.get(key) === current) providerRequestLocks.delete(key);
  }
}

async function fetchProviderHtmlUnlocked(provider, url, { timeoutMs = 25000, etag = '', lastModified = '' } = {}) {
  const budget = await requestBudget(provider.id);
  if (!budget.ready) {
    const error = new Error(`${provider.name} request governor is cooling down for ${Math.ceil(budget.waitMs / 1000)}s.`);
    error.name = 'ProviderBudgetWait'; error.waitMs = budget.waitMs; error.status = 0; throw error;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let noted = false;
  try {
    const headers = { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' };
    if (etag) headers['If-None-Match'] = etag;
    if (lastModified) headers['If-Modified-Since'] = lastModified;
    const response = await fetch(url, { method: 'GET', credentials: 'include', redirect: 'follow', cache: 'no-store', signal: controller.signal, headers });
    const retryHeader = response.headers.get('retry-after') || '';
    const responseEtag = response.headers.get('etag') || etag || '';
    const responseLastModified = response.headers.get('last-modified') || lastModified || '';
    if (response.status === 304) {
      await noteProviderRequest(provider.id, { status: 304, notModified: true }); noted = true;
      return { responseUrl: response.url || url, notModified: true, etag: responseEtag, lastModified: responseLastModified, parsed: null };
    }
    if (!response.ok) {
      await noteProviderRequest(provider.id, { status: response.status, retryAfter: retryHeader, error: `HTTP ${response.status}` }); noted = true;
      const error = new Error(`${provider.name} background fetch failed: HTTP ${response.status}`);
      error.name = 'ProviderFetchError'; error.status = response.status; error.url = response.url || url; error.retryAfterMs = retryAfterMs(retryHeader); throw error;
    }
    const contentType = response.headers.get('content-type') || '';
    if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) throw new Error(`${provider.name} returned non-HTML content (${contentType || 'unknown'}).`);
    const finalProvider = providers.detectProvider(response.url);
    if (!finalProvider || finalProvider.id !== provider.id) throw new Error(`${provider.name} background fetch redirected outside the provider.`);
    const html = await response.text();
    await noteProviderRequest(provider.id, { status: response.status || 200 }); noted = true;
    return { responseUrl: response.url, etag: responseEtag, lastModified: responseLastModified, parsed: await parseProviderHtml(provider.id, response.url, html) };
  } catch (error) {
    if (!noted && error?.name !== 'ProviderBudgetWait') await noteProviderRequest(provider.id, { status: Number(error?.status || 0), retryAfter: error?.retryAfterMs ? String(error.retryAfterMs / 1000) : '', error: String(error?.message || error) }).catch(() => {});
    throw error;
  } finally { clearTimeout(timeout); }
}

async function fetchProviderHtml(provider, url, options = {}) {
  return withProviderRequestLock(provider.id, () => fetchProviderHtmlUnlocked(provider, url, options));
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

async function discoverFromBackgroundHome(provider, { force = false } = {}) {
  if (!provider.catalog?.backgroundHtml) return { chats: [], authRequired: false, error: '', skippedFresh: false };
  const cfg = await settings();
  const record = await getOne('providers', provider.id);
  const freshMs = Math.max(5 * 60 * 1000, Number(cfg.catalog.homeFreshMs || 6 * 60 * 60 * 1000));
  if (!force && Number(record?.homeFetchedAt || 0) && Date.now() - Number(record.homeFetchedAt) < freshMs) return { chats: [], authRequired: false, error: '', skippedFresh: true };
  try {
    const result = await fetchProviderHtml(provider, provider.home);
    await upsert('providers', { id: provider.id, name: provider.name, home: provider.home, homeFetchedAt: Date.now(), homeFetchStatus: 'ok', updatedAt: Date.now() });
    return { chats: result.parsed?.chats || [], authRequired: Boolean(result.parsed?.authRequired), error: '', skippedFresh: false };
  } catch (error) {
    if (error?.name === 'ProviderBudgetWait') return { chats: [], authRequired: false, error: '', skippedFresh: false, deferredMs: Number(error.waitMs || 0) };
    await upsert('providers', { id: provider.id, name: provider.name, home: provider.home, homeFetchStatus: Number(error?.status || 0) === 429 ? 'throttled' : 'error', homeFetchError: String(error?.message || error).slice(0,400), updatedAt: Date.now() });
    return { chats: [], authRequired: Number(error?.status || 0) === 401 || Number(error?.status || 0) === 403, error: String(error?.message || error), skippedFresh: false, status: Number(error?.status || 0), retryAfterMs: Number(error?.retryAfterMs || 0) };
  }
}

async function discoverKnownChats(provider) {
  return (await getAllByIndex('chats','providerId',provider.id)).filter((chat) => providers.isLikelyChatUrl(chat.url || '', provider.id)).map((chat) => ({
    id: chat.id, url: providers.canonicalChatUrl(chat.url, provider.id), title: chat.title || 'Untitled chat', providerId: provider.id, source: 'local-catalog',
    catalogFetchedAt: Number(chat.catalogFetchedAt || 0), catalogEtag: chat.catalogEtag || '', catalogLastModified: chat.catalogLastModified || '', coverage: chat.coverage || '', status: chat.status || 'idle', lastSeenAt: Number(chat.lastSeenAt || 0), updatedAt: Number(chat.updatedAt || 0)
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

async function discoverProviderZeroTab(provider, { forceHome = false } = {}) {
  const [historyChats, homeResult, knownChats, liveTabs] = await Promise.all([
    discoverFromBrowserHistory(provider), discoverFromBackgroundHome(provider, { force: forceHome }), discoverKnownChats(provider), pingAlreadyOpenProviderTabs(provider)
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
    sources: { browserHistory: historyChats.length, backgroundHome: homeResult.chats.length, backgroundHomeSkippedFresh: Boolean(homeResult.skippedFresh), existingCatalog: knownChats.length, liveTabs }, deferredHomeMs: Number(homeResult.deferredMs || 0)
  };
}

async function captureChatZeroTab(provider, chat) {
  const chatId = providers.chatIdFromUrl(chat.url, provider.id) || chat.id;
  const existing = chatId ? await getOne('chats', chatId) : null;
  try {
    const result = await fetchProviderHtml(provider, chat.url, { etag: existing?.catalogEtag || chat.catalogEtag || '', lastModified: existing?.catalogLastModified || chat.catalogLastModified || '' });
    const now = Date.now();
    if (result.notModified) {
      await upsert('chats', { id: chatId, providerId: provider.id, catalogFetchedAt: now, catalogEtag: result.etag || '', catalogLastModified: result.lastModified || '', catalogFetchStatus: 'not-modified', updatedAt: Number(existing?.updatedAt || now) });
      return { ok: true, notModified: true, authRequired: false, metadataOnly: !(existing?.coverage && existing.coverage !== 'metadata-only'), turns: 0, files: 0 };
    }
    const parsed = result.parsed || {};
    if (parsed.authRequired) return { ok: false, authRequired: true, metadataOnly: true, turns: 0, files: 0, statusCode: 401 };
    const title = brain.normalizeText(parsed.title || chat.title || 'Untitled chat', 300);
    const payload = [
      { type: 'CHAT_UPSERT', data: { ...chat, id: chatId, providerId: provider.id, providerName: provider.name, title, url: chat.url, projectId: chat.projectId || `${provider.id}:inbox`, projectName: chat.projectName || 'Inbox', source: 'zero-tab-background-fetch', lastSeenAt: now, catalogFetchedAt: now, catalogEtag: result.etag || '', catalogLastModified: result.lastModified || '', catalogFetchStatus: 'ok', updatedAt: now, coverage: parsed.turns?.length ? 'server-rendered-content' : (existing?.coverage || 'metadata-only') } },
      ...(parsed.turns || []).map((turn) => ({ type: 'TURN_UPSERT', data: turn })),
      ...(parsed.files || []).map((file) => ({ type: 'FILE_UPSERT', data: file }))
    ];
    await ingestBatch(payload);
    return { ok: true, authRequired: false, metadataOnly: !(parsed.turns || []).length, turns: parsed.turns?.length || 0, files: parsed.files?.length || 0, statusCode: 200 };
  } catch (error) {
    const statusCode = Number(error?.status || 0);
    const now = Date.now();
    if (error?.name === 'ProviderBudgetWait') return { ok: false, deferred: true, waitMs: Number(error.waitMs || 0), metadataOnly: true, turns: 0, files: 0 };
    if ((statusCode === 404 || statusCode === 410) && chatId) {
      await ingestBatch([{ type: 'CHAT_UPSERT', data: { ...chat, id: chatId, providerId: provider.id, providerName: provider.name, source: 'zero-tab-background-fetch', status: 'unavailable', statusDetail: `Provider returned HTTP ${statusCode}. Archived Constellation content is preserved locally and in configured remote checkpoints.`, coverage: existing?.coverage || chat.coverage || 'archived', catalogFetchedAt: now, catalogFetchStatus: `http-${statusCode}`, updatedAt: now } }]);
    } else if ((statusCode === 401 || statusCode === 403) && chatId) {
      await ingestBatch([{ type: 'CHAT_UPSERT', data: { ...chat, id: chatId, providerId: provider.id, providerName: provider.name, source: 'zero-tab-background-fetch', status: 'auth-required', statusDetail: `Provider requires authentication before background catalog refresh can continue (HTTP ${statusCode}).`, catalogFetchedAt: now, catalogFetchStatus: `http-${statusCode}`, updatedAt: now } }]);
    } else if (chatId) {
      await upsert('chats', { id: chatId, providerId: provider.id, catalogFetchStatus: statusCode ? `http-${statusCode}` : 'network-error', catalogFetchError: String(error?.message || error).slice(0,500), catalogFetchLastErrorAt: now, updatedAt: Number(existing?.updatedAt || now) });
    }
    return { ok: false, authRequired: statusCode === 401 || statusCode === 403, metadataOnly: true, turns: 0, files: 0, statusCode, retryAfterMs: Number(error?.retryAfterMs || 0), throttled: statusCode === 429 || statusCode === 503, error: String(error?.message || error) };
  }
}

function catalogReferenceTime(chat = {}) {
  return Math.max(Number(chat.catalogFetchedAt || 0), Number(chat.lastCapturedAt || 0), Number(chat.coverage === 'full-export' ? (chat.lastSeenAt || chat.updatedAt || 0) : 0));
}

async function prepareCatalogQueue(provider, chats, { autoTriggered = false } = {}) {
  const cfg = await settings(); const now = Date.now();
  const existing = new Map((await getAllByIndex('chats','providerId',provider.id)).map((chat)=>[chat.id,chat]));
  const freshMs = Math.max(15 * 60 * 1000, Number(autoTriggered ? cfg.catalog.autoFreshChatMs : cfg.catalog.freshChatMs) || 0);
  let skippedFresh = 0; const queue = [];
  for (const chat of chats) {
    const id = chat.id || providers.chatIdFromUrl(chat.url || '', provider.id); const old = existing.get(id) || {};
    const ref = catalogReferenceTime(old); const visit = Number(chat.lastVisitTime || 0); const recentlyVisitedSinceFetch = Boolean(visit && visit > ref + 30000);
    const attention = ['blocked-approval','refresh-required','errored','stalled','auth-required'].includes(old.status) || old.status === 'paused';
    const incomplete = !old.coverage || old.coverage === 'metadata-only' || old.coverage === 'partial-dom';
    const stale = !ref || now - ref >= freshMs;
    const authoritativeExport = old.coverage === 'full-export';
    if (authoritativeExport && !attention && !recentlyVisitedSinceFetch) { skippedFresh += 1; continue; }
    if (!attention && !incomplete && !recentlyVisitedSinceFetch && !stale) { skippedFresh += 1; continue; }
    queue.push({ ...old, ...chat, id, providerId: provider.id, catalogAttempts: 0 });
  }
  if (skippedFresh) await noteFreshCatalogSkip(provider.id, skippedFresh);
  return { queue, skippedFresh, freshMs };
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
    providerIds: selected, providerIndex: 0, stage: 'discover', queue: [], chatIndex: 0, discovered: 0, captured: 0, metadataOnly: 0, skippedFresh: 0, notModified: 0, throttled: 0,
    turnsCaptured: 0, filesCaptured: 0, errors: [], sourceCounts: {}, currentProviderId: '', currentUrl: '', currentAttempt: 0, startedAt: Date.now(), updatedAt: Date.now()
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
    await addEvent('catalog-complete', 'catalog', state.id, '', { discovered: state.discovered, captured: state.captured, metadataOnly: state.metadataOnly, skippedFresh: state.skippedFresh || 0, notModified: state.notModified || 0, throttled: state.throttled || 0, turnsCaptured: state.turnsCaptured, filesCaptured: state.filesCaptured, errors: state.errors.length, mode: 'zero-tab' });
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
      const prepared = await prepareCatalogQueue(provider, unique, { autoTriggered: state.autoTriggered });
      state.queue = prepared.queue;
      state.skippedFresh = Number(state.skippedFresh || 0) + Number(prepared.skippedFresh || 0);
      state.discovered += unique.length;
      state.chatIndex = 0; state.currentAttempt = 0;
      state.stage = 'capture';
      await upsert('providers', { id: provider.id, name: provider.name, home: provider.home, catalogStatus: 'cataloguing', catalogMode: 'zero-tab', sourceCounts: discovery.sources, updatedAt: Date.now() });
      await ingestBatch(unique.map((chat) => ({ type: 'CHAT_UPSERT', data: { ...chat, providerName: provider.name, projectId: chat.projectId || `${providerId}:inbox`, projectName: chat.projectName || 'Inbox', source: chat.source || 'zero-tab-discovery', lastSeenAt: Math.max(Number(chat.lastSeenAt || 0), Number(chat.lastVisitTime || 0)) || Date.now(), updatedAt: Number(chat.updatedAt || chat.lastVisitTime || Date.now()) } })));
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
      const budget = await requestBudget(providerId);
      if (!budget.ready) { state.requestWaitMs = budget.waitMs; await saveCatalogState(state); await scheduleCatalogStep(Math.max(500, budget.waitMs)); return; }
      const captured = await captureChatZeroTab(provider, chat);
      if (captured.deferred) { state.requestWaitMs = captured.waitMs || 1000; await saveCatalogState(state); await scheduleCatalogStep(Math.max(500, captured.waitMs || 1000)); return; }
      if (captured.throttled && Number(state.currentAttempt || 0) < Number((await settings()).catalog.maxRetries || 3)) {
        state.throttled = Number(state.throttled || 0) + 1; state.currentAttempt = Number(state.currentAttempt || 0) + 1;
        const after = await requestBudget(providerId); state.requestWaitMs = Math.max(Number(captured.retryAfterMs || 0), Number(after.waitMs || 0), 5000);
        state.errors.push({ providerId, url: chat.url, type: 'throttled', message: captured.error || `HTTP ${captured.statusCode}`, retryInMs: state.requestWaitMs, at: Date.now() });
        if (state.errors.length > 300) state.errors = state.errors.slice(-300);
        await saveCatalogState(state); await scheduleCatalogStep(state.requestWaitMs); return;
      }
      if (captured.ok) {
        state.captured += 1; state.turnsCaptured += captured.turns || 0; state.filesCaptured += captured.files || 0;
        if (captured.metadataOnly) state.metadataOnly += 1;
        if (captured.notModified) state.notModified = Number(state.notModified || 0) + 1;
      } else {
        state.metadataOnly += 1;
        if (captured.authRequired) state.errors.push({ providerId, url: chat.url, type: 'auth-required', at: Date.now() });
        else if (captured.error) state.errors.push({ providerId, url: chat.url, type: 'background-fetch', message: captured.error, at: Date.now() });
      }
      state.chatIndex += 1; state.currentAttempt = 0; state.requestWaitMs = 0;
      if (state.errors.length > 300) state.errors = state.errors.slice(-300);
      await saveCatalogState(state);
      const after = await requestBudget(providerId);
      await scheduleCatalogStep(Math.max(350, Number(after.waitMs || 0)));
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
    url: initialUrl || 'about:blank', type: 'popup', focused: false, state: 'normal', width: 620, height: 820
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
  if (!state.runner && state.stage === 'discover-wait') state.stage = 'discover';
  if (!state.runner && state.stage === 'capture-wait') state.stage = 'capture';
  await saveFullCaptureState(state);
  await sendCaptureControl(state, 'run');
  if (!state.runner) await scheduleFullCaptureStep(100);
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

async function dispatchFullCaptureRunner(state, provider, kind, options = {}) {
  const jobId = `${state.id}:${provider.id}:${kind}:${kind === 'capture' ? state.chatIndex : state.providerIndex}:${Date.now()}`;
  state.runner = { jobId, kind, providerId: provider.id, startedAt: Date.now(), lastProgressAt: Date.now(), retries: Number(state.currentRetries || 0) };
  state.stage = kind === 'discover' ? 'discover-wait' : 'capture-wait';
  await saveFullCaptureState(state);
  const response = await chrome.tabs.sendMessage(state.tabId, {
    type: kind === 'discover' ? 'PC_MANUAL_DISCOVER_CHATS_ASYNC' : 'PC_MANUAL_FULL_CAPTURE_ASYNC',
    jobId, options: { speed: state.speed, maxSteps: 10000 }
  });
  if (!response?.ok || !response?.accepted) throw new Error(response?.error || `Capture ${kind} runner was not accepted.`);
  return state;
}

async function processFullCaptureStep() {
  if (fullCaptureProcessing) return;
  fullCaptureProcessing = true;
  try {
    let state = await fullCaptureState();
    if (!state || state.status !== 'running' || state.runner) return;
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
    if (!provider) { state.providerIndex += 1; state.stage = 'discover'; await saveFullCaptureState(state); await scheduleFullCaptureStep(100); return; }
    state.currentProviderId = providerId;

    if (state.stage === 'discover' || state.stage === 'discover-wait') {
      state.stage = 'discover'; state.currentUrl = provider.home; state.currentTitle = `${provider.name} history discovery`;
      await saveFullCaptureState(state);
      state = await navigateCaptureTab(state, provider, provider.home);
      await dispatchFullCaptureRunner(state, provider, 'discover');
      return;
    }

    if (state.stage === 'capture' || state.stage === 'capture-wait') {
      if (state.chatIndex >= state.queue.length) {
        await upsert('providers', { id: provider.id, name: provider.name, home: provider.home, catalogStatus: 'complete', catalogMode: 'manual-full-capture', updatedAt: Date.now() });
        state.providerIndex += 1; state.stage = 'discover'; state.queue = []; state.chatIndex = 0; state.currentUrl = ''; state.currentTitle = ''; state.currentRetries = 0;
        await saveFullCaptureState(state); await scheduleFullCaptureStep(150); return;
      }
      const chat = state.queue[state.chatIndex];
      state.stage = 'capture'; state.currentUrl = chat.url; state.currentTitle = chat.title || 'Untitled chat';
      await saveFullCaptureState(state);
      state = await navigateCaptureTab(state, provider, chat.url);
      await dispatchFullCaptureRunner(state, provider, 'capture');
    }
  } catch (error) {
    const state = await fullCaptureState();
    if (state?.status === 'running') {
      state.runner = null;
      state.errors.push({ providerId: state.currentProviderId, url: state.currentUrl, type: 'manual-full-capture-engine', message: String(error?.message || error), at: Date.now() });
      if (state.errors.length > 300) state.errors = state.errors.slice(-300);
      state.currentRetries = Number(state.currentRetries || 0) + 1;
      if (state.currentRetries > 2) {
        if (String(state.stage).startsWith('capture')) { state.partialChats += 1; state.chatIndex += 1; state.stage = 'capture'; }
        else { state.providerIndex += 1; state.stage = 'discover'; state.queue = []; state.chatIndex = 0; }
        state.currentRetries = 0;
      } else state.stage = String(state.stage).startsWith('capture') ? 'capture' : 'discover';
      await saveFullCaptureState(state);
      await addEvent('full-capture-error', 'catalog', state.id, '', { providerId: state.currentProviderId, url: state.currentUrl, error: String(error?.message || error), retry: state.currentRetries });
      await scheduleFullCaptureStep(800);
    }
  } finally { fullCaptureProcessing = false; }
}

async function handleFullCaptureRunnerProgress(message, sender) {
  const state = await fullCaptureState();
  if (!state?.runner || state.runner.jobId !== message.jobId || sender?.tab?.id !== state.tabId) return { ok: false, ignored: true };
  state.runner.lastProgressAt = Date.now();
  state.runner.progress = { phase: message.phase || state.runner.kind, steps: Number(message.steps || 0), discovered: Number(message.discovered || 0), turns: Number(message.turns || 0), files: Number(message.files || 0), reachedTop: Boolean(message.reachedTop), reachedBottom: Boolean(message.reachedBottom) };
  if (message.title) state.currentTitle = brain.normalizeText(message.title, 300);
  await saveFullCaptureState(state);
  return { ok: true };
}

async function handleFullCaptureRunnerDone(message, sender) {
  let state = await fullCaptureState();
  if (!state?.runner || state.runner.jobId !== message.jobId || sender?.tab?.id !== state.tabId) return { ok: false, ignored: true };
  const runner = state.runner; const result = message.result || {};
  state.runner = null; state.currentRetries = 0;
  if (result.paused || state.status === 'paused') {
    state.stage = runner.kind === 'discover' ? 'discover' : 'capture';
    await saveFullCaptureState(state); return { ok: true, paused: true };
  }
  if (result.stopped || state.status === 'stopped') { await saveFullCaptureState(state); return { ok: true, stopped: true }; }
  if (state.status !== 'running') { await saveFullCaptureState(state); return { ok: true } ; }
  const provider = providers.byId[runner.providerId];
  if (runner.kind === 'discover') {
    const known = await getAllByIndex('chats', 'providerId', runner.providerId);
    const merged = new Map();
    for (const chat of [...known, ...(result.chats || [])]) {
      const url = providers.canonicalChatUrl(chat.url || '', runner.providerId);
      if (!url || !providers.isLikelyChatUrl(url, runner.providerId)) continue;
      merged.set(url, { ...chat, id: providers.chatIdFromUrl(url, runner.providerId), url, providerId: runner.providerId, providerName: provider?.name || runner.providerId });
    }
    state.queue = [...merged.values()]; state.chatIndex = 0; state.discovered += state.queue.length; state.stage = 'capture';
    await ingestBatch(state.queue.map((chat) => ({ type: 'CHAT_UPSERT', data: { ...chat, source: chat.source || 'manual-full-discovery', projectId: chat.projectId || `${runner.providerId}:inbox`, projectName: chat.projectName || 'Inbox', lastSeenAt: chat.lastSeenAt || Date.now(), updatedAt: Date.now() } })));
    await upsert('providers', { id: runner.providerId, name: provider?.name || runner.providerId, home: provider?.home || '', catalogStatus: 'full-capture', catalogMode: 'manual-full-capture', updatedAt: Date.now() });
  } else {
    if (!result.ok) {
      state.errors.push({ providerId: runner.providerId, url: state.currentUrl, type: 'manual-full-capture', message: result.error || 'Capture runner failed.', at: Date.now() });
      state.partialChats += 1;
    } else {
      state.captured += 1; state.turnsCaptured += Number(result.totalTurnsObserved || result.turns || 0); state.filesCaptured += Number(result.totalFilesObserved || result.files || 0);
      if (result.complete) state.completeChats += 1; else state.partialChats += 1;
    }
    state.chatIndex += 1; state.stage = 'capture';
  }
  if (state.errors.length > 300) state.errors = state.errors.slice(-300);
  await saveFullCaptureState(state);
  await scheduleFullCaptureStep(state.speed === 'gentle' ? 900 : state.speed === 'fast' ? 100 : 260);
  return { ok: true };
}

async function handleFullCaptureRunnerError(message, sender) {
  let state = await fullCaptureState();
  if (!state?.runner || state.runner.jobId !== message.jobId || sender?.tab?.id !== state.tabId) return { ok: false, ignored: true };
  const runner = state.runner; state.runner = null;
  state.errors.push({ providerId: runner.providerId, url: state.currentUrl, type: `${runner.kind}-runner`, message: String(message.error || 'Capture runner error'), at: Date.now() });
  state.currentRetries = Number(state.currentRetries || 0) + 1;
  if (state.currentRetries > 2) {
    if (runner.kind === 'capture') { state.partialChats += 1; state.chatIndex += 1; state.stage = 'capture'; }
    else { state.providerIndex += 1; state.stage = 'discover'; state.queue = []; state.chatIndex = 0; }
    state.currentRetries = 0;
  } else state.stage = runner.kind === 'capture' ? 'capture' : 'discover';
  await saveFullCaptureState(state);
  if (state.status === 'running') await scheduleFullCaptureStep(800);
  return { ok: true };
}

async function showFullCaptureWindow() {
  const state = await fullCaptureState();
  if (!state?.windowId) throw new Error('No Full Capture window is active.');
  await chrome.windows.update(state.windowId, { state: 'normal', focused: true });
  return { ok: true, windowId: state.windowId };
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
  await chrome.alarms.create(STALL_ALARM, { periodInMinutes: 1 });
  await chrome.alarms.create(CATALOG_MAINTENANCE_ALARM, { periodInMinutes: 60 });
  const cfg = await settings();
  if (cfg.projectIntegrity.enabled && cfg.projectIntegrity.autoScan) await chrome.alarms.create(INTEGRITY_MAINTENANCE_ALARM, { periodInMinutes: Math.max(5, Number(cfg.projectIntegrity.scanIntervalMinutes || 15)) });
  await ensurePersistentStorage();
  await ensureSearchIndex();
  await startKnowledgeBackfillIfNeeded();
  await updateAttentionBadge();
});

chrome.runtime.onStartup.addListener(async () => {
  await chrome.alarms.create(STALL_ALARM, { periodInMinutes: 1 });
  await chrome.alarms.create(CATALOG_MAINTENANCE_ALARM, { periodInMinutes: 60 });
  const integrityCfg = await settings();
  if (integrityCfg.projectIntegrity.enabled && integrityCfg.projectIntegrity.autoScan) await chrome.alarms.create(INTEGRITY_MAINTENANCE_ALARM, { periodInMinutes: Math.max(5, Number(integrityCfg.projectIntegrity.scanIntervalMinutes || 15)) });
  await ensurePersistentStorage();
  await ensureSearchIndex();
  await startKnowledgeBackfillIfNeeded();
  await updateAttentionBadge();
  const state = await catalogState();
  if (state?.status === 'running') await scheduleCatalogStep(1000);
  const heavyState = await fullCaptureState();
  if (heavyState?.status === 'running') await scheduleFullCaptureStep(1000);
  const recoveryState = await approvalRecoveryState();
  if (recoveryState?.status === 'running') await scheduleApprovalRecoveryStep(1200);
  const dirty = (await chrome.storage.local.get(DIRTY_KEY))[DIRTY_KEY];
  const cfg = await settings();
  if (dirty && cfg.drive.autoSync && googleOAuthProvisioned()) await chrome.alarms.create(DRIVE_SYNC_ALARM, { when: Date.now() + 3000 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === CATALOG_ALARM) processCatalogStep().catch(() => {});
  else if (alarm.name === FULL_CAPTURE_ALARM) processFullCaptureStep().catch(() => {});
  else if (alarm.name === STALL_ALARM) watchForStalls().catch(() => {});
  else if (alarm.name === CATALOG_MAINTENANCE_ALARM) maybeStartAutomaticCatalog().catch(() => {});
  else if (alarm.name === APPROVAL_RECOVERY_ALARM) processApprovalRecoveryStep().catch(() => {});
  else if (alarm.name === INTEGRITY_DEBOUNCE_ALARM) runProjectIntegrityScan({ force: false }).catch(() => {});
  else if (alarm.name === INTEGRITY_MAINTENANCE_ALARM) runProjectIntegrityScan({ force: false }).catch(() => {});
  else if (alarm.name === KNOWLEDGE_INDEX_ALARM) processKnowledgeWork().catch(() => {});
  else if (alarm.name === DRIVE_SYNC_ALARM) driveSync({ interactive: false }).catch(async () => {
    const dirty = (await chrome.storage.local.get(DIRTY_KEY))[DIRTY_KEY];
    if (dirty) chrome.alarms.create(DRIVE_SYNC_ALARM, { when: Date.now() + 30 * 60 * 1000 });
  });
});


function handoffExcerpt(value, max = 2200) {
  const text = brain.normalizeText(value || '', max);
  return text.replace(/\r?\n/g, '\n').trim();
}

function handoffMarkdown({ checkpointId, generatedAt, chat, baseline, capacity, turns, knowledgeItems, files, drive }) {
  const projectName = chat?.workspaceProjectName || chat?.projectName || baseline?.projectName || 'Unassigned project';
  const projectId = chat?.workspaceProjectId || chat?.projectId || baseline?.projectId || '';
  const sourceUrl = chat?.url || '';
  const lines = [
    '# Project Constellation Safe Handoff',
    '',
    `Generated: ${generatedAt}`,
    `Checkpoint: ${checkpointId}`,
    `Source chat: ${chat?.title || 'Untitled chat'}${sourceUrl ? ` — ${sourceUrl}` : ''}`,
    `Provider: ${chat?.providerName || chat?.providerId || 'unknown'}`,
    `Project: ${projectName}${projectId ? ` (${projectId})` : ''}`,
    `Latest tracked project version: ${baseline?.latestVersion || 'not inferred'}`,
    `Conversation capacity evidence: ${Number(capacity?.turnCount || capacity?.storedTurns || 0)} captured turns${Number(capacity?.capturedChars || 0) ? ` · ${Number(capacity.capturedChars)} captured characters in the current mounted session` : ''}`,
    `Durability: ${drive?.verified ? 'Google Drive full snapshot round-trip verified' : drive?.attempted ? 'Local handoff checkpoint saved; Google Drive verification pending/failed for this click' : 'Local handoff checkpoint saved; Google Drive is not currently connected/provisioned in the extension'}`,
    '',
    '## Resume instruction',
    'Continue this exact conversation/project from the source chat and checkpoint above. Preserve existing project decisions, versions, files, recommendations, links, and follow-ups. Project Constellation retains the full captured catalog; this handoff is a compact continuation index rather than a replacement for the full archive.',
    '',
    '## Latest conversation context'
  ];
  if (turns.length) for (const row of [...turns].reverse()) lines.push(`- **${row.role || 'turn'} #${Number(row.ordinal || 0)}:** ${handoffExcerpt(row.text || '', 2400)}`);
  else lines.push('- No captured turn excerpts were available yet. Use the source chat URL and Project Constellation catalog.');
  lines.push('', '## Durable project knowledge');
  if (knowledgeItems.length) for (const item of knowledgeItems.slice(0, 36)) {
    const link = item.url || item.resourceUrl || '';
    lines.push(`- **${item.kind || 'knowledge'}:** ${handoffExcerpt(item.title || item.text || '', 900)}${link ? ` — ${link}` : ''}`);
  } else lines.push('- No extracted knowledge items are currently linked to this chat.');
  lines.push('', '## Files and resources');
  if (files.length) for (const file of files.slice(0, 24)) {
    const url = file.href || file.externalUrl || '';
    lines.push(`- ${handoffExcerpt(file.name || file.kind || 'resource', 220)}${url ? ` — ${url}` : ''}`);
  } else lines.push('- No captured file/resource links are currently linked to this chat.');
  lines.push('', '## Safety note', 'Provider conversation/context limits vary by model and can change. Capacity Guard uses proactive local thresholds and explicit provider limit signals; it does not claim to know an exact provider token/context ceiling.');
  return lines.join('\n') + '\n';
}

async function prepareChatHandoff(chatId, input = {}) {
  const id = String(chatId || '');
  if (!id) throw new Error('Safe handoff requires a real chat id.');
  const now = Date.now();
  const [chat, turns, knowledgeItems, files, storedTurns] = await Promise.all([
    getOne('chats', id),
    recentTurnRecordsForChat(id, 12),
    getByIndex('knowledgeItems', 'chatId', id, 48),
    getByIndex('files', 'chatId', id, 32),
    countByIndex('turns', 'chatId', id)
  ]);
  const resolvedChat = chat || { id, title: 'Untitled chat', url: String(input.url || ''), providerId: providers.detectProvider(input.url || '')?.id || '' };
  const projectId = resolvedChat.workspaceProjectId || resolvedChat.projectId || '';
  const baseline = projectId ? await getOne('projectBaselines', projectId) : null;
  const capacity = { ...(input.capacity || {}), storedTurns, turnCount: Math.max(storedTurns, Number(input.capacity?.turnCount || 0), Number(input.capacity?.sessionTurns || 0)) };
  const generatedAt = new Date(now).toISOString();
  const checkpointId = `handoff:${id}:${now}`;
  const initialDrive = { attempted: false, verified: false, status: 'not-attempted', url: '' };
  let markdown = handoffMarkdown({ checkpointId, generatedAt, chat: resolvedChat, baseline, capacity, turns, knowledgeItems, files, drive: initialDrive });
  const checkpoint = {
    id: checkpointId, kind: 'safe-chat-handoff', chatId: id, providerId: resolvedChat.providerId || '', sourceUrl: resolvedChat.url || String(input.url || ''),
    projectId: resolvedChat.projectId || '', workspaceProjectId: resolvedChat.workspaceProjectId || '', projectName: resolvedChat.workspaceProjectName || resolvedChat.projectName || baseline?.projectName || '',
    baselineVersion: baseline?.latestVersion || '', capacity, latestTurnIds: turns.map((row) => row.id).filter(Boolean), knowledgeItemIds: knowledgeItems.map((row) => row.id).filter(Boolean), fileIds: files.map((row) => row.id).filter(Boolean),
    markdown, drive: initialDrive, createdAt: now, updatedAt: now
  };
  await upsert('checkpoints', checkpoint);
  await upsert('chats', { id, handoffCheckpointId: checkpointId, handoffPreparedAt: now, updatedAt: now });
  await addEvent('safe-chat-handoff-prepared', 'chat', id, id, { checkpointId, capacity, turnCount: storedTurns });
  liveHealthContextCache.delete(id);
  await markDriveDirty();

  let drive = initialDrive;
  try {
    const connection = await driveConnectionStatus({ verify: false });
    if (connection.connected && googleOAuthProvisioned()) {
      drive = { attempted: true, verified: false, status: 'syncing', url: '' };
      const sync = await driveSync({ interactive: false, forceRoundtrip: true });
      drive = { attempted: true, verified: Boolean(sync?.ok && sync?.mode === 'full' && sync?.fullRoundtrip), status: sync?.ok ? (sync?.fullRoundtrip ? 'roundtrip-verified' : 'verified') : 'failed', url: sync?.url || '', fileId: sync?.fileId || '', sha256: sync?.sha256 || '', size: Number(sync?.size || 0) };
    }
  } catch (error) {
    drive = { attempted: true, verified: false, status: 'pending', url: '', error: String(error?.message || error).slice(0, 500) };
  }

  markdown = handoffMarkdown({ checkpointId, generatedAt, chat: resolvedChat, baseline, capacity, turns, knowledgeItems, files, drive });
  await upsert('checkpoints', { ...checkpoint, markdown, drive, updatedAt: Date.now() });
  await addEvent('safe-chat-handoff-ready', 'chat', id, id, { checkpointId, drive: { attempted: drive.attempted, verified: drive.verified, status: drive.status, fileId: drive.fileId || '' } });
  if (!drive.verified) await markDriveDirty();
  return { ok: true, checkpointId, markdown, drive, capacity, sourceUrl: resolvedChat.url || String(input.url || '') };
}

function branchContinuationPrompt(markdown, sourceUrl = '', checkpointId = '') {
  const raw = String(markdown || '').trim();
  const max = 42000;
  const bounded = raw.length <= max ? raw : `${raw.slice(0, 30000).trimEnd()}\n\n[Middle of handoff compacted by Project Constellation; durable checkpoint ${checkpointId} retains the complete captured index.]\n\n${raw.slice(-11000).trimStart()}`;
  return [
    'Continue this work as the direct continuation of my previous chat. Do not restart the project, discard established decisions, or merely summarize the handoff.',
    'Use the Project Constellation checkpoint below as the working context. Briefly confirm the restored objective and exact next action, then continue the unfinished work immediately. Ask only if a genuinely blocking choice is missing.',
    sourceUrl ? `Parent chat: ${sourceUrl}` : '',
    checkpointId ? `Continuation checkpoint: ${checkpointId}` : '',
    '', bounded
  ].filter((line) => line !== '').join('\n') + '\n';
}

async function branchChat(chatId, input = {}, sender = {}) {
  const handoff = await prepareChatHandoff(chatId, input);
  const sourceChat = await getOne('chats', String(chatId || ''));
  const providerId = sourceChat?.providerId || providers.detectProvider(input.url || sender?.tab?.url || '')?.id || '';
  const provider = providers.byId[providerId];
  if (!provider) throw new Error('Constellation could not identify the provider for this continuation.');
  const now = Date.now();
  const branchId = `branch:${handoff.checkpointId}`;
  const pending = {
    id:branchId, checkpointId:handoff.checkpointId, sourceChatId:String(chatId || ''), sourceUrl:handoff.sourceUrl || String(input.url || ''),
    sourceTitle:sourceChat?.title || 'Previous chat', providerId, prompt:branchContinuationPrompt(handoff.markdown, handoff.sourceUrl, handoff.checkpointId),
    createdAt:now, expiresAt:now + 15 * 60 * 1000, targetTabId:0, claimedAt:0
  };
  const area = transientStorage();
  await area.set({ [BRANCH_CONTINUATION_KEY]: pending });
  let tab;
  try {
    tab = await chrome.tabs.create({ url:provider.home, active:true, ...(Number(sender?.tab?.id) >= 0 ? { openerTabId:Number(sender.tab.id) } : {}) });
  } catch (error) {
    await area.remove(BRANCH_CONTINUATION_KEY);
    throw error;
  }
  pending.targetTabId = Number(tab?.id || 0);
  if (!Number.isInteger(pending.targetTabId) || pending.targetTabId <= 0) {
    await area.remove(BRANCH_CONTINUATION_KEY);
    throw new Error('The provider opened without a usable browser tab. Try Branch & continue again.');
  }
  await area.set({ [BRANCH_CONTINUATION_KEY]: pending });
  await upsert('checkpoints', { id:handoff.checkpointId, branchId, branchStatus:'opened', branchTargetTabId:pending.targetTabId, branchOpenedAt:Date.now(), updatedAt:Date.now() });
  await upsert('chats', { id:String(chatId || ''), branchCheckpointId:handoff.checkpointId, branchStatus:'opened', branchTargetTabId:pending.targetTabId, updatedAt:Date.now() });
  await addEvent('chat-branch-opened', 'chat', String(chatId || ''), String(chatId || ''), { branchId, checkpointId:handoff.checkpointId, providerId, targetTabId:pending.targetTabId });
  return { ok:true, branchId, checkpointId:handoff.checkpointId, targetTabId:pending.targetTabId, drive:handoff.drive, expiresAt:pending.expiresAt };
}

async function claimBranchContinuation(providerId, sender = {}) {
  const area = transientStorage();
  const pending = (await area.get(BRANCH_CONTINUATION_KEY))[BRANCH_CONTINUATION_KEY];
  if (!pending) return { ok:false, state:'none' };
  if (Date.now() >= Number(pending.expiresAt || 0)) { await area.remove(BRANCH_CONTINUATION_KEY); return { ok:false, state:'expired' }; }
  const tabId = Number(sender?.tab?.id || 0);
  if (!Number(pending.targetTabId || 0)) return { ok:false, state:'not-ready' };
  if (String(pending.providerId || '') !== String(providerId || '') || Number(pending.targetTabId) !== tabId) return { ok:false, state:'not-for-this-tab' };
  pending.claimedAt = Date.now(); pending.claimedTabId = tabId;
  await area.set({ [BRANCH_CONTINUATION_KEY]: pending });
  return { ok:true, state:'ready', branchId:pending.id, checkpointId:pending.checkpointId, sourceChatId:pending.sourceChatId, sourceTitle:pending.sourceTitle, sourceUrl:pending.sourceUrl, prompt:pending.prompt, expiresAt:pending.expiresAt };
}

async function completeBranchContinuation(message = {}, sender = {}) {
  const area = transientStorage(); const stored = await area.get([BRANCH_CONTINUATION_KEY, BRANCH_LINEAGE_KEY]);
  const pending = stored[BRANCH_CONTINUATION_KEY]; const tabId = Number(sender?.tab?.id || 0);
  if (!pending || String(pending.id || '') !== String(message.branchId || '') || (Number(pending.targetTabId || 0) && Number(pending.targetTabId) !== tabId)) return { ok:false, state:'not-pending' };
  const status = ['sent','prefilled','copied'].includes(String(message.status || '')) ? String(message.status) : 'failed';
  await upsert('checkpoints', { id:pending.checkpointId, branchStatus:status, branchTargetTabId:tabId, branchTransferredAt:Date.now(), updatedAt:Date.now() });
  await upsert('chats', { id:pending.sourceChatId, branchStatus:status, branchTargetTabId:tabId, updatedAt:Date.now() });
  await addEvent('chat-branch-transfer', 'chat', pending.sourceChatId, pending.sourceChatId, { branchId:pending.id, checkpointId:pending.checkpointId, status, targetTabId:tabId });
  if (status === 'failed') { pending.claimedAt = 0; await area.set({ [BRANCH_CONTINUATION_KEY]: pending }); return { ok:true, retryable:true }; }
  const lineage = { ...(stored[BRANCH_LINEAGE_KEY] || {}) };
  if (status === 'sent' || status === 'prefilled') lineage[String(tabId)] = { branchId:pending.id, checkpointId:pending.checkpointId, sourceChatId:pending.sourceChatId, sourceTitle:pending.sourceTitle, providerId:pending.providerId, createdAt:Date.now(), expiresAt:Date.now() + 60 * 60 * 1000 };
  await area.set({ [BRANCH_LINEAGE_KEY]: lineage });
  await area.remove(BRANCH_CONTINUATION_KEY);
  return { ok:true, status };
}

async function resolveBranchLineage(message = {}, sender = {}) {
  const childChatId = String(message.chatId || ''); const tabId = Number(sender?.tab?.id || 0);
  if (!childChatId || childChatId.endsWith(':home') || !tabId) return { ok:false, state:'not-a-chat' };
  const area = transientStorage(); const stored = await area.get(BRANCH_LINEAGE_KEY); const lineage = { ...(stored[BRANCH_LINEAGE_KEY] || {}) }; const row = lineage[String(tabId)];
  if (!row || Date.now() >= Number(row.expiresAt || 0)) { if (row) { delete lineage[String(tabId)]; await area.set({ [BRANCH_LINEAGE_KEY]: lineage }); } return { ok:false, state:'none' }; }
  if (childChatId === row.sourceChatId) return { ok:false, state:'same-chat' };
  const parent = await getOne('chats', row.sourceChatId);
  const now = Date.now();
  await upsert('chats', { id:row.sourceChatId, branchStatus:'continued', branchChildChatId:childChatId, branchResolvedAt:now, updatedAt:now });
  await upsert('chats', { id:childChatId, providerId:row.providerId || parent?.providerId || '', providerName:parent?.providerName || providers.byId[row.providerId]?.name || '', title:`Continuation of ${row.sourceTitle || parent?.title || 'previous chat'}`, url:String(message.url || sender?.tab?.url || ''), projectId:parent?.projectId || '', projectName:parent?.projectName || '', workspaceProjectId:parent?.workspaceProjectId || '', workspaceProjectName:parent?.workspaceProjectName || '', branchParentChatId:row.sourceChatId, branchCheckpointId:row.checkpointId, source:'constellation-branch', updatedAt:now });
  await upsert('checkpoints', { id:row.checkpointId, branchStatus:'continued', branchChatId:childChatId, branchUrl:String(message.url || sender?.tab?.url || ''), updatedAt:now });
  await addEvent('chat-branch-resolved', 'chat', childChatId, childChatId, { branchId:row.branchId, checkpointId:row.checkpointId, sourceChatId:row.sourceChatId, targetTabId:tabId });
  delete lineage[String(tabId)]; await area.set({ [BRANCH_LINEAGE_KEY]: lineage }); liveHealthContextCache.delete(row.sourceChatId); liveHealthContextCache.delete(childChatId); await markDriveDirty();
  return { ok:true, sourceChatId:row.sourceChatId, childChatId, checkpointId:row.checkpointId };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case 'PC_BRAIN_INGEST': return ingest(message.payload);
      case 'PC_BRAIN_INGEST_BATCH': return ingestBatch(message.payload || []);
      case 'PC_BRAIN_SNAPSHOT': return { ok: true, snapshot: await snapshot() };
      case 'PC_BRAIN_DASHBOARD': return { ok: true, dashboard: await dashboard() };
      case 'PC_BRAIN_SEARCH': return { ok: true, results: await searchBrain(message.query || '', message.limit || 60) };
      case 'PC_BRAIN_COUNTS': return { ok: true, counts: await brainCounts() };
      case 'PC_HOME_SUMMARY': return { ok: true, home: await homeSummary() };
      case 'PC_HOME_SEARCH': return { ok: true, result: await groupedHomeSearch(message.query || '', message.limit || 40) };
      case 'PC_KNOWLEDGE_SUMMARY': return { ok: true, knowledge: await knowledgeSummary(message.limit || 24) };
      case 'PC_KNOWLEDGE_LIST': return { ok: true, items: await knowledgeList(message.filters || {}) };
      case 'PC_KNOWLEDGE_REINDEX': return resetKnowledgeIndex();
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
        return mutateSettings(async () => {
          const current = await settings();
          const next = await saveSettings({ ...current, ...(message.settings || {}), github: { ...current.github, ...(message.settings?.github || {}) }, drive: { ...current.drive, ...(message.settings?.drive || {}) }, catalog: { ...current.catalog, ...(message.settings?.catalog || {}) }, refreshRecovery: { ...current.refreshRecovery, ...(message.settings?.refreshRecovery || {}) }, projectIntegrity: { ...current.projectIntegrity, ...(message.settings?.projectIntegrity || {}) }, knowledge: { ...current.knowledge, ...(message.settings?.knowledge || {}) }, liveHealth: health.normalizeSettings({ ...current.liveHealth, ...(message.settings?.liveHealth || {}) }), approvalAutopilot: { ...current.approvalAutopilot, ...(message.settings?.approvalAutopilot || {}) } });
          if (message.settings?.projectIntegrity) {
            await chrome.alarms.clear(INTEGRITY_MAINTENANCE_ALARM).catch(() => {});
            if (next.projectIntegrity.enabled && next.projectIntegrity.autoScan) await chrome.alarms.create(INTEGRITY_MAINTENANCE_ALARM, { periodInMinutes: Math.max(5, Number(next.projectIntegrity.scanIntervalMinutes || 15)) });
          }
          if (typeof message.githubToken === 'string' && message.githubToken) {
            await chrome.storage.local.set({ [GITHUB_SECRET_KEY]: message.githubToken, [GITHUB_TOKEN_META_KEY]: { accessExpiresAt: 0, refreshExpiresAt: 0, tokenType: 'bearer', connectedAt: Date.now() } });
          }
          if (message.clearGithubToken) await chrome.storage.local.remove([GITHUB_SECRET_KEY, GITHUB_REFRESH_KEY, GITHUB_TOKEN_META_KEY]);
          return { ok: true, settings: next };
        });
      }
      case 'PC_GITHUB_SYNC': return githubSync();
      case 'PC_GITHUB_STATUS': return { ok: true, connection: await githubConnectionStatus({ verify: Boolean(message.verify) }) };
      case 'PC_GITHUB_OAUTH_START': return githubOAuthStart(String(message.clientId || ''));
      case 'PC_GITHUB_OAUTH_POLL': return githubOAuthPoll();
      case 'PC_GITHUB_OAUTH_DISCONNECT': return githubOAuthDisconnect();
      case 'PC_GITHUB_REPOSITORIES': return githubRepositories();
      case 'PC_CONNECTIONS_STATUS': return connectionsStatus({ network: Boolean(message.network), verifyRemote: Boolean(message.verifyRemote), providerNetwork: Boolean(message.providerNetwork) });
      case 'PC_PROVIDER_SESSION_STATUS': return providerSessionStatus(message.providerId, { network: Boolean(message.network) });
      case 'PC_PROVIDER_LOGIN_OPEN': return openProviderLogin(message.providerId);
      case 'PC_PROVIDER_CAPTURE_START': return startFullCapture([message.providerId], { speed: message.speed || 'balanced' });
      case 'PC_DRIVE_CONNECT': {
        await googleToken(true);
        const connection = await driveConnectionStatus({ verify: true });
        if (!connection.connected) {
          await patchSettings({ drive: { lastStatus: 'error', lastError: connection.lastError || 'Google Drive verification failed.' } });
          throw new Error(connection.lastError || 'Google Drive authorization could not be verified.');
        }
        await patchSettings({ drive: { lastStatus: 'verified', lastError: '' } });
        return { ok: true, connection: { ...connection, lastStatus: 'verified', lastError: '' } };
      }
      case 'PC_DRIVE_SYNC': return driveSync({ interactive: Boolean(message.interactive), forceRoundtrip: Boolean(message.forceRoundtrip) });
      case 'PC_DRIVE_RESTORE': return restoreFromDrive({ interactive: Boolean(message.interactive) });
      case 'PC_DRIVE_DISCONNECT': return disconnectDrive();
      case 'PC_DRIVE_STATUS': return { ok: true, connection: await driveConnectionStatus({ verify: Boolean(message.verify) }) };
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
      case 'PC_FULL_CAPTURE_SHOW': return showFullCaptureWindow();
      case 'PC_FULL_CAPTURE_RUNNER_PROGRESS': return handleFullCaptureRunnerProgress(message, sender);
      case 'PC_FULL_CAPTURE_RUNNER_DONE': return handleFullCaptureRunnerDone(message, sender);
      case 'PC_FULL_CAPTURE_RUNNER_ERROR': return handleFullCaptureRunnerError(message, sender);
      case 'PC_APPROVAL_RECOVERY_START': return startApprovalRecovery({ mode: message.mode === 'all-known' ? 'all-known' : 'attention', autoTriggered: false });
      case 'PC_APPROVAL_RECOVERY_STOP': return stopApprovalRecovery();
      case 'PC_APPROVAL_RECOVERY_GET': return { ok: true, state: publicApprovalRecoveryState(await approvalRecoveryState()) };
      case 'PC_APPROVAL_RECOVERY_WATCH': return { ok: true, result: await watchForStalls(), state: publicApprovalRecoveryState(await approvalRecoveryState()) };
      case 'PC_REFRESH_RECOVERY_REQUEST': return recoverTabByRefresh(sender?.tab?.id, message.chatId || providers.chatIdFromUrl(sender?.tab?.url || message.url || '', 'chatgpt'), message.url || sender?.tab?.url || '', message.detail || '', 'live-content');
      case 'PC_REFRESH_RECOVERY_STATUS': return { ok: true, state: publicRefreshRecoveryState(await refreshRecoveryState()) };
      case 'PC_PREPARE_CHAT_HANDOFF': return prepareChatHandoff(message.chatId || providers.chatIdFromUrl(sender?.tab?.url || message.url || '', providers.detectProvider(sender?.tab?.url || message.url || '')?.id || 'chatgpt'), { url: message.url || sender?.tab?.url || '', capacity: message.capacity || {} });
      case 'PC_BRANCH_CHAT': return branchChat(message.chatId || providers.chatIdFromUrl(sender?.tab?.url || message.url || '', providers.detectProvider(sender?.tab?.url || message.url || '')?.id || 'chatgpt'), { url:message.url || sender?.tab?.url || '', capacity:message.capacity || {} }, sender);
      case 'PC_BRANCH_CONTINUATION_CLAIM': return claimBranchContinuation(message.providerId || providers.detectProvider(sender?.tab?.url || message.url || '')?.id || '', sender);
      case 'PC_BRANCH_CONTINUATION_COMPLETE': return completeBranchContinuation(message, sender);
      case 'PC_BRANCH_LINEAGE_RESOLVE': return resolveBranchLineage(message, sender);
      case 'PC_OUTPUT_OBSERVE': return observeOutput({ ...message, chatId:message.chatId || providers.chatIdFromUrl(sender?.tab?.url || message.url || '', providers.detectProvider(sender?.tab?.url || message.url || '')?.id || 'chatgpt') });
      case 'PC_OUTPUT_COMPARE': return outputVaultReport(message.chatId || providers.chatIdFromUrl(sender?.tab?.url || message.url || '', providers.detectProvider(sender?.tab?.url || message.url || '')?.id || 'chatgpt'), { offset:message.offset, limit:message.limit });
      case 'PC_OUTPUT_TURN_REVISIONS': return outputTurnRevisions(message.turnId);
      case 'PC_OPEN_CONSTELLATION_PAGE': {
        const allowedViews = new Set(['overview','search','knowledge','projects','chats','files','integrity','attention','connections','sources','durability']);
        const view = allowedViews.has(String(message.view || '')) ? String(message.view) : 'overview';
        const params = new URLSearchParams({ view });
        if (message.focus) params.set('focus', String(message.focus).slice(0, 80));
        const tab = await chrome.tabs.create({ url: chrome.runtime.getURL(`home.html?${params.toString()}`), active: true });
        return { ok: true, tabId: tab?.id || null };
      }
      case 'PC_LIVE_CHAT_PULSE': return liveChatPulse({ force:Boolean(message.force) });
      case 'PC_LIVE_CHAT_STATE_PUSH': return handleLiveChatStatePush(message, sender);
      case 'PC_LIVE_HEALTH_CONTEXT': return liveHealthContext(message.chatId || providers.chatIdFromUrl(sender?.tab?.url || message.url || '', providers.detectProvider(sender?.tab?.url || message.url || '')?.id || 'chatgpt'), sender?.tab?.id);
      case 'PC_INTEGRITY_SCAN': return runProjectIntegrityScan({ projectIds: Array.isArray(message.projectIds) ? message.projectIds : [], force: message.force !== false });
      case 'PC_INTEGRITY_STATUS': return { ok: true, integrity: await integritySummary() };
      case 'PC_REQUEST_GOVERNOR_STATUS': return { ok: true, requestGovernor: publicRequestGovernor(await requestGovernorState()) };
      case 'PC_BRAIN_CLEAR': await deleteAllStores(); await chrome.storage.local.remove([CATALOG_STATE_KEY, FULL_CAPTURE_STATE_KEY, APPROVAL_RECOVERY_STATE_KEY, REFRESH_RECOVERY_KEY, REQUEST_GOVERNOR_KEY, KNOWLEDGE_BACKFILL_KEY, DIRTY_KEY, BRANCH_CONTINUATION_KEY, BRANCH_LINEAGE_KEY]); await transientStorage().remove([BRANCH_CONTINUATION_KEY, BRANCH_LINEAGE_KEY]); await chrome.alarms.clear(KNOWLEDGE_INDEX_ALARM).catch(() => {}); await updateAttentionBadge(); return { ok: true };
      default: return { ok: false, error: 'Unknown message' };
    }
  })().then(sendResponse).catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
  return true;
});


const LIVE_ACTIVE_HEALTH_STATES = new Set(['working','tool-running','tool-quiet','quiet-working']);
const LIVE_STALE_HEALTH_STATES = new Set(['refresh-required','rate-limited','blocked-approval','auth-required','unavailable','stalled','dead','request-stalled','tool-stalled','tool-dead','degraded','stale-page']);
const LIVE_STALE_STATUSES = new Set(['paused','waiting-user','blocked-approval','refresh-required','rate-limited','errored','stalled','auth-required','unavailable']);

function livePulseBucket(state = {}, network = {}) {
  const status = String(state?.chat?.status || state?.status || 'idle');
  const healthState = String(state?.chat?.healthState || state?.healthState || state?.chat?.health?.state || '');
  if (LIVE_STALE_STATUSES.has(status) || LIVE_STALE_HEALTH_STATES.has(healthState)) return 'stale';
  if (status === 'running' || state?.generation?.active || state?.healthActive || LIVE_ACTIVE_HEALTH_STATES.has(healthState) || Number(network?.pending || 0) > 0 || network?.streamLikely) return 'active';
  return 'completed';
}

async function pulseUxSettings() {
  const stored = await chrome.storage.local.get(PULSE_UX_KEY).catch(() => ({}));
  return { completionNotificationsEnabled:true, branchReviewBeforeSend:true, ...(stored?.[PULSE_UX_KEY] || {}) };
}

async function notifyChatCompletion(row) {
  const cfg = await pulseUxSettings();
  if (cfg.completionNotificationsEnabled === false || !chrome.notifications?.create) return;
  const notificationId = `pc-chat-complete:${Number(row.tabId || 0)}:${Date.now()}`;
  try {
    await chrome.notifications.create(notificationId, {
      type:'basic',
      iconUrl:chrome.runtime.getURL('assets/constellation-field.svg'),
      title:'Chat finished',
      message:String(row.title || row.providerName || 'AI chat').slice(0, 180),
      contextMessage:'Project Constellation'
    });
  } catch (_) {}
}

function rememberLiveTabState(row, { notify = true } = {}) {
  const tabId = Number(row?.tabId || 0);
  if (!tabId) return;
  const previous = liveTabStateByTab.get(tabId);
  liveTabStateByTab.set(tabId, { ...row, observedAt:Number(row.observedAt || Date.now()) });
  liveChatPulseCacheAt = 0;
  if (notify && previous?.bucket === 'active' && row.bucket === 'completed') notifyChatCompletion(row).catch(() => {});
}

function livePulseDomProbe() {
  try {
    const scope = document.querySelector('main') || document.body || document.documentElement;
    const clean = (value, max = 220) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
    const usable = (node) => {
      if (!node || node.disabled || node.getAttribute?.('aria-disabled') === 'true') return false;
      const style = globalThis.getComputedStyle?.(node);
      if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
      const rect = node.getBoundingClientRect?.();
      return !rect || rect.width > 0 || rect.height > 0;
    };
    const stopSelectors = '[data-testid="stop-button"],[data-testid*="stop" i],button[aria-label*="stop generating" i],button[aria-label*="stop streaming" i],button[aria-label*="stop response" i],button[aria-label*="cancel generation" i],button[aria-label*="cancel response" i]';
    const stopControl = [...document.querySelectorAll(stopSelectors)].find(usable) || null;
    const streamingNode = scope?.querySelector?.('[data-is-streaming="true"],[data-testid*="streaming" i],[data-state="streaming" i],.result-streaming,[class*="result-streaming" i]') || null;
    const busyNode = scope?.querySelector?.('[aria-busy="true"],[data-state="loading" i],[data-state="pending" i],[data-loading="true"]') || null;

    let turns = [...document.querySelectorAll('[data-testid^="conversation-turn-"],[data-message-author-role][data-message-id]')];
    const role = (node) => String(node?.getAttribute?.('data-message-author-role') || node?.getAttribute?.('data-author') || node?.getAttribute?.('data-role') || '').toLowerCase();
    const assistants = turns.filter((node) => role(node) === 'assistant');
    const latestAssistant = assistants.at(-1) || null;
    const finalControls = Boolean(latestAssistant && [...latestAssistant.querySelectorAll('button,[role="button"]')].some((node) => /^(copy|read aloud|good response|bad response|share|regenerate|retry)/i.test(clean(node.getAttribute?.('aria-label') || node.textContent, 120))));

    const activeTool = /\b(searching|retrieving|fetching|reading|browsing|running|executing|building|verifying|updating|creating|uploading|downloading|processing|calling|generating)\b/i;
    const finishedTool = /\b(searched|retrieved|fetched|read|browsed|checked|analyzed|ran|executed|built|verified|updated|edited|wrote|created|uploaded|downloaded|processed|called|used|completed|finished)\b/i;
    const toolSelectors = '[aria-busy="true"],[data-state="loading" i],[data-state="pending" i],[data-testid*="tool" i],[aria-label*="tool" i],.loading-shimmer-tertiary,[class*="loading-shimmer" i],[class*="text-token-text-tertiary"]';
    const toolNodes = [...(scope?.querySelectorAll?.(toolSelectors) || [])].slice(-48);
    let toolLabel = '';
    for (let i = toolNodes.length - 1; i >= 0; i -= 1) {
      const text = clean(toolNodes[i].getAttribute?.('aria-label') || toolNodes[i].textContent, 180);
      if (activeTool.test(text) && !finishedTool.test(text)) { toolLabel = text; break; }
    }
    const progressiveTool = Boolean(toolLabel && !finalControls);
    const active = Boolean(stopControl || streamingNode || busyNode || progressiveTool);

    const statusText = clean(scope?.innerText || scope?.textContent || '', 24000).toLowerCase();
    let status = active ? 'running' : 'idle';
    if (!active && /continue generating|resume generation|resume response/.test(statusText)) status = 'paused';
    else if (!active && /(message delivery timed out|connection interrupted|connection (?:was )?lost|network connection (?:was )?lost|reconnect(?:ion)? failed|failed to deliver message)/.test(statusText)) status = 'refresh-required';
    else if (!active && /(too many requests|rate limit(?:ed| exceeded)?|http\s*429|error\s*429|status\s*429)/.test(statusText)) status = 'rate-limited';
    else if (!active && /(something went wrong|there was an error|network error|failed to (generate|respond|send))/.test(statusText)) status = 'errored';
    else if (!active && /(sign in|log in|login required|session expired)/.test(statusText)) status = 'auth-required';
    else if (!active && /(conversation.{0,30}(not found|unavailable|deleted)|page not found)/.test(statusText)) status = 'unavailable';
    else if (!active && /(allow chatgpt to use|approve|permission required)/.test(statusText)) status = 'blocked-approval';

    return {
      ok: true,
      source: 'scripting-dom-probe',
      chat: {
        id: '',
        status,
        rawStatus: status,
        title: document.title || '',
        url: location.href,
        lastActivityAt: Date.now(),
        hasConversation: turns.length > 0,
        turnCount: turns.length,
        healthState: status === 'running' ? 'working' : status === 'idle' ? 'healthy' : status
      },
      generation: { active, stopControl:Boolean(stopControl), streaming:Boolean(streamingNode), busyNode:Boolean(busyNode), progressiveTool, toolLabel, finalControls },
      healthActive: status === 'running',
      healthStale: !['running','idle'].includes(status),
      observedAt: Date.now(),
      hidden: document.hidden
    };
  } catch (error) {
    return { ok:false, source:'scripting-dom-probe', error:String(error?.message || error) };
  }
}

async function probeLiveStateFromTab(tabId) {
  if (!chrome.scripting?.executeScript || !tabId) return null;
  try {
    const results = await chrome.scripting.executeScript({ target:{ tabId }, func:livePulseDomProbe });
    const state = results?.[0]?.result || null;
    return state?.ok ? state : null;
  } catch (_) { return null; }
}

async function readLiveStateFromTab(tab, { allowInject = true } = {}) {
  const tabId = Number(tab?.id || 0);
  if (!tabId || !tab?.url) return null;
  const provider = providers.detectProvider(tab.url);
  if (!provider || !providers.isLikelyChatUrl(tab.url, provider.id)) return null;
  let state = null;
  try { state = await chrome.tabs.sendMessage(tabId, { type:'PC_GET_LIVE_CHAT_STATE' }); }
  catch (_) { state = null; }
  // Existing tabs keep the content-script instance that was present when they loaded.
  // After an extension upgrade those tabs may not know the new live-pulse message yet,
  // so probe their DOM directly instead of requiring ten manual tab reloads.
  if (!state?.ok && allowInject) state = await probeLiveStateFromTab(tabId);
  if (!state?.ok) return null;
  const network = networkStateForTab(tabId);
  const bucket = livePulseBucket(state, network);
  const row = {
    tabId,
    windowId:Number(tab.windowId || 0),
    providerId:provider.id,
    providerName:provider.name,
    title:String(tab.title || state?.chat?.title || provider.name || 'AI chat').replace(/^\s*[✅🟢🟡🔴🟣]+\s*/u,'').slice(0, 220),
    url:String(tab.url || state?.chat?.url || ''),
    chatId:String(state?.chat?.id || providers.chatIdFromUrl(tab.url, provider.id) || ''),
    status:String(state?.chat?.status || 'idle'),
    rawStatus:String(state?.chat?.rawStatus || state?.chat?.status || 'idle'),
    healthState:String(state?.chat?.healthState || state?.chat?.health?.state || ''),
    bucket,
    active:bucket === 'active',
    stale:bucket === 'stale',
    completed:bucket === 'completed',
    generation:state?.generation || null,
    network:{ pending:Number(network.pending || 0), streamLikely:Boolean(network.streamLikely), lastStartAt:Number(network.lastStartAt || 0), lastCompleteAt:Number(network.lastCompleteAt || 0) },
    lastActivityAt:Math.max(Number(state?.chat?.lastActivityAt || 0), Number(network.lastStartAt || 0), Number(network.lastResponseAt || 0), Number(network.lastCompleteAt || 0)),
    observedAt:Date.now()
  };
  rememberLiveTabState(row);
  return row;
}

async function liveChatPulse({ force = false } = {}) {
  const now = Date.now();
  if (!force && liveChatPulseCache && now - liveChatPulseCacheAt < LIVE_CHAT_PULSE_TTL_MS) return liveChatPulseCache;
  if (liveChatPulseRequest) return liveChatPulseRequest;
  liveChatPulseRequest = (async () => {
    const tabs = (await chrome.tabs.query({})).filter((tab) => {
      const provider = providers.detectProvider(tab.url || '');
      return Boolean(provider && providers.isLikelyChatUrl(tab.url || '', provider.id));
    });
    const settled = await Promise.allSettled(tabs.map((tab) => readLiveStateFromTab(tab)));
    const rows = settled.map((result, index) => {
      if (result.status === 'fulfilled' && result.value) return result.value;
      const tab = tabs[index]; const cached = liveTabStateByTab.get(Number(tab?.id || 0));
      return cached && cached.url === tab?.url ? cached : null;
    }).filter(Boolean).sort((a,b) => Number(b.lastActivityAt || b.observedAt || 0) - Number(a.lastActivityAt || a.observedAt || 0));
    const groups = { active:[], stale:[], completed:[] };
    for (const row of rows) groups[row.bucket]?.push(row);
    const snapshot = {
      ok:true,
      generatedAt:Date.now(),
      openChatTabs:tabs.length,
      responsiveTabs:rows.length,
      counts:{ active:groups.active.length, stale:groups.stale.length, completed:groups.completed.length },
      groups,
      recentChats:rows,
      statusCounts:rows.reduce((out,row)=>{out[row.status]=(out[row.status]||0)+1;return out;},{}),
      partial:rows.length !== tabs.length
    };
    liveChatPulseCache = snapshot; liveChatPulseCacheAt = Date.now();
    return snapshot;
  })().finally(() => { liveChatPulseRequest = null; });
  return liveChatPulseRequest;
}

async function handleLiveChatStatePush(message, sender) {
  const tab = sender?.tab;
  if (!tab?.id || !tab?.url) return { ok:false, error:'No sender tab.' };
  const provider = providers.detectProvider(tab.url);
  if (!provider || !providers.isLikelyChatUrl(tab.url, provider.id)) return { ok:true, ignored:true };
  const network = networkStateForTab(tab.id);
  const state = { ...(message?.state || {}), chat:{ ...(message?.state?.chat || {}), status:message?.state?.status || message?.state?.chat?.status || 'idle' }, generation:message?.state?.generation || null };
  const bucket = livePulseBucket(state, network);
  const row = {
    tabId:Number(tab.id), windowId:Number(tab.windowId || 0), providerId:provider.id, providerName:provider.name,
    title:String(tab.title || state?.chat?.title || provider.name).slice(0,220), url:String(tab.url), chatId:String(state?.chat?.id || providers.chatIdFromUrl(tab.url, provider.id) || ''),
    status:String(state?.chat?.status || 'idle'), rawStatus:String(state?.chat?.rawStatus || state?.chat?.status || 'idle'), healthState:String(state?.chat?.healthState || ''), bucket,
    active:bucket==='active', stale:bucket==='stale', completed:bucket==='completed', generation:state?.generation || null,
    network:{pending:Number(network.pending || 0),streamLikely:Boolean(network.streamLikely)}, lastActivityAt:Math.max(Number(state?.chat?.lastActivityAt || 0),Number(network.lastStartAt || 0),Number(network.lastResponseAt || 0),Number(network.lastCompleteAt || 0)), observedAt:Date.now()
  };
  rememberLiveTabState(row);
  return { ok:true, bucket };
}


function scheduleLiveTabReconcile(tabId, delay = 700) {
  const id = Number(tabId || 0);
  if (!id || !chrome.tabs?.get) return;
  const existing = liveNetworkReconcileTimers.get(id);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(async () => {
    liveNetworkReconcileTimers.delete(id);
    try {
      const tab = await chrome.tabs.get(id);
      await readLiveStateFromTab(tab, { allowInject:true });
    } catch (_) {}
  }, Math.max(40, Number(delay || 0)));
  liveNetworkReconcileTimers.set(id, timer);
}

function isHealthRelevantRequest(details = {}) {
  if (Number(details.tabId) < 0 || details.method === 'OPTIONS') return false;
  const type = String(details.type || '');
  if (!['xmlhttprequest','other'].includes(type)) return false;
  const url = String(details.url || '');
  if (/telemetry|analytics|metrics|sentry|statsig|segment|datadog|intercom|google-analytics|doubleclick/i.test(url)) return false;
  return Boolean(providers.detectProvider(url) || providers.detectProvider(details.initiator || details.documentUrl || ''));
}

function liveNetworkRow(tabId) {
  const id = Number(tabId);
  let row = liveNetworkByTab.get(id);
  if (!row) {
    row = { inflight: new Map(), events: [], lastStartAt: 0, lastResponseAt: 0, lastCompleteAt: 0, lastErrorAt: 0, lastObservedAt:0, lastStatusAt:0, lastStatusCode: 0, updatedAt: 0 };
    liveNetworkByTab.set(id, row);
  }
  return row;
}

function liveNetworkCategory(url = '') {
  const value = String(url || '').toLowerCase();
  if (/upload|attachment|file/.test(value)) return /download/.test(value) ? 'file download' : 'file transfer';
  if (/search|browse/.test(value)) return 'web search';
  if (/connector|tool|action|plugin/.test(value)) return 'tool / connector';
  if (/history|conversations(?:[/?]|$)|catalog|sidebar/.test(value)) return 'chat history';
  if (/conversation|response|message|completion|generate|stream/.test(value)) return 'response stream';
  if (/auth|session|account|login/.test(value)) return 'session check';
  return 'provider request';
}

function liveNetworkActivityBearing(category = '', method = 'GET') {
  if (['response stream','tool / connector','web search','file transfer','file download'].includes(String(category || ''))) return true;
  return String(category || '') === 'provider request' && String(method || 'GET').toUpperCase() !== 'GET';
}

function noteNetworkEvent(row, event) {
  row.events ||= [];
  row.events.push({ id:String(event.id || ''), phase:String(event.phase || ''), category:String(event.category || 'provider request'), activityBearing:Boolean(event.activityBearing), method:String(event.method || 'GET').slice(0, 12), status:Number(event.status || 0), startedAt:Number(event.startedAt || 0), at:Number(event.at || Date.now()), durationMs:Math.max(0, Number(event.durationMs || 0)) });
  if (row.events.length > 36) row.events.splice(0, row.events.length - 36);
}

function noteNetworkStart(details) {
  if (!isHealthRelevantRequest(details)) return;
  const row = liveNetworkRow(details.tabId); const now = Date.now();
  const id = String(details.requestId || crypto.randomUUID());
  const category = liveNetworkCategory(details.url); const method = String(details.method || 'GET');
  const item = { id, url: String(details.url || '').slice(0, 1200), category, activityBearing:liveNetworkActivityBearing(category, method), method, type: String(details.type || ''), startedAt: now };
  row.inflight.set(id, item);
  while (row.inflight.size > 64) row.inflight.delete(row.inflight.keys().next().value);
  noteNetworkEvent(row, { id, phase:'started', category:item.category, activityBearing:item.activityBearing, method:item.method, startedAt:now, at:now });
  if (item.activityBearing) { row.lastStartAt = now; liveChatPulseCacheAt = 0; scheduleLiveTabReconcile(details.tabId, 80); }
  row.lastObservedAt = now; row.updatedAt = now;
}
function noteNetworkResponse(details) {
  if (!isHealthRelevantRequest(details)) return;
  const row = liveNetworkRow(details.tabId); const now = Date.now();
  const id = String(details.requestId || ''); const item = row.inflight.get(id);
  const category = item?.category || liveNetworkCategory(details.url); const method = item?.method || details.method; const activityBearing = item?.activityBearing ?? liveNetworkActivityBearing(category, method);
  noteNetworkEvent(row, { id, phase:'response', category, activityBearing, method, status:details.statusCode, startedAt:item?.startedAt, at:now, durationMs:item?.startedAt ? now - item.startedAt : 0 });
  if (activityBearing) row.lastResponseAt = now;
  row.lastObservedAt = now; row.lastStatusAt = now; row.lastStatusCode = Number(details.statusCode || 0); row.updatedAt = now;
}
function noteNetworkDone(details, failed = false) {
  if (!isHealthRelevantRequest(details)) return;
  const row = liveNetworkRow(details.tabId); const now = Date.now();
  const id = String(details.requestId || ''); const item = row.inflight.get(id);
  row.inflight.delete(id);
  const category = item?.category || liveNetworkCategory(details.url); const method = item?.method || details.method; const activityBearing = item?.activityBearing ?? liveNetworkActivityBearing(category, method);
  noteNetworkEvent(row, { id, phase:failed ? 'error' : 'completed', category, activityBearing, method, status:details.statusCode, startedAt:item?.startedAt, at:now, durationMs:item?.startedAt ? now - item.startedAt : 0 });
  if (activityBearing) { if (failed) row.lastErrorAt = now; else row.lastCompleteAt = now; liveChatPulseCacheAt = 0; scheduleLiveTabReconcile(details.tabId, 850); }
  row.lastObservedAt = now;
  if (Number(details.statusCode || 0)) { row.lastStatusCode = Number(details.statusCode || 0); row.lastStatusAt = now; }
  row.updatedAt = now;
}

if (chrome.webRequest?.onBeforeRequest) {
  const liveUrls = [...new Set(providers.PROVIDERS.flatMap((row) => (row.hosts || []).map((host) => `https://${host}/*`)))];
  const filter = { urls: liveUrls, types: ['xmlhttprequest','other'] };
  chrome.webRequest.onBeforeRequest.addListener(noteNetworkStart, filter);
  chrome.webRequest.onResponseStarted.addListener(noteNetworkResponse, filter);
  chrome.webRequest.onCompleted.addListener((details) => noteNetworkDone(details, false), filter);
  chrome.webRequest.onErrorOccurred.addListener((details) => noteNetworkDone(details, true), filter);
}
if (chrome.tabs?.onRemoved) chrome.tabs.onRemoved.addListener((tabId) => { const id=Number(tabId); liveNetworkByTab.delete(id); liveTabStateByTab.delete(id); const timer=liveNetworkReconcileTimers.get(id); if(timer)clearTimeout(timer); liveNetworkReconcileTimers.delete(id); liveChatPulseCacheAt = 0; });

if (chrome.notifications?.onClicked) chrome.notifications.onClicked.addListener(async (notificationId) => {
  const match = String(notificationId || '').match(/^pc-chat-complete:(\d+):/);
  if (!match) return;
  const tabId = Number(match[1]);
  try {
    const tab = await chrome.tabs.get(tabId);
    await chrome.tabs.update(tabId, { active:true });
    if (tab?.windowId) await chrome.windows?.update?.(tab.windowId, { focused:true });
    await chrome.notifications.clear(notificationId).catch(() => {});
  } catch (_) {}
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
