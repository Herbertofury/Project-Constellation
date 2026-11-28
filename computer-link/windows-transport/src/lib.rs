//! Experimental local Windows status/explicit-read transport. No remote endpoint.
#![cfg(windows)]
use std::{ffi::c_void,io,ptr,mem,sync::Arc,time::{Duration,Instant}};
type H=*mut c_void;
#[repr(C)]struct SA{len:u32,sd:H,inherit:i32}
#[repr(C)]struct Ov{internal:usize,high:usize,offset:u32,offset_high:u32,event:H}
#[link(name="kernel32")]unsafe extern "system"{
 fn GetNamedPipeClientProcessId(h:H,p:*mut u32)->i32;fn GetNamedPipeServerProcessId(h:H,p:*mut u32)->i32;
 fn OpenProcess(access:u32,inherit:i32,pid:u32)->H;fn QueryFullProcessImageNameW(h:H,flags:u32,b:*mut u16,n:*mut u32)->i32;
 fn GetProcessTimes(h:H,created:*mut u64,exit:*mut u64,kernel:*mut u64,user:*mut u64)->i32;
 fn CreateFileW(n:*const u16,access:u32,share:u32,sa:*const SA,creation:u32,flags:u32,template:H)->H;
 fn CloseHandle(h:H)->i32;fn GetCurrentProcess()->H;fn LocalFree(p:H)->H;
 fn CreateEventW(sa:*const SA,manual:i32,initial:i32,name:*const u16)->H;fn SetEvent(h:H)->i32;
 fn WaitForMultipleObjects(n:u32,h:*const H,all:i32,ms:u32)->u32;fn WaitForSingleObject(h:H,ms:u32)->u32;
 fn CreateNamedPipeW(n:*const u16,open:u32,mode:u32,instances:u32,out:u32,input:u32,timeout:u32,sa:*const SA)->H;
 fn ConnectNamedPipe(h:H,ov:*mut Ov)->i32;fn ReadFile(h:H,b:*mut c_void,n:u32,got:*mut u32,ov:*mut Ov)->i32;
 fn WriteFile(h:H,b:*const c_void,n:u32,got:*mut u32,ov:*mut Ov)->i32;
 fn GetOverlappedResult(h:H,ov:*mut Ov,n:*mut u32,wait:i32)->i32;fn CancelIoEx(h:H,ov:*mut Ov)->i32;
}

