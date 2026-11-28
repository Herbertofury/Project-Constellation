import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

export function resolveUserPath(p) {
  if (typeof p !== 'string' || !p.trim() || p.includes('\0')) throw new Error('path must be a non-empty string without NUL bytes');
  return path.resolve(p.replace(/^~(?=$|[\\/])/, os.homedir()));
}
function canonical(p) {
  // Resolve the nearest existing ancestor, including junctions, before authorizing
  // a path that will be created. Lexical startsWith alone is not a boundary.
  let ancestor = p; const missing = [];
  for (;;) {
    try { return path.join(fs.realpathSync.native(ancestor), ...missing.reverse()); }
    catch (error) {
      if (!['ENOENT','ENOTDIR'].includes(error.code)) throw error;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw error;
      missing.push(path.basename(ancestor)); ancestor = parent;
    }
  }
}
function contains(root, candidate) {
  if (process.platform === 'win32') { root = root.toLowerCase(); candidate = candidate.toLowerCase(); }
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
export function assertAllowedPath(p, config) {
  const resolved = resolveUserPath(p);
  if (config.allowedRoots?.includes('*')) return resolved;
  const target = canonical(resolved);
  const roots = Array.isArray(config.allowedRoots) ? config.allowedRoots : [];
  const allowed = roots.some(root => {
    try { const lexical=resolveUserPath(root); return contains(lexical,resolved) && contains(canonical(lexical),target); }
    catch { return false; }
  });
  if (!allowed) throw new Error(`Path is outside allowed roots (including symlink/junction targets): ${resolved}`);
  return resolved;
}
export function assertCommandAllowed(command, config) {
  if (!config.enableShell) throw new Error('Shell execution is disabled in configuration.');
  if (typeof command !== 'string' || !command.trim()) throw new Error('command must be a non-empty string');
  for (const item of config.blockedCommands || []) {
    if (!item) continue;
    let re; try { re = new RegExp(item,'i'); } catch { throw new Error(`Invalid blocked-command rule: ${item}`); }
    if (re.test(command)) throw new Error(`Command blocked by configuration rule: ${item}`);
  }
}
