//! Tray-owned process containment. Not an adoption API for host-owned processes.
//! No credentials, inherited handles, shell command, persistent registration or relaunch.
use std::{ffi::c_void, io, mem, os::windows::ffi::OsStrExt, path::Path, ptr};
type H = *mut c_void;
#[repr(C)] struct Startup { size:u32, reserved:*mut u16, desktop:*mut u16, title:*mut u16, x:u32,y:u32,xsize:u32,ysize:u32,xchars:u32,ychars:u32,fill:u32,flags:u32,show:u16,reserved2:u16,bytes:*mut u8,input:H,output:H,error:H }
#[repr(C)] struct ExtendedStartup { base:Startup, attributes:*mut c_void }
#[repr(C)] struct Process { process:H,thread:H,pid:u32,tid:u32 }
#[repr(C)] struct BasicLimit { process_time:i64,job_time:i64,flags:u32,min:usize,max:usize,active:u32,affinity:usize,priority:u32,scheduling:u32 }
#[repr(C)] struct Accounting { times:[i64;4], faults:u32, total:u32, active:u32, terminated:u32 }
#[repr(C)] struct IoCounters { read_ops:u64,write_ops:u64,other_ops:u64,read_bytes:u64,write_bytes:u64,other_bytes:u64 }
#[repr(C)] struct ExtendedLimit { basic:BasicLimit,io:IoCounters,process_memory:usize,job_memory:usize,peak_process:usize,peak_job:usize }
#[link(name="kernel32")] unsafe extern "system" {
 fn CreateJobObjectW(attrs:*const c_void,name:*const u16)->H;
 fn SetInformationJobObject(job:H,class:u32,info:*const c_void,size:u32)->i32;
 fn QueryInformationJobObject(job:H,class:u32,info:*mut c_void,size:u32,length:*mut u32)->i32;
 fn CreateProcessW(app:*const u16,cmd:*mut u16,pa:*const c_void,ta:*const c_void,inherit:i32,flags:u32,env:*const c_void,cwd:*const u16,start:*const Startup,process:*mut Process)->i32;
 fn AssignProcessToJobObject(job:H,process:H)->i32;
 fn ResumeThread(thread:H)->u32;
 fn TerminateProcess(process:H,code:u32)->i32;
 fn TerminateJobObject(job:H,code:u32)->i32;
 fn WaitForSingleObject(handle:H,ms:u32)->u32;
 fn CloseHandle(handle:H)->i32;
}
struct Handle(H);
impl Drop for Handle { fn drop(&mut self) { unsafe { CloseHandle(self.0); } } }
/// Owns only a newly created worker, never an existing client/browser/host.
/// Closing the job kills all descendants, including when the tray process exits.
/// No automatic restart: after stop this value cannot launch anything.
pub struct OwnedWorker { job:Handle, process:Handle, pid:u32, stopped:bool }
impl OwnedWorker {
 /// Start a fixed trusted executable suspended, contain it BEFORE any code executes,
 /// then resume. Arguments use Windows CRT quoting; no shell is invoked.
 /// This primitive deliberately has no stdio inheritance. MCP pipe routing and
 /// destination-aware consent must be designed before using it for a live bridge.
 pub fn launch(executable:&Path,args:&[String])->io::Result<Self> {
  Self::launch_inner(executable,args,None)
 }
 /// Internal local-only status session. No snapshot authority or external host.
 pub(crate) fn launch_status_stdio(executable:&Path)->io::Result<(Self, super::stdio_pipe::LocalStdio)> {
  let mut pipes=super::stdio_pipe::Pipes::new()?;
  let worker=Self::launch_inner(executable,&["--status-only".into()],Some(&mut pipes))?;
  Ok((worker,pipes.into_parent()))
 }
 fn launch_inner(executable:&Path,args:&[String],mut pipes:Option<&mut super::stdio_pipe::Pipes>)->io::Result<Self> {
  if !executable.is_absolute() { return Err(io::Error::other("absolute worker executable required")); }
  let app=wide(executable.as_os_str())?;
  let mut command=quote(executable.as_os_str())?;
  for arg in args { command.push(32); command.extend(quote(std::ffi::OsStr::new(arg))?); }
  command.push(0);
  if command.len()>32767 { return Err(io::Error::other("worker command too long")); }
  unsafe {
   let job=CreateJobObjectW(ptr::null(),ptr::null()); if job.is_null(){return Err(io::Error::last_os_error())} let job=Handle(job);
   let mut limits:ExtendedLimit=mem::zeroed(); limits.basic.flags=0x2000; // KILL_ON_JOB_CLOSE; no breakaway
   if SetInformationJobObject(job.0,9,&limits as *const _ as _,mem::size_of_val(&limits) as u32)==0 { return Err(io::Error::last_os_error()); }
   let mut startup:Startup=mem::zeroed(); startup.size=mem::size_of_val(&startup) as u32;
   let mut extended;
   let (start,inherit,flags)=if let Some(p)=pipes.as_mut(){
    extended=ExtendedStartup{base:startup,attributes:p.attributes()};
    extended.base.size=mem::size_of::<ExtendedStartup>() as u32;extended.base.flags=0x100;
    let handles=p.child_handles();extended.base.input=handles[0];extended.base.output=handles[1];extended.base.error=handles[2];
    (&extended.base as *const Startup,1,0x08080004)
   }else{(&startup as *const Startup,0,0x08000004)};
   let mut p:Process=mem::zeroed();
   if CreateProcessW(app.as_ptr(),command.as_mut_ptr(),ptr::null(),ptr::null(),inherit,flags,ptr::null(),ptr::null(),start,&mut p)==0{return Err(io::Error::last_os_error())}
   let process=Handle(p.process); let thread=Handle(p.thread);
   if AssignProcessToJobObject(job.0,process.0)==0 {
    let error=io::Error::last_os_error();
    if TerminateProcess(process.0,1)==0 || WaitForSingleObject(process.0,2000)!=0 {return Err(io::Error::other("uncontained worker cleanup unconfirmed; owner must remain fenced"))}
    return Err(error);
   }
   if ResumeThread(thread.0)==u32::MAX {
    let error=io::Error::last_os_error();
    if TerminateJobObject(job.0,1)==0 || WaitForSingleObject(process.0,2000)!=0 {return Err(io::Error::other("contained worker cleanup unconfirmed; owner must remain fenced"))}
    return Err(error);
   }
   Ok(Self{job,process,pid:p.pid,stopped:false})
  }
 }
 /// Idempotent bounded cleanup. Failure must fence the owner from new launches.
 pub fn stop(&mut self)->io::Result<()> {
  if self.stopped {return Ok(())}
  unsafe {
   if TerminateJobObject(self.job.0,0)==0 {return Err(io::Error::last_os_error())}
   let deadline=std::time::Instant::now()+std::time::Duration::from_secs(2);
   loop {
    let mut accounting:Accounting=mem::zeroed();
    if QueryInformationJobObject(self.job.0,1,&mut accounting as *mut _ as _,mem::size_of_val(&accounting) as u32,ptr::null_mut())==0{return Err(io::Error::last_os_error())}
    if accounting.active==0 && WaitForSingleObject(self.process.0,0)==0 {break}
    if std::time::Instant::now()>=deadline{return Err(io::Error::other("owned worker shutdown unconfirmed"))}
    std::thread::sleep(std::time::Duration::from_millis(5));
   }
  }
  self.stopped=true; Ok(())
 }
 /// One bounded wait on a duplicated process handle; no periodic UI polling.
 /// Callback reports exit, timeout, or wait failure without any child output.
 pub fn notify_exit<F>(&self, finished:F)->io::Result<()> where F:FnOnce(io::Result<u32>)+Send+'static {
  self.notify_exit_after(65000,finished)
 }
 /// Event-driven live-session wait, released by process exit or Job termination.
 /// Unlike the finite diagnostic, a healthy interactive session has no idle timeout.
 pub fn notify_lifetime<F>(&self,finished:F)->io::Result<()> where F:FnOnce(io::Result<u32>)+Send+'static {
  self.notify_exit_after(u32::MAX,finished)
 }
 fn notify_exit_after<F>(&self,timeout:u32,finished:F)->io::Result<()> where F:FnOnce(io::Result<u32>)+Send+'static {
  unsafe extern "system" {fn GetCurrentProcess()->H;fn DuplicateHandle(source:H,handle:H,target:H,result:*mut H,access:u32,inherit:i32,options:u32)->i32;fn GetExitCodeProcess(process:H,code:*mut u32)->i32;}
  let mut observed=ptr::null_mut();
  unsafe{let me=GetCurrentProcess();if DuplicateHandle(me,self.process.0,me,&mut observed,0,0,2)==0{return Err(io::Error::last_os_error())}}
  // Transfer sole ownership to the waiting thread. The child remains Job-owned.
  let observed=Handle(observed);let raw=observed.0 as usize;
  match std::thread::Builder::new().name("computer-link-probe-completion".into()).spawn(move||{
   let handle=Handle(raw as H);let wait=unsafe{WaitForSingleObject(handle.0,timeout)};
   let mut code=0;let result=if wait==0&&unsafe{GetExitCodeProcess(handle.0,&mut code)}!=0{Ok(code)}else{Err(io::Error::other("local probe completion unconfirmed"))};finished(result);
  }) {Ok(_)=>{std::mem::forget(observed);Ok(())},Err(e)=>Err(e)}
 }
 pub fn pid(&self)->u32 {self.pid}
 pub fn exit_code(&self)->io::Result<Option<u32>> {
  if self.is_running(){return Ok(None)}
  unsafe extern "system" {fn GetExitCodeProcess(process:H,code:*mut u32)->i32;}
  let mut code=0;if unsafe{GetExitCodeProcess(self.process.0,&mut code)}==0{return Err(io::Error::last_os_error())}Ok(Some(code))
 }
 pub fn is_running(&self)->bool {unsafe {WaitForSingleObject(self.process.0,0)==0x102}}
}
impl Drop for OwnedWorker {fn drop(&mut self){let _=self.stop();}}
fn wide(s:&std::ffi::OsStr)->io::Result<Vec<u16>> {let mut v:Vec<_>=s.encode_wide().collect();if v.contains(&0){return Err(io::Error::other("NUL in worker argument"))}v.push(0);Ok(v)}
fn quote(s:&std::ffi::OsStr)->io::Result<Vec<u16>> {
 let mut v=wide(s)?;v.pop(); let mut out=vec![34]; let mut slash=0;
 for c in v {if c==92{slash+=1;continue} if c==34 {out.extend(std::iter::repeat_n(92,slash*2+1));}else{out.extend(std::iter::repeat_n(92,slash));}slash=0;out.push(c);}
 out.extend(std::iter::repeat_n(92,slash*2));out.push(34);Ok(out)
}
#[cfg(test)] mod tests {
 use super::*;
 #[repr(C)]struct Security{size:u32,descriptor:*mut c_void,inherit:i32}
 unsafe extern "system"{fn CreateEventW(attrs:*const Security,manual:i32,initial:i32,name:*const u16)->H;}
 #[test] fn worker_argument_quoting_and_rejection(){
  let q=|s:&str|String::from_utf16(&quote(std::ffi::OsStr::new(s)).unwrap()).unwrap();
  assert_eq!(q(""),"\"\"");assert_eq!(q("a b"),"\"a b\"");assert_eq!(q("a\\"),"\"a\\\\\"");assert_eq!(q("a\"b"),"\"a\\\"b\"");assert!(quote(std::ffi::OsStr::new("a\0b")).is_err());
  assert!(OwnedWorker::launch(Path::new("relative.exe"),&[]).is_err());
 }
 // Uses this test executable, never a shell or an installed user application.
 #[test] fn owned_worker_stops_and_drop_kills(){
  // No environment mutation: a fresh test invocation has one ignored fixture.
  let exe=std::env::current_exe().unwrap();
  let args=vec!["--exact".into(),"owned_worker::tests::sleep_fixture".into(),"--ignored".into()];
  let mut worker=OwnedWorker::launch(&exe,&args).unwrap();assert!(worker.is_running());worker.stop().unwrap();assert!(!worker.is_running());worker.stop().unwrap();
  let worker=OwnedWorker::launch(&exe,&args).unwrap();assert!(worker.is_running());
  // Keep a separately duplicated process handle to observe actual Drop termination.
  unsafe extern "system"{fn GetCurrentProcess()->H;fn DuplicateHandle(source:H,handle:H,target:H,result:*mut H,access:u32,inherit:i32,options:u32)->i32;}
  let mut observed=ptr::null_mut();unsafe{let me=GetCurrentProcess();assert_ne!(DuplicateHandle(me,worker.process.0,me,&mut observed,0,0,2),0);}let observed=Handle(observed);
  drop(worker);assert_eq!(unsafe{WaitForSingleObject(observed.0,2000)},0);
 }
 #[test] fn descendants_stop_but_unrelated_worker_survives(){
  let exe=std::env::current_exe().unwrap();
  let args=|name:&str|vec!["--exact".into(),format!("owned_worker::tests::{name}"),"--ignored".into()];
  let mut unrelated=OwnedWorker::launch(&exe,&args("sleep_fixture")).unwrap();
  let mut tree=OwnedWorker::launch(&exe,&args("branch_fixture")).unwrap();
  let deadline=std::time::Instant::now()+std::time::Duration::from_secs(5);
  loop{let mut a:Accounting=unsafe{mem::zeroed()};assert_ne!(unsafe{QueryInformationJobObject(tree.job.0,1,&mut a as *mut _ as _,mem::size_of_val(&a) as u32,ptr::null_mut())},0);
   if a.active>=2{break}assert!(std::time::Instant::now()<deadline,"child did not start");std::thread::sleep(std::time::Duration::from_millis(5));
  }
  tree.stop().unwrap();assert!(!tree.is_running());assert!(unrelated.is_running());unrelated.stop().unwrap();
 }
 #[test] fn stdio_handle_list_excludes_unrelated_inheritable_handle(){
  use std::io::Write;
  let attrs=Security{size:mem::size_of::<Security>() as u32,descriptor:ptr::null_mut(),inherit:1};
  let name=format!("Local\\computer-link-handle-test-{}-{}",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos());
  let name_wide=wide(std::ffi::OsStr::new(&name)).unwrap();
  let event=Handle(unsafe{CreateEventW(&attrs,1,0,name_wide.as_ptr())});assert!(!event.0.is_null());
  let mut pipes=super::super::stdio_pipe::Pipes::new().unwrap();
  let args=vec!["--exact".into(),"owned_worker::tests::handle_list_fixture".into(),"--ignored".into(),"--nocapture".into()];
  let mut worker=OwnedWorker::launch_inner(&std::env::current_exe().unwrap(),&args,Some(&mut pipes)).unwrap();
  let mut io=pipes.into_parent();writeln!(io.input,"{}\n{}",event.0 as usize,name).unwrap();drop(io.input);
  let wait=unsafe{WaitForSingleObject(worker.process.0,5000)};
  let output=handle_fixture_output(&mut io.output).unwrap_or_else(|error|format!("fixture output unavailable: {error}"));
  assert_eq!(wait,0,"handle fixture timed out; stdout: {output}");
  assert_eq!(worker.exit_code().unwrap(),Some(0),"handle fixture failed; stdout: {output}");
  assert!(output.lines().any(|line|line.trim()=="HANDLE_LIST_FIXTURE_OK"),"handle fixture did not confirm its assertion; stdout: {output}");
  worker.stop().unwrap();
 }
 // Read only the bytes already available. Never wait for pipe EOF after a failed
 // fixture or let diagnostic output turn the existing five-second wait unbounded.
 fn handle_fixture_output(output:&mut std::fs::File)->io::Result<String>{
  use std::{io::Read,os::windows::io::AsRawHandle};
  unsafe extern "system"{fn PeekNamedPipe(pipe:H,buffer:*mut c_void,size:u32,read:*mut u32,available:*mut u32,left:*mut u32)->i32;}
  let mut available=0;
  if unsafe{PeekNamedPipe(output.as_raw_handle(),ptr::null_mut(),0,ptr::null_mut(),&mut available,ptr::null_mut())}==0{
   let error=io::Error::last_os_error();
   if error.raw_os_error()==Some(109){return Ok(String::new())}
   return Err(error);
  }
  let mut bytes=vec![0;available.min(8192) as usize];output.read_exact(&mut bytes)?;
  let mut text=String::from_utf8_lossy(&bytes).into_owned();
  if available>8192{text.push_str("\n[fixture diagnostic exceeded 8192 bytes]")}
  Ok(text)
 }
 #[test] #[ignore] fn handle_list_fixture(){
  use std::io::Write;
  // Production stderr remains NUL. This isolated test child reports its panic
  // through its explicit stdout pipe, then resumes unwinding with the same error.
  let result=std::panic::catch_unwind(assert_handle_list_exclusion);
  let mut output=std::io::stdout().lock();
  match result{
   Ok(())=>{let _=writeln!(output,"\nHANDLE_LIST_FIXTURE_OK");let _=output.flush();},
   Err(payload)=>{
    let message=payload.downcast_ref::<String>().map(String::as_str).or_else(||payload.downcast_ref::<&str>().copied()).unwrap_or("non-string panic payload");
    let _=writeln!(output,"\nHANDLE_LIST_FIXTURE_FAILED: {message}");let _=output.flush();drop(output);
    std::panic::resume_unwind(payload);
   }
  }
 }
 fn assert_handle_list_exclusion(){
  let mut value=String::new();std::io::stdin().read_line(&mut value).expect("read parent event handle");
  let handle=value.trim().parse::<usize>().expect("parse parent event handle") as H;
  let mut name=String::new();std::io::stdin().read_line(&mut name).expect("read parent event name");
  // Inspect the actual inherited slot before a positive control can open the
  // canary into that otherwise-free slot and create a false inheritance report.
  assert!(!handle_refers_to_named_event(handle,name.trim()).expect("compare candidate event identity"),"unrelated inheritable event leaked");
  unsafe extern "system"{fn OpenEventW(access:u32,inherit:i32,name:*const u16)->H;fn GetCurrentProcess()->H;}
  let named=wide(std::ffi::OsStr::new(name.trim())).unwrap();
  let canary=Handle(unsafe{OpenEventW(0x100000,0,named.as_ptr())});assert!(!canary.0.is_null());
  // The same oracle must identify a real same-event handle. A different event,
  // a different object type, and an invalid handle must not match the canary.
  assert!(handle_refers_to_named_event(canary.0,name.trim()).unwrap(),"identity oracle missed the actual canary");
  let different=Handle(unsafe{CreateEventW(ptr::null(),1,0,ptr::null())});assert!(!different.0.is_null());
  assert!(!handle_refers_to_named_event(different.0,name.trim()).unwrap(),"identity oracle matched a different event");
  assert!(!handle_refers_to_named_event(unsafe{GetCurrentProcess()},name.trim()).unwrap(),"identity oracle matched a process");
  assert!(!handle_refers_to_named_event(ptr::null_mut(),name.trim()).unwrap(),"identity oracle matched an invalid handle");
  let vacant=different.0;drop(different);
  assert!(!handle_refers_to_named_event(vacant,name.trim()).unwrap(),"identity oracle confused an opened reference with an inherited handle");
 }
 fn handle_refers_to_named_event(candidate:H,name:&str)->io::Result<bool>{
  unsafe extern "system"{fn OpenEventW(access:u32,inherit:i32,name:*const u16)->H;fn GetModuleHandleW(name:*const u16)->H;fn GetProcAddress(module:H,name:*const u8)->*mut c_void;fn SetLastError(code:u32);}
  // The documented export exists on supported Windows, but SDKs need not ship
  // kernelbase.lib. Resolve only this already-loaded system module; no loading.
  let module_name=wide(std::ffi::OsStr::new("kernelbase.dll"))?;
  let module=unsafe{GetModuleHandleW(module_name.as_ptr())};if module.is_null(){return Err(io::Error::last_os_error())}
  let address=unsafe{GetProcAddress(module,b"CompareObjectHandles\0".as_ptr())};if address.is_null(){return Err(io::Error::last_os_error())}
  let compare:unsafe extern "system" fn(H,H)->i32=unsafe{mem::transmute(address)};
  let name=wide(std::ffi::OsStr::new(name))?;
  let known=Handle(unsafe{OpenEventW(0x100000,0,name.as_ptr())});if known.0.is_null(){return Err(io::Error::last_os_error())}
  // OpenEvent cannot replace a live handle. If it allocated the probed number,
  // that slot was free; this newly opened reference is not an inherited leak.
  if known.0==candidate{return Ok(false)}
  // Startup can reuse the old number for an object that cannot be duplicated
  // (observed ERROR_NOT_SUPPORTED). Compare identity directly without requiring
  // object-specific access or assuming arbitrary handle types support duplication.
  unsafe{SetLastError(0)};
  let same=unsafe{compare(candidate,known.0)};
  let error=io::Error::last_os_error();
  if same!=0{return Ok(true)}
  match error.raw_os_error(){
   Some(6|1656)=>Ok(false), // ERROR_INVALID_HANDLE or ERROR_NOT_SAME_OBJECT
   _=>Err(io::Error::other(format!("CompareObjectHandles failed for {candidate:p}: {error}"))),
  }
 }
 #[test] #[ignore] fn branch_fixture(){
  let mut child=std::process::Command::new(std::env::current_exe().unwrap()).args(["--exact","owned_worker::tests::sleep_fixture","--ignored"]).spawn().unwrap();
  let _=child.wait();
 }
 #[test] #[ignore] fn sleep_fixture(){std::thread::sleep(std::time::Duration::from_secs(30));}
}