#[link(name="advapi32")]unsafe extern "system"{
 fn OpenProcessToken(p:H,access:u32,t:*mut H)->i32;fn GetTokenInformation(t:H,class:u32,b:H,len:u32,need:*mut u32)->i32;
 fn ConvertSidToStringSidW(sid:H,s:*mut *mut u16)->i32;fn ConvertStringSecurityDescriptorToSecurityDescriptorW(s:*const u16,rev:u32,sd:*mut H,len:*mut u32)->i32;
}
#[link(name="bcrypt")]unsafe extern "system"{fn BCryptGenRandom(a:H,b:*mut u8,n:u32,flags:u32)->i32;}
struct Owned(H);unsafe impl Send for Owned{} unsafe impl Sync for Owned{}
impl Drop for Owned{fn drop(&mut self){unsafe{CloseHandle(self.0);}}}
fn owned(h:H)->io::Result<Arc<Owned>>{if h.is_null()||h as isize == -1 {Err(io::Error::last_os_error())}else{Ok(Arc::new(Owned(h)))}}
fn wide(s:&str)->Vec<u16>{s.encode_utf16().chain(Some(0)).collect()}
fn event()->io::Result<Arc<Owned>>{owned(unsafe{CreateEventW(ptr::null(),1,0,ptr::null())})}
struct Local(H);impl Drop for Local{fn drop(&mut self){unsafe{LocalFree(self.0);}}}
fn user_sd()->io::Result<Local>{unsafe{
 let mut t=ptr::null_mut();if OpenProcessToken(GetCurrentProcess(),8,&mut t)==0{return Err(io::Error::last_os_error())}let token=owned(t)?;
 let mut size=0;GetTokenInformation(token.0,1,ptr::null_mut(),0,&mut size);if size==0||size>65536{return Err(io::Error::other("token size refused"))}
 let mut data=vec![0usize;(size as usize+mem::size_of::<usize>()-1)/mem::size_of::<usize>()];if GetTokenInformation(token.0,1,data.as_mut_ptr().cast(),size,&mut size)==0{return Err(io::Error::last_os_error())}
 let sid=*(data.as_ptr() as *const H);let mut text=ptr::null_mut();if ConvertSidToStringSidW(sid,&mut text)==0{return Err(io::Error::last_os_error())}let _text=Local(text.cast());let mut len=0;while *text.add(len)!=0{len+=1;if len>256{return Err(io::Error::other("sid size refused"))}}
 let sid=String::from_utf16(std::slice::from_raw_parts(text,len)).map_err(|_|io::Error::other("sid refused"))?;
 // Explicit protected DACL only current user, not Everyone/Anonymous default.
 let s=wide(&format!("D:P(A;;GA;;;{sid})"));let mut sd=ptr::null_mut();if ConvertStringSecurityDescriptorToSecurityDescriptorW(s.as_ptr(),1,&mut sd,ptr::null_mut())==0{return Err(io::Error::last_os_error())}Ok(Local(sd))
}}
#[derive(Clone)]pub struct Stop(Arc<Owned>);impl Stop{pub fn stopped(&self)->bool{unsafe{WaitForSingleObject(self.0.0,0)==0}}pub fn revoke(&self)->io::Result<()>{if unsafe{SetEvent(self.0.0)}==0{Err(io::Error::last_os_error())}else{Ok(())}}}
#[derive(Clone,Debug)]pub struct PeerInfo{pub pid:u32,pub image:String,pub created:u64}
struct Peer{info:PeerInfo,handle:Arc<Owned>}
impl Peer{
 fn inspect(pipe:H,client:bool)->io::Result<Self>{let mut pid=0;let ok=unsafe{if client{GetNamedPipeClientProcessId(pipe,&mut pid)}else{GetNamedPipeServerProcessId(pipe,&mut pid)}};if ok==0||pid==0{return Err(io::Error::other("peer identity unavailable"))}
 let handle=owned(unsafe{OpenProcess(0x101000,0,pid)})?;let mut again=0;let ok=unsafe{if client{GetNamedPipeClientProcessId(pipe,&mut again)}else{GetNamedPipeServerProcessId(pipe,&mut again)}};if ok==0||again!=pid{return Err(io::Error::other("peer changed"))}
 let mut b=vec![0u16;32768];let mut n=b.len() as u32;if unsafe{QueryFullProcessImageNameW(handle.0,0,b.as_mut_ptr(),&mut n)}==0{return Err(io::Error::other("peer image unavailable"))}let image=String::from_utf16(&b[..n as usize]).map_err(|_|io::Error::other("peer image invalid"))?;
 let(mut created,mut exit,mut kernel,mut user)=(0u64,0u64,0u64,0u64);if unsafe{GetProcessTimes(handle.0,&mut created,&mut exit,&mut kernel,&mut user)}==0{return Err(io::Error::other("peer lifetime unavailable"))}
 let peer=Self{info:PeerInfo{pid,image,created},handle};peer.live()?;Ok(peer)
 }
 fn live(&self)->io::Result<()>{if unsafe{WaitForSingleObject(self.handle.0,0)}!=258{return Err(io::Error::other("peer exited or unavailable"))}Ok(())}
}
pub struct Server{pipe:Arc<Owned>,stop:Stop,name:String,token:[u8;32],end:Instant}
// Heap-owned buffers/OVERLAPPED remain alive until terminal completion. On an
// unconfirmed cancellation they are intentionally retained, never freed early.
struct Pending{pipe:Arc<Owned>,event:Arc<Owned>,ov:Ov,bytes:Vec<u8>}
impl Server{
 pub fn new(lifetime:Duration)->io::Result<Self>{
  if lifetime.is_zero()||lifetime>Duration::from_secs(60){return Err(io::Error::other("lifetime refused"))}
  let mut seed=[0u8;64];if unsafe{BCryptGenRandom(ptr::null_mut(),seed.as_mut_ptr(),64,2)}<0{return Err(io::Error::other("entropy failed"))}
  let suffix=seed[..32].iter().map(|b|format!("{b:02x}")).collect::<String>();let name=format!(r"\\.\pipe\computer-link-{suffix}");let mut token=[0;32];token.copy_from_slice(&seed[32..]);let sd=user_sd()?;
  let sa=SA{len:mem::size_of::<SA>() as u32,sd:sd.0,inherit:0};
  // FIRST_PIPE_INSTANCE | OVERLAPPED | DUPLEX, byte mode, REJECT_REMOTE_CLIENTS.
  let pipe=owned(unsafe{CreateNamedPipeW(wide(&name).as_ptr(),0x40080003,8,1,256,256,0,&sa)})?;
  Ok(Self{pipe,stop:Stop(event()?),name,token,end:Instant::now()+lifetime})
 }
 /// In-memory handoff to an explicitly selected client; not user consent UI.
 pub fn pairing(&self)->(String,[u8;32]){(self.name.clone(),self.token)}
 pub fn stop(&self)->Stop{self.stop.clone()}
 fn operation(&self,kind:u8,bytes:Vec<u8>)->io::Result<Vec<u8>>{
  if Instant::now()>=self.end||unsafe{WaitForSingleObject(self.stop.0.0,0)}==0{return Err(io::Error::other("session stopped"))}
  let event=event()?;let mut p=Box::new(Pending{pipe:self.pipe.clone(),ov:Ov{internal:0,high:0,offset:0,offset_high:0,event:event.0},event,bytes});let mut got=0;
  let ok=unsafe{match kind{0=>ConnectNamedPipe(p.pipe.0,&mut p.ov),1=>ReadFile(p.pipe.0,p.bytes.as_mut_ptr().cast(),p.bytes.len() as u32,&mut got,&mut p.ov),_=>WriteFile(p.pipe.0,p.bytes.as_ptr().cast(),p.bytes.len() as u32,&mut got,&mut p.ov)}};
  if ok!=0{if Instant::now()>=self.end||unsafe{WaitForSingleObject(self.stop.0.0,0)}==0{return Err(io::Error::other("session stopped"))}p.bytes.truncate(got as usize);return Ok(mem::take(&mut p.bytes))}
  if ok==0{let error=io::Error::last_os_error();if kind==0&&error.raw_os_error()==Some(535){return Ok(vec![])}if error.raw_os_error()!=Some(997){return Err(error)}}
  let ms=self.end.saturating_duration_since(Instant::now()).as_millis().min(60000) as u32;let handles=[self.stop.0.0,p.event.0];
  let signaled=unsafe{WaitForMultipleObjects(2,handles.as_ptr(),0,ms)};
  if signaled!=1{unsafe{CancelIoEx(p.pipe.0,&mut p.ov);}
   if unsafe{WaitForSingleObject(p.event.0,1000)}!=0{mem::forget(p);return Err(io::Error::other("cancel unconfirmed; process must terminate before restart"))}
   if unsafe{GetOverlappedResult(p.pipe.0,&mut p.ov,&mut got,0)}==0 && io::Error::last_os_error().raw_os_error()==Some(996){mem::forget(p);return Err(io::Error::other("cancel incomplete; process must terminate before restart"))}return Err(io::Error::other("session cancelled or expired"))
  }
  if unsafe{GetOverlappedResult(p.pipe.0,&mut p.ov,&mut got,0)}==0{let error=io::Error::last_os_error();if error.raw_os_error()==Some(996){mem::forget(p);return Err(io::Error::other("completion incomplete; process must terminate before restart"))}return Err(error)}
  if Instant::now()>=self.end||unsafe{WaitForSingleObject(self.stop.0.0,0)}==0{return Err(io::Error::other("session stopped"))}
  p.bytes.truncate(got as usize);Ok(mem::take(&mut p.bytes))
 }
 // Byte-read pipes may complete a successful read with only the bytes currently
 // available. Keep one absolute session deadline across every fragment and
 // never authenticate a partial token/request or invoke a selected read early.
 fn read_exact(&self, length:usize, peer:Option<&Peer>)->io::Result<Vec<u8>>{
  let mut bytes=Vec::with_capacity(length);
  while bytes.len()<length{
   if let Some(peer)=peer{peer.live()?}
   let part=self.operation(1,vec![0;length-bytes.len()])?;
   if part.is_empty(){return Err(io::Error::new(io::ErrorKind::UnexpectedEof,"truncated pipe frame"))}
   bytes.extend(part);
  }
  if Instant::now()>=self.end||self.stop.stopped(){return Err(io::Error::other("session stopped"))}
  if let Some(peer)=peer{peer.live()?}
  Ok(bytes)
 }
 /// Exactly one fixed-size authenticated status/revoke request, then close.
 /// Opcode0 status, opcode1 revoke. No root/file/desktop operations admitted.
 pub fn serve_selected_read(self,selected:computer_link_workspace_candidate::SelectedRead)->io::Result<bool>{self.serve_inner(Some(Box::new(move || { let mut selected=selected; selected.read() })))}
 pub fn serve_once(self)->io::Result<bool>{self.serve_inner(None)}
 pub fn serve_snapshot(self,bytes:Vec<u8>)->io::Result<bool>{if bytes.len()>4096||std::str::from_utf8(&bytes).is_err(){return Err(io::Error::other("snapshot refused"))}self.serve_inner(Some(Box::new(move || Ok(bytes))))}
 pub fn serve_paired<F>(self,bytes:Option<Vec<u8>>,approve:F)->io::Result<bool> where F:FnOnce(PeerInfo,Instant,Stop)->io::Result<bool>{
 if let Some(b)=&bytes{if b.len()>4096||std::str::from_utf8(b).is_err(){return Err(io::Error::other("snapshot refused"))}}
 self.operation(0,vec![])?;let peer=Peer::inspect(self.pipe.0,true)?;
 if !approve(peer.info.clone(),self.end,self.stop.clone())?{return Err(io::Error::other("pairing denied"))}
 peer.live()?;if Instant::now()>=self.end||self.stop.stopped(){return Err(io::Error::other("session stopped"))}
 if self.operation(2,self.token.to_vec())?.len()!=32{return Err(io::Error::other("short pairing write"))}
 let selected=bytes.map(|b|Box::new(move||Ok(b)) as Box<dyn FnOnce()->io::Result<Vec<u8>>>);self.request(selected,Some(peer))
 }
 fn serve_inner(self,selected:Option<Box<dyn FnOnce()->io::Result<Vec<u8>>>>)->io::Result<bool>{self.operation(0,vec![])?;self.request(selected,None)}
 fn request(self,selected:Option<Box<dyn FnOnce()->io::Result<Vec<u8>>>>,peer:Option<Peer>)->io::Result<bool>{let b=self.read_exact(33,peer.as_ref())?;
  let diff=b[..32].iter().zip(self.token).fold(0u8,|a,(x,y)|a|(x^y));if diff!=0{return Err(io::Error::other("unauthorized"))}
  if Instant::now()>=self.end||unsafe{WaitForSingleObject(self.stop.0.0,0)}==0{return Err(io::Error::other("session stopped"))}
  if let Some(p)=&peer{p.live()?}
  match b[32]{2=>{let selected=selected.ok_or_else(||io::Error::other("capability not granted"))?;let data=selected()?;if data.len()>4096{return Err(io::Error::other("read bound refused"))}let mut frame=(data.len() as u32).to_be_bytes().to_vec();frame.extend(data);let expected=frame.len();if let Some(p)=&peer{p.live()?}if self.operation(2,frame)?.len()!=expected{return Err(io::Error::other("short response write"))}Ok(false)},0=>{if let Some(p)=&peer{p.live()?}if self.operation(2,vec![1])?.len()!=1{return Err(io::Error::other("short response write"))}Ok(false)},1=>{self.stop.revoke()?;Ok(true)},_=>Err(io::Error::other("capability refused"))}
 }
}
/// One-shot local client. Rendezvous/PID are public; bearer stays on this pipe.
pub fn paired_client(name:&str,owner_pid:u32,opcode:u8)->io::Result<Vec<u8>>{
 let prefix=r"\\.\pipe\computer-link-";let suffix=name.strip_prefix(prefix).ok_or_else(||io::Error::other("local rendezvous required"))?;
 if suffix.len()!=64||!suffix.bytes().all(|b|b.is_ascii_hexdigit())||!matches!(opcode,0|2){return Err(io::Error::other("client scope refused"))}
 // OVERLAPPED | SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION: no impersonation grant.
 let pipe=owned(unsafe{CreateFileW(wide(name).as_ptr(),0xc0000000,0,ptr::null(),3,0x40110000,ptr::null_mut())})?;
 let peer=Peer::inspect(pipe.0,false)?;if peer.info.pid!=owner_pid{return Err(io::Error::other("unexpected owner process"))}
 let endpoint=Server{pipe,stop:Stop(event()?),name:name.to_owned(),token:[0;32],end:Instant::now()+Duration::from_secs(60)};
 let token=endpoint.read_exact(32,Some(&peer))?;
 let mut request=token;request.push(opcode);if endpoint.operation(2,request)?.len()!=33{return Err(io::Error::other("short request"))}
 let exact=|n:usize|endpoint.read_exact(n,Some(&peer));
 if opcode==0{let bytes=exact(1)?;peer.live()?;if bytes!=[1]{return Err(io::Error::other("status refused"))}return Ok(bytes)}
 let header=exact(4)?;let len=u32::from_be_bytes(header.try_into().unwrap()) as usize;if len>4096{return Err(io::Error::other("response bound refused"))}let bytes=exact(len)?;peer.live()?;Ok(bytes)
}

