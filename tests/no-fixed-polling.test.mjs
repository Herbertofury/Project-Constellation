import assert from 'node:assert/strict';
import fs from 'node:fs';
const files=[
  'extension/sidepanel.js','extension/src/local-work-content.js','extension/src/local-work-controller.js','extension/src/pulse-ux.js','desktop/electron/chat-preload.cjs'
];
for(const file of files){const src=fs.readFileSync(new URL(`../${file}`,import.meta.url),'utf8');assert(!/setInterval\s*\(/.test(src),`${file} reintroduced fixed setInterval polling`);}
const controller=fs.readFileSync(new URL('../extension/src/local-work-controller.js',import.meta.url),'utf8');
assert(!/periodInMinutes\s*:/.test(controller),'desktop bridge heartbeat must be adaptive one-shot');
assert(controller.includes('delayInMinutes:connected?10:3'),'desktop fallback cadence must adapt to bridge state');
const background=fs.readFileSync(new URL('../extension/background.js',import.meta.url),'utf8');
assert(!/chrome\.alarms\.create\(STALL_ALARM,\s*\{\s*periodInMinutes/.test(background),'stall watchdog must never use repeating polling');
assert(background.includes('async function ensureStallWatchAlarm(options = {})'),'stall watchdog must use adaptive one-shot scheduling');
const sidepanel=fs.readFileSync(new URL('../extension/sidepanel.js',import.meta.url),'utf8');
assert(sidepanel.includes("message?.type==='PC_STATE_EVENT'"),'sidepanel must refresh from state events');
const pulse=fs.readFileSync(new URL('../extension/src/pulse-ux.js',import.meta.url),'utf8');
assert(pulse.includes("message?.type !== 'PC_STATE_EVENT'"),'Pulse must refresh from state events');
console.log('no-fixed-polling.test.mjs: PASS');
