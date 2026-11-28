import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let helperPath = path.resolve(__dirname, '../native/windows-computer-use.ps1');
if (helperPath.includes('app.asar')) helperPath = helperPath.replace('app.asar', 'app.asar.unpacked');
let child = null;
let closing = null;
let stdoutBuffer = '';
let stderrBuffer = '';
const pending = new Map();

function failAll(error) {
  for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(error); }
  pending.clear();
}

function ensureWindows() {
  if (process.platform !== 'win32') throw new Error('Full computer-use controls are currently implemented for Windows only.');
}

function startHelper() {
  ensureWindows();
  if (closing) throw new Error('Computer-use helper is still stopping.');
  if (child && child.exitCode === null && child.signalCode === null) {
    if (child.killed) throw new Error('Previous computer-use helper exit is unconfirmed.');
    return child;
  }
  child = spawn('powershell.exe', ['-NoLogo','-NoProfile','-Sta','-ExecutionPolicy','Bypass','-File',helperPath], {
    stdio: ['pipe','pipe','pipe'], windowsHide: true
  });
  stdoutBuffer = ''; stderrBuffer = '';
  const ownChild = child;
  child.stdin.on('error', error => { if(child===ownChild)failAll(error); });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    if(child!==ownChild)return;
    stdoutBuffer += chunk;
    for (;;) {
      const idx = stdoutBuffer.indexOf('\n');
      if (idx < 0) break;
      const line = stdoutBuffer.slice(0, idx).trim(); stdoutBuffer = stdoutBuffer.slice(idx + 1);
      if (!line) continue;
      let msg; try { msg = JSON.parse(line); } catch { continue; }
      const slot = pending.get(msg.id); if (!slot) continue;
      pending.delete(msg.id); clearTimeout(slot.timer);
      if (msg.ok) slot.resolve(msg.result); else slot.reject(new Error(msg.error || 'Computer-use helper failed.'));
    }
  });
  child.stderr.on('data', chunk => { stderrBuffer = (stderrBuffer + chunk).slice(-32768); });
  child.on('error', error => { if(child===ownChild)failAll(error); });
  child.on('exit', (code, signal) => { if(child!==ownChild)return; const detail = stderrBuffer.trim(); failAll(new Error(`Computer-use helper exited (${code ?? signal})${detail ? `: ${detail}` : ''}`)); child = null; });
  return child;
}

export async function computerUse(command, args = {}, timeoutMs = 20000) {
  const proc = startHelper();
  const id = crypto.randomBytes(10).toString('hex');
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Computer-use command timed out: ${command}`)); void closeComputerUseHelper(); }, Math.max(1000, timeoutMs));
    pending.set(id, { resolve, reject, timer });
    proc.stdin.write(JSON.stringify({ id, command, args }) + '\n', 'utf8', error => {
      if (error) { clearTimeout(timer); pending.delete(id); reject(error); }
    });
  });
}

export async function closeComputerUseHelper() {
  if (closing) return closing;
  if (!child) return { stopped: true, alreadyStopped: true };
  const old=child;
  failAll(new Error('Computer-use helper stopped; queued actions cancelled.'));
  if (old.exitCode !== null || old.signalCode !== null) { if(child===old)child=null;return {stopped:true,alreadyStopped:true}; }
  closing = new Promise(resolve => {
    const timer = setTimeout(() => { old.off('exit', onExit); resolve({ stopped: false, reason: 'computer-use-helper-exit-unconfirmed' }); }, 5000);
    const onExit = () => { clearTimeout(timer);if(child===old)child=null;resolve({ stopped: true }); };
    old.once('exit', onExit);
    try {
      if (!old.kill('SIGKILL')) { clearTimeout(timer);old.off('exit',onExit);resolve({stopped:false,reason:'computer-use-helper-stop-refused'}); }
      old.stdin.destroy();
    } catch { clearTimeout(timer);old.off('exit',onExit);resolve({stopped:false,reason:'computer-use-helper-stop-failed'}); }
  });
  try { return await closing; } finally { closing = null; }
}
