#![cfg(windows)]
//! Actual GUI process/window/dialog acceptance on a disposable Windows CI desktop.
//! Win32 control messages are automation, not pixel/tray-click accessibility QA.
use std::{ffi::c_void,process::Child,thread,time::{Duration,Instant},ptr};
mod support;
type H=*mut c_void;
#[link(name="user32")]unsafe extern "system"{
fn EnumWindows(cb:Option<unsafe extern "system" fn(H,isize)->i32>,data:isize)->i32;
fn GetWindowThreadProcessId(h:H,p:*mut u32)->u32;
fn GetClassNameW(h:H,b:*mut u16,n:i32)->i32;
fn GetWindowTextW(h:H,b:*mut u16,n:i32)->i32;
fn PostMessageW(h:H,m:u32,w:usize,l:isize)->i32;
fn GetDlgItem(h:H,id:i32)->H;
fn IsWindow(h:H)->i32;fn IsWindowVisible(h:H)->i32;fn IsWindowEnabled(h:H)->i32;
}
struct Search{pid:u32,class:&'static str,result:H}
unsafe extern "system" fn visit(h:H,data:isize)->i32{let s=unsafe{&mut *(data as *mut Search)};let mut pid=0;unsafe{GetWindowThreadProcessId(h,&mut pid);}if pid==s.pid{let mut b=[0u16;128];let n=unsafe{GetClassNameW(h,b.as_mut_ptr(),128)};if n>0&&String::from_utf16_lossy(&b[..n as usize])==s.class{s.result=h;return 0}}1}
fn window(pid:u32,class:&'static str)->H{let mut s=Search{pid,class,result:ptr::null_mut()};unsafe{EnumWindows(Some(visit),&mut s as *mut _ as isize);}s.result}
fn wait_window(child:&mut Child,class:&'static str)->H{let end=Instant::now()+Duration::from_secs(10);loop{assert!(child.try_wait().unwrap().is_none(),"GUI exited before {class}");let h=window(child.id(),class);if !h.is_null(){return h}assert!(Instant::now()<end,"no actual {class} window on this desktop");thread::sleep(Duration::from_millis(20));}}
fn title(h:H)->String{let mut b=[0u16;512];let n=unsafe{GetWindowTextW(h,b.as_mut_ptr(),512)};String::from_utf16_lossy(&b[..n.max(0) as usize])}
fn post(h:H,m:u32,w:usize,l:isize){assert_ne!(unsafe{PostMessageW(h,m,w,l)},0);}
struct Guard(Child);impl Drop for Guard{fn drop(&mut self){if self.0.try_wait().ok().flatten().is_none(){let _=self.0.kill();let _=self.0.wait();}}}
fn wait_title(child:&mut Child,h:H,part:&str){let end=Instant::now()+Duration::from_secs(5);while !title(h).contains(part){assert!(child.try_wait().unwrap().is_none());assert!(Instant::now()<end,"title did not contain {part}: {}",title(h));thread::sleep(Duration::from_millis(20));}}
#[test]fn actual_window_denial_grant_disconnect_exit_and_restart(){
for round in 0..2{
 let mut child=Guard(support::command(env!("CARGO_BIN_EXE_computer-link-owner-proof")).spawn().unwrap());let h=wait_window(&mut child.0,"ComputerLinkOwnerProof");assert!(title(h).contains("disconnected"));
 // Real owner command opens an actual native MessageBox. Denying leaves no grant.
 post(h,0x111,2,0);let dialog=wait_window(&mut child.0,"#32770");let no=ready_dialog_button(&mut child.0,dialog,7,Instant::now()+Duration::from_secs(5));assert!(!no.is_null());post(no,0xf5,0,0);
 let deadline=Instant::now()+Duration::from_secs(5);while !window(child.0.id(),"#32770").is_null(){assert!(Instant::now()<deadline);thread::sleep(Duration::from_millis(20));}assert!(title(h).contains("disconnected"));
 // A second deliberate command and Yes are required. No hidden CLI consent flag.
 post(h,0x111,2,0);let dialog=wait_window(&mut child.0,"#32770");let yes=ready_dialog_button(&mut child.0,dialog,6,Instant::now()+Duration::from_secs(5));assert!(!yes.is_null());post(yes,0xf5,0,0);wait_title(&mut child.0,h,"one local grant");
 let mut ignored=0;assert_ne!(unsafe{SendMessageTimeoutW(h,0x8003,0,0,2,1000,&mut ignored)},0);assert!(title(h).contains("one local grant"),"stale completion revoked a newer grant");
 post(h,0x111,4,0);wait_title(&mut child.0,h,"disconnected");
 if round==0{post(h,0x111,5,0)}else{post(h,0x10,0,0)}
 let end=Instant::now()+Duration::from_secs(5);loop{if let Some(status)=child.0.try_wait().unwrap(){assert!(status.success());break}assert!(Instant::now()<end,"actual GUI process did not exit");thread::sleep(Duration::from_millis(20));}
 assert!(window(child.0.id(),"ComputerLinkOwnerProof").is_null());
}
}

// Fixed-label diagnostics only: no dialog body, executable path, PID or title is logged.
#[allow(dead_code)] // Read exclusively through privacy-safe Debug on failure.
#[derive(Debug)]struct GrantDiagnostic{dialog_present:bool,permission_title:bool,client_title:bool,notice_title:bool,yes_present:bool,yes_visible:bool,yes_enabled:bool,yes_owned:bool}
fn grant_diagnostic(dialog:H,pid:u32)->GrantDiagnostic{let yes=unsafe{GetDlgItem(dialog,6)};let mut actual=0;if !yes.is_null(){unsafe{GetWindowThreadProcessId(yes,&mut actual);}}let t=if dialog.is_null(){String::new()}else{title(dialog)};GrantDiagnostic{dialog_present:!dialog.is_null()&&unsafe{IsWindow(dialog)}!=0,permission_title:t=="Explicit local permission",client_title:t=="Authorize connected client",notice_title:t=="Constellation Computer Tools local proof",yes_present:!yes.is_null(),yes_visible:!yes.is_null()&&unsafe{IsWindowVisible(yes)}!=0,yes_enabled:!yes.is_null()&&unsafe{IsWindowEnabled(yes)}!=0,yes_owned:!yes.is_null()&&actual==pid}}
fn prepare_status(child:&mut Child,h:H,case:&str)->String{
 post(h,0x111,2,0);let dialog=wait_window(child,"#32770");let end=Instant::now()+Duration::from_secs(5);
 let before=loop{let d=grant_diagnostic(dialog,child.id());if d.permission_title&&d.yes_present&&d.yes_visible&&d.yes_enabled&&d.yes_owned{break d}assert!(child.try_wait().unwrap().is_none(),"grant case {case}: owner exited before button ready");assert!(Instant::now()<end,"grant case {case}: permission button not ready; state={d:?}");thread::sleep(Duration::from_millis(20));};
 let yes=ready_dialog_button(child,dialog,6,end);post(yes,0xf5,0,0);
 while !title(h).contains("one local grant"){
 assert!(child.try_wait().unwrap().is_none(),"grant case {case}: owner exited");
 if Instant::now()>=end{let after=grant_diagnostic(window(child.id(),"#32770"),child.id());panic!("grant case {case}: no local grant; before={before:?}; after={after:?}")}
 thread::sleep(Duration::from_millis(20));
 }
 title(h).split(" | ").nth(1).expect("public rendezvous name").to_owned()
}
fn finish_client(child:&mut Child,success:bool){let end=Instant::now()+Duration::from_secs(5);loop{if let Some(status)=child.try_wait().unwrap(){assert_eq!(status.success(),success);break}assert!(Instant::now()<end,"client did not terminate");thread::sleep(Duration::from_millis(20));}}
#[test]fn actual_gui_authorizes_separate_client_and_invalidates_late_consent(){
 let mut owner=Guard(support::command(env!("CARGO_BIN_EXE_computer-link-owner-proof")).spawn().unwrap());let h=wait_window(&mut owner.0,"ComputerLinkOwnerProof");
 for case in ["deny","allow","wrong-op","late-yes","peer-exit"]{
 let name=prepare_status(&mut owner.0,h,case);let mut client=Guard(support::command(env!("CARGO_BIN_EXE_local-client")).arg(owner.0.id().to_string()).arg(&name).arg(if case=="wrong-op"{"read"}else{"status"}).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).spawn().unwrap());
 let prompt=wait_window(&mut owner.0,"#32770");assert_eq!(title(prompt),"Authorize connected client");
 let response=ready_dialog_button(&mut owner.0,prompt,if case=="deny"{7}else{6},Instant::now()+Duration::from_secs(5));
 if case=="peer-exit"{client.0.kill().unwrap();client.0.wait().unwrap();}
 if case=="late-yes"{post(h,0x111,4,0);wait_title(&mut owner.0,h,"disconnected");}
 post(response,0xf5,0,0);
 if case!="peer-exit"{finish_client(&mut client.0,case=="allow");}
 let mut out=String::new();use std::io::Read;client.0.stdout.take().unwrap().read_to_string(&mut out).unwrap();if case=="allow"{assert_eq!(out.trim(),"authenticated response: 1 bytes")}else{assert!(out.is_empty())}
 wait_title(&mut owner.0,h,"disconnected");
 post(h,0x111,4,0);wait_title(&mut owner.0,h,"disconnected");
 // A completed/denied/revoked session must never accept another connecting client.
 let mut again=Guard(support::command(env!("CARGO_BIN_EXE_local-client")).args([&owner.0.id().to_string(),&name,"status"]).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).spawn().unwrap());finish_client(&mut again.0,false);
 }
 post(h,0x111,5,0);finish_client(&mut owner.0,true);
}

