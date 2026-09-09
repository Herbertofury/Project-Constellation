import fs from 'node:fs';
import assert from 'node:assert/strict';

const manifest = JSON.parse(fs.readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
const entry = fs.readFileSync(new URL('../extension/background-entry.js', import.meta.url), 'utf8');
const supervisorBg = fs.readFileSync(new URL('../extension/src/tab-supervisor-background.js', import.meta.url), 'utf8');
const approvalBg = fs.readFileSync(new URL('../extension/src/approval-supervisor-background.js', import.meta.url), 'utf8');
const supervisor = fs.readFileSync(new URL('../extension/src/tab-supervisor.js', import.meta.url), 'utf8');
const content = fs.readFileSync(new URL('../extension/src/content.js', import.meta.url), 'utf8');
const build = fs.readFileSync(new URL('../tools/build.mjs', import.meta.url), 'utf8');

assert.equal(manifest.background?.service_worker, 'background-entry.js', 'integrated v0.16 must retain the Command Center background entry');
for (const marker of [
  "import './src/chat-vault-core.js'",
  "import './src/command-center-action-core.js'",
  "import './src/closed-chat-watch.js'",
  "import './src/notification-repair.js'",
  "import './src/tab-supervisor-background.js'",
  "import './src/approval-supervisor-background.js'"
]) assert.ok(entry.includes(marker), `background entry must preserve ${marker}`);

const mainContent = (manifest.content_scripts || []).find((row) => (row.js || []).includes('src/tab-supervisor.js'));
assert(mainContent, 'tab supervisor must be shipped with ChatGPT content runtime');
assert((mainContent.js || []).includes('src/tab-supervisor-core.js'));
const organizerContent = (manifest.content_scripts || []).find((row) => (row.js || []).includes('src/chat-vault-core.js'));
assert(organizerContent, 'Command Center Chat Vault organizer must remain packaged');
assert((organizerContent.js || []).includes('src/chat-organizer.js'));

assert.match(supervisorBg, /chrome\.tabs\.query\(\{\}\)/, 'background supervisor enumerates every open tab');
assert.match(supervisorBg, /PC_TAB_SUPERVISOR_TICK/, 'background supervisor wakes each ChatGPT content supervisor');
assert.match(supervisorBg, /chrome\.scripting\.executeScript/, 'existing open tabs can be bootstrapped after extension update');
assert.match(supervisorBg, /chrome\.tabs\.reload\(tabId/, 'stale/dead chat rescue performs the requested reload');
assert.match(supervisorBg, /enabled:cfg\.refreshRecovery\?\.enabled === true/, 'automatic reload honors the existing Refresh Recovery switch');
assert.match(supervisorBg, /periodInMinutes:1/, 'all-tab watchdog receives a service-worker heartbeat even when page timers are throttled');
assert.match(supervisorBg, /observerAge < 90_000/, 'background owns stale-state recovery when a hidden/frozen content agent stops reporting');
assert.doesNotMatch(supervisorBg, /query\(\{\s*active\s*:\s*true/, 'reliability must never collapse to active-tab-only behavior');

assert.match(supervisor, /document\.hidden \? 1000 : 180/, 'hidden tabs remain evaluated instead of being skipped');
assert.doesNotMatch(supervisor, /if \(document\.hidden\) return/, 'hidden tabs must not disable the reliability path');
assert.match(supervisor, /type:'approval-scan'/, 'tab supervisor requests immediate permission recovery without owning approval clicks');
assert.doesNotMatch(supervisor, /candidate\.button\.click\(|\.button\.click\(\)/, 'new supervisor must not duplicate approval click ownership');
assert.match(content, /PC_APPROVAL_RECOVERY_SCAN/, 'existing tested content recovery handler remains the approval execution owner');

assert.match(approvalBg, /chrome\.tabs\.query\(\{\}\)/, 'approval supervisor enumerates all open ChatGPT tabs');
assert.match(approvalBg, /Promise\.allSettled/, 'approval recovery fans out concurrently across tabs');
assert.match(approvalBg, /PC_APPROVAL_RECOVERY_SCAN/, 'approval supervisor delegates to the established in-page handler');
assert.match(approvalBg, /alwaysAllow:cfg\.approvalAutopilot\?\.alwaysAllow !== false/, 'persistent Always Allow preference is preserved');
assert.doesNotMatch(approvalBg, /query\(\{\s*active\s*:\s*true/, 'approval recovery must not become active-tab-only');

assert.match(supervisor, /scanProjects\(/, 'project discovery runs inside each ChatGPT tab');
assert.match(supervisor, /projectFromUrl\(location\.href\)/, 'ChatGPT project routes are first-class project identity');
assert.match(supervisor, /resumeAfterReload/, 'reloaded chats receive a continuation recovery path');
assert.match(supervisor, /findSendButton\(\)/, 'continuation recovery can send after hydration');
assert.match(supervisor, /PC_BRAIN_INGEST_BATCH/, 'visible work is checkpointed before recovery decisions');

for (const marker of [
  "'background-entry.js'",
  "'chat-vault-core.js'",
  "'command-center-actions.js'",
  "'tab-supervisor-core.js'",
  "'tab-supervisor-background.js'",
  "'approval-supervisor-background.js'",
  "'tab-supervisor.js'"
]) assert.ok(build.includes(marker), `build must package ${marker}`);

console.log('reliability-supervisor-contract.test.mjs: PASS');
