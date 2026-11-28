(() => {
  'use strict';

  function createSharedConnection({ name, version, onUpgrade }) {
    let db = null;
    let opening = null;

    async function open() {
      if (db) return db;
      if (opening) return opening;
      opening = new Promise((resolve, reject) => {
        const request = indexedDB.open(name, version);
        request.onupgradeneeded = (event) => {
          if (typeof onUpgrade === 'function') onUpgrade({ event, request, db: request.result, transaction: request.transaction });
        };
        request.onsuccess = () => {
          db = request.result;
          db.onversionchange = () => {
            try { db.close(); } catch (_) {}
            db = null;
            opening = null;
          };
          resolve(db);
        };
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error(`IndexedDB upgrade blocked for ${name}. Close stale Constellation tabs and retry.`));
      }).finally(() => { opening = null; });
      return opening;
    }

    function release() {
      // Intentionally retain one MV3 service-worker connection. Reopening IndexedDB for
      // every read/write was needless churn; Chrome will reclaim this when the worker
      // suspends, and onversionchange above safely releases it for migrations.
    }

    function close() {
      if (db) {
        try { db.close(); } catch (_) {}
      }
      db = null;
      opening = null;
    }

    return Object.freeze({ open, release, close });
  }

  globalThis.ProjectConstellationBrainDbCore = Object.freeze({ createSharedConnection });
})();
