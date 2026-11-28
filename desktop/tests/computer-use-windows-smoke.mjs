import assert from 'node:assert/strict';
import { computerUse, closeComputerUseHelper } from '../src/computer-use.mjs';
import { createCommanderServer } from '../src/server.mjs';

if (process.platform !== 'win32') {
  console.log('computer-use-windows-smoke: SKIP (Windows-only native gate)');
  process.exit(0);
}

try {
  const displays = await computerUse('displays', {});
  assert.ok(Array.isArray(displays.displays) && displays.displays.length >= 1, 'at least one display must be reported');
  assert.ok(displays.displays.every(d => d.width > 0 && d.height > 0));

  const cursor = await computerUse('cursor', {});
  assert.equal(Number.isFinite(cursor.x), true);
  assert.equal(Number.isFinite(cursor.y), true);
  await computerUse('actions', { actions: [
    { type:'move', x:cursor.x, y:cursor.y },
    { type:'keypress', key:'shift', repeat:1 },
    { type:'wait', ms:50 }
  ] });
  const cursorAfter = await computerUse('cursor', {});
  assert.equal(cursorAfter.x, cursor.x);
  assert.equal(cursorAfter.y, cursor.y);

  const windows = await computerUse('windows', { limit: 40 });
  assert.ok(Array.isArray(windows.windows));

  const originalClipboard = await computerUse('clipboard_read', {});
  const sentinel = `Project Constellation 0.20 clipboard ${Date.now()}`;
  await computerUse('clipboard_write', { text: sentinel });
  const clipboard = await computerUse('clipboard_read', {});
  assert.equal(clipboard.text, sentinel);
  await computerUse('clipboard_write', { text: originalClipboard.text || '' });

  const shot = await computerUse('screenshot', { target:'all', format:'jpeg', max_width:800, max_height:600 }, 30000);
  assert.equal(shot.mimeType, 'image/jpeg');
  assert.ok(shot.width > 0 && shot.height > 0);
  assert.ok(shot.bytes > 1000);
  assert.ok(typeof shot.base64 === 'string' && shot.base64.length > 1000);
  const bytes = Buffer.from(shot.base64, 'base64');
  assert.equal(bytes[0], 0xFF); assert.equal(bytes[1], 0xD8);

  const ui = await computerUse('ui_elements', { max_results:20, max_depth:3 }, 30000);
  assert.ok(Array.isArray(ui.elements));

  const token = 'computerusesmoke';
  const app = await createCommanderServer({ config: { host:'127.0.0.1', port:0, endpointToken:token, allowedRoots:['*'], enableGuiAutomation:true, emergencyLock:false } });
  const addr = await app.listen();
  const base = `http://127.0.0.1:${addr.port}/${token}/mcp`;
  const initResponse = await fetch(base, { method:'POST', headers:{'content-type':'application/json','accept':'application/json','mcp-protocol-version':'2025-06-18'}, body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'computer-use-smoke',version:'1'}}}) });
  const sid = initResponse.headers.get('mcp-session-id');
  assert.ok(sid);
  const screenshotResponse = await fetch(base, { method:'POST', headers:{'content-type':'application/json','accept':'application/json','mcp-protocol-version':'2025-06-18','mcp-session-id':sid}, body:JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'computer_screenshot',arguments:{target:'all',max_width:640,max_height:480}}}) });
  const screenshotRpc = await screenshotResponse.json();
  assert.equal(screenshotRpc.result.isError, false);
  assert.ok(screenshotRpc.result.content.some(part => part.type === 'image' && part.mimeType === 'image/jpeg' && part.data.length > 1000), 'MCP screenshot must be returned as real image content');
  await app.close();

  console.log('Project Constellation Windows full computer-use smoke: PASS');
} finally {
  await closeComputerUseHelper();
}
