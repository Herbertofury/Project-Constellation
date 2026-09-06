import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../extension/src/popup-attention-qol.js',import.meta.url),'utf8');

let changeHandler = null;
const input = {
  checked:true,
  addEventListener(type,handler,capture) {
    assert.equal(type,'change');
    assert.equal(capture,true,'attention owner must run in capture phase before popup.js');
    changeHandler = handler;
  }
};
const status = {textContent:''};
const storageState = {projectConstellationPulseUxSettings:{attentionNotificationsEnabled:true,otherSetting:'keep-me'}};
const writes = [];
const chrome = {
  storage:{
    local:{
      async get(key) { return {[key]:structuredClone(storageState[key] || {})}; },
      async set(value) {
        writes.push(structuredClone(value));
        Object.assign(storageState,value);
      }
    }
  }
};
const document = {
  getElementById(id) {
    if (id === 'attentionNotificationsEnabled') return input;
    if (id === 'status') return status;
    return null;
  }
};

vm.runInContext(source,vm.createContext({console,document,chrome,Promise,String,Boolean}),{filename:'popup-attention-qol.js'});
assert.equal(typeof changeHandler,'function','attention owner should bind its change handler');

let stopped = 0;
input.checked = false;
changeHandler({stopImmediatePropagation(){ stopped += 1; }});
await new Promise((resolve) => setTimeout(resolve,0));
assert.equal(stopped,1,'legacy popup handler must be suppressed');
assert.equal(storageState.projectConstellationPulseUxSettings.attentionNotificationsEnabled,false);
assert.equal(storageState.projectConstellationPulseUxSettings.otherSetting,'keep-me','unrelated Pulse settings must be preserved');
assert.equal(input.checked,false);

// Rapid changes must serialize in user order; the last interaction wins.
input.checked = true;
changeHandler({stopImmediatePropagation(){ stopped += 1; }});
input.checked = false;
changeHandler({stopImmediatePropagation(){ stopped += 1; }});
input.checked = true;
changeHandler({stopImmediatePropagation(){ stopped += 1; }});
await new Promise((resolve) => setTimeout(resolve,0));
await new Promise((resolve) => setTimeout(resolve,0));
assert.equal(storageState.projectConstellationPulseUxSettings.attentionNotificationsEnabled,true,'last rapid toggle must win');
assert.equal(input.checked,true);
assert.ok(writes.length >= 2,'runtime should persist meaningful changes');
assert.equal(status.textContent,'','successful saves must not emit a false error');

console.log('popup-attention-qol: ok');
