import fs from 'node:fs';
import assert from 'node:assert/strict';

const manifest = JSON.parse(fs.readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
const worker = fs.readFileSync(new URL('../extension/service-worker.js', import.meta.url), 'utf8');
const supervisorBg = fs.readFileSync(new URL('../extension/src/tab-supervisor-background.js', import.meta.url), 'utf8');
const approvalBg = fs.readFileSync(new URL('../extension/src/approval-supervisor-background.js', import.meta.url), 'utf8');
const supervisor = fs.readFileSync(new URL('../extension/src/tab-supervisor.js', import.meta.url), 'utf8');
const content = fs.readFileSync(new URL('../extension/src/content.js', import.meta.url), 'utf8');
const build = fs.readFileSync(new URL('../tools/build.mjs', import.meta.url), 'utf8');

assert.equal(manifest.background?.service_worker, 'service-worker.js', 'composed service worker must own background + reliability supervisors');
assert.match(worker, /import '\.\/background\.js'/);
assert.match(worker, /import '\.\/src\/tab-supervisor-background\.js'/);
assert.match(worker, /import '\.\/src\/approval-supervisor-background\.js'/);
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
assert.match(supervisorBg, /const responsiveTabIds = new Set\(\)/, 'background tracks which tabs answered the current wake');
assert.match(supervisorBg, /if \(responsiveTabIds\.has\(tab\.id\)\) continue/, 'freshly responsive tabs are excluded from stale-storage fallback recovery');
assert.doesNotMatch(supervisorBg, /query\(\{\s*active\s*:\s*true/, 'supervisor must never collapse to active-tab-only behavior');

assert.match(supervisor, /document\.hidden \? 1000 : 180/, 'hidden tabs are still evaluated instead of being skipped');
assert.doesNotMatch(supervisor, /if \(document\.hidden\) return/, 'hidden tabs must not disable supervision');
assert.match(supervisor, /type:'approval-scan'/, 'tab supervisor requests immediate approval recovery without clicking permission controls itself');
assert.doesNotMatch(supervisor, /\.button\.click\(\)|candidate\.button\.click\(\)/, 'tab supervisor must not duplicate the established approval click owner');
assert.match(content, /PC_APPROVAL_RECOVERY_SCAN/, 'existing tested content recovery handler remains the approval execution owner');
assert.match(approvalBg, /chrome\.tabs\.query\(\{\}\)/, 'approval supervisor enumerates all open ChatGPT tabs');
assert.match(approvalBg, /Promise\.allSettled/, 'approval scans fan out concurrently across tabs');
assert.match(approvalBg, /PC_APPROVAL_RECOVERY_SCAN/, 'approval supervisor delegates to the established recovery handler');
assert.match(approvalBg, /alwaysAllow:cfg\.approvalAutopilot\?\.alwaysAllow !== false/, 'persistent Always Allow preference is preserved');
assert.doesNotMatch(approvalBg, /query\(\{\s*active\s*:\s*true/, 'approval recovery must not become active-tab-only');

assert.match(supervisor, /scanProjects\(/, 'project discovery runs inside each ChatGPT tab');
assert.match(supervisor, /projectFromUrl\(location\.href\)/, 'ChatGPT project routes are first-class project identity');
assert.match(supervisor, /PC_BRAIN_COUNTS/, 'project discovery first proves the canonical brain schema is initialized');
assert.match(supervisor, /const pendingProjects = new Map\(\)/, 'project discoveries stay pending until persistence is acknowledged');
assert.match(supervisor, /project-upsert-result/, 'project discovery consumes persistence acknowledgements');
assert.match(supervisor, /message\.ok === true[^\n]*seenProjects\.set/, 'a project is only marked seen after a successful persistence ACK');
assert.match(supervisorBg, /brain-schema-not-ready/, 'background reports a retryable project schema failure instead of silently dropping it');
assert.match(supervisorBg, /type:'project-upsert-result'/, 'background ACKs project persistence success or failure to the originating tab');
assert.match(supervisor, /resumeAfterReload/, 'reloaded chats receive a continuation recovery path');
assert.match(supervisor, /findSendButton\(\)/, 'continuation recovery can send after hydration');
assert.match(supervisor, /let inserted = false/, 'continuation text is inserted at most once while waiting for send hydration');
assert.match(supervisor, /await new Promise\(\(resolve\) => setTimeout\(resolve, 500\)\)/, 'rescue waits for a late send control instead of abandoning a prefilled continuation');
assert.match(supervisor, /PC_BRAIN_INGEST_BATCH/, 'visible work is checkpointed before supervisor recovery decisions');

for (const marker of ["'service-worker.js'", "'tab-supervisor-core.js'", "'tab-supervisor-background.js'", "'approval-supervisor-background.js'", "'tab-supervisor.js'"]) {
  assert.ok(build.includes(marker), `build must package ${marker}`);
}

console.log('reliability-supervisor-contract.test.mjs: PASS');
