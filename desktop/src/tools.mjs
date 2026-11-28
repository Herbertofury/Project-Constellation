import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { APP_NAME, VERSION, saveConfig } from './config.mjs';
import { assertAllowedPath, assertCommandAllowed, resolveUserPath } from './policy.mjs';
import { recordCall } from './state.mjs';
import {tailJsonl} from './indexed-jsonl.mjs';
import {SearchEngine} from './search-engine.mjs';
import {TaskRunner} from './task-runner.mjs';
import { atomicWrite, safeMove, sha256 } from './file-operations.mjs';
import { startManagedProcess, readManagedOutput, interactManagedProcess, listManagedProcesses, stopManagedProcess } from './process-manager.mjs';
import { toolDefinitions } from './tool-definitions.mjs';
import { computerUse, closeComputerUseHelper } from './computer-use.mjs';
import { getComputerLinkStatus, getComputerLinkMcpStatus } from './computer-link.mjs';

const execFileAsync = promisify(execFile);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => new Date().toISOString();
const id = prefix => `${prefix}_${crypto.randomBytes(8).toString('hex')}`;

function redactConfig(config) {
  const out = { ...config };
  for (const key of Object.keys(out)) {
    if (/token|secret|password/i.test(key)) out[key] = '<redacted>';
  }
  return out;
}

function linesSlice(text, offset = 0, length = 1000, cursor = 0) {
  const lines = text.split(/\r?\n/);
  if (offset < 0) return { lines: lines.slice(Math.max(0, lines.length + offset)), next: lines.length };
  const start = offset === 0 ? cursor : offset;
  const end = length && length > 0 ? Math.min(lines.length, start + length) : lines.length;
  return { lines: lines.slice(start, end), next: end };
}

async function listDir(root, depth, current = 0, out = []) {
  const entries = await fsp.readdir(root, { withFileTypes: true });
  entries.sort((a,b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    const p = path.join(root, e.name);
    out.push({ type: e.isDirectory() ? 'directory' : e.isFile() ? 'file' : 'other', path: p, name: e.name });
    if (e.isDirectory() && current + 1 < depth) {
      try { await listDir(p, depth, current + 1, out); } catch (err) { out.push({ type:'denied', path:p, error:String(err.message || err) }); }
    }
  }
  return out;
}

function matchText(value, query, regex, caseSensitive) {
  if (regex) return new RegExp(query, caseSensitive ? '' : 'i').test(value);
  return caseSensitive ? value.includes(query) : value.toLowerCase().includes(query.toLowerCase());
}



function simplePdfBuffer(content) {
  const clean = String(content).replace(/\r/g,'').replace(/^#{1,6}\s+/gm,'').replace(/\*\*/g,'').replace(/`/g,'');
  const rawLines = clean.split('\n');
  const wrapped = [];
  for (const line of rawLines) {
    if (!line) { wrapped.push(''); continue; }
    let rest=line;
    while (rest.length > 92) {
      let cut=rest.lastIndexOf(' ',92); if(cut<20)cut=92;
      wrapped.push(rest.slice(0,cut)); rest=rest.slice(cut).trimStart();
    }
    wrapped.push(rest);
  }
  const pages=[]; for(let i=0;i<wrapped.length;i+=54)pages.push(wrapped.slice(i,i+54));
  if(!pages.length)pages.push(['']);
  const esc = t => t.replace(/[^\x20-\x7E]/g,'?').replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
  const objects = new Map();
  const pageIds=[];
  objects.set(1,'<< /Type /Catalog /Pages 2 0 R >>');
  objects.set(3,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  pages.forEach((lines,i)=>{
    const pid=4+i*2,cid=5+i*2; pageIds.push(pid);
    const ops=['BT','/F1 10 Tf','50 760 Td','12 TL',...lines.flatMap((line,j)=>[(j?'T*':''),`(${esc(line)}) Tj`].filter(Boolean)),'ET'].join('\n');
    objects.set(pid,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${cid} 0 R >>`);
    objects.set(cid,`<< /Length ${Buffer.byteLength(ops,'ascii')} >>\nstream\n${ops}\nendstream`);
  });
  objects.set(2,`<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map(x=>`${x} 0 R`).join(' ')}] >>`);
  const max=Math.max(...objects.keys()); let pdf='%PDF-1.4\n%CCMD\n'; const offsets=[0];
  for(let i=1;i<=max;i++){ offsets[i]=Buffer.byteLength(pdf,'ascii'); pdf+=`${i} 0 obj\n${objects.get(i)||'<<>>'}\nendobj\n`; }
  const xref=Buffer.byteLength(pdf,'ascii'); pdf+=`xref\n0 ${max+1}\n0000000000 65535 f \n`;
  for(let i=1;i<=max;i++)pdf+=`${String(offsets[i]).padStart(10,'0')} 00000 n \n`;
  pdf+=`trailer\n<< /Size ${max+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf,'ascii');
}

async function trashPath(target) {
  if (process.platform === 'win32') {
    const escaped = target.replaceAll("'", "''");
    const script = `Add-Type -AssemblyName Microsoft.VisualBasic; $p='${escaped}'; if (Test-Path -LiteralPath $p -PathType Container) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p,'OnlyErrorDialogs','SendToRecycleBin') } else { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p,'OnlyErrorDialogs','SendToRecycleBin') }`;
    await execFileAsync('powershell.exe', ['-NoProfile','-NonInteractive','-Command', script]);
    return;
  }
  for (const cmd of [['gio',['trash',target]],['trash-put',[target]]]) {
    try { await execFileAsync(cmd[0], cmd[1]); return; } catch {}
  }
  throw new Error('No supported recycle-bin command is available; refusing permanent deletion.');
}

async function openPath(target) {
  if (/^https?:\/\//i.test(target)) {
    if (process.platform === 'win32') { const script=`Start-Process -FilePath '${target.replaceAll("'","''")}'`; return execFileAsync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true}); }
    if (process.platform === 'darwin') return execFileAsync('open',[target]);
    return execFileAsync('xdg-open',[target]);
  }
  if (process.platform === 'win32') { const script=`Start-Process -FilePath '${target.replaceAll("'","''")}'`; return execFileAsync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true}); }
  if (process.platform === 'darwin') return execFileAsync('open',[target]);
  return execFileAsync('xdg-open',[target]);
}

