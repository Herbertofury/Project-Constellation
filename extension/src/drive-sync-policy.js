(() => {
  'use strict';

  const CONNECTED_STATUSES = new Set(['connected', 'verified', 'synced']);
  const DISCONNECTED_STATUSES = new Set(['not-connected', 'disconnected']);

  function hasConnectionEvidence(drive = {}) {
    const status = String(drive.lastStatus || '').trim().toLowerCase();
    if (DISCONNECTED_STATUSES.has(status)) return false;
    if (Number(drive.connectedAt || 0) > 0) return true;
    if (CONNECTED_STATUSES.has(status)) return true;
    if (String(drive.folderId || '').trim()) return true;
    if (String(drive.snapshotFileId || '').trim()) return true;
    if (String(drive.journalFileId || '').trim()) return true;
    if (String(drive.indexFileId || '').trim()) return true;
    if (Number(drive.lastSyncAt || 0) > 0) return true;
    if (Number(drive.lastRestoreAt || 0) > 0) return true;
    return false;
  }

  function autoSyncEligible(input = {}) {
    const drive = input.drive || {};
    if (!drive.autoSync) return false;
    if (!input.oauthProvisioned) return false;
    return hasConnectionEvidence(drive);
  }

  const api = Object.freeze({ CONNECTED_STATUSES, DISCONNECTED_STATUSES, hasConnectionEvidence, autoSyncEligible });
  globalThis.ProjectConstellationDriveSyncPolicy = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
