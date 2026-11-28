import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { createRelayServer } from '../relay/relay-server.mjs';

const port = 22000 + crypto.randomInt(10000);
const base = `http://127.0.0.1:${port}`;
const dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cc-relay-smoke-'));
const ownerPassword = `test-${crypto.randomBytes(12).toString('hex')}`;
const relay = await createRelayServer({ port, publicBaseUrl: base, ownerPassword, dataDir, longPollMs: 1500, jobTimeoutMs: 5000 });
await relay.listen();

const json = async (url, options = {}, statuses = [200]) => {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  assert.ok(statuses.includes(response.status), `${url} expected ${statuses.join(',')} got ${response.status}: ${text}`);
  return { response, body };
};

try {
  const health = await json(`${base}/health`);
  assert.equal(health.body.quotaEnforced, false);

  const unauthorized = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
  });
  assert.equal(unauthorized.status, 401);
  assert.match(unauthorized.headers.get('www-authenticate') || '', /oauth-protected-resource/);

  const pairStart = await json(`${base}/device/pair/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ device_name: 'Smoke PC', platform: 'win32', arch: 'x64', version: '0.7.4' })
  });
  assert.match(pairStart.body.user_code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);

  const approveForm = new URLSearchParams({ user_code: pairStart.body.user_code, owner_password: ownerPassword });
  const approved = await fetch(`${base}/device/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: approveForm
  });
  assert.equal(approved.status, 200);

  const pairToken = await json(`${base}/device/pair/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ device_code: pairStart.body.device_code })
  });
  assert.match(pairToken.body.device_id, /^device_/);
  assert.ok(pairToken.body.device_token.length > 30);

  const registered = await json(`${base}/oauth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Smoke Client',
      redirect_uris: ['https://example.invalid/callback'],
      token_endpoint_auth_method: 'none'
    })
  }, [201]);
  assert.ok(registered.body.client_id.startsWith(base));

  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const redirectUri = 'https://chatgpt.com/connector_platform_oauth_redirect';
  const authForm = new URLSearchParams({
    response_type: 'code',
    client_id: 'https://chatgpt.com/oauth/client.json',
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'smoke-state',
    resource: `${base}/mcp`,
    scope: 'computer:read computer:write',
    owner_password: ownerPassword
  });
  const auth = await fetch(`${base}/oauth/authorize`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: authForm,
    redirect: 'manual'
  });
  assert.equal(auth.status, 302);
  const redirect = new URL(auth.headers.get('location'));
  assert.equal(redirect.searchParams.get('state'), 'smoke-state');
  assert.equal(redirect.searchParams.get('iss'), base);
  const code = redirect.searchParams.get('code');
  assert.ok(code);

  const token = await json(`${base}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: 'https://chatgpt.com/oauth/client.json',
      code_verifier: verifier,
      resource: `${base}/mcp`
    })
  });
  assert.equal(token.body.token_type, 'Bearer');
  assert.ok(token.body.access_token);
  assert.ok(token.body.refresh_token);

  const mcp = async message => json(`${base}/mcp`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token.body.access_token}`, 'content-type': 'application/json', 'mcp-protocol-version': '2025-06-18' },
    body: JSON.stringify(message)
  });

  const init = await mcp({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } } });
  assert.equal(init.body.result.serverInfo.name, 'constellation-commander-relay');

  const list = await mcp({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  const pingDef = list.body.result.tools.find(tool => tool.name === 'ping');
  assert.ok(pingDef.inputSchema.properties.deviceId, 'remote tools must expose optional deviceId');
  assert.ok(list.body.result.tools.length >= 30);

  const devices = await mcp({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_devices', arguments: {} } });
  assert.equal(devices.body.result.structuredContent.devices.length, 1);
  assert.equal(devices.body.result.structuredContent.devices[0].id, pairToken.body.device_id);

  const pollPromise = json(`${base}/device/poll`, {
    method: 'POST',
    headers: { authorization: `Bearer ${pairToken.body.device_token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ device_name: 'Smoke PC', platform: 'win32', arch: 'x64', version: '0.7.4' })
  });
  await new Promise(resolve => setTimeout(resolve, 25));
  const callPromise = mcp({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'ping', arguments: {} } });
  const polled = await pollPromise;
  assert.equal(polled.body.job.tool, 'ping');
  assert.equal(polled.body.job.args.deviceId, undefined);
  await json(`${base}/device/result`, {
    method: 'POST',
    headers: { authorization: `Bearer ${pairToken.body.device_token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ job_id: polled.body.job.id, ok: true, result: { pong: true, from: 'Smoke PC' } })
  });
  const called = await callPromise;
  assert.equal(called.body.result.structuredContent.pong, true);
  assert.equal(called.body.result.structuredContent.from, 'Smoke PC');

  const shotPollPromise = json(`${base}/device/poll`, {
    method: 'POST',
    headers: { authorization: `Bearer ${pairToken.body.device_token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ device_name: 'Smoke PC', platform: 'win32', arch: 'x64', version: '0.7.4' })
  });
  await new Promise(resolve => setTimeout(resolve, 25));
  const shotCallPromise = mcp({ jsonrpc: '2.0', id: 40, method: 'tools/call', params: { name: 'computer_screenshot', arguments: { target: 'all' } } });
  const shotPolled = await shotPollPromise;
  assert.equal(shotPolled.body.job.tool, 'computer_screenshot');
  const fakeImage = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl0l9sAAAAASUVORK5CYII=';
  await json(`${base}/device/result`, {
    method: 'POST',
    headers: { authorization: `Bearer ${pairToken.body.device_token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ job_id: shotPolled.body.job.id, ok: true, result: { width: 1, height: 1, _attachments: [{ kind:'screenshot', name:'desktop.png', mimeType:'image/png', base64:fakeImage }] } })
  });
  const shotCalled = await shotCallPromise;
  assert.equal(shotCalled.body.result.structuredContent.width, 1);
  assert.equal(shotCalled.body.result.structuredContent._attachments, undefined);
  const imagePart = shotCalled.body.result.content.find(part => part.type === 'image');
  assert.equal(imagePart.mimeType, 'image/png');
  assert.equal(imagePart.data, fakeImage);

  const usage = await mcp({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'get_usage_stats', arguments: {} } });
  assert.equal(usage.body.result.structuredContent.quotaEnforced, false);
  assert.equal(usage.body.result.structuredContent.quota, null);
  assert.ok(usage.body.result.structuredContent.totalCalls >= 2);

  const recent = await mcp({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'get_recent_tool_calls', arguments: { max_results: 10 } } });
  assert.ok(recent.body.result.structuredContent.calls.some(call => call.tool === 'ping'));

  const refreshed = await json(`${base}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: token.body.refresh_token,
      client_id: 'https://chatgpt.com/oauth/client.json'
    })
  });
  assert.ok(refreshed.body.access_token);
  assert.notEqual(refreshed.body.refresh_token, token.body.refresh_token);

  console.log('Project Constellation relay smoke: PASS');
} finally {
  await relay.close();
  await fsp.rm(dataDir, { recursive: true, force: true });
}
