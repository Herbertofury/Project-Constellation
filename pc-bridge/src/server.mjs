import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createHash, timingSafeEqual } from 'node:crypto';
import readline from 'node:readline';

const MODERN = '2026-07-28';
const LEGACY = '2025-11-25';
const SERVER_INFO = { name: 'pcx-029-pc-bridge', version: '0.1.0' };
const SERVER_INFO_KEY = 'io.modelcontextprotocol/serverInfo';

function log(event, detail = {}) {
  process.stderr.write(`${JSON.stringify({ ts: new Date().toISOString(), event, ...detail })}\n`);
}

function expandEnv(value) {
  return String(value).replace(/%([^%]+)%/g, (_, k) => process.env[k] ?? `%${k}%`);
}

function defaultConfig() {
  const home = os.homedir();
  return {
    roots: [home, path.join(home, 'Desktop'), path.join(home, 'Documents'), path.join(home, 'Downloads')],
    maxListEntries: 500,
    maxReadBytes: 1024 * 1024,
    commandTimeoutMs: 15000,
    commands: {
      identity: { file: process.platform === 'win32' ? 'whoami.exe' : 'whoami', args: [] },
      hostname: { file: process.platform === 'win32' ? 'hostname.exe' : 'hostname', args: [] },
      ipconfig: process.platform === 'win32'
        ? { file: 'ipconfig.exe', args: ['/all'] }
        : { file: 'ip', args: ['addr'] }
    }
  };
}

async function loadConfig() {
  const configPath = process.env.PCX_BRIDGE_CONFIG;
  if (!configPath) return defaultConfig();
  const parsed = JSON.parse(await fs.readFile(configPath, 'utf8'));
  const merged = { ...defaultConfig(), ...parsed };
  merged.roots = (parsed.roots ?? merged.roots).map(expandEnv).map(p => path.resolve(p));
  merged.commands = { ...defaultConfig().commands, ...(parsed.commands ?? {}) };
  return merged;
}

function jsonError(id, code, message, data) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

function withServerMeta(result) {
  const meta = { ...(result?._meta ?? {}), [SERVER_INFO_KEY]: SERVER_INFO };
  return { ...result, _meta: meta };
}

function result(id, body) {
  return { jsonrpc: '2.0', id, result: withServerMeta(body) };
}

function normalized(p) {
  return path.resolve(expandEnv(p));
}

async function canonicalExisting(p) {
  return fs.realpath(normalized(p));
}

