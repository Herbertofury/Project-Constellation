import assert from 'node:assert/strict';
await import('../extension/src/health-core.js');
const core = globalThis.ProjectConstellationHealthCore;
assert(core);
const now = 1_000_000;
let row = core.deriveHealth({ now, chatStatus:'running', lastTurnProgressAt:now-1000, network:{pending:1,oldestPendingAt:now-3000,lastStartAt:now-3000,lastResponseAt:now-500}, tool:{present:true,active:true,label:'Searching project files',phase:'searching',lastProgressAt:now-700,entryCount:4} });
assert.equal(row.state,'tool-running');
assert.equal(row.networkActive,true);
assert.match(row.title,/Tool working/i);
assert.equal(row.activity.kind,'tool');
assert.equal(row.activity.entryCount,4);
assert.equal(row.proof.evidenceOnly,true);
assert.equal(row.proof.certainty,'high');
assert.deepEqual(new Set(row.proof.sources.map((item)=>item.kind)),new Set(['network','tool','response','status']));

row = core.deriveHealth({ now, chatStatus:'running', lastTurnProgressAt:now-180000, network:{pending:1,oldestPendingAt:now-175000,lastStartAt:now-175000,lastResponseAt:now-175000}, tool:{present:true,active:true,label:'Called tool',phase:'tool call',lastProgressAt:now-180000,entryCount:9}, settings:{softStallMs:30000,hardStallMs:90000,deadStallMs:240000} });
assert.equal(row.state,'tool-stalled');
assert.equal(row.level,'danger');
assert.match(row.detail,/still open/i);

row = core.deriveHealth({ now, chatStatus:'running', lastTurnProgressAt:now-300000, network:{pending:1,oldestPendingAt:now-300000,lastStartAt:now-300000,lastResponseAt:now-300000}, tool:{present:true,active:true,label:'Called tool',phase:'tool call',lastProgressAt:now-300000,entryCount:12}, settings:{softStallMs:30000,hardStallMs:90000,deadStallMs:240000} });
assert.equal(row.state,'tool-dead');
assert.equal(row.level,'critical');
assert.match(row.title,/appears dead/i);

row = core.deriveHealth({ now, chatStatus:'running', lastTurnProgressAt:now-260000, network:{pending:0,lastCompleteAt:now-270000}, settings:{softStallMs:30000,hardStallMs:90000,deadStallMs:240000} });
assert.equal(row.state,'dead');
assert.equal(row.level,'critical');

row = core.deriveHealth({ now, chatStatus:'running', lastTurnProgressAt:now-180000, network:{pending:0,lastCompleteAt:now-180000}, settings:{softStallMs:30000,hardStallMs:90000,deadStallMs:240000} });
assert.equal(row.state,'stalled');

row = core.deriveHealth({ now, chatStatus:'idle', page:{catalogAhead:true} });
assert.equal(row.state,'stale-page');
assert.equal(row.recommendedAction,'refresh');
assert(row.proof.sources.some((item)=>item.kind==='page'));
row = core.deriveHealth({ now, chatStatus:'idle', page:{outputRegression:{active:true,detail:'1 missing response · 2 media items'}} });
assert.equal(row.state,'output-regressed');
assert.equal(row.level,'critical');
assert.equal(row.recommendedAction,'compare-output');
assert.match(row.detail,/missing response/i);
row = core.deriveHealth({ now, chatStatus:'refresh-required', network:{pending:0} });
assert.equal(row.state,'refresh-required');
assert.equal(row.recommendedAction,'refresh');
row = core.deriveHealth({ now, chatStatus:'idle', integrityFindings:[{type:'old-version-chat',detail:'v0.9 behind v0.10'}], baselineVersion:'0.10.0' });
assert.equal(row.state,'old-project-version');
assert.equal(row.projectRisk,true);
row = core.deriveHealth({ now, chatStatus:'idle', integrityFindings:[{type:'project-version-rollback',detail:'rollback'}] });
assert.equal(row.state,'project-rollback');
assert.equal(row.level,'critical');

