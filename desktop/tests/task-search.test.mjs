import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createToolHandler} from '../src/tools.mjs';
import {createRuntimeState} from '../src/state.mjs';
import {IndexedJsonl,tailJsonl} from '../src/indexed-jsonl.mjs';
import {toolDefinitions} from '../src/tool-definitions.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function fixture(){const root=await fs.mkdtemp(path.join(os.tmpdir(),'cc074-')),work=path.join(root,'work');await fs.mkdir(work);const config={allowedRoots:[work],enableShell:true,enableGuiAutomation:false,searchIgnore:[],defaultShell:process.platform==='win32'?'powershell':'/bin/bash'},state=createRuntimeState(root);const call=createToolHandler({config,configPath:path.join(root,'config.json'),state});return {root,work,config,state,call};}
async function settle(state,id){const task=await state.tasks.get(id);await task._run;return task;}
await test('all baseline names preserved plus task and native status tools',()=>{
 const expected='list_devices who_am_i ping get_system_info get_config set_config_value read_file read_multiple_files write_file edit_block write_pdf create_directory list_directory get_file_info copy_file move_file trash_path open_path start_search get_more_search_results list_searches stop_search start_process read_process_output interact_with_process list_sessions force_terminate list_processes kill_process computer_displays computer_windows computer_cursor computer_observe computer_screenshot computer_move_mouse computer_click computer_double_click computer_drag computer_scroll computer_keypress computer_hotkey computer_type computer_wait computer_actions computer_focus_window computer_window_state computer_close_window computer_clipboard_read computer_clipboard_write computer_click_ui_element computer_find_ui_elements get_recent_tool_calls get_usage_stats shutdown run_task get_task list_tasks cancel_task resume_task get_computer_link_status get_computer_link_session_status'.split(' ');
 assert.deepEqual(toolDefinitions().map(x=>x.name).sort(),expected.sort());
});
await test('durable read-edit-verify task passes prior SHA result safely',async()=>{
 const {call,work,state,root}=await fixture(),file=path.join(work,'file.txt');await fs.writeFile(file,'before');
 const task=await call('run_task',{title:'Read, edit, verify',steps:[{id:'read',tool:'read_file',args:{path:file}},{id:'write',tool:'write_file',args:{path:file,content:'after',expected_sha256:{$result:'read/sha256'}}},{id:'verify',tool:'read_file',args:{path:file}}]});
 assert.equal((await settle(state,task.id)).status,'completed');assert.equal(await fs.readFile(file,'utf8'),'after');const detail=await call('get_task',{task_id:task.id});assert.equal(detail.steps[2].result.content,'after');
 const recovered=createRuntimeState(root),call2=createToolHandler({config:{allowedRoots:[work]},state:recovered});assert.equal((await call2('get_task',{task_id:task.id})).completed,3);
});
await test('entire static plan is validated before any mutation',async()=>{
 const {call,work}=await fixture(),file=path.join(work,'untouched');
 await assert.rejects(call('run_task',{steps:[{tool:'write_file',args:{path:file,content:'bad'}},{tool:'write_file',args:{path:file,content:77}}]}),/invalid content/);
 await assert.rejects(fs.stat(file));
});
await test('administrative tool cannot be smuggled into plan',async()=>{const {call}=await fixture();for(const tool of ['set_config_value','shutdown','run_task','resume_task'])await assert.rejects(call('run_task',{steps:[{tool,args:{}}]}),/administrative/);});
await test('forward references and duplicate IDs rejected up front',async()=>{const {call}=await fixture();await assert.rejects(call('run_task',{steps:[{id:'a',tool:'read_file',args:{path:{$result:'b/path'}}},{id:'b',tool:'ping',args:{}}]}),/preceding/);await assert.rejects(call('run_task',{steps:[{id:'a',tool:'ping',args:{}},{id:'a',tool:'ping',args:{}}]}),/unique/);});
await test('failure stops following steps and resume never reruns completed append',async()=>{
 const {call,work,state}=await fixture(),first=path.join(work,'once'),missing=path.join(work,'missing'),last=path.join(work,'last');
 const t=await call('run_task',{steps:[{tool:'write_file',args:{path:first,content:'once',mode:'append'}},{tool:'read_file',args:{path:missing}},{tool:'write_file',args:{path:last,content:'done'}}]});
 assert.equal((await settle(state,t.id)).status,'failed');await assert.rejects(fs.stat(last));await assert.rejects(call('resume_task',{task_id:t.id}),/retry_failed/);await fs.writeFile(missing,'fixed');
 await Promise.all(Array.from({length:12},()=>call('resume_task',{task_id:t.id,retry_failed:true})));assert.equal((await settle(state,t.id)).status,'completed');assert.equal(await fs.readFile(first,'utf8'),'once');assert.equal(await fs.readFile(last,'utf8'),'done');
});
await test('permission revocation pauses between steps and retains completed output',async()=>{
 const {call,state,work}=await fixture();let checks=0;const c={owner:'chat:a',canContinue:()=>{if(++checks>2)throw new Error('Access revoked');}};
 const t=await call('run_task',{steps:[{tool:'write_file',args:{path:path.join(work,'one'),content:'yes'}},{tool:'write_file',args:{path:path.join(work,'two'),content:'no'}}]},c);
 assert.equal((await settle(state,t.id)).status,'paused');await assert.rejects(fs.stat(path.join(work,'two')));assert.equal(await fs.readFile(path.join(work,'one'),'utf8'),'yes');
});
await test('other chat/remote owners cannot inspect, cancel or resume task',async()=>{const {call,state}=await fixture();const t=await call('run_task',{steps:[{tool:'ping',args:{}}]},{owner:'chat:a'});await settle(state,t.id);for(const tool of ['get_task','cancel_task','resume_task'])await assert.rejects(call(tool,{task_id:t.id},{owner:'chat:b'}),/another connection/);assert.deepEqual((await call('list_tasks',{}, {owner:'remote:b'})).tasks,[]);});
await test('interrupted operation is uncertain, not silently replayed on restart',async()=>{
 const {call,state,root,config}=await fixture();const t=await call('run_task',{steps:[{id:'a',tool:'ping',args:{}}]},{owner:'chat:a'});await settle(state,t.id);const file=path.join(root,'tasks',t.id+'.json');const persisted=JSON.parse(await fs.readFile(file));persisted.status='running';persisted.steps[0].status='running';await fs.writeFile(file,JSON.stringify(persisted));
 const state2=createRuntimeState(root),call2=createToolHandler({config,state:state2});assert.equal((await call2('get_task',{task_id:t.id})).status,'interrupted');await assert.rejects(call2('resume_task',{task_id:t.id,retry_failed:true},{owner:'chat:a'}),/uncertain/);
 await call2('resume_task',{task_id:t.id,resolve_uncertain:'accept-completed'});assert.equal((await settle(state2,t.id)).status,'completed');
});
await test('wait_for_exit catches command exit and prevents next mutation',async()=>{const {call,state,work}=await fixture();const t=await call('run_task',{steps:[{tool:'start_process',wait_for_exit:true,args:{command:'exit 7',cwd:work}},{tool:'write_file',args:{path:path.join(work,'no'),content:'no'}}]});const job=await settle(state,t.id);assert.equal(job.status,'failed');assert.equal(job.steps[0].result.exit_code,7);await assert.rejects(fs.stat(path.join(work,'no')));});
await test('cancel stops waiting child and prevents next step',async()=>{const {call,state,work}=await fixture();const t=await call('run_task',{steps:[{tool:'start_process',wait_for_exit:true,args:{command:process.platform==='win32'?'Start-Sleep -Seconds 30':'sleep 30',cwd:work}},{tool:'ping',args:{}}]});const task=await state.tasks.get(t.id);for(let n=0;n<100&&task.steps[0].status!=='waiting';n++)await sleep(10);await call('cancel_task',{task_id:t.id});assert.equal((await settle(state,t.id)).status,'cancelled');assert.equal(task.steps[1].status,'pending');});
await test('Emergency Lock refuses starting or resuming plans',async()=>{const {call,config}=await fixture();config.emergencyLock=true;await assert.rejects(call('run_task',{steps:[{tool:'ping',args:{}}]}),/Emergency Lock/);});
await test('indexed pagination is exact across Unicode, page boundaries and restart',async()=>{const {root}=await fixture();const file=path.join(root,'rows.jsonl'),store=await new IndexedJsonl(file).create();const rows=Array.from({length:4099},(_,i)=>({path:`file-${i}-\u00e9`,excerpt:'hello'}));await store.append(rows);const recovered=await new IndexedJsonl(file).reopen();let actual=[];for(let i=0;i<rows.length;i+=127)actual.push(...(await recovered.page(i,127)).results);assert.deepEqual(actual,rows);assert.equal((await recovered.page(99999,100)).results.length,0);});
await test('search scans files larger than old 16 MB cutoff and survives restart',async()=>{
 const {call,config,work,state,root}=await fixture();await fs.writeFile(path.join(work,'large.txt'),'x'.repeat(17*1024*1024)+'needle');await fs.writeFile(path.join(work,'binary.dat'),Buffer.from([110,101,101,100,108,101,0]));
 const search=await call('start_search',{path:work,query:'needle',mode:'content'});await state.searches.get(search.search_id).promise;const result=await call('get_more_search_results',{search_id:search.search_id});assert.equal(result.status,'complete');assert.equal(result.results.length,1);assert.equal(result.skipped_binary,1);
 const call2=createToolHandler({config,state:createRuntimeState(root)});assert.equal((await call2('get_more_search_results',{search_id:search.search_id})).results.length,1);
 config.allowedRoots=[];await assert.rejects(call2('get_more_search_results',{search_id:search.search_id}),/outside allowed/);
});
await test('search reports inaccessible root, does not falsely declare complete',async()=>{const {call,state,work}=await fixture();const t=await call('start_search',{path:path.join(work,'missing'),query:'x'});await state.searches.get(t.search_id).promise;const result=await call('get_more_search_results',{search_id:t.search_id});assert.equal(result.status,'partial');assert.equal(result.errors.length,1);});
await test('literal search finds cross-chunk match',async()=>{const {call,state,work}=await fixture();await fs.writeFile(path.join(work,'boundary.txt'),'x'.repeat(65534)+'needle-end');const t=await call('start_search',{path:work,query:'needle',mode:'content'});await state.searches.get(t.search_id).promise;assert.equal((await call('get_more_search_results',{search_id:t.search_id})).count,1);});
await test('tail reader returns exact last records without whole log parsing',async()=>{const {root}=await fixture(),file=path.join(root,'log.jsonl');const rows=Array.from({length:5000},(_,i)=>({i,text:'\u00e9'.repeat(50)}));await fs.writeFile(file,rows.map(r=>JSON.stringify(r)+'\n').join(''));assert.deepEqual(await tailJsonl(file,30),rows.slice(-30));});
await test('task command captures all partial output without consuming terminal reader',async()=>{
 const {call,state,work}=await fixture();const command=process.platform==='win32'?"Write-Output 'first'; Start-Sleep -Milliseconds 200; Write-Output 'last'":"printf first; sleep .2; printf last";
 const t=await call('run_task',{steps:[{tool:'start_process',wait_for_exit:true,args:{command,cwd:work}}]});const job=await settle(state,t.id);assert.equal(job.status,'completed');assert.match(job.steps[0].result.output,/first[\s\S]*last/);
 const ui=await call('read_process_output',{session_id:job.steps[0].result.session_id});assert.match(ui.output,/first[\s\S]*last/);
});
await test('tail reader ignores an unfinished append without losing complete records',async()=>{const {root}=await fixture(),file=path.join(root,'partial.jsonl');await fs.writeFile(file,'{"a":1}\n{"a":2}\n{"a":');assert.deepEqual(await tailJsonl(file,2),[{a:1},{a:2}]);});
await test('failed checkpoint after an action is uncertain, never blindly retryable',async()=>{
 const {call,state,work}=await fixture();await state.tasks.load();const original=state.tasks.save.bind(state.tasks);let saves=0;
 state.tasks.save=async task=>{if(++saves===3)throw new Error('Simulated disk failure after action');return original(task);};
 const t=await call('run_task',{steps:[{tool:'write_file',args:{path:path.join(work,'once'),content:'once',mode:'append'}}]});
 const result=await settle(state,t.id);assert.equal(result.status,'interrupted');assert.equal(result.steps[0].status,'uncertain');assert.equal(await fs.readFile(path.join(work,'once'),'utf8'),'once');
 await assert.rejects(call('resume_task',{task_id:t.id,retry_failed:true}),/uncertain/);
});
await test('search recovery discards only uncommitted data/index tails',async()=>{const {root}=await fixture();const file=path.join(root,'crash.jsonl'),store=await new IndexedJsonl(file).create();await store.append([{row:1},{row:2}]);await fs.appendFile(file,'{"orphan":3}\n');await fs.appendFile(file+'.idx',Buffer.alloc(3));const recovered=await new IndexedJsonl(file).reopen();assert.deepEqual((await recovered.page(0,100)).results,[{row:1},{row:2}]);await recovered.append([{row:4}]);assert.deepEqual((await recovered.page(0,100)).results,[{row:1},{row:2},{row:4}]);});
await test('task attachments remain deliverable and nested metadata survives journaling',async()=>{
 const {TaskRunner}=await import('../src/task-runner.mjs'),{state,root}=await fixture();const runner=new TaskRunner({state,definitions:()=>[{name:'capture',inputSchema:{required:[]}}],callTool:async()=>({_keep:'value',_attachments:[{name:'screen.png',mimeType:'image/png',base64:'aGVsbG8='}]})});
 const t=await runner.start({steps:[{id:'screen',tool:'capture',args:{}}]});await runner.jobs.get(t.id)._run;const detail=await runner.detail({task_id:t.id});assert.equal(detail._attachments[0].base64,'aGVsbG8=');assert.deepEqual(detail.steps[0].attachment_indices,[0]);assert.equal(detail.steps[0].result._keep,'value');const disk=JSON.parse(await fs.readFile(path.join(root,'tasks',t.id+'.json')));assert.equal(disk.steps[0].result._keep,'value');assert.equal(disk.steps[0].result._attachments.length,1);
});