#[cfg(test)]mod tests{
 use super::*;use std::{fs::OpenOptions,io::{Read,Write},thread};
 fn fixture()->std::path::PathBuf{std::env::temp_dir().join(format!("computer-link-read-{}-{}",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()))}
 #[test]fn authenticated_selected_file_read_preserves_bytes(){let path=fixture();let selected=computer_link_workspace_candidate::SelectedRead::new_workspace(&path,"chosen.txt").unwrap();std::fs::write(path.join("chosen.txt"),b"selected fixture").unwrap();std::fs::write(path.join("other.txt"),b"must not be sent").unwrap();let s=Server::new(Duration::from_secs(3)).unwrap();let(name,token)=s.pairing();let t=thread::spawn(move||s.serve_selected_read(selected));let mut f=OpenOptions::new().read(true).write(true).open(name).unwrap();let mut request=token.to_vec();request.push(2);f.write_all(&request).unwrap();let mut size=[0;4];f.read_exact(&mut size).unwrap();let n=u32::from_be_bytes(size) as usize;assert!(n<=4096);let mut bytes=vec![0;n];f.read_exact(&mut bytes).unwrap();assert_eq!(bytes,b"selected fixture");assert!(!t.join().unwrap().unwrap());drop(f);assert_eq!(std::fs::read(path.join("chosen.txt")).unwrap(),b"selected fixture");assert_eq!(std::fs::read(path.join("other.txt")).unwrap(),b"must not be sent");std::fs::remove_dir_all(path).unwrap();}
 #[test]fn bad_token_refuses_before_selected_missing_file(){let path=fixture();let selected=computer_link_workspace_candidate::SelectedRead::new_workspace(&path,"absent.txt").unwrap();let s=Server::new(Duration::from_secs(3)).unwrap();let(name,mut token)=s.pairing();token[0]^=1;let t=thread::spawn(move||s.serve_selected_read(selected));let mut f=OpenOptions::new().read(true).write(true).open(name).unwrap();let mut request=token.to_vec();request.push(2);f.write_all(&request).unwrap();assert_eq!(t.join().unwrap().unwrap_err().to_string(),"unauthorized");drop(f);assert_eq!(std::fs::read_dir(&path).unwrap().count(),0);std::fs::remove_dir(path).unwrap();}
 #[test]fn selected_read_requires_grant(){let s=Server::new(Duration::from_secs(3)).unwrap();let(name,token)=s.pairing();let t=thread::spawn(move||s.serve_once());let mut f=OpenOptions::new().read(true).write(true).open(name).unwrap();let mut request=token.to_vec();request.push(2);f.write_all(&request).unwrap();assert_eq!(t.join().unwrap().unwrap_err().to_string(),"capability not granted");}
 #[test]fn stopped_selected_read_refuses_before_file_access(){let path=fixture();let selected=computer_link_workspace_candidate::SelectedRead::new_workspace(&path,"absent.txt").unwrap();let s=Server::new(Duration::from_secs(3)).unwrap();s.stop().revoke().unwrap();assert_eq!(s.serve_selected_read(selected).unwrap_err().to_string(),"session stopped");assert_eq!(std::fs::read_dir(&path).unwrap().count(),0);std::fs::remove_dir(path).unwrap();}
 #[test]fn actual_local_authenticated_status(){let s=Server::new(Duration::from_secs(3)).unwrap();let(name,token)=s.pairing();let t=thread::spawn(move||s.serve_once());let mut f=OpenOptions::new().read(true).write(true).open(name).unwrap();let mut request=token.to_vec();request.push(0);f.write_all(&request).unwrap();let mut reply=[0];f.read_exact(&mut reply).unwrap();assert_eq!(reply,[1]);drop(f);assert!(!t.join().unwrap().unwrap());}
 #[test]fn already_connected_buffered_request_completes(){let s=Server::new(Duration::from_secs(3)).unwrap();let(name,token)=s.pairing();let mut f=OpenOptions::new().read(true).write(true).open(name).unwrap();let mut request=token.to_vec();request.push(0);f.write_all(&request).unwrap();let start=Instant::now();let t=thread::spawn(move||s.serve_once());let mut reply=[0];f.read_exact(&mut reply).unwrap();assert_eq!(reply,[1]);assert!(!t.join().unwrap().unwrap());assert!(start.elapsed()<Duration::from_secs(2));}
 #[test]fn wrong_token_never_admitted(){let s=Server::new(Duration::from_secs(3)).unwrap();let(name,mut token)=s.pairing();token[0]^=1;let t=thread::spawn(move||s.serve_once());let mut f=OpenOptions::new().read(true).write(true).open(name).unwrap();let mut request=token.to_vec();request.push(0);f.write_all(&request).unwrap();assert_eq!(t.join().unwrap().unwrap_err().to_string(),"unauthorized");}
 #[test]fn owner_exit_cancels_pending_connection(){let s=Server::new(Duration::from_secs(3)).unwrap();let stop=s.stop();let start=Instant::now();let t=thread::spawn(move||s.serve_once());thread::sleep(Duration::from_millis(50));stop.revoke().unwrap();assert!(t.join().unwrap().is_err());assert!(start.elapsed()<Duration::from_secs(2));}
 #[test]fn lifetime_expires_without_client(){let s=Server::new(Duration::from_millis(100)).unwrap();let start=Instant::now();assert!(s.serve_once().is_err());assert!(start.elapsed()<Duration::from_secs(2));}
 #[test]fn peer_revoke_closes_session(){let s=Server::new(Duration::from_secs(3)).unwrap();let(name,token)=s.pairing();let t=thread::spawn(move||s.serve_once());let mut f=OpenOptions::new().read(true).write(true).open(&name).unwrap();let mut request=token.to_vec();request.push(1);f.write_all(&request).unwrap();assert!(t.join().unwrap().unwrap());drop(f);assert!(OpenOptions::new().read(true).write(true).open(name).is_err());}
}

