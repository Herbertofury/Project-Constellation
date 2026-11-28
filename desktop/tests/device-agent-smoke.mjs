import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createRelayServer } from '../relay/relay-server.mjs';

const port = 32000 + crypto.randomInt(10000);
const base = `http://127.0.0.1:${port}`;
const relayDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cc-relay-agent-smoke-'));
const deviceHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'cc-device-agent-smoke-'));
const workDir = path.join(deviceHome, 'workspace');
await fsp.mkdir(workDir, { recursive: true });
const ownerPassword = `test-${crypto.randomBytes(12).toString('hex')}`;
const relay = await createRelayServer({ port, publicBaseUrl: base, ownerPassword, dataDir: relayDir, longPollMs: 1200, jobTimeoutMs: 8000 });
await relay.listen();

const requestJson = async (url, options = {}, expected = [200]) => {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  assert.ok(expected.includes(response.status), `${url}: ${response.status}: ${text}`);
  return { response, body };
};

let child;
const output = [];
try {
  const pair = await requestJson(`${base}/device/pair/start`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ device_name: 'Actual Agent Smoke', platform: process.platform, arch: process.arch, version: '0.7.4' })
  });
  const approve = await fetch(`${base}/device/verify`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ user_code: pair.body.user_code, owner_password: ownerPassword })
  });
  assert.equal(approve.status, 200);
  const paired = await requestJson(`${base}/device/pair/token`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ device_code: pair.body.device_code })
  });

  const config = {
    deviceName: 'Actual Agent Smoke',
    allowedRoots: [workDir],
    blockedCommands: [],
    enableShell: true,
    enableGuiAutomation: false,
    telemetryEnabled: false,
    defaultShell: process.platform === 'win32' ? 'powershell' : 'bash',
    searchIgnore: ['.git', 'node_modules'],
    remoteRelayUrl: base,
    remoteDeviceId: paired.body.device_id,
    remoteDeviceToken: paired.body.device_token
  };
  await fsp.writeFile(path.join(deviceHome, 'config.json'), JSON.stringify(config, null, 2));

  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const redirectUri = 'https://chatgpt.com/connector_platform_oauth_redirect';
  const auth = await fetch(`${base}/oauth/authorize`, {
    method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      response_type: 'code', client_id: 'https://chatgpt.com/oauth/client.json', redirect_uri: redirectUri,
      code_challenge: challenge, code_challenge_method: 'S256', state: 'agent-smoke', resource: `${base}/mcp`,
      scope: 'computer:read computer:write', owner_password: ownerPassword
    })
  });
  assert.equal(auth.status, 302);
  const code = new URL(auth.headers.get('location')).searchParams.get('code');
  const token = await requestJson(`${base}/oauth/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: 'https://chatgpt.com/oauth/client.json', code_verifier: verifier, resource: `${base}/mcp` })
  });

  child = spawn(process.execPath, [path.resolve('bin/constellation-commander-remote.mjs'), '--relay', base], {
    cwd: path.resolve('.'),
    env: { ...process.env, CONSTELLATION_COMMANDER_HOME: deviceHome, CONSTELLATION_NO_BROWSER: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', d => output.push(d.toString()));
  child.stderr.on('data', d => output.push(d.toString()));

  const mcp = async (id, name, args = {}) => requestJson(`${base}/mcp`, {
    method: 'POST', headers: { authorization: `Bearer ${token.body.access_token}`, 'content-type': 'application/json', 'mcp-protocol-version': '2025-06-18' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } })
  });

  const readyDeadline = Date.now() + 10000;
  let devices;
  do {
    devices = await mcp(0, 'list_devices');
    if (devices.body.result?.structuredContent?.devices?.some(device => device.id === paired.body.device_id && device.status === 'online')) break;
    if (child.exitCode != null) throw new Error(`Device agent exited before becoming online.\n${output.join('')}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < readyDeadline);
  assert.ok(devices.body.result?.structuredContent?.devices?.some(device => device.id === paired.body.device_id && device.status === 'online'), `Device agent did not become online.\n${output.join('')}`);

  const ping = await mcp(1, 'ping');
  assert.equal(ping.body.result.structuredContent.pong, true);
  assert.equal(ping.body.result.structuredContent.deviceName, 'Actual Agent Smoke');

  const target = path.join(workDir, 'relay-roundtrip.txt');
  const write = await mcp(2, 'write_file', { path: target, content: 'normal-chat plugin relay round trip', mode: 'rewrite' });
  assert.equal(write.body.result.structuredContent.path, target);

  const read = await mcp(3, 'read_file', { path: target });
  assert.equal(read.body.result.structuredContent.content, 'normal-chat plugin relay round trip');
  assert.equal(await fsp.readFile(target, 'utf8'), 'normal-chat plugin relay round trip');

  const finalDevices = await mcp(4, 'list_devices');
  assert.equal(finalDevices.body.result.structuredContent.devices[0].status, 'online');

  console.log('Project Constellation actual device-agent smoke: PASS');
} catch (error) {
  if (child) console.error('Agent output:\n' + output.join(''));
  throw error;
} finally {
  if (child && child.exitCode == null) {
    child.kill('SIGTERM');
    await new Promise(resolve => child.once('exit', resolve));
  }
  await relay.close();
  await fsp.rm(relayDir, { recursive: true, force: true });
  await fsp.rm(deviceHome, { recursive: true, force: true });
}
