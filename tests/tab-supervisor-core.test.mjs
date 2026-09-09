import assert from 'node:assert/strict';
await import('../extension/src/tab-supervisor-core.js');
const core = globalThis.ProjectConstellationTabSupervisorCore;
assert(core);

assert.equal(core.chatIdFromUrl('https://chatgpt.com/c/abc-123'), 'chatgpt:abc-123');
assert.equal(core.chatIdFromUrl('https://chatgpt.com/g/g-p-proj/c/abc-123'), 'chatgpt:abc-123');
assert.deepEqual(core.projectFromUrl('https://chatgpt.com/g/g-p-proj/c/abc-123'), { providerProjectId:'g-p-proj', id:'chatgpt:project:g-p-proj' });
assert.equal(core.classifyFailureText('Message delivery timed out. Please try again.'), 'delivery-timeout');
assert.equal(core.classifyFailureText('There was an error generating a response.'), 'response-interrupted');
assert.equal(core.classifyFailureText('A network error occurred while connecting.'), 'connection-interrupted');
assert.equal(core.classifyFailureText('Message was not sent.'), 'send-failed');

const now = 10_000_000;
let decision = core.shouldRecover({ enabled:true, chatId:'chatgpt:x', now, failureKind:'delivery-timeout', failureDetectedAt:now-4000, lastProgressAt:now-4000, config:{ failureRecoveryDelayMs:3500 } });
assert.equal(decision.recover, true, 'explicit delivery timeout is rescued automatically when recovery is enabled');

decision = core.shouldRecover({ enabled:true, chatId:'chatgpt:x', now, status:'running', wasRunning:true, lastProgressAt:now-(2*60*60*1000+1000), config:{ staleRunningMs:2*60*60*1000 } });
assert.equal(decision.recover, true, 'two-hour stale running chat is rescued');
assert.equal(decision.reason, 'stale-running-2h');

decision = core.shouldRecover({ enabled:true, chatId:'chatgpt:x', now, status:'idle', unresolvedUser:true, lastProgressAt:now-(2*60*60*1000+1000), config:{ staleRunningMs:2*60*60*1000 } });
assert.equal(decision.recover, true, 'two-hour unanswered user turn is rescued');
assert.equal(decision.reason, 'unanswered-user-turn');

decision = core.shouldRecover({ enabled:true, chatId:'chatgpt:x', now, status:'idle', wasRunning:false, unresolvedUser:false, lastProgressAt:now-(4*60*60*1000) });
assert.equal(decision.recover, false, 'ordinary completed idle chat is never auto-continued');

decision = core.shouldRecover({ enabled:true, chatId:'chatgpt:x', now, status:'blocked-approval', wasRunning:true, lastProgressAt:now-(4*60*60*1000) });
assert.equal(decision.recover, false, 'approval prompts are resolved before refresh recovery');

decision = core.shouldRecover({ enabled:true, chatId:'chatgpt:x', now, status:'running', wasRunning:true, lastProgressAt:now-(3*60*60*1000), lastRecoveryAt:now-(60*1000), config:{ staleRunningMs:2*60*60*1000, recoveryCooldownMs:10*60*1000 } });
assert.equal(decision.recover, false, 'recovery cooldown prevents loops');
assert.equal(decision.reason, 'cooldown');

assert.equal(core.capacityLevel({ turnCount:120, charCount:1000 }, { capacityWarningTurns:120, capacityHandoffTurns:180 }), 'watch');
assert.equal(core.capacityLevel({ turnCount:180, charCount:1000 }, { capacityWarningTurns:120, capacityHandoffTurns:180 }), 'handoff');
assert.equal(core.capacityLevel({ turnCount:20, explicitLimitSignal:true }, {}), 'handoff');

const prompt = core.buildContinuationPrompt({ reason:'delivery-timeout', projectName:'Test Project', title:'Long build' });
assert.match(prompt, /Do not restart the project/i);
assert.match(prompt, /verify whether it actually happened before repeating it/i);
assert.match(prompt, /Preserve the exact objective/i);
assert.match(prompt, /Resume from that exact next action immediately/i);
assert.match(prompt, /Project: Test Project/i);

console.log('tab-supervisor-core.test.mjs: PASS');
