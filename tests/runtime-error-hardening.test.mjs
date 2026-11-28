import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const pageProbe = read('extension/src/chatgpt-page-probe.js');
const scheduleObserver = read('extension/src/scheduled-task-observer.js');
const scheduleProbe = read('extension/src/scheduled-task-page-probe.js');
const background = read('extension/background.js');

assert.match(pageProbe, /\^\\\/(?:\(\?:)?backend-api\|api/,
  'ChatGPT transcript probe must refuse backend-api/api document surfaces');
assert.match(pageProbe, /const postSelf = \(payload\) =>/,
  'ChatGPT transcript probe must use a guarded self-window message helper');
assert.match(pageProbe, /window\.postMessage\(payload, '\*'\)/,
  'self-window transport must tolerate opaque/sandboxed document origins');
assert.doesNotMatch(pageProbe, /postMessage\([^\n]+location\.origin/,
  'page probe must not use location.origin as postMessage target');
assert.doesNotMatch(scheduleObserver, /postMessage\([^\n]+location\.origin/,
  'Scheduled Task observer bridge must not use location.origin as postMessage target');
assert.doesNotMatch(scheduleProbe, /postMessage\([^\n]+location\.origin/,
  'Scheduled Task MAIN-world probe must not use location.origin as postMessage target');

const defAt = background.indexOf('async function maybeStartAutomaticCatalog()');
const alarmAt = background.indexOf("alarm.name === CATALOG_MAINTENANCE_ALARM");
assert.ok(defAt >= 0, 'automatic catalog maintenance function must be defined');
assert.ok(alarmAt > defAt, 'automatic catalog function must exist before its alarm handler uses it');
const fn = background.slice(defAt, background.indexOf('async function pauseCatalog', defAt));
for (const token of ['catalogCfg.autoSweep','catalogState()','intervalHours','lastAutoSweepAt','providerIds','startCatalog(providerIds, { autoTriggered:true })']) {
  assert.ok(fn.includes(token), `automatic catalog maintenance missing ${token}`);
}

console.log('runtime-error-hardening.test.mjs: PASS');
