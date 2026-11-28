import test from 'node:test';
import assert from 'node:assert/strict';
import {createRemoteDeviceAgent} from '../src/remote-device.mjs';
function runtime(extra={}) { return {dir:'/unused',configPath:'/unused/config.json',state:{},config:{deviceName:'Test PC',remoteRelayUrl:'https://relay.example',remoteDeviceId:'id',remoteDeviceToken:'token',...extra}}; }
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
const persistRemote=async()=>{};
test('remote URL rejects plaintext public origins and embedded secrets',async()=>{
 for(const url of ['http://relay.example','https://u:p@relay.example','https://relay.example/?key=private','https://relay.example/#fragment','file:///tmp/file'])await assert.rejects(createRemoteDeviceAgent({runtime:runtime(),relayUrl:url,persistRemote}));
});
test('switching relay cannot send the old relay credential to the new one',async()=>{
 const r=runtime();const agent=await createRemoteDeviceAgent({runtime:r,relayUrl:'https://new.example',persistRemote});
 assert.equal(r.config.remoteDeviceToken,undefined);assert.equal(r.config.remoteDeviceId,undefined);agent.stop();
});
test('failed delivery does not repeat a successful action or mark it failed',async()=>{
 const old=globalThis.fetch;let calls=0,delivery=0;const sent=[];
 globalThis.fetch=async(url,init)=>{if(url.endsWith('/poll'))return response({job:{id:'one',tool:'write_file',args:{path:'approved.txt'}}});sent.push(JSON.parse(init.body));return response({},++delivery===1?503:200);};
 try {const agent=await createRemoteDeviceAgent({runtime:runtime(),persistRemote,callTool:async()=>{calls++;return {written:true};}});
  await assert.rejects(agent.pollOnce(),/503/);await agent.pollOnce();assert.equal(calls,1);assert.equal(sent.length,2);assert.equal(sent[0].ok,true);assert.deepEqual(sent[0],sent[1]);agent.stop();
 }finally{globalThis.fetch=old;}
});
test('remote reused ID with changed arguments and permission escalation are rejected',async()=>{
 const old=globalThis.fetch;let args={path:'a'},tool='read_file',id='one',calls=0;const sent=[];
 globalThis.fetch=async(url,init)=>url.endsWith('/poll')?response({job:{id,tool,args}}):(sent.push(JSON.parse(init.body)),response({}));
 try {const agent=await createRemoteDeviceAgent({runtime:runtime(),persistRemote,callTool:async()=>{calls++;return {content:'a'};}});
  await agent.pollOnce();args={path:'b'};await agent.pollOnce();assert.equal(calls,1);assert.equal(sent[1].ok,false);assert.match(sent[1].error,/different arguments/);
  id='two';tool='set_config_value';await agent.pollOnce();assert.equal(calls,1);assert.equal(sent[2].ok,false);agent.stop();
 }finally{globalThis.fetch=old;}
});
test('Disconnect aborts an in-flight remote poll',async()=>{
 const old=globalThis.fetch;globalThis.fetch=async(url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
 try {const agent=await createRemoteDeviceAgent({runtime:runtime(),persistRemote});const poll=agent.pollOnce();agent.stop();await assert.rejects(poll);assert.equal(agent.stopped,true);}finally{globalThis.fetch=old;}
});
test('pairing must not open an unrelated approval origin',async()=>{
 const old=globalThis.fetch;let opened=false;globalThis.fetch=async()=>response({user_code:'ABCD',verification_uri:'https://unrelated.example/approve'});
 try {const agent=await createRemoteDeviceAgent({runtime:runtime({remoteDeviceId:undefined,remoteDeviceToken:undefined}),persistRemote,openVerification:async()=>{opened=true;}});await assert.rejects(agent.pair(),/belong to the relay/);assert.equal(opened,false);agent.stop();}finally{globalThis.fetch=old;}
});
