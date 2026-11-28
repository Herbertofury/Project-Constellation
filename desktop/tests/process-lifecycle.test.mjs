import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { startManagedProcess, stopManagedProcess, readManagedOutput } from '../src/process-manager.mjs';

const nodeCommand=code=>process.platform==='win32'?`& '${process.execPath.replaceAll("'","''")}' -e '${code.replaceAll("'","''")}'`:`'${process.execPath}' -e '${code.replaceAll("'","'\\''")}'`;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'constellation-owned-process-'));const state={baseDir:dir,processes:new Map()},config={allowedRoots:[dir],enableShell:true,blockedCommands:[],defaultShell:process.platform==='win32'?'powershell':'/bin/bash'};t.after(async()=>{for(const child of state.processes.values())try{await stopManagedProcess(child);}catch{}await fs.rm(dir,{recursive:true,force:true});});return{dir,state,config};}

test('Stop observes OS exit and durable output before reporting terminated',async t=>{
  const {dir,state,config}=await fixture(t);
  const started=await startManagedProcess({command:nodeCommand('process.stdout.write("ready\\n");process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'),cwd:dir},config,state);
  const owned=state.processes.get(started.session_id);
  for(let n=0;n<100;n++){if((await readManagedOutput(owned,{byte_offset:0,length:0})).output.includes('ready'))break;await delay(10);}
  const result=await stopManagedProcess(owned);
  assert.equal(result.status,'terminated');
  assert.ok(owned.child.exitCode!==null||owned.child.signalCode!==null,'OS exit must be observed');
  const meta=JSON.parse(await fs.readFile(owned.metaPath,'utf8'));assert.equal(meta.status,'terminated');assert.ok(meta.finishedAt);
  assert.match((await readManagedOutput(owned,{byte_offset:0,length:0})).output,/ready/);
});

test('concurrent stop requests share actual cleanup and do not signal unrelated processes',async t=>{
  const {dir,state,config}=await fixture(t);
  const command=nodeCommand('setInterval(()=>{},1000)');
  const a=await startManagedProcess({command,cwd:dir},config,state),b=await startManagedProcess({command,cwd:dir},config,state);
  const owned=state.processes.get(a.session_id),unrelated=state.processes.get(b.session_id);
  const results=await Promise.all(Array.from({length:8},()=>stopManagedProcess(owned)));
  assert.ok(results.every(value=>value.status==='terminated'));
  assert.equal(unrelated.child.exitCode,null);assert.equal(unrelated.child.signalCode,null);
  await stopManagedProcess(unrelated);
});

test('late shutdown after preparation prevents process spawn',async t=>{
  const {dir,state,config}=await fixture(t);
  await assert.rejects(startManagedProcess({command:nodeCommand('process.exit(0)'),cwd:dir},config,state,()=>{state.shuttingDown=true;}),/stopped before process launch/);
  assert.equal(state.processes.size,0);
});

test('an unowned or restored process record is never labelled freshly terminated',async()=>{
  const record={id:'unknown',status:'running',pid:12345};
  await assert.rejects(stopManagedProcess(record),/no owned process handle/);
  assert.equal(record.status,'running');assert.equal(record.finishedAt,undefined);
});
