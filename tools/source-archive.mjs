import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {spawnSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';

function run(repoRoot, command, args, options = {}) {
  const result = spawnSync(command, args, {cwd: repoRoot, ...options});
  if (result.status !== 0) {
    const stderr = Buffer.isBuffer(result.stderr) ? result.stderr.toString('utf8') : String(result.stderr || '');
    const stdout = Buffer.isBuffer(result.stdout) ? result.stdout.toString('utf8') : String(result.stdout || '');
    throw new Error(`${command} ${args.join(' ')} failed: ${stderr || stdout || `exit ${result.status}`}`);
  }
  return result;
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function parseTree(buffer) {
  return buffer.toString('utf8').split('\0').filter(Boolean).map(record => {
    const tab = record.indexOf('\t');
    if (tab < 0) throw new Error(`Malformed git ls-tree record: ${record}`);
    const [mode, type, object] = record.slice(0, tab).split(' ');
    const filePath = record.slice(tab + 1);
    if (type !== 'blob') throw new Error(`Unsupported git tree entry type ${type}: ${filePath}`);
    if (!['100644', '100755'].includes(mode)) throw new Error(`Unsupported git file mode ${mode}: ${filePath}`);
    if (!filePath || path.isAbsolute(filePath) || filePath.split('/').includes('..') || /[\r\n]/.test(filePath) || filePath.startsWith('-')) {
      throw new Error(`Unsafe archive path: ${JSON.stringify(filePath)}`);
    }
    return {mode, object, filePath};
  }).sort((a, b) => a.filePath.localeCompare(b.filePath));
}

function zipExact(stage, target, paths) {
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.rmSync(target, {force: true});
  if (process.platform === 'win32') {
    const input = `${paths.join('\n')}\n`;
    run(stage, 'tar.exe', ['-a', '-c', '-f', target, '-T', '-'], {encoding: 'utf8', input});
    return;
  }
  const input = `${paths.join('\n')}\n`;
  run(stage, 'zip', ['-X', '-q', target, '-@'], {encoding: 'utf8', input});
}


function collectFiles(root, relative = '') {
  const dir = path.join(root, ...relative.split('/').filter(Boolean));
  const rows = [];
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const rel = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) rows.push(...collectFiles(root, rel));
    else if (entry.isFile()) rows.push(rel);
    else throw new Error(`Unsupported archive entry: ${rel}`);
  }
  return rows.sort((a, b) => a.localeCompare(b));
}

export function writeDirectoryFilesZip({source, target}) {
  const stage = path.resolve(source);
  const out = path.resolve(target);
  const paths = collectFiles(stage);
  if (!paths.length) throw new Error(`Archive source contains no files: ${stage}`);
  zipExact(stage, out, paths);
  return {target: out, files: paths.length, sha256: sha256(out)};
}

export function writeExactGitSourceZip({repoRoot, commit = 'HEAD', target}) {
  const root = path.resolve(repoRoot);
  const out = path.resolve(target);
  const treeResult = run(root, 'git', ['ls-tree', '-r', '-z', commit], {encoding: null, maxBuffer: 64 * 1024 * 1024});
  const entries = parseTree(treeResult.stdout);
  const timestampResult = run(root, 'git', ['show', '-s', '--format=%ct', commit], {encoding: 'utf8'});
  const epochSeconds = Number(String(timestampResult.stdout).trim());
  if (!Number.isFinite(epochSeconds)) throw new Error('Could not resolve source commit timestamp.');
  const stableTime = new Date(Math.max(epochSeconds, 315532800) * 1000); // ZIP timestamps cannot predate 1980.
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'project-constellation-source-'));
  try {
    for (const entry of entries) {
      const destination = path.join(stage, ...entry.filePath.split('/'));
      fs.mkdirSync(path.dirname(destination), {recursive: true});
      const blob = run(root, 'git', ['cat-file', 'blob', entry.object], {encoding: null, maxBuffer: 256 * 1024 * 1024}).stdout;
      fs.writeFileSync(destination, blob, {mode: entry.mode === '100755' ? 0o755 : 0o644});
      fs.utimesSync(destination, stableTime, stableTime);
    }
    zipExact(stage, out, entries.map(entry => entry.filePath));
  } finally {
    fs.rmSync(stage, {recursive: true, force: true});
  }
  return {target: out, files: entries.length, sha256: sha256(out), commit};
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invoked) {
  const repoRoot = path.resolve(process.argv[2] || '.');
  const commit = process.argv[3] || 'HEAD';
  const target = path.resolve(process.argv[4] || path.join(repoRoot, 'Project-Constellation-source.zip'));
  console.log(JSON.stringify(writeExactGitSourceZip({repoRoot, commit, target}), null, 2));
}
