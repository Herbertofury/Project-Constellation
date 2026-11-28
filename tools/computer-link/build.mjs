#!/usr/bin/env node
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const targetIndex = args.indexOf('--target');
const target = targetIndex >= 0 ? args[targetIndex + 1] : null;
if (targetIndex >= 0 && (!target || !/^[a-zA-Z0-9_-]+$/.test(target))) throw new Error('Valid --target triple required');
const allowed = new Set(['--test', '--target', target].filter(Boolean));
if (args.some(arg => !allowed.has(arg))) throw new Error('Usage: build.mjs [--test] [--target TRIPLE]');
const targetDirectory = path.join(root, 'build/computer-link/target');
const env = { ...process.env, CARGO_TARGET_DIR: targetDirectory };
const isWindows = target ? target.includes('windows') : process.platform === 'win32';
const output = path.join(root, 'build/computer-link', isWindows ? 'windows-x64' : 'host');
const crates = ['local-export', 'windows-workspace', 'windows-transport', 'windows-owner', 'mcp-session', 'windows-backend'];
const binaryCrates = ['windows-owner', 'mcp-session', 'windows-workspace', 'windows-backend'];
const execFileAsync = promisify(execFile);
const { stdout: rustVersion } = await execFileAsync('rustc', ['-vV'], { cwd: root, env });
const actualTarget = target || rustVersion.match(/^host: (.+)$/m)?.[1];
if (!actualTarget) throw new Error('Rust host target could not be identified');
if (actualTarget.endsWith('windows-msvc')) {
  if (env.CARGO_ENCODED_RUSTFLAGS) env.CARGO_ENCODED_RUSTFLAGS += '\u001f-C\u001ftarget-feature=+crt-static';
  else env.RUSTFLAGS = `${env.RUSTFLAGS || ''} -C target-feature=+crt-static`.trim();
}
const sourceScope = ['computer-link', 'tools/computer-link/build.mjs'];
async function sourceIdentity() {
  const [{stdout: commit}, {stdout: dirty}, {stdout: names}] = await Promise.all([
    execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root }),
    execFileAsync('git', ['status', '--porcelain=v1', '--untracked-files=all', '--', ...sourceScope], { cwd: root }),
    execFileAsync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...sourceScope], { cwd: root }),
  ]);
  const compiledSources = [];
  for (const name of [...new Set(names.split('\0').filter(Boolean))].sort()) {
    const bytes = await fs.readFile(path.join(root, name));
    compiledSources.push({ path: name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  return { constellationCommit: commit.trim(), sourceDirty: Boolean(dirty.trim()), sourceFingerprint: createHash('sha256').update(JSON.stringify(compiledSources)).digest('hex'), compiledSources };
}
const provenance = await sourceIdentity();

function run(command, args, cwd = root) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, shell: false, stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`${command} failed (${code})`)));
  });
}

