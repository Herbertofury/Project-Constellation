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
  LIVE_STALE_STATUSES:new Set(['paused','waiting-user','blocked-approval','delivery-timeout','connection-interrupted','response-interrupted','send-failed','refresh-required','rate-limited','errored','stalled','auth-required','unavailable']),
  LIVE_STALE_HEALTH_STATES:new Set(['delivery-timeout','connection-interrupted','response-interrupted','send-failed','refresh-required','rate-limited','blocked-approval','auth-required','unavailable','stalled','dead','request-stalled','tool-stalled','tool-dead','degraded','stale-page']),
  LIVE_ACTIVE_HEALTH_STATES:new Set(['working','tool-running','tool-quiet','quiet-working'])
};
vm.createContext(sandbox);
vm.runInContext(`${bucketSource}; globalThis.__bucket=livePulseBucket;`, sandbox);
assert.equal(sandbox.__bucket({chat:{status:'idle',healthState:'healthy'},generation:{active:false}}, {pending:9,streamLikely:true}), 'completed', 'background provider traffic cannot resurrect a completed chat');
assert.equal(sandbox.__bucket({chat:{status:'running',healthState:'working'},generation:{active:true}}, {pending:0}), 'active');
assert.equal(sandbox.__bucket({chat:{status:'rate-limited',healthState:'rate-limited'}}, {pending:4}), 'stale');
assert.equal(sandbox.__bucket({chat:{status:'delivery-timeout',healthState:'delivery-timeout'},failure:{active:true,retryAvailable:true}}, {pending:4}), 'stale', 'explicit provider failure stays Needs Attention even with pending network');
const managedGroupSource = functionSource('managedGroupBucket');
const groupSandbox = { TAB_GROUP_PREFIX:'PC ✦' }; vm.createContext(groupSandbox); vm.runInContext(`${managedGroupSource}; globalThis.__groupBucket=managedGroupBucket;`, groupSandbox);
assert.equal(groupSandbox.__groupBucket('My Research'), '', 'user-created tab group is never treated as Constellation-owned');
assert.equal(groupSandbox.__groupBucket('PC ✦ 🟣 Active'), 'active');
assert.equal(groupSandbox.__groupBucket('PC ✦ ⚠️ Needs attention'), 'stale');
assert.equal(groupSandbox.__groupBucket('PC ✦ ✅ Completed'), 'completed');
assert.match(source, /message\?\.state\?\.sentinel !== true \|\| message\?\.state\?\.source !== 'live-sentinel'/, 'legacy content pushes are rejected');
assert.match(source, /existing\?\.version === LIVE_SENTINEL_VERSION/, 'hot upgrades replace stale Sentinel versions');
assert.match(source, /files:\[HEALTH_CORE_FILE, LIVE_SENTINEL_FILE\]/, 'hot upgrades inject the current health core with the Sentinel so existing tabs gain Runway Sentinel without refresh');
const contentSource = fs.readFileSync(new URL('../extension/src/content.js', import.meta.url), 'utf8');
function functionSourceFrom(text, name) {
  const start = text.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  let parens = 0, brace = -1;
  for (let i = text.indexOf('(', start); i < text.length; i += 1) {
    if (text[i] === '(') parens += 1; else if (text[i] === ')') parens -= 1; else if (text[i] === '{' && parens === 0) { brace = i; break; }
  }
  let depth = 0;
  for (let i = brace; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1; else if (text[i] === '}') { depth -= 1; if (depth === 0) return text.slice(start, i + 1); }
  }
  throw new Error(`Could not extract ${name}`);
}
const scheduleStart = contentSource.indexOf('function scheduleLiveHealthPulse');
const scheduleEnd = contentSource.indexOf('const ACTIVE_TOOL_LABEL_PATTERN', scheduleStart);
const scheduleSource = contentSource.slice(scheduleStart, scheduleEnd);
assert.doesNotMatch(scheduleSource, /outputCompareSummary\?\.active|output-regressed/, 'Output Vault warnings stay out of the primary active polling lane');
const reconcileSource = functionSourceFrom(contentSource, 'reconcileHealthSnapshotWithSentinel');
const reconcileSandbox = {
  brain:{normalizeText:(value,max=150)=>String(value||'').slice(0,max)},
  liveSentinelState:()=>reconcileSandbox.__sentinel,
  __sentinel:{ok:true,source:'live-sentinel',chat:{status:'running'},generation:{phase:'thinking',quietForMs:130000},tool:{present:true,active:true,busy:true,label:'Running tool',phase:'executing',lastProgressAt:Date.now()-130000,entryCount:2}}
};
vm.createContext(reconcileSandbox);
vm.runInContext(`${reconcileSource}; globalThis.__reconcile=reconcileHealthSnapshotWithSentinel;`, reconcileSandbox);
let reconciled = reconcileSandbox.__reconcile({state:'tool-stalled',level:'danger',title:'Tool call looks stuck',detail:'No meaningful progress',capacity:{state:'clear'},activity:null});
assert.equal(reconciled.state,'tool-stalled','Sentinel running cannot erase a proven watchdog stall');
assert.equal(reconciled.level,'danger');
reconciled = reconcileSandbox.__reconcile({state:'working',level:'danger',title:'Chat is working',detail:'',capacity:{state:'handoff',level:'danger',title:'Secure a handoff now',detail:'Runway narrow',recommendedAction:'handoff'},activity:null});
assert.equal(reconciled.state,'capacity-handoff','capacity danger remains primary during active generation');
assert.equal(reconciled.title,'Secure a handoff now');
reconcileSandbox.__sentinel={ok:true,source:'live-sentinel',chat:{status:'idle'},generation:{},tool:{}};
reconciled = reconcileSandbox.__reconcile({state:'capacity-watch',level:'warning',title:'Conversation runway narrowing',detail:'',capacity:{state:'watch',level:'warning'},activity:null});
assert.equal(reconciled.state,'capacity-watch','Sentinel idle cannot hide a capacity warning');
const sentinelSource = fs.readFileSync(new URL('../extension/src/live-sentinel.js', import.meta.url), 'utf8');
const transcriptProbeSource = fs.readFileSync(new URL('../extension/src/chatgpt-page-probe.js', import.meta.url), 'utf8');
const tabBeaconSource = fs.readFileSync(new URL('../extension/src/tab-beacon.js', import.meta.url), 'utf8');
assert.match(sentinelSource, /const rawActive = failure\.active \? false : transcriptFinal \? false : transcriptRunning \? true : domActive/, 'fresh transcript finality outranks stale DOM while unfinished transcript outranks settled DOM');
assert.match(sentinelSource, /PC_LIVE_SENTINEL_REFRESH_TRANSCRIPT/, 'authoritative transport completion can request an event-driven transcript refresh');
assert.doesNotMatch(sentinelSource, /if \(state\.running\) \{ lastActivityAt = now\(\); lastProgressAt = now\(\); \}/, 'transcript polling alone never refreshes the progress clock');
assert.match(sentinelSource, /persistent spinner\/active label is proof[\s\S]{0,260}Only a changed current-tool signature resets/, 'unchanged tool spinners are not treated as forward progress');
assert.match(contentSource, /storedChars[\s\S]{0,500}transcriptTurns[\s\S]{0,500}transcriptChars/, 'capacity evidence combines persistent storage with full transcript measurements');
assert.match(source, /authoritativeTransport[\s\S]{0,500}PC_LIVE_SENTINEL_REFRESH_TRANSCRIPT/, 'background requests transcript refresh after authoritative ChatGPT transport settles');
assert.match(sentinelSource, /button\[data-testid="copy-turn-action-button"\]/, 'current ChatGPT completion control uses the precise production testid');
assert.match(sentinelSource, /currentAssistantBusy/, 'aria-busy is scoped to the current assistant turn rather than page layout ancestors');
for (const marker of ['/backend-api/conversation/','finished_successfully','end_turn','chatgpt_sdk.widget_state']) assert.ok(transcriptProbeSource.includes(marker), `transcript probe includes ${marker}`);
assert.match(source, /if \(!currentManagedBucket\) return; \/\/ User-created groups stay exactly where the user put them\./, 'automatic status grouping preserves user-created tab groups');
assert.match(source, /tabGroupSyncQueue = tabGroupSyncQueue\.catch/, 'Constellation-owned group moves are serialized to avoid duplicate status groups');
assert.match(source, /fallbackLiveRow[\s\S]{0,1200}status:'unavailable'[\s\S]{0,300}bucket:'stale'/, 'unresponsive open chat tabs remain represented instead of disappearing from Pulse counts');
assert.match(source, /let state = await readLiveSentinelState\(tabId\);[\s\S]{0,450}ensureChatGPTPageProbe/, 'Pulse reads the installed Sentinel before doing expensive MAIN-world reinjection checks');
for (const marker of ['chrome.tabs.group','chrome.tabGroups.update','PC_TAB_TAG_SET','renderActionBadge']) assert.ok(source.includes(marker), `tab presentation backend includes ${marker}`);
for (const marker of ['PC_TAB_BEACON_APPLY','faviconDataUri','baseTitle']) assert.ok(tabBeaconSource.includes(marker), `tab beacon content includes ${marker}`);
console.log('live-state-policy.test.mjs: PASS');
