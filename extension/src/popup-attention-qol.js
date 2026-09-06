(() => {
  'use strict';

  const KEY = 'projectConstellationPulseUxSettings';
  const input = document.getElementById('attentionNotificationsEnabled');
  const status = document.getElementById('status');
  if (!input) return;

  let writeChain = Promise.resolve();

  async function persist(desired) {
    const stored = await chrome.storage.local.get(KEY).catch(() => ({}));
    const current = stored?.[KEY] || {};
    if (current.attentionNotificationsEnabled !== desired) {
      await chrome.storage.local.set({[KEY]:{...current,attentionNotificationsEnabled:desired}});
    }
    input.checked = desired;
  }

  input.addEventListener('change',(event) => {
    const desired = Boolean(input.checked);
    // popup.js historically omitted this key from savePulseUx(). Take ownership
    // before that legacy handler can spread its stale in-memory value back out.
    event.stopImmediatePropagation();
    writeChain = writeChain.then(() => persist(desired)).catch((error) => {
      if (status) status.textContent = `Could not save Stall & runway alerts: ${String(error?.message || error).slice(0,140)}`;
    });
  },true);
})();