#[cfg(test)]
mod fragmented_frame_tests {
    use super::*;
    use std::{
        fs::{File, OpenOptions},
        io::{Read, Write},
        sync::atomic::{AtomicUsize, Ordering},
        thread,
    };

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn PeekNamedPipe(
            pipe: H,
            buffer: H,
            capacity: u32,
            read: *mut u32,
            available: *mut u32,
            remaining: *mut u32,
        ) -> i32;
        fn FlushFileBuffers(pipe: H) -> i32;
    }

    // Retain the server handle while observing only the byte count. Waiting for
    // consumption forces each write to become a separate native read rather
    // than relying on arbitrary sleeps or the runner's scheduling speed.
    fn consumed(pipe: &Owned) {
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            let mut available = 0;
            assert_ne!(unsafe {
                PeekNamedPipe(pipe.0, ptr::null_mut(), 0, ptr::null_mut(),
                    &mut available, ptr::null_mut())
            }, 0, "pipe inspection failed: {}", io::Error::last_os_error());
            if available == 0 { return; }
            assert!(Instant::now() < deadline, "fragment was not consumed");
            thread::sleep(Duration::from_millis(2));
        }
    }

    fn client(name: &str) -> File {
        OpenOptions::new().read(true).write(true).open(name).unwrap()
    }

    #[test]
    fn fragmented_authenticated_request_reads_the_complete_selected_snapshot_once() {
        let server = Server::new(Duration::from_secs(5)).unwrap();
        let pipe = server.pipe.clone();
        let (name, token) = server.pairing();
        let calls = Arc::new(AtomicUsize::new(0));
        let invoked = calls.clone();
        let expected = "selected snapshot 🙂\n".repeat(80).into_bytes();
        let snapshot = expected.clone();
        let worker = thread::spawn(move || server.serve_inner(Some(Box::new(move || {
            invoked.fetch_add(1, Ordering::SeqCst);
            Ok(snapshot)
        }))));
        let mut file = client(&name);
        file.write_all(&token[..3]).unwrap();
        consumed(&pipe);
        assert_eq!(calls.load(Ordering::SeqCst), 0, "partial authentication invoked the capability");
        let mut tail = token[3..].to_vec();
        tail.push(2);
        for fragment in tail.chunks(7) {
            file.write_all(fragment).unwrap();
            consumed(&pipe);
        }
        let mut header = [0; 4];
        file.read_exact(&mut header).unwrap();
        assert_eq!(u32::from_be_bytes(header) as usize, expected.len());
        let mut actual = vec![0; expected.len()];
        file.read_exact(&mut actual).unwrap();
        assert_eq!(actual, expected);
        assert!(!worker.join().unwrap().unwrap());
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn truncated_or_invalid_fragmented_authentication_never_invokes_the_capability() {
        for prefix in [1, 31, 32, 33] {
            let server = Server::new(Duration::from_secs(5)).unwrap();
            let pipe = server.pipe.clone();
            let (name, mut token) = server.pairing();
            if prefix == 33 { token[0] ^= 1; }
            let calls = Arc::new(AtomicUsize::new(0));
            let invoked = calls.clone();
            let worker = thread::spawn(move || server.serve_inner(Some(Box::new(move || {
                invoked.fetch_add(1, Ordering::SeqCst);
                Ok(b"must not be read".to_vec())
            }))));
            let mut file = client(&name);
            let mut request = token.to_vec();
            request.push(2);
            file.write_all(&request[..1]).unwrap();
            consumed(&pipe);
            if prefix > 1 {
                file.write_all(&request[1..prefix]).unwrap();
                consumed(&pipe);
            }
            drop(file);
            let error = worker.join().unwrap().unwrap_err();
            if prefix == 33 { assert_eq!(error.to_string(), "unauthorized"); }
            assert_eq!(calls.load(Ordering::SeqCst), 0);
        }
    }

    #[test]
    fn partial_authentication_keeps_the_absolute_deadline_and_revocation() {
        for revoke in [false, true] {
            let server = Server::new(Duration::from_millis(300)).unwrap();
            let pipe = server.pipe.clone();
            let stop = server.stop();
            let (name, token) = server.pairing();
            let calls = Arc::new(AtomicUsize::new(0));
            let invoked = calls.clone();
            let start = Instant::now();
            let worker = thread::spawn(move || server.serve_inner(Some(Box::new(move || {
                invoked.fetch_add(1, Ordering::SeqCst);
                Ok(Vec::new())
            }))));
            let mut file = client(&name);
            file.write_all(&token[..1]).unwrap();
            consumed(&pipe);
            if revoke { stop.revoke().unwrap(); }
            assert!(worker.join().unwrap().is_err());
            assert!(start.elapsed() < Duration::from_secs(2));
            assert_eq!(calls.load(Ordering::SeqCst), 0);
        }
    }

    fn fragmented_server_write(server: &Server, bytes: &[u8]) -> io::Result<()> {
        let chunks: Vec<_> = bytes.chunks(3).collect();
        for (index, chunk) in chunks.iter().enumerate() {
            if server.operation(2, chunk.to_vec())?.len() != chunk.len() {
                return Err(io::Error::other("fixture write was incomplete"));
            }
            // On the server end this waits until the client consumed the
            // written fragment, forcing a partial byte-mode read. The final
            // payload may legitimately close its client immediately after read.
            if index + 1 < chunks.len() && unsafe { FlushFileBuffers(server.pipe.0) } == 0 {
                return Err(io::Error::last_os_error());
            }
        }
        Ok(())
    }

    #[test]
    fn paired_client_reassembles_fragmented_token_header_and_payload() {
        let server = Server::new(Duration::from_secs(5)).unwrap();
        let (name, token) = server.pairing();
        let expected = "owner-selected 🙂 snapshot".as_bytes().to_vec();
        let snapshot = expected.clone();
        let worker = thread::spawn(move || -> io::Result<()> {
            server.operation(0, Vec::new())?;
            fragmented_server_write(&server, &token)?;
            let request = server.read_exact(33, None)?;
            assert!(request[..32] == token, "client changed the token identity");
            assert_eq!(request[32], 2);
            let mut response = (snapshot.len() as u32).to_be_bytes().to_vec();
            response.extend(snapshot);
            fragmented_server_write(&server, &response)
        });
        assert_eq!(paired_client(&name, std::process::id(), 2).unwrap(), expected);
        worker.join().unwrap().unwrap();
    }
}
