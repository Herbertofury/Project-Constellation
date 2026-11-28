import assert from 'node:assert/strict';
import vm from 'node:vm';
import fsp from 'node:fs/promises';

const script = await fsp.readFile(new URL('../../extension/src/local-work-page-hook.js', import.meta.url), 'utf8');
const listeners = new Map();
const posted = [];
let recordedBody = '';

class FakeXHR {
  open(method, url) { this.method = method; this.url = url; }
  send(body) { this.sentBody = body; return body; }
}

const windowObj = {
  fetch: async (_input, init = {}) => { recordedBody = String(init?.body || ''); return { ok: true, status: 200 }; },
  addEventListener(type, callback) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(callback); },
  postMessage(data) {
    posted.push(data);
    for (const callback of listeners.get('message') || []) callback({ source: windowObj, data });
  }
};

const sandbox = {
  window: windowObj,
  location: { href: 'https://chatgpt.com/c/test' },
  Request,
  URL,
  XMLHttpRequest: FakeXHR,
  console,
  setTimeout,
  clearTimeout
};
vm.createContext(sandbox);
vm.runInContext(script, sandbox, { filename: 'page-hook.js' });
assert.ok(posted.some(x => x?.type === 'CC_PAGE_HOOK_READY_V2'), 'page hook should announce readiness');

const original = 'test full computer use now';
const context = '[PROJECT CONSTELLATION LOCAL CONTEXT]\n{"nonce":"abc"}\n[/PROJECT CONSTELLATION LOCAL CONTEXT]';
windowObj.postMessage({ source: 'constellation-commander-content', type: 'CC_ARM_CONTEXT_V2', id: 'arm-1', original, context });
await windowObj.fetch('https://chatgpt.com/backend-api/conversation', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ messages: [{ author: { role: 'user' }, content: { content_type: 'text', parts: [original] } }] })
});
const parsed = JSON.parse(recordedBody);
assert.equal(parsed.messages[0].content.parts[0], `${original}\n\n${context}`);
assert.ok(posted.some(x => x?.type === 'CC_PAGE_CONTEXT_INJECTED_V2' && x.id === 'arm-1'));

// If ProseMirror already staged the augmented prompt, the network hook should
// recognize it as armed rather than appending a duplicate context.
recordedBody = '';
windowObj.postMessage({ source: 'constellation-commander-content', type: 'CC_ARM_CONTEXT_V2', id: 'arm-2', original, context });
await windowObj.fetch('https://chatgpt.com/backend-api/conversation', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ input: [{ role: 'user', content: [{ type: 'input_text', text: `${original}\n\n${context}` }] }] })
});
assert.equal((recordedBody.match(/\[PROJECT CONSTELLATION LOCAL CONTEXT\]/g) || []).length, 1);
assert.ok(posted.some(x => x?.type === 'CC_PAGE_CONTEXT_INJECTED_V2' && x.id === 'arm-2'));

console.log('Project Constellation MAIN-world ChatGPT request hook smoke: PASS');
