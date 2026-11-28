'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld('commanderShell', {
  connectRemote: relayUrl => invoke('cc-shell:remote-connect',{relayUrl}),
  disconnectRemote: () => invoke('cc-shell:remote-disconnect'),
  setView: view => invoke('cc-shell:set-view',{view}),
  setOverlayVisible: visible => invoke('cc-shell:overlay-visible',{visible}),
  setPreferences: patch => invoke('cc-shell:set-preferences',patch),
  chatBack: () => invoke('cc-shell:chat-back'),
  revealDownload: id => invoke('cc-shell:reveal-download',{id}),
  exportDiagnostics: () => invoke('cc-shell:export-diagnostics'),
  snapshot: () => invoke('cc-shell:snapshot'),
  setWorkspaceVisible: visible => invoke('cc-shell:workspace-visible',{visible}),
  retryResult: id => invoke('cc-shell:retry-result',{id}),
  setSidebarCollapsed: collapsed => invoke('cc-shell:set-sidebar-collapsed', { collapsed }),
  setLocalMode: mode => invoke('cc-shell:set-local-mode', { mode }),
  armNext: () => invoke('cc-shell:arm-next'),
  testConnection: () => invoke('cc-shell:test-connection'),
  setEmergencyLock: enabled => invoke('cc-shell:set-emergency-lock', { enabled }),
  setOption: (key, value) => invoke('cc-shell:set-option', { key, value }),
  setFullAccess: enabled => invoke('cc-shell:set-full-access', { enabled }),
  addRoot: () => invoke('cc-shell:add-root'),
  removeRoot: root => invoke('cc-shell:remove-root', { root }),
  runHealth: () => invoke('cc-shell:run-health'),
  listTools: () => invoke('cc-shell:list-tools'),
  computerLinkStatus: () => invoke('cc-shell:computer-link-status'),
  computerLinkSessionStatus: () => invoke('cc-shell:computer-link-session'),
  openComputerLink: () => invoke('cc-shell:computer-link-open'),
  stopComputerLink: () => invoke('cc-shell:computer-link-stop'),
  runTool: (name, args = {}) => invoke('cc-shell:run-tool', { name, args }),
  observeDesktop: () => invoke('cc-shell:observe-desktop'),
  listWindows: () => invoke('cc-shell:list-windows'),
  focusWindow: target => invoke('cc-shell:focus-window', target),
  reloadChat: () => invoke('cc-shell:reload-chat'),
  goHome: () => invoke('cc-shell:go-home'),
  openDataFolder: () => invoke('cc-shell:open-data-folder'),
  openDevTools: () => invoke('cc-shell:open-devtools'),
  setStartWithWindows: enabled => invoke('cc-shell:set-start-with-windows', { enabled }),
  checkForUpdates: () => invoke('cc-shell:update-check'),
  downloadUpdate: () => invoke('cc-shell:update-download'),
  installUpdate: () => invoke('cc-shell:update-install'),
  rollbackUpdate: () => invoke('cc-shell:update-rollback'),
  onEvent: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('cc-shell:event', listener);
    return () => ipcRenderer.removeListener('cc-shell:event', listener);
  }
});
