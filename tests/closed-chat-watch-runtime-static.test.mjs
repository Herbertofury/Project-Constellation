import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../extension/src/closed-chat-watch.js', import.meta.url), 'utf8');

function bodyBetween(startToken,endToken) {
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken,start + startToken.length);
  assert.ok(start >= 0, `missing ${startToken}`);
  assert.ok(end > start, `missing boundary ${endToken}`);
  return source.slice(start,end);
}

const capture = bodyBetween('async function captureQuickAction','async function governorDelay');
const armedAt = capture.indexOf('preflightByTab.set(tabId,{meta,state:null,explicit:true');
const probeAt = capture.indexOf('const state = await withTimeout');
assert.ok(armedAt >= 0 && probeAt >= 0 && armedAt < probeAt, 'explicit stash fallback must be armed before awaiting Sentinel');
assert.match(capture,/const current = preflightByTab\.get\(tabId\)/);
assert.match(capture,/\.\.\.current,state/);

const cancel = bodyBetween('async function cancelWatch','async function reconcileOpenTabs');
const noWatchAt = cancel.indexOf('if (!current?.watches?.[safe]) return false;');
const mutateAt = cancel.indexOf('return mutateState');
assert.ok(noWatchAt >= 0 && mutateAt >= 0 && noWatchAt < mutateAt, 'ordinary tab updates must not write local watch storage when there is no watch to cancel');

const reconcile = bodyBetween('async function reconcileOpenTabs','async function readConfiguredMode');
const noChangesAt = reconcile.indexOf('if (!cancellable.length)');
const reconcileMutateAt = reconcile.indexOf('await mutateState');
assert.ok(noChangesAt >= 0 && reconcileMutateAt >= 0 && noChangesAt < reconcileMutateAt, 'service-worker wake reconciliation must avoid no-op local-storage writes');
assert.match(reconcile,/scheduleAlarmFrom\(current\)/,'no-op reconciliation must still restore the next one-shot alarm');

const syncCandidate = bodyBetween('async function syncCandidate','async function readCandidate');
assert.match(source,/const CANDIDATE_PREFIX = 'projectConstellationClosedChatCandidate:'/);
assert.match(source,/return chrome\.storage\?\.session \|\| null/,'manual-close continuity must use session storage rather than permanent local storage');
assert.match(syncCandidate,/const keep = Boolean\(info\.active \|\| info\.attention\)/,'only meaningful active/attention chats should become manual-close candidates');
assert.match(syncCandidate,/if \(candidateSignatures\.get\(id\) === signature\) return false/,'repeated identical live-state pushes must not rewrite the candidate');
assert.match(syncCandidate,/await area\.set\(\{\[key\]:row\}\)/,'meaningful candidate transitions should survive service-worker sleep');

const removed = bodyBetween('async function handleTabRemoved','chrome.runtime.onMessage.addListener');
assert.match(removed,/const persisted = await readCandidate\(id\)/,'manual tab close must recover the candidate after MV3 worker suspension');
assert.match(removed,/persisted\?\.meta/);
assert.match(removed,/persisted\?\.state/);
assert.match(removed,/await clearCandidate\(id\)/,'session candidate must be cleared once the close is consumed');

const pushHandler = bodyBetween("if (message?.type === 'PC_LIVE_CHAT_STATE_PUSH'","if (message?.type === 'PC_COMMAND_CENTER_RUN_QUICK_ACTION'");
assert.match(pushHandler,/syncCandidate\(tabId,meta,state\)/,'live-state transitions must maintain the MV3-safe candidate');

assert.doesNotMatch(source,/CANDIDATE_PREFIX[\s\S]{0,600}chrome\.storage\.local/,'manual-close candidates must not be persisted to local storage');
assert.doesNotMatch(source,/setInterval\s*\(/,'heartbeat runtime must not spin continuously');
assert.doesNotMatch(source,/periodInMinutes|periodInSeconds/,'heartbeat runtime must not install a recurring alarm');
assert.doesNotMatch(source,/chrome\.tabs\.create\([^\n]*active\s*:\s*false/,'heartbeat runtime must not create hidden provider tabs');

console.log('closed-chat-watch-runtime-static: ok');