#[link(name="user32")]unsafe extern "system"{
 fn EnumChildWindows(h:H,cb:Option<unsafe extern "system" fn(H,isize)->i32>,d:isize)->i32;
 fn SendMessageTimeoutW(h:H,m:u32,w:usize,l:isize,f:u32,ms:u32,r:*mut usize)->isize;
 fn CreateWindowExW(ex:u32,class:*const u16,title:*const u16,style:u32,x:i32,y:i32,w:i32,h:i32,parent:H,menu:H,instance:H,param:H)->H;
 fn DestroyWindow(h:H)->i32;
}
struct Texts{pid:u32,text:String,failed:bool}
unsafe extern "system" fn static_text(h:H,d:isize)->i32{let s=unsafe{&mut*(d as *mut Texts)};let mut pid=0;unsafe{GetWindowThreadProcessId(h,&mut pid);}let mut class=[0;32];let n=unsafe{GetClassNameW(h,class.as_mut_ptr(),32)};if pid!=s.pid||n<=0||String::from_utf16_lossy(&class[..n as usize])!="Static"{return 1}let mut b=[0;8192];let mut n=0;let ok=unsafe{SendMessageTimeoutW(h,0xd,b.len(),b.as_mut_ptr() as isize,2,2000,&mut n)};if ok==0||n>=b.len(){s.failed=true;return 0}s.text.push_str(&String::from_utf16_lossy(&b[..n]));1}
fn dialog_body(h:H,pid:u32)->String{let mut s=Texts{pid,text:String::new(),failed:false};unsafe{EnumChildWindows(h,Some(static_text),&mut s as *mut _ as isize);}assert!(!s.failed,"bounded dialog text read failed");s.text}
fn wait_no_dialog(owner:&mut Child){let end=Instant::now()+Duration::from_secs(5);while !window(owner.id(),"#32770").is_null(){assert!(owner.try_wait().unwrap().is_none());assert!(Instant::now()<end,"owned dialog remained open");thread::sleep(Duration::from_millis(20));}}
// A dialog can be enumerated before its controls exist. PostMessageW(NULL,...)
// succeeds by targeting the caller thread, silently losing a premature BM_CLICK.
fn ready_dialog_button(owner:&mut Child,dialog:H,id:i32,end:Instant)->H{
 loop{
  assert!(owner.try_wait().unwrap().is_none(),"owner exited before button ready");
  let b=unsafe{GetDlgItem(dialog,id)};let mut pid=0;
  if !b.is_null(){unsafe{GetWindowThreadProcessId(b,&mut pid);}}
  if !b.is_null()&&pid==owner.id()&&unsafe{IsWindowVisible(b)}!=0&&unsafe{IsWindowEnabled(b)}!=0{return b}
  assert!(Instant::now()<end,"dialog button not ready");thread::sleep(Duration::from_millis(20));
 }
}
fn click_dialog_button(owner:&mut Child,dialog:H,id:i32){
 let button=ready_dialog_button(owner,dialog,id,Instant::now()+Duration::from_secs(5));
 post(button,0xf5,0,0);
}
// A MessageBox title can exist before its Static body and response controls.
// Read one unchanged preview to completion; readiness never depends on the
// inventory marker, which must still fail immediately if the full snapshot lacks it.
fn wait_inventory_preview(owner:&mut Child,dialog:H)->(String,usize){
 let end=Instant::now()+Duration::from_secs(5);
 loop{
  assert!(owner.try_wait().unwrap().is_none(),"owner exited before inventory preview was ready");
  let button=unsafe{GetDlgItem(dialog,6)};let mut pid=0;
  if !button.is_null(){unsafe{GetWindowThreadProcessId(button,&mut pid);}}
  let button_ready=!button.is_null()&&pid==owner.id()&&unsafe{IsWindowVisible(button)}!=0&&unsafe{IsWindowEnabled(button)}!=0;
  let exact_title=title(dialog)=="Review captured window inventory";
  let body=dialog_body(dialog,owner.id());
  let declared=body.strip_prefix("Keep this ").and_then(|rest|rest.split_once("-byte snapshot ")).and_then(|(count,_)|count.parse::<usize>().ok());
  let payload_bytes=body.split_once("\n\n").map(|(_,payload)|payload.len());
  if exact_title&&button_ready&&declared.zip(payload_bytes).is_some_and(|(expected,actual)|expected==actual){return(body,declared.unwrap())}
  assert!(Instant::now()<end,"inventory preview not ready: exact_title={exact_title}, ready_owned_button={button_ready}, declared_bytes={declared:?}, payload_bytes={payload_bytes:?}");
  thread::sleep(Duration::from_millis(20));
 }
}
struct SyntheticWindow(H);impl Drop for SyntheticWindow{fn drop(&mut self){unsafe{DestroyWindow(self.0);}}}
#[test]fn actual_inventory_preview_keep_and_paired_read(){
 let class:Vec<u16>="STATIC\0".encode_utf16().collect();let label:Vec<u16>="computer-link-synthetic-inventory-marker\0".encode_utf16().collect();let fixture=SyntheticWindow(unsafe{CreateWindowExW(0,class.as_ptr(),label.as_ptr(),0x10000000,0,0,100,50,ptr::null_mut(),ptr::null_mut(),ptr::null_mut(),ptr::null_mut())});assert!(!fixture.0.is_null());
 let mut owner=Guard(support::command(env!("CARGO_BIN_EXE_computer-link-owner-proof")).spawn().unwrap());let h=wait_window(&mut owner.0,"ComputerLinkOwnerProof");
 // Deny capture, then discard a locally captured preview. Neither creates a grant.
 post(h,0x111,6,0);let d=wait_window(&mut owner.0,"#32770");assert_eq!(title(d),"Capture window inventory locally");click_dialog_button(&mut owner.0,d,7);wait_no_dialog(&mut owner.0);assert!(title(h).contains("disconnected"));
 for keep in [false,true]{
 post(h,0x111,6,0);let d=wait_window(&mut owner.0,"#32770");assert_eq!(title(d),"Capture window inventory locally");click_dialog_button(&mut owner.0,d,6);
 let end=Instant::now()+Duration::from_secs(5);let preview=loop{let d=window(owner.0.id(),"#32770");if !d.is_null()&&title(d)=="Review captured window inventory"{break d}assert!(Instant::now()<end,"inventory preview not observed");thread::sleep(Duration::from_millis(20));};let(body,n)=wait_inventory_preview(&mut owner.0,preview);assert!(body.contains("computer-link-synthetic-inventory-marker"),"synthetic visible window absent");assert!(n>1&&n<=4096);click_dialog_button(&mut owner.0,preview,if keep{6}else{7});wait_no_dialog(&mut owner.0);assert!(title(h).contains("disconnected"));
 if !keep{continue}
 post(h,0x111,3,0);let d=wait_window(&mut owner.0,"#32770");assert_eq!(title(d),"Explicit local permission");assert!(dialog_body(d,owner.0.id()).contains("captured window inventory"));click_dialog_button(&mut owner.0,d,6);wait_title(&mut owner.0,h,"one local grant");let name=title(h).split(" | ").nth(1).unwrap().to_owned();
 let expected=body.split_once("\n\n").expect("preview payload separator").1.as_bytes().to_vec();assert_eq!(expected.len(),n);let owner_pid=owner.0.id();
 // This test executable is a separate client process from the owner. Keep actual
 // bytes only in memory and never print captured desktop titles on mismatch.
 let client=thread::spawn(move||computer_link_local_transport::paired_client(&name,owner_pid,2));let d=wait_window(&mut owner.0,"#32770");assert_eq!(title(d),"Authorize connected client");click_dialog_button(&mut owner.0,d,6);let actual=client.join().expect("client thread failed").expect("paired read refused");assert!(actual==expected,"paired response differs from exact locally previewed snapshot");wait_title(&mut owner.0,h,"disconnected");post(h,0x111,4,0);wait_title(&mut owner.0,h,"disconnected");
 // A fresh explicit grant is required for the actual packaged local-client.
 // Its intentionally redacted stdout verifies length, not content identity;
 // the independent library roundtrip above retains the exact-byte assertion.
 post(h,0x111,3,0);let grant=wait_window(&mut owner.0,"#32770");assert_eq!(title(grant),"Explicit local permission");click_dialog_button(&mut owner.0,grant,6);wait_title(&mut owner.0,h,"one local grant");let cli_name=title(h).split(" | ").nth(1).unwrap().to_owned();
 let mut cli=Guard(support::command(env!("CARGO_BIN_EXE_local-client")).args([&owner.0.id().to_string(),&cli_name,"read"]).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).spawn().unwrap());
 let consent=wait_window(&mut owner.0,"#32770");assert_eq!(title(consent),"Authorize connected client");click_dialog_button(&mut owner.0,consent,6);finish_client(&mut cli.0,true);
 let mut output=String::new();use std::io::Read;cli.0.stdout.take().unwrap().read_to_string(&mut output).unwrap();assert!(output.trim()==format!("authenticated response: {n} bytes"),"packaged client did not report expected bounded response length");
 wait_title(&mut owner.0,h,"disconnected");
 let mut replay=Guard(support::command(env!("CARGO_BIN_EXE_local-client")).args([&owner.0.id().to_string(),&cli_name,"read"]).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).spawn().unwrap());finish_client(&mut replay.0,false);
 }
 post(h,0x111,5,0);finish_client(&mut owner.0,true);
}

