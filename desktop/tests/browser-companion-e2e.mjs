import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { createBrowserBridge } from '../src/browser-bridge.mjs';

function chromeExecutable() {
  const candidates = process.platform === 'win32'
    ? [
        process.env.CHROME_PATH,
        process.env['PROGRAMFILES'] && path.join(process.env['PROGRAMFILES'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
        process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
        process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')
      ]
    : [process.env.CHROME_PATH, 'chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable'];
  for (const candidate of candidates.filter(Boolean)) {
    if (path.isAbsolute(candidate) && fs.existsSync(candidate)) return candidate;
    if (!path.isAbsolute(candidate)) {
      const probe = spawnSync('sh', ['-lc', `command -v ${JSON.stringify(candidate)}`], { encoding: 'utf8' });
      if (probe.status === 0 && probe.stdout.trim()) return probe.stdout.trim();
    }
  }
  throw new Error('Chrome/Chromium executable not found for browser companion E2E.');
}

const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'cc-browser-e2e-'));
process.env.CONSTELLATION_COMMANDER_HOME = path.join(tmp, 'commander-home');
process.env.CONSTELLATION_ALLOWED_ROOTS = tmp;
const bridge = await createBrowserBridge({ port: 47721 });
await bridge.start();

const trustedOrigin = 'chrome-extension://geljambmkfjkhodgkpjhnmfojkpcamig';
const nativeFetch = globalThis.fetch;
const bridgeFetch = async (endpoint, { method = 'GET', body = null, token = '' } = {}) => {
  const response = await nativeFetch(`http://127.0.0.1:47721${endpoint}`, {
    method,
    headers: {
      origin: trustedOrigin,
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json();
  return { status: response.status, ...data };
};

let chrome;
try {
  const profile = path.join(tmp, 'profile');
  const port = await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const selected = typeof address === 'object' && address ? address.port : 0;
      server.close(error => error ? reject(error) : resolve(selected));
    });
  });
  chrome = spawn(chromeExecutable(), [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run',
    '--disable-background-networking', '--disable-component-update', '--disable-default-apps',
    `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, 'about:blank'
  ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });

  let log = '';
  chrome.stderr.on('data', chunk => { log += chunk.toString(); });
  let exited = false;
  let exitCode = null;
  chrome.once('exit', code => { exited = true; exitCode = code; });

  let ready = false;
  for (let i = 0; i < 300 && !ready; i++) {
    if (exited) throw new Error(`Chrome exited ${exitCode}. ${log.slice(-3000)}`);
    ready = await nativeFetch(`http://127.0.0.1:${port}/json/version`)
      .then(response => response.ok)
      .catch(() => false);
    if (!ready) await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error(`Chrome DevTools timeout. ${log.slice(-3000)}`);

  let target;
  for (let i = 0; i < 60 && !target; i++) {
    const rows = await nativeFetch(`http://127.0.0.1:${port}/json`).then(r => r.json()).catch(() => []);
    target = rows.find(row => row.type === 'page');
    if (!target) await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(target?.webSocketDebuggerUrl, 'Chrome page target not found');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const callId = ++id;
    pending.set(callId, { resolve, reject });
    ws.send(JSON.stringify({ id: callId, method, params }));
  });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };

  ws.addEventListener('message', event => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const entry = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? entry.reject(new Error(JSON.stringify(msg.error))) : entry.resolve(msg.result);
      return;
    }
    if (msg.method === 'Runtime.bindingCalled' && msg.params?.name === '__ccBridgeBinding') {
      void (async () => {
        let request;
        try { request = JSON.parse(msg.params.payload); }
        catch { return; }
        let response;
        try {
          const payload = request.payload || {};
          if (payload.type === 'CC_HEALTH') response = await bridgeFetch('/health');
          else if (payload.type === 'CC_BOOTSTRAP') response = await bridgeFetch('/v1/session/bootstrap', { method: 'POST', body: { chatId: payload.chatId, url: payload.url } });
          else if (payload.type === 'CC_REFRESH') response = await bridgeFetch('/v1/session/refresh', { method: 'POST', token: payload.sessionToken, body: { nonce: payload.nonce } });
          else if (payload.type === 'CC_CALL' && payload.call?.tool === 'computer_screenshot') response = { status:200, ok:true, id:payload.call.id, tool:payload.call.tool, result:{ width:1, height:1, _attachments:[{ kind:'screenshot', name:'desktop.png', mimeType:'image/png', base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl0l9sAAAAASUVORK5CYII=' }] } };
          else if (payload.type === 'CC_CALL') response = await bridgeFetch('/v1/session/call', { method: 'POST', token: payload.sessionToken, body: payload.call });
          else response = { ok: false, error: 'Unknown test message.' };
        } catch (error) {
          response = { ok: false, error: String(error?.message || error), offline: true };
        }
        try {
          await evaluate(`window.__ccDeliver(${JSON.stringify(request.id)}, ${JSON.stringify(response)})`);
        } catch {}
      })();
    }
  });

  await call('Runtime.enable');
  await call('Runtime.addBinding', { name: '__ccBridgeBinding' });

  const hello = await bridgeFetch('/v1/companion/hello', { method: 'POST', body: { version: '0.25.0', extensionId: 'geljambmkfjkhodgkpjhnmfojkpcamig' } });
  assert.equal(hello.ok, true, JSON.stringify(hello));

  const pageHtml = `
    <style>body{font-family:sans-serif}#prompt-textarea{width:600px;height:80px;border:1px solid #888}.turn{padding:6px}</style>
    <form id="composer-form"><div id="prompt-textarea" class="ProseMirror" contenteditable="true" role="textbox" aria-label="Chat with ChatGPT"></div><input id="upload" type="file" accept="image/*" style="display:none"><button id="composer-submit-button" data-testid="send-button" type="submit">Send</button></form>
    <div id="turns"></div>`;
  await evaluate(`document.body.innerHTML=${JSON.stringify(pageHtml)}; document.title='Constellation Browser E2E'; true`);
  await evaluate(`
    window.sentMessages=[]; window.networkBodies=[]; window.attachedFiles=[];
    window.fetch=async (url,init={})=>{window.networkBodies.push(String(init.body||''));return new Response('{"ok":true}',{status:200,headers:{'content-type':'application/json'}});};
    document.querySelector('#upload').addEventListener('change',e=>{window.attachedFiles=[...e.target.files].map(f=>({name:f.name,type:f.type,size:f.size}));});
    window.appendTurn=(role,text)=>{const d=document.createElement('div');d.className='turn';d.setAttribute('data-message-author-role',role);d.textContent=text;document.querySelector('#turns').appendChild(d);return d;};
    window.appendAssistant=(text)=>window.appendTurn('assistant',text);
    document.querySelector('#composer-form').addEventListener('submit',e=>{e.preventDefault();const t=document.querySelector('#prompt-textarea');const value=t.innerText||t.textContent||'';window.sentMessages.push(value);window.appendTurn('user',value);void fetch('https://chatgpt.com/backend-api/conversation',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({messages:[{author:{role:'user'},content:{content_type:'text',parts:[value]}}]})});t.replaceChildren(document.createElement('p'));t.dispatchEvent(new Event('input',{bubbles:true}));});
    window.__ccCallbacks=new Map();window.__ccSeq=0;
    window.chrome={runtime:{lastError:null,sendMessage(payload,callback){const id=String(++window.__ccSeq);window.__ccCallbacks.set(id,callback);window.__ccBridgeBinding(JSON.stringify({id,payload}));}}};
    window.__ccDeliver=(id,response)=>{const cb=window.__ccCallbacks.get(String(id));if(!cb)return false;window.__ccCallbacks.delete(String(id));cb(response);return true;};
    true`);

  const pageHookScript = await fsp.readFile(new URL('../../extension/src/local-work-page-hook.js', import.meta.url), 'utf8');
  const contentScript = await fsp.readFile(new URL('../../extension/src/local-work-content.js', import.meta.url), 'utf8');
  await evaluate(`${pageHookScript}\ntrue`);
  await evaluate(`${contentScript}\ntrue`);
  await new Promise(resolve => setTimeout(resolve, 250));

  await evaluate(`(()=>{const t=document.querySelector('#prompt-textarea');t.focus();t.textContent='take control of my computer in full';t.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:'take control of my computer in full'}));document.querySelector('[data-testid="send-button"]').click();return true;})()`);

  let messages = [];
  for (let i = 0; i < 80; i++) {
    messages = await evaluate('window.sentMessages.slice()');
    if (messages.length >= 1) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(messages.length, 1, 'Expected armed user message to send exactly once');
  let networkBodies = [];
  for (let i = 0; i < 50; i++) {
    networkBodies = await evaluate('window.networkBodies.slice()');
    if (networkBodies.length >= 1) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(networkBodies.length, 1, 'Expected one ChatGPT request payload');
  const armedBody = JSON.parse(networkBodies[0]);
  const armedText = armedBody.messages[0].content.parts[0];
  assert.match(armedText, /\[PROJECT CONSTELLATION LOCAL CONTEXT\]/);
  assert.equal((armedText.match(/\[PROJECT CONSTELLATION LOCAL CONTEXT\]/g) || []).length, 1, 'Context must be injected exactly once');
  const contextMatch = armedText.match(/\[PROJECT CONSTELLATION LOCAL CONTEXT\]\s*([\s\S]*?)\s*\[\/PROJECT CONSTELLATION LOCAL CONTEXT\]/);
  assert.ok(contextMatch, 'Local context missing from actual ChatGPT request body');
  const context = JSON.parse(contextMatch[1]);
  assert.ok(context.nonce);
  assert.ok(context.tools.some(tool => tool.name === 'fs_write_text'));

  const proofFile = path.join(tmp, 'browser-e2e-proof.txt');
  const toolCall = `[PC_BUDDY_CALL]${JSON.stringify({ nonce: context.nonce, id: 'browser-e2e-write', tool: 'fs_write_text', args: { path: proofFile, content: 'browser-companion-proof', mode: 'rewrite' } })}[/PC_BUDDY_CALL]`;
  await evaluate(`window.appendAssistant(${JSON.stringify(toolCall)}); true`);

  for (let i = 0; i < 100; i++) {
    messages = await evaluate('window.sentMessages.slice()');
    if (messages.length >= 2) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(messages.length, 2, 'Expected hidden tool-result turn to auto-send');
  assert.match(messages[1], /\[PC BUDDY TOOL RESULT\]/);
  assert.match(messages[1], /"ok":true/);
  assert.equal(await fsp.readFile(proofFile, 'utf8'), 'browser-companion-proof');

  const screenshotCall = `[PC_BUDDY_CALL]${JSON.stringify({ nonce: context.nonce, id: 'browser-e2e-shot', tool: 'computer_screenshot', args: { target:'all' } })}[/PC_BUDDY_CALL]`;
  await evaluate(`window.appendAssistant(${JSON.stringify(screenshotCall)}); true`);
  for (let i = 0; i < 100; i++) {
    messages = await evaluate('window.sentMessages.slice()');
    if (messages.length >= 3) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(messages.length, 3, 'Expected screenshot tool-result turn to auto-send');
  assert.match(messages[2], /computer_screenshot/);
  assert.ok(!messages[2].includes('iVBORw0KGgo'), 'Screenshot base64 must not be leaked into hidden result text');
  const attachedFiles = await evaluate('window.attachedFiles.slice()');
  assert.equal(attachedFiles.length, 1, 'Expected screenshot to attach as a real file');
  assert.equal(attachedFiles[0].name, 'desktop.png');
  assert.equal(attachedFiles[0].type, 'image/png');
  assert.ok(attachedFiles[0].size > 10);

  await new Promise(resolve => setTimeout(resolve, 500));
  const visible = await evaluate(`[...document.querySelectorAll('[data-message-author-role]')].filter(n=>getComputedStyle(n).display!=='none').map(n=>n.textContent)`);
  assert.ok(visible.some(text => text.trim() === 'take control of my computer in full'), 'Original user text should remain visible');
  assert.ok(!visible.some(text => text.includes('PROJECT CONSTELLATION LOCAL CONTEXT')), 'Local context should be visually scrubbed');
  assert.ok(!visible.some(text => text.includes('PC_BUDDY_CALL')), 'Tool-call plumbing should be hidden');
  assert.ok(!visible.some(text => text.includes('PC BUDDY TOOL RESULT')), 'Tool-result plumbing should be hidden');

  ws.close();
  console.log('Project Constellation real-Chromium content script -> real bridge -> disk E2E: PASS');
} finally {
  try { chrome?.kill('SIGTERM'); } catch {}
  await bridge.stop();
  await new Promise(resolve => setTimeout(resolve, 100));
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
}
