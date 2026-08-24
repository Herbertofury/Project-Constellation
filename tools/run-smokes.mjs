import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const smokeRoot = path.join(repoRoot, 'tests', 'smoke');
const logRoot = path.join(repoRoot, 'logs', 'smoke');
fs.mkdirSync(logRoot, { recursive: true });
const scripts = fs.readdirSync(smokeRoot).filter((file) => file.endsWith('_smoke.py')).sort();
const screenshotVars = [
  'PROJECT_CONSTELLATION_APPROVAL_SCREENSHOT','PROJECT_CONSTELLATION_HOME_OVERVIEW_SCREENSHOT','PROJECT_CONSTELLATION_HOME_SCREENSHOT',
  'PROJECT_CONSTELLATION_ORG_WORKSPACE_SCREENSHOT','PROJECT_CONSTELLATION_ORG_SCREENSHOT','PROJECT_CONSTELLATION_POPUP_SCREENSHOT',
  'PROJECT_CONSTELLATION_SIDEPANEL_SCREENSHOT','PROJECT_CONSTELLATION_WORKBENCH_SCREENSHOT','PROJECT_CONSTELLATION_CAPACITY_SCREENSHOT',
  'PROJECT_CONSTELLATION_HEALTH_SCREENSHOT'
];
const localPython = process.platform === 'win32' ? path.join(repoRoot, '.venv', 'Scripts', 'python.exe') : path.join(repoRoot, '.venv', 'bin', 'python');
const python = process.env.PYTHON || (fs.existsSync(localPython) ? localPython : (process.platform === 'win32' ? 'py' : 'python3'));
for (const script of scripts) {
  const base = path.basename(script, '.py');
  const env = { ...process.env, PYTHONUTF8:'1', PROJECT_CONSTELLATION_ROOT:path.join(repoRoot, 'extension'), PROJECT_CONSTELLATION_BUILD:path.join(repoRoot, 'build', 'unpacked') };
  for (const name of screenshotVars) env[name] = path.join(logRoot, `${base}-${name.toLowerCase().replace('project_constellation_','').replace('_screenshot','')}.png`);
  const args = process.platform === 'win32' && /(^|[\\/])py(?:\.exe)?$/i.test(python) ? ['-3', path.join(smokeRoot, script)] : [path.join(smokeRoot, script)];
  const result = spawnSync(python, args, { cwd:repoRoot, env, encoding:'utf8', stdio:'pipe' });
  fs.writeFileSync(path.join(logRoot, `${base}.log`), `${result.stdout || ''}${result.stderr || ''}`);
  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    throw new Error(`${script} failed with exit code ${result.status}`);
  }
  console.log(`${script}: PASS`);
}
console.log(`run-smokes.mjs: PASS (${scripts.length} workflows)`);
