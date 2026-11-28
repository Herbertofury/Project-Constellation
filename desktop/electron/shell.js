'use strict';

(() => {
  const api = window.commanderShell;
  if (!api) return;

  const $ = id => document.getElementById(id);
  const activity = [];
  let snapshot = null;
  let active = null;
  let directTools = [];
  let directFiltered = [];
  let directRunning = false;

  function dot(id, state) {
    const el = $(id);
    el.className = `dot ${state === 'good' ? 'dot-good' : state === 'bad' ? 'dot-bad' : 'dot-warn'}`;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
  }

  function formatTime(value) {
    try { return new Date(value).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' }); } catch { return ''; }
  }

  function renderRoots(config) {
    const roots = Array.isArray(config.allowedRoots) ? config.allowedRoots : [];
    const full = roots.includes('*');
    $('access-badge').textContent = full ? 'Full PC' : `${roots.length} root${roots.length === 1 ? '' : 's'}`;
    $('access-badge').className = `badge ${full ? 'warn' : 'good'}`;
    $('full-access').textContent = full ? 'Restrict' : 'Full PC';
    $('root-list').innerHTML = full
      ? '<div class="small muted">All local drives and folders are available to Commander.</div>'
      : roots.map(root => `<div class="root"><code title="${escapeHtml(root)}">${escapeHtml(root)}</code><button data-root="${escapeHtml(root)}" title="Remove">×</button></div>`).join('');
    for (const button of $('root-list').querySelectorAll('button[data-root]')) {
      button.addEventListener('click', async () => { await api.removeRoot(button.dataset.root); await refresh(); });
    }
  }

  function renderWindows(windows = []) {
    const list = $('window-list');
    const rows = windows.filter(item => item && item.title);
    list.innerHTML = rows.length ? rows.map(item => `
      <button class="window-row" data-handle="${escapeHtml(item.handle ?? '')}" data-pid="${escapeHtml(item.pid ?? '')}" title="Focus ${escapeHtml(item.title)}">
        <span class="window-title">${escapeHtml(item.title)}</span>
        <span class="window-meta">${escapeHtml(item.process || item.processName || item.pid || '')}${item.foreground ? ' · active' : ''}</span>
      </button>`).join('') : '<div class="small muted">No visible windows reported.</div>';
    for (const button of list.querySelectorAll('.window-row')) {
      button.addEventListener('click', async () => {
        await api.focusWindow({ handle: button.dataset.handle || undefined, pid: button.dataset.pid ? Number(button.dataset.pid) : undefined });
        await loadWindows();
      });
    }
  }

  async function loadWindows() {
    const result = await api.listWindows();
    renderWindows(result?.windows || []);
  }

  async function observeDesktop() {
    const button = $('observe-desktop');
    button.disabled = true;
    $('desktop-badge').textContent = 'Observing…';
    $('desktop-badge').className = 'badge warn';
    try {
      const result = await api.observeDesktop();
      if (!result?.ok) throw new Error(result?.error || 'Desktop observation failed.');
      if (result.imageDataUrl) {
        const img = $('desktop-preview');
        img.src = result.imageDataUrl;
        img.classList.remove('hidden');
      }
      renderWindows(result.windows || []);
      $('desktop-badge').textContent = `${(result.windows || []).length} windows`;
      $('desktop-badge').className = 'badge good';
    } catch (error) {
      $('desktop-badge').textContent = 'FAIL';
      $('desktop-badge').className = 'badge bad';
      $('window-list').innerHTML = `<div class="small error-text">${escapeHtml(error?.message || error)}</div>`;
    } finally { button.disabled = false; }
  }

  function valueForSchema(schema = {}) {
    if (Object.prototype.hasOwnProperty.call(schema, 'default')) return schema.default;
    if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
    if (Array.isArray(schema.examples) && schema.examples.length) return schema.examples[0];
    if (schema.type === 'array') return [];
    if (schema.type === 'object') return {};
    if (schema.type === 'boolean') return false;
    if (schema.type === 'integer' || schema.type === 'number') return 0;
    return '';
  }

  function argsTemplate(tool) {
    const schema = tool?.inputSchema || {};
    const props = schema.properties || {};
    const required = new Set(Array.isArray(schema.required) ? schema.required : []);
    const output = {};
    for (const [key, def] of Object.entries(props)) {
      if (required.has(key)) output[key] = valueForSchema(def || {});
    }
    return output;
  }

  function currentDirectTool() {
    return directTools.find(tool => tool.name === $('direct-tool').value) || null;
  }

  function updateDirectToolHelp({ resetArgs = false } = {}) {
    const tool = currentDirectTool();
    $('direct-tool-help').textContent = tool?.description || 'Choose a Project Constellation tool.';
    if (tool && resetArgs) $('direct-args').value = JSON.stringify(argsTemplate(tool), null, 2);
  }

  function renderDirectTools(filter = '') {
    const q = String(filter || '').trim().toLowerCase();
    const before = $('direct-tool').value;
    directFiltered = directTools.filter(tool => !q || tool.name.toLowerCase().includes(q) || String(tool.description || '').toLowerCase().includes(q));
    $('direct-tool').innerHTML = directFiltered.map(tool => `<option value="${escapeHtml(tool.name)}">${escapeHtml(tool.name)}</option>`).join('');
    if (before && directFiltered.some(tool => tool.name === before)) $('direct-tool').value = before;
    $('direct-tool-count').textContent = `${directFiltered.length}/${directTools.length}`;
    $('direct-tool-count').className = `badge ${directTools.length ? 'good' : 'bad'}`;
    updateDirectToolHelp({ resetArgs: !before });
  }

  async function loadDirectTools() {
    try {
      const response = await api.listTools();
      directTools = Array.isArray(response?.tools) ? response.tools : [];
      renderDirectTools($('tool-filter').value);
    } catch (error) {
      $('direct-tool-count').textContent = 'FAIL';
      $('direct-tool-count').className = 'badge bad';
      $('direct-tool-help').textContent = String(error?.message || error);
    }
  }

  function serializeDirectResult(value) {
    try { return JSON.stringify(value, null, 2); }
    catch { return String(value); }
  }

  async function runDirectTool() {
    if (directRunning) return;
    const tool = currentDirectTool();
    if (!tool) return;
    let args;
    try {
      args = JSON.parse($('direct-args').value || '{}');
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Arguments must be a JSON object.');
    } catch (error) {
      $('direct-status').textContent = `Invalid JSON: ${error?.message || error}`;
      $('direct-status').className = 'small error-text direct-status';
      return;
    }
    directRunning = true;
    $('direct-run').disabled = true;
    $('direct-status').textContent = `Running ${tool.name}…`;
    $('direct-status').className = 'small muted direct-status';
    $('direct-preview').classList.add('hidden');
    try {
      const response = await api.runTool(tool.name, args);
      $('direct-result').textContent = serializeDirectResult(response?.result ?? response);
      if (response?.imageDataUrl) {
        $('direct-preview').src = response.imageDataUrl;
        $('direct-preview').classList.remove('hidden');
      }
      $('direct-status').textContent = `${tool.name} completed${response?.attachmentCount ? ` · ${response.attachmentCount} attachment(s)` : ''}.`;
      $('direct-status').className = 'small direct-status success-text';
    } catch (error) {
      $('direct-result').textContent = String(error?.stack || error?.message || error);
      $('direct-status').textContent = `${tool.name} failed.`;
      $('direct-status').className = 'small error-text direct-status';
    } finally {
      directRunning = false;
      $('direct-run').disabled = false;
      await refresh();
    }
  }

  function renderActivity() {
    $('call-count').textContent = `${snapshot?.stats?.totalCalls || 0} calls`;
    $('active-call').classList.toggle('hidden', !active);
    if (active) $('active-call').innerHTML = `<strong>Running ${escapeHtml(active.tool)}</strong><div class="muted">${escapeHtml(active.id || '')}</div>`;
    $('activity').innerHTML = activity.slice(0, 12).map(item => `
      <div class="activity-item ${item.ok === false ? 'fail' : item.ok === true ? 'ok' : ''}">
        <div class="activity-title"><strong>${escapeHtml(item.tool || item.type || 'event')}</strong><span>${formatTime(item.at)}</span></div>
        <div class="activity-meta">${escapeHtml(item.message || (item.durationMs != null ? `${item.durationMs} ms` : ''))}</div>
      </div>`).join('') || '<div class="small muted">No local tool activity yet.</div>';
  }

  function render(next) {
    snapshot = next;
    window.dispatchEvent(new CustomEvent('commander-snapshot',{detail:next}));
    const chat = next.chat || {};
    const config = next.config || {};
    $('version').textContent = `v${next.version || '0.23.0'}`;
    document.body.classList.toggle('sidebar-collapsed', Boolean(next.shellCollapsed));
    $('controls').textContent = 'Computer access';$('controls').setAttribute('aria-expanded',String(!next.shellCollapsed));
    const off=config.localToolMode==='off';
    const verified=chat.phase==='verified' && chat.pageHookReady===true;
    const summary=next.emergencyLock?'Computer access locked':off?'Computer access off':chat.message||chat.phase||'Unknown';
    $('chat-state').textContent=summary;$('chat-state').title=summary;
    dot('chat-dot',next.emergencyLock||chat.phase==='error'?'bad':verified&&!off?'good':'warn');
    $('agent-state').textContent=next.emergencyLock?'Emergency Lock active':off?'Chat computer access is off':verified?'Chat access verified':'Local workspace ready';
    $('agent-detail').textContent=next.emergencyLock?'New actions are blocked; managed processes have been stopped.':off?'Local files and terminal remain available. ChatGPT cannot run local tools until you enable Auto or Always.':verified?'The current chat completed a local action and accepted its result.':chat.lastError||'Files and terminal work independently. Use Connections > Test chat access to verify the chat route.';
    dot('agent-dot',next.emergencyLock?'bad':off?'warn':'good');

    $('local-mode').value = config.localToolMode || 'auto';
    $('gui-toggle').checked = config.enableGuiAutomation !== false;
    $('shell-toggle').checked = config.enableShell !== false;
    $('startup-toggle').checked = Boolean(next.startWithWindows);
    const update=next.update||{};
    const updateBadge=$('update-badge'); const updateStatus=$('update-status');
    if(updateBadge&&updateStatus){
      const phase=String(update.phase||'idle'); const available=String(update.availableVersion||'');
      updateBadge.textContent=phase==='available'?`v${available}`:phase==='staged'?'VERIFIED':phase==='current'?'CURRENT':phase==='error'?'ERROR':phase.toUpperCase();
      updateBadge.className=`badge ${phase==='error'?'bad':phase==='available'||phase==='staged'?'warn':'good'}`;
      updateStatus.textContent=phase==='available'?`Project Constellation v${available} is available.`:phase==='staged'?`v${update.staged?.version||available} downloaded and SHA-256 verified. Ready to install.`:phase==='current'?`v${next.version} is current on the stable channel.`:phase==='checking'?'Checking the verified GitHub release channel…':phase==='downloading'?'Downloading and verifying the portable build…':update.error||'Stable channel · check when you want, install only after SHA-256 verification.';
      $('update-download').disabled=phase!=='available'; $('update-install').disabled=phase!=='staged';
      $('update-rollback').classList.toggle('hidden',!update.rollbackAvailable);
    }
    $('emergency').classList.toggle('locked', Boolean(next.emergencyLock));
    $('emergency').textContent = next.emergencyLock ? 'Unlock computer access' : 'Lock computer access';
    renderRoots(config);

    activity.length = 0;
    for (const row of (next.recentCalls || []).slice().reverse()) {
      activity.push({ at: row.ts, tool: row.tool, ok: row.ok, durationMs: row.durationMs, message: row.error || '' });
    }
    renderActivity();
  }

  async function refresh() {
    try { render(await api.snapshot()); }
    catch (error) {
      $('agent-state').textContent = 'Project Constellation shell offline';
      $('agent-detail').textContent = String(error?.message || error);
      dot('agent-dot', 'bad');
    }
  }

  function pushEvent(evt) {
    if (!evt) return;
    const detail = evt.detail || {};
    if (evt.type === 'tool-start') active = detail;
    if (evt.type === 'tool-finish' || evt.type === 'tool-error') {
      void refresh();
      active = null;
      activity.unshift({ at: evt.at, tool: detail.tool, ok: evt.type === 'tool-finish', durationMs: detail.durationMs, message: detail.error || '' });
      activity.splice(20);
    }
    if (evt.type === 'chat-state' || evt.type === 'config-changed' || evt.type === 'emergency-lock' || evt.type === 'sidebar-collapsed' || evt.type === 'outbox-changed' || evt.type === 'task-progress' || evt.type === 'update-state') void refresh();
    renderActivity();
  }

  $('local-mode').addEventListener('change', async event => { await api.setLocalMode(event.target.value); await refresh(); });
  $('arm-next').addEventListener('click', async () => { const r = await api.armNext(); if (r?.ok) { $('agent-detail').textContent = 'Next ChatGPT message will be forced through Commander.'; } });
  $('gui-toggle').addEventListener('change', async event => { await api.setOption('enableGuiAutomation', event.target.checked); await refresh(); });
  $('shell-toggle').addEventListener('change', async event => { await api.setOption('enableShell', event.target.checked); await refresh(); });
  $('startup-toggle').addEventListener('change', async event => { await api.setStartWithWindows(event.target.checked); await refresh(); });
  $('update-check').addEventListener('click',async()=>{const b=$('update-check');b.disabled=true;try{await api.checkForUpdates();await refresh();}catch(e){$('update-status').textContent=String(e?.message||e);}finally{b.disabled=false;}});
  $('update-download').addEventListener('click',async()=>{const b=$('update-download');b.disabled=true;try{await api.downloadUpdate();await refresh();}catch(e){$('update-status').textContent=String(e?.message||e);}finally{b.disabled=false;}});
  $('update-install').addEventListener('click',async()=>{const b=$('update-install');b.disabled=true;try{await api.installUpdate();}catch(e){$('update-status').textContent=String(e?.message||e);b.disabled=false;}});
  $('update-rollback').addEventListener('click',async()=>{const b=$('update-rollback');b.disabled=true;try{await api.rollbackUpdate();}catch(e){$('update-status').textContent=String(e?.message||e);b.disabled=false;}});
  $('add-root').addEventListener('click', async () => { await api.addRoot(); await refresh(); });
  $('full-access').addEventListener('click', async () => { await api.setFullAccess(!(snapshot?.config?.allowedRoots || []).includes('*')); await refresh(); });
  $('emergency').addEventListener('click', async () => { await api.setEmergencyLock(!snapshot?.emergencyLock); await refresh(); });
  $('controls').addEventListener('click', async () => {
    if(innerWidth<=1050){await window.commanderNavigate?.(document.body.dataset.view==='access'?'chat':'access');return;}
    const collapsed = !Boolean(snapshot?.shellCollapsed);
    try { localStorage.setItem('commander.sidebarCollapsed', collapsed ? '1' : '0'); } catch {}
    await api.setSidebarCollapsed(collapsed);
    await refresh();
  });
  $('reload').addEventListener('click', () => api.reloadChat());
  $('home').addEventListener('click', () => api.goHome());
  $('data-folder').addEventListener('click', () => api.openDataFolder());
  $('devtools').addEventListener('click', () => api.openDevTools());
  $('observe-desktop').addEventListener('click', observeDesktop);
  $('refresh-windows').addEventListener('click', async () => {
    const button = $('refresh-windows');
    button.disabled = true;
    try { await loadWindows(); } catch (error) { $('window-list').innerHTML = `<div class="small error-text">${escapeHtml(error?.message || error)}</div>`; }
    finally { button.disabled = false; }
  });

  $('tool-filter').addEventListener('input', event => renderDirectTools(event.target.value));
  $('direct-tool').addEventListener('change', () => updateDirectToolHelp({ resetArgs: true }));
  $('direct-reset').addEventListener('click', () => updateDirectToolHelp({ resetArgs: true }));
  $('direct-run').addEventListener('click', runDirectTool);
  $('direct-args').addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void runDirectTool(); }
  });

  $('health').addEventListener('click', async () => {
    const button = $('health');
    button.disabled = true;
    $('health-badge').textContent = 'Running…';
    $('health-badge').className = 'badge warn';
    try {
      const result = await api.runHealth();
      $('health-badge').textContent = result.ok ? 'PASS' : 'FAIL';
      $('health-badge').className = `badge ${result.ok ? 'good' : 'bad'}`;
      $('health-detail').textContent = result.ok
        ? `${result.deviceName || 'Local PC'} · ${result.displayCount ?? 0} display(s) · ${result.windowCount ?? 0} windows · ${result.durationMs} ms`
        : result.error || 'Diagnostic failed.';
    } catch (error) {
      $('health-badge').textContent = 'FAIL';
      $('health-badge').className = 'badge bad';
      $('health-detail').textContent = String(error?.message || error);
    } finally { button.disabled = false; }
  });

  api.onEvent(pushEvent);
  let collapsed=false;
  try { collapsed=localStorage.getItem('commander.sidebarCollapsed') === '1'; } catch {}
  void api.setSidebarCollapsed(collapsed).then(refresh).catch(() => refresh());
  void loadDirectTools();
  window.addEventListener('focus',refresh);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh();});
})();
