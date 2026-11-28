'use strict';

const { app, BrowserWindow, WebContentsView, ipcMain, Menu, shell, session, dialog, nativeTheme } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { CallLedger } = require('./call-ledger.cjs');
const callLedger = new CallLedger();
const uiState = require('./ui-state.cjs');
let configMutation = Promise.resolve();
let selectedView = 'chat';
let overlayVisible = false;
const downloads = new Map();
let chatExecution = Promise.resolve();
let computerLinkModule;
let computerLinkLoading;
let computerLinkAction = Promise.resolve();
let nativeAccessEpoch = 0;
let nativeAccessRevoking = 0;
let quitCleanup;
let quitReady = false;

const VERSION = '0.25.0';
const CHAT_URL = 'https://chatgpt.com/';
const CHAT_PARTITION = 'persist:constellation-chatgpt';
const SESSION_TTL_MS = 60 * 60 * 1000;
const SHELL_TOP = 56;
const SHELL_WIDTH = 344;
const TEST_MODE = process.env.CONSTELLATION_ELECTRON_SMOKE === '1';
const TEST_OUTPUT = process.env.CONSTELLATION_ELECTRON_SMOKE_OUTPUT || '';
const INTERACTIVE_TEST = TEST_MODE && process.env.CONSTELLATION_ELECTRON_ACCEPTANCE === '1';

let win;
let chatView;
let runtime;
let updateService;
let fallbackBridge;
let remoteAgent;
let remoteConnecting=false;
let remoteEpoch=0;
let remoteState={phase:'disconnected',relayUrl:''};
let emergencyLock = false;
let shellCollapsed = false;
let workspaceVisible = false;
let shellSmokeState = { status: TEST_MODE ? 'pending' : 'not-required', detail: null };
let shellSmokeResolve = null;
const shellSmokeProof = TEST_MODE ? new Promise(resolve => { shellSmokeResolve = resolve; }) : Promise.resolve(shellSmokeState);
let chatState = { phase: 'starting', message: 'Starting ChatGPT…', url: CHAT_URL, lastError: '', pageHookReady: false, loadedAt: '' };
const chatSessions = new Map();

