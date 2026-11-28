import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {assertAllowedPath,assertCommandAllowed} from './policy.mjs';
const execFileAsync=promisify(execFile);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const terminalStates=new Set(['finished','failed','terminated','timed_out','interrupted']);
function snapshot(s){return {session_id:s.id,pid:s.pid??null,command:s.command,cwd:s.cwd,status:s.status,startedAt:s.startedAt,finishedAt:s.finishedAt??null,exitCode:s.exitCode??null,error:s.error??null};}
function persist(s){
  s.persistQueue=(s.persistQueue||Promise.resolve()).catch(()=>{}).then(async()=>{
    const tmp=`${s.metaPath}.tmp`;
    await fs.writeFile(tmp,JSON.stringify(snapshot(s),null,2));await fs.rename(tmp,s.metaPath);
  }).catch(e=>{s.persistenceError=String(e.message);});
  return s.persistQueue;
}
export function listManagedProcesses(state){return [...state.processes.values()].map(snapshot);}
export function resolveWindowsPowerShell(shell,env=process.env,exists=existsSync){
  const requested=String(shell||'powershell').trim();
  if(/[/\\]/.test(requested))return requested;
  const lower=requested.toLowerCase();
  if(lower==='pwsh'||lower==='pwsh.exe')return 'pwsh.exe';
  // An explicit powershell.exe request is a compatibility opt-in to Windows PowerShell 5.1.
  if(lower==='powershell.exe')return 'powershell.exe';
  if(lower==='powershell'||!requested){
    const dirs=String(env.Path||env.PATH||'').split(';').map(x=>x.trim().replace(/^"|"$/g,'')).filter(Boolean);
    const candidates=dirs.map(dir=>path.win32.join(dir,'pwsh.exe'));
    if(env.ProgramFiles)candidates.push(path.win32.join(String(env.ProgramFiles),'PowerShell','7','pwsh.exe'));
    if(candidates.some(candidate=>{try{return Boolean(exists(candidate));}catch{return false;}}))return 'pwsh.exe';
  }
  return 'powershell.exe';
}
export function parseWindowsDirectNativeInvocation(command){
  const raw=String(command??'');
  let i=0;
  const skip=()=>{while(i<raw.length&&/\s/.test(raw[i]))i++;};
  const fail=()=>null;
  skip();
  // Only optimize the explicit PowerShell call operator form. This keeps arbitrary
  // PowerShell source, pipelines, functions and expansion on the normal shell path.
  if(raw[i]!=='&')return null;
  i++;
  if(i>=raw.length||!/\s/.test(raw[i]))return null;
  skip();
  const tokens=[];
  while(i<raw.length){
    skip();if(i>=raw.length)break;
    let value='';
    if(raw[i]==="'"){
      i++;
      let closed=false;
      while(i<raw.length){
        if(raw[i]==="'"){
          if(raw[i+1]==="'"){value+="'";i+=2;continue;}
          i++;closed=true;break;
        }
        value+=raw[i++];
      }
      if(!closed)return fail();
    }else if(raw[i]==='"'){
      i++;
      let closed=false;
      while(i<raw.length){
        const ch=raw[i++];
        if(ch==='"'){closed=true;break;}
        // Double-quoted PowerShell strings can expand variables/subexpressions and
        // backtick escapes. Leave those to PowerShell rather than changing meaning.
        if(ch==='$'||ch==='`')return fail();
        value+=ch;
      }
      if(!closed)return fail();
    }else{
      const start=i;
      while(i<raw.length&&!/\s/.test(raw[i])){
        if(/[;|><&(){}$`]/.test(raw[i]))return fail();
        i++;
      }
      value=raw.slice(start,i);
    }
    if(!value)return fail();
    tokens.push(value);
    if(i<raw.length&&!/\s/.test(raw[i]))return fail();
  }
  if(!tokens.length)return null;
  const exe=tokens[0];
  // Restrict the bypass to unmistakable native Windows executables. PowerShell
  // scripts/functions/modules continue through PowerShell with full semantics.
  if(!/\.(?:exe|com)$/i.test(exe))return null;
  return {exe,args:tokens.slice(1),direct:true};
}
export function buildShellSpec(command,shell,platform=process.platform,scriptPath=''){
  const raw=String(command??'');
  if(platform!=='win32')return {exe:shell||'/bin/bash',args:['-lc',raw]};
  if(String(shell||'').toLowerCase().includes('cmd'))return {exe:'cmd.exe',args:['/d','/s','/c',raw]};
  const exe=resolveWindowsPowerShell(shell);
  if(!scriptPath)scriptPath=path.join(os.tmpdir(),`project-constellation-${crypto.createHash('sha256').update(raw).digest('hex').slice(0,16)}.ps1`);
  // Put the user's PowerShell source in a script file verbatim. -Command/Invoke-Expression
  // re-parses native argument quoting on Windows and can silently corrupt quoted `node -e`
  // payloads. A UTF-8-BOM .ps1 preserves the exact PowerShell source and still lets the
  // child inherit stdin for interactive commands. The trailer only converts the final
  // PowerShell/native status into the process exit code.
  const scriptContent=`$ProgressPreference='SilentlyContinue'
if(Get-Variable PSNativeCommandArgumentPassing -ErrorAction SilentlyContinue){$PSNativeCommandArgumentPassing='Standard'}
$global:LASTEXITCODE=0
${raw}
$pcSuccess=$?
$pcExitCode=[int]$global:LASTEXITCODE
if(-not $pcSuccess -and $pcExitCode -eq 0){$pcExitCode=1}
exit $pcExitCode
`;
  return {exe,args:['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',scriptPath],scriptPath,scriptContent};
}
export async function startManagedProcess(args,config,state,canContinue){
  assertCommandAllowed(args.command,config);
  const roots=Array.isArray(config.allowedRoots)?config.allowedRoots:[];
  const cwd=assertAllowedPath(args.cwd||roots.find(x=>x!=='*')||os.homedir(),config);
  if(!(await fs.stat(cwd)).isDirectory())throw new Error('Working directory is not a directory.');
  const timeout=Number(args.timeout_ms??0);
  if(!Number.isFinite(timeout)||timeout<0)throw new Error('timeout_ms must be a non-negative finite number');
  const shell=args.shell||config.defaultShell;
  const id=`proc_${crypto.randomBytes(8).toString('hex')}`;const dir=path.join(state.baseDir,'processes');await fs.mkdir(dir,{recursive:true});
  const scriptPath=process.platform==='win32'&&!String(shell||'').toLowerCase().includes('cmd')?path.join(dir,`${id}.ps1`):'';
  // PowerShell's native-command re-serialization on Windows can still corrupt
  // embedded quote characters for some executables (notably `node.exe -e`). For
  // an explicit, simple `& 'program.exe' ...` invocation with no shell operators,
  // bypass PowerShell and hand structured argv directly to CreateProcess via Node.
  // Supplying an explicit shell override always opts back into shell semantics.
  const direct=process.platform==='win32'&&!args.shell?parseWindowsDirectNativeInvocation(args.command):null;
  const spec=direct||buildShellSpec(args.command,shell,process.platform,scriptPath);
  const logPath=path.join(dir,`${id}.log`);await fs.writeFile(logPath,'');
  if(spec.scriptContent){const bom=Buffer.from([0xef,0xbb,0xbf]);await fs.writeFile(spec.scriptPath,Buffer.concat([bom,Buffer.from(spec.scriptContent,'utf8')]));}
  try {
    await canContinue?.();
    if(state.shuttingDown||config.emergencyLock)throw new Error('Local execution was stopped before process launch.');
    assertCommandAllowed(args.command,config);assertAllowedPath(cwd,config);
  } catch(error) {
    if(spec.scriptPath)await fs.rm(spec.scriptPath,{force:true}).catch(()=>{});
    throw error;
  }
  const child=spawn(spec.exe,spec.args,{cwd,stdio:['pipe','pipe','pipe'],windowsHide:true,detached:process.platform!=='win32'});
  const s={id,pid:child.pid,child,command:args.command,cwd,logPath,metaPath:path.join(dir,`${id}.json`),status:'starting',startedAt:new Date().toISOString(),readCursor:0,readBytes:0,exitCode:null,writeQueue:Promise.resolve()};state.processes.set(id,s);
  let resolveClosed;
  s.closed = new Promise(resolve => { resolveClosed = resolve; });
  // A single write chain preserves stream delivery order and drains before completion.
  const append=chunk=>{s.writeQueue=s.writeQueue.then(()=>fs.appendFile(logPath,chunk)).catch(e=>{s.error=`Output log: ${e.message}`;});};
  child.stdout.on('data',append);child.stderr.on('data',append);child.stdin.on('error',e=>{s.inputError=String(e.message);});
  const cleanupScript=()=>spec.scriptPath?fs.rm(spec.scriptPath,{force:true}).catch(()=>{}):Promise.resolve();
  const spawned=new Promise((resolve,reject)=>{
    child.once('spawn',()=>{s.status=s.stopRequested?'stopping':'running';void persist(s);resolve();});
    child.once('error',e=>{s.status='failed';s.error=String(e.message);s.finishedAt=new Date().toISOString();void cleanupScript();void persist(s);reject(new Error(`Could not start command: ${e.message}`));});
  });
  child.on('error',e=>{s.error=String(e.message);});
  child.once('close',async(code,signal)=>{
    clearTimeout(s.timer);await s.writeQueue;await cleanupScript();
    if(!terminalStates.has(s.status))s.status=s.stopRequested||(code===0?'finished':'failed');
    s.exitCode=code;s.signal=signal;s.finishedAt=new Date().toISOString();await persist(s);
    resolveClosed();
  });
  await spawned;
  if(timeout>0)s.timer=setTimeout(()=>{void stopManagedProcess(s,'timed_out').catch(e=>{s.error=String(e.message);});},timeout).unref();
  return {...snapshot(s),session_id:id};
}
export async function readManagedOutput(s,args={}){
  const wait=Number(args.wait_ms||0);if(wait>0&&!terminalStates.has(s.status))await sleep(Math.min(wait,10000));
  await s.writeQueue;
  const independent=args.byte_offset!=null;
  if(independent&&(!Number.isSafeInteger(args.byte_offset)||args.byte_offset<0))throw new Error('byte_offset must be a nonnegative integer');
  const incremental=independent||args.offset==null||Number(args.offset)===0;
  const base=independent?args.byte_offset:incremental?(s.readBytes||0):0;
  const handle=await fs.open(s.logPath,'r');let bytes;
  try{const st=await handle.stat();bytes=Buffer.alloc(Math.max(0,st.size-base));const read=await handle.read(bytes,0,bytes.length,base);bytes=bytes.subarray(0,read.bytesRead);}finally{await handle.close();}
  let output,nextOffset;
  if(incremental){
    // Byte-based incremental cursor also returns later pieces of an unfinished line.
    let end=bytes.length;
    if(!terminalStates.has(s.status)){
      let start=end;while(start>0&&(bytes[start-1]&0xc0)===0x80)start--;
      const lead=start===end?end-1:start-1;
      if(lead>=0){const b=bytes[lead],need=b>=0xf0?4:b>=0xe0?3:b>=0xc0?2:1;if(end-lead<need)end=lead;}
    }
    let data=bytes.subarray(0,end);const limit=Number(args.length??1000);
    if(limit>0){let count=0,cut=0;for(;cut<data.length;cut++){if(data[cut]===10&&++count>=limit){cut++;break;}}data=data.subarray(0,cut);}
    output=data.toString('utf8');nextOffset=base+data.length;if(!independent)s.readBytes=nextOffset;
  }else{
    const lines=bytes.toString('utf8').split(/\r?\n/),offset=Number(args.offset),start=offset<0?Math.max(0,lines.length+offset):offset;
    const end=Number(args.length)>0?start+Number(args.length):lines.length;output=lines.slice(start,end).join('\n');nextOffset=Math.min(end,lines.length);
  }
  return {session_id:s.id,status:s.status,pid:s.pid??null,exit_code:s.exitCode,output,next_offset:nextOffset,cursor_unit:incremental?'bytes':'lines',error:s.error||null};
}
export async function interactManagedProcess(s,args={}){
  if(s.status!=='running'||!s.child?.stdin?.writable)throw new Error('Session is not running');
  const text=String(args.input??'');await new Promise((resolve,reject)=>s.child.stdin.write(text+(text.endsWith('\n')?'':'\n'),e=>e?reject(e):resolve()));
  return readManagedOutput(s,{wait_ms:args.wait_ms??100});
}
export async function stopManagedProcess(s,status='terminated'){
  if(!['terminated','timed_out'].includes(status))throw new Error('Invalid process stop status');
  if(s.stopPromise)return s.stopPromise;
  if(terminalStates.has(s.status)){if(s.closed)await s.closed;return snapshot(s);}
  if(!s.child||!Number.isInteger(s.pid)||s.pid<=0||s.pid===process.pid||!s.closed)
    throw new Error('This session has no owned process handle; termination is not confirmed.');
  s.stopPromise=(async()=>{
    s.stopRequested=status;s.status='stopping';clearTimeout(s.timer);await persist(s);
    try{
      if(s.child.exitCode===null&&s.child.signalCode===null){
        // These processes were created by this runtime. POSIX sessions have a
        // dedicated process group; Windows taskkill owns the observed child tree.
        // Do not schedule an unref'ed kill after reporting termination: quitting
        // used to drop that timer and leave the actual child running.
        if(process.platform==='win32')await execFileAsync('taskkill.exe',['/PID',String(s.pid),'/T','/F'],{windowsHide:true,timeout:5000});
        else try{process.kill(-s.pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}
      }
      let timer;
      try{
        await Promise.race([s.closed,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Owned process exit or output cleanup is unconfirmed.')),5000);})]);
      }finally{clearTimeout(timer);}
      return snapshot(s);
    }catch(error){
      // Preserve the live/uncertain state and permit an explicit cleanup retry.
      // A rejected OS operation must never turn into a successful "terminated".
      if(s.child.exitCode!==null||s.child.signalCode!==null){
        // Still require the close/output barrier; an escaped child can retain a
        // pipe even after its parent exits. Only the close handler is terminal.
        s.error=String(error.message);
      }else{s.error=String(error.message);s.status='stopping';}
      await persist(s);throw error;
    }
  })();
  try{return await s.stopPromise;}finally{s.stopPromise=null;}
}
export async function recoverProcesses(state){
  const dir=path.join(state.baseDir,'processes');await fs.mkdir(dir,{recursive:true});
  const names=await fs.readdir(dir);
  await Promise.all(names.filter(name=>/^proc_[0-9a-f]+\.ps1$/.test(name)).map(name=>fs.rm(path.join(dir,name),{force:true}).catch(()=>{})));
  for(const name of names){
    if(!/^proc_[0-9a-f]+\.json$/.test(name))continue;
    try{const metaPath=path.join(dir,name),s=JSON.parse(await fs.readFile(metaPath,'utf8'));const id=s.session_id;
      state.processes.set(id,{...s,id,pid:null,status:terminalStates.has(s.status)?s.status:'interrupted',error:terminalStates.has(s.status)?s.error:'Application restarted; the previous process is not being controlled. Output was preserved.',logPath:path.join(dir,`${id}.log`),metaPath,readBytes:0,writeQueue:Promise.resolve()});
    }catch{}
  }
}
