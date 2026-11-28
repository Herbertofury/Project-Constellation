import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { createBrowserBridge } from '../src/browser-bridge.mjs';

const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'cc-bridge-smoke-'));
process.env.CONSTELLATION_COMMANDER_HOME = path.join(root, 'home');
process.env.CONSTELLATION_ALLOWED_ROOTS = root;
const port = 47731;
const origin = 'chrome-extension://geljambmkfjkhodgkpjhnmfojkpcamig';
const base = `http://127.0.0.1:${port}`;
const bridge = await createBrowserBridge({ port });
await bridge.start();

async function json(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json();
  return { status: response.status, body };
}

try {
  const health = await json(`${base}/health`);
  assert.equal(health.status, 200);
  assert.equal(health.body.mode, 'normal-chat-loopback');
  assert.equal(health.body.quotaEnforced, false);

  const stale = await json(`${base}/v1/companion/hello`, {
    method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ version: '0.4.0', extensionId: 'geljambmkfjkhodgkpjhnmfojkpcamig' })
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.versionMismatch, true);
  const staleHealth = await json(`${base}/health`);
  assert.equal(staleHealth.body.companionVersionMatch, false);

  const hello = await json(`${base}/v1/companion/hello`, {
    method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ version: '0.24.0', extensionId: 'geljambmkfjkhodgkpjhnmfojkpcamig' })
  });
  assert.equal(hello.status, 200);
  assert.equal(hello.body.ok, true);
  const healthAfterHello = await json(`${base}/health`);
  assert.equal(healthAfterHello.body.companionConnected, true);
  assert.equal(healthAfterHello.body.companionVersion, '0.24.0');
  assert.equal(healthAfterHello.body.companionVersionMatch, true);
  assert.equal(healthAfterHello.body.companionExtensionId, 'geljambmkfjkhodgkpjhnmfojkpcamig');

  const event = await json(`${base}/v1/companion/event`, {
    method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ event: 'context-injected', detail: { smoke: true } })
  });
  assert.equal(event.status, 200);
  const healthAfterEvent = await json(`${base}/health`);
  assert.equal(healthAfterEvent.body.lastDiagnostic.event, 'context-injected');

  const denied = await json(`${base}/v1/session/bootstrap`, {
    method: 'POST', headers: { origin: 'https://chatgpt.com', 'content-type': 'application/json' }, body: '{}'
  });
  assert.equal(denied.status, 403);

  const boot = await json(`${base}/v1/session/bootstrap`, {
    method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ chatId: 'smoke-chat' })
  });
  assert.equal(boot.status, 200);
  assert.equal(boot.body.ok, true);
  assert.ok(boot.body.sessionToken);
  assert.ok(boot.body.nonce);
  assert.ok(boot.body.tools.some(tool => tool.name === 'fs_write_text'));
  assert.ok(boot.body.tools.some(tool => tool.name === 'start_process'));

  const target = path.join(root, 'bridge-proof.txt');
  const writeCall = { nonce: boot.body.nonce, id: 'call-write', tool: 'fs_write_text', args: { path: target, content: 'normal-chat-bridge-proof', mode: 'rewrite' } };
  const write = await json(`${base}/v1/session/call`, {
    method: 'POST', headers: { origin, authorization: `Bearer ${boot.body.sessionToken}`, 'content-type': 'application/json' }, body: JSON.stringify(writeCall)
  });
  assert.equal(write.status, 200);
  assert.equal(write.body.ok, true);
  assert.equal(await fsp.readFile(target, 'utf8'), 'normal-chat-bridge-proof');

  const duplicate = await json(`${base}/v1/session/call`, {
    method: 'POST', headers: { origin, authorization: `Bearer ${boot.body.sessionToken}`, 'content-type': 'application/json' }, body: JSON.stringify(writeCall)
  });
  assert.equal(duplicate.status, 409);

  const badNonce = await json(`${base}/v1/session/call`, {
    method: 'POST', headers: { origin, authorization: `Bearer ${boot.body.sessionToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ nonce: 'wrong', id: 'call-x', tool: 'ping', args: {} })
  });
  assert.equal(badNonce.status, 401);

  const read = await json(`${base}/v1/session/call`, {
    method: 'POST', headers: { origin, authorization: `Bearer ${boot.body.sessionToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ nonce: boot.body.nonce, id: 'call-read', tool: 'fs_read_text', args: { path: target, offset: 0, length: 10 } })
  });
  assert.equal(read.status, 200);
  assert.match(JSON.stringify(read.body.result), /normal-chat-bridge-proof/);

  console.log('Project Constellation browser bridge smoke: PASS');
} finally {
  await bridge.stop();
  await fsp.rm(root, { recursive: true, force: true });
}
