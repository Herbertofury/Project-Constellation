import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = (rel) => fs.readFileSync(path.join(root,rel),'utf8');

const bridge = read('extension/src/closed-chat-vault-bridge.js');
const entry = read('extension/background-entry.js');
const build = read('tools/build.mjs');

for (const token of [
  'ProjectConstellationClosedChatWatchRuntime',
  'ensureWatchesVisible',
  'vaultCore.LIVE_PROJECT_NAME',
  'vaultCore.ensureStack',
  'vaultCore.mergeItems',
  '[vaultCore.VAULT_KEY]',
  '[watchCore.WATCH_KEY]',
  'watchRuntime.cancelWatch(key)',
  'sourceTabId:0',
  'sourceWindowId:0'
]) assert.ok(bridge.includes(token),`closed-chat vault bridge missing ${token}`);

assert.match(bridge,/const added = new Set\(Object\.keys\(current\.watches \|\| \{\}\)\.filter\(\(key\) => !before\.has\(key\)\)\)/,'bridge should auto-save only newly created remote watches during normal operation');
assert.match(bridge,/for \(const key of before\) if \(!after\.has\(key\)\) watchRuntime\.cancelWatch\(key\)/,'discarded vault chats must cancel orphan remote watches');
assert.match(bridge,/chrome\.storage\.local\.get\(watchCore\.WATCH_KEY\)/,'worker startup must reconcile any already-active watches so manual-close monitoring is visible');
assert.doesNotMatch(bridge,/chrome\.tabs\.create\s*\(/,'vault bridge must not create hidden or visible provider tabs');
assert.doesNotMatch(bridge,/\bfetch\s*\(/,'vault bridge must not add network polling');
assert.doesNotMatch(bridge,/setInterval\s*\(/,'vault bridge must not spin continuously');

assert.ok(entry.indexOf("./src/closed-chat-watch.js") < entry.indexOf("./src/closed-chat-vault-bridge.js"),'watch runtime must load before its vault bridge');
assert.ok(entry.indexOf("./src/closed-chat-vault-bridge.js") < entry.indexOf("./src/command-center-actions.js"),'vault bridge should be ready before quick actions');
assert.match(build,/closed-chat-vault-bridge\.js/,'release build must ship the closed-chat vault bridge');

console.log('closed-chat-vault-bridge-static: ok');
