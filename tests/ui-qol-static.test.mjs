import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = (rel) => fs.readFileSync(path.join(root,rel),'utf8');

const popupHtml = read('extension/popup.html');
const commandHtml = read('extension/chat-vault.html');
const qol = read('extension/src/ui-qol.js');
const watchUi = read('extension/src/closed-chat-watch-ui.js');
const build = read('tools/build.mjs');
const uiContract = read('tools/ui-contract.mjs');

assert.match(popupHtml,/src\/ui-qol\.js/,'popup must load shared QOL hardening');
assert.match(commandHtml,/src\/ui-qol\.js/,'Command Center must load shared QOL hardening');
assert.match(build,/ui-qol\.js/,'release build must ship shared QOL hardening');
assert.match(uiContract,/chat-vault\.html/,'UI contract must audit Command Center buttons too');
assert.match(uiContract,/popup-organizer\.js/,'popup dynamic controls need an owner in the UI contract');
assert.match(uiContract,/src\/ui-qol\.js/,'UI contract must include QOL-owned controls');

for (const dialogId of ['projectDialog','importDialog','styleDialog']) {
  assert.match(commandHtml,new RegExp(`type="button" data-dialog-close="${dialogId}"`),`${dialogId} needs an explicit non-submit close action`);
}
assert.doesNotMatch(commandHtml,/<button\s+value="cancel"/,'dialog cancel buttons must never implicitly submit save handlers');
assert.match(commandHtml,/id="saveProjectDialog" type="submit"/,'project save stays an explicit submit');
assert.match(commandHtml,/id="saveStyle" type="submit"/,'style save stays an explicit submit');
assert.match(commandHtml,/id="clearStyle" type="button"/,'clear style must not accidentally submit the form');

for (const token of [
  'const desired = Boolean(attention.checked)',
  'attentionNotificationsEnabled:desired',
  'attention.checked = desired',
  "bindExtensionPageButton('openConstellation', 'chat-vault.html'",
  'Open a supported AI chat to use tab tags.',
  'Reset metrics for the current supported AI chat.',
  "provider?.id === 'chatgpt'",
  'No other projects',
  'Focused the existing provider tab. No duplicate was opened.',
  "button.open-chat,button.focus-chat",
  "data-dialog-close"
]) assert.ok(qol.includes(token),`shared QOL hardening missing ${token}`);

assert.match(qol,/const desired = Boolean\(attention\.checked\);[\s\S]*setTimeout\(async \(\) => \{[\s\S]*attentionNotificationsEnabled:desired/,'attention toggle repair must capture the user choice before popup legacy rerender and commit it afterward');
assert.match(qol,/observe\(chatPulse, \{ childList:true, subtree:true \}\)/,'popup organizer hardening should observe only the Pulse surface, not the entire document');
assert.match(qol,/event\.stopImmediatePropagation\(\)/,'QOL routing must suppress conflicting legacy click handlers when it takes ownership');
assert.match(qol,/chrome\.tabs\.query\(\{\}\)/,'open/focus actions should deduplicate existing tabs before creating another');
assert.doesNotMatch(qol,/setInterval\s*\(/,'QOL hardening must remain event/mutation driven');

for (const token of [
  "if (!result?.ok) throw new Error",
  "existing?.remove()",
  'resetRemoteCard(card)',
  "const label = active > 0 ? `${base} + remote ${active}` : base"
]) assert.ok(watchUi.includes(token),`remote heartbeat UI hardening missing ${token}`);

console.log('ui-qol-static: ok');
