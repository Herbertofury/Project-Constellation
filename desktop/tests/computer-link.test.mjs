import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  getComputerLinkStatus, getComputerLinkMcpStatus, launchComputerLinkOwner,
  stopComputerLinkOwner, resolveComputerLinkBinary, subscribeComputerLink,
} from '../src/computer-link.mjs';

async function directory(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'constellation-computer-link-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test('missing native tools remain explicitly unavailable without activating an owner', async t => {
  const binaryDirectory = await directory(t);
  const status = await getComputerLinkStatus({ binaryDirectory });
  assert.equal(status.available, false);
  assert.equal(status.owner.available, false);
  assert.equal(status.owner.running, false);
  assert.equal(status.mcp.available, false);
  assert.equal(status.capabilities.find(item => item.id === 'snapshot').available, false);
  assert.equal(status.source.refs, 26);
  assert.deepEqual(await getComputerLinkMcpStatus({ binaryDirectory }), { available: false, verified: false, reason: 'native-mcp-not-installed' });
  assert.deepEqual(await stopComputerLinkOwner(), { stopped: true, alreadyStopped: true });
});

test('owner launch never turns a remote tool invocation into local permission', async () => {
  await assert.rejects(launchComputerLinkOwner(), /local owner/);
  await assert.rejects(launchComputerLinkOwner({ ownerInitiated: 'true' }), /local owner/);
  if (process.platform !== 'win32') await assert.rejects(launchComputerLinkOwner({ ownerInitiated: true }), /Windows/);
  assert.throws(() => subscribeComputerLink(null), /function/);
  const unsubscribe = subscribeComputerLink(() => {}); unsubscribe(); unsubscribe();
  await assert.rejects(launchComputerLinkOwner({ ownerInitiated: true, canStart() { throw new Error('permission revoked'); } }), /permission revoked/);
});

test('fixed executable IDs and explicit trusted directories cannot escape into fallback execution', async t => {
  const binaryDirectory = await directory(t);
  await assert.rejects(resolveComputerLinkBinary('../owner', { binaryDirectory }), /Unknown/);
  await assert.rejects(resolveComputerLinkBinary('mcp', { binaryDirectory: 'relative' }), /absolute/);
  const name = 'computer-link-mcp-session' + (process.platform === 'win32' ? '.exe' : '');
  await fs.mkdir(path.join(binaryDirectory, name));
  assert.equal(await resolveComputerLinkBinary('mcp', { binaryDirectory }), null);
});

// Executable fixtures cover host process behavior. They do not replace the real
// Rust transcript acceptance below or Windows native/GUI tests.
async function fixture(t, body) {
  const binaryDirectory = await directory(t);
  const file = path.join(binaryDirectory, 'computer-link-mcp-session');
  await fs.writeFile(file, `#!${process.execPath}\n${body}\n`, { mode: 0o700 });
  return binaryDirectory;
}

test('native status adapter negotiates exact read-only transcript and waits for child EOF', { skip: process.platform === 'win32' }, async t => {
  const binaryDirectory = await fixture(t, `
    let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',b=>input+=b);
    process.stdin.on('end',()=>{
      const rows=input.trim().split('\\n').map(JSON.parse);
      if(JSON.stringify(process.argv.slice(2))!=='["--status-only"]'||rows.length!==4||rows[3].params.name!=='connection_status')process.exit(3);
      const out=[{jsonrpc:'2.0',id:1,result:{protocolVersion:'2025-06-18',serverInfo:{name:'fixture'}}},{jsonrpc:'2.0',id:2,result:{tools:[{name:'connection_status'}]}},{jsonrpc:'2.0',id:3,result:{isError:false,content:[{type:'text',text:'fixture-local-only'}]}}];
      process.stdout.write(out.map(JSON.stringify).join('\\n')+'\\n');
    });
  `);
  const result = await getComputerLinkMcpStatus({ binaryDirectory });
  assert.equal(result.verified, true);
  assert.equal(result.status, 'fixture-local-only');
  assert.deepEqual(result.tools.map(item => item.name), ['connection_status']);
  assert.equal((await getComputerLinkStatus({ binaryDirectory })).owner.running, false);
});

test('protocol errors and extra data are refused instead of presented as a connected native session', { skip: process.platform === 'win32' }, async t => {
  const binaryDirectory = await fixture(t, `process.stdin.resume();process.stdin.on('end',()=>process.stdout.write('{"id":1,"result":"bad"}\\n'));`);
  const result = await getComputerLinkMcpStatus({ binaryDirectory });
  assert.equal(result.verified, false);
  assert.equal(result.reason, 'native-status-protocol-invalid');
});

test('excessive native output is bounded and child cleanup precedes failure return', { skip: process.platform === 'win32' }, async t => {
  const binaryDirectory = await fixture(t, `process.stdin.resume();process.stdout.write('x'.repeat(70000));setInterval(()=>{},1000);`);
  const result = await getComputerLinkMcpStatus({ binaryDirectory });
  assert.equal(result.verified, false);
  assert.equal(result.reason, 'native-status-output-limit');
});

test('a hung status process is killed within the bounded owned-child deadline', { skip: process.platform === 'win32' }, async t => {
  const binaryDirectory = await fixture(t, `process.stdin.resume();process.on('SIGTERM',()=>{});setInterval(()=>{},1000);`);
  const started = Date.now();
  const result = await getComputerLinkMcpStatus({ binaryDirectory, timeoutMs: 150 });
  assert.equal(result.verified, false);
  assert.equal(result.reason, 'native-status-timeout');
  assert.ok(Date.now() - started < 3000);
});

test('symlinked executable is refused', { skip: process.platform === 'win32' }, async t => {
  const binaryDirectory = await directory(t);
  await fs.symlink(process.execPath, path.join(binaryDirectory, 'computer-link-mcp-session'));
  assert.equal(await resolveComputerLinkBinary('mcp', { binaryDirectory }), null);
});

test('actual integrated Rust binary completes MCP status without creating owner authority', async t => {
  const available = await resolveComputerLinkBinary('mcp');
  if (!available) { t.skip('Build native host payload with node tools/computer-link/build.mjs for actual Rust acceptance'); return; }
  const result = await getComputerLinkMcpStatus();
  assert.equal(result.verified, true, JSON.stringify(result));
  assert.equal(result.protocolVersion, '2025-06-18');
  assert.match(result.status, /NOT CONNECTED/);
  assert.deepEqual(result.tools.map(item => item.name), ['connection_status']);
  assert.equal((await getComputerLinkStatus()).owner.running, false);
});

test('packaged resource discovery executes the actual Rust sibling outside ASAR', async t => {
  const original = Object.getOwnPropertyDescriptor(process, 'resourcesPath');
  const native = await resolveComputerLinkBinary('mcp');
  if (!native) { t.skip('Build native host payload for real packaged-location MCP acceptance'); return; }
  const resources = await directory(t);
  const destination = path.join(resources, 'computer-link', path.basename(native));
  await fs.mkdir(path.dirname(destination));
  await fs.copyFile(native, destination);
  await fs.chmod(destination, 0o700);
  Object.defineProperty(process, 'resourcesPath', { configurable: true, value: resources });
  try {
    assert.equal(await resolveComputerLinkBinary('mcp'), destination);
    const result = await getComputerLinkMcpStatus();
    assert.equal(result.verified, true, JSON.stringify(result));
    assert.match(result.status, /NOT CONNECTED/);
    assert.equal((await getComputerLinkStatus()).owner.running, false);
  } finally {
    if (original) Object.defineProperty(process, 'resourcesPath', original);
    else delete process.resourcesPath;
  }
});