function shellSpec(command, shellOverride, config) {
  const shell = shellOverride || config.defaultShell;
  if (process.platform === 'win32') {
    if ((shell || '').toLowerCase().includes('cmd')) return { exe:'cmd.exe', args:['/d','/s','/c',command] };
    return { exe:'powershell.exe', args:['-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-Command',command] };
  }
  return { exe: shell || '/bin/bash', args:['-lc',command] };
}

async function processLines(session) {
  let text = '';
  try { text = await fsp.readFile(session.logPath, 'utf8'); } catch {}
  return text;
}

async function listSystemProcesses() {
  if (process.platform === 'win32') {
    const { stdout } = await execFileAsync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"Get-CimInstance Win32_Process | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress"], { maxBuffer: 32*1024*1024 });
    const parsed = stdout.trim() ? JSON.parse(stdout) : [];
    return Array.isArray(parsed) ? parsed : [parsed];
  }
  const { stdout } = await execFileAsync('ps',['-eo','pid=,comm=,args='], { maxBuffer:32*1024*1024 });
  return stdout.trim().split('\n').map(line => {
    const m = line.trim().match(/^(\d+)\s+(\S+)\s*(.*)$/);
    return m ? { pid:Number(m[1]), name:m[2], command:m[3] } : { raw:line };
  });
}


function assertGuiAllowed(config, state) {
  if (!config.enableGuiAutomation) throw new Error('Computer-use automation is disabled in Project Constellation configuration.');
  const lockPath = path.join(state.baseDir, 'EMERGENCY-LOCK');
  if (fs.existsSync(lockPath) || config.emergencyLock === true) throw new Error('Project Constellation Emergency Lock is active.');
}

