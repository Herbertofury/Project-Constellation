import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),ui=require('../electron/ui-state.cjs');
test('chat bounds never overlap header, rail, inspector or status bar',()=>{
  for(const w of [950,1050,1051,1100,1440,2560])for(const h of [600,960,1440])for(const collapsed of [true,false]){
    const r=ui.layout(w,h,collapsed);assert.equal(r.x,72);assert.equal(r.y,56);assert.equal(r.height,h-86);assert.equal(r.width,w-72-(!collapsed&&w>1050?344:0));
  }
});
test('preferences have stable safe defaults and persist normalized values',()=>{
  assert.deepEqual(ui.preferences(),{theme:'system',chatZoom:1,alwaysOnTop:false});
  assert.deepEqual(ui.preferences({theme:'oops',chatZoom:10,alwaysOnTop:'yes'}),{theme:'system',chatZoom:1.5,alwaysOnTop:false});
  const before={theme:'dark',chatZoom:1.25,alwaysOnTop:false};assert.deepEqual(ui.patchPreferences(before,{alwaysOnTop:true}),{...before,alwaysOnTop:true});assert.equal(before.alwaysOnTop,false);
});
test('settings reject unknown fields, invalid types, and out of range values',()=>{
  for(const p of [null,[],{theme:'purple'},{chatZoom:'1'},{chatZoom:NaN},{chatZoom:0},{alwaysOnTop:1},{allowedRoots:['*']},{__proto__:null,enableShell:true}])assert.throws(()=>ui.patchPreferences({},p));
});
test('every workspace destination is allowlisted, not an arbitrary navigation URL',()=>{
  for(const v of ui.VIEWS)assert.equal(ui.viewName(v),v);
  for(const v of ['file:///etc/passwd','https://evil.test',null,'__proto__'])assert.throws(()=>ui.viewName(v));
});
