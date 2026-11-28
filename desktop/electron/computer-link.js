'use strict';
(() => {
  const api = window.commanderShell;
  const $ = id => document.getElementById(id);
  if (!api || !$('native-tools-status')) return;
  let status = null;
  let busy = false;
  let refreshAgain = false;
  let checked = false;
  let access = { emergencyLock: false, localToolMode: 'auto', enableGuiAutomation: true };
  let failure = null;
  let notice = '';
  const locked = () => access.emergencyLock || access.localToolMode === 'off' || access.enableGuiAutomation === false;

  function controls() {
    $('native-tools-open').disabled = busy || locked() || !status?.owner?.available || status.owner.running;
    $('native-tools-stop').disabled = busy || !status?.owner?.running;
    $('native-tools-refresh').disabled = busy;
    $('native-tools-test').disabled = busy || !status?.mcp?.available;
    $('native-tools-copy').disabled = busy || !status?.mcp?.available || !status.mcp.command;
    $('native-tools-status').setAttribute('aria-busy', String(busy));
  }

  function render(value = status) {
    status = value;
    const badge = $('native-tools-badge');
    const running = Boolean(value?.owner?.running);
    const available = value?.windowsSupported && value?.owner?.available;
    badge.textContent = failure ? failure.title : running ? 'Running' : locked() && available ? 'Access disabled' : available ? 'Ready' : 'Unavailable';
    badge.className = `badge ${failure ? 'bad' : available && !locked() ? 'good' : 'warn'}`;
    $('native-tools-status').textContent = failure?.message || notice || (running
      ? `Native tools are open${value.owner.pid ? ` · process ${value.owner.pid}` : ''}. Closing them ends sessions owned by this window.`
      : available
        ? locked() ? 'Local computer access is disabled. Enable it in Controls before opening native tools.'
          : 'Ready when you need it. Select access inside the native window; it remains local until you choose a supported connection.'
        : value?.windowsSupported === false
          ? 'The native desktop tools require Windows. Constellation’s other local tools remain available.'
          : 'Native components are missing. Run the Constellation Windows installer or rebuild the native tools.');
    const list = $('native-tools-capabilities');
    list.replaceChildren();
    for (const capability of value?.capabilities || []) {
      const row = document.createElement('li');
      const title = document.createElement('span');
      const detail = document.createElement('small');
      title.textContent = capability.title || capability.id;
      detail.textContent = capability.available ? 'Available' : capability.reason || 'Unavailable';
      detail.className = capability.available ? 'native-available' : 'muted';
      row.append(title, detail); list.append(row);
    }
    $('native-tools-command').textContent = value?.mcp?.available && value.mcp.command
      ? JSON.stringify({ command: value.mcp.command, args: value.mcp.args || ['--status-only'] }, null, 2)
      : 'The local connector is not installed.';
    controls();
  }

  async function refresh({ preserveFailure = false } = {}) {
    if (busy) { refreshAgain = true; return; }
    if (!api.computerLinkStatus) {
      failure = { title: 'Update needed', message: 'Update the desktop app to use the native computer tools.' };
      render(); return;
    }
    busy = true; controls();
    try {
      const value = await api.computerLinkStatus();
      if (!preserveFailure) { failure = null; notice = ''; }
      render(value); checked = true;
    } catch (error) {
      // Keep the last known owned process so a failed discovery read does not
      // hide its Close action or turn an unknown state into "not running".
      failure = { title: 'Check failed', message: String(error?.message || error) }; render();
    } finally {
      busy = false; controls();
      if (refreshAgain) { refreshAgain = false; void refresh({ preserveFailure: true }); }
    }
  }

  async function act(action) {
    if (busy || (action === 'open' && locked())) return;
    busy = true; failure = null; notice = ''; controls();
    try {
      if (action === 'open') {
        const result = await api.openComputerLink();
        if (result?.started !== true) throw new Error(result?.reason || 'Native tools did not confirm startup.');
      } else if (action === 'stop') {
        const result = await api.stopComputerLink();
        if (result?.stopped !== true) throw new Error(result?.reason || 'Native tools have not confirmed exit.');
      } else {
        const result = await api.computerLinkSessionStatus();
        $('native-tools-diagnostic').textContent = JSON.stringify(result, null, 2);
        if (result?.available !== true || result?.verified !== true) throw new Error(result?.reason || 'The native status connection was not verified.');
        notice = 'Local status handshake verified. No computer content was captured.';
      }
      if (action !== 'test') status = await api.computerLinkStatus();
    } catch (error) {
      failure = { title: action === 'stop' ? 'Close unconfirmed' : action === 'open' ? 'Open failed' : 'Test failed', message: String(error?.message || error) };
      if (action === 'test') $('native-tools-diagnostic').textContent = failure.message;
    } finally {
      busy = false; render();
      if (refreshAgain) { refreshAgain = false; void refresh({ preserveFailure: true }); }
    }
  }

  $('native-tools-refresh').addEventListener('click', () => void refresh());
  $('native-tools-open').addEventListener('click', () => void act('open'));
  $('native-tools-stop').addEventListener('click', () => void act('stop'));
  $('native-tools-test').addEventListener('click', () => void act('test'));
  $('native-tools-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('native-tools-command').textContent);
      notice = 'Local connector settings copied.'; failure = null; render();
    } catch { failure = { title: 'Copy unavailable', message: 'Select the local connector settings below and copy them with Ctrl+C.' }; render(); }
  });
  window.addEventListener('commander-view', event => { if (event.detail?.view === 'connections' && !checked) void refresh(); });
  window.addEventListener('commander-snapshot', event => {
    const snapshot = event.detail || {};
    access = { ...access, ...snapshot.config, emergencyLock: Boolean(snapshot.emergencyLock) };
    if (checked) render(); else controls();
  });
  api.onEvent?.(event => {
    if (event.type === 'computer-link-state') {
      if (event.detail?.type === 'exited') { failure = null; notice = 'Native tools closed.'; }
      void refresh({ preserveFailure: true });
    }
    if (event.type === 'emergency-lock') { access.emergencyLock = Boolean(event.detail?.enabled); if (checked) render(); else controls(); }
    if (event.type === 'config-changed' && event.detail?.config) { access = { ...access, ...event.detail.config }; if (checked) render(); else controls(); }
    if (event.type === 'owned-work-stop-error') { failure = { title: 'Cleanup unconfirmed', message: (event.detail?.errors || []).join(' · ') || 'Owned work has not confirmed exit.' }; render(); }
  });
})();