function validateArguments(name, args) {
  const definition=toolDefinitions().find(tool=>tool.name===name);
  if(!definition)throw new Error(`Unknown tool: ${name}`);
  if(!args || typeof args!=='object' || Array.isArray(args))throw new Error('Tool arguments must be an object.');
  const schema=definition.inputSchema||{};
  for(const key of schema.required||[]) if(args[key]===undefined)throw new Error(`${name}: required argument ${key} is missing`);
  for(const [key,value] of Object.entries(args)) {
    const prop=schema.properties?.[key]; if(!prop)continue;
    const valid=prop.type==='array'?Array.isArray(value):prop.type==='object'?value!==null&&typeof value==='object'&&!Array.isArray(value):!prop.type||typeof value===prop.type;
    if(!valid || (prop.type==='number'&&!Number.isFinite(value)))throw new Error(`${name}: ${key} must be ${prop.type}`);
    if(prop.enum&&!prop.enum.includes(value))throw new Error(`${name}: invalid ${key}`);
    if(prop.minItems!=null&&value.length<prop.minItems)throw new Error(`${name}: ${key} cannot be empty`);
  }
}

export function createToolHandler({ config, configPath, state, onShutdown }) {
  const searches=new SearchEngine(state,config);
  const tasks=new TaskRunner({state,definitions:toolDefinitions,callTool:(name,args,context)=>callTool(name,args,context)});
  state.tasks=tasks;
  const callTool = async function callTool(name, args = {}, context = {}) {
    const started = Date.now();
    let ok = true;
    try {
      validateArguments(name,args);
      const locked=config.emergencyLock===true||fs.existsSync(path.join(state.baseDir,'EMERGENCY-LOCK'));
      const destructive = new Set(['write_file','edit_block','write_pdf','create_directory','copy_file','move_file','trash_path','open_path','start_process','interact_with_process','kill_process','set_config_value','run_task','resume_task']);
      if(state.shuttingDown&&(destructive.has(name)||name.startsWith('computer_')))throw new Error('Project Constellation is stopping its owned work.');
      if(locked&&(destructive.has(name)||name.startsWith('computer_')))throw new Error('Project Constellation Emergency Lock is active.');
      if(['interact_with_process','kill_process'].includes(name)&&!config.enableShell)throw new Error('Shell execution is disabled in configuration.');
      const guardedContext={...context,canContinue:async()=>{
        if(state.shuttingDown)throw new Error('Application shutdown requested; task paused.');
        if(config.emergencyLock===true||fs.existsSync(path.join(state.baseDir,'EMERGENCY-LOCK')))throw new Error('Emergency Lock is active; task paused.');
        await context.canContinue?.();
      }};
      let result;
      switch (name) {
        case 'list_devices': result = { devices:[{ id:config.deviceName, name:config.deviceName, status:'online', local:true, platform:process.platform }] }; break;
        case 'who_am_i': result = { mode:'self-hosted', deviceName:config.deviceName, accountRequired:false, quotaEnforced:false, quota:null, app:APP_NAME, version:VERSION }; break;
        case 'ping': result = { pong:true, at:now(), deviceName:config.deviceName, app:APP_NAME, version:VERSION }; break;
        case 'get_system_info': result = { app:APP_NAME, version:VERSION, hostname:os.hostname(), platform:process.platform, release:os.release(), arch:process.arch, node:process.version, home:os.homedir(), cwd:process.cwd(), deviceName:config.deviceName }; break;
        case 'get_computer_link_status': result = await getComputerLinkStatus(); break;
        case 'get_computer_link_session_status': result = await getComputerLinkMcpStatus(); break;
        case 'get_config': result = redactConfig(config); break;
        case 'set_config_value': {
          const allowed = new Set(['allowedRoots','blockedCommands','enableShell','enableGuiAutomation','localToolMode','telemetryEnabled','defaultShell','deviceName','searchIgnore']);
          if (!allowed.has(args.key)) throw new Error(`Unsupported configuration key: ${args.key}`);
          const value=args.value;
          if(['allowedRoots','blockedCommands','searchIgnore'].includes(args.key)&&(!Array.isArray(value)||value.some(x=>typeof x!=='string')))throw new Error(`${args.key} must be an array of strings`);
          if(['enableShell','enableGuiAutomation','telemetryEnabled'].includes(args.key)&&typeof value!=='boolean')throw new Error(`${args.key} must be boolean`);
          if(args.key==='localToolMode'&&!['auto','always','off'].includes(value))throw new Error('Invalid localToolMode');
          if(args.key==='blockedCommands')for(const pattern of value)new RegExp(pattern);
          const next={...config,[args.key]:value};
          await saveConfig(configPath,next);Object.assign(config,next);
          result = { updated:args.key, value:args.value };
          break;
        }
        case 'read_file': {
          const p = assertAllowedPath(args.path, config);
          const enc = args.encoding || 'utf8';
          if (enc === 'base64') { const b = await fsp.readFile(p); result = { path:p, encoding:'base64', content:b.toString('base64'), bytes:b.length }; break; }
          const rawBytes = await fsp.readFile(p);
          if(rawBytes.includes(0))throw new Error('Binary or UTF-16 file: use base64 mode. The text editor will not rewrite this file.');
          let text;try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(rawBytes);}catch{throw new Error('File is not valid UTF-8. Use base64 mode; no bytes were changed.');}
          const sliced = linesSlice(text, Number(args.offset || 0), Number(args.length ?? 1000), 0);
          result = { path:p, encoding:'utf8', content:sliced.lines.join('\n'), line_ending:text.includes('\r\n')?'crlf':'lf', sha256:sha256(Buffer.from(text,'utf8')), next_offset:sliced.next, total_lines:text.split(/\r?\n/).length };
          break;
        }
        case 'read_multiple_files': {
          const files = [];
          for (const raw of args.paths || []) {
            try { const p=assertAllowedPath(raw,config); files.push({ path:p, content:await fsp.readFile(p,'utf8') }); }
            catch(e){ files.push({ path:raw, error:String(e.message||e) }); }
          }
          result = { files }; break;
        }
        case 'write_file': {
          const p=assertAllowedPath(args.path,config);
          const data=(args.encoding||'utf8')==='base64'?Buffer.from(args.content,'base64'):Buffer.from(args.content,'utf8');
          if(args.mode==='append') {
            const old=await fsp.readFile(p).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
            result=await atomicWrite(p,Buffer.concat([old||Buffer.alloc(0),data]),{expectedSha256:args.expected_sha256??(old===null?null:sha256(old))});
          } else result=await atomicWrite(p,data,{expectedSha256:args.expected_sha256});
          break;
        }
        case 'edit_block': {
          if(!args.old_string)throw new Error('old_string cannot be empty.');
          const p=assertAllowedPath(args.path,config);const bytes=await fsp.readFile(p);const text=bytes.toString('utf8');
          const parts=text.split(args.old_string),count=parts.length-1,expected=args.expected_replacements??1;
          if(count!==expected||count===0)throw new Error(`Expected ${expected} replacement(s), found ${count}`);
          result={...await atomicWrite(p,parts.join(args.new_string),{expectedSha256:args.expected_sha256??sha256(bytes)}),replacements:count};break;
        }
        case 'write_pdf': { const p=assertAllowedPath(args.path,config); if(path.extname(p).toLowerCase()!=='.pdf') throw new Error('write_pdf path must end in .pdf'); await fsp.mkdir(path.dirname(p),{recursive:true}); const b=simplePdfBuffer(args.content); await fsp.writeFile(p,b); result={path:p,bytes:b.length,pages:'auto'}; break; }
        case 'create_directory': { const p=assertAllowedPath(args.path,config); await fsp.mkdir(p,{recursive:true}); result={path:p}; break; }
        case 'list_directory': { const p=assertAllowedPath(args.path,config); result={root:p,entries:await listDir(p,Math.max(1,Number(args.depth||1)))}; break; }
        case 'get_file_info': { const p=assertAllowedPath(args.path,config); const s=await fsp.stat(p); result={path:p,parent:path.dirname(p),size:s.size,isFile:s.isFile(),isDirectory:s.isDirectory(),created:s.birthtime.toISOString(),modified:s.mtime.toISOString(),mode:s.mode}; break; }
        case 'copy_file': {
          const s=assertAllowedPath(args.source,config), d=assertAllowedPath(args.destination,config); if(!args.overwrite && fs.existsSync(d)) throw new Error('Destination exists');
          await fsp.cp(s,d,{recursive:true,force:Boolean(args.overwrite),errorOnExist:!args.overwrite}); result={source:s,destination:d}; break;
        }
        case 'move_file': {
          const source=assertAllowedPath(args.source,config),destination=assertAllowedPath(args.destination,config);
          result=await safeMove(source,destination,Boolean(args.overwrite));break;
        }
        case 'trash_path': { const p=assertAllowedPath(args.path,config); await trashPath(p); result={trashed:p}; break; }
        case 'open_path': {
          const target=/^https?:\/\//i.test(args.path)?args.path:assertAllowedPath(args.path,config); await openPath(target); result={opened:target}; break;
        }
        case 'start_search': result=await searches.start(args);break;
        case 'get_more_search_results': result=await searches.page(args);break;
        case 'list_searches': result={searches:await searches.list()};break;
        case 'stop_search': result=await searches.stop(args.search_id);break;
        case 'run_task': result=await tasks.start(args,guardedContext);break;
        case 'get_task': result=await tasks.detail(args,context);break;
        case 'list_tasks': result={tasks:await tasks.list(context)};break;
        case 'cancel_task': result=await tasks.cancel(args,context);break;
        case 'resume_task': result=await tasks.resume(args,guardedContext);break;
        case 'start_process': result=await startManagedProcess(args,config,state,guardedContext.canContinue);break;
        case 'read_process_output': {
          const session=state.processes.get(args.session_id);if(!session)throw new Error('Unknown session_id');
          result=await readManagedOutput(session,args);break;
        }
        case 'interact_with_process': {
          const session=state.processes.get(args.session_id);if(!session)throw new Error('Unknown session_id');
          result=await interactManagedProcess(session,args);break;
        }
        case 'list_sessions': result={sessions:listManagedProcesses(state)};break;
        case 'force_terminate': {
          const session=state.processes.get(args.session_id);if(!session)throw new Error('Unknown session_id');
          result=await stopManagedProcess(session);break;
        }
        case 'list_processes': result={processes:await listSystemProcesses()}; break;
        case 'kill_process': { const pid=Number(args.pid); if(!Number.isInteger(pid)||pid<=0||pid===process.pid) throw new Error('Invalid pid or Project Constellation self-termination requested'); if(process.platform==='win32') await execFileAsync('taskkill',['/PID',String(pid),'/T','/F']); else process.kill(pid,'SIGKILL'); result={pid,terminated:true}; break; }
        case 'computer_displays': { assertGuiAllowed(config,state); result=await computerUse('displays',{}); break; }
        case 'computer_windows': { assertGuiAllowed(config,state); result=await computerUse('windows',args); break; }
        case 'computer_cursor': { assertGuiAllowed(config,state); result=await computerUse('cursor',{}); break; }
        case 'computer_observe': {
          assertGuiAllowed(config,state);
          const displays=await computerUse('displays',{}); const cursor=await computerUse('cursor',{}); const windows=await computerUse('windows',{limit:args.window_limit||120});
          const shot=await computerUse('screenshot',{target:'all',format:'jpeg',max_width:args.max_width||1600,max_height:args.max_height||1200},30000);
          const {base64,mimeType,name:attachmentName,...meta}=shot;
          result={displays:displays.displays,cursor,windows:windows.windows,screenshot:meta,_attachments:[{kind:'screenshot',name:attachmentName,mimeType,base64}]}; break;
        }
        case 'computer_screenshot': {
          assertGuiAllowed(config,state); const shot=await computerUse('screenshot',args,30000); const {base64,mimeType,name:attachmentName,...meta}=shot;
          result={...meta,_attachments:[{kind:'screenshot',name:attachmentName,mimeType,base64}]}; break;
        }
        case 'computer_move_mouse': { assertGuiAllowed(config,state); result=await computerUse('actions',{actions:[{type:'move',x:args.x,y:args.y}]}); break; }
        case 'computer_click': { assertGuiAllowed(config,state); result=await computerUse('actions',{actions:[{type:'click',x:args.x,y:args.y,button:args.button||'left'}]}); break; }
        case 'computer_double_click': { assertGuiAllowed(config,state); result=await computerUse('actions',{actions:[{type:'double_click',x:args.x,y:args.y,button:args.button||'left'}]}); break; }
        case 'computer_drag': { assertGuiAllowed(config,state); result=await computerUse('actions',{actions:[{type:'drag',from_x:args.from_x,from_y:args.from_y,to_x:args.to_x,to_y:args.to_y,steps:args.steps}]}); break; }
        case 'computer_scroll': { assertGuiAllowed(config,state); result=await computerUse('actions',{actions:[{type:'scroll',amount:args.amount,horizontal:Boolean(args.horizontal)}]}); break; }
        case 'computer_keypress': { assertGuiAllowed(config,state); result=await computerUse('actions',{actions:[{type:'keypress',key:args.key,repeat:args.repeat}]}); break; }
        case 'computer_hotkey': { assertGuiAllowed(config,state); result=await computerUse('actions',{actions:[{type:'hotkey',keys:args.keys}]}); break; }
        case 'computer_type': { assertGuiAllowed(config,state); result=await computerUse('actions',{actions:[{type:'type',text:args.text,settle_ms:args.settle_ms}]}); break; }
        case 'computer_wait': { assertGuiAllowed(config,state); result=await computerUse('actions',{actions:[{type:'wait',ms:args.ms??500}]},Math.max(5000,Number(args.ms||500)+3000)); break; }
        case 'computer_actions': {
          assertGuiAllowed(config,state); const actionResult=await computerUse('actions',{actions:args.actions||[]},30000); result={...actionResult};
          if(args.screenshot_after!==false){ const shot=await computerUse('screenshot',args.screenshot||{},30000); const {base64,mimeType,name:attachmentName,...meta}=shot; result.screenshot=meta; result._attachments=[{kind:'screenshot',name:attachmentName,mimeType,base64}]; }
          break;
        }
        case 'computer_focus_window': { assertGuiAllowed(config,state); result=await computerUse('focus_window',args); break; }
        case 'computer_window_state': { assertGuiAllowed(config,state); result=await computerUse('window_state',args); break; }
        case 'computer_close_window': { assertGuiAllowed(config,state); result=await computerUse('close_window',args); break; }
        case 'computer_clipboard_read': { assertGuiAllowed(config,state); result=await computerUse('clipboard_read',{}); break; }
        case 'computer_clipboard_write': { assertGuiAllowed(config,state); result=await computerUse('clipboard_write',args); break; }
        case 'computer_click_ui_element': {
          assertGuiAllowed(config,state); const ui=await computerUse('ui_elements',{...args,max_results:1},30000); const element=ui.elements?.[0]; if(!element) throw new Error('No matching UI element was found.');
          if(element.width<=0||element.height<=0||element.offscreen) throw new Error('Matching UI element is not currently clickable on screen.');
          await computerUse('actions',{actions:[{type:'click',x:Math.round(element.x+element.width/2),y:Math.round(element.y+element.height/2),button:'left'}]});
          result={clicked:true,element};
          if(args.screenshot_after!==false){ const shot=await computerUse('screenshot',{},30000); const {base64,mimeType,name:attachmentName,...meta}=shot; result.screenshot=meta; result._attachments=[{kind:'screenshot',name:attachmentName,mimeType,base64}]; }
          break;
        }
        case 'computer_find_ui_elements': { assertGuiAllowed(config,state); result=await computerUse('ui_elements',args,30000); break; }
        case 'get_recent_tool_calls': {
          result={calls:await tailJsonl(state.callsPath,Math.max(1,Number(args.max_results||50)))}; break;
        }
        case 'get_usage_stats': {
          let stats={totalCalls:0,byTool:{},errors:0}; try{stats=JSON.parse(await fsp.readFile(state.statsPath,'utf8'));}catch{} result={...stats,quotaEnforced:false,quota:null,message:'Local counters only; Project Constellation does not impose a tool-call quota.'}; break;
        }
        case 'shutdown': { result={shutting_down:true}; void closeComputerUseHelper(); setTimeout(()=>onShutdown?.(),100).unref(); break; }
        default: throw new Error(`Unknown tool: ${name}`);
      }
      await recordCall(state,{tool:name,ok:true,durationMs:Date.now()-started,argsSummary:Object.keys(args||{})});
      return result;
    } catch (e) {
      ok=false; await recordCall(state,{tool:name,ok:false,durationMs:Date.now()-started,error:String(e.message||e),argsSummary:Object.keys(args||{})}); throw e;
    }
  };
  return callTool;
}
