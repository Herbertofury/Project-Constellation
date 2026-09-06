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
assert.ok(manifest.permissions.includes('scripting'));
assert.ok(manifest.permissions.includes('tabGroups'));
assert.equal(manifest.permissions.includes('clipboardWrite'), false, 'obsolete OneTab clipboard permission must be removed');

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
for (const token of ['PC_CHAT_ORGANIZER_RENAME','PC_CHAT_ORGANIZER_OPEN_EDITOR','Command Center','Gather AI chats','PC_TAB_BEACON_REFRESH']) {
  assert.ok(pulse.includes(token), `Pulse integration missing ${token}`);
}
assert.match(pulse, /currentPrefs\?\.view === 'project'/, 'Pulse gather may use a selected project only when the user explicitly left Command Center in project view');
assert.match(pulse, /core\.LIVE_PROJECT_NAME/, 'Pulse gather needs a safe Live AI Sessions fallback');
assert.doesNotMatch(pulse, /OneTab/i, 'Pulse must not hand chats to OneTab');
assert.doesNotMatch(pulse, /tabs\.remove\s*\(/, 'Gather must never close live AI tabs');

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

const html = read('extension/chat-vault.html');
for (const token of ['AI Command Center','Gather all AI chats','WORKING','ATTENTION','COMPLETED','Live Sentinel is event-driven','Organize live tabs']) {
  assert.ok(html.includes(token), `Command Center UI missing ${token}`);
}
assert.doesNotMatch(html, /OneTab/i, 'Command Center must be its own workspace, not a OneTab handoff');

const commandCenter = read('extension/chat-vault.js');
for (const token of ['PC_LIVE_CHAT_PULSE','PC_TAB_BEACON_REFRESH','PC_FOCUS_LIVE_CHAT','PC_RETRY_LIVE_CHAT_FAILURE','document.hidden','Gathered','ATTENTION_STATES','LIVE_PRIORITY']) {
  assert.ok(commandCenter.includes(token), `Command Center behavior missing ${token}`);
}
assert.doesNotMatch(commandCenter, /tabs\.remove\s*\(/, 'Command Center gather must preserve live provider tabs');
assert.doesNotMatch(commandCenter, /OneTab/i, 'Command Center must not contain OneTab integration');
assert.doesNotMatch(commandCenter, /chrome\.tabs\.reload\s*\(/, 'Command Center must never auto-reload provider chats');

const vaultCore = read('extension/src/chat-vault-core.js');
for (const token of ['COMMAND_CENTER_PREFS_KEY','LIVE_PROJECT_NAME','livePresentation','tool-stalled','request-stalled','mergeItems','ensureStack','stateCounts']) {
  assert.ok(vaultCore.includes(token), `Command Center core missing ${token}`);
}
assert.doesNotMatch(vaultCore, /ONETAB|onetab\.html/i, 'OneTab-specific core must be removed');

console.log('chat-vault-static: ok');