#[test]fn actual_disconnect_invalidates_initial_permission(){
 let mut owner=Guard(support::command(env!("CARGO_BIN_EXE_computer-link-owner-proof")).spawn().unwrap());
 let h=wait_window(&mut owner.0,"ComputerLinkOwnerProof");
 post(h,0x111,2,0);let dialog=wait_window(&mut owner.0,"#32770");
 assert_eq!(title(dialog),"Explicit local permission");
 let end=Instant::now()+Duration::from_secs(5);
 let yes=ready_dialog_button(&mut owner.0,dialog,6,end);
 // Synchronous dispatch proves Disconnect was processed before stale approval.
 let mut result=0;assert_ne!(unsafe{SendMessageTimeoutW(h,0x111,4,0,2,3000,&mut result)},0);
 assert!(title(h).contains("disconnected"));
 post(yes,0xf5,0,0);wait_no_dialog(&mut owner.0);
 // Check owner responsiveness; sent messages alone do not flush posted work.
 assert_ne!(unsafe{SendMessageTimeoutW(h,0,0,0,2,3000,&mut result)},0);
 assert!(title(h).contains("disconnected"),"stale initial consent recreated a grant after Disconnect");
 // A fresh deliberate approval remains usable after rejecting the stale one.
 post(h,0x111,2,0);let fresh=wait_window(&mut owner.0,"#32770");
 assert_eq!(title(fresh),"Explicit local permission");
 let end=Instant::now()+Duration::from_secs(5);let yes=ready_dialog_button(&mut owner.0,fresh,6,end);
 post(yes,0xf5,0,0);wait_no_dialog(&mut owner.0);wait_title(&mut owner.0,h,"one local grant");
 let name=title(h).split(" | ").nth(1).unwrap().to_owned();
 let mut client=Guard(support::command(env!("CARGO_BIN_EXE_local-client")).args([&owner.0.id().to_string(),&name,"status"]).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::null()).spawn().unwrap());
 let prompt=wait_window(&mut owner.0,"#32770");assert_eq!(title(prompt),"Authorize connected client");
 let end=Instant::now()+Duration::from_secs(5);let yes=ready_dialog_button(&mut owner.0,prompt,6,end);
 post(yes,0xf5,0,0);finish_client(&mut client.0,true);
 let mut out=String::new();use std::io::Read;client.0.stdout.take().unwrap().read_to_string(&mut out).unwrap();assert_eq!(out.trim(),"authenticated response: 1 bytes");
 wait_title(&mut owner.0,h,"disconnected");
 post(h,0x111,5,0);finish_client(&mut owner.0,true);
}

