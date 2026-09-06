import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const manifest = JSON.parse(read('extension/manifest.json'));

const packageJson = JSON.parse(read('package.json'));
assert.match(packageJson.scripts.test, /chat-vault-core\.test\.mjs/);
assert.match(packageJson.scripts.test, /command-center-action-core\.test\.mjs/);
assert.match(packageJson.scripts.test, /closed-chat-watch-core\.test\.mjs/);
assert.match(packageJson.scripts.test, /chat-vault-static\.test\.mjs/);
const buildScript = read('tools/build.mjs');
for (const token of ['background-entry.js','popup-organizer.js','chat-vault.html','chat-vault-core.js','chat-organizer.js','notification-repair.js','command-center-action-core.js','closed-chat-watch-core.js','closed-chat-watch.js','command-center-actions.js']) {
  assert.ok(buildScript.includes(token), `build must ship ${token}`);
}

assert.equal(manifest.background.service_worker, 'background-entry.js');
assert.ok(manifest.permissions.includes('notifications'));
assert.ok(manifest.permissions.includes('scripting'));
assert.ok(manifest.permissions.includes('tabGroups'));
assert.ok(manifest.permissions.includes('contextMenus'));
assert.ok(manifest.permissions.includes('alarms'));
assert.ok(manifest.permissions.includes('offscreen'));
assert.equal(manifest.permissions.includes('clipboardWrite'), false, 'obsolete OneTab clipboard permission must be removed');