function startsWithin(candidate, root) {
  const rel = path.relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

async function requireAllowedPath(input, config) {
  if (typeof input !== 'string' || !input.trim()) throw new Error('path must be a non-empty string');
  const candidate = await canonicalExisting(input);
  const roots = await Promise.all(config.roots.map(async r => {
    try { return await fs.realpath(normalized(r)); } catch { return normalized(r); }
  }));
  if (!roots.some(root => startsWithin(candidate, root))) {
    const err = new Error('path is outside configured allowed roots');
    err.code = 'PCX_PATH_DENIED';
    throw err;
  }
  return candidate;
}

function asText(text) {
  return { content: [{ type: 'text', text: String(text) }] };
}

async function toolStatus(config) {
  return {
    ...asText('PC Bridge is healthy.'),
    structuredContent: {
      server: SERVER_INFO,
      protocolVersions: [MODERN, LEGACY],
      platform: process.platform,
      hostname: os.hostname(),
      uptimeSeconds: Math.floor(os.uptime()),
      roots: config.roots,
      commandIds: Object.keys(config.commands)
    }
  };
}

async function toolStat(args, config) {
  const target = await requireAllowedPath(args?.path, config);
  const st = await fs.stat(target);
  return {
    ...asText(`${target}\n${st.isDirectory() ? 'directory' : st.isFile() ? 'file' : 'other'}\n${st.size} bytes`),
    structuredContent: {
      path: target,
      type: st.isDirectory() ? 'directory' : st.isFile() ? 'file' : 'other',
      size: st.size,
      modified: st.mtime.toISOString(),
      created: st.birthtime.toISOString()
    }
  };
}

async function toolList(args, config) {
  const target = await requireAllowedPath(args?.path, config);
  const entries = await fs.readdir(target, { withFileTypes: true });
  const limit = Math.max(1, Math.min(Number(args?.limit ?? config.maxListEntries), config.maxListEntries));
  const rows = entries.slice(0, limit).map(e => ({ name: e.name, type: e.isDirectory() ? 'directory' : e.isFile() ? 'file' : 'other' }));
  return {
    ...asText(rows.map(x => `${x.type}\t${x.name}`).join('\n') || '(empty)'),
    structuredContent: { path: target, entries: rows, truncated: entries.length > rows.length }
  };
}

async function toolReadText(args, config) {
  const target = await requireAllowedPath(args?.path, config);
  const st = await fs.stat(target);
  if (!st.isFile()) throw new Error('path is not a file');
  const max = Math.max(1, Math.min(Number(args?.maxBytes ?? config.maxReadBytes), config.maxReadBytes));
  const handle = await fs.open(target, 'r');
  try {
    const buf = Buffer.alloc(Math.min(st.size, max));
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    const text = buf.subarray(0, bytesRead).toString('utf8');
    return {
      ...asText(text),
      structuredContent: { path: target, bytesRead, truncated: st.size > bytesRead }
    };
  } finally {
    await handle.close();
  }
}

function runProcess(file, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { windowsHide: true, shell: false });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(Object.assign(new Error('command timed out'), { code: 'PCX_COMMAND_TIMEOUT' }));
    }, timeoutMs);
    child.stdout.on('data', d => { stdout += d.toString(); if (stdout.length > 1024 * 1024) stdout = stdout.slice(0, 1024 * 1024); });
    child.stderr.on('data', d => { stderr += d.toString(); if (stderr.length > 1024 * 1024) stderr = stderr.slice(0, 1024 * 1024); });
    child.on('error', err => { clearTimeout(timer); reject(err); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

async function toolCommand(args, config) {
  const id = String(args?.id ?? '');
  const spec = config.commands[id];
  if (!spec) {
    const err = new Error(`command id not allowed: ${id}`);
    err.code = 'PCX_COMMAND_DENIED';
    throw err;
  }
  const timeoutMs = Math.max(100, Math.min(Number(spec.timeoutMs ?? config.commandTimeoutMs), 60000));
  const completed = await runProcess(spec.file, Array.isArray(spec.args) ? spec.args.map(String) : [], timeoutMs);
  return {
    ...asText([completed.stdout.trim(), completed.stderr.trim()].filter(Boolean).join('\n')),
    structuredContent: { id, exitCode: completed.code, stdout: completed.stdout, stderr: completed.stderr }
  };
}

const toolDefinitions = [
  {
    name: 'pc.status',
    description: 'Read-only bridge health, host identity, configured roots, and allowed command IDs.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} }
  },
  {
    name: 'fs.stat',
    description: 'Read metadata for an existing path confined to configured allowed roots.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['path'], properties: { path: { type: 'string' } } }
  },
  {
    name: 'fs.list',
    description: 'List a directory confined to configured allowed roots.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['path'], properties: { path: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 500 } } }
  },
  {
    name: 'fs.read_text',
    description: 'Read a bounded UTF-8 prefix of a file confined to configured allowed roots.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['path'], properties: { path: { type: 'string' }, maxBytes: { type: 'integer', minimum: 1, maximum: 1048576 } } }
  },
  {
    name: 'pc.run_allowed',
    description: 'Execute one preconfigured allowlisted command by stable ID. Arbitrary command strings are never accepted.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: { type: 'string' } } }
  }
];

async function callTool(name, args, config) {
  switch (name) {
    case 'pc.status': return toolStatus(config);
    case 'fs.stat': return toolStat(args, config);
    case 'fs.list': return toolList(args, config);
    case 'fs.read_text': return toolReadText(args, config);
    case 'pc.run_allowed': return toolCommand(args, config);
    default: {
      const err = new Error(`unknown tool: ${name}`);
      err.code = 'PCX_UNKNOWN_TOOL';
      throw err;
    }
  }
}

function requestedVersion(req) {
  return req?.params?._meta?.['io.modelcontextprotocol/protocolVersion'] ?? req?.params?.protocolVersion;
}

async function dispatch(req, config) {
  if (!req || req.jsonrpc !== '2.0' || typeof req.method !== 'string') return jsonError(req?.id, -32600, 'Invalid Request');
  const id = req.id;
  try {
    switch (req.method) {
      case 'server/discover':
        return result(id, {
          supportedVersions: [MODERN],
          capabilities: { tools: {} },
          instructions: 'Authorized local PC bridge. Prefer read-only filesystem tools and preconfigured command IDs. Paths are confined to configured roots.'
        });
      case 'initialize': {
        const offered = requestedVersion(req) ?? LEGACY;
        if (offered !== LEGACY) return jsonError(id, -32602, 'Unsupported legacy protocol version', { supported: [LEGACY] });
        return result(id, { protocolVersion: LEGACY, capabilities: { tools: {} }, serverInfo: SERVER_INFO });
      }
      case 'notifications/initialized':
        return null;
      case 'ping':
        return result(id, {});
      case 'tools/list':
        return result(id, { tools: toolDefinitions });
      case 'tools/call': {
        const name = req.params?.name;
        const args = req.params?.arguments ?? {};
        const body = await callTool(name, args, config);
        return result(id, body);
      }
      default:
        return jsonError(id, -32601, 'Method not found');
    }
  } catch (err) {
    log('tool_error', { method: req.method, code: err?.code, message: err?.message });
    return jsonError(id, -32000, err?.message ?? 'Bridge operation failed', { code: err?.code ?? 'PCX_ERROR' });
  }
}

function tokenMatches(expected, actual) {
  const a = Buffer.from(createHash('sha256').update(expected).digest());
  const b = Buffer.from(createHash('sha256').update(actual).digest());
  return timingSafeEqual(a, b);
}

async function serveStdio(config) {
  log('stdio_started', { server: SERVER_INFO });
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let req;
    try { req = JSON.parse(line); }
    catch { process.stdout.write(`${JSON.stringify(jsonError(null, -32700, 'Parse error'))}\n`); continue; }
    const response = await dispatch(req, config);
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  }
}

async function serveHttp(config) {
  const host = process.env.PCX_BRIDGE_HOST ?? '127.0.0.1';
  const port = Number(process.env.PCX_BRIDGE_PORT ?? 8765);
  const token = process.env.PCX_BRIDGE_TOKEN;
  if (!token || token.length < 32) throw new Error('PCX_BRIDGE_TOKEN must be set to a secret of at least 32 characters for HTTP mode');
  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/mcp') { res.writeHead(404).end(); return; }
    const auth = req.headers.authorization ?? '';
    const supplied = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!supplied || !tokenMatches(token, supplied)) { res.writeHead(401).end(); return; }
    let body = '';
    req.setEncoding('utf8');
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 2 * 1024 * 1024) { res.writeHead(413).end(); return; }
    }
    let rpc;
    try { rpc = JSON.parse(body); }
    catch { res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify(jsonError(null, -32700, 'Parse error'))); return; }
    const response = await dispatch(rpc, config);
    if (!response) { res.writeHead(202).end(); return; }
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(response));
  });
  await new Promise(resolve => server.listen(port, host, resolve));
  log('http_started', { host, port, endpoint: '/mcp' });
}

const config = await loadConfig();
const mode = process.argv.includes('--http') ? 'http' : 'stdio';
if (mode === 'http') await serveHttp(config); else await serveStdio(config);
