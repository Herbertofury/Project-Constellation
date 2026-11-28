#!/usr/bin/env node
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig, APP_NAME, VERSION } from './config.mjs';
import { createRuntimeState } from './state.mjs';
import { createToolHandler } from './tools.mjs';
import { toolDefinitions } from './tool-definitions.mjs';

const LOOPBACK_HOST = process.env.CONSTELLATION_BRIDGE_HOST || '127.0.0.1';
const LOOPBACK_PORT = Number(process.env.CONSTELLATION_BRIDGE_PORT || 47721);
const SESSION_TTL_MS = 45 * 60 * 1000;
const MAX_BODY = 8 * 1024 * 1024;
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
const nowIso = () => new Date().toISOString();

const aliasMap = new Map([
  ['pc_status', 'get_config'],
  ['pc_processes', 'list_processes'],
  ['fs_stat', 'get_file_info'],
  ['fs_list', 'list_directory'],
  ['fs_read_text', 'read_file'],
  ['fs_write_text', 'write_file'],
  ['fs_replace_text', 'edit_block'],
  ['fs_mkdir', 'create_directory'],
  ['fs_copy', 'copy_file'],
  ['fs_move', 'move_file'],
  ['fs_trash', 'trash_path'],
  ['project_run', 'start_process']
]);

const aliasDescriptions = {
  pc_status: 'Return Project Constellation local configuration/status for this computer.',
  pc_processes: 'Return a bounded list of running local processes.',
  fs_stat: 'Return metadata for an allowed local file or directory path.',
  fs_list: 'List an allowed local directory recursively to the requested depth.',
  fs_read_text: 'Read text from an allowed local file.',
  fs_write_text: 'Create, overwrite, or append an allowed local text file.',
  fs_replace_text: 'Replace an exact text block in an allowed local file.',
  fs_mkdir: 'Create an allowed local directory tree.',
  fs_copy: 'Copy an allowed local file or directory.',
  fs_move: 'Move or rename an allowed local file or directory.',
  fs_trash: 'Move an allowed local path to the reversible Project Constellation trash area.',
  project_run: 'Run a local process in an allowed working directory. Use only for explicit user-requested local execution.'
};

function inputSchemaFor(name) {
  const sourceName = aliasMap.get(name) || name;
  const def = toolDefinitions().find(x => x.name === sourceName);
  return def?.inputSchema || { type: 'object', properties: {} };
}

function bridgeToolManifest() {
  const aliases = [...aliasMap.keys()].map(name => ({
    name,
    description: aliasDescriptions[name],
    inputSchema: inputSchemaFor(name)
  }));
  const native = toolDefinitions().filter(def => !['list_devices', 'who_am_i'].includes(def.name)).map(def => ({
    name: def.name,
    description: def.description,
    inputSchema: def.inputSchema || { type: 'object', properties: {} }
  }));
  const seen = new Set();
  return [...aliases, ...native].filter(tool => !seen.has(tool.name) && seen.add(tool.name));
}

const TRUSTED_EXTENSION_ID = 'geljambmkfjkhodgkpjhnmfojkpcamig';
const TRUSTED_EXTENSION_ORIGIN = `chrome-extension://${TRUSTED_EXTENSION_ID}`;

function isTrustedExtensionOrigin(origin) {
  return typeof origin === 'string' && origin.toLowerCase() === TRUSTED_EXTENSION_ORIGIN;
}

function corsHeaders(origin) {
  if (!isTrustedExtensionOrigin(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'vary': 'origin'
  };
}

function sendJson(res, status, value, origin) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    ...corsHeaders(origin)
  });
  res.end(body);
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error('Request body too large'), { statusCode: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Invalid JSON'), { statusCode: 400 }); }
}

