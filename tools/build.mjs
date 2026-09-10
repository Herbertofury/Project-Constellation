import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(repoRoot, 'extension');
const buildRoot = path.join(repoRoot, 'build');
const unpacked = path.join(buildRoot, 'unpacked');
const requestedMode = process.argv.find((value) => value.startsWith('--mode='))?.split('=')[1] || 'development';
const production = requestedMode === 'production';
if (!['development', 'production'].includes(requestedMode)) throw new Error(`Unknown build mode: ${requestedMode}`);

const googleClientId = String(process.env.PROJECT_CONSTELLATION_GOOGLE_CLIENT_ID || '').trim();
const githubClientId = String(process.env.PROJECT_CONSTELLATION_GITHUB_CLIENT_ID || '').trim();
const validGoogleClient = /^\d+-[A-Za-z0-9_-]{20,}\.apps\.googleusercontent\.com$/.test(googleClientId) && !/example|placeholder/i.test(googleClientId);
const validGithubClient = /^[A-Za-z0-9]{12,80}$/.test(githubClientId) && !/PROJECT_CONSTELLATION|example|placeholder/i.test(githubClientId);
if (production && !validGoogleClient) throw new Error('Production build blocked: PROJECT_CONSTELLATION_GOOGLE_CLIENT_ID must be a real Chrome Extension OAuth client ID.');
if (production && !validGithubClient) throw new Error('Production build blocked: PROJECT_CONSTELLATION_GITHUB_CLIENT_ID must be the Project Constellation OAuth App client ID.');

fs.rmSync(unpacked, { recursive: true, force: true });
fs.mkdirSync(path.join(unpacked, 'src'), { recursive: true });
const topFiles = ['manifest.json','service-worker.js','background.js','popup.html','popup.css','popup-pulse.css','popup.js','sidepanel.html','sidepanel.css','sidepanel.js','home.html','home.css','home.js','offscreen.html','offscreen.js'];
const sourceFiles = ['core.js','brain-core.js','provider-core.js','integrity-core.js','knowledge-core.js','project-memory-core.js','health-core.js','drive-sync-policy.js','drive-sync-guard.js','chatgpt-page-probe.js','live-sentinel.js','tab-beacon.js','content.js','pulse-ux.js','tab-supervisor-core.js','tab-supervisor-background.js','approval-supervisor-background.js','tab-supervisor.js','styles.css'];
for (const file of topFiles) fs.copyFileSync(path.join(sourceRoot, file), path.join(unpacked, file));
for (const file of sourceFiles) fs.copyFileSync(path.join(sourceRoot, 'src', file), path.join(unpacked, 'src', file));
for (const directory of ['assets']) {
  const sourceDirectory = path.join(sourceRoot, directory);
  if (fs.existsSync(sourceDirectory)) fs.cpSync(sourceDirectory, path.join(unpacked, directory), { recursive: true });
}

const manifestPath = path.join(unpacked, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (validGoogleClient) manifest.oauth2.client_id = googleClientId;
else delete manifest.oauth2;
manifest.version_name = production ? `${manifest.version} production` : `${manifest.version} development (OAuth not provisioned)`;
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

const backgroundPath = path.join(unpacked, 'background.js');
const background = fs.readFileSync(backgroundPath, 'utf8').replaceAll('PROJECT_CONSTELLATION_GITHUB_CLIENT_ID', validGithubClient ? githubClientId : '');
fs.writeFileSync(backgroundPath, background);

function verifyModuleGraph(entryRelativePath) {
  const queue = [entryRelativePath];
  const visited = new Set();
  const importPattern = /\bimport\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g;
  while (queue.length) {
    const relativePath = queue.shift();
    if (visited.has(relativePath)) continue;
    visited.add(relativePath);
    const absolutePath = path.join(unpacked, relativePath);
    if (!fs.existsSync(absolutePath)) throw new Error(`Build missing imported module: ${relativePath}`);
    const source = fs.readFileSync(absolutePath, 'utf8');
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1];
      if (!specifier.startsWith('.')) continue;
      const importedAbsolute = path.resolve(path.dirname(absolutePath), specifier);
      if (!importedAbsolute.startsWith(`${unpacked}${path.sep}`)) throw new Error(`Build import escapes package root: ${relativePath} -> ${specifier}`);
      const importedRelative = path.relative(unpacked, importedAbsolute);
      if (!fs.existsSync(importedAbsolute)) throw new Error(`Build missing imported module: ${relativePath} -> ${importedRelative}`);
      queue.push(importedRelative);
    }
  }
  return [...visited].sort();
}

const serviceWorkerModules = verifyModuleGraph(manifest.background?.service_worker || 'service-worker.js');
const buildInfo = { schema:'project-constellation-build', version:manifest.version, mode:requestedMode, oauth:{ google:validGoogleClient, github:validGithubClient }, extensionIdStable:Boolean(manifest.key), serviceWorkerModules, builtAt:new Date().toISOString() };
fs.mkdirSync(buildRoot, { recursive: true });
fs.writeFileSync(path.join(buildRoot, 'build-info.json'), JSON.stringify(buildInfo, null, 2) + '\n');
console.log(`${unpacked}\n${JSON.stringify(buildInfo)}`);
