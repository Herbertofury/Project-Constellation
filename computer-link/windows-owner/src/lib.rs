#![cfg(windows)]
pub mod window_inventory;
pub mod local_export_ui;
pub mod local_export_preview;
pub mod owned_worker;
pub mod stdio_pipe;
pub mod status_protocol;
pub mod folder_inventory;
pub mod browser_handoff;
use std::{io,thread::{self,JoinHandle},time::{Duration,Instant},path::Path,fs::OpenOptions,os::windows::fs::{OpenOptionsExt,MetadataExt},io::Read};
use computer_link_local_transport::{Server,Stop,PeerInfo};
#[path="../../windows-workspace/src/root_scope.rs"] mod root_scope;
/// Read a bounded immutable snapshot through a non-reparse single-link handle.
/// Trusted/quiescent local ancestors only; not a hostile filesystem sandbox.
pub fn snapshot(path:&Path)->io::Result<Vec<u8>>{
 let _pins=root_scope::pin_parents(path)?;
 let f=OpenOptions::new().read(true).share_mode(1).custom_flags(0x00200000).open(path)?;
 let m=f.metadata()?;if !m.is_file()||m.file_attributes()&0x400!=0||m.file_size()>4096{return Err(io::Error::other("bounded regular file required"))}
 // Handle link count uses the same Windows API as the independently tested workspace.
 #[repr(C)]struct Info{attrs:u32,times:[u32;6],volume:u32,high:u32,low:u32,links:u32,index:[u32;2]}
 unsafe extern "system"{fn GetFileInformationByHandle(h:*mut std::ffi::c_void,i:*mut Info)->i32;}
 use std::os::windows::io::AsRawHandle;
 let mut i:Info=unsafe{std::mem::zeroed()};if unsafe{GetFileInformationByHandle(f.as_raw_handle(),&mut i)}==0||i.links!=1{return Err(io::Error::other("single-link handle required"))}
 let mut b=vec![];f.take(4097).read_to_end(&mut b)?;if b.len()>4096||std::str::from_utf8(&b).is_err(){return Err(io::Error::other("bounded UTF8 text required"))}Ok(b)
}
pub struct Owner{owned_worker:Option<owned_worker::OwnedWorker>,active:Option<(Stop,JoinHandle<io::Result<bool>>)>,fenced:bool}
impl Default for Owner{fn default()->Self{Self{owned_worker:None,active:None,fenced:false}}}
impl Owner{
 /// Internal lifecycle primitive only; not exposed through the UI or MCP. The
 /// caller must provide a fixed trusted executable after destination consent.
 pub fn launch_owned_worker(&mut self,executable:&Path,args:&[String])->io::Result<()>{
 if self.owned_worker.is_some()||self.fenced{return Err(io::Error::other("disconnect before another worker"))}
 match owned_worker::OwnedWorker::launch(executable,args){
 Ok(worker)=>{self.owned_worker=Some(worker);Ok(())},
 Err(e)=>{self.fenced=true;Err(e)} // Conservative: even launch errors require owner exit.
 }
 }

 /// Internal host-routing groundwork: a live, Job-owned, local status-only MCP
 /// session. The only recipient is this owner process; caller MUST NOT forward
 /// these handles to an external host. No snapshot/desktop/file capability.
 /// Use off the UI thread: these are blocking pipes. Disconnect closes the child
 /// sides even if the parent still holds its handles; no background relaunch.
 pub fn launch_local_status_session(&mut self,bridge:&Path)->io::Result<stdio_pipe::LocalStdio>{
  if self.active.is_some()||self.owned_worker.is_some()||self.fenced{return Err(io::Error::other("disconnect before session"))}
  match owned_worker::OwnedWorker::launch_status_stdio(bridge){
   Ok((worker,io))=>{self.owned_worker=Some(worker);Ok(io)},
   Err(e)=>{self.fenced=true;Err(e)}
  }
 }

