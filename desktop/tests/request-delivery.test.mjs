import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const script=fs.readFileSync(new URL('../../extension/src/local-work-page-hook.js',import.meta.url),'utf8');
function setup(status=200){
 const posted=[],sent=[],listeners=[];
 const w={addEventListener:(_,fn)=>listeners.push(fn),postMessage(data){posted.push(data);for(const fn of listeners)fn({source:w,data});},fetch:async(input,init={})=>{sent.push({input,body:init.body});return new Response('{}',{status});}};
 const ctx=vm.createContext({window:w,location:{href:'https://chatgpt.com/c/test'},URL,Request,Response,TextDecoder,TextEncoder,Blob,ArrayBuffer,Uint8Array,setTimeout,clearTimeout,console});
 vm.runInContext(script,ctx);
 const arm=(original='same prompt',id='arm')=>w.postMessage({source:'constellation-commander-content',type:'CC_ARM_CONTEXT_V2',id,original,context:'[PROJECT CONSTELLATION LOCAL CONTEXT]\n{"nonce":"new"}\n[/PROJECT CONSTELLATION LOCAL CONTEXT]'});
 const send=async(body,url='https://chatgpt.com/backend-api/conversation')=>{await w.fetch(url,{method:'POST',body:JSON.stringify(body)});return JSON.parse(sent.at(-1).body);};
 return {w,posted,sent,arm,send};
}
const msg=text=>({author:{role:'user'},content:{parts:[text]}});
await test('repeated prompt augments newest user message, never history',async()=>{const s=setup();s.arm();const out=await s.send({messages:[msg('same prompt'),{author:{role:'assistant'},content:{parts:['answer']}},msg('same prompt')]});assert.equal(out.messages[0].content.parts[0],'same prompt');assert.match(out.messages[2].content.parts[0],/LOCAL CONTEXT/);});
await test('telemetry cannot consume the armed context',async()=>{const s=setup();s.arm();const out=await s.send({messages:[msg('same prompt')]},'https://chatgpt.com/backend-api/telemetry');assert.equal(out.messages[0].content.parts[0],'same prompt');const real=await s.send({messages:[msg('same prompt')]});assert.match(real.messages[0].content.parts[0],/LOCAL CONTEXT/);});
await test('third-party POST never receives local authorization',async()=>{const s=setup();s.arm();const out=await s.send({messages:[msg('same prompt')]},'https://untrusted.example/conversation');assert.equal(out.messages[0].content.parts[0],'same prompt');});
await test('old matching history cannot steal a differently worded new prompt',async()=>{const s=setup();s.arm();const out=await s.send({messages:[msg('same prompt'),msg('different prompt')]});assert.equal(out.messages[0].content.parts[0],'same prompt');});
await test('HTTP rate limit is delivery failure, not success',async()=>{const s=setup(429);s.arm();await s.send({messages:[msg('same prompt')]});assert.ok(s.posted.some(p=>p.type==='CC_REQUEST_FAILED_V3'&&p.status===429));assert.ok(!s.posted.some(p=>p.type==='CC_REQUEST_ACCEPTED_V3'));});
await test('accepted request has a correlated receipt',async()=>{const s=setup();s.arm('same prompt','correlation');await s.send({messages:[msg('same prompt')]});assert.ok(s.posted.some(p=>p.type==='CC_REQUEST_ACCEPTED_V3'&&p.id==='correlation'));});
await test('result delivery is observed without rewriting payload',async()=>{const s=setup();const value='[PC BUDDY TOOL RESULT]\n{"ok":true}\n[/PC BUDDY TOOL RESULT]';s.w.postMessage({source:'constellation-commander-content',type:'CC_WATCH_DELIVERY_V3',id:'result-1',original:value});const out=await s.send({messages:[msg(value)]});assert.equal(out.messages[0].content.parts[0],value);assert.ok(s.posted.some(p=>p.type==='CC_REQUEST_ACCEPTED_V3'&&p.id==='result-1'));});
