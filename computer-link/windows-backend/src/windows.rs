use std::{rc::Rc,ffi::{c_void,OsStr},io,mem::{size_of,zeroed},os::windows::ffi::OsStrExt,path::{Path,PathBuf},ptr::{null,null_mut},thread,time::{Duration,Instant}};
type Handle=*mut c_void;
#[repr(C)] struct BasicLimit{process_time:i64,job_time:i64,flags:u32,min_ws:usize,max_ws:usize,active_limit:u32,affinity:usize,priority:u32,scheduling:u32}
#[repr(C)] struct IoCounters{read_ops:u64,write_ops:u64,other_ops:u64,read_bytes:u64,write_bytes:u64,other_bytes:u64}
#[repr(C)] struct ExtendedLimit{basic:BasicLimit,io:IoCounters,process_mem:usize,job_mem:usize,peak_process:usize,peak_job:usize}
#[repr(C)] struct Accounting{user:i64,kernel:i64,period_user:i64,period_kernel:i64,page_faults:u32,total:u32,active:u32,terminated:u32}
#[repr(C)] struct Startup{cb:u32,reserved:*mut u16,desktop:*mut u16,title:*mut u16,x:u32,y:u32,xsize:u32,ysize:u32,xchars:u32,ychars:u32,fill:u32,flags:u32,show:u16,reserved_size:u16,reserved_ptr:*mut u8,input:Handle,output:Handle,error:Handle}
#[repr(C)] struct StartupEx{startup:Startup,attributes:*mut c_void}
#[repr(C)] struct ProcessInfo{process:Handle,thread:Handle,pid:u32,tid:u32}
#[link(name="kernel32")] unsafe extern "system"{
 fn CreateJobObjectW(attrs:*const c_void,name:*const u16)->Handle;
 fn SetInformationJobObject(job:Handle,class:i32,info:*const c_void,len:u32)->i32;
 fn QueryInformationJobObject(job:Handle,class:i32,info:*mut c_void,len:u32,returned:*mut u32)->i32;
 fn InitializeProcThreadAttributeList(list:*mut c_void,count:u32,flags:u32,size:*mut usize)->i32;
 fn UpdateProcThreadAttribute(list:*mut c_void,flags:u32,attribute:usize,value:*mut c_void,size:usize,previous:*mut c_void,returned:*mut usize)->i32;
 fn DeleteProcThreadAttributeList(list:*mut c_void);
 fn GetWindowsDirectoryW(buffer:*mut u16,size:u32)->u32;
 fn TerminateJobObject(job:Handle,code:u32)->i32;
 fn CloseHandle(handle:Handle)->i32;
 fn CreateProcessW(app:*const u16,command:*mut u16,pa:*const c_void,ta:*const c_void,inherit:i32,flags:u32,env:*const c_void,cwd:*const u16,startup:*const Startup,info:*mut ProcessInfo)->i32;
 fn WaitForSingleObject(handle:Handle,millis:u32)->u32;
 fn GetExitCodeProcess(handle:Handle,code:*mut u32)->i32;
}
struct Owned(Handle); impl Drop for Owned{fn drop(&mut self){unsafe{CloseHandle(self.0);}}}
fn wide(s:&OsStr)->io::Result<Vec<u16>>{let mut v:Vec<_>=s.encode_wide().collect();if v.contains(&0){return Err(io::Error::other("NUL refused"))}v.push(0);Ok(v)}
// Quote using Windows CRT backslash/quote convention. No shell involved.
fn quote(s:&str)->String{let mut out=String::from("\"");let mut slashes=0;for c in s.chars(){if c=='\\'{slashes+=1;continue}if c=='"'{out.push_str(&"\\".repeat(slashes*2+1));out.push(c)}else{out.push_str(&"\\".repeat(slashes));out.push(c)}slashes=0;}out.push_str(&"\\".repeat(slashes*2));out.push('"');out}
pub struct Process{handle:Rc<Owned>,pub id:u32}
impl Process{pub fn exit_code(&self)->io::Result<Option<u32>>{if !self.has_exited()?{return Ok(None)}let mut code=0;if unsafe{GetExitCodeProcess(self.handle.0,&mut code)}==0{return Err(io::Error::last_os_error())}Ok(Some(code))}pub fn has_exited(&self)->io::Result<bool>{match unsafe{WaitForSingleObject(self.handle.0,0)}{0=>Ok(true),258=>Ok(false),_=>Err(io::Error::last_os_error())}}}
impl Process {
 /// Event-driven wait for the owned process. A timeout observes state without
 /// changing authority; the caller still owns explicit Job Object cleanup.
 pub fn wait(&self, timeout: Option<Duration>) -> io::Result<Option<u32>> {
  let millis = match timeout {
   None => u32::MAX,
   Some(value) => u32::try_from(value.as_millis()).ok().filter(|n| *n < u32::MAX).ok_or_else(||io::Error::other("wait duration out of range"))?,
  };
  match unsafe { WaitForSingleObject(self.handle.0, millis) } {
   0 => self.exit_code(), 258 => Ok(None), _ => Err(io::Error::last_os_error()),
  }
 }
}
pub struct Workers{job:Owned,stopping:bool,temp_dir:PathBuf,children:Vec<Rc<Owned>>}
impl Workers{
 pub fn new(temp_parent:&Path)->io::Result<Self>{
  if !temp_parent.is_absolute()||!temp_parent.is_dir(){return Err(io::Error::other("explicit trusted temp parent required"))}
  let stamp=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|_|io::Error::other("clock"))?.as_nanos();
  let temp_dir=temp_parent.join(format!("athena-owned-worker-{}-{stamp}",std::process::id()));
  std::fs::create_dir(&temp_dir)?;let temp_dir=temp_dir.canonicalize()?;
  unsafe{
  let h=CreateJobObjectW(null(),null());if h.is_null(){return Err(io::Error::last_os_error())}let job=Owned(h);
  let mut info:ExtendedLimit=zeroed();info.basic.flags=0x2000; // KILL_ON_JOB_CLOSE; no breakaway flags
  if SetInformationJobObject(job.0,9,&info as *const _ as _,size_of::<ExtendedLimit>() as u32)==0{return Err(io::Error::last_os_error())}
  Ok(Self{job,stopping:false,temp_dir,children:Vec::new()})
 }}
 /// Caller must authorize a trusted executable. No inherited handles or elevation.
 pub fn spawn(&mut self,exe:&Path,args:&[String],cwd:&Path)->io::Result<Process>{
  if self.stopping{return Err(io::Error::other("session stopping"))}
  if !exe.is_absolute()||!exe.is_file()||!cwd.is_absolute()||!cwd.is_dir(){return Err(io::Error::other("absolute trusted executable and explicit working directory required"))}
  let path=wide(exe.as_os_str())?;let cwd_w=wide(cwd.as_os_str())?;
  let text=exe.to_str().ok_or_else(||io::Error::other("non-Unicode executable unsupported"))?;
  let mut command=quote(text);for arg in args{command.push(' ');command.push_str(&quote(arg))}if command.len()>16000{return Err(io::Error::other("command bound"))}let mut command=wide(OsStr::new(&command))?;
  // Explicit minimal environment, never inherit parent's credentials/PATH.
  let mut system=vec![0u16;32768];let n=unsafe{GetWindowsDirectoryW(system.as_mut_ptr(),system.len() as u32)} as usize;
  if n==0||n>=system.len(){return Err(io::Error::other("Windows directory unavailable"))}
  system.truncate(n);let system=String::from_utf16(&system).map_err(|_|io::Error::other("Windows directory encoding"))?;
  if cwd.canonicalize()?==self.temp_dir{return Err(io::Error::other("working directory cannot be worker temp scope"))}
  let temp_text=self.temp_dir.to_str().ok_or_else(||io::Error::other("temp directory encoding"))?;
  let mut env=Vec::<u16>::new();for entry in [format!("SystemRoot={system}"),format!("TEMP={temp_text}"),format!("TMP={temp_text}")]{env.extend(entry.encode_utf16());env.push(0)}env.push(0);
  unsafe{
   let mut bytes=0usize;InitializeProcThreadAttributeList(null_mut(),1,0,&mut bytes);
   if bytes==0||bytes>65536{return Err(io::Error::other("attribute allocation bound"))}
   let mut storage=vec![0usize;bytes.div_ceil(size_of::<usize>())];let ptr=storage.as_mut_ptr() as *mut c_void;
   if InitializeProcThreadAttributeList(ptr,1,0,&mut bytes)==0{return Err(io::Error::last_os_error())}
   struct Attr(*mut c_void);impl Drop for Attr{fn drop(&mut self){unsafe{DeleteProcThreadAttributeList(self.0)}}}
   let mut job_handles=[self.job.0];let attr=Attr(ptr);
   // Windows10+ PROC_THREAD_ATTRIBUTE_JOB_LIST (ProcThreadAttributeValue(13,false,true,false)).
   if UpdateProcThreadAttribute(attr.0,0,0x0002000d,job_handles.as_mut_ptr() as _,size_of::<Handle>(),null_mut(),null_mut())==0{return Err(io::Error::last_os_error())}
   let mut si:StartupEx=zeroed();si.startup.cb=size_of::<StartupEx>() as u32;si.attributes=attr.0;let mut pi:ProcessInfo=zeroed();
   // Creation-time membership: no unowned suspended-child assignment/resume gap or fallback.
   if CreateProcessW(path.as_ptr(),command.as_mut_ptr(),null(),null(),0,0x00080000|0x00000400,env.as_ptr() as _,cwd_w.as_ptr(),&si.startup,&mut pi)==0{return Err(io::Error::last_os_error())}
   let process=Rc::new(Owned(pi.process));let _primary=Owned(pi.thread);
   self.children.push(Rc::clone(&process));
   Ok(Process{handle:process,id:pi.pid})
  }
 }
 pub fn temp_path(&self)->&Path{&self.temp_dir}
 pub fn active(&self)->io::Result<u32>{unsafe{let mut a:Accounting=zeroed();if QueryInformationJobObject(self.job.0,1,&mut a as *mut _ as _,size_of::<Accounting>() as u32,null_mut())==0{return Err(io::Error::last_os_error())}Ok(a.active)}}
 /// Fences new launches before terminating only this job; success requires observed zero workers.
 pub fn exit(&mut self)->io::Result<()>{self.stopping=true;if unsafe{TerminateJobObject(self.job.0,0)}==0{return Err(io::Error::last_os_error())}let until=Instant::now()+Duration::from_secs(3);loop{let mut signaled=true;for child in &self.children{match unsafe{WaitForSingleObject(child.0,0)}{0=>{},258=>signaled=false,_=>return Err(io::Error::last_os_error())}}if signaled&&self.active()?==0{return Ok(())}if Instant::now()>=until{return Err(io::Error::other("worker shutdown unconfirmed"))}thread::sleep(Duration::from_millis(10));}}
}
impl Drop for Workers{fn drop(&mut self){self.stopping=true;unsafe{TerminateJobObject(self.job.0,1);}}}
