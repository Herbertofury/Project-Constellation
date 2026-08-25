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
console.log('live-state-policy.test.mjs: PASS');
