#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifest = JSON.parse(await fs.readFile(path.join(root, 'recovery/computer-link/SOURCE-MANIFEST.json'), 'utf8'));
const deltas = JSON.parse(await fs.readFile(path.join(root, 'recovery/computer-link/INTEGRATION-DELTAS.json'), 'utf8'));
const changes = new Map(deltas.files.map(value => [value.path, value]));
const sha256 = data => createHash('sha256').update(data).digest('hex');
const exec = promisify(execFile);
const args = process.argv.slice(2);
let source = 'auto', bundleDirectory = null;
for (let index = 0; index < args.length; index++) {
  if (args[index] === '--source' && ['auto', 'bundles', 'upstream'].includes(args[index + 1])) source = args[++index];
  else if (args[index] === '--bundle-dir' && args[index + 1] && path.isAbsolute(args[index + 1])) bundleDirectory = args[++index];
  else throw new Error('Usage: verify-import.mjs [--source auto|bundles|upstream] [--bundle-dir ABSOLUTE_DIR]');
}
const git = (args, cwd = root, options = {}) => exec('git', args, {
  cwd, timeout: 45000, maxBuffer: 4 * 1024 * 1024,
  env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, ...options,
});
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'constellation-source-verify-'));
let checkedFiles = 0;
const sources = [];

async function restore(bundleName, repository, entries, destination) {
  const bundle = manifest.bundles.find(value => path.basename(value.path) === bundleName);
  if (!bundle) throw new Error(`Missing recorded bundle identity: ${bundleName}`);
  const file = bundleDirectory ? path.join(bundleDirectory, bundleName) : path.join(root, bundle.path);
  let present = false;
  if (source !== 'upstream') {
    try { const stat = await fs.lstat(file); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Bundle is not a regular file: ${bundleName}`); present = true; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (source !== 'upstream' && present) {
    const actual = await fs.readFile(file);
    if (actual.length !== bundle.bytes || sha256(actual) !== bundle.sha256) throw new Error(`Bundle identity changed: ${bundleName}`);
    await git(['clone', '--mirror', file, destination]);
    // A source ZIP has no .git of its own. Verify inside the disposable restored
    // repository so privately supplied complete bundles remain usable there.
    await git(['bundle', 'verify', file], destination);
    sources.push({ repository, mode: 'private-local-bundle', verifiedBundle: bundleName });
  } else {
    if (source === 'bundles') throw new Error(`Private history bundle is not supplied: ${bundleName}`);
    // Read only the recorded public heads into disposable verification state.
    // No bundle/archive is created, published, re-encoded or added to a release.
    if (!/^https:\/\/github\.com\/Herbertofury\/Computer-Link(?:\.wiki)?\.git$/.test(repository)) throw new Error('Unexpected source repository');
    await git(['init', '--bare', destination]);
    const refspecs = entries.map(entry => {
      const upstream = entry.ref.replace(/^refs\/remotes\/origin\//, 'refs/heads/');
      if (!/^refs\/heads\/[a-zA-Z0-9_./-]+$/.test(upstream) || upstream.includes('..')) throw new Error('Unexpected source ref');
      return `+${upstream}:${entry.ref}`;
    });
    await git(['fetch', '--no-tags', '--no-write-fetch-head', repository, ...refspecs], destination);
    sources.push({ repository, mode: 'temporary-public-fetch' });
  }
  for (const entry of entries) {
    const { stdout: commit } = await git(['rev-parse', `${entry.ref}^{commit}`], destination);
    const { stdout: tree } = await git(['rev-parse', `${entry.ref}^{tree}`], destination);
    if (commit.trim() !== entry.commit) throw new Error(`Source commit mismatch: ${entry.ref}`);
    if (tree.trim() !== entry.tree) throw new Error(`Source tree mismatch: ${entry.ref}`);
  }
  await git(['fsck', '--full', '--no-reflogs'], destination);
}

async function verifyOriginal(restored, entry, permitIntegration = false) {
  const bytes = await fs.readFile(path.join(root, entry.targetPath));
  const digest = sha256(bytes), change = permitIntegration && changes.get(entry.targetPath);
  if (digest !== entry.sha256 && (!change || digest !== change.sha256)) throw new Error(`Undocumented source divergence: ${entry.targetPath}`);
  const { stdout: blob } = await git(['rev-parse', `${entry.sourceRef}:${entry.sourcePath}`], restored);
  if (blob.trim() !== entry.sourceBlob) throw new Error(`Original source path mismatch: ${entry.targetPath}`);
  const { stdout } = await git(['cat-file', 'blob', entry.sourceBlob], restored, { encoding: 'buffer' });
  if (stdout.length !== entry.bytes || sha256(stdout) !== entry.sha256) throw new Error(`Original source recovery mismatch: ${entry.targetPath}`);
}

try {
  const restored = path.join(temporary, 'Computer-Link.git');
  await restore('Computer-Link-all-history.bundle', `${manifest.repository}.git`, manifest.refs, restored);
  const { stdout: commitCount } = await git(['rev-list', '--count', ...manifest.refs.map(entry => entry.ref)], restored);
  if (Number(commitCount.trim()) !== manifest.historyCommitCount) throw new Error('Source history commit count mismatch');
  for (const entry of manifest.importedFiles) { await verifyOriginal(restored, entry, true); checkedFiles++; }

  const wiki = manifest.wiki;
  if (!wiki || wiki.commit !== manifest.wikiCommit) throw new Error('Exact wiki source metadata is missing');
  const restoredWiki = path.join(temporary, 'Computer-Link.wiki.git');
  await restore('Computer-Link-wiki-history.bundle', wiki.repository, [wiki], restoredWiki);
  const { stdout: wikiCount } = await git(['rev-list', '--count', wiki.ref], restoredWiki);
  if (Number(wikiCount.trim()) !== wiki.historyCommitCount) throw new Error('Wiki history commit count mismatch');
  for (const entry of wiki.files) await verifyOriginal(restoredWiki, entry);
  console.log(JSON.stringify({ ok: true, importedFiles: checkedFiles, restoredBranchTrees: manifest.refs.length, reachableCommits: Number(commitCount.trim()), wikiCommits: Number(wikiCount.trim()), wikiFiles: wiki.files.length, sources, documentedDeltas: changes.size, historyArchiveCreated: false }, null, 2));
} finally { await fs.rm(temporary, { recursive: true, force: true }); }
