import assert from 'node:assert/strict';
import fs from 'node:fs';
import { recoveryFallbackMinutes, RECOVERY_FALLBACK_MINUTES, normalizedRecoverySignal } from '../extension/src/scheduled-task-recovery-policy.js';

assert.equal(recoveryFallbackMinutes({config:{enabled:false}}),0);
assert.equal(recoveryFallbackMinutes({config:{enabled:true},status:'PAGE_LOADING'}),RECOVERY_FALLBACK_MINUTES.pageLoading);
assert.equal(recoveryFallbackMinutes({config:{enabled:true},sessions:{1:{status:'WAITING_FOR_RUN_EVIDENCE'}}}),RECOVERY_FALLBACK_MINUTES.active);
assert.equal(recoveryFallbackMinutes({config:{enabled:true},sessions:{1:{status:'SECURITY_APPROVAL_REQUIRED'}}}),RECOVERY_FALLBACK_MINUTES.permissionHold);
assert.equal(recoveryFallbackMinutes({config:{enabled:true},counts:{attention:1}}),RECOVERY_FALLBACK_MINUTES.attention);
assert.equal(recoveryFallbackMinutes({config:{enabled:true},counts:{attention:0}}),RECOVERY_FALLBACK_MINUTES.idle);
assert.equal(normalizedRecoverySignal('  abc  '),'abc');
assert.equal(normalizedRecoverySignal('x'.repeat(400)).length,240);

const controller=fs.readFileSync(new URL('../extension/src/scheduled-task-recovery-controller.js',import.meta.url),'utf8');
const page=fs.readFileSync(new URL('../extension/src/scheduled-task-recovery-page.js',import.meta.url),'utf8');
const home=fs.readFileSync(new URL('../extension/home.js',import.meta.url),'utf8');

assert.doesNotMatch(controller,/periodInMinutes\s*:\s*1/,'Scheduled recovery must not restore fixed one-minute polling');
assert.match(controller,/delayInMinutes\s*:\s*minutes/,'Scheduled recovery fallback must be one-shot');
assert.match(controller,/alarm\.periodInMinutes/,'upgrade path must replace a legacy repeating alarm');
assert.match(controller,/pcxRecHandleDomChanged\(m\.signature\)/,'controller must consume meaningful DOM-state signatures');
assert.match(controller,/pcxRecoveryPendingReason/,'in-flight invalidations must coalesce');
assert.match(page,/lastDomSignature/,'page must suppress unchanged DOM-state signatures');
assert.match(page,/queueDomChanged/,'page must debounce mutation bursts');
assert.match(page,/PC_SCHEDULE_RECOVERY_DOM_CHANGED',signature/,'page must send the meaningful-state fingerprint');
assert.doesNotMatch(home,/approvalRecoveryPoll=setTimeout/,'Home recovery UI must not poll every 1.1 seconds');
assert.match(home,/chrome\.storage\??\.onChanged\??\.addListener/,'Home recovery UI must update from state changes');
assert.match(home,/projectConstellationApprovalRecoveryState/,'approval recovery storage state must drive Home UI');
assert.match(home,/pcx\.scheduleRecovery\.v2/,'Scheduled recovery storage state must drive Home UI');

console.log('recovery-polling-regression.test.mjs: PASS');
