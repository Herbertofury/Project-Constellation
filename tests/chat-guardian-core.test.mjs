import assert from 'node:assert/strict';
await import('../extension/src/chat-guardian-core.js');
const guardian = globalThis.ProjectConstellationChatGuardianCore;
assert(guardian);
const now = 1_000_000;
const base = { tabId:7, providerId:'chatgpt', chatId:'chatgpt:abc', status:'idle', healthState:'healthy', generation:{active:false,quietForMs:0}, network:{pending:0} };

let decision = guardian.shouldAttempt({ ...base, status:'response-interrupted', failure:{active:true,state:'response-interrupted',detectedAt:now-5000,rawText:'ChatGPT stream recovery polling timed out'} }, {}, {}, now);
assert.equal(decision.recover, true);
assert.equal(decision.reason, 'response-interrupted');
assert.equal(decision.prompt, 'Continue the unfinished task.');
assert(decision.fingerprint);

const history = { fingerprint:decision.fingerprint, attempts:1, lastAttemptAt:now-1000 };
decision = guardian.shouldAttempt({ ...base, status:'response-interrupted', failure:{active:true,state:'response-interrupted',detectedAt:now-5000,rawText:'ChatGPT stream recovery polling timed out'} }, history, {}, now);
assert.equal(decision.recover, false);
assert.equal(decision.reason, 'cooldown');

decision = guardian.shouldAttempt({ ...base, status:'blocked-approval', healthState:'blocked-approval' }, {}, {}, now);
assert.equal(decision.recover, false);
assert.equal(decision.reason, 'hold');

decision = guardian.shouldAttempt({ ...base, status:'provider-review', healthState:'provider-review' }, {}, {}, now);
assert.equal(decision.recover, false);
assert.equal(decision.reason, 'hold');

decision = guardian.shouldAttempt({ ...base, healthState:'tool-stalled', generation:{active:true,quietForMs:181000}, network:{pending:1} }, {}, {}, now);
assert.equal(decision.recover, false, 'an in-flight provider request is never interrupted by the guardian');
assert.equal(decision.reason, 'network-active');

decision = guardian.shouldAttempt({ ...base, healthState:'tool-stalled', generation:{active:false,quietForMs:100000}, network:{pending:0} }, {}, {}, now);
assert.equal(decision.recover, false, 'a newly stalled state gets a settling window before an automatic continue');
assert.equal(decision.reason, 'stall-settling');

decision = guardian.shouldAttempt({ ...base, healthState:'tool-stalled', generation:{active:false,quietForMs:220000}, network:{pending:0} }, {}, {}, now);
assert.equal(decision.recover, true);
assert.equal(decision.reason, 'tool-stalled');

decision = guardian.shouldAttempt({ ...base, healthState:'healthy' }, {}, {}, now);
assert.equal(decision.recover, false, 'completed/healthy idle chats are never woken');
assert.equal(decision.reason, 'healthy');

assert.equal(guardian.nextFallbackMs([{...base,status:'running',generation:{active:true}}],{}), guardian.DEFAULTS.activeFallbackMs);
assert.equal(guardian.nextFallbackMs([{...base,status:'idle'}],{}), guardian.DEFAULTS.idleFallbackMs);
console.log('chat-guardian-core.test.mjs: PASS');