const backgroundEntry = read('extension/background-entry.js');
for (const token of ['src/chat-vault-core.js','src/command-center-action-core.js','src/closed-chat-watch-core.js','background.js','src/notification-repair.js','src/closed-chat-watch.js','src/command-center-actions.js']) {
  assert.ok(backgroundEntry.includes(token), `background entry must load ${token}`);
}
assert.ok(backgroundEntry.indexOf('src/chat-vault-core.js') < backgroundEntry.indexOf('src/command-center-actions.js'), 'Command Center storage core must load before quick actions');
assert.ok(backgroundEntry.indexOf('src/command-center-action-core.js') < backgroundEntry.indexOf('src/command-center-actions.js'), 'quick action policy core must load before quick actions');
assert.ok(backgroundEntry.indexOf('src/closed-chat-watch-core.js') < backgroundEntry.indexOf('src/closed-chat-watch.js'), 'closed-chat heartbeat policy must load before its runtime');
assert.ok(backgroundEntry.indexOf('background.js') < backgroundEntry.indexOf('src/closed-chat-watch.js'), 'provider globals must exist before closed-chat runtime starts');
assert.ok(backgroundEntry.indexOf('src/closed-chat-watch.js') < backgroundEntry.indexOf('src/command-center-actions.js'), 'heartbeat preflight listener should arm before quick-action listener');

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
for (const token of ['PC_CHAT_ORGANIZER_RENAME','PC_CHAT_ORGANIZER_OPEN_EDITOR','Command Center','PC_COMMAND_CENTER_GET_QUICK_ACTION','PC_COMMAND_CENTER_RUN_QUICK_ACTION','openCommandCenter:true','Right-click the pinned Project Constellation extension icon']) {
  assert.ok(pulse.includes(token), `Pulse integration missing ${token}`);
}
assert.doesNotMatch(pulse, /runQuickActionAndOpen/, 'popup must not own post-close navigation because stash may close its host tab');
assert.doesNotMatch(pulse, /OneTab/i, 'Pulse must not hand chats to OneTab');
assert.doesNotMatch(pulse, /tabs\.remove\s*\(/, 'Pulse must delegate verified tab closing to the background quick-action service');

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

const actionCore = read('extension/src/command-center-action-core.js');
for (const token of ['gather','smart-collapse','stash-close','QUICK_ACTION_KEY','smartDisposition','one-tab-style','pinned','unproven']) {
  assert.ok(actionCore.includes(token), `quick action policy core missing ${token}`);
}
assert.match(actionCore, /tab\?\.pinned/, 'OneTab-style stash policy must preserve pinned tabs');

const actions = read('extension/src/command-center-actions.js');
for (const token of ['PC_COMMAND_CENTER_GET_QUICK_ACTION','PC_COMMAND_CENTER_SET_QUICK_ACTION','PC_COMMAND_CENTER_RUN_QUICK_ACTION','PC_GET_LIVE_SENTINEL_STATE','contexts:[\'action\']','type:\'radio\'','Stash + close AI chats now','saveAndVerifyTabs','chrome.tabs.remove','chrome.runtime.getURL(\'chat-vault.html\')','MENU_RECONCILE_ALARM','chrome.alarms?.create?.','chrome.alarms?.onAlarm?.addListener','message.openCommandCenter','closeFailed','notifyContextFailure']) {
  assert.ok(actions.includes(token), `quick action runtime missing ${token}`);
}
assert.match(actions, /prefs\?\.view === 'project'/, 'quick action may use a selected project only when Command Center is explicitly in project view');
assert.match(actions, /vaultCore\.LIVE_PROJECT_NAME/, 'quick action needs a safe Live AI Sessions fallback');
assert.doesNotMatch(actions, /contextMenus\.removeAll/, 'right-click menu integration must not destroy existing page-level Constellation menus');
assert.doesNotMatch(actions, /periodInMinutes|periodInSeconds/, 'menu recovery must be one-shot, not a recurring watchdog');
assert.doesNotMatch(actions, /chrome\.tabs\.reload\s*\(/, 'quick actions must never auto-reload provider chats');
assert.doesNotMatch(actions, /\bfetch\s*\(/, 'quick actions must not add provider fetches');
assert.doesNotMatch(actions, /XMLHttpRequest/, 'quick actions must not add provider XHR');
assert.ok(actions.indexOf('if (!saved.verified)') >= 0 && actions.indexOf('if (!saved.verified)') < actions.indexOf('closeTabIds(closeIds)'), 'verified persistence must happen before any AI tab close');
assert.ok(actions.indexOf('message.openCommandCenter') > actions.indexOf('runQuickAction(message.mode'), 'background must complete the destructive action before opening Command Center');

const watchPolicy = read('extension/src/closed-chat-watch-core.js');
for (const token of ['WATCH_KEY','ALARM_NAME','NO_PROGRESS_MAX_MS','ABSOLUTE_MAX_MS','parsedFingerprint','reduceProbe','Remote progress','Remote settled','Provider terminal state was not fabricated']) {
  assert.ok(watchPolicy.includes(token), `closed-chat heartbeat policy missing ${token}`);
}

const watchRuntime = read('extension/src/closed-chat-watch.js');
for (const token of ['PC_LIVE_CHAT_STATE_PUSH','PC_COMMAND_CENTER_RUN_QUICK_ACTION','PC_GET_LIVE_SENTINEL_STATE','PC_CLOSED_CHAT_WATCH_SNAPSHOT','chrome.tabs.onRemoved','chrome.alarms.onAlarm','credentials:\'include\'','cache:\'no-store\'','projectConstellationRequestGovernor','MAX_PROBES_PER_RUN','FETCH_TIMEOUT_MS','backgroundHtml','PC_OFFSCREEN_PARSE_HTML']) {
  assert.ok(watchRuntime.includes(token), `closed-chat heartbeat runtime missing ${token}`);
}
assert.match(watchRuntime, /chrome\.runtime\.getContexts/,'heartbeat parser must reuse the extension offscreen parser rather than hidden provider tabs');
assert.doesNotMatch(watchRuntime, /periodInMinutes|periodInSeconds/,'closed-chat heartbeat must use adaptive one-shot alarms, not a recurring watchdog');
assert.doesNotMatch(watchRuntime, /active\s*:\s*false[^\n]*chrome\.tabs\.create|chrome\.tabs\.create\([^\n]*active\s*:\s*false/,'heartbeat runtime must not create hidden/background provider tabs');
assert.doesNotMatch(watchRuntime, /chrome\.tabs\.reload\s*\(/,'heartbeat runtime must never auto-reload provider chats');
assert.doesNotMatch(watchRuntime, /setInterval\s*\(/,'heartbeat runtime must not spin a permanent interval');

const vaultCore = read('extension/src/chat-vault-core.js');
for (const token of ['COMMAND_CENTER_PREFS_KEY','LIVE_PROJECT_NAME','livePresentation','tool-stalled','request-stalled','mergeItems','ensureStack','stateCounts']) {
  assert.ok(vaultCore.includes(token), `Command Center core missing ${token}`);
}
assert.doesNotMatch(vaultCore, /ONETAB|onetab\.html/i, 'OneTab-specific core must be removed');

console.log('chat-vault-static: ok');