 /// Private local diagnostic integration, not GUI approval or host registration.
 /// Caller must obtain consent to the exact snapshot and fixed trusted bridge.
 /// The child consumes a single snapshot in memory and emits NO snapshot output.
 pub fn launch_local_snapshot_probe<F>(&mut self,bridge:&Path,snapshot:Vec<u8>,approve:F)->io::Result<()>
 where F:FnOnce(PeerInfo,Instant,Stop)->io::Result<bool>+Send+'static {
  if self.active.is_some()||self.owned_worker.is_some()||self.fenced{return Err(io::Error::other("disconnect before probe"))}
  let expected=std::sync::Arc::new(std::sync::atomic::AtomicU32::new(0));
  let bound=expected.clone();
  let pipe=self.allow_paired(Some(snapshot),move|peer,deadline,stop|{
   // The suspended child is contained before launch returns. Wait for its PID
   // publication, never approve an arbitrary first connector during that gap.
   let until=deadline.min(Instant::now()+Duration::from_secs(2));
   let pid=loop{let pid=bound.load(std::sync::atomic::Ordering::Acquire);if pid!=0{break pid}
    if stop.stopped()||Instant::now()>=until{return Ok(false)}thread::sleep(Duration::from_millis(1));};
   if peer.pid!=pid{return Ok(false)}approve(peer,deadline,stop)
  })?;
  let args=vec!["--owner-local-probe".into(),pipe,std::process::id().to_string()];
  if let Err(e)=self.launch_owned_worker(bridge,&args){let _=self.disconnect();return Err(e)}
  expected.store(self.owned_worker.as_ref().unwrap().pid(),std::sync::atomic::Ordering::Release);Ok(())
 }
 /// Register a bounded completion signal for the contained local probe.
 pub fn notify_local_worker_exit<F>(&self,finished:F)->io::Result<()> where F:FnOnce(io::Result<u32>)+Send+'static {
  self.owned_worker.as_ref().ok_or_else(||io::Error::other("no owned worker"))?.notify_exit(finished)
 }
 /// Nonblocking diagnostic completion; no content is returned or forwarded.
 pub fn notify_local_session_exit<F>(&self,finished:F)->io::Result<()> where F:FnOnce(io::Result<u32>)+Send+'static{
  self.owned_worker.as_ref().ok_or_else(||io::Error::other("no owned worker"))?.notify_lifetime(finished)
 }
 pub fn local_worker_pid(&self)->Option<u32>{self.owned_worker.as_ref().map(|worker|worker.pid())}
 pub fn local_worker_exit_code(&self)->io::Result<Option<u32>>{
  match self.owned_worker.as_ref(){Some(worker)=>worker.exit_code(),None=>Ok(None)}
 }

 /// Internal handoff only. The native UI never prints or persists the bearer.
 pub fn allow_once(&mut self,snapshot:Option<Vec<u8>>)->io::Result<(String,[u8;32])>{
 if self.active.is_some()||self.fenced{return Err(io::Error::other("disconnect before another grant"))}
 if let Some(b)=&snapshot{if b.len()>4096||std::str::from_utf8(b).is_err(){return Err(io::Error::other("snapshot refused"))}}
 let server=Server::new(Duration::from_secs(60))?;let pairing=server.pairing();let stop=server.stop();
 let worker=thread::Builder::new().name("computer-link-local-session".into()).spawn(move||match snapshot{Some(b)=>server.serve_snapshot(b),None=>server.serve_once()})?;self.active=Some((stop,worker));Ok(pairing)
 }
 pub fn allow_paired<F>(&mut self,snapshot:Option<Vec<u8>>,approve:F)->io::Result<String> where F:FnOnce(PeerInfo,Instant,Stop)->io::Result<bool>+Send+'static{
 self.allow_paired_notified(snapshot,approve,||{})
 }
 pub fn allow_paired_notified<F,N>(&mut self,snapshot:Option<Vec<u8>>,approve:F,finished:N)->io::Result<String> where F:FnOnce(PeerInfo,Instant,Stop)->io::Result<bool>+Send+'static,N:FnOnce()+Send+'static{
 if self.active.is_some()||self.fenced{return Err(io::Error::other("disconnect before another grant"))}
 if let Some(b)=&snapshot{if b.len()>4096||std::str::from_utf8(b).is_err(){return Err(io::Error::other("snapshot refused"))}}
 let server=Server::new(Duration::from_secs(60))?;let name=server.pairing().0;let stop=server.stop();let worker=thread::Builder::new().name("computer-link-paired-session".into()).spawn(move||{let result=server.serve_paired(snapshot,approve);finished();result})?;self.active=Some((stop,worker));Ok(name)
 }
 pub fn disconnect(&mut self)->io::Result<()>{
 let previously_fenced=self.fenced;
 let had_resources=self.active.is_some()||self.owned_worker.is_some();
 if had_resources{self.fenced=true;}
 let mut failure=None;
 // Attempt BOTH cleanup paths. A failed revoke must not leave the worker running,
 // and failed process cleanup must not leave snapshot authority live.
 if let Some((stop,_))=self.active.as_ref(){if let Err(e)=stop.revoke(){failure=Some(e);}}
 if let Some(worker)=self.owned_worker.as_mut(){match worker.stop(){
  Ok(())=>{self.owned_worker.take();},Err(e)=>{failure.get_or_insert(e);}
 }}
 if let Some((_,worker))=self.active.as_ref(){
  let deadline=Instant::now()+Duration::from_secs(2);
  while !worker.is_finished()&&Instant::now()<deadline{thread::sleep(Duration::from_millis(5));}
  if worker.is_finished(){
   let (_,worker)=self.active.take().unwrap();match worker.join(){
    Err(_)=>{failure.get_or_insert(io::Error::other("worker panicked; exit required"));},
    Ok(Err(e)) if e.to_string().contains("process must terminate")=>{failure.get_or_insert(e);},_=>{}
   }
  }else{failure.get_or_insert(io::Error::other("shutdown unconfirmed; exit process required"));}
 }
 if let Some(e)=failure{self.fenced=true;return Err(e)}
 if previously_fenced{return Err(io::Error::other("shutdown remains unconfirmed; exit process required"))}
 self.fenced=false;Ok(())
 }

}
impl Drop for Owner{fn drop(&mut self){let _=self.disconnect();}}
#[cfg(test)]mod tests{
 use super::*;use std::io::{Read,Write};
 #[test]fn launch_failure_fences_until_owner_exit(){
 let mut owner=Owner::default();assert!(owner.launch_owned_worker(Path::new("relative.exe"),&[]).is_err());
 assert!(owner.fenced);assert!(owner.allow_once(None).is_err());assert!(owner.disconnect().is_err());
 }
 #[test]fn disconnect_stops_owned_worker_without_relaunch(){
 let mut owner=Owner::default();let exe=std::env::current_exe().unwrap();
 let args=vec!["--exact".into(),"owned_worker::tests::sleep_fixture".into(),"--ignored".into()];
 let (pipe,_)=owner.allow_once(None).unwrap();
 owner.launch_owned_worker(&exe,&args).unwrap();assert!(owner.owned_worker.as_ref().unwrap().is_running());
 assert!(owner.launch_owned_worker(&exe,&args).is_err());owner.disconnect().unwrap();assert!(owner.owned_worker.is_none());assert!(OpenOptions::new().read(true).write(true).open(pipe).is_err());owner.disconnect().unwrap();assert!(owner.owned_worker.is_none());
 }
 #[test]fn consent_snapshot_roundtrip_disconnect_restart(){let mut o=Owner::default();let(name,token)=o.allow_once(Some(b"approved snapshot".to_vec())).unwrap();assert!(o.allow_once(None).is_err());let mut f=OpenOptions::new().read(true).write(true).open(&name).unwrap();let mut r=token.to_vec();r.push(2);f.write_all(&r).unwrap();let mut len=[0;4];f.read_exact(&mut len).unwrap();let mut b=vec![0;u32::from_be_bytes(len) as usize];f.read_exact(&mut b).unwrap();assert_eq!(b,b"approved snapshot");drop(f);o.disconnect().unwrap();assert!(OpenOptions::new().read(true).write(true).open(name).is_err());o.allow_once(None).unwrap();o.disconnect().unwrap();}
 #[test]fn uncertain_completion_stays_fenced_across_repeated_disconnect(){let mut o=Owner::default();let server=Server::new(Duration::from_secs(3)).unwrap();let stop=server.stop();drop(server);o.active=Some((stop,thread::spawn(||Err(io::Error::other("cancel unconfirmed; process must terminate before restart")))));assert!(o.disconnect().is_err());assert!(o.active.is_none());assert!(o.fenced);assert!(o.disconnect().unwrap_err().to_string().contains("remains unconfirmed"));assert!(o.allow_once(None).is_err());}
 #[test]fn actual_file_snapshot_is_bounded_and_immutable(){let dir=std::env::temp_dir().join(format!("owner-snapshot-{}-{}",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));std::fs::create_dir(&dir).unwrap();let file=dir.join("chosen.txt");std::fs::write(&file,b"first").unwrap();let captured=snapshot(&file).unwrap();std::fs::write(&file,b"second").unwrap();assert_eq!(captured,b"first");std::fs::write(&file,vec![0;4097]).unwrap();assert!(snapshot(&file).is_err());std::fs::write(&file,[255]).unwrap();assert!(snapshot(&file).is_err());std::fs::write(&file,b"valid").unwrap();std::fs::hard_link(&file,dir.join("alias.txt")).unwrap();assert_eq!(snapshot(&file).unwrap_err().to_string(),"single-link handle required");assert_eq!(std::fs::read(&file).unwrap(),b"valid");std::fs::remove_dir_all(dir).unwrap();}
 #[test]fn invalid_snapshot_creates_no_session(){let mut o=Owner::default();assert!(o.allow_once(Some(vec![0;4097])).is_err());assert!(o.active.is_none());assert!(o.allow_once(Some(vec![255])).is_err());}
}

pub mod window_focus;

pub mod window_focus_ui;
