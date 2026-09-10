(() => {
  'use strict';
  if (globalThis.__PROJECT_CONSTELLATION_DRIVE_SYNC_GUARD__) return;
  globalThis.__PROJECT_CONSTELLATION_DRIVE_SYNC_GUARD__ = true;

  const policy = globalThis.ProjectConstellationDriveSyncPolicy;
  if (!policy || !globalThis.chrome?.alarms?.create || !chrome.alarms?.onAlarm?.addListener || !chrome.storage?.local) return;

  const VERSION = 1;
  const SETTINGS_KEY = 'projectConstellationBrainSettings';
  const DIRTY_KEY = 'projectConstellationDriveDirtyAt';
  const EVIDENCE_KEY = 'projectConstellationDriveAutoSyncConnectedAt';
  const STATUS_KEY = 'projectConstellationDriveSyncGuardStatus';
  const DRIVE_SYNC_ALARM = 'project-constellation-drive-sync';
  const CONNECTED = new Set(['connected', 'verified', 'synced']);
  const DISCONNECTED = new Set(['not-connected', 'disconnected']);

  const originalCreate = chrome.alarms.create.bind(chrome.alarms);
  const originalClear = chrome.alarms.clear.bind(chrome.alarms);
  const alarmEvent = chrome.alarms.onAlarm;
  const originalAddListener = alarmEvent.addListener.bind(alarmEvent);
  const originalRemoveListener = typeof alarmEvent.removeListener === 'function' ? alarmEvent.removeListener.bind(alarmEvent) : null;
  const wrappedListeners = new WeakMap();

  function oauthProvisioned() {
    const id = String(chrome.runtime.getManifest()?.oauth2?.client_id || '');
    return Boolean(id && id.endsWith('.apps.googleusercontent.com') && !id.includes('PROJECT_CONSTELLATION_GOOGLE_OAUTH_CLIENT_ID'));
  }

  async function readState() {
    const stored = await chrome.storage.local.get([SETTINGS_KEY, DIRTY_KEY, EVIDENCE_KEY]);
    const rawSettings = stored?.[SETTINGS_KEY] || {};
    const rawDrive = rawSettings.drive || {};
    const evidenceAt = Math.max(0, Number(stored?.[EVIDENCE_KEY] || 0));
    const drive = {
      autoSync: rawDrive.autoSync !== false,
      lastStatus: rawDrive.lastStatus || 'not-connected',
      ...rawDrive,
      connectedAt: Math.max(Number(rawDrive.connectedAt || 0), evidenceAt)
    };
    return { rawSettings, drive, evidenceAt, dirtyAt: Math.max(0, Number(stored?.[DIRTY_KEY] || 0)) };
  }

  async function eligible({ requireDirty = true } = {}) {
    const state = await readState();
    return policy.autoSyncEligible({ oauthProvisioned: oauthProvisioned(), drive: state.drive }) && (!requireDirty || state.dirtyAt > 0);
  }

  async function reconcileConnectionEvidence() {
    const state = await readState();
    const status = String(state.drive.lastStatus || '').trim().toLowerCase();
    if (DISCONNECTED.has(status)) {
      if (state.evidenceAt) await chrome.storage.local.remove(EVIDENCE_KEY);
      await originalClear(DRIVE_SYNC_ALARM).catch(() => {});
      return { connected: false, evidenceAt: 0 };
    }
    if (CONNECTED.has(status)) {
      const evidenceAt = state.evidenceAt || Date.now();
      if (!state.evidenceAt) await chrome.storage.local.set({ [EVIDENCE_KEY]: evidenceAt });
      if (state.dirtyAt && policy.autoSyncEligible({ oauthProvisioned: oauthProvisioned(), drive: { ...state.drive, connectedAt: evidenceAt } })) {
        await originalCreate(DRIVE_SYNC_ALARM, { when: Date.now() + 1000 });
      }
      return { connected: true, evidenceAt };
    }
    return { connected: state.evidenceAt > 0, evidenceAt: state.evidenceAt };
  }

  async function guardedCreate(nameOrInfo, maybeInfo) {
    if (typeof nameOrInfo !== 'string' || nameOrInfo !== DRIVE_SYNC_ALARM) return originalCreate(nameOrInfo, maybeInfo);
    if (!await eligible({ requireDirty: true })) return undefined;
    return originalCreate(nameOrInfo, maybeInfo);
  }

  function guardedAddListener(listener) {
    if (typeof listener !== 'function') return originalAddListener(listener);
    const wrapped = (alarm) => {
      if (alarm?.name !== DRIVE_SYNC_ALARM) return listener(alarm);
      void (async () => {
        if (await eligible({ requireDirty: true })) listener(alarm);
        else await originalClear(DRIVE_SYNC_ALARM).catch(() => {});
      })();
    };
    wrappedListeners.set(listener, wrapped);
    return originalAddListener(wrapped);
  }

  function guardedRemoveListener(listener) {
    return originalRemoveListener?.(wrappedListeners.get(listener) || listener);
  }

  let createPatched = false;
  let listenerPatched = false;
  try {
    chrome.alarms.create = guardedCreate;
    createPatched = chrome.alarms.create === guardedCreate;
  } catch (_) {}
  try {
    alarmEvent.addListener = guardedAddListener;
    listenerPatched = alarmEvent.addListener === guardedAddListener;
    if (originalRemoveListener) alarmEvent.removeListener = guardedRemoveListener;
  } catch (_) {}

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes?.[SETTINGS_KEY]) return;
    void reconcileConnectionEvidence();
  });

  chrome.storage.local.set({ [STATUS_KEY]: { version: VERSION, active: createPatched && listenerPatched, createPatched, listenerPatched, updatedAt: Date.now() } }).catch(() => {});
  void reconcileConnectionEvidence();

  globalThis.ProjectConstellationDriveSyncGuard = Object.freeze({ VERSION, eligible, reconcileConnectionEvidence, createPatched, listenerPatched });
})();
