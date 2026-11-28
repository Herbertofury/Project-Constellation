import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

// Host-only adapter. Never accept executable paths from an agent tool request.
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = Object.freeze({
  repository: 'https://github.com/Herbertofury/Computer-Link',
  commit: '5a5798b41252a4027dfa97209d34819858752ec4',
  branch: 'review/windows-keyboard-focus', historyCommits: 92, refs: 26,
});
const executableNames = Object.freeze({
  owner: 'computer-link-owner-proof', client: 'local-client', focus: 'local-window-focus',
  mcp: 'computer-link-mcp-session', workspace: 'computer-link-workspace-candidate',
  worker: 'owned-worker',
});
const listeners = new Set();
let ownedChild = null;
let ownerStarting = null;
let lastOwnerEvent = null;

function emit(event) {
  lastOwnerEvent = { ...event, at: new Date().toISOString() };
  for (const listener of listeners) { try { listener({ ...lastOwnerEvent }); } catch {} }
}

export function subscribeComputerLink(listener) {
  if (typeof listener !== 'function') throw new TypeError('listener must be a function');
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function binaryRoots(options = {}) {
  const roots = [];
  if (options.binaryDirectory) {
    if (!path.isAbsolute(options.binaryDirectory)) throw new Error('Computer Link binary directory must be absolute');
    // A deliberately supplied trusted package root is exclusive. Missing files
    // must not silently select a different installation during a repair/test.
    return [options.binaryDirectory];
  }
  if (process.resourcesPath) roots.push(path.join(process.resourcesPath, 'computer-link'), path.join(process.resourcesPath, 'computer-link/bin'));
  roots.push(path.join(path.dirname(process.execPath), 'computer-link'), path.join(path.dirname(process.execPath), 'computer-link/bin'));
  roots.push(path.join(repositoryRoot, 'build/computer-link', process.platform === 'win32' ? 'windows-x64' : 'host'));
  return [...new Set(roots)];
}

async function regularFile(file) {
  try { const value = await fs.lstat(file); return value.isFile() && !value.isSymbolicLink(); } catch { return false; }
}

async function installedBinary(name) {
  if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) return null;
  const root = path.resolve(process.env.LOCALAPPDATA, 'Project Constellation');
  try {
    const receiptPath = path.join(root, 'constellation-install.json');
    if (!await regularFile(receiptPath) || (await fs.stat(receiptPath)).size > 1024 * 1024) return null;
    const receipt = JSON.parse(await fs.readFile(receiptPath, 'utf8'));
    if (receipt.schema !== 1 || receipt.product !== 'project-constellation' || typeof receipt.root !== 'string' || path.resolve(receipt.root).toLowerCase() !== root.toLowerCase()) return null;
    if (typeof receipt.active !== 'string' || !/^versions\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(receipt.active)) return null;
    const version = path.join(root, ...receipt.active.split('/'));
    const directory = path.join(version, 'computer-link');
    const candidate = path.join(directory, name);
    for (const item of [root, path.join(root, 'versions'), version, directory]) {
      const stat = await fs.lstat(item);
      if (!stat.isDirectory() || stat.isSymbolicLink() || (await fs.realpath(item)).toLowerCase() !== path.resolve(item).toLowerCase()) return null;
    }
    if (!await regularFile(candidate)) return null;
    const release = receipt.releases?.find(value => value.directory === receipt.active);
    const entry = release?.files?.find(value => value.path === `computer-link/${name}`);
    if (!entry || !/^[a-f0-9]{64}$/.test(entry.sha256) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || entry.bytes > 64 * 1024 * 1024) return null;
    const bytes = await fs.readFile(candidate);
    if (bytes.length !== entry.bytes || createHash('sha256').update(bytes).digest('hex') !== entry.sha256) return null;
    return candidate;
  } catch { return null; }
}

export async function resolveComputerLinkBinary(id, options = {}) {
  if (!Object.hasOwn(executableNames, id)) throw new Error('Unknown Computer Link executable');
  const name = executableNames[id] + (process.platform === 'win32' ? '.exe' : '');
  for (const root of binaryRoots(options)) {
    const candidate = path.join(root, name);
    if (await regularFile(candidate)) return candidate;
  }
  if (!options.binaryDirectory) return installedBinary(name);
  return null;
}

