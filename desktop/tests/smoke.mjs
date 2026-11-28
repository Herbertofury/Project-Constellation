import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createCommanderServer } from '../src/server.mjs';

const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'cc-smoke-'));
const token = 'smoketesttoken';
const app = await createCommanderServer({ config: { host:'127.0.0.1', port:0, endpointToken:token, allowedRoots:[tmp], defaultShell:process.platform === 'win32' ? 'powershell' : '/bin/bash' } });
const addr = await app.listen();
const base = `http://127.0.0.1:${addr.port}/${token}/mcp`;

async function rpc(method, params = {}, sid) {
  const headers = { 'content-type':'application/json', 'accept':'application/json, text/event-stream', 'mcp-protocol-version':'2025-06-18' };
  if (sid) headers['mcp-session-id'] = sid;
  const r = await fetch(base, { method:'POST', headers, body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}) });
  return { r, j: await r.json() };
}

try {
  const init = await rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'smoke',version:'1'}});
  assert.equal(init.r.status,200);
  const sid = init.r.headers.get('mcp-session-id');
  assert.ok(sid);
  assert.equal(init.j.result.serverInfo.name,'constellation-commander');

  const list = await rpc('tools/list',{},sid);
  assert.ok(list.j.result.tools.some(t=>t.name==='write_file'));
  assert.ok(list.j.result.tools.some(t=>t.name==='start_process'));

  const file = path.join(tmp,'hello.txt');
  const write = await rpc('tools/call',{name:'write_file',arguments:{path:file,content:'hello commander'}},sid);
  assert.equal(write.j.result.isError,false);
  const read = await rpc('tools/call',{name:'read_file',arguments:{path:file}},sid);
  assert.match(read.j.result.content[0].text,/hello commander/);

  const proc = await rpc('tools/call',{name:'start_process',arguments:{command:process.platform==='win32'?'Write-Output commander-process':'printf commander-process'}},sid);
  const procData = JSON.parse(proc.j.result.content[0].text);
  assert.ok(procData.session_id);
  let out;
  const deadline = Date.now() + 5000;
  do {
    out = await rpc('tools/call',{name:'read_process_output',arguments:{session_id:procData.session_id,offset:-20,wait_ms:250}},sid);
    if (/commander-process/.test(out.j.result.content[0].text)) break;
  } while (Date.now() < deadline);
  assert.match(out.j.result.content[0].text,/commander-process/);

  const pdf = path.join(tmp,'proof.pdf');
  const pdfCall = await rpc('tools/call',{name:'write_pdf',arguments:{path:pdf,content:'# Proof\nProject Constellation PDF'}},sid);
  assert.equal(pdfCall.j.result.isError,false);
  const pdfBytes = await fsp.readFile(pdf);
  assert.equal(pdfBytes.subarray(0,8).toString('ascii'),'%PDF-1.4');

  const latest = await fetch(base,{method:'POST',headers:{'content-type':'application/json','accept':'application/json','mcp-protocol-version':'2026-07-28','mcp-method':'server/discover'},body:JSON.stringify({jsonrpc:'2.0',id:2,method:'server/discover',params:{_meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28'}}})});
  const latestJson = await latest.json();
  assert.ok(latestJson.result.protocolVersions.includes('2026-07-28'));

  const usage = await rpc('tools/call',{name:'get_usage_stats',arguments:{}},sid);
  const usageData = JSON.parse(usage.j.result.content[0].text);
  assert.equal(usageData.quotaEnforced,false);
  console.log('SMOKE PASS');
} finally {
  await app.close();
  await fsp.rm(tmp,{recursive:true,force:true});
}
