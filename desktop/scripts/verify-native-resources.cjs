'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const payload = path.resolve(__dirname, '../../build/computer-link/windows-x64');
const required = ['computer-link-owner-proof.exe', 'local-client.exe', 'local-window-focus.exe', 'computer-link-mcp-session.exe', 'computer-link-workspace-candidate.exe', 'owned-worker.exe'];

async function verifyNativePayload(directory, version) {
  let manifest;
  try { manifest = JSON.parse(await fs.readFile(path.join(directory, 'BUILD-MANIFEST.json'), 'utf8')); }
  catch { throw new Error('Native Computer Tools payload is missing. Build it from the repository root with node tools/computer-link/build.mjs on Windows (or supply the explicit Windows cross target).'); }
  if (manifest.schema !== 1 || manifest.product !== 'project-constellation' || manifest.version !== version || !manifest.target?.includes('windows')) throw new Error('Native Computer Tools manifest does not match this Windows desktop version.');
  const entries = new Map();
  for (const item of manifest.binaries || []) {
    if (entries.has(item.name) || !required.includes(item.name)) throw new Error('Unexpected or duplicate native payload executable.');
    entries.set(item.name, item);
  }
  for (const name of required) {
    const item = entries.get(name);
    if (!item || !/^[a-f0-9]{64}$/.test(item.sha256) || !Number.isSafeInteger(item.bytes) || item.bytes < 2 || item.bytes > 64 * 1024 * 1024) throw new Error(`Invalid native identity: ${name}`);
    const file = path.join(directory, name), stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== item.bytes) throw new Error(`Native payload file mismatch: ${name}`);
    const bytes = await fs.readFile(file);
    if (bytes.subarray(0, 2).toString() !== 'MZ' || crypto.createHash('sha256').update(bytes).digest('hex') !== item.sha256) throw new Error(`Native executable SHA-256/PE mismatch: ${name}`);
  }
  for (const name of ['THIRD_PARTY_NOTICES.md', 'DEPENDENCY-LICENSES.json']) if (!(await fs.stat(path.join(directory, name))).isFile()) throw new Error(`Native license notice missing: ${name}`);
  if (!(await fs.stat(path.join(directory, 'licenses'))).isDirectory()) throw new Error('Native dependency license texts are missing.');
  return { verified: true, version, binaries: required.length };
}

// electron-builder v26 documented beforePack context; extraResources copies this
// directory to resources/computer-link outside ASAR for native execution.
module.exports = async context => {
  if (context.electronPlatformName !== 'win32') return;
  await verifyNativePayload(payload, context.packager.appInfo.version);
};
module.exports.verifyNativePayload = verifyNativePayload;
if (require.main === module) {
  const directory = process.argv[2] ? path.resolve(process.argv[2]) : payload;
  verifyNativePayload(directory, require('../package.json').version).then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
