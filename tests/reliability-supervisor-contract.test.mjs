import fs from 'node:fs';
import assert from 'node:assert/strict';

const manifest = JSON.parse(fs.readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
const worker = fs.readFileSync(new URL('../extension/service-worker.js', import.meta.url), 'utf8');
const supervisorBg = fs.readFileSync(new URL('../extension/src/tab-supervisor-background.js', import.meta.url), 'utf8');
const supervisor = fs.readFileSync(new URL('../extension/src/tab-supervisor.js', import.meta.url), 'utf8');
const build = fs.readFileSync(new URL('../tools/build.mjs', import.meta.url), 'utf8');

assert.equal(manifest.background?.service_worker, 'service-worker.js', 'composed service worker must own background + reliability supervisor');
assert.match(worker, /import '\.\/background\.js'/);
assert.match(worker, /import '\.\/src\/tab-supervisor-background\.js'/);
const contentEntry = (manifest.content_scripts || []).find((row) => (row.js || []).includes('src/tab-supervisor.js'));
assert(contentEntry, 'tab supervisor must be shipped as a content script');
assert((contentEntry.matches || []).includes('https://chatgpt.com/*'));
assert((contentEntry.js || []).includes('src/tab-supervisor-core.js'));

assert.match(supervisorBg, /chrome\.tabs\.query\(\{\}\)/, 'background supervisor enumerates every open tab');
assert.match(supervisorBg, /PC_TAB_SUPERVISOR_TICK/, 'background supervisor wakes each ChatGPT content supervisor');
assert.match(supervisorBg, /chrome\.scripting\.executeScript/, 'existing open tabs can be bootstrapped after extension update');
assert.match(supervisorBg, /chrome\.tabs\.reload\(tabId/, 'stale/dead chat rescue performs the requested reload');
assert.match(supervisorBg, /enabled: cfg\.refreshRecovery\?\.enabled === true/, 'automatic reload honors the existing recovery enable switch');
assert.match(supervisorBg, /periodInMinutes: 1/, 'all-tab watchdog receives a service-worker heartbeat even when page timers are throttled');
assert.match(supervisorBg, /observerAge < 90_000/, 'background owns stale-state recovery when a hidden/frozen content agent stops reporting');
assert.doesNotMatch(supervisorBg, /query\(\{\s*active\s*:\s*true/, 'supervisor must never collapse to active-tab-only behavior');

assert.match(supervisor, /document\.hidden \? 1000 : 180/, 'hidden tabs are still evaluated instead of being skipped');
assert.doesNotMatch(supervisor, /if \(document\.hidden\) return/, 'hidden tabs must not disable supervision');
assert.match(supervisor, /runApprovalAutopilot/, 'each tab independently handles connector permission prompts');
assert.match(supervisor, /always allow|always-allow/i, 'persistent allow path is available per tab');
assert.match(supervisor, /scanProjects\(/, 'project discovery runs inside each ChatGPT tab');
assert.match(supervisor, /projectFromUrl\(location\.href\)/, 'ChatGPT project routes are first-class project identity');
assert.match(supervisor, /resumeAfterReload/, 'reloaded chats receive a continuation recovery path');
assert.match(supervisor, /findSendButton\(\)/, 'continuation recovery can send after hydration');
assert.match(supervisor, /PC_BRAIN_INGEST_BATCH/, 'visible work is checkpointed before supervisor recovery decisions');

for (const marker of ["'service-worker.js'", "'tab-supervisor-core.js'", "'tab-supervisor-background.js'", "'tab-supervisor.js'"]) {
  assert.ok(build.includes(marker), `build must package ${marker}`);
}

console.log('reliability-supervisor-contract.test.mjs: PASS');