export async function getComputerLinkStatus(options = {}) {
  const entries = await Promise.all(Object.keys(executableNames).map(async id => ({
    id, name: executableNames[id], command: await resolveComputerLinkBinary(id, options),
  })));
  const bins = Object.fromEntries(entries.map(item => [item.id, item]));
  const windowsSupported = process.platform === 'win32';
  const ownerAvailable = windowsSupported && Boolean(bins.owner.command);
  const ownerRunning = Boolean(ownedChild && ownedChild.exitCode === null && ownedChild.signalCode === null);
  const capability = (id, title, surface, available, reason) => ({ id, title, surface, available, ...(available ? {} : { reason }) });
  return {
    platform: process.platform, windowsSupported, available: ownerAvailable || Boolean(bins.mcp.command), source,
    owner: { available: ownerAvailable, running: ownerRunning, pid: ownerRunning ? ownedChild.pid : null, lastEvent: lastOwnerEvent },
    mcp: { available: Boolean(bins.mcp.command), command: bins.mcp.command, args: ['--status-only'], protocolVersion: '2025-06-18' },
    binaries: entries.map(item => ({ id: item.id, name: item.name, available: Boolean(item.command) && (item.id === 'mcp' || windowsSupported) })),
    capabilities: [
      capability('connection-status', 'Native MCP connection status', 'stdio MCP', Boolean(bins.mcp.command), 'Native binary is not installed'),
      ...[
        ['snapshot', 'Choose and share one immutable text snapshot'],
        ['window-inventory', 'Capture visible window inventory'],
        ['folder-inventory', 'Capture a selected folder inventory'],
        ['new-file-export', 'Preview and export a new local text file'],
        ['https-handoff', 'Open an explicitly confirmed HTTPS URL'],
        ['foreground-selector', 'Choose and confirm a window to bring forward'],
        ['revocation', 'Disconnect and end owned workers'],
      ].map(([id, title]) => capability(id, title, 'Local Computer Tools window', ownerAvailable, windowsSupported ? 'Native owner is not installed' : 'Requires Windows')),
      capability('workspace', 'Independent new workspace list/read/create/revoke', 'Local CLI', windowsSupported && Boolean(bins.workspace.command), 'Requires the Windows workspace binary'),
      capability('owned-workers', 'Creation-time Job Object worker containment', 'Local CLI', windowsSupported && Boolean(bins.worker.command), 'Requires the Windows owned-worker binary'),
      capability('diagnostics-source', 'Independent Python diagnostics and adapter registry', 'Source CLI', await regularFile(path.join(repositoryRoot, 'computer-link/computer_link/__main__.py')), 'Source-only optional Python adapter'),
    ],
    limitations: [
      'Computer Tools actions require the local owner; status checks never create permission grants.',
      'Snapshot pairing is one-use local consent and is not automatic provider forwarding.',
      'Windows build coverage is separate from Windows installation and native UI acceptance.',
    ],
  };
}

const statusTranscript = [
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'Project Constellation', version: '0.22.0' } } },
  { jsonrpc: '2.0', method: 'notifications/initialized' },
  { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
  { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'connection_status', arguments: {} } },
].map(value => JSON.stringify(value)).join('\n') + '\n';

