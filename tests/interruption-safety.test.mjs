import fs from 'node:fs';
import assert from 'node:assert/strict';

const sentinel = fs.readFileSync(new URL('../extension/src/live-sentinel.js', import.meta.url), 'utf8');
const background = fs.readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');
const content = fs.readFileSync(new URL('../extension/src/content.js', import.meta.url), 'utf8');
const health = fs.readFileSync(new URL('../extension/src/health-core.js', import.meta.url), 'utf8');
const popup = fs.readFileSync(new URL('../extension/popup.js', import.meta.url), 'utf8');
const integrity = fs.readFileSync(new URL('../extension/src/integrity-core.js', import.meta.url), 'utf8');

const states = ['delivery-timeout','connection-interrupted','response-interrupted','send-failed'];
for (const state of states) {
  assert.ok(health.includes(state), `health core includes ${state}`);
  assert.ok(sentinel.includes(state), `sentinel includes ${state}`);
  assert.ok(background.includes(state), `background includes ${state}`);
  assert.ok(content.includes(state), `content includes ${state}`);
  assert.ok(popup.includes(state), `popup includes ${state}`);
  assert.ok(integrity.includes(state), `integrity includes ${state}`);
}

assert.match(health, /function classifyProviderFailure\(/, 'provider failures have a dedicated classifier');
assert.match(sentinel, /function failureSurfaceEvidence\(/, 'Sentinel has current-turn failure evidence');
assert.match(sentinel, /!isCurrentFrontierNode\(node, frontier\)/, 'historical failure banners cannot poison a newer turn');
assert.match(sentinel, /const rawActive = failure\.active \? false : transcriptFinal \? false : transcriptRunning \? true : domActive/, 'explicit current failure outranks stale running evidence');
assert.match(sentinel, /function retryCurrentFailure\([\s\S]*?failure\.control\.click\(\)/, 'manual retry delegates to the provider control');
assert.equal((sentinel.match(/failure\.control\.click\(\)/g) || []).length, 1, 'there is exactly one provider failure click site');
assert.match(sentinel, /PC_LIVE_SENTINEL_RETRY_FAILURE/, 'Sentinel exposes an explicit retry message');
assert.match(content, /id="pcHealthRetry"/, 'Execution Pulse exposes manual Retry when available');
assert.match(content, /function retryFailure\(/, 'content has an explicit manual retry bridge');
assert.match(content, /automaticRetryForbidden:true/, 'approval/recovery scan reports automatic retry forbidden');
assert.doesNotMatch(content.match(/function providerFailureSurface\([\s\S]*?\n  }/)?.[0] || '', /\.click\(/, 'failure detection itself never clicks Retry');

const retryStart = background.indexOf('async function retryLiveChatFailure(');
const retryEnd = background.indexOf('\nasync function focusLiveChat', retryStart);
assert.ok(retryStart >= 0 && retryEnd > retryStart, 'background explicit retry bridge exists');
const retryBody = background.slice(retryStart, retryEnd);
assert.match(retryBody, /PC_LIVE_SENTINEL_RETRY_FAILURE/, 'background delegates retry to the already-open tab');
for (const banned of ['tabs.create','tabs.update','tabs.reload','windows.create','windows.update']) assert.ok(!retryBody.includes(banned), `retry bridge never uses ${banned}`);
assert.match(background, /automaticRetryForbidden:interrupted \|\| Boolean\(status\.automaticRetryForbidden\)/, 'persisted interruption state forbids automatic retry');
assert.match(popup, /chat-list-retry[\s\S]*?PC_RETRY_LIVE_CHAT_FAILURE/, 'Needs Attention exposes explicit retry action');
const popupRetryStart = popup.indexOf("type:'PC_RETRY_LIVE_CHAT_FAILURE'");
assert.ok(popupRetryStart >= 0);
assert.doesNotMatch(popup.slice(popupRetryStart, popupRetryStart + 700), /PC_FOCUS_LIVE_CHAT|window\.close\(/, 'retry action does not focus/navigate/close the popup as a side effect');
assert.match(integrity, /Constellation never retries automatically/, 'Integrity explains interruption recovery truthfully');

console.log('interruption-safety.test.mjs: PASS');
