import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');
function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  let parens = 0;
  let brace = -1;
  for (let i = source.indexOf('(', start); i < source.length; i += 1) {
    if (source[i] === '(') parens += 1;
    else if (source[i] === ')') parens -= 1;
    else if (source[i] === '{' && parens === 0) { brace = i; break; }
  }
  assert.ok(brace >= 0, `${name} body exists`);
  let depth = 0;
  for (let i = brace; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`Could not extract ${name}`);
}

const bucketSource = functionSource('livePulseBucket');
const sandbox = {
  LIVE_STALE_STATUSES:new Set(['paused','waiting-user','blocked-approval','refresh-required','rate-limited','errored','stalled','auth-required','unavailable']),
  LIVE_STALE_HEALTH_STATES:new Set(['refresh-required','rate-limited','blocked-approval','auth-required','unavailable','stalled','dead','request-stalled','tool-stalled','tool-dead','degraded','stale-page']),
  LIVE_ACTIVE_HEALTH_STATES:new Set(['working','tool-running','tool-quiet','quiet-working'])
};
vm.createContext(sandbox);
vm.runInContext(`${bucketSource}; globalThis.__bucket=livePulseBucket;`, sandbox);
assert.equal(sandbox.__bucket({chat:{status:'idle',healthState:'healthy'},generation:{active:false}}, {pending:9,streamLikely:true}), 'completed', 'background provider traffic cannot resurrect a completed chat');
assert.equal(sandbox.__bucket({chat:{status:'running',healthState:'working'},generation:{active:true}}, {pending:0}), 'active');
assert.equal(sandbox.__bucket({chat:{status:'rate-limited',healthState:'rate-limited'}}, {pending:4}), 'stale');
assert.match(source, /message\?\.state\?\.sentinel !== true \|\| message\?\.state\?\.source !== 'live-sentinel'/, 'legacy content pushes are rejected');
assert.match(source, /existing\?\.version === LIVE_SENTINEL_VERSION/, 'hot upgrades replace stale Sentinel versions');
const contentSource = fs.readFileSync(new URL('../extension/src/content.js', import.meta.url), 'utf8');
const scheduleStart = contentSource.indexOf('function scheduleLiveHealthPulse');
const scheduleEnd = contentSource.indexOf('const ACTIVE_TOOL_LABEL_PATTERN', scheduleStart);
const scheduleSource = contentSource.slice(scheduleStart, scheduleEnd);
assert.doesNotMatch(scheduleSource, /outputCompareSummary\?\.active|output-regressed/, 'Output Vault warnings stay out of the primary active polling lane');
const sentinelSource = fs.readFileSync(new URL('../extension/src/live-sentinel.js', import.meta.url), 'utf8');
const transcriptProbeSource = fs.readFileSync(new URL('../extension/src/chatgpt-page-probe.js', import.meta.url), 'utf8');
const tabBeaconSource = fs.readFileSync(new URL('../extension/src/tab-beacon.js', import.meta.url), 'utf8');
assert.match(sentinelSource, /const rawActive = transcriptFinal \? false : transcriptRunning \? true : domActive/, 'fresh transcript finality outranks stale DOM while unfinished transcript outranks settled DOM');
assert.match(sentinelSource, /PC_LIVE_SENTINEL_REFRESH_TRANSCRIPT/, 'authoritative transport completion can request an event-driven transcript refresh');
assert.match(source, /authoritativeTransport[\s\S]{0,500}PC_LIVE_SENTINEL_REFRESH_TRANSCRIPT/, 'background requests transcript refresh after authoritative ChatGPT transport settles');
assert.match(sentinelSource, /button\[data-testid="copy-turn-action-button"\]/, 'current ChatGPT completion control uses the precise production testid');
assert.match(sentinelSource, /currentAssistantBusy/, 'aria-busy is scoped to the current assistant turn rather than page layout ancestors');
for (const marker of ['/backend-api/conversation/','finished_successfully','end_turn','chatgpt_sdk.widget_state']) assert.ok(transcriptProbeSource.includes(marker), `transcript probe includes ${marker}`);
assert.match(source, /if \(!currentManagedBucket\) return; \/\/ Never steal a user-created group\./, 'automatic status grouping preserves user-created tab groups');
for (const marker of ['chrome.tabs.group','chrome.tabGroups.update','PC_TAB_TAG_SET','renderActionBadge']) assert.ok(source.includes(marker), `tab presentation backend includes ${marker}`);
for (const marker of ['PC_TAB_BEACON_APPLY','faviconDataUri','baseTitle']) assert.ok(tabBeaconSource.includes(marker), `tab beacon content includes ${marker}`);
console.log('live-state-policy.test.mjs: PASS');
