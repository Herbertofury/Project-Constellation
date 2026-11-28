import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import path from 'node:path';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';
const filename=fileURLToPath(new URL('../electron/main.cjs',import.meta.url));const nativeRequire=createRequire(filename);const handlers=new Map();
const frame={url:'https://chatgpt.com/c/test'},shellFrame={url:new URL('../electron/shell.html',import.meta.url).href};
const chat={mainFrame:frame,isDestroyed:()=>false,send:()=>{},getURL:()=>frame.url},shell={mainFrame:shellFrame,send:()=>{},isDestroyed:()=>false};
let calls=0;const runtime={dir:'/fixture',configPath:'/fixture/config.json',config:{allowedRoots:['/chosen/project'],localToolMode:'auto',enableShell:true},state:{processes:new Map(),searches:new Map()},saveConfig:async()=>{},toolDefinitions:()=>[{name:'ping',inputSchema:{}},{name:'set_config_value',inputSchema:{}}],callTool:async()=>{calls++;return {pong:true};}};
const electron={app:{setAppUserModelId:()=>{},quit:()=>{},commandLine:{appendSwitch:()=>{}},requestSingleInstanceLock:()=>true,on:()=>{},whenReady:()=>new Promise(()=>{}),isPackaged:false,hasSingleInstanceLock:()=>true},ipcMain:{handle:(name,fn)=>handlers.set(name,fn)}};
const context=vm.createContext({require:name=>name==='electron'?electron:nativeRequire(name),process,console,Buffer,URL,__dirname:path.dirname(filename),setTimeout,clearTimeout});
vm.runInContext(fs.readFileSync(filename,'utf8')+'\nglobalThis.initialize=(r,w,c)=>{runtime=r;win=w;chatView=c;installIpc();installShellIpc();};globalThis.testChatCall=executeChatCall;',context,{filename});
context.initialize(runtime,{webContents:shell,isDestroyed:()=>false},{webContents:chat});
await test('IPC rejects foreign frame even when webContents matches',async()=>{await assert.rejects(handlers.get('cc:bootstrap')({sender:chat,senderFrame:{...frame}},{chatId:'test'}),/Untrusted/);});
await test('IPC rejects login/foreign origins for local calls',async()=>{frame.url='https://accounts.google.com/';await assert.rejects(handlers.get('cc:bootstrap')({sender:chat,senderFrame:frame},{chatId:'test'}),/origin/);frame.url='https://chatgpt.com/c/test';});
await test('chat manifest cannot offer permission escalation',async()=>{const bootstrap=await handlers.get('cc:bootstrap')({sender:chat,senderFrame:frame},{chatId:'test'});assert.equal(bootstrap.tools.some(t=>t.name==='set_config_value'),false);});
await test('production main ledger suppresses concurrent identical execution',async()=>{const bootstrap=await handlers.get('cc:bootstrap')({sender:chat,senderFrame:frame},{chatId:'test'});const call={id:'main-fixture',nonce:bootstrap.nonce,tool:'ping',args:{}};const before=calls;await Promise.all(Array.from({length:10},()=>context.testChatCall('test',call)));assert.equal(calls-before,1);});
await test('Off is enforced in main, not only renderer',async()=>{runtime.config.localToolMode='off';await assert.rejects(context.testChatCall('test',{id:'off',tool:'ping'}),/Off/);runtime.config.localToolMode='auto';});
await test('removing final selected root leaves no roots',async()=>{const response=await handlers.get('cc-shell:remove-root')({sender:shell,senderFrame:shellFrame},{root:'/chosen/project'});assert.equal(response.allowedRoots.length,0);});
await test('Full PC switch restores prior chosen roots',async()=>{runtime.config.allowedRoots=['/chosen/only'];const event={sender:shell,senderFrame:shellFrame};await handlers.get('cc-shell:set-full-access')(event,{enabled:true});assert.equal(runtime.config.allowedRoots[0],'*');await handlers.get('cc-shell:set-full-access')(event,{enabled:false});assert.equal(runtime.config.allowedRoots[0],'/chosen/only');});
await test('shell preferences enforce validation and never grant permission',async()=>{
 const event={sender:shell,senderFrame:shellFrame};
 await assert.rejects(handlers.get('cc-shell:set-preferences')(event,{enableShell:true}),/Unsupported preference/);
 await assert.rejects(handlers.get('cc-shell:set-preferences')({sender:shell,senderFrame:{...shellFrame}},{theme:'light'}),/Untrusted/);
 await Promise.all([handlers.get('cc-shell:set-preferences')(event,{theme:'light'}),handlers.get('cc-shell:set-preferences')(event,{chatZoom:1.25}),handlers.get('cc-shell:set-preferences')(event,{alwaysOnTop:true})]);
 assert.equal(runtime.config.uiPreferences.theme,'light');assert.equal(runtime.config.uiPreferences.chatZoom,1.25);assert.equal(runtime.config.uiPreferences.alwaysOnTop,true);
});
await test('native chat view survives all local views and respects palette visibility',async()=>{
 const visibility=[],view={webContents:chat,setVisible:value=>visibility.push(value)};
 context.initialize(runtime,{webContents:shell,isDestroyed:()=>false},view);
 const event={sender:shell,senderFrame:shellFrame};
 for(const name of ['workspace','terminal','desktop','activity','connections','settings','tools']){handlers.get('cc-shell:set-view')(event,{view:name});assert.equal(visibility.at(-1),false);}
 handlers.get('cc-shell:set-view')(event,{view:'chat'});assert.equal(visibility.at(-1),true);
 handlers.get('cc-shell:overlay-visible')(event,{visible:true});assert.equal(visibility.at(-1),false);
 handlers.get('cc-shell:set-view')(event,{view:'chat'});assert.equal(visibility.at(-1),false);
 handlers.get('cc-shell:overlay-visible')(event,{visible:false});assert.equal(visibility.at(-1),true);
 assert.throws(()=>handlers.get('cc-shell:set-view')(event,{view:'https://untrusted.test'}),/Unknown workspace/);
});
await test('failed settings save keeps prior runtime state intact',async()=>{
 const save=runtime.saveConfig,before=runtime.config.uiPreferences.theme;
 runtime.saveConfig=async()=>{throw new Error('disk full');};
 try{await assert.rejects(handlers.get('cc-shell:set-preferences')({sender:shell,senderFrame:shellFrame},{theme:'dark'}),/disk full/);assert.equal(runtime.config.uiPreferences.theme,before);}finally{runtime.saveConfig=save;}
});
await test('each explicitly renewed user task gets a fresh nonce and old task cannot execute',async()=>{
 const event={sender:chat,senderFrame:frame};
 const a=await handlers.get('cc:bootstrap')(event,{chatId:'rotate',renew:true});
 const b=await handlers.get('cc:bootstrap')(event,{chatId:'rotate',renew:true});
 assert.notEqual(a.nonce,b.nonce);
 await assert.rejects(context.testChatCall('rotate',{id:'stale-call',nonce:a.nonce,tool:'ping',args:{}}),/stale/);
});
