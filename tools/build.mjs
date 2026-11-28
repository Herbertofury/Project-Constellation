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
const allowUnprovisionedOauth = process.argv.includes('--allow-unprovisioned-oauth');
if (!['development', 'production'].includes(requestedMode)) throw new Error(`Unknown build mode: ${requestedMode}`);

const googleClientId = String(process.env.PROJECT_CONSTELLATION_GOOGLE_CLIENT_ID || '').trim();
const githubClientId = String(process.env.PROJECT_CONSTELLATION_GITHUB_CLIENT_ID || '').trim();
const validGoogleClient = /^\d+-[A-Za-z0-9_-]{20,}\.apps\.googleusercontent\.com$/.test(googleClientId) && !/example|placeholder/i.test(googleClientId);
const validGithubClient = /^[A-Za-z0-9]{12,80}$/.test(githubClientId) && !/PROJECT_CONSTELLATION|example|placeholder/i.test(githubClientId);
if (production && !validGoogleClient && !allowUnprovisionedOauth) throw new Error('Production build blocked: PROJECT_CONSTELLATION_GOOGLE_CLIENT_ID must be a real Chrome Extension OAuth client ID.');
if (production && !validGithubClient && !allowUnprovisionedOauth) throw new Error('Production build blocked: PROJECT_CONSTELLATION_GITHUB_CLIENT_ID must be the Project Constellation OAuth App client ID.');

fs.rmSync(unpacked, { recursive: true, force: true });
fs.mkdirSync(unpacked, { recursive: true });
const topFiles = ['manifest.json','background.js','background-entry.js','popup.html','popup.css','popup-pulse.css','popup-organizer.css','popup-qol.css','popup.js','popup-organizer.js','chat-vault.html','chat-vault.css','chat-vault.js','sidepanel.html','sidepanel.css','sidepanel.js','home.html','home.css','home.js','offscreen.html','offscreen.js','agent-monitor.html','agent-monitor.css','agent-monitor.js'];
for (const file of topFiles) fs.copyFileSync(path.join(sourceRoot, file), path.join(unpacked, file));
const requiredCommandCenterSrc = [
  'project-identity-core.js','chat-vault-core.js','chat-organizer.js','chat-organizer.css','notification-repair.js','command-center-action-core.js',
  'closed-chat-watch-core.js','closed-chat-watch.js','closed-chat-watch-ui.js','closed-chat-vault-bridge.js',
  'ui-qol.js','popup-attention-qol.js','command-center-actions.js'
];
for (const file of requiredCommandCenterSrc) {
  const source = path.join(sourceRoot, 'src', file);
  if (!fs.existsSync(source)) throw new Error(`Missing Command Center source artifact: ${file}`);
}
// Copy the runtime source directory as one closure. Keeping a hand-maintained allowlist here
// caused Project Brain/Router/Intelligence modules to be omitted from an otherwise-valid ZIP.
fs.cpSync(path.join(sourceRoot, 'src'), path.join(unpacked, 'src'), { recursive: true });
for (const directory of ['assets']) {
  const sourceDirectory = path.join(sourceRoot, directory);
  if (fs.existsSync(sourceDirectory)) fs.cpSync(sourceDirectory, path.join(unpacked, directory), { recursive: true });
}
// The monitor guide must work before a candidate is published and while offline.
fs.mkdirSync(path.join(unpacked, 'docs'), { recursive: true });
for (const name of ['AGENT-MONITOR.md','MONITOR-VERIFICATION.md']) {
  fs.copyFileSync(path.join(repoRoot, 'docs', name), path.join(unpacked, 'docs', name));
}

const manifestPath = path.join(unpacked, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (validGoogleClient) manifest.oauth2.client_id = googleClientId;
else delete manifest.oauth2;
manifest.version_name = production ? `${manifest.version} production${validGoogleClient&&validGithubClient?'':' (OAuth IDs not embedded)'}` : `${manifest.version} development (OAuth not provisioned)`;
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

const backgroundPath = path.join(unpacked, 'background.js');
const background = fs.readFileSync(backgroundPath, 'utf8').replaceAll('PROJECT_CONSTELLATION_GITHUB_CLIENT_ID', validGithubClient ? githubClientId : '');
fs.writeFileSync(backgroundPath, background);

// Fail the build if any shipped relative ESM import points at a file that was not copied.
// This validates the actual unpacked artifact, not merely the source tree.
const javascriptFiles = [];
const collectJavaScript = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) collectJavaScript(absolute);
    else if (entry.isFile() && entry.name.endsWith('.js')) javascriptFiles.push(absolute);
  }
};
collectJavaScript(unpacked);
const importPattern = /\bimport\s+(?:[^'"\n]+?\s+from\s+)?['"](\.[^'"]+)['"]/g;
for (const file of javascriptFiles) {
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(importPattern)) {
    const target = path.resolve(path.dirname(file), match[1]);
    if (!fs.existsSync(target)) {
      throw new Error(`Build closure broken: ${path.relative(unpacked, file)} imports missing ${path.relative(unpacked, target)}.`);
    }
  }
}

const requireBuiltFile = (relative, owner) => {
  if (!relative) return;
  const target = path.join(unpacked, relative);
  if (!fs.existsSync(target)) throw new Error(`Build closure broken: ${owner} references missing ${relative}.`);
};
requireBuiltFile(manifest.background?.service_worker, 'manifest background');
requireBuiltFile(manifest.action?.default_popup, 'manifest action');
requireBuiltFile(manifest.side_panel?.default_path, 'manifest side panel');
for (const [index, script] of (manifest.content_scripts || []).entries()) {
  for (const file of script.js || []) requireBuiltFile(file, `manifest content_scripts[${index}].js`);
  for (const file of script.css || []) requireBuiltFile(file, `manifest content_scripts[${index}].css`);
}
const buildInfo = { schema:'project-constellation-build', version:manifest.version, mode:requestedMode, oauth:{ google:validGoogleClient, github:validGithubClient }, extensionIdStable:Boolean(manifest.key), builtAt:new Date().toISOString() };
fs.mkdirSync(buildRoot, { recursive: true });
fs.writeFileSync(path.join(buildRoot, 'build-info.json'), JSON.stringify(buildInfo, null, 2) + '\n');
console.log(`${unpacked}\n${JSON.stringify(buildInfo)}`);
