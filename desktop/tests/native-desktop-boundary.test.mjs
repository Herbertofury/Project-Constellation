import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const filename = fileURLToPath(new URL('../electron/main.cjs', import.meta.url));
const nativeRequire = createRequire(filename);
const deferred = () => { let resolve, reject; const promise = new Promise((yes,no) => { resolve=yes; reject=no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

async function harness(t, options = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'constellation-main-native-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const handlers = new Map(), events = new Map(), emitted = [], calls = [];
  const frame = { url: new URL('../electron/shell.html', import.meta.url).href };
  const shell = { mainFrame: frame, isDestroyed: () => false, send: (channel, detail) => emitted.push({ channel, ...detail }) };
  let quits = 0;
  const app = { setAppUserModelId(){}, quit(){ quits++; }, commandLine:{appendSwitch(){}}, requestSingleInstanceLock:()=>true, on:(name,fn)=>events.set(name,fn), whenReady:()=>new Promise(()=>{}), isPackaged:false, hasSingleInstanceLock:()=>true };
  const runtime = { dir, configPath:path.join(dir,'config.json'), config:{allowedRoots:[dir],localToolMode:'auto',enableGuiAutomation:true,enableShell:true}, state:{processes:new Map(),searches:new Map()}, saveConfig:async()=>{}, toolDefinitions:()=>[],callTool:async()=>({}) };
  const native = options.native || {
    subscribeComputerLink(){},
    async getComputerLinkStatus(){ calls.push('status');return {owner:{available:false,running:false}}; },
    async getComputerLinkMcpStatus(){ calls.push('session');return {available:false,verified:false}; },
    async launchComputerLinkOwner(args){ args.canStart?.();calls.push('launch');assert.equal(args.ownerInitiated,true);assert.equal(args.binaryDirectory,undefined);return {started:true,pid:123}; },
    async stopComputerLinkOwner(){ calls.push('stop');return {stopped:true}; },
  };
  const modules = {
    'src/computer-link.mjs': native,
    'src/process-manager.mjs': options.processModule || { stopManagedProcess:async()=>({status:'terminated'}) },
    'src/computer-use.mjs': { closeComputerUseHelper:async()=>({stopped:true}) },
  };
  const context = vm.createContext({require:name=>name==='electron'?{app,ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},dialog:{showErrorBox(){}}}:nativeRequire(name),process:{...process,env:{...process.env,CONSTELLATION_ELECTRON_SMOKE:'1'}},console,Buffer,URL,__dirname:path.dirname(filename),setTimeout,clearTimeout});
  vm.runInContext(fsSync.readFileSync(filename,'utf8')+`
    globalThis.initialize=(r,w,loader)=>{runtime=r;win=w;importEsm=loader;installShellIpc();};
    globalThis.runtimeState=()=>({quitCleanup,quitReady,emergencyLock,nativeAccessEpoch,nativeAccessRevoking});
    globalThis.executeShell=executeShellTool;
  `, context, {filename});
  context.initialize(runtime,{webContents:shell,isDestroyed:()=>false}, async name => {
    if(name==='src/computer-link.mjs'&&options.nativeLoading)await options.nativeLoading;
    if(!modules[name])throw new Error(`Unexpected module ${name}`);
    return modules[name];
  });
  const event={sender:shell,senderFrame:frame};
  return {handlers,events,emitted,calls,native,runtime,shell,frame,event,context,quits:()=>quits,call:(name,args)=>handlers.get('cc-shell:'+name)(event,args)};
}

test('native IPC only accepts the exact trusted local main frame', async t => {
  const h=await harness(t);
  for(const name of ['status','session','open','stop']) {
    const handler=h.handlers.get('cc-shell:computer-link-'+name);
    await assert.rejects(handler({sender:h.shell,senderFrame:{...h.frame}}),/Untrusted/);
    await assert.rejects(handler({sender:{},senderFrame:h.frame}),/Untrusted/);
  }
  assert.equal(h.calls.length,0);
});

test('absent native integration reports unavailable without breaking trusted shell tools', async t => {
  const h=await harness(t);
  assert.equal((await h.call('computer-link-status')).owner.available,false);
  assert.equal((await h.call('computer-link-session')).verified,false);
  assert.equal((await h.call('computer-link-stop')).stopped,true);
  assert.equal((await h.call('list-tools')).ok,true);
  assert.deepEqual(h.calls,['status','session','stop']);
});

test('payload cannot choose an executable and every access gate is enforced in main', async t => {
  const h=await harness(t);
  for(const key of ['enableGuiAutomation','localToolMode','emergencyLock']) {
    const before=h.runtime.config[key];h.runtime.config[key]=key==='localToolMode'?'off':key==='emergencyLock';
    await assert.rejects(h.call('computer-link-open',{binaryDirectory:'/untrusted',ownerInitiated:true}),/access|locked/i);
    h.runtime.config[key]=before;
  }
  await h.call('computer-link-open',{binaryDirectory:'/untrusted',command:'/untrusted'});
  assert.deepEqual(h.calls,['launch']);
});

test('lock arriving while native module loads invalidates the original open request', async t => {
  const loading=deferred();const h=await harness(t,{nativeLoading:loading.promise});
  const open=h.call('computer-link-open');const rejected=assert.rejects(open,/locked/);
  await tick();const lock=h.call('set-emergency-lock',{enabled:true});
  await tick();loading.resolve();await rejected;await lock;
  assert.equal(h.calls.includes('launch'),false);assert.equal(h.calls.includes('stop'),true);
});

test('late lock during binary lookup is rechecked before native spawn', async t => {
  const entered=deferred(),lookup=deferred();let launches=0,stops=0;
  const native={subscribeComputerLink(){},async launchComputerLinkOwner(options){entered.resolve();await lookup.promise;options.canStart();launches++;return{started:true};},async stopComputerLinkOwner(){stops++;return{stopped:true};}};
  const h=await harness(t,{native});const open=h.call('computer-link-open');const rejected=assert.rejects(open,/locked/);
  await entered.promise;const lock=h.call('set-emergency-lock',{enabled:true});await tick();lookup.resolve();await rejected;await lock;
  assert.equal(launches,0);assert.equal(stops,1);
});

test('explicit stop waits behind an in-flight native launch', async t => {
  const entered=deferred(),spawned=deferred();const order=[];
  const native={subscribeComputerLink(){},async launchComputerLinkOwner(options){options.canStart();entered.resolve();await spawned.promise;order.push('started');return{started:true};},async stopComputerLinkOwner(){order.push('stopped');return{stopped:true};}};
  const h=await harness(t,{native});const open=h.call('computer-link-open');await entered.promise;const stop=h.call('computer-link-stop');await tick();assert.equal(order.length,0);
  spawned.resolve();await open;await stop;assert.deepEqual(order,['started','stopped']);
});

test('GUI disable and local Off revoke an existing native owner', async t => {
  const h=await harness(t);await h.call('computer-link-open');await h.call('set-option',{key:'enableGuiAutomation',value:false});
  assert.equal(h.calls.filter(x=>x==='stop').length,1);
  await h.call('set-option',{key:'enableGuiAutomation',value:true});await h.call('computer-link-open');await h.call('set-local-mode',{mode:'off'});
  assert.equal(h.calls.filter(x=>x==='stop').length,2);
  await assert.rejects(h.call('computer-link-open'),/Enable local/);
});

test('emergency lock still stops owned native work when settings storage fails', async t => {
  const h=await harness(t);await h.call('computer-link-open');h.runtime.saveConfig=async()=>{throw new Error('disk full');};
  await assert.rejects(h.call('set-emergency-lock',{enabled:true}),/locked for this session.*disk full/);
  assert.equal(h.context.runtimeState().emergencyLock,true);assert.equal(h.calls.includes('stop'),true);
});

test('quit waits for observed owned process cleanup and fences new launches', async t => {
  const done=deferred();const h=await harness(t,{processModule:{stopManagedProcess:()=>done.promise}});
  h.runtime.state.processes.set('owned',{id:'owned',child:{}});
  let prevented=0;h.events.get('before-quit')({preventDefault(){prevented++;}});await tick();
  assert.equal(prevented,1);assert.equal(h.quits(),0);assert.equal(h.runtime.state.shuttingDown,true);
  await assert.rejects(h.call('computer-link-open'),/locked/);
  await assert.rejects(h.context.executeShell('start_process',{}),/stopping/);
  const cleanup=h.context.runtimeState().quitCleanup;done.resolve({status:'terminated'});await cleanup;
  assert.equal(h.quits(),1);assert.equal(h.context.runtimeState().quitReady,true);
});

test('unconfirmed native shutdown cancels quit and reports the actual failure', async t => {
  const h=await harness(t);await h.call('computer-link-status');h.native.stopComputerLinkOwner=async()=>({stopped:false,reason:'owner-exit-unconfirmed'});
  h.events.get('before-quit')({preventDefault(){}});await h.context.runtimeState().quitCleanup;
  assert.equal(h.quits(),0);assert.equal(h.context.runtimeState().quitReady,false);
  assert.ok(h.emitted.some(event=>event.type==='shutdown-error'&&event.detail.error.includes('owner-exit-unconfirmed')));
  h.native.stopComputerLinkOwner=async()=>({stopped:true});h.events.get('before-quit')({preventDefault(){}});await h.context.runtimeState().quitCleanup;
  assert.equal(h.quits(),1);
});
