import fs from 'node:fs';
import assert from 'node:assert/strict';

const background = fs.readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');
const sentinel = fs.readFileSync(new URL('../extension/src/live-sentinel.js', import.meta.url), 'utf8');
const health = fs.readFileSync(new URL('../extension/src/health-core.js', import.meta.url), 'utf8');

assert.match(background, /import '\.\/src\/chat-guardian-core\.js'/, 'background must load the reusable all-tab guardian policy');
assert.match(background, /ProjectConstellationChatGuardianCore/, 'background must use the guardian policy instead of duplicating status rules');
assert.match(background, /chrome\.tabs\.query\(\{\}\)/, 'guardian must be able to enumerate all open ChatGPT tabs');
assert.match(background, /Promise\.allSettled\(tabs\.map/, 'one broken tab must not block supervision of the rest');
assert.match(background, /autoDiscardable:false/, 'ChatGPT work tabs are kept resident instead of silently falling out of supervision');
assert.match(background, /tab\.frozen \|\| tab\.discarded/, 'frozen/discarded ChatGPT tabs are deferred instead of accumulating queued probes');
assert.match(background, /chrome\.tabs\.onActivated/, 'a tab becoming active triggers immediate guardian reconciliation after Chrome unfreezes it');
assert.match(background, /changeInfo\?\.frozen === false/, 'Chrome frozen-state transitions trigger immediate reconciliation when a tab becomes runnable');
assert.match(background, /PC_LIVE_SENTINEL_CONTINUE_UNFINISHED/, 'guardian recovery must ask the in-tab sentinel to continue unfinished work');
assert.match(background, /CHAT_GUARDIAN_ALARM[\s\S]{0,1200}\{ when:/, 'guardian fallback must be a re-armed one-shot alarm');
assert.doesNotMatch(background, /chrome\.alarms\.create\(CHAT_GUARDIAN_ALARM,\s*\{\s*periodInMinutes/, 'guardian must not regress to fixed repeating polling');
assert.match(background, /scheduleChatGuardianSweep\(2200\)/, 'explicit terminal state changes trigger an event-first recovery check');
assert.match(background, /safeReloadActions = new Set\(\['composer-unavailable','send-unavailable','stage-failed'\]\)/, 'a failed continuation can use one bounded reload fallback without looping');

assert.match(sentinel, /const VERSION = '0\.25\.0'/, 'hot-injected sentinel version must advance so already-open tabs receive the fix');
assert.match(sentinel, /PC_LIVE_SENTINEL_CONTINUE_UNFINISHED/, 'sentinel must expose the guarded continuation operation');
assert.match(sentinel, /Continue the unfinished task\./, 'automatic recovery sends a simple continuation turn');
assert.match(sentinel, /composer-busy/, 'guardian must never overwrite a user draft');
assert.match(sentinel, /already-complete/, 'guardian must not wake a completed conversation');
assert.match(sentinel, /blocked-hold/, 'approval/auth/rate-limit/review holds remain non-bypassable');
assert.match(sentinel, /sessionStorage\.setItem\(dedupeKey/, 'in-tab dedupe prevents duplicate continuation sends during worker races');

assert.match(health, /stream recovery\(\?:\\s\+polling\)\?/, 'health classifier covers the new stream-recovery timeout wording family');
assert.match(health, /genericTerminalFailure/, 'equivalent future provider terminal wording has semantic fallback classification');

console.log('chat-guardian-runtime-static.test.mjs: PASS');