export async function createBrowserBridge(options = {}) {
  const loaded = await loadConfig();
  const { config, configPath, dir } = loaded;
  const state = createRuntimeState(dir);
  const handler = createToolHandler({ config, configPath, state });
  const sessions = new Map();
  const handledCallIds = new Map();
  let companionLastSeen = 0;
  let companionVersion = '';
  let companionExtensionId = '';
  let lastDiagnostic = null;
  let lastToolCallAt = null;
  let lastToolResultAt = null;
  const tools = bridgeToolManifest();
  let server;

  function prune() {
    const now = Date.now();
    for (const [token, session] of sessions) if (session.expiresAt <= now) sessions.delete(token);
    for (const [key, expiresAt] of handledCallIds) if (expiresAt <= now) handledCallIds.delete(key);
  }

  function createSession(chatId) {
    prune();
    const token = randomToken(32);
    const nonce = randomToken(24);
    const expiresAt = Date.now() + SESSION_TTL_MS;
    sessions.set(token, { token, nonce, chatId: String(chatId || 'unknown').slice(0, 300), expiresAt, createdAt: Date.now() });
    return { token, nonce, expiresAt };
  }

  function authenticate(req, body) {
    const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
    if (!m) return null;
    prune();
    const session = sessions.get(m[1]);
    if (!session || session.expiresAt <= Date.now()) return null;
    if (body?.nonce && body.nonce !== session.nonce) return null;
    return session;
  }

  async function route(req, res) {
    const origin = req.headers.origin || '';
    if (req.method === 'OPTIONS') {
      if (!isTrustedExtensionOrigin(origin)) return sendJson(res, 403, { ok: false, error: 'Untrusted browser extension origin.' }, origin);
      res.writeHead(204, corsHeaders(origin));
      return res.end();
    }

    const url = new URL(req.url || '/', `http://${LOOPBACK_HOST}`);
    if (url.pathname === '/health' && req.method === 'GET') {
      return sendJson(res, 200, {
        ok: true,
        product: APP_NAME,
        version: VERSION,
        mode: 'normal-chat-loopback',
        host: LOOPBACK_HOST,
        port: options.port || LOOPBACK_PORT,
        sessions: sessions.size,
        companionConnected: companionLastSeen > 0 && Date.now() - companionLastSeen < 15000,
        companionLastSeen: companionLastSeen ? new Date(companionLastSeen).toISOString() : null,
        companionVersion: companionVersion || null,
        companionVersionMatch: Boolean(companionVersion) && companionVersion === VERSION,
        companionExtensionId: companionExtensionId || null,
        lastDiagnostic,
        lastToolCallAt,
        lastToolResultAt,
        computerUseSupported: process.platform === 'win32',
        guiAutomationEnabled: config.enableGuiAutomation === true,
        emergencyLock: config.emergencyLock === true || fs.existsSync(path.join(state.baseDir, 'EMERGENCY-LOCK')),
        quotaEnforced: false,
        at: nowIso()
      }, origin);
    }

    // Browser bootstrap is accepted only from a Chrome extension origin. Ordinary
    // websites, including chatgpt.com itself, cannot mint a local bridge session.
    if (!isTrustedExtensionOrigin(origin)) {
      return sendJson(res, 403, { ok: false, error: 'Only the Project Constellation browser companion may access this bridge.' }, origin);
    }

    if (url.pathname === '/v1/companion/hello' && req.method === 'POST') {
      const body = await readJson(req);
      companionLastSeen = Date.now();
      companionVersion = String(body.version || '');
      companionExtensionId = String(body.extensionId || '');
      const mismatch = companionVersion !== VERSION;
      return sendJson(res, mismatch ? 409 : 200, {
        ok: !mismatch, product: APP_NAME, version: VERSION, companionVersion,
        versionMismatch: mismatch, expectedVersion: VERSION, at: nowIso()
      }, origin);
    }

    if (url.pathname === '/v1/companion/event' && req.method === 'POST') {
      const body = await readJson(req);
      companionLastSeen = Date.now();
      lastDiagnostic = { event: String(body.event || 'unknown').slice(0, 120), detail: body.detail ?? null, at: String(body.at || nowIso()) };
      return sendJson(res, 200, { ok: true, at: nowIso() }, origin);
    }

    if (url.pathname === '/v1/session/bootstrap' && req.method === 'POST') {
      const body = await readJson(req);
      if (!companionVersion || companionVersion !== VERSION) {
        return sendJson(res, 409, {
          ok: false, versionMismatch: true, expectedVersion: VERSION, companionVersion: companionVersion || null,
          error: companionVersion ? `Browser companion ${companionVersion} does not match Project Constellation ${VERSION}. Reload the unpacked extension once.` : 'Browser companion has not completed its version handshake yet.'
        }, origin);
      }
      const session = createSession(body.chatId || body.url || 'unknown');
      return sendJson(res, 200, {
        ok: true,
        sessionToken: session.token,
        nonce: session.nonce,
        expiresAt: new Date(session.expiresAt).toISOString(),
        version: VERSION,
        tools,
        contract: 'For local-PC work, emit exactly one [PC_BUDDY_CALL] JSON wrapper as the whole assistant response, using this nonce and an available tool. For visual desktop work, prefer computer_observe then computer_actions with screenshot_after=true so each action loop returns a fresh image. Wait for the hidden tool-result turn before continuing.'
      }, origin);
    }

    if (url.pathname === '/v1/session/refresh' && req.method === 'POST') {
      const body = await readJson(req);
      const existing = authenticate(req, body);
      if (!existing) return sendJson(res, 401, { ok: false, error: 'Session expired.' }, origin);
      existing.nonce = randomToken(24);
      existing.expiresAt = Date.now() + SESSION_TTL_MS;
      return sendJson(res, 200, {
        ok: true,
        sessionToken: existing.token,
        nonce: existing.nonce,
        expiresAt: new Date(existing.expiresAt).toISOString(),
        version: VERSION,
        tools,
        contract: 'Retry the local call only with this refreshed nonce.'
      }, origin);
    }

    if (url.pathname === '/v1/session/call' && req.method === 'POST') {
      const body = await readJson(req);
      const session = authenticate(req, body);
      if (!session) return sendJson(res, 401, { ok: false, error: 'Session or nonce is invalid/expired.', refresh: true }, origin);
      const callId = String(body.id || '').trim();
      const tool = String(body.tool || '').trim();
      if (!callId || !tool) return sendJson(res, 400, { ok: false, error: 'id and tool are required.' }, origin);
      const dedupeKey = `${session.token}:${callId}`;
      if (handledCallIds.has(dedupeKey)) return sendJson(res, 409, { ok: false, error: 'Duplicate local call id.' }, origin);
      handledCallIds.set(dedupeKey, Date.now() + SESSION_TTL_MS);
      const sourceTool = aliasMap.get(tool) || tool;
      const available = tools.some(x => x.name === tool);
      if (!available) return sendJson(res, 404, { ok: false, error: `Tool not available: ${tool}` }, origin);
      try {
        lastToolCallAt = nowIso();
        const result = await handler(sourceTool, body.args || {},{owner:`browser:${crypto.createHash('sha256').update(session.token).digest('hex')}`,canContinue:()=>{if(config.localToolMode==='off'||config.emergencyLock)throw new Error('Browser computer access stopped');}});
        lastToolResultAt = nowIso();
        return sendJson(res, 200, { ok: true, id: callId, tool, result }, origin);
      } catch (error) {
        lastToolResultAt = nowIso();
        return sendJson(res, 500, { ok: false, id: callId, tool, error: String(error?.message || error) }, origin);
      }
    }

    sendJson(res, 404, { ok: false, error: 'Not found.' }, origin);
  }

  server = http.createServer((req, res) => {
    route(req, res).catch(error => sendJson(res, error.statusCode || 500, { ok: false, error: String(error?.message || error) }, req.headers.origin || ''));
  });

  return {
    host: options.host || LOOPBACK_HOST,
    port: options.port || LOOPBACK_PORT,
    tools,
    async start() {
      const host = options.host || LOOPBACK_HOST;
      const port = options.port || LOOPBACK_PORT;
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => { server.off('error', reject); resolve(); });
      });
      return server.address();
    },
    async stop() {
      await new Promise(resolve => server.close(() => resolve()));
    }
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const bridge = await createBrowserBridge();
  await bridge.start();
  console.log(`[${APP_NAME}] Normal-chat bridge ready at http://${bridge.host}:${bridge.port}`);
  console.log(`[${APP_NAME}] Waiting for Project Constellation browser companion.`);
  const shutdown = async () => { await bridge.stop(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
