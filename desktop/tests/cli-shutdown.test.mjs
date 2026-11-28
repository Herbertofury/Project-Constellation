import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
const exec=promisify(execFile),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const entry=fileURLToPath(new URL('../bin/constellation-commander.mjs',import.meta.url));
const command=code=>process.platform==='win32'?`& '${process.execPath.replaceAll("'","''")}' -e '${code.replaceAll("'","''")}'`:`'${process.execPath}' -e '${code.replaceAll("'","'\\''")}'`;
const deadline=async(promise,ms,message)=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),ms);})]);}finally{clearTimeout(timer);}};
async function running(pid){
  try{process.kill(pid,0);}catch(error){if(error.code==='ESRCH')return false;throw error;}
  if(process.platform==='linux')try{const stat=await fs.readFile(`/proc/${pid}/stat`,'utf8');if(stat.slice(stat.lastIndexOf(')')+2).startsWith('Z'))return false;}catch(error){if(error.code==='ENOENT')return false;throw error;}
  return true;
}
async function fixture(t){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'constellation-cli-shutdown-'));
  const child=spawn(process.execPath,[entry],{cwd:dir,stdio:['ignore','pipe','pipe'],windowsHide:true,env:{...process.env,CONSTELLATION_COMMANDER_HOME:dir,CONSTELLATION_ALLOWED_ROOTS:dir,CONSTELLATION_PORT:'0',CONSTELLATION_ENDPOINT_TOKEN:'shutdown-fixture-token'}});
  let stdout='',stderr='',ownedPid=null,verified=false;
  const exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
  child.stderr.on('data',chunk=>stderr+=chunk);
  const ready=new Promise((resolve,reject)=>{
    child.stdout.on('data',chunk=>{stdout+=chunk;const match=stdout.match(/Local MCP: (http:\/\/[^\s]+)/);if(match)resolve(match[1]);});
    child.once('error',reject);child.once('close',()=>reject(new Error(`CLI exited before listening: ${stderr}`)));
  });
  t.after(async()=>{
    if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');try{await deadline(exited,12000,'fixture CLI cleanup timeout');}catch{child.kill('SIGKILL');await exited;}}
    // Only the specific process tree this fixture asked its disposable CLI to
    // create; no name-based process search or unrelated session is terminated.
    if(!verified&&ownedPid&&await running(ownedPid)){
      if(process.platform==='win32')await exec('taskkill.exe',['/PID',String(ownedPid),'/T','/F']).catch(()=>{});
      else try{process.kill(-ownedPid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}
    }
    await fs.rm(dir,{recursive:true,force:true});
  });
  const url=await deadline(ready,10000,'CLI did not listen');
  async function call(name,args={}){
    const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}}),signal:AbortSignal.timeout(10000)});
    const body=await response.json();assert.equal(body.result.isError,false,JSON.stringify(body));return body.result.structuredContent;
  }
  const source='const {spawn}=require("node:child_process");const descendant=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"inherit"});process.stdout.write(JSON.stringify({parent:process.pid,descendant:descendant.pid})+"\\n");setInterval(()=>{},1000)';
  const session=await call('start_process',{command:command(source),cwd:dir});ownedPid=session.pid;
  let pids;
  const until=Date.now()+8000;
  while(Date.now()<until){const output=await call('read_process_output',{session_id:session.session_id,byte_offset:0,length:0});if(output.output.trim()){pids=JSON.parse(output.output.trim());break;}await delay(10);}
  assert.ok(pids?.parent&&pids?.descendant,'real owned descendant must have started');
  assert.equal(await running(pids.parent),true);assert.equal(await running(pids.descendant),true);
  return{child,call,exited,async verify(){const result=await deadline(exited,12000,`CLI did not exit after cleanup: ${stderr}`);assert.equal(result.code,0,stderr);assert.equal(result.signal,null);assert.equal(await running(pids.parent),false,'owned parent still running');assert.equal(await running(pids.descendant),false,'owned descendant still running');const metadata=JSON.parse(await fs.readFile(path.join(dir,'processes',`${session.session_id}.json`),'utf8'));assert.equal(metadata.status,'terminated');assert.ok(metadata.finishedAt);verified=true;}};
}

test('MCP shutdown ends the CLI-owned real process tree and persists terminal state',async t=>{
  const f=await fixture(t);assert.equal((await f.call('shutdown')).shutting_down,true);await f.verify();
});
test('SIGTERM waits for CLI-owned real process tree cleanup before exiting', {skip:process.platform==='win32'?'Windows TerminateProcess is not a catchable POSIX signal; MCP shutdown is exercised above':false},async t=>{
  const f=await fixture(t);assert.equal(f.child.kill('SIGTERM'),true);await f.verify();
});