let capacity = core.deriveCapacity({ storedTurns: 179, capturedChars: 100000 }, { capacityWarningTurns: 180, capacityHandoffTurns: 260 });
assert.equal(capacity.state, 'clear');
capacity = core.deriveCapacity({ storedTurns: 180, capturedChars: 100000 }, { capacityWarningTurns: 180, capacityHandoffTurns: 260 });
assert.equal(capacity.state, 'watch');
assert.equal(capacity.recommendedAction, 'handoff');
capacity = core.deriveCapacity({ storedTurns: 260, capturedChars: 100000 }, { capacityWarningTurns: 180, capacityHandoffTurns: 260 });
assert.equal(capacity.state, 'handoff');
assert.equal(capacity.level, 'danger');
capacity = core.deriveCapacity({ storedTurns: 40, explicitLimitSignal: true, explicitLimitText: 'Maximum conversation length reached' });
assert.equal(capacity.state, 'reached');
assert.equal(capacity.level, 'critical');
capacity = core.deriveCapacity({ storedTurns: 24, storedChars: 250000 }, { capacityWarningTurns:180,capacityHandoffTurns:260,capacityWarningChars:240000,capacityHandoffChars:400000 });
assert.equal(capacity.state, 'watch', 'persisted characters warn even after a content-script reload');
assert.equal(capacity.capturedChars, 250000);
capacity = core.deriveCapacity({ storedTurns: 12, mountedTurns: 6, transcriptTurns: 265, transcriptChars: 310000 }, { capacityWarningTurns:180,capacityHandoffTurns:260,capacityWarningChars:240000,capacityHandoffChars:400000 });
assert.equal(capacity.state, 'handoff', 'full active-branch transcript outranks the small mounted DOM');
assert.equal(capacity.turnCount, 265);
assert.equal(capacity.transcriptChars, 310000);
capacity = core.deriveCapacity({ storedTurns: 70, storedChars: 190000, recentAverageChars: 75000 }, { capacityWarningTurns:180,capacityHandoffTurns:260,capacityWarningChars:240000,capacityHandoffChars:400000 });
assert.equal(capacity.state, 'watch', 'very large recent turns trigger predictive runway warning');
assert.equal(capacity.predictiveWatch, true);
assert(capacity.projectedMessages < 3);
row = core.deriveHealth({ now, chatStatus:'idle', capacity:{storedTurns:180}, settings:{capacityWarningTurns:180,capacityHandoffTurns:260} });
assert.equal(row.state,'capacity-watch');
assert.equal(row.capacity.state,'watch');
row = core.deriveHealth({ now, chatStatus:'running', lastTurnProgressAt:now-1000, capacity:{storedTurns:260}, settings:{capacityWarningTurns:180,capacityHandoffTurns:260} });
assert.equal(row.state,'working');
assert.equal(row.level,'danger');
assert.equal(row.capacity.recommendedAction,'handoff');
row = core.deriveHealth({ now, chatStatus:'refresh-required', capacity:{storedTurns:260}, settings:{capacityWarningTurns:180,capacityHandoffTurns:260} });
assert.equal(row.state,'refresh-required');
assert.equal(row.recommendedAction,'refresh');
assert.equal(row.capacity.recommendedAction,'handoff');


for (const [text, state, title] of [
  ['Message delivery timed out. Please try again.','delivery-timeout','Message delivery timed out'],
  ['A network error occurred. Please check your connection and try again.','connection-interrupted','Connection interrupted'],
  ['There was an error generating a response.','response-interrupted','Response interrupted'],
  ['Message was not sent.','send-failed','Message was not sent']
]) {
  const failure = core.classifyProviderFailure(text, { retryAvailable:true, retryLabel:'Retry', partialAssistantChars:45, toolActivitySeen:true });
  assert.equal(failure.active, true); assert.equal(failure.state, state); assert.equal(failure.retryAvailable, true);
  const failureRow = core.deriveHealth({ now, chatStatus:'running', running:true, lastTurnProgressAt:now-500, failure, capacity:{storedTurns:260}, settings:{capacityWarningTurns:180,capacityHandoffTurns:260} });
  assert.equal(failureRow.state, state, `${state} must outrank stale running/capacity evidence`);
  assert.equal(failureRow.level, 'danger'); assert.equal(failureRow.title, title); assert.equal(failureRow.recommendedAction, 'retry');
  assert.ok(failureRow.chips.includes('45 partial chars preserved'));
}
const noRetryFailure = core.classifyProviderFailure('Message delivery timed out. Please try again.', {});
assert.equal(noRetryFailure.recommendedAction, 'refresh');
assert.equal(core.deriveHealth({ now, chatStatus:'delivery-timeout', failure:noRetryFailure }).state, 'delivery-timeout');

console.log('health-core.test.mjs: PASS');
