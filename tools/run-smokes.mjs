import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const smokeRoot = path.join(repoRoot, 'tests', 'smoke');
const logRoot = path.join(repoRoot, 'logs', 'smoke');
fs.mkdirSync(logRoot, { recursive: true });
const allScripts = fs.readdirSync(smokeRoot).filter((file) => file.endsWith('_smoke.py')).sort();
const match = String(process.env.PROJECT_CONSTELLATION_SMOKE_MATCH || '').trim();
const from = String(process.env.PROJECT_CONSTELLATION_SMOKE_FROM || '').trim();
let scripts = match ? (allScripts.includes(match) ? [match] : allScripts.filter((file) => file.includes(match))) : [...allScripts];
if (from) { const index=scripts.findIndex((file)=>file===from || file.includes(from)); if (index < 0) throw new Error(`Smoke resume target not found: ${from}`); scripts=scripts.slice(index); }
if (!scripts.length) throw new Error(`No smoke workflows matched${match ? ` ${match}` : ''}`);
const timeoutMs = Math.max(1000, Number(process.env.PROJECT_CONSTELLATION_SMOKE_TIMEOUT_MS || 120000));
const screenshotVars = [
  'PROJECT_CONSTELLATION_APPROVAL_SCREENSHOT','PROJECT_CONSTELLATION_HOME_OVERVIEW_SCREENSHOT','PROJECT_CONSTELLATION_HOME_SCREENSHOT',
  'PROJECT_CONSTELLATION_ORG_WORKSPACE_SCREENSHOT','PROJECT_CONSTELLATION_ORG_SCREENSHOT','PROJECT_CONSTELLATION_POPUP_SCREENSHOT',
  'PROJECT_CONSTELLATION_SIDEPANEL_SCREENSHOT','PROJECT_CONSTELLATION_WORKBENCH_SCREENSHOT','PROJECT_CONSTELLATION_CAPACITY_SCREENSHOT',
  'PROJECT_CONSTELLATION_HEALTH_SCREENSHOT'
];
const localPython = process.platform === 'win32' ? path.join(repoRoot, '.venv', 'Scripts', 'python.exe') : path.join(repoRoot, '.venv', 'bin', 'python');
const python = process.env.PYTHON || (fs.existsSync(localPython) ? localPython : (process.platform === 'win32' ? 'py' : 'python3'));

function terminateTree(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    const killer=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});
    killer.unref();
    return;
  }
  try { process.kill(-child.pid, 'SIGTERM'); } catch (_) { try { child.kill('SIGTERM'); } catch (_) {} }
  setTimeout(()=>{ try { process.kill(-child.pid,'SIGKILL'); } catch (_) { try { child.kill('SIGKILL'); } catch (_) {} } }, 800).unref();
}

async function runSmoke(script) {
  const base = path.basename(script, '.py');
  const logPath = path.join(logRoot, `${base}.log`);
  const fd = fs.openSync(logPath, 'w');
  const env = { ...process.env, PYTHONUTF8:'1', PROJECT_CONSTELLATION_ROOT:path.join(repoRoot, 'extension'), PROJECT_CONSTELLATION_BUILD:path.join(repoRoot, 'build', 'unpacked') };
  for (const name of screenshotVars) env[name] = path.join(logRoot, `${base}-${name.toLowerCase().replace('project_constellation_','').replace('_screenshot','')}.png`);
  const args = process.platform === 'win32' && /(^|[\\/])py(?:\.exe)?$/i.test(python) ? ['-3', path.join(smokeRoot, script)] : [path.join(smokeRoot, script)];
  let timedOut=false;
  const child=spawn(python,args,{cwd:repoRoot,env,stdio:['ignore',fd,fd],detached:process.platform!=='win32',windowsHide:true});
  const timer=setTimeout(()=>{timedOut=true;terminateTree(child);},timeoutMs);
  const result=await new Promise((resolve)=>{
    child.once('error',(error)=>resolve({code:null,signal:null,error}));
    child.once('close',(code,signal)=>resolve({code,signal,error:null}));
  });
  clearTimeout(timer); fs.closeSync(fd);
  if (timedOut) throw new Error(`${script} timed out after ${timeoutMs} ms; process tree terminated. Log: ${logPath}`);
  if (result.error) throw result.error;
  if (result.code !== 0) throw new Error(`${script} failed with exit code ${result.code ?? 'null'}${result.signal?` (${result.signal})`:''}. Log: ${logPath}`);
  console.log(`${script}: PASS`);
}

for (const script of scripts) await runSmoke(script);
console.log(`run-smokes.mjs: PASS (${scripts.length}/${allScripts.length} workflows${match?' matched':''}${from?' resumed':''})`);