function randomToken(bytes = 24) { return crypto.randomBytes(bytes).toString('base64url'); }
function nowIso() { return new Date().toISOString(); }
function smokeTrace(event, detail = {}) {
  if (!TEST_MODE || !TEST_OUTPUT) return;
  try { fs.appendFileSync(`${TEST_OUTPUT}.trace.log`, `${JSON.stringify({ at: nowIso(), event, detail })}\n`); } catch {}
}
function settleShellSmoke(state) {
  shellSmokeState = state;
  if (shellSmokeResolve) { shellSmokeResolve(state); shellSmokeResolve = null; }
  return state;
}
async function awaitShellSmokeProof(timeoutMs = 15000) {
  if (!TEST_MODE || shellSmokeState.status !== 'pending') return shellSmokeState;
  let timer;
  try {
    await Promise.race([
      shellSmokeProof,
      new Promise(resolve => { timer = setTimeout(resolve, timeoutMs); })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
  return shellSmokeState;
}
function appRoot() { return path.resolve(__dirname, '..'); }
function importEsm(relativePath) { return import(pathToFileURL(path.join(appRoot(), relativePath)).href); }

async function loadComputerLink() {
  if (computerLinkModule) return computerLinkModule;
  if (!computerLinkLoading) computerLinkLoading = importEsm('src/computer-link.mjs').then(module => {
    computerLinkModule = module;
    module.subscribeComputerLink?.(detail => emitShell('computer-link-state', detail));
    return module;
  }).catch(error => { computerLinkLoading = null; throw error; });
  return computerLinkLoading;
}

function queueComputerLinkAction(action) {
  const result = computerLinkAction.then(action);
  computerLinkAction = result.catch(() => {});
  return result;
}

function stopOwnedComputerLink() {
  return queueComputerLinkAction(() => computerLinkModule
    ? computerLinkModule.stopComputerLinkOwner()
    : { stopped: true, alreadyStopped: true });
}

function assertNativeAccess(epoch = nativeAccessEpoch) {
  if (epoch !== nativeAccessEpoch || nativeAccessRevoking || quitCleanup || runtime.state.shuttingDown || emergencyLock || runtime.config.emergencyLock || fs.existsSync(path.join(runtime.dir, 'EMERGENCY-LOCK')))
    throw new Error('Computer access is locked. Unlock it in Constellation controls before opening the native tools.');
  if (runtime.config.localToolMode === 'off' || runtime.config.enableGuiAutomation === false)
    throw new Error('Enable local computer access in Constellation controls before opening the native tools.');
}

async function stopOwnedRuntime() {
  remoteEpoch++;remoteConnecting=false;
  if (runtime) runtime.state.shuttingDown = true;
  if (runtime) for (const job of runtime.state.searches.values()) job.cancelled = true;
  const work = [
    ['remote connection', () => remoteAgent?.stop()],
    ['browser bridge', () => fallbackBridge?.stop?.()],
    ['native computer tools', () => stopOwnedComputerLink()],
  ];
  if (runtime) {
    work.push(['computer-use helper', () => importEsm('src/computer-use.mjs').then(module => module.closeComputerUseHelper())]);
    for (const child of runtime.state.processes.values()) if (child.child) {
      work.push([`process ${child.id}`, () => importEsm('src/process-manager.mjs').then(module => module.stopManagedProcess(child))]);
    }
  }
  const results = await Promise.all(work.map(async ([name, operation]) => {
    let timer;
    try {
      const result = await Promise.race([
        Promise.resolve().then(operation),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Cleanup did not confirm completion within eight seconds.')), 8000); }),
      ]);
      if (result?.stopped === false) throw new Error(result.reason || 'Exit was not confirmed.');
      return { name, ok: true };
    } catch (error) { return { name, ok: false, error: String(error?.message || error) }; }
    finally { clearTimeout(timer); }
  }));
  return { ok: results.every(result => result.ok), results };
}

function safeConfig() {
  if (!runtime?.config) return {};
  return {
    allowedRoots: Array.isArray(runtime.config.allowedRoots) ? [...runtime.config.allowedRoots] : [],
    enableShell: runtime.config.enableShell !== false,
    enableGuiAutomation: runtime.config.enableGuiAutomation !== false,
    localToolMode: ['auto', 'always', 'off'].includes(runtime.config.localToolMode) ? runtime.config.localToolMode : 'auto',
    browserBridgeEnabled: runtime.config.browserBridgeEnabled !== false,
    deviceName: runtime.config.deviceName || os.hostname()
  };
}

function emitShell(type, detail = {}) {
  if (!win || win.isDestroyed()) return;
  try { win.webContents.send('cc-shell:event', { type, at: nowIso(), detail }); } catch {}
}

function setChatState(patch) {
  chatState = { ...chatState, ...patch };
  emitShell('chat-state', chatState);
}

async function recentCalls(max = 30) {
  const {tailJsonl}=await importEsm('src/indexed-jsonl.mjs');
  return tailJsonl(runtime.state.callsPath,max);
}

async function usageStats() {
  try { return JSON.parse(await fs.promises.readFile(runtime.state.statsPath, 'utf8')); }
  catch { return { totalCalls: 0, byTool: {}, errors: 0 }; }
}

async function shellSnapshot() {
  return {
    ok: true,
    product: 'Project Constellation',
    version: VERSION,
    chat: { ...chatState },
    emergencyLock,
    shellCollapsed,
    ui: { view: selectedView, ...uiState.preferences(runtime.config.uiPreferences) },
    platform: process.platform,
    remote: {...remoteState},
    downloads: [...downloads.values()].map(({path,...safe})=>safe),
    singleInstanceOwner: app.hasSingleInstanceLock(),
    startWithWindows: app.isPackaged ? app.getLoginItemSettings().openAtLogin : false,
    config: safeConfig(),
    toolCount: toolManifest().length,
    pendingResults: pendingResults(),
    tasks: runtime.state.tasks ? await runtime.state.tasks.list() : [],
    auditError: runtime.state.auditError || null,
    recentCalls: await recentCalls(30),
    stats: await usageStats(),
    update: updateService ? updateService.snapshot() : {phase:'unavailable',currentVersion:VERSION}
  };
}

async function persistConfigChange(key, value) {
  const update = configMutation.catch(()=>{}).then(async()=>{
    const actual=typeof value==='function'?value(runtime.config[key]):value;
    const next = {...runtime.config,[key]:actual};
    await runtime.saveConfig(runtime.configPath,next);
    Object.assign(runtime.config,next);
    emitShell('config-changed',{key,value:actual,config:safeConfig()});
    if(chatView && !chatView.webContents.isDestroyed())chatView.webContents.send('cc:config-changed',safeConfig());
    return actual;
  });
  configMutation = update;
  return update;
}
function applyAppearance() {
  const pref=uiState.preferences(runtime.config.uiPreferences);
  if(nativeTheme)nativeTheme.themeSource=pref.theme;
  win?.setAlwaysOnTop?.(pref.alwaysOnTop);
  chatView?.webContents.setZoomFactor?.(pref.chatZoom);
  return pref;
}
function selectView(view) {
  selectedView=uiState.viewName(view);
  workspaceVisible=selectedView!=='chat';
  chatView?.setVisible(!workspaceVisible && !overlayVisible);
  if(!workspaceVisible && !overlayVisible)chatView?.webContents.focus?.();
  emitShell('view-changed',{view:selectedView});
  return {ok:true,view:selectedView};
}

async function createRuntime() {
  const [{ loadConfig, saveConfig }, { createRuntimeState }, { createToolHandler }, { toolDefinitions }] = await Promise.all([
    importEsm('src/config.mjs'), importEsm('src/state.mjs'), importEsm('src/tools.mjs'), importEsm('src/tool-definitions.mjs')
  ]);
  const loaded = await loadConfig();
  const state = createRuntimeState(loaded.dir);
  state.onTaskChange=detail=>emitShell('task-progress',detail);
  const { recoverProcesses } = await importEsm('src/process-manager.mjs');
  await recoverProcesses(state);
  const callTool = createToolHandler({
    config: loaded.config,
    configPath: loaded.configPath,
    state,
    onShutdown: () => app.quit()
  });
  return { ...loaded, state, callTool, toolDefinitions, saveConfig };
}

function toolManifest() {
  return runtime.toolDefinitions()
    .filter(tool => !['list_devices', 'who_am_i', 'shutdown'].includes(tool.name))
    .map(tool => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema || { type: 'object', properties: {} } }));
}

function getOrCreateSession(chatId, url, renew = false) {
  const key = String(chatId || url || 'chat');
  const existing = chatSessions.get(key);
  if (!renew && existing && existing.expiresAt > Date.now() + 30000) return existing;
  const item = { nonce: randomToken(24), expiresAt: Date.now() + SESSION_TTL_MS, url: String(url || ''), chatId: key };
  chatSessions.set(key, item);
  return item;
}

function normalizeCall(input, sessionItem) {
  const raw = input && typeof input === 'object' ? input : {};
  const id = String(raw.id || `electron_${randomToken(12)}`);
  const tool = String(raw.tool || raw.name || '').trim();
  const args = raw.args && typeof raw.args === 'object' ? raw.args : raw.arguments && typeof raw.arguments === 'object' ? raw.arguments : raw.input && typeof raw.input === 'object' ? raw.input : {};
  const nonce = String(raw.nonce || '');
  return { id, tool, args, nonce };
}

async function executeShellTool(tool, args = {}, context = {}) {
  if (quitCleanup || runtime.state.shuttingDown) throw new Error('Project Constellation is stopping its owned work.');
  const id = `shell_${randomToken(10)}`;
  const started = Date.now();
  emitShell('tool-start', { id, tool, args: Object.keys(args || {}), source: 'shell' });
  try {
    const result = await runtime.callTool(tool, args, { ...context, canContinue: async () => {
      if (quitCleanup || runtime.state.shuttingDown) throw new Error('Application shutdown requested; task paused.');
      await context.canContinue?.();
    } });
    emitShell('tool-finish', { id, tool, durationMs: Date.now() - started, source: 'shell' });
    return result;
  } catch (error) {
    emitShell('tool-error', { id, tool, durationMs: Date.now() - started, error: String(error?.message || error), source: 'shell' });
    throw error;
  }
}

async function executeChatCall(chatId, rawCall) {
  const item=chatSessions.get(String(chatId||''));
  const call=normalizeCall(rawCall,item);
  if(runtime.config.localToolMode==='off')throw new Error('Local tools are Off.');
  if(runtime.config.emergencyLock||emergencyLock||quitCleanup||runtime.state.shuttingDown)throw new Error('Emergency Lock or application shutdown is active.');
  if(call.tool==='set_config_value')throw new Error('Change permissions in the Project Constellation controls, not through chat.');
  return callLedger.execute(item,call,()=>{
    const run=chatExecution.catch(()=>{}).then(()=>executeAuthorizedChatCall(chatId,call));
    chatExecution=run;return run;
  });
}

async function executeAuthorizedChatCall(chatId, rawCall) {
  const item = chatSessions.get(String(chatId || ''));
  if (!item || item.expiresAt <= Date.now()) throw new Error('Project Constellation chat session expired; retry the request.');
  const call = normalizeCall(rawCall, item);
  if (!call.tool) throw new Error('Project Constellation call did not specify a tool.');
  if (call.nonce !== item.nonce) throw new Error('Project Constellation call nonce is stale.');
  if(runtime.config.localToolMode==='off'||emergencyLock||quitCleanup||runtime.state.shuttingDown)throw new Error('Local execution was stopped.');
  const allowed = new Set(toolManifest().map(x => x.name));
  if (!allowed.has(call.tool)) throw new Error(`Project Constellation tool is not available: ${call.tool}`);
  const started = Date.now();
  emitShell('tool-start', { id: call.id, tool: call.tool, args: Object.keys(call.args || {}) });
  try {
    const result = await runtime.callTool(call.tool, call.args, {owner:`chat:${chatId}`,canContinue:()=>{
      if(runtime.config.localToolMode==='off'||emergencyLock||quitCleanup||runtime.state.shuttingDown||item.expiresAt<=Date.now())throw new Error('Chat access was stopped or authorization changed. Task paused.');
    }});
    const attachments = Array.isArray(result?._attachments) ? result._attachments : [];
    let safeResult = result;
    if (safeResult && typeof safeResult === 'object') {
      safeResult = { ...safeResult };
      delete safeResult._attachments;
    }
    emitShell('tool-finish', { id: call.id, tool: call.tool, durationMs: Date.now() - started });
    return { ok: true, id: call.id, tool: call.tool, result: safeResult, _attachments: attachments };
  } catch (error) {
    emitShell('tool-error', { id: call.id, tool: call.tool, durationMs: Date.now() - started, error: String(error?.message || error) });
    throw error;
  }
}

async function setEmergencyLock(value) {
  const enabled = Boolean(value);
  emergencyLock = enabled;
  runtime.config.emergencyLock = enabled;
  if (enabled) { nativeAccessEpoch++; nativeAccessRevoking++; }
  let persistenceError;
  try {
    try { await persistConfigChange('emergencyLock', enabled); }
    catch (error) { persistenceError = error; }
    const lockPath = path.join(runtime.dir, 'EMERGENCY-LOCK');
    if (enabled) {
      remoteEpoch++;remoteConnecting=false;remoteAgent?.stop();remoteAgent=null;
      try { fs.writeFileSync(lockPath, 'locked\n'); } catch (error) { persistenceError ||= error; }
      const { stopManagedProcess } = await importEsm('src/process-manager.mjs');
      const results = await Promise.allSettled([...runtime.state.processes.values()].map(p=>stopManagedProcess(p)));
      for(const job of runtime.state.searches.values())job.cancelled=true;
      const { closeComputerUseHelper } = await importEsm('src/computer-use.mjs');
      const helper = await closeComputerUseHelper();
      const native = await stopOwnedComputerLink();
      const errors = results.filter(result=>result.status==='rejected').map(result=>String(result.reason?.message||result.reason));
      if(helper?.stopped===false)errors.push(helper.reason);
      if(native?.stopped===false)errors.push(native.reason);
      if(errors.length)emitShell('owned-work-stop-error',{errors});
      if(chatView && !chatView.webContents.isDestroyed())chatView.webContents.send('cc:disarm');
    } else {
      try { fs.unlinkSync(lockPath); }
      catch (error) { if(error.code!=='ENOENT') { emergencyLock=true;runtime.config.emergencyLock=true;persistenceError ||= error; } }
    }
    emitShell('emergency-lock', { enabled: emergencyLock });
    if (persistenceError) throw new Error(`Computer access ${emergencyLock ? 'is locked for this session' : 'was unlocked for this session'}, but settings could not be saved: ${persistenceError.message}`);
    return emergencyLock;
  } finally { if(enabled)nativeAccessRevoking--; }
}

function migrateLegacyInstall() {
  if (process.platform !== 'win32') return;
  const local = process.env.LOCALAPPDATA || '';
  if (!local) return;
  const legacyExe = path.join(local, 'ConstellationCommander', 'ConstellationCommander.exe');
  try {
    if (fs.existsSync(legacyExe) && path.resolve(legacyExe).toLowerCase() !== path.resolve(process.execPath).toLowerCase()) {
      const { spawn } = require('node:child_process');
      spawn('reg.exe', ['delete', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', 'ConstellationCommander', '/f'], { windowsHide: true, stdio: 'ignore' }).unref();
      const escaped = legacyExe.replaceAll("'", "''");
      const script = `Get-CimInstance Win32_Process -Filter \"Name='ConstellationCommander.exe'\" | Where-Object { $_.ExecutablePath -eq '${escaped}' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
      spawn('powershell.exe', ['-NoProfile','-NonInteractive','-Command', script], { windowsHide: true, stdio: 'ignore' }).unref();
    }
  } catch {}
}

function setStartWithWindows(enabled) {
  if (!app.isPackaged || TEST_MODE) return false;
  app.setLoginItemSettings({ openAtLogin: Boolean(enabled), path: process.execPath, args: [] });
  return app.getLoginItemSettings().openAtLogin;
}

async function startFallbackBridge() {
  if (runtime?.config?.browserBridgeEnabled === false) return;
  try {
    const { createBrowserBridge } = await importEsm('src/browser-bridge.mjs');
    fallbackBridge = await createBrowserBridge();
    await fallbackBridge.start();
  } catch (error) {
    console.warn('[Commander] fallback browser bridge unavailable:', error?.message || error);
  }
}

function chromeUserAgent() {
  const chrome = process.versions.chrome || '152.0.0.0';
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`;
}

function trustedNavigation(url) {
  if (TEST_MODE && String(url || '') === pathToFileURL(path.join(__dirname,'fixture-chat.html')).href) return true;
  try {
    const parsed = new URL(url);
    if(parsed.protocol!=='https:')return false;
    const host = parsed.hostname.toLowerCase();
    return host === 'chatgpt.com' || host.endsWith('.chatgpt.com') || host === 'openai.com' || host.endsWith('.openai.com') || host.endsWith('.auth0.com') || host === 'accounts.google.com' || host === 'login.microsoftonline.com' || host.endsWith('.microsoftonline.com') || host === 'appleid.apple.com';
  } catch { return false; }
}

function injectPageHook() {
  if (!chatView || chatView.webContents.isDestroyed()) return;
  try {
    const source = fs.readFileSync(path.join(appRoot(), 'browser-companion', 'page-hook.js'), 'utf8');
    void chatView.webContents.executeJavaScript(source, true).catch(error => console.warn('[Commander] page hook injection failed:', error?.message || error));
  } catch (error) {
    console.warn('[Commander] page hook read failed:', error?.message || error);
  }
}

function createApplicationMenu() {
  const template = [
    { label: 'Commander', submenu: [
      { label: 'Full Control Test', accelerator: 'Ctrl+Alt+T', click: async () => {
        try {
          const result = await runtime.callTool('computer_observe', { max_width: 900, max_height: 700, window_limit: 20 });
          console.log('[Commander] Full Control Test PASS', JSON.stringify({ displays: result?.displays?.length, windows: result?.windows?.length }));
        } catch (error) { console.error('[Commander] Full Control Test FAIL', error); }
      }},
      { label: 'Emergency Lock', type: 'checkbox', checked: emergencyLock, click: item => { void setEmergencyLock(item.checked); } },
      { label: 'Start with Windows', type: 'checkbox', checked: app.isPackaged ? app.getLoginItemSettings().openAtLogin : false, click: item => { setStartWithWindows(item.checked); } },
      { type: 'separator' },
      { label: 'Open Project Constellation Data Folder', click: () => shell.openPath(runtime.dir) },
      { label: 'Reload ChatGPT', accelerator: 'Ctrl+R', click: () => chatView?.webContents.reload() },
      { label: 'ChatGPT DevTools', accelerator: 'Ctrl+Shift+I', click: () => chatView?.webContents.openDevTools({ mode: 'detach' }) },
      { type: 'separator' },
      { role: 'quit' }
    ]},
    { role: 'editMenu' },
    { label: 'Workspace', submenu: [
      {label:'ChatGPT',accelerator:'Ctrl+Shift+H',click:()=>emitShell('navigate',{view:'chat'})},
      {label:'Files',accelerator:'Ctrl+Shift+E',click:()=>emitShell('navigate',{view:'workspace'})},
      {label:'Terminal',accelerator:'Ctrl+Shift+T',click:()=>emitShell('navigate',{view:'terminal'})},
      {label:'Settings',accelerator:'Ctrl+,',click:()=>emitShell('navigate',{view:'settings'})},
      {label:'Quick actions',accelerator:'Ctrl+Shift+P',click:()=>emitShell('open-palette',{})}
    ]},
    { label: 'Navigation', submenu: [
      { label: 'Back', accelerator: 'Alt+Left', click: () => chatView?.webContents.navigationHistory?.canGoBack() && chatView.webContents.navigationHistory.goBack() },
      { label: 'Forward', accelerator: 'Alt+Right', click: () => chatView?.webContents.navigationHistory?.canGoForward() && chatView.webContents.navigationHistory.goForward() },
      { label: 'Home', accelerator: 'Ctrl+Alt+H', click: () => chatView?.webContents.loadURL(CHAT_URL) }
    ]}
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function layoutChatView() {
  if(!win || !chatView)return;
  const [width,height]=win.getContentSize();
  chatView.setBounds(uiState.layout(width,height,shellCollapsed));
}

function createChatWindow() {
  const preload = path.join(__dirname, 'chat-preload.cjs');
  win = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 900,
    minHeight: 650,
    title: `Project Constellation ${VERSION} — ChatGPT`,
    backgroundColor: '#212121',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'shell-preload.cjs')
    }
  });
  win.webContents.once('did-finish-load', () => {
    smokeTrace('shell-did-finish-load', { url: win.webContents.getURL() });
    if (!TEST_MODE) return;
    void win.webContents.executeJavaScript(`(async () => {
      const required = ['local-mode','root-list','emergency','activity','health','observe-desktop','window-list','direct-tool','direct-args','direct-run','direct-result'];
      const missing = required.filter(id => !document.getElementById(id));
      const api = window.commanderShell;
      if (!api || typeof api.snapshot !== 'function' || typeof api.runHealth !== 'function' || typeof api.observeDesktop !== 'function' || typeof api.listTools !== 'function' || typeof api.runTool !== 'function') {
        return { ok:false, reason:'shell-bridge-missing', missing, hasApi:Boolean(api) };
      }
      const snapshot = await api.snapshot();
      const tools = await api.listTools();
      const directPing = await api.runTool('ping', {});
      const health = await api.runHealth();
      const nativeRequired = ${JSON.stringify(process.env.CONSTELLATION_REQUIRE_NATIVE_TOOLS === '1')};
      let nativeTools = { required:nativeRequired };
      if (nativeRequired) {
        const status = await api.computerLinkStatus();
        const session = await api.computerLinkSessionStatus();
        const toolResult = await api.runTool('get_computer_link_status', {});
        nativeTools = { required:true, ok:status?.owner?.available === true && status?.owner?.running === false && session?.verified === true && toolResult?.ok === true && toolResult?.result?.mcp?.available === true, ownerRunning:status?.owner?.running, protocolVersion:session?.protocolVersion, status:session?.status, command:status?.mcp?.command };
      }
      return { ok: missing.length === 0 && snapshot?.ok === true && snapshot?.singleInstanceOwner === true && health?.ok === true && tools?.ok === true && tools?.tools?.length === snapshot?.toolCount && directPing?.ok === true && directPing?.result?.pong === true && (!nativeRequired || nativeTools.ok), missing, version:snapshot?.version, toolCount:snapshot?.toolCount, listedToolCount:tools?.tools?.length || 0, directPing:directPing?.result || null, localToolMode:snapshot?.config?.localToolMode, singleInstanceOwner:snapshot?.singleInstanceOwner === true, health, nativeTools };
    })()`, true).then(result => {
      settleShellSmoke({ status: result?.ok ? 'passed' : 'failed', detail: result || null });
      smokeTrace('shell-runtime-proof', shellSmokeState);
      if (!result?.ok && TEST_OUTPUT) {
        fs.writeFileSync(TEST_OUTPUT, JSON.stringify({ ok:false, event:'shell-runtime-failed', detail:result || null, at:nowIso() }, null, 2));
        setTimeout(() => app.quit(), 250);
      }
    }).catch(error => {
      settleShellSmoke({ status:'failed', detail:{ error:String(error?.stack || error) } });
      smokeTrace('shell-runtime-proof-error', shellSmokeState.detail);
      if (TEST_OUTPUT) {
        fs.writeFileSync(TEST_OUTPUT, JSON.stringify({ ok:false, event:'shell-runtime-failed', detail:shellSmokeState.detail, at:nowIso() }, null, 2));
        setTimeout(() => app.quit(), 250);
      }
    });
  });
  void win.loadFile(path.join(__dirname, 'shell.html'));

  // The BrowserWindow is only the native container. ChatGPT lives in a dedicated
  // WebContentsView so its session and preload are fully owned by Commander.
  chatView = new WebContentsView({
    webPreferences: {
      preload,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      partition: CHAT_PARTITION,
      spellcheck: true
    }
  });
  win.contentView.addChildView(chatView);
  applyAppearance();
  layoutChatView();
  win.on('resize', layoutChatView);
  win.on('closed', () => { win = null; chatView = null; });

  const wc = chatView.webContents;
  wc.setUserAgent(chromeUserAgent());
  const emitRouteChanged = (_event, url) => {
    const next = String(url || wc.getURL() || '');
    if (!next) return;
    try { wc.send('cc:route-changed', { url:next, at:nowIso() }); } catch (_) {}
  };
  wc.on('did-navigate', emitRouteChanged);
  wc.on('did-navigate-in-page', emitRouteChanged);
  wc.on('did-start-loading', () => setChatState({ phase: 'loading', message: 'Loading ChatGPT…', url: wc.getURL() || CHAT_URL, lastError: '', pageHookReady: false }));
  wc.on('dom-ready', injectPageHook);
  wc.on('did-fail-load', (_event, code, desc, url, isMainFrame) => { if(code===-3||isMainFrame===false)return; console.warn('[Commander] ChatGPT load failed', code, desc, url); setChatState({ phase: 'error', message: 'ChatGPT failed to load', url, lastError: `${code}: ${desc}`, pageHookReady: false }); });
  wc.on('render-process-gone', (_event, details) => { console.warn('[Commander] ChatGPT renderer exited', details.reason); setChatState({ phase: 'error', message: 'ChatGPT renderer stopped', lastError: details.reason, pageHookReady: false }); });
  wc.setWindowOpenHandler(details => {
    if (!trustedNavigation(details.url)) {
      if(/^https?:/i.test(details.url))void shell.openExternal(details.url);
      return { action: 'deny' };
    }
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        width: 920,
        height: 820,
        parent: win,
        modal: false,
        webPreferences: { partition: CHAT_PARTITION, nodeIntegration: false, contextIsolation: true, sandbox: true }
      }
    };
  });
  wc.on('will-navigate', (event, url) => {
    if (!trustedNavigation(url)) { event.preventDefault(); if(/^https?:/i.test(url))void shell.openExternal(url); }
  });

  const target = TEST_MODE ? `file://${path.join(__dirname, 'fixture-chat.html').replaceAll('\\', '/')}` : CHAT_URL;
  wc.on('did-finish-load', () => {
    smokeTrace('did-finish-load', { url: wc.getURL() });
    injectPageHook();
    setChatState({ phase: 'ready', message: 'ChatGPT page loaded', url: wc.getURL(), loadedAt: nowIso(), lastError: '' });
    applyAppearance();
    if (!win.isVisible()) win.show();
    if (TEST_MODE && !INTERACTIVE_TEST) {
      setTimeout(() => {
        void wc.executeJavaScript(`(() => {
          const composer = document.getElementById('prompt-textarea') || document.querySelector('[contenteditable="true"][role="textbox"]');
          if (!composer) return { ok: false, reason: 'fixture-composer-missing', url: location.href, readyState: document.readyState };
          composer.focus();
          const rect = composer.getBoundingClientRect();
          return { ok: true, url: location.href, readyState: document.readyState, active: document.activeElement === composer, width: rect.width, height: rect.height, text: composer.innerText || composer.textContent || '' };
        })()`, true).then(result => {
          smokeTrace('fixture-focus-result', result || null);
          if (!result?.ok) {
            if (TEST_OUTPUT) fs.writeFileSync(TEST_OUTPUT, JSON.stringify({ ok: false, event: 'smoke-start-failed', detail: result || null, at: nowIso() }, null, 2));
            setTimeout(() => app.quit(), 250);
            return;
          }
          wc.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
          wc.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
          smokeTrace('native-enter-sent', { url: wc.getURL() });
        }).catch(error => {
          smokeTrace('fixture-focus-error', { error: String(error?.stack || error) });
          if (TEST_OUTPUT) {
            fs.writeFileSync(TEST_OUTPUT, JSON.stringify({ ok: false, event: 'smoke-start-failed', detail: { error: String(error?.stack || error) }, at: nowIso() }, null, 2));
            setTimeout(() => app.quit(), 250);
          }
        });
      }, 700);
    }
  });
  void wc.loadURL(target).catch(error=>setChatState({phase:'error',message:'ChatGPT unavailable - local workspace still works',lastError:String(error.message)}));
  win.once('ready-to-show', () => { if (!win.isVisible()) win.show(); });
}

function requireChatSender(event) {
  const wc=chatView?.webContents;
  if(!wc||event.sender!==wc||event.senderFrame!==wc.mainFrame)throw new Error('Untrusted Project Constellation frame.');
  const url=event.senderFrame.url;
  const fixture=TEST_MODE&&sameConversation(url,pathToFileURL(path.join(__dirname,'fixture-chat.html')).href);
  if(!fixture && !/^https:\/\/chatgpt\.com(?:\/|$)/i.test(url))throw new Error('Local tools are available only on the ChatGPT origin.');
}
function sameConversation(first, second) {
  try {
    const identity = raw => {
      const u = new URL(raw), match=u.pathname.match(/\/c\/([^/]+)/);
      return u.protocol+'//'+u.host+(match?'/c/'+match[1]:u.pathname.replace(/\/$/,''));
    };
    return identity(first)===identity(second);
  } catch {return false;}
}

function resultPath(id) { return path.join(runtime.dir,'pending-results',crypto.createHash('sha256').update(String(id)).digest('hex')+'.json'); }
function pendingResults() {
  const dir=path.join(runtime.dir,'pending-results');
  try{return fs.readdirSync(dir).filter(n=>n.endsWith('.json')).flatMap(n=>{try{const p=JSON.parse(fs.readFileSync(path.join(dir,n),'utf8'));return [{id:p.id,tool:p.tool,url:p.url,at:p.at}];}catch{return [];}});}catch{return [];}
}
function installIpc() {
  ipcMain.handle('cc:save-result',async(event,pending={})=>{
    requireChatSender(event);
    if(typeof pending.id!=='string'||typeof pending.payload!=='string'||typeof pending.url!=='string')throw new Error('Invalid pending result');
    const p=resultPath(pending.id);fs.mkdirSync(path.dirname(p),{recursive:true});
    const {atomicWrite}=await importEsm('src/file-operations.mjs');
    await atomicWrite(p,JSON.stringify({...pending,at:nowIso()}));emitShell('outbox-changed',{});return {ok:true};
  });
  ipcMain.handle('cc:ack-result',(event,payload={})=>{requireChatSender(event);try{fs.unlinkSync(resultPath(payload.id));}catch{}emitShell('outbox-changed',{});return {ok:true};});

  ipcMain.handle('cc:bootstrap', async (event, payload = {}) => {
    requireChatSender(event);
    smokeTrace('ipc-bootstrap', { chatId: String(payload.chatId || ''), url: String(payload.url || '') });
    const item = getOrCreateSession(payload.chatId, payload.url, payload.renew === true);
    return {
      ok: true,
      product: 'Project Constellation',
      version: VERSION,
      source: 'electron-integrated-workspace',
      nonce: item.nonce,
      expiresAt: new Date(item.expiresAt).toISOString(),
      tools: toolManifest().filter(tool=>tool.name!=='set_config_value'),
      contract: 'For local-PC work, use Project Constellation directly. Emit exactly one complete [PC_BUDDY_CALL]{"id":"fresh-unique-id","nonce":"the supplied nonce","tool":"tool_name","args":{}}[/PC_BUDDY_CALL] as the whole assistant response using this nonce and one available tool. Include both opening and closing markers; never claim an action before its real result. After its hidden tool-result turn, continue the task and call the next tool when needed. Preferred shape: {"id":"fresh-id","nonce":"...","tool":"tool_name","args":{...}}. For multi-step work prefer run_task with an explicit step plan, stable step IDs and prior-result references; then use get_task to read progress. Set wait_for_exit on commands that must finish before the next step. Inspect failures before retrying; never retry an uncertain side effect automatically. Do not tell the user to run local commands manually when a listed Project Constellation tool can perform the action.'
    };
  });

  ipcMain.handle('cc:call', async (event, payload = {}) => {
    requireChatSender(event);
    smokeTrace('ipc-call', { chatId: String(payload.chatId || ''), tool: String(payload.call?.tool || payload.call?.name || '') });
    try {
      const result = await executeChatCall(payload.chatId, payload.call);
      smokeTrace('ipc-call-result', { ok: result?.ok !== false, tool: String(result?.tool || '') });
      return result;
    } catch (error) {
      smokeTrace('ipc-call-error', { error: String(error?.message || error) });
      return { ok: false, error: String(error?.message || error) };
    }
  });

  ipcMain.handle('cc:status', async event => {
    requireChatSender(event);
    return { ok: true, product: 'Project Constellation', version: VERSION, mode: 'integrated-electron-chatgpt', emergencyLock, computerUseSupported: process.platform === 'win32', guiAutomationEnabled: runtime.config.enableGuiAutomation !== false, shellEnabled: runtime.config.enableShell !== false, localToolMode: runtime.config.localToolMode || 'auto', allowedRoots: runtime.config.allowedRoots || [], quotaEnforced: false };
  });

  ipcMain.handle('cc:diagnostic', async (_event, payload = {}) => {
    requireChatSender(_event);
    smokeTrace(`renderer:${String(payload.event || 'diagnostic')}`, payload.detail || {});
    emitShell('chat-diagnostic', { event: String(payload.event || 'diagnostic'), detail: payload.detail || {} });
    if (payload.event === 'page-hook-ready') setChatState({ pageHookReady: payload.detail?.receipts===true, phase: 'adapter-ready', message: 'ChatGPT adapter loaded - Test chat access to verify', lastError:'' });
    if (payload.event === 'arm-start') setChatState({phase:'arming',message:'Preparing computer access for this request',lastError:''});
    if (payload.event === 'request-accepted') setChatState({phase:'waiting-tool',message:'Request accepted - waiting for ChatGPT',lastError:''});
    if (payload.event === 'assistant-call-detected') setChatState({phase:'executing',message:'Running '+String(payload.detail?.tool||'local tool'),lastError:''});
    if (['tool-result-sent','saved-result-delivered'].includes(payload.event)) setChatState({phase:'verified',message:'Computer action completed and result accepted by ChatGPT',lastError:''});
    if (['delivery-pending','result-save-failed'].includes(payload.event)) setChatState({phase:'delivery-pending',message:'Action completed - result needs attention in Activity',lastError:String(payload.detail?.error||'')});
    if (payload.event === 'arm-failed') setChatState({ phase: 'error', message: 'Project Constellation arm failed', lastError: String(payload.detail?.error || 'Unknown arm failure') });
    if (TEST_MODE && TEST_OUTPUT && !INTERACTIVE_TEST) {
      if (payload.event === 'tool-result-sent') {
        await awaitShellSmokeProof();
        if (shellSmokeState.status !== 'passed') {
          fs.writeFileSync(TEST_OUTPUT, JSON.stringify({ ok: false, event: 'shell-runtime-not-proven', detail: shellSmokeState, at: nowIso() }, null, 2));
        } else {
          fs.writeFileSync(TEST_OUTPUT, JSON.stringify({ ok: true, event: payload.event, detail: { ...(payload.detail || {}), shellRuntime: shellSmokeState.detail }, at: nowIso() }, null, 2));
        }
        setTimeout(() => app.quit(), 250);
      } else if (['arm-failed', 'tool-failed', 'smoke-start-failed'].includes(payload.event)) {
        fs.writeFileSync(TEST_OUTPUT, JSON.stringify({ ok: false, event: payload.event, detail: payload.detail || null, at: nowIso() }, null, 2));
        setTimeout(() => app.quit(), 250);
      }
    }
    return { ok: true };
  });
}

function installShellIpc() {
  const trusted = event => event.sender === win?.webContents && event.senderFrame === win?.webContents.mainFrame && event.senderFrame.url === pathToFileURL(path.join(__dirname,'shell.html')).href;
  const requireTrusted = event => { if (!trusted(event)) throw new Error('Untrusted Project Constellation shell caller.'); };

  ipcMain.handle('cc-shell:remote-connect',async(event,payload={})=>{
    requireTrusted(event);
    if(emergencyLock)throw new Error('Unlock computer access before connecting.');
    if(remoteAgent||remoteConnecting)throw new Error('Disconnect the current relay before connecting again.');
    const epoch=++remoteEpoch;
    remoteConnecting=true;
    const relayUrl=String(payload.relayUrl||'').trim();
    try {
      const {createRemoteDeviceAgent}=await importEsm('src/remote-device.mjs');
      const active=await createRemoteDeviceAgent({runtime,relayUrl,args:{},
        persistRemote:async config=>{
          if(epoch!==remoteEpoch)throw new Error('Connection canceled.');
          await persistConfigChange('remoteRelayUrl',config.remoteRelayUrl);
          await persistConfigChange('remoteDeviceId',config.remoteDeviceId);
          await persistConfigChange('remoteDeviceToken',config.remoteDeviceToken);
        },
        callTool:async(name,args)=>{
          if(emergencyLock||epoch!==remoteEpoch)throw new Error('Computer access is locked or disconnected.');
          return executeShellTool(name,args,{owner:`remote:${relayUrl}`,canContinue:()=>{if(emergencyLock||epoch!==remoteEpoch)throw new Error('Remote connection closed; task paused.');}});
        },
        onState:state=>{if(epoch===remoteEpoch){remoteState={...state,relayUrl};emitShell('remote-state',remoteState);}},
        openVerification:async url=>{
          if(epoch!==remoteEpoch)throw new Error('Connection canceled.');
          const popup=new BrowserWindow({width:760,height:800,parent:win,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
          popup.webContents.setWindowOpenHandler(()=>({action:'deny'}));
          popup.webContents.on('will-navigate',(e,next)=>{try{if(new URL(next).origin!==new URL(url).origin)e.preventDefault();}catch{e.preventDefault();}});
          await popup.loadURL(url);
        }
      });
      if(epoch!==remoteEpoch||emergencyLock){active.stop();return {ok:true,canceled:true};}
      remoteAgent=active;
      void active.run().catch(error=>{
        if(active.stopped||epoch!==remoteEpoch)return;
        remoteState={phase:'error',relayUrl,error:String(error.message)};
        emitShell('remote-state',remoteState);
        if(remoteAgent===active)remoteAgent=null;
      });
      return {ok:true};
    } finally { if(epoch===remoteEpoch)remoteConnecting=false; }
  });
  ipcMain.handle('cc-shell:remote-disconnect',event=>{
    requireTrusted(event);remoteEpoch++;remoteConnecting=false;remoteAgent?.stop();remoteAgent=null;
    remoteState={phase:'disconnected',relayUrl:''};emitShell('remote-state',remoteState);return {ok:true};
  });
  ipcMain.handle('cc-shell:set-view',(event,payload={})=>{requireTrusted(event);return selectView(String(payload.view));});
  ipcMain.handle('cc-shell:overlay-visible',(event,payload={})=>{requireTrusted(event);overlayVisible=payload.visible===true;chatView?.setVisible(!workspaceVisible&&!overlayVisible);return {ok:true};});
  ipcMain.handle('cc-shell:set-preferences',async(event,payload={})=>{
    requireTrusted(event);
    await persistConfigChange('uiPreferences',current=>uiState.patchPreferences(current,payload));
    return {ok:true,preferences:applyAppearance()};
  });
  ipcMain.handle('cc-shell:chat-back',event=>{requireTrusted(event);const nav=chatView?.webContents.navigationHistory;if(nav?.canGoBack())nav.goBack();return {ok:true};});
  ipcMain.handle('cc-shell:reveal-download',(event,payload={})=>{requireTrusted(event);const d=downloads.get(String(payload.id));if(!d||d.state!=='completed'||!d.path)throw new Error('This download is not complete.');shell.showItemInFolder(d.path);return {ok:true};});
  ipcMain.handle('cc-shell:export-diagnostics',async event=>{
    requireTrusted(event);
    const picked=await dialog.showSaveDialog(win,{title:'Export Project Constellation diagnostics',defaultPath:'Project-Constellation-diagnostics.json',filters:[{name:'JSON',extensions:['json']}]});
    if(picked.canceled||!picked.filePath)return {ok:true,canceled:true};
    const report={version:VERSION,platform:process.platform,at:nowIso(),ui:uiState.preferences(runtime.config.uiPreferences),chat:{phase:chatState.phase,pageHookReady:chatState.pageHookReady},emergencyLock,toolCount:toolManifest().length,stats:await usageStats(),verification:'Local diagnostic snapshot, not authenticated ChatGPT acceptance'};
    await fs.promises.writeFile(picked.filePath,JSON.stringify(report,null,2),{mode:0o600});
    return {ok:true};
  });
  ipcMain.handle('cc-shell:retry-result',(event,payload={})=>{
    requireTrusted(event);const pending=JSON.parse(fs.readFileSync(resultPath(payload.id),'utf8'));
    if(!sameConversation(chatView?.webContents.getURL(),pending.url))throw new Error('Open the original conversation before retrying delivery.');
    chatView.webContents.send('cc:deliver-pending',pending);return {ok:true};
  });
  ipcMain.handle('cc-shell:workspace-visible',(event,payload={})=>{requireTrusted(event);selectView(payload.visible?'workspace':'chat');return {ok:true,visible:workspaceVisible};});
  ipcMain.handle('cc-shell:update-check', async event => {
    requireTrusted(event);
    const state=await updateService.check(); emitShell('update-state',state); return {ok:true,update:state};
  });
  ipcMain.handle('cc-shell:update-download', async event => {
    requireTrusted(event);
    const state=await updateService.stage(); emitShell('update-state',state); return {ok:true,update:state};
  });
  ipcMain.handle('cc-shell:update-install', async event => {
    requireTrusted(event);
    if(process.platform!=='win32'||!app.isPackaged)throw new Error('Install is available from the packaged Windows build.');
    const state=await updateService.markInstalling();
    const script=path.join(process.resourcesPath,'app.asar.unpacked','scripts','apply-update.ps1');
    if(!fs.existsSync(script))throw new Error('Packaged updater script is missing.');
    const {spawn}=require('node:child_process');
    const installDir=path.dirname(process.execPath); const exeName=path.basename(process.execPath);
    const child=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',script,'-Archive',state.staged.file,'-InstallDir',installDir,'-StateDir',runtime.dir,'-Version',state.staged.version,'-ExecutableName',exeName,'-WaitPid',String(process.pid)],{detached:true,stdio:'ignore',windowsHide:true});
    child.unref(); emitShell('update-state',{...state,phase:'installing'}); setTimeout(()=>app.quit(),300); return {ok:true,update:state};
  });
  ipcMain.handle('cc-shell:update-rollback', async event => {
    requireTrusted(event);
    if(process.platform!=='win32'||!app.isPackaged)throw new Error('Rollback is available from the packaged Windows build.');
    const state=await updateService.markRollback();
    const script=path.join(process.resourcesPath,'app.asar.unpacked','scripts','rollback-update.ps1');
    if(!fs.existsSync(script))throw new Error('Packaged rollback script is missing.');
    const {spawn}=require('node:child_process'); const installDir=path.dirname(process.execPath); const exeName=path.basename(process.execPath);
    const child=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',script,'-InstallDir',installDir,'-StateDir',runtime.dir,'-ExecutableName',exeName,'-WaitPid',String(process.pid)],{detached:true,stdio:'ignore',windowsHide:true});
    child.unref(); emitShell('update-state',{...state,phase:'rollback-requested'}); setTimeout(()=>app.quit(),300); return {ok:true,update:state};
  });
  ipcMain.handle('cc-shell:snapshot', async event => { requireTrusted(event); return shellSnapshot(); });
  ipcMain.handle('cc-shell:set-sidebar-collapsed', (event, payload = {}) => {
    requireTrusted(event);
    shellCollapsed = Boolean(payload.collapsed);
    layoutChatView();
    emitShell('sidebar-collapsed', { collapsed: shellCollapsed });
    return { ok: true, collapsed: shellCollapsed };
  });
  ipcMain.handle('cc-shell:test-connection',event=>{requireTrusted(event);if(emergencyLock||runtime.config.localToolMode==='off')throw new Error('Enable computer access before testing.');selectView('chat');chatView?.webContents.send('cc:test-connection');return {ok:true};});
  ipcMain.handle('cc-shell:arm-next', event => { requireTrusted(event); chatView?.webContents.send('cc:arm-next'); emitShell('arm-next', { armed: true }); return { ok: true }; });
  ipcMain.handle('cc-shell:set-local-mode', async (event, payload = {}) => {
    requireTrusted(event);
    const mode = String(payload.mode || 'auto');
    if (!['auto', 'always', 'off'].includes(mode)) throw new Error('Invalid local tool mode.');
    if (mode === 'off') { nativeAccessEpoch++; nativeAccessRevoking++; }
    try {
      await persistConfigChange('localToolMode', mode);
      if (mode === 'off') {
        const result = await stopOwnedComputerLink();
        if (result?.stopped === false) throw new Error(`Local tools are Off, but native owner shutdown is unconfirmed: ${result.reason}`);
      }
    } finally { if (mode === 'off') nativeAccessRevoking--; }
    return { ok: true, mode };
  });
  ipcMain.handle('cc-shell:set-emergency-lock', async (event, payload = {}) => {
    requireTrusted(event);
    return { ok: true, enabled: await setEmergencyLock(Boolean(payload.enabled)) };
  });
  ipcMain.handle('cc-shell:set-option', async (event, payload = {}) => {
    requireTrusted(event);
    const key = String(payload.key || '');
    if (!['enableGuiAutomation', 'enableShell'].includes(key)) throw new Error(`Unsupported shell option: ${key}`);
    const revokeNative = key === 'enableGuiAutomation' && !payload.value;
    if (revokeNative) { nativeAccessEpoch++; nativeAccessRevoking++; }
    try {
      await persistConfigChange(key, Boolean(payload.value));
      if (revokeNative) {
        const result = await stopOwnedComputerLink();
        if (result?.stopped === false) throw new Error(`GUI access is disabled, but native owner shutdown is unconfirmed: ${result.reason}`);
      }
    } finally { if (revokeNative) nativeAccessRevoking--; }
    return { ok: true, key, value: Boolean(payload.value) };
  });
  ipcMain.handle('cc-shell:set-full-access', async (event, payload = {}) => {
    requireTrusted(event);
    const enabled = Boolean(payload.enabled);
    const roots = enabled ? ['*'] : (runtime.config.savedScopedRoots || [os.homedir()]);
    if(enabled && !runtime.config.allowedRoots.includes('*'))runtime.config.savedScopedRoots=[...runtime.config.allowedRoots];
    await persistConfigChange('allowedRoots', roots);
    return { ok: true, allowedRoots: roots };
  });
  ipcMain.handle('cc-shell:add-root', async event => {
    requireTrusted(event);
    const picked = await dialog.showOpenDialog(win, { title: 'Add Project Constellation workspace folder', properties: ['openDirectory', 'createDirectory'] });
    if (picked.canceled || !picked.filePaths?.[0]) return { ok: true, canceled: true };
    const root = path.resolve(picked.filePaths[0]);
    const current = Array.isArray(runtime.config.allowedRoots) && !runtime.config.allowedRoots.includes('*') ? runtime.config.allowedRoots : [];
    const roots = [...new Set([...current, root])];
    await persistConfigChange('allowedRoots', roots);
    return { ok: true, root, allowedRoots: roots };
  });
  ipcMain.handle('cc-shell:remove-root', async (event, payload = {}) => {
    requireTrusted(event);
    const target = path.resolve(String(payload.root || ''));
    const roots = (Array.isArray(runtime.config.allowedRoots) ? runtime.config.allowedRoots : []).filter(root => root !== '*' && path.resolve(root) !== target);
    const next = roots;
    await persistConfigChange('allowedRoots', next);
    return { ok: true, allowedRoots: next };
  });
  ipcMain.handle('cc-shell:list-tools', async event => {
    requireTrusted(event);
    return { ok: true, tools: toolManifest() };
  });
  ipcMain.handle('cc-shell:computer-link-status', async event => {
    requireTrusted(event);
    return (await loadComputerLink()).getComputerLinkStatus();
  });
  ipcMain.handle('cc-shell:computer-link-session', async event => {
    requireTrusted(event);
    return (await loadComputerLink()).getComputerLinkMcpStatus();
  });
  ipcMain.handle('cc-shell:computer-link-open', async event => {
    requireTrusted(event);
    assertNativeAccess();
    const epoch = nativeAccessEpoch;
    return queueComputerLinkAction(async () => {
      const module = await loadComputerLink();
      assertNativeAccess(epoch);
      return module.launchComputerLinkOwner({ ownerInitiated: true, canStart: () => assertNativeAccess(epoch) });
    });
  });
  ipcMain.handle('cc-shell:computer-link-stop', async event => {
    requireTrusted(event);
    return stopOwnedComputerLink();
  });
  ipcMain.handle('cc-shell:run-tool', async (event, payload = {}) => {
    requireTrusted(event);
    const name = String(payload.name || '').trim();
    const definition = toolManifest().find(tool => tool.name === name);
    if (!definition) throw new Error(`Project Constellation tool is not available: ${name || '(empty)'}`);
    const args = payload.args && typeof payload.args === 'object' && !Array.isArray(payload.args) ? payload.args : {};
    const result = await executeShellTool(name, args);
    const attachments = Array.isArray(result?._attachments) ? result._attachments : [];
    const image = attachments.find(item => item?.base64 && item?.mimeType?.startsWith('image/'));
    const safe = result && typeof result === 'object' ? { ...result } : result;
    if (safe && typeof safe === 'object') delete safe._attachments;
    return {
      ok: true,
      tool: name,
      result: safe,
      attachmentCount: attachments.length,
      imageDataUrl: image ? `data:${image.mimeType};base64,${image.base64}` : ''
    };
  });
  ipcMain.handle('cc-shell:run-health', async event => {
    requireTrusted(event);
    const started = Date.now();
    try {
      const ping = await executeShellTool('ping', {});
      let displayCount = 0;
      let windowCount = 0;
      if (process.platform === 'win32' && runtime.config.enableGuiAutomation !== false && !emergencyLock) {
        const displays = await executeShellTool('computer_displays', {});
        const windows = await executeShellTool('computer_windows', { limit: 12 });
        displayCount = displays?.displays?.length || 0;
        windowCount = windows?.windows?.length || 0;
      }
      const result = { ok: true, deviceName: ping?.deviceName || runtime.config.deviceName, displayCount, windowCount, durationMs: Date.now() - started };
      emitShell('health-result', result);
      return result;
    } catch (error) {
      const result = { ok: false, error: String(error?.message || error), durationMs: Date.now() - started };
      emitShell('health-result', result);
      return result;
    }
  });
  ipcMain.handle('cc-shell:observe-desktop', async event => {
    requireTrusted(event);
    const observed = await executeShellTool('computer_observe', { max_width: 1100, max_height: 760, window_limit: 30 });
    const attachments = Array.isArray(observed?._attachments) ? observed._attachments : [];
    const shot = attachments.find(item => item?.base64 && item?.mimeType);
    const safe = observed && typeof observed === 'object' ? { ...observed } : {};
    delete safe._attachments;
    return { ok: true, ...safe, imageDataUrl: shot ? `data:${shot.mimeType};base64,${shot.base64}` : '' };
  });
  ipcMain.handle('cc-shell:list-windows', async event => {
    requireTrusted(event);
    const result = await executeShellTool('computer_windows', { limit: 40 });
    return { ok: true, windows: result?.windows || [] };
  });
  ipcMain.handle('cc-shell:focus-window', async (event, payload = {}) => {
    requireTrusted(event);
    const args = {};
    if (payload.handle != null && payload.handle !== '') args.handle = payload.handle;
    else if (payload.pid != null) args.pid = Number(payload.pid);
    else if (payload.title) args.title = String(payload.title);
    else throw new Error('Window handle, pid, or title is required.');
    const result = await executeShellTool('computer_focus_window', args);
    return { ok: true, result };
  });

  ipcMain.handle('cc-shell:reload-chat', event => { requireTrusted(event); chatView?.webContents.reload(); return { ok: true }; });
  ipcMain.handle('cc-shell:go-home', event => { requireTrusted(event); void chatView?.webContents.loadURL(CHAT_URL); return { ok: true }; });
  ipcMain.handle('cc-shell:open-data-folder', event => { requireTrusted(event); void shell.openPath(runtime.dir); return { ok: true }; });
  ipcMain.handle('cc-shell:open-devtools', event => { requireTrusted(event); chatView?.webContents.openDevTools({ mode: 'detach' }); return { ok: true }; });
  ipcMain.handle('cc-shell:set-start-with-windows', (event, payload = {}) => { requireTrusted(event); return { ok: true, enabled: setStartWithWindows(Boolean(payload.enabled)) }; });
}

async function configureSession() {
  const ses = session.fromPartition(CHAT_PARTITION, { cache: true });
  ses.on('will-download',(_event,item)=>{
    const id=randomToken(12),entry={id,name:item.getFilename(),received:0,total:item.getTotalBytes(),state:'progressing',path:''};
    downloads.set(id,entry);
    const update=()=>{entry.received=item.getReceivedBytes();entry.total=item.getTotalBytes();emitShell('downloads-changed',{});};
    item.on('updated',(_e,state)=>{entry.state=state;update();});
    item.once('done',(_e,state)=>{entry.state=state;entry.path=state==='completed'?item.getSavePath():'';update();});
    update();
  });
  const mediaGrants=new Set();
  const isChat=url=>{try{const u=new URL(url);return u.protocol==='https:'&&u.hostname==='chatgpt.com';}catch{return false;}};
  ses.setPermissionRequestHandler(async(wc,permission,callback)=>{
    if(!wc || !isChat(wc.getURL()))return callback(false);
    if(permission!=='media')return callback(['notifications','clipboard-sanitized-write','fullscreen'].includes(permission));
    const key=String(wc.id);
    if(mediaGrants.has(key))return callback(true);
    try{
      const answer=await dialog.showMessageBox(win,{type:'question',buttons:['Deny','Allow this session'],defaultId:0,cancelId:0,title:'ChatGPT requests microphone or camera',message:'Allow ChatGPT to use your microphone or camera?',detail:'This is separate from local computer control. You can deny it and keep chatting.'});
      if(answer.response===1)mediaGrants.add(key);
      callback(answer.response===1);
    }catch{callback(false);}
  });
  ses.setPermissionCheckHandler((wc,permission,origin)=>isChat(origin) && (permission==='media'?mediaGrants.has(String(wc?.id)):['notifications','clipboard-sanitized-write','fullscreen'].includes(permission)));

}

app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling');
app.setAppUserModelId('com.constellation.commander');

const singleInstanceOwner = app.requestSingleInstanceLock();
if (!singleInstanceOwner) app.quit();

app.on('second-instance', () => {
  if (!singleInstanceOwner || !win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});

app.whenReady().then(async () => {
  if (!singleInstanceOwner) return;

  runtime = await createRuntime();
  const {createUpdateService}=await importEsm('src/update-service.mjs');
  updateService=createUpdateService({currentVersion:VERSION,stateDir:runtime.dir});
  await updateService.load();
  migrateLegacyInstall();
  emergencyLock = Boolean(runtime.config.emergencyLock) || fs.existsSync(path.join(runtime.dir, 'EMERGENCY-LOCK'));
  await configureSession();
  installIpc();
  installShellIpc();
  createApplicationMenu();
  createChatWindow();
  void startFallbackBridge();
  if(app.isPackaged && runtime.config.autoUpdateCheck!==false)setTimeout(()=>{updateService.check().then(state=>emitShell('update-state',state)).catch(()=>{});},5000);
}).catch(error => {
  console.error('[Commander] fatal startup error', error);
  if(!TEST_MODE)dialog.showErrorBox('Project Constellation could not start',String(error?.message||error)+'\nYour files have not been removed.');
  if (TEST_OUTPUT) try { fs.writeFileSync(TEST_OUTPUT, JSON.stringify({ ok: false, error: String(error?.stack || error) }, null, 2)); } catch {}
  app.quit();
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => {
  if (quitReady) return;
  event.preventDefault();
  if (!quitCleanup) {
    nativeAccessEpoch++;
    quitCleanup = stopOwnedRuntime().then(report => {
      if (!report.ok) throw new Error(report.results.filter(result => !result.ok).map(result => `${result.name}: ${result.error}`).join('\n'));
      quitReady = true; app.quit();
    }).catch(error => {
      // Keep the owner alive so cleanup can be retried. Never claim a clean exit
      // while a failed kill or an unclosed output pipe leaves work uncertain.
      quitCleanup = null;
      if (runtime) runtime.state.shuttingDown = false;
      emitShell('shutdown-error', { error: String(error?.message || error) });
      if (!TEST_MODE) {
        if (!win || win.isDestroyed()) createChatWindow();
        dialog.showErrorBox('Project Constellation could not finish closing', `Some owned work has not confirmed exit. Use Stop or try Exit again.\n\n${error?.message || error}`);
      }
    });
  }
});
