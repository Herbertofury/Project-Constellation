import assert from 'node:assert/strict';
import os from 'node:os'; import path from 'node:path'; import fsp from 'node:fs/promises'; import {pathToFileURL} from 'node:url';
import {createBrowserBridge} from '../src/browser-bridge.mjs';
const tmp=await fsp.mkdtemp(path.join(os.tmpdir(),'pcx-background-smoke-')); process.env.CONSTELLATION_COMMANDER_HOME=path.join(tmp,'home'); process.env.CONSTELLATION_ALLOWED_ROOTS=tmp;
const bridge=await createBrowserBridge({port:47721}); await bridge.start();
const trustedOrigin='chrome-extension://geljambmkfjkhodgkpjhnmfojkpcamig'; const nativeFetch=globalThis.fetch; let listener; const store={};
globalThis.chrome={
 runtime:{id:'geljambmkfjkhodgkpjhnmfojkpcamig',onMessage:{addListener(fn){listener=fn}},onStartup:{addListener(){}},onInstalled:{addListener(){}},sendMessage(){return Promise.resolve()}},
 alarms:{onAlarm:{addListener(){}},async create(){}}, storage:{local:{async set(v){Object.assign(store,v)},async get(k){const keys=Array.isArray(k)?k:[k];return Object.fromEntries(keys.map(x=>[x,store[x]]))}}}
};
globalThis.fetch=(input,init={})=>{const headers=new Headers(init.headers||{});headers.set('origin',trustedOrigin);return nativeFetch(input,{...init,headers})};
const message=payload=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('timeout '+payload.type)),10000);const keep=listener(payload,{id:globalThis.chrome.runtime.id},v=>{clearTimeout(timer);resolve(v)});assert.equal(keep,true)});
try{
 await import(`${pathToFileURL(path.resolve('../extension/src/local-work-controller.js')).href}?smoke=${Date.now()}`);
 await new Promise(r=>setTimeout(r,80));
 const health=await message({type:'CC_HEALTH'}); assert.equal(health.ok,true); assert.equal(health.version,'0.25.0'); assert.equal(health.companionConnected,true); assert.equal(health.companionVersion,'0.25.0');
 const boot=await message({type:'CC_BOOTSTRAP',chatId:'background-smoke',url:'https://chatgpt.com/c/test'}); assert.equal(boot.ok,true); assert.ok(boot.sessionToken); assert.ok(boot.nonce);
 const proof=path.join(tmp,'proof.txt'); const write=await message({type:'CC_CALL',sessionToken:boot.sessionToken,call:{nonce:boot.nonce,id:'write',tool:'fs_write_text',args:{path:proof,content:'unified-proof',mode:'rewrite'}}}); assert.equal(write.ok,true,JSON.stringify(write)); assert.equal(await fsp.readFile(proof,'utf8'),'unified-proof');
 console.log('Project Constellation unified extension -> real desktop bridge smoke: PASS');
}finally{globalThis.fetch=nativeFetch;delete globalThis.chrome;await bridge.stop();await fsp.rm(tmp,{recursive:true,force:true})}