// Small single-use status exchange. No persistent child, listener, owner grant,
// workspace argument, snapshot read or provider endpoint is created here.
export async function getComputerLinkMcpStatus(options = {}) {
  const command = await resolveComputerLinkBinary('mcp', options);
  if (!command) return { available: false, verified: false, reason: 'native-mcp-not-installed' };
  const timeoutMs = options.timeoutMs === undefined ? 5000 : options.timeoutMs;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 5000) throw new Error('Status timeout must be 100..5000 ms');
  return new Promise(resolve => {
    let finished = false;
    let output = '';
    let outputBytes = 0;
    let failure = null;
    let cleanupDeadline;
    const child = spawn(command, ['--status-only'], { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], cwd: path.dirname(command) });
    const complete = value => { if (!finished) { finished = true; clearTimeout(deadline); clearTimeout(cleanupDeadline); resolve(value); } };
    const fail = reason => {
      if (finished || cleanupDeadline) return;
      failure ??= reason;
      // Status-only child has no descendants. Kill this owned handle and await
      // actual close; never resolve success while cleanup is unconfirmed.
      child.kill('SIGKILL');
      cleanupDeadline = setTimeout(() => complete({ available: true, verified: false, reason: `${failure}-cleanup-unconfirmed` }), 2000);
    };
    const deadline = setTimeout(() => fail('native-status-timeout'), timeoutMs);
    child.on('error', () => complete({ available: true, verified: false, reason: 'native-status-start-failed' }));
    child.stdin.on('error', () => { failure ??= 'native-status-input-failed'; });
    child.stdout.on('data', data => {
      outputBytes += data.length;
      if (outputBytes > 65536) { fail('native-status-output-limit'); return; }
      output += data.toString('utf8');
    });
    child.stderr.on('data', data => { outputBytes += data.length; if (outputBytes > 65536) fail('native-status-output-limit'); });
    child.on('close', code => {
      if (finished) return;
      if (failure || code !== 0) return complete({ available: true, verified: false, reason: failure || 'native-status-exit-failed' });
      try {
        const rows = output.trim().split(/\r?\n/).map(line => JSON.parse(line));
        if (rows.length !== 3 || rows.some((row, index) => row.jsonrpc !== '2.0' || row.id !== index + 1 || row.error)) throw new Error();
        const [hello, catalog, result] = rows;
        if (hello.result.protocolVersion !== '2025-06-18' || !Array.isArray(catalog.result.tools) || catalog.result.tools.length !== 1 || catalog.result.tools[0].name !== 'connection_status' || result.result.isError !== false) throw new Error();
        const content = result.result.content;
        if (!Array.isArray(content) || content.length !== 1 || content[0].type !== 'text' || typeof content[0].text !== 'string') throw new Error();
        complete({ available: true, verified: true, protocolVersion: hello.result.protocolVersion, server: hello.result.serverInfo, tools: catalog.result.tools, status: content[0].text });
      } catch { complete({ available: true, verified: false, reason: 'native-status-protocol-invalid' }); }
    });
    child.stdin.end(statusTranscript);
  });
}

export async function launchComputerLinkOwner(options = {}) {
  if (options.ownerInitiated !== true) throw new Error('Computer Tools must be opened by the local owner');
  options.canStart?.();
  if (process.platform !== 'win32') throw new Error('Computer Tools requires Windows');
  if (ownedChild && ownedChild.exitCode === null && ownedChild.signalCode === null) return { started: true, reused: true, pid: ownedChild.pid };
  if (ownerStarting) return ownerStarting;
  ownerStarting = (async () => {
    const command = await resolveComputerLinkBinary('owner', options);
    if (!command) throw new Error('Computer Tools is not installed. Run Constellation Setup.');
    // Package/receipt discovery awaits disk I/O. Recheck the trusted shell's
    // current access generation immediately before the synchronous spawn.
    options.canStart?.();
    return new Promise((resolve, reject) => {
      const child = spawn(command, [], { shell: false, detached: false, windowsHide: false, stdio: 'ignore', cwd: path.dirname(command) });
      ownedChild = child;
      child.once('spawn', () => { emit({ type: 'started', pid: child.pid }); resolve({ started: true, reused: false, pid: child.pid }); });
      child.once('error', () => {
        if (ownedChild === child) ownedChild = null;
        emit({ type: 'error', reason: 'owner-start-failed' });
        reject(new Error('Computer Tools could not be started'));
      });
      child.once('exit', (code, signal) => { if (ownedChild === child) ownedChild = null; emit({ type: 'exited', code, signal }); });
    });
  })();
  try { return await ownerStarting; } finally { ownerStarting = null; }
}

export async function stopComputerLinkOwner() {
  if (ownerStarting) { try { await ownerStarting; } catch {} }
  const child = ownedChild;
  if (!child || child.exitCode !== null || child.signalCode !== null) return { stopped: true, alreadyStopped: true };
  // This handle belongs to a process created by this module. Never search for,
  // adopt, or terminate a same-named process started by somebody else.
  return new Promise(resolve => {
    const timer = setTimeout(() => { child.off('exit', onExit); emit({ type: 'stop-unconfirmed', pid: child.pid }); resolve({ stopped: false, pid: child.pid, reason: 'owner-exit-unconfirmed' }); }, 5000);
    const onExit = () => { clearTimeout(timer); resolve({ stopped: true, alreadyStopped: false }); };
    child.once('exit', onExit);
    if (!child.kill()) { clearTimeout(timer); child.off('exit', onExit); resolve({ stopped: false, pid: child.pid, reason: 'owner-stop-refused' }); }
  });
}
