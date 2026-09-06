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
const armedAt = capture.indexOf('preflightByTab.set(tabId,{ meta,state:null,explicit:true');
const probeAt = capture.indexOf('const state = await withTimeout');
assert.ok(armedAt >= 0 && probeAt >= 0 && armedAt < probeAt, 'explicit stash fallback must be armed before awaiting Sentinel');
assert.match(capture,/const current = preflightByTab\.get\(tabId\)/);
assert.match(capture,/\.\.\.current,state/);

const cancel = bodyBetween('async function cancelWatch','async function reconcileOpenTabs');
const noWatchAt = cancel.indexOf('if (!current?.watches?.[safe]) return false;');
const mutateAt = cancel.indexOf('return mutateState');
assert.ok(noWatchAt >= 0 && mutateAt >= 0 && noWatchAt < mutateAt, 'ordinary tab updates must not write storage when there is no watch to cancel');

const reconcile = bodyBetween('async function reconcileOpenTabs','async function readConfiguredMode');
const noChangesAt = reconcile.indexOf('if (!cancellable.length)');
const reconcileMutateAt = reconcile.indexOf('await mutateState');
assert.ok(noChangesAt >= 0 && reconcileMutateAt >= 0 && noChangesAt < reconcileMutateAt, 'service-worker wake reconciliation must avoid no-op storage writes');
assert.match(reconcile,/scheduleAlarmFrom\(current\)/,'no-op reconciliation must still restore the next one-shot alarm');

assert.doesNotMatch(source,/setInterval\s*\(/,'heartbeat runtime must not spin continuously');
assert.doesNotMatch(source,/periodInMinutes|periodInSeconds/,'heartbeat runtime must not install a recurring alarm');
assert.doesNotMatch(source,/chrome\.tabs\.create\([^\n]*active\s*:\s*false/,'heartbeat runtime must not create hidden provider tabs');

console.log('closed-chat-watch-runtime-static: ok');
