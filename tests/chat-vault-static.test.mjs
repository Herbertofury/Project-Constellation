import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const manifest = JSON.parse(read('extension/manifest.json'));

const packageJson = JSON.parse(read('package.json'));
assert.match(packageJson.scripts.test, /chat-vault-core\.test\.mjs/);
assert.match(packageJson.scripts.test, /chat-vault-static\.test\.mjs/);
const buildScript = read('tools/build.mjs');
for (const token of ['background-entry.js','popup-organizer.js','chat-vault.html','chat-vault-core.js','chat-organizer.js','notification-repair.js']) {
  assert.ok(buildScript.includes(token), `build must ship ${token}`);
}

assert.equal(manifest.background.service_worker, 'background-entry.js');
assert.ok(manifest.permissions.includes('notifications'));
assert.ok(manifest.permissions.includes('clipboardWrite'));
assert.ok(manifest.permissions.includes('scripting'));

const chatScript = manifest.content_scripts.find((entry) => entry.js?.includes('src/chat-organizer.js'));
assert.ok(chatScript, 'ChatGPT organizer content script must be registered');
assert.deepEqual(chatScript.matches, ['https://chatgpt.com/*','https://chat.openai.com/*']);
for (const rel of [...chatScript.js, ...(chatScript.css || []), manifest.background.service_worker]) {
  assert.ok(fs.existsSync(path.join(root, 'extension', rel)), `manifest file missing: ${rel}`);
}

const popup = read('extension/popup.html');
assert.match(popup, /popup-organizer\.css/);
assert.match(popup, /src\/chat-vault-core\.js/);
assert.match(popup, /popup-organizer\.js/);

const pulse = read('extension/popup-organizer.js');
for (const token of ['PC_CHAT_ORGANIZER_RENAME','PC_CHAT_ORGANIZER_OPEN_EDITOR','Stash chats','OneTab']) assert.ok(pulse.includes(token), `Pulse integration missing ${token}`);

const organizer = read('extension/src/chat-organizer.js');
assert.match(organizer, /new MutationObserver/);
assert.match(organizer, /requestAnimationFrame/);
assert.match(organizer, /PC_CHAT_ORGANIZER_RENAME/);
assert.doesNotMatch(organizer, /\bfetch\s*\(/, 'organizer must not add provider fetches');
assert.doesNotMatch(organizer, /XMLHttpRequest/, 'organizer must not add provider XHR');

const notifier = read('extension/src/notification-repair.js');
assert.match(notifier, /PC_LIVE_CHAT_STATE_PUSH/);
assert.match(notifier, /chrome\.storage\.session/);
assert.match(notifier, /chrome\.notifications\.create/);
assert.match(notifier, /notifications\.getAll/);
assert.match(notifier, /pc-chat-complete:/);
assert.match(notifier, /pc-chat-attention:/);
assert.match(notifier, /notifications\.onClicked/);

const vault = read('extension/chat-vault.js');
assert.match(vault, /Safety check failed; no tabs were closed/);
assert.match(vault, /filter\(\(tab\) => !tab\.pinned\)/);
assert.match(vault, /const groupable = \[\]/);
assert.match(vault, /ONETAB_IMPORT_URL/);
assert.match(read('extension/src/chat-vault-core.js'), /onetab\.html/);

console.log('chat-vault-static: ok');