#[link(name="user32")]unsafe extern "system"{
 fn GetForegroundWindow()->H;
 fn SetForegroundWindow(h:H)->i32;
 fn PeekMessageW(msg:*mut FocusMsg,h:H,min:u32,max:u32,remove:u32)->i32;
 fn TranslateMessage(msg:*const FocusMsg)->i32;fn DispatchMessageW(msg:*const FocusMsg)->isize;
}
#[repr(C)]struct FocusMsg{hwnd:H,msg:u32,w:usize,l:isize,time:u32,x:i32,y:i32,private:u32}
fn pump_until(condition:impl Fn()->bool){let end=Instant::now()+Duration::from_secs(10);loop{let mut msg:FocusMsg=unsafe{std::mem::zeroed()};while unsafe{PeekMessageW(&mut msg,ptr::null_mut(),0,0,1)}!=0{unsafe{TranslateMessage(&msg);DispatchMessageW(&msg);}}if condition(){return}assert!(Instant::now()<end,"foreground fixture condition timed out");thread::sleep(Duration::from_millis(5));}}
fn focus_pid(owner:&mut Child,h:H)->u32{wait_title(owner,h,"local foreground selector active | PID ");title(h).split("PID ").nth(1).unwrap().split(' ').next().unwrap().parse().unwrap()}
fn foreign_ready(pid:u32,class:&'static str,id:i32)->(H,H){let end=Instant::now()+Duration::from_secs(10);loop{let h=window(pid,class);if !h.is_null(){let b=unsafe{GetDlgItem(h,id)};if !b.is_null()&&unsafe{IsWindowVisible(b)}!=0&&unsafe{IsWindowEnabled(b)}!=0{return(h,b)}}assert!(Instant::now()<end);thread::sleep(Duration::from_millis(10));}}
#[test]fn actual_tray_owned_foreground_success_cancel_disconnect_exit(){
 for mode in ["success","cancel","disconnect","exit"]{
 let n=ptr::null_mut();let class:Vec<u16>="STATIC\0".encode_utf16().collect();let caption:Vec<u16>="Disposable installed foreground exact fixture\0".encode_utf16().collect();
 let target=SyntheticWindow(unsafe{CreateWindowExW(0,class.as_ptr(),caption.as_ptr(),0x10000000,20,20,200,100,n,n,n,n)});assert!(!target.0.is_null());
 let mut owner=Guard(support::command(env!("CARGO_BIN_EXE_computer-link-owner-proof")).spawn().unwrap());let h=wait_window(&mut owner.0,"ComputerLinkOwnerProof");
 assert_ne!(unsafe{SetForegroundWindow(h)},0);pump_until(||unsafe{GetForegroundWindow()}==h);
 post(h,0x111,13,0);let consent=wait_window(&mut owner.0,"#32770");click_dialog_button(&mut owner.0,consent,6);
 let pid=focus_pid(&mut owner.0,h);let process=FocusProcess(unsafe{OpenProcess(0x00100000,0,pid)});assert!(!process.0.is_null());let(_,allow)=foreign_ready(pid,"#32770",1);post(allow,0xf5,0,0);
 let(selector,_)=foreign_ready(pid,"ComputerLinkLocalFocusSelector",3);let list=unsafe{GetDlgItem(selector,10)};let mut row=0;
 assert_ne!(unsafe{SendMessageTimeoutW(list,0x18f,usize::MAX,caption.as_ptr() as isize,2,2000,&mut row)},0);assert_ne!(row,usize::MAX);
 let mut ignored=0;assert_ne!(unsafe{SendMessageTimeoutW(list,0x186,row,0,2,2000,&mut ignored)},0);post(selector,0x111,3,0);
 let(confirm,cancel)=foreign_ready(pid,"#32770",2);assert!(dialog_body(confirm,pid).contains("Disposable installed foreground exact fixture"));
 match mode{
 "success"=>{let(_,yes)=foreign_ready(pid,"#32770",1);post(yes,0xf5,0,0);pump_until(||unsafe{GetForegroundWindow()}==target.0);},
 "cancel"=>{post(cancel,0xf5,0,0);},
 "disconnect"=>{post(h,0x111,4,0);},
 _=>{post(h,0x111,5,0);finish_client(&mut owner.0,true);}}
 pump_until(||unsafe{WaitForSingleObject(process.0,0)}==0);
 pump_until(||window(pid,"#32770").is_null()&&window(pid,"ComputerLinkLocalFocusSelector").is_null());
 // Closing the owner can legitimately cause Windows to activate another window.
 // Check cancellation while owner is alive only; exact zero effect calls are
 // asserted separately by window_focus::tests at the effect boundary.
 if mode=="cancel"{assert_ne!(unsafe{GetForegroundWindow()},target.0,"cancelled fixture should not be foreground while owner remains");}
 if mode!="exit"{wait_title(&mut owner.0,h,"disconnected");post(h,0x111,5,0);finish_client(&mut owner.0,true);}
 }
}

#[link(name="kernel32")]unsafe extern "system"{fn OpenProcess(access:u32,inherit:i32,pid:u32)->H;fn WaitForSingleObject(h:H,ms:u32)->u32;fn CloseHandle(h:H)->i32;}
struct FocusProcess(H);impl Drop for FocusProcess{fn drop(&mut self){unsafe{CloseHandle(self.0);}}}
