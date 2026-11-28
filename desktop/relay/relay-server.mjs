#!/usr/bin/env node
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import fsp from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { toolDefinitions } from '../src/tool-definitions.mjs';
import { APP_NAME, VERSION } from '../src/config.mjs';

const now = () => new Date().toISOString();
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
const sha256 = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const b64sha256 = value => crypto.createHash('sha256').update(String(value)).digest('base64url');
const safeEqual = (a, b) => {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function envInt(name, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback;
}

function normalizeBaseUrl(value, port) {
  const raw = value || `http://127.0.0.1:${port}`;
  return raw.replace(/\/+$/, '');
}

function defaultState() {
  return {
    schema: 1,
    createdAt: now(),
    updatedAt: now(),
    devices: {},
    pairings: {},
    oauthClients: {},
    authCodes: {},
    accessTokens: {},
    refreshTokens: {},
    usage: { totalCalls: 0, errors: 0, byTool: {} },
    recentCalls: []
  };
}

function pruneState(state) {
  const t = Date.now();
  const expires = obj => !obj?.expiresAt || Date.parse(obj.expiresAt) <= t;
  for (const [key, value] of Object.entries(state.pairings || {})) if (expires(value)) delete state.pairings[key];
  for (const [key, value] of Object.entries(state.authCodes || {})) if (expires(value)) delete state.authCodes[key];
  for (const [key, value] of Object.entries(state.accessTokens || {})) if (expires(value)) delete state.accessTokens[key];
  for (const [key, value] of Object.entries(state.refreshTokens || {})) if (expires(value)) delete state.refreshTokens[key];
  state.recentCalls = (state.recentCalls || []).slice(-1000);
}

async function readJsonBody(req, maxBytes) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      const err = new Error('Request body too large');
      err.statusCode = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try { return JSON.parse(text); }
  catch {
    const err = new Error('Invalid JSON body');
    err.statusCode = 400;
    throw err;
  }
}

async function readFormBody(req, maxBytes) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      const err = new Error('Request body too large');
      err.statusCode = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

function sendJson(res, status, value, headers = {}) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    ...headers
  });
  res.end(body);
}

function sendText(res, status, value, contentType = 'text/plain; charset=utf-8', headers = {}) {
  const body = String(value);
  res.writeHead(status, {
    'content-type': contentType,
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    ...headers
  });
  res.end(body);
}

function htmlEscape(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function appendQuery(urlString, params) {
  const u = new URL(urlString);
  for (const [key, value] of Object.entries(params)) if (value != null && value !== '') u.searchParams.set(key, value);
  return u.toString();
}

function bearer(req) {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1] : null;
}

function isChatGptRedirect(uri) {
  if (uri === 'https://chatgpt.com/connector_platform_oauth_redirect') return true;
  return /^https:\/\/chatgpt\.com\/connector\/oauth\/[A-Za-z0-9._~-]+$/.test(uri);
}

function validateRedirect(client, redirectUri) {
  if (!redirectUri) return false;
  if (client?.clientId === 'https://chatgpt.com/oauth/client.json') return isChatGptRedirect(redirectUri);
  return Array.isArray(client?.redirectUris) && client.redirectUris.includes(redirectUri);
}

function transformToolDefinitions() {
  const relayTools = new Set(['list_devices', 'who_am_i', 'get_usage_stats', 'get_recent_tool_calls']);
  return toolDefinitions().map(def => {
    if (relayTools.has(def.name)) return def;
    const schema = structuredClone(def.inputSchema || { type: 'object', properties: {} });
    schema.type ||= 'object';
    schema.properties ||= {};
    schema.properties.deviceId = {
      type: 'string',
      description: 'Optional connected Constellation Commander device ID. Required when more than one device is online.'
    };
    return {
      ...def,
      description: def.description + ' The relay forwards this call to the authorized device agent.',
      inputSchema: schema
    };
  });
}

