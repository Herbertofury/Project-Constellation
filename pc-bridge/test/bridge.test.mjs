import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import readline from 'node:readline';

const serverPath = path.resolve('src/server.mjs');

async function withServer(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pcx-029-test-'));
  await fs.writeFile(path.join(root, 'hello.txt'), 'hello bridge\n', 'utf8');
  const configPath = path.join(root, 'config.json');
  await fs.writeFile(configPath, JSON.stringify({
    roots: [root],
    commands: {
      fixture: process.platform === 'win32'
        ? { file: 'cmd.exe', args: ['/d', '/s', '/c', 'echo pcx-fixture'] }
        : { file: 'printf', args: ['pcx-fixture\\n'] }
    }
  }), 'utf8');
  const child = spawn(process.execPath, [serverPath, '--stdio'], {
    cwd: path.resolve('.'),
    env: { ...process.env, PCX_BRIDGE_CONFIG: configPath },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  const iterator = rl[Symbol.asyncIterator]();
  let id = 0;
  async function rpc(method, params = {}) {
    const requestId = ++id;
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params })}\n`);
    const { value, done } = await iterator.next();
    assert.equal(done, false);
    const parsed = JSON.parse(value);
    assert.equal(parsed.id, requestId);
    return parsed;
  }
  try { await fn({ rpc, root }); }
  finally {
    rl.close();
    child.kill();
    await fs.rm(root, { recursive: true, force: true });
  }
}

test('modern discovery advertises 2026-07-28 and tool capability', async () => {
  await withServer(async ({ rpc }) => {
    const res = await rpc('server/discover', { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } });
    assert.deepEqual(res.result.supportedVersions, ['2026-07-28']);
    assert.ok(res.result.capabilities.tools);
    assert.equal(res.result._meta['io.modelcontextprotocol/serverInfo'].name, 'pcx-029-pc-bridge');
  });
});

test('legacy initialize remains available', async () => {
  await withServer(async ({ rpc }) => {
    const res = await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'fixture', version: '1' } });
    assert.equal(res.result.protocolVersion, '2025-11-25');
    assert.equal(res.result.serverInfo.name, 'pcx-029-pc-bridge');
  });
});

test('tool list exposes stable guarded surface', async () => {
  await withServer(async ({ rpc }) => {
    const res = await rpc('tools/list');
    assert.deepEqual(res.result.tools.map(t => t.name), ['pc.status', 'fs.stat', 'fs.list', 'fs.read_text', 'pc.run_allowed']);
  });
});

test('allowed file read succeeds and outside-root read is denied', async () => {
  await withServer(async ({ rpc, root }) => {
    const ok = await rpc('tools/call', { name: 'fs.read_text', arguments: { path: path.join(root, 'hello.txt') } });
    assert.match(ok.result.content[0].text, /hello bridge/);
    const denied = await rpc('tools/call', { name: 'fs.stat', arguments: { path: path.resolve(root, '..') } });
    assert.equal(denied.error.data.code, 'PCX_PATH_DENIED');
  });
});

test('allowlisted command executes; arbitrary command id is rejected', async () => {
  await withServer(async ({ rpc }) => {
    const ok = await rpc('tools/call', { name: 'pc.run_allowed', arguments: { id: 'fixture' } });
    assert.match(ok.result.structuredContent.stdout, /pcx-fixture/);
    const denied = await rpc('tools/call', { name: 'pc.run_allowed', arguments: { id: 'definitely-not-allowed' } });
    assert.equal(denied.error.data.code, 'PCX_COMMAND_DENIED');
  });
});
