const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs'), vm=require('node:vm'), path=require('node:path');
const ctx=vm.createContext({URL});vm.runInContext(fs.readFileSync(path.join(__dirname,'../browser-companion/core.js'),'utf8'),ctx);
const C=ctx.PCXTaskRecoveryCore;
function snapshot(extra={}) {return {url:'https://chatgpt.com/schedules',recognized:true,tasks:[],...extra};}
function task(extra={}) {return {title:C.TASKS[0],id:'task1',runId:'r1',attention:true,fingerprint:'f',openAction:{token:'x',kind:'open-followup'},...extra};}
function activeState() {const state=C.initial(),t=task(),k=C.key(t); state.incidents[k]={actions:{}};return {state,active:{...t,key:k}};}
test('known attention task opens exact followup',()=>assert.equal(C.plan(snapshot({tasks:[task()]}),C.initial()).action.kind,'open-followup'));
test('new explicitly attention-marked task is included',()=>assert.equal(C.plan(snapshot({tasks:[task({title:'New service'})]}),C.initial()).status,'ACTION_READY'));
test('user pause stops actions',()=>{const s=C.initial();s.config.enabled=false;assert.equal(C.plan(snapshot(),s).status,'PAUSED_BY_USER');});
for(const reason of ['auth','challenge','approval','draft','ambiguous']) test('blocks '+reason,()=>assert.notEqual(C.plan(snapshot({tasks:[task()],[reason]:true}),C.initial()).status,'ACTION_READY'));
test('wrong origin never executes',()=>assert.equal(C.plan(snapshot({url:'https://evil.test/schedules'}),C.initial()).status,'OUTSIDE_CHATGPT'));
for(const title of ['REPLACED - task','RETIRED: task','LEGACY \u2014 task']) test('honors tombstone '+title,()=>assert.equal(C.allowed(task({title}),C.config()),false));
test('paused-only task is not resurrected',()=>assert.notEqual(C.plan(snapshot({tasks:[task({attention:false,paused:true})]}),C.initial()).status,'ACTION_READY'));
test('empty selector is not healthy',()=>assert.equal(C.plan(snapshot(),C.initial()).status,'NO_TASKS_IDENTIFIED'));
test('unrecognized page remains unknown',()=>assert.equal(C.plan(snapshot({recognized:false}),C.initial()).status,'UI_UNRECOGNIZED'));
test('same unchanged incident not reopened',()=>{const s=C.initial(),t=task();s.incidents[C.key(t)]={fingerprint:'f'};assert.equal(C.plan(snapshot({tasks:[t]}),s).status,'BLOCKERS_RECORDED');});
test('new run remains eligible',()=>{const s=C.initial(),t=task();s.incidents[C.key(t)]={fingerprint:'f'};assert.equal(C.plan(snapshot({tasks:[task({runId:'r2'})]}),s).status,'ACTION_READY');});
test('active session suppresses duplicate opening',()=>{const s=C.initial(),t=task();s.sessions[4]={key:C.key(t)};assert.equal(C.plan(snapshot({tasks:[t]}),s).status,'BLOCKERS_RECORDED');});
test('running is evidence, not completion',()=>{const {state,active}=activeState();assert.equal(C.plan(snapshot({bound:true,running:true}),state,active).status,'RUNNING_OBSERVED');});
test('vanished marker is not completion',()=>{const {state,active}=activeState();assert.equal(C.plan(snapshot({bound:true}),state,active).status,'NO_SAFE_CONTINUATION');});
test('unbound conversation cannot resume',()=>{const {state,active}=activeState();assert.equal(C.plan(snapshot({bound:false,action:{kind:'resume'}}),state,active).status,'TASK_BINDING_UNVERIFIED');});
test('preexisting action intent prevents restart replay',()=>{const {state,active}=activeState(),s=snapshot({bound:true,fingerprint:'a',action:{kind:'resume'}});const p=C.plan(s,state,active);state.incidents[active.key].actions[p.actionKey]={status:'INTENT_PERSISTED'};assert.equal(C.plan(s,state,active).status,'ACTION_ALREADY_ATTEMPTED');});
test('consent change permits safe resume but never grants consent',()=>{const {state,active}=activeState();const s=snapshot({bound:true,approval:true,action:{kind:'resume'},fingerprint:'a'});assert.equal(C.plan(s,state,active).status,'SECURITY_APPROVAL_REQUIRED');s.approval=false;assert.equal(C.plan(s,state,active).status,'ACTION_READY');});
test('unsupported allow action is rejected',()=>{const {state,active}=activeState();assert.equal(C.plan(snapshot({bound:true,action:{kind:'approve'}}),state,active).status,'UNSUPPORTED_ACTION');});
test('arbitrary task count has no 100-card cap',()=>{const s=C.initial(),ts=Array.from({length:151},(_,i)=>task({id:'t'+i,runId:'r'+i}));for(const t of ts.slice(0,150))s.incidents[C.key(t)]={fingerprint:'f'};assert.equal(C.plan(snapshot({tasks:ts}),s).task.id,'t150');});
test('configuration validates interval',()=>{assert.equal(C.config({intervalMinutes:-1}).intervalMinutes,1);assert.equal(C.config({intervalMinutes:500}).intervalMinutes,60);});