export async function createRelayServer(options = {}) {
  const port = options.port ?? envInt('PORT', 8787, 0, 65535);
  const publicBaseUrl = normalizeBaseUrl(options.publicBaseUrl || process.env.PUBLIC_BASE_URL, port);
  const ownerPassword = options.ownerPassword ?? process.env.CONSTELLATION_RELAY_OWNER_PASSWORD ?? process.env.OWNER_PASSWORD;
  if (!ownerPassword) throw new Error('CONSTELLATION_RELAY_OWNER_PASSWORD (or OWNER_PASSWORD) is required.');
  const dataDir = options.dataDir || process.env.CONSTELLATION_RELAY_DATA || path.join(os.homedir(), '.constellation-commander-relay');
  const statePath = path.join(dataDir, 'relay-state.json');
  const bodyLimit = options.bodyLimit ?? envInt('CONSTELLATION_RELAY_BODY_LIMIT', 8 * 1024 * 1024, 64 * 1024, 64 * 1024 * 1024);
  const jobTimeoutMs = options.jobTimeoutMs ?? envInt('CONSTELLATION_RELAY_JOB_TIMEOUT_MS', 300000, 5000, 30 * 60 * 1000);
  const onlineWindowMs = options.onlineWindowMs ?? envInt('CONSTELLATION_RELAY_ONLINE_WINDOW_MS', 70000, 10000, 10 * 60 * 1000);
  const longPollMs = options.longPollMs ?? envInt('CONSTELLATION_RELAY_LONG_POLL_MS', 25000, 1000, 30000);

  await fsp.mkdir(dataDir, { recursive: true });
  let state = defaultState();
  try { state = { ...state, ...JSON.parse((await fsp.readFile(statePath, 'utf8')).replace(/^\uFEFF/, '')) }; } catch {}
  state.devices ||= {};
  state.pairings ||= {};
  state.oauthClients ||= {};
  state.authCodes ||= {};
  state.accessTokens ||= {};
  state.refreshTokens ||= {};
  state.usage ||= { totalCalls: 0, errors: 0, byTool: {} };
  state.recentCalls ||= [];

  let saveChain = Promise.resolve();
  const save = () => {
    state.updatedAt = now();
    pruneState(state);
    const snapshot = JSON.stringify(state, null, 2);
    saveChain = saveChain.then(async () => {
      const temp = `${statePath}.${process.pid}.tmp`;
      await fsp.writeFile(temp, snapshot, { mode: 0o600 });
      await fsp.rename(temp, statePath);
    });
    return saveChain;
  };
  await save();

  const queues = new Map();
  const pollWaiters = new Map();
  const pendingJobs = new Map();
  let closed = false;

  const getClient = clientId => {
    if (clientId === 'https://chatgpt.com/oauth/client.json') {
      return {
        clientId,
        clientName: 'ChatGPT',
        redirectUris: ['https://chatgpt.com/connector_platform_oauth_redirect'],
        tokenEndpointAuthMethod: 'none',
        builtin: true
      };
    }
    return state.oauthClients[clientId] || null;
  };

  const isOnline = device => Boolean(device && device.lastSeen && Date.now() - Date.parse(device.lastSeen) <= onlineWindowMs);

  function deviceRows() {
    return Object.values(state.devices).map(d => ({
      id: d.id,
      name: d.name,
      platform: d.platform,
      arch: d.arch,
      version: d.version,
      status: isOnline(d) ? 'online' : 'offline',
      lastSeen: d.lastSeen,
      pairedAt: d.pairedAt
    }));
  }

  function onlineDevices() {
    return deviceRows().filter(d => d.status === 'online');
  }

  function validateDeviceToken(token) {
    if (!token) return null;
    const hash = sha256(token);
    return Object.values(state.devices).find(d => d.tokenHash === hash) || null;
  }

  function validateAccessToken(token) {
    if (!token) return null;
    const record = state.accessTokens[sha256(token)];
    if (!record || Date.parse(record.expiresAt) <= Date.now()) return null;
    return record;
  }

  function relayChallenge(res) {
    const metadata = `${publicBaseUrl}/.well-known/oauth-protected-resource`;
    sendJson(res, 401, { error: 'invalid_token', error_description: 'OAuth bearer token required.' }, {
      'www-authenticate': `Bearer resource_metadata="${metadata}"`
    });
  }

  function touchDevice(device, extra = {}) {
    Object.assign(device, extra, { lastSeen: now() });
    save().catch(() => {});
  }

  function dispatchQueued(deviceId) {
    const waiter = pollWaiters.get(deviceId);
    const queue = queues.get(deviceId) || [];
    if (!waiter || queue.length === 0) return;
    pollWaiters.delete(deviceId);
    clearTimeout(waiter.timer);
    const job = queue.shift();
    queues.set(deviceId, queue);
    sendJson(waiter.res, 200, { job });
  }

  function enqueueJob(deviceId, name, args) {
    return new Promise((resolve, reject) => {
      const jobId = `job_${randomToken(12)}`;
      const job = { id: jobId, tool: name, args, createdAt: now() };
      const timer = setTimeout(() => {
        pendingJobs.delete(jobId);
        reject(new Error(`Device job timed out after ${jobTimeoutMs} ms`));
      }, jobTimeoutMs);
      timer.unref?.();
      pendingJobs.set(jobId, { deviceId, resolve, reject, timer, createdAt: Date.now() });
      const queue = queues.get(deviceId) || [];
      queue.push(job);
      queues.set(deviceId, queue);
      dispatchQueued(deviceId);
    });
  }

  function selectDevice(args = {}) {
    const requested = args.deviceId;
    if (requested) {
      const device = state.devices[requested];
      if (!device) throw new Error(`Unknown deviceId: ${requested}`);
      if (!isOnline(device)) throw new Error(`Device is offline: ${requested}`);
      return device;
    }
    const online = Object.values(state.devices).filter(isOnline);
    if (online.length === 0) throw new Error('No Constellation Commander device is online.');
    if (online.length > 1) throw new Error('More than one device is online; specify deviceId.');
    return online[0];
  }

  async function recordRelayCall({ tool, ok, deviceId = null, durationMs = 0, error = null, result = null }) {
    state.usage.totalCalls = (state.usage.totalCalls || 0) + 1;
    state.usage.byTool ||= {};
    state.usage.byTool[tool] = (state.usage.byTool[tool] || 0) + 1;
    if (!ok) state.usage.errors = (state.usage.errors || 0) + 1;
    const resultSummary = result == null ? null : JSON.stringify(result).slice(0, 1500);
    state.recentCalls.push({ ts: now(), tool, ok, deviceId, durationMs, error, resultSummary });
    state.recentCalls = state.recentCalls.slice(-1000);
    await save();
  }

  async function callTool(name, args = {}) {
    const started = Date.now();
    let deviceId = args.deviceId || null;
    try {
      let result;
      if (name === 'list_devices') {
        result = { devices: deviceRows(), knownDeviceCount: Object.keys(state.devices).length };
      } else if (name === 'who_am_i') {
        result = {
          app: APP_NAME,
          version: VERSION,
          mode: 'self-hosted-plugin-relay',
          accountRequired: true,
          transport: 'OAuth 2.1 + outbound device agent',
          openAiApiKeyRequired: false,
          quotaEnforced: false,
          quota: null,
          onlineDevices: onlineDevices().length
        };
      } else if (name === 'get_usage_stats') {
        result = {
          ...state.usage,
          quotaEnforced: false,
          quota: null,
          message: 'Diagnostics only. Constellation Commander does not impose a tool-call quota.'
        };
      } else if (name === 'get_recent_tool_calls') {
        const max = Math.min(1000, Math.max(1, Number(args.max_results || 50)));
        result = { calls: state.recentCalls.slice(-max) };
      } else {
        const device = selectDevice(args);
        deviceId = device.id;
        const forwardedArgs = { ...args };
        delete forwardedArgs.deviceId;
        result = await enqueueJob(device.id, name, forwardedArgs);
      }
      await recordRelayCall({ tool: name, ok: true, deviceId, durationMs: Date.now() - started, result });
      return result;
    } catch (error) {
      await recordRelayCall({ tool: name, ok: false, deviceId, durationMs: Date.now() - started, error: String(error.message || error) });
      throw error;
    }
  }

  function issueTokens({ subject = 'owner', clientId, resource, scope = 'computer:read computer:write' }) {
    const access = randomToken(32);
    const refresh = randomToken(40);
    const accessRecord = {
      subject, clientId, resource, scope,
      issuedAt: now(),
      expiresAt: new Date(Date.now() + 3600_000).toISOString()
    };
    const refreshRecord = {
      subject, clientId, resource, scope,
      issuedAt: now(),
      expiresAt: new Date(Date.now() + 30 * 24 * 3600_000).toISOString()
    };
    state.accessTokens[sha256(access)] = accessRecord;
    state.refreshTokens[sha256(refresh)] = refreshRecord;
    return { access, refresh, accessRecord, refreshRecord };
  }

  async function authorizeFromParams(params) {
    const responseType = params.get('response_type');
    const clientId = params.get('client_id');
    const redirectUri = params.get('redirect_uri');
    const codeChallenge = params.get('code_challenge');
    const codeChallengeMethod = params.get('code_challenge_method');
    const stateParam = params.get('state') || '';
    const resource = params.get('resource') || `${publicBaseUrl}/mcp`;
    const scope = params.get('scope') || 'computer:read computer:write';
    const client = getClient(clientId);
    if (responseType !== 'code') throw Object.assign(new Error('response_type must be code'), { statusCode: 400 });
    if (!client) throw Object.assign(new Error('Unknown OAuth client'), { statusCode: 400 });
    if (!validateRedirect(client, redirectUri)) throw Object.assign(new Error('redirect_uri is not allowed'), { statusCode: 400 });
    if (!codeChallenge || codeChallengeMethod !== 'S256') throw Object.assign(new Error('PKCE S256 is required'), { statusCode: 400 });
    if (resource !== `${publicBaseUrl}/mcp`) throw Object.assign(new Error('resource must exactly match the MCP resource'), { statusCode: 400 });
    return { client, clientId, redirectUri, codeChallenge, stateParam, resource, scope };
  }

  async function route(req, res) {
    const url = new URL(req.url, publicBaseUrl);
    const pathname = url.pathname;

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,POST,OPTIONS',
        'access-control-allow-headers': 'authorization,content-type,mcp-protocol-version,mcp-session-id'
      });
      res.end();
      return;
    }

    if (req.method === 'GET' && pathname === '/health') {
      return sendJson(res, 200, {
        ok: true,
        app: APP_NAME,
        version: VERSION,
        mode: 'relay',
        publicBaseUrl,
        onlineDevices: onlineDevices().length,
        quotaEnforced: false,
        now: now()
      });
    }

    if (req.method === 'GET' && pathname === '/.well-known/oauth-protected-resource') {
      return sendJson(res, 200, {
        resource: `${publicBaseUrl}/mcp`,
        authorization_servers: [publicBaseUrl],
        bearer_methods_supported: ['header'],
        scopes_supported: ['computer:read', 'computer:write']
      });
    }

    if (req.method === 'GET' && (pathname === '/.well-known/oauth-authorization-server' || pathname === '/.well-known/openid-configuration')) {
      return sendJson(res, 200, {
        issuer: publicBaseUrl,
        authorization_endpoint: `${publicBaseUrl}/oauth/authorize`,
        token_endpoint: `${publicBaseUrl}/oauth/token`,
        registration_endpoint: `${publicBaseUrl}/oauth/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
        scopes_supported: ['computer:read', 'computer:write'],
        authorization_response_iss_parameter_supported: true
      });
    }

    if (req.method === 'POST' && pathname === '/oauth/register') {
      const body = await readJsonBody(req, bodyLimit);
      const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter(x => typeof x === 'string') : [];
      if (redirectUris.length === 0) return sendJson(res, 400, { error: 'invalid_redirect_uri' });
      if (body.token_endpoint_auth_method && body.token_endpoint_auth_method !== 'none') return sendJson(res, 400, { error: 'invalid_client_metadata', error_description: 'Only public PKCE clients are supported.' });
      const clientId = `${publicBaseUrl}/oauth/client/${randomToken(18)}`;
      state.oauthClients[clientId] = {
        clientId,
        clientName: String(body.client_name || 'MCP client').slice(0, 200),
        redirectUris,
        tokenEndpointAuthMethod: 'none',
        createdAt: now()
      };
      await save();
      return sendJson(res, 201, {
        client_id: clientId,
        client_name: state.oauthClients[clientId].clientName,
        redirect_uris: redirectUris,
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code']
      });
    }

    if (req.method === 'GET' && pathname === '/oauth/authorize') {
      const auth = await authorizeFromParams(url.searchParams);
      const hidden = [
        ['response_type', 'code'], ['client_id', auth.clientId], ['redirect_uri', auth.redirectUri],
        ['code_challenge', auth.codeChallenge], ['code_challenge_method', 'S256'],
        ['state', auth.stateParam], ['resource', auth.resource], ['scope', auth.scope]
      ].map(([k, v]) => `<input type="hidden" name="${htmlEscape(k)}" value="${htmlEscape(v)}" />`).join('\n');
      const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Authorize Constellation Commander</title><style>body{font-family:system-ui;margin:0;background:#111827;color:#f9fafb;display:grid;min-height:100vh;place-items:center}.card{width:min(560px,calc(100% - 32px));background:#1f2937;padding:28px;border-radius:16px;box-shadow:0 20px 60px #0008}input,button{box-sizing:border-box;width:100%;padding:12px;margin-top:12px;border-radius:10px;border:1px solid #4b5563}input{background:#111827;color:#fff}button{background:#f9fafb;color:#111827;font-weight:700;cursor:pointer}.muted{color:#9ca3af;font-size:14px}</style></head><body><main class="card"><h1>Authorize Constellation Commander</h1><p>Allow <strong>${htmlEscape(auth.client.clientName)}</strong> to use your paired computer through this self-hosted relay.</p><p class="muted">No OpenAI API key is required by Constellation Commander. The relay does not impose a tool-call quota.</p><form method="post" action="/oauth/authorize">${hidden}<label>Relay owner password<input type="password" name="owner_password" autocomplete="current-password" required autofocus></label><button type="submit">Authorize</button></form></main></body></html>`;
      return sendText(res, 200, page, 'text/html; charset=utf-8');
    }

    if (req.method === 'POST' && pathname === '/oauth/authorize') {
      const form = await readFormBody(req, bodyLimit);
      const auth = await authorizeFromParams(form);
      if (!safeEqual(form.get('owner_password') || '', ownerPassword)) return sendText(res, 403, 'Invalid owner password.');
      const code = randomToken(32);
      state.authCodes[sha256(code)] = {
        clientId: auth.clientId,
        redirectUri: auth.redirectUri,
        codeChallenge: auth.codeChallenge,
        resource: auth.resource,
        scope: auth.scope,
        issuedAt: now(),
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString()
      };
      await save();
      const location = appendQuery(auth.redirectUri, { code, state: auth.stateParam, iss: publicBaseUrl });
      res.writeHead(302, { location, 'cache-control': 'no-store' });
      res.end();
      return;
    }

    if (req.method === 'POST' && pathname === '/oauth/token') {
      const form = await readFormBody(req, bodyLimit);
      const grantType = form.get('grant_type');
      if (grantType === 'authorization_code') {
        const code = form.get('code') || '';
        const rec = state.authCodes[sha256(code)];
        if (!rec || Date.parse(rec.expiresAt) <= Date.now()) return sendJson(res, 400, { error: 'invalid_grant' });
        const clientId = form.get('client_id');
        const redirectUri = form.get('redirect_uri');
        const verifier = form.get('code_verifier') || '';
        const resource = form.get('resource') || rec.resource;
        if (clientId !== rec.clientId || redirectUri !== rec.redirectUri || resource !== rec.resource || b64sha256(verifier) !== rec.codeChallenge) return sendJson(res, 400, { error: 'invalid_grant' });
        delete state.authCodes[sha256(code)];
        const tokens = issueTokens({ clientId, resource, scope: rec.scope });
        await save();
        return sendJson(res, 200, {
          access_token: tokens.access,
          token_type: 'Bearer',
          expires_in: 3600,
          refresh_token: tokens.refresh,
          scope: rec.scope,
          resource
        });
      }
      if (grantType === 'refresh_token') {
        const refresh = form.get('refresh_token') || '';
        const hash = sha256(refresh);
        const rec = state.refreshTokens[hash];
        if (!rec || Date.parse(rec.expiresAt) <= Date.now()) return sendJson(res, 400, { error: 'invalid_grant' });
        const clientId = form.get('client_id');
        if (clientId !== rec.clientId) return sendJson(res, 400, { error: 'invalid_client' });
        delete state.refreshTokens[hash];
        const tokens = issueTokens({ subject: rec.subject, clientId, resource: rec.resource, scope: rec.scope });
        await save();
        return sendJson(res, 200, {
          access_token: tokens.access,
          token_type: 'Bearer',
          expires_in: 3600,
          refresh_token: tokens.refresh,
          scope: rec.scope,
          resource: rec.resource
        });
      }
      return sendJson(res, 400, { error: 'unsupported_grant_type' });
    }

    if (req.method === 'POST' && pathname === '/device/pair/start') {
      const body = await readJsonBody(req, bodyLimit);
      const deviceCode = randomToken(24);
      const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let userCode = '';
      for (let i = 0; i < 8; i++) userCode += alphabet[crypto.randomInt(alphabet.length)];
      userCode = `${userCode.slice(0, 4)}-${userCode.slice(4)}`;
      state.pairings[sha256(deviceCode)] = {
        deviceCodeHash: sha256(deviceCode),
        userCode,
        name: String(body.device_name || 'Windows PC').slice(0, 200),
        platform: String(body.platform || 'unknown').slice(0, 100),
        arch: String(body.arch || '').slice(0, 100),
        version: String(body.version || VERSION).slice(0, 100),
        approved: false,
        createdAt: now(),
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString()
      };
      await save();
      return sendJson(res, 200, {
        device_code: deviceCode,
        user_code: userCode,
        verification_uri: `${publicBaseUrl}/device/verify`,
        verification_uri_complete: `${publicBaseUrl}/device/verify?user_code=${encodeURIComponent(userCode)}`,
        expires_in: 900,
        interval: 2
      });
    }

    if (req.method === 'GET' && pathname === '/device/verify') {
      const userCode = url.searchParams.get('user_code') || '';
      const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pair Constellation Commander</title><style>body{font-family:system-ui;margin:0;background:#111827;color:#f9fafb;display:grid;min-height:100vh;place-items:center}.card{width:min(520px,calc(100% - 32px));background:#1f2937;padding:28px;border-radius:16px}input,button{box-sizing:border-box;width:100%;padding:12px;margin-top:12px;border-radius:10px;border:1px solid #4b5563}input{background:#111827;color:#fff}button{font-weight:700;cursor:pointer}</style></head><body><main class="card"><h1>Pair a computer</h1><form method="post" action="/device/verify"><label>Pairing code<input name="user_code" value="${htmlEscape(userCode)}" required></label><label>Relay owner password<input type="password" name="owner_password" required></label><button type="submit">Approve device</button></form></main></body></html>`;
      return sendText(res, 200, page, 'text/html; charset=utf-8');
    }

    if (req.method === 'POST' && pathname === '/device/verify') {
      const form = await readFormBody(req, bodyLimit);
      if (!safeEqual(form.get('owner_password') || '', ownerPassword)) return sendText(res, 403, 'Invalid owner password.');
      const userCode = String(form.get('user_code') || '').trim().toUpperCase();
      const pair = Object.values(state.pairings).find(p => p.userCode === userCode && Date.parse(p.expiresAt) > Date.now());
      if (!pair) return sendText(res, 404, 'Pairing code not found or expired.');
      if (!pair.approved) {
        const deviceId = `device_${randomToken(12)}`;
        const deviceToken = randomToken(40);
        pair.approved = true;
        pair.approvedAt = now();
        pair.deviceId = deviceId;
        pair.deviceToken = deviceToken;
        state.devices[deviceId] = {
          id: deviceId,
          name: pair.name,
          platform: pair.platform,
          arch: pair.arch,
          version: pair.version,
          tokenHash: sha256(deviceToken),
          pairedAt: now(),
          lastSeen: null
        };
        await save();
      }
      return sendText(res, 200, `Device approved: ${pair.name}. You can close this tab.`);
    }

    if (req.method === 'POST' && pathname === '/device/pair/token') {
      const body = await readJsonBody(req, bodyLimit);
      const hash = sha256(body.device_code || '');
      const pair = state.pairings[hash];
      if (!pair || Date.parse(pair.expiresAt) <= Date.now()) return sendJson(res, 400, { error: 'expired_token' });
      if (!pair.approved) return sendJson(res, 428, { error: 'authorization_pending' });
      const response = { device_id: pair.deviceId, device_token: pair.deviceToken };
      delete state.pairings[hash];
      await save();
      return sendJson(res, 200, response);
    }

    if (req.method === 'POST' && pathname === '/device/poll') {
      const device = validateDeviceToken(bearer(req));
      if (!device) return sendJson(res, 401, { error: 'invalid_device_token' });
      let body = {};
      try { body = await readJsonBody(req, bodyLimit); } catch {}
      touchDevice(device, {
        name: String(body.device_name || device.name).slice(0, 200),
        platform: String(body.platform || device.platform).slice(0, 100),
        arch: String(body.arch || device.arch || '').slice(0, 100),
        version: String(body.version || device.version).slice(0, 100)
      });
      const queue = queues.get(device.id) || [];
      if (queue.length) {
        const job = queue.shift();
        queues.set(device.id, queue);
        return sendJson(res, 200, { job });
      }
      const old = pollWaiters.get(device.id);
      if (old) {
        clearTimeout(old.timer);
        sendJson(old.res, 409, { error: 'superseded_poll' });
      }
      const timer = setTimeout(() => {
        if (pollWaiters.get(device.id)?.res === res) pollWaiters.delete(device.id);
        if (!res.writableEnded) sendJson(res, 200, { job: null, retry_after_ms: 150 });
      }, longPollMs);
      timer.unref?.();
      pollWaiters.set(device.id, { res, timer });
      req.on('close', () => {
        const current = pollWaiters.get(device.id);
        if (current?.res === res) {
          clearTimeout(current.timer);
          pollWaiters.delete(device.id);
        }
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/device/result') {
      const device = validateDeviceToken(bearer(req));
      if (!device) return sendJson(res, 401, { error: 'invalid_device_token' });
      touchDevice(device);
      const body = await readJsonBody(req, bodyLimit);
      const pending = pendingJobs.get(body.job_id);
      if (!pending || pending.deviceId !== device.id) return sendJson(res, 404, { error: 'unknown_job' });
      clearTimeout(pending.timer);
      pendingJobs.delete(body.job_id);
      if (body.ok) pending.resolve(body.result);
      else pending.reject(new Error(String(body.error || 'Device tool call failed')));
      return sendJson(res, 200, { accepted: true });
    }

    if (req.method === 'POST' && pathname === '/mcp') {
      const auth = validateAccessToken(bearer(req));
      if (!auth) return relayChallenge(res);
      if (auth.resource !== `${publicBaseUrl}/mcp`) return relayChallenge(res);
      const message = await readJsonBody(req, bodyLimit);
      const id = message.id ?? null;
      const method = message.method;
      const protocolVersion = req.headers['mcp-protocol-version'] || message.params?.protocolVersion || '2025-06-18';
      const headers = { 'mcp-protocol-version': String(protocolVersion), 'mcp-session-id': `cc_${sha256(auth.clientId).slice(0, 20)}` };
      const ok = result => sendJson(res, 200, { jsonrpc: '2.0', id, result }, headers);
      const fail = (code, msg, data) => sendJson(res, 200, { jsonrpc: '2.0', id, error: { code, message: msg, ...(data ? { data } : {}) } }, headers);
      try {
        if (method === 'initialize') return ok({ protocolVersion: message.params?.protocolVersion || '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'constellation-commander-relay', version: VERSION }, instructions: 'Self-hosted normal-chat computer commander. No plugin-side tool-call quota. Use list_devices before selecting a device when needed.' });
        if (method === 'notifications/initialized') { res.writeHead(202, headers); return res.end(); }
        if (method === 'ping') return ok({});
        if (method === 'server/discover') return ok({ name: 'constellation-commander-relay', version: VERSION, protocolVersions: ['2026-07-28', '2025-06-18', '2025-03-26'], capabilities: { tools: true } });
        if (method === 'tools/list') return ok({ tools: transformToolDefinitions() });
        if (method === 'tools/call') {
          const name = message.params?.name;
          const args = message.params?.arguments || {};
          const result = await callTool(name, args);
          const attachments = Array.isArray(result?._attachments) ? result._attachments : [];
          const structured = (result && typeof result === 'object') ? { ...result } : result;
          if (structured && typeof structured === 'object') delete structured._attachments;
          const content = [{ type: 'text', text: JSON.stringify(structured, null, 2) }];
          for (const attachment of attachments) {
            if (attachment?.base64 && attachment?.mimeType?.startsWith('image/')) content.push({ type: 'image', data: attachment.base64, mimeType: attachment.mimeType });
          }
          return ok({ content, structuredContent: structured, isError: false });
        }
        return fail(-32601, `Method not found: ${method}`);
      } catch (error) {
        return fail(-32000, String(error.message || error));
      }
    }

    sendJson(res, 404, { error: 'not_found' });
  }

  const server = http.createServer((req, res) => {
    route(req, res).catch(error => {
      if (res.writableEnded) return;
      const status = Number(error.statusCode || 500);
      sendJson(res, status, { error: status >= 500 ? 'internal_error' : 'bad_request', message: String(error.message || error) });
    });
  });
  server.keepAliveTimeout = 70_000;
  server.headersTimeout = 75_000;
  server.requestTimeout = Math.max(jobTimeoutMs + 30_000, 330_000);

  return {
    state,
    statePath,
    publicBaseUrl,
    port,
    server,
    transformToolDefinitions,
    async listen(host = options.host || process.env.HOST || '127.0.0.1') {
      if (server.listening) return server.address();
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, resolve);
      });
      return server.address();
    },
    async close() {
      closed = true;
      for (const waiter of pollWaiters.values()) {
        clearTimeout(waiter.timer);
        if (!waiter.res.writableEnded) sendJson(waiter.res, 503, { error: 'relay_shutting_down' });
      }
      pollWaiters.clear();
      for (const pending of pendingJobs.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error('Relay shutting down'));
      }
      pendingJobs.clear();
      await save();
      if (server.listening) await new Promise(resolve => server.close(resolve));
    },
    get closed() { return closed; }
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const relay = await createRelayServer();
  const address = await relay.listen();
  const actualPort = typeof address === 'object' && address ? address.port : relay.port;
  console.log(`Constellation Commander Relay ${VERSION}`);
  console.log(`Listening: ${relay.publicBaseUrl} (local port ${actualPort})`);
  console.log(`MCP: ${relay.publicBaseUrl}/mcp`);
  console.log('Quota: none enforced by Constellation Commander');
  const stop = async () => { await relay.close(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
