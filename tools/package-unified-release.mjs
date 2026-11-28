import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {writeDirectoryFilesZip, writeExactGitSourceZip} from './source-archive.mjs';
import {readReceipt, sha256, verifyWindowsDesktop, verifyWindowsSetup, verifyLinuxMonitor, stageWindowsDesktop} from './release-artifacts.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = readReceipt(path.join(root, 'package.json'));
const desktopPkg = readReceipt(path.join(root, 'desktop', 'package.json'));
const version = pkg.version;
if (desktopPkg.version !== version) throw new Error(`Desktop ${desktopPkg.version} != root ${version}`);
const buildInfo = readReceipt(path.join(root, 'build', 'build-info.json'));
if (buildInfo.version !== version || buildInfo.mode !== 'production' || buildInfo.extensionIdStable !== true) {
  throw new Error('A matching production extension with stable identity is required.');
}
const git = args => {
  const result = spawnSync('git', args, {cwd: root, encoding: 'utf8'});
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
};
const commit = git(['rev-parse', 'HEAD']);
const sourceTree = git(['rev-parse', `${commit}^{tree}`]);
const canonicalSourceCommit = String(process.env.PC_CANONICAL_SOURCE_COMMIT || '').trim() || commit;
const canonicalSourceTree = String(process.env.PC_CANONICAL_SOURCE_TREE || '').trim();
if (!/^[a-f0-9]{40}$/.test(canonicalSourceCommit)) throw new Error('Invalid canonical source commit');
if (canonicalSourceTree && canonicalSourceTree !== sourceTree) throw new Error(`Reconstructed source tree ${sourceTree} != canonical ${canonicalSourceTree}`);
if (canonicalSourceCommit !== commit && !canonicalSourceTree) throw new Error('Reconstructed source must provide its canonical tree.');
if (git(['status', '--porcelain', '--untracked-files=normal'])) throw new Error('Unified release packaging requires a clean committed source tree.');

const expected = {version, sourceCommit: canonicalSourceCommit};
const desktop = verifyWindowsDesktop(path.join(root, 'desktop', 'dist-electron'), expected);
const setup = verifyWindowsSetup(path.join(root, 'build', 'windows-setup-download'), expected);
const monitor = verifyLinuxMonitor(path.join(root, 'build', 'linux-monitor-download'), expected);
const notesSource = path.join(root, 'docs', `v${version}-release-notes.md`);
if (!fs.existsSync(notesSource)) throw new Error('Release notes missing.');

// Historical releases/ is source evidence. Only generated build output may be
// replaced, after the complete candidate has been validated and staged.
const outputRoot = path.join(root, 'build', 'releases');
fs.mkdirSync(outputRoot, {recursive: true});
const staging = fs.mkdtempSync(path.join(outputRoot, `.v${version}-`));
const releaseDir = path.join(outputRoot, `v${version}`);
try {
  const copy = (file, name = path.basename(file)) => fs.copyFileSync(file, path.join(staging, name));
  writeDirectoryFilesZip({source: path.join(root, 'build', 'unpacked'), target: path.join(staging, `Project-Constellation-v${version}-Extension.zip`)});
  writeExactGitSourceZip({repoRoot: root, commit, target: path.join(staging, `Project-Constellation-v${version}-source.zip`)});
  const publishedDesktop = stageWindowsDesktop(staging, desktop, version);
  copy(setup.setup);
  copy(notesSource);
  copy(setup.receiptFile);
  copy(setup.acceptanceFile);
  copy(monitor.receiptFile, 'MONITOR-ARTIFACT-RECEIPT.json');
  for (const file of monitor.files) copy(file);
  const artifacts = fs.readdirSync(staging).sort().map(name => ({name, size: fs.statSync(path.join(staging, name)).size, sha256: sha256(path.join(staging, name))}));
  const receipt = {
    schema: 'project-constellation-unified-release-v2', product: 'Project Constellation', version,
    sourceCommit:canonicalSourceCommit,sourceTree,
    extensionId: 'geljambmkfjkhodgkpjhnmfojkpcamig', extensionBuild: buildInfo,
    desktop: {electron: desktopPkg.devDependencies.electron, electronBuilder: desktopPkg.devDependencies['electron-builder']},
    artifacts,
    verification: {sourceClean: true, artifactBytesVerified: true, windowsRuntime: publishedDesktop.receipt, windowsSetupAcceptance: setup.acceptance},
    limitations: {prerelease: true, firefoxSigned: false, windowsCodeSigned: setup.receipt.signed === true, physicalAudioAndOwnerAccountsRequireAcceptance: true},
    createdAt: new Date().toISOString(),
  };
  const receiptName = `RELEASE-RECEIPT-v${version}.json`;
  fs.writeFileSync(path.join(staging, receiptName), JSON.stringify(receipt, null, 2) + '\n');
  const sums = fs.readdirSync(staging).sort().map(name => `${sha256(path.join(staging, name))}  ${name}`).join('\n') + '\n';
  fs.writeFileSync(path.join(staging, `SHA256SUMS-v${version}.txt`), sums);
  fs.rmSync(releaseDir, {recursive: true, force: true});
  fs.renameSync(staging, releaseDir);
  console.log(JSON.stringify({releaseDir, version, sourceCommit: canonicalSourceCommit, sourceTree, artifacts: artifacts.length, windowsAcceptance: true}, null, 2));
} finally {
  fs.rmSync(staging, {recursive: true, force: true});
}
