import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {sha256, verifyArtifact, verifyWindowsDesktop, verifyWindowsSetup, verifyLinuxMonitor} from '../tools/release-artifacts.mjs';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'constellation-release-'));
const expected = {version: '0.22.0', sourceCommit: 'a'.repeat(40)};
const write = (name, value) => fs.writeFileSync(path.join(directory, name), typeof value === 'string' ? value : JSON.stringify(value));
const artifact = name => {
  write(name, `actual bytes: ${name}`);
  return {file: name, bytes: fs.statSync(path.join(directory, name)).size, sha256: sha256(path.join(directory, name))};
};
try {
  const portable = artifact('Project-Constellation-Desktop-0.22.0-x64.zip');
  const desktopSetup = artifact('Project-Constellation-Desktop-0.22.0-x64.exe');
  const desktop = {
    schema: 'project-constellation-windows-runtime-v1', ...expected,
    platform: 'windows-latest', nativeComputerUse: 'PASS', integratedElectron: 'PASS', packagedPortable: 'PASS',
    portableFile: portable.file, portableSize: portable.bytes, portableSha256: portable.sha256,
    setupFile: desktopSetup.file, setupSize: desktopSetup.bytes, setupSha256: desktopSetup.sha256,
  };
  const desktopReceipt = 'WINDOWS-RUNTIME-RECEIPT.json';
  write(desktopReceipt, '\uFEFF' + JSON.stringify(desktop));
  assert.equal(verifyWindowsDesktop(directory, expected).portable, path.join(directory, portable.file));
  // An older ZIP alongside the current one cannot be selected by glob order.
  artifact('Project-Constellation-Desktop-0.20.0-x64.zip');
  assert.equal(verifyWindowsDesktop(directory, expected).portable, path.join(directory, portable.file));
  write(desktopReceipt, {...desktop, version: '0.20.0'});
  assert.throws(() => verifyWindowsDesktop(directory, expected), /version/);
  write(desktopReceipt, {...desktop, sourceCommit: 'b'.repeat(40)});
  assert.throws(() => verifyWindowsDesktop(directory, expected), /source/);
  write(desktopReceipt, {...desktop, packagedPortable: 'SKIPPED'});
  assert.throws(() => verifyWindowsDesktop(directory, expected), /did not pass/);
  write(desktopReceipt, desktop);
  write(portable.file, 'x'.repeat(portable.bytes));
  assert.throws(() => verifyWindowsDesktop(directory, expected), /SHA-256/);
  for (const name of ['../outside.zip', '..\\outside.zip', '/tmp/a.zip', 'C:a.zip', 'valid.zip ']) {
    assert.throws(() => verifyArtifact(directory, {...portable, file: name}), /Unsafe/);
  }
  // Symlink creation requires extra privileges on Windows, so exercise this
  // filesystem boundary wherever the host supports unprivileged symlinks.
  if (process.platform !== 'win32') {
    fs.symlinkSync(path.join(directory, desktopSetup.file), path.join(directory, 'alias.exe'));
    assert.throws(() => verifyArtifact(directory, {...desktopSetup, file: 'alias.exe'}), /regular file/);
  }
  const quickSetup = artifact('Constellation-0.22.0-Windows-Setup.exe');
  const build = {...expected, sourceDirty: false, acceptanceFixture: false, computerLinkIncluded: true, embeddedPayloadVerified: true, artifact: quickSetup};
  const acceptance = {...expected, platform: 'win32', passed: true, acceptanceFixture: false, artifact: quickSetup,
    checks: ['install', 'repair', 'rollback', 'uninstall', 'setup-gui', 'owner-gui', 'integrations-restored'].map(name => ({name, passed: true}))};
  write('windows-setup-receipt.json', build);
  write('windows-setup-acceptance.json', acceptance);
  assert.equal(verifyWindowsSetup(directory, expected).setup, path.join(directory, quickSetup.file));
  for (const mutation of [{sourceDirty: true}, {acceptanceFixture: true}, {acceptanceFixture: undefined}, {computerLinkIncluded: false}]) {
    write('windows-setup-receipt.json', {...build, ...mutation});
    assert.throws(() => verifyWindowsSetup(directory, expected));
  }
  write('windows-setup-receipt.json', build);
  for (const mutation of [{platform: 'linux'}, {passed: false}, {checks: []}, {checks: acceptance.checks.slice(1)}, {artifact: {...quickSetup, sha256: '0'.repeat(64)}}]) {
    write('windows-setup-acceptance.json', {...acceptance, ...mutation});
    assert.throws(() => verifyWindowsSetup(directory, expected));
  }
  const monitor = {version: expected.version, source_commit: expected.sourceCommit, source_dirty: false,
    build: {version: expected.version, mode: 'production'}, artifacts: [artifact('Constellation-0.22.0-Firefox-Sensor.zip'), artifact('Constellation-0.22.0-Linux-Browser-Hub.zip')]};
  write('artifact-receipt.json', monitor);
  assert.equal(verifyLinuxMonitor(directory, expected).files.length, 2);
  write('artifact-receipt.json', {...monitor, source_dirty: true});
  assert.throws(() => verifyLinuxMonitor(directory, expected), /dirty/);
  write('artifact-receipt.json', {...monitor, artifacts: [...monitor.artifacts, monitor.artifacts[0]]});
  assert.throws(() => verifyLinuxMonitor(directory, expected), /exactly one/);
  console.log('release-artifacts: PASS (stale builds, source mismatch, tampering, traversal, acceptance fixtures, missing Windows gates)');
} finally {
  fs.rmSync(directory, {recursive: true, force: true});
}
