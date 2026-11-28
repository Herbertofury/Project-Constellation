import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export const readReceipt = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function sameSource(receipt, version, commit, snakeCase = false) {
  requireValue(receipt.version === version, `Receipt version ${receipt.version} != ${version}`);
  const recorded = snakeCase ? receipt.source_commit : receipt.sourceCommit;
  requireValue(recorded === commit, `Receipt source ${recorded} != ${commit}`);
}

// Receipt filenames cannot redirect validation to a different download or source.
export function verifyArtifact(directory, record, expectedName) {
  const name = record?.file;
  requireValue(typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9._ -]*$/.test(name)
    && path.basename(name) === name && !/[. ]$/.test(name), 'Unsafe artifact filename');
  if (expectedName) requireValue(name === expectedName, `Unexpected artifact ${name}; expected ${expectedName}`);
  const file = path.join(directory, name);
  const stat = fs.lstatSync(file);
  requireValue(stat.isFile() && !stat.isSymbolicLink(), `Artifact is not a regular file: ${name}`);
  requireValue(Number.isSafeInteger(record.bytes) && record.bytes > 0 && stat.size === record.bytes,
    `Artifact size mismatch: ${name}`);
  requireValue(typeof record.sha256 === 'string' && /^[a-f0-9]{64}$/.test(record.sha256)
    && sha256(file) === record.sha256, `Artifact SHA-256 mismatch: ${name}`);
  return file;
}

export function verifyWindowsDesktop(directory, {version, sourceCommit}) {
  const receiptFile = path.join(directory, 'WINDOWS-RUNTIME-RECEIPT.json');
  const receipt = readReceipt(receiptFile);
  requireValue(receipt.schema === 'project-constellation-windows-runtime-v1', 'Unknown Windows runtime receipt schema');
  sameSource(receipt, version, sourceCommit);
  requireValue(receipt.sourceDirty === false, 'Windows desktop was built from dirty or unverified sources');
  requireValue(/^windows-/.test(receipt.platform || ''), 'Windows runtime was not executed on Windows');
  for (const check of ['nativeComputerUse', 'nativeComputerTools', 'integratedElectron', 'packagedPortable', 'gracefulShutdown']) {
    requireValue(receipt[check] === 'PASS', `Windows runtime check did not pass: ${check}`);
  }
  const verify = (prefix, extension) => {
    const name = receipt[`${prefix}File`];
    requireValue(typeof name === 'string' && name.endsWith(extension)
      && name.includes(version) && /Project[ -]Constellation/i.test(name), `Wrong ${prefix} version or product`);
    return verifyArtifact(directory, {file: name, bytes: receipt[`${prefix}Size`], sha256: receipt[`${prefix}Sha256`]});
  };
  return {receipt, receiptFile, portable: verify('portable', '.zip'), setup: verify('setup', '.exe')};
}

export function stageWindowsDesktop(directory, verified, version) {
  const portableFile = `Project-Constellation-v${version}-Windows-Portable.zip`;
  const setupFile = `Project-Constellation-v${version}-Windows-Desktop-Setup.exe`;
  fs.copyFileSync(verified.portable, path.join(directory, portableFile));
  fs.copyFileSync(verified.setup, path.join(directory, setupFile));
  fs.copyFileSync(verified.receiptFile, path.join(directory, 'WINDOWS-RUNTIME-BUILD-RECEIPT.json'));
  const receipt = {...verified.receipt, portableFile, setupFile,
    buildArtifacts: {portableFile: verified.receipt.portableFile, setupFile: verified.receipt.setupFile},
    buildReceipt: 'WINDOWS-RUNTIME-BUILD-RECEIPT.json'};
  fs.writeFileSync(path.join(directory, 'WINDOWS-RUNTIME-RECEIPT.json'), JSON.stringify(receipt, null, 2) + '\n');
  // Prove that the receipt describes the filenames actually being shipped.
  return verifyWindowsDesktop(directory, {version, sourceCommit: receipt.sourceCommit});
}

export function verifyWindowsSetup(directory, {version, sourceCommit}) {
  const receiptFile = path.join(directory, 'windows-setup-receipt.json');
  const acceptanceFile = path.join(directory, 'windows-setup-acceptance.json');
  const receipt = readReceipt(receiptFile);
  const acceptance = readReceipt(acceptanceFile);
  sameSource(receipt, version, sourceCommit);
  sameSource(acceptance, version, sourceCommit);
  requireValue(receipt.sourceDirty === false, 'Windows setup was built from dirty sources');
  requireValue(receipt.acceptanceFixture === false && acceptance.acceptanceFixture === false, 'An acceptance fixture cannot be published');
  requireValue(receipt.computerLinkIncluded === true && receipt.embeddedPayloadVerified === true, 'Windows setup payload was not fully verified');
  const setup = verifyArtifact(directory, receipt.artifact, `Constellation-${version}-Windows-Setup.exe`);
  requireValue(acceptance.platform === 'win32' && acceptance.passed === true, 'Real Windows setup acceptance did not pass');
  verifyArtifact(directory, acceptance.artifact, path.basename(setup));
  const required = ['install', 'repair', 'diagnostics', 'rollback', 'rollback-manager-repair', 'uninstall', 'setup-gui', 'owner-gui', 'integrations-restored'];
  requireValue(Array.isArray(acceptance.checks) && acceptance.checks.length > 0
    && acceptance.checks.every(check => check && check.passed === true), 'Windows acceptance contains failed or invalid checks');
  for (const name of required) requireValue(acceptance.checks.some(check => check.name === name), `Missing Windows acceptance: ${name}`);
  return {receipt, receiptFile, acceptance, acceptanceFile, setup};
}

export function verifyLinuxMonitor(directory, {version, sourceCommit}) {
  const receiptFile = path.join(directory, 'artifact-receipt.json');
  const receipt = readReceipt(receiptFile);
  sameSource(receipt, version, sourceCommit, true);
  requireValue(receipt.source_dirty === false, 'Monitor artifacts were built from dirty sources');
  requireValue(receipt.build?.version === version && receipt.build.mode === 'production', 'Monitor production build missing');
  const filenames = [`Constellation-${version}-Firefox-Sensor.zip`, `Constellation-${version}-Linux-Browser-Hub.zip`];
  const files = filenames.map(name => {
    const matches = (receipt.artifacts || []).filter(artifact => artifact.file === name);
    requireValue(matches.length === 1, `Expected exactly one monitor artifact: ${name}`);
    return verifyArtifact(directory, matches[0], name);
  });
  return {receipt, receiptFile, files};
}