if (args.includes('--test')) {
  // Running cross-target tests needs a real configured runner. Compilation alone
  // must never be relabelled as Windows runtime acceptance.
  if (target) throw new Error('--test runs the host target; use Windows CI for Windows native acceptance');
  if (process.platform === 'win32') {
    // The actual owner tests launch this fixed sibling, not a fake responder.
    await run('cargo', ['build', '--locked', '--manifest-path', 'computer-link/mcp-session/Cargo.toml']);
  }
  for (const crate of crates) {
    const testArgs = ['test', '--locked', '--manifest-path', `computer-link/${crate}/Cargo.toml`];
    // These native GUI fixtures share the disposable runner's foreground window.
    // Keep the original acceptance contract; unrelated Linux tests stay parallel.
    if (process.platform === 'win32') testArgs.push('--', '--test-threads=1');
    await run('cargo', testArgs);
  }
  if (process.platform === 'win32') await run('cargo', ['test', '--locked', '--manifest-path', 'computer-link/windows-owner/Cargo.toml', '--test', 'probe_gui', '--', '--ignored', '--test-threads=1']);
  await run(process.platform === 'win32' ? 'python' : 'python3', ['-m', 'unittest', 'discover', '-s', 'tests', '-v'], path.join(root, 'computer-link'));
}
for (const crate of binaryCrates) {
  const cargoArgs = ['build', '--release', '--locked', '--manifest-path', `computer-link/${crate}/Cargo.toml`, '--bins'];
  if (target) cargoArgs.push('--target', target);
  await run('cargo', cargoArgs);
}
await fs.mkdir(output, { recursive: true });
// Carry dependency license texts with distributed binaries, rather than relying
// on registry links or silently applying the repository's license to imports.
const dependencyPackages = new Map();
for (const crate of binaryCrates) {
  const { stdout } = await execFileAsync('cargo', ['metadata', '--locked', '--format-version', '1', '--manifest-path', `computer-link/${crate}/Cargo.toml`], { cwd: root, env, maxBuffer: 4 * 1024 * 1024 });
  for (const item of JSON.parse(stdout).packages) if (item.source) dependencyPackages.set(`${item.name}-${item.version}`, item);
}
const dependencies = [];
for (const [id, item] of dependencyPackages) {
  const directory = path.dirname(item.manifest_path);
  const names = (await fs.readdir(directory)).filter(name => /^(?:LICENSE|COPYING|NOTICE|UNLICENSE)(?:[._-].*)?$/i.test(name));
  if (item.license_file) names.push(item.license_file);
  const notices = [];
  for (const name of new Set(names)) {
    const file = path.resolve(directory, name);
    if (!file.startsWith(directory + path.sep) || !(await fs.stat(file)).isFile()) continue;
    const localName = path.join('licenses', id, path.basename(file));
    await fs.mkdir(path.dirname(path.join(output, localName)), { recursive: true });
    await fs.copyFile(file, path.join(output, localName));
    notices.push(localName.replaceAll(path.sep, '/'));
  }
  if (!notices.length) throw new Error(`Dependency license text missing: ${id}`);
  dependencies.push({ name: item.name, version: item.version, license: item.license, source: item.source, notices });
}
const { stdout: sysroot } = await execFileAsync('rustc', ['--print', 'sysroot'], { cwd: root, env });
const rustDocs = path.join(sysroot.trim(), 'share/doc/rust');
await fs.mkdir(path.join(output, 'licenses/rust'), { recursive: true });
await fs.copyFile(path.join(rustDocs, 'COPYRIGHT-library.html'), path.join(output, 'licenses/rust/COPYRIGHT-library.html'));
await fs.cp(path.join(rustDocs, 'licenses'), path.join(output, 'licenses/rust/licenses'), { recursive: true });
if (target?.endsWith('windows-gnu')) await fs.cp(path.join(root, 'computer-link/licenses/toolchain'), path.join(output, 'licenses/toolchain'), { recursive: true });
await fs.writeFile(path.join(output, 'DEPENDENCY-LICENSES.json'), JSON.stringify({ schema: 1, dependencies, rust: 'licenses/rust/COPYRIGHT-library.html' }, null, 2) + '\n');
const suffix = isWindows ? '.exe' : '';
const names = ['computer-link-owner-proof', 'local-client', 'local-window-focus', 'computer-link-mcp-session', 'computer-link-workspace-candidate', 'owned-worker'];
const binaries = [];
for (const name of names) {
  const filename = name + suffix;
  const source = path.join(targetDirectory, ...(target ? [target] : []), 'release', filename);
  const destination = path.join(output, filename);
  await fs.copyFile(source, destination);
  const data = await fs.readFile(destination);
  binaries.push({ name: filename, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') });
}
await fs.copyFile(path.join(root, 'computer-link/THIRD_PARTY_NOTICES.md'), path.join(output, 'THIRD_PARTY_NOTICES.md'));
await fs.copyFile(path.join(root, 'computer-link/README.md'), path.join(output, 'README.md'));
const manifest = {
  schema: 1, product: 'project-constellation', version: '0.22.0', target: actualTarget,
  source: 'Herbertofury/Computer-Link', sourceCommit: '5a5798b41252a4027dfa97209d34819858752ec4',
  independentWorkerCommit: 'f55e056a7c0f20ce5e368b1cc82ddc7f2ea7b685',
  integration: 'Project Constellation Computer Tools; consult recovery/computer-link/SOURCE-MANIFEST.json',
  ...provenance,
  staticCrt: actualTarget.endsWith('windows-msvc'),
  windowsRuntimeExecuted: process.platform === 'win32' && args.includes('--test'), binaries,
};
if ((await sourceIdentity()).sourceFingerprint !== provenance.sourceFingerprint) throw new Error('Computer Tools source changed during the build; rebuild before packaging');
await fs.writeFile(path.join(output, 'BUILD-MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ output, ...manifest, compiledSources: manifest.compiledSources.length }, null, 2));
