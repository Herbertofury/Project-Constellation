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
fn IsWindowVisible(h:H)->i32;fn IsWindowEnabled(h:H)->i32;
}
struct Search{pid:u32,class:&'static str,result:H}
unsafe extern "system" fn visit(h:H,data:isize)->i32{let s=unsafe{&mut *(data as *mut Search)};let mut pid=0;unsafe{GetWindowThreadProcessId(h,&mut pid);}if pid==s.pid{let mut b=[0u16;128];let n=unsafe{GetClassNameW(h,b.as_mut_ptr(),128)};if n>0&&String::from_utf16_lossy(&b[..n as usize])==s.class{s.result=h;return 0}}1}
fn window(pid:u32,class:&'static str)->H{let mut s=Search{pid,class,result:ptr::null_mut()};unsafe{EnumWindows(Some(visit),&mut s as *mut _ as isize);}s.result}
fn wait_window(child:&mut Child,class:&'static str)->H{let end=Instant::now()+Duration::from_secs(10);loop{assert!(child.try_wait().unwrap().is_none(),"GUI exited before {class}");let h=window(child.id(),class);if !h.is_null(){return h}assert!(Instant::now()<end,"no actual {class} window on this desktop");thread::sleep(Duration::from_millis(20));}}
fn title(h:H)->String{let mut b=[0u16;512];let n=unsafe{GetWindowTextW(h,b.as_mut_ptr(),512)};String::from_utf16_lossy(&b[..n.max(0) as usize])}
fn post(h:H,m:u32,w:usize,l:isize){assert_ne!(unsafe{PostMessageW(h,m,w,l)},0);}
struct Guard(Child);impl Drop for Guard{fn drop(&mut self){if self.0.try_wait().ok().flatten().is_none(){let _=self.0.kill();let _=self.0.wait();}}}
fn wait_title(child:&mut Child,h:H,part:&str){let end=Instant::now()+Duration::from_secs(5);while !title(h).contains(part){assert!(child.try_wait().unwrap().is_none());assert!(Instant::now()<end,"title did not contain {part}: {}",title(h));thread::sleep(Duration::from_millis(20));}}
#[link(name="user32")]unsafe extern "system"{
 fn EnumChildWindows(h:H,cb:Option<unsafe extern "system" fn(H,isize)->i32>,d:isize)->i32;
 fn SendMessageTimeoutW(h:H,m:u32,w:usize,l:isize,f:u32,ms:u32,r:*mut usize)->isize;
}
struct Texts{pid:u32,text:String,failed:bool}
unsafe extern "system" fn static_text(h:H,d:isize)->i32{let s=unsafe{&mut*(d as *mut Texts)};let mut pid=0;unsafe{GetWindowThreadProcessId(h,&mut pid);}let mut class=[0;32];let n=unsafe{GetClassNameW(h,class.as_mut_ptr(),32)};if pid!=s.pid||n<=0||String::from_utf16_lossy(&class[..n as usize])!="Static"{return 1}let mut b=[0;8192];let mut n=0;let ok=unsafe{SendMessageTimeoutW(h,0xd,b.len(),b.as_mut_ptr() as isize,2,2000,&mut n)};if ok==0||n>=b.len(){s.failed=true;return 0}s.text.push_str(&String::from_utf16_lossy(&b[..n]));1}
fn dialog_body(h:H,pid:u32)->String{let mut s=Texts{pid,text:String::new(),failed:false};unsafe{EnumChildWindows(h,Some(static_text),&mut s as *mut _ as isize);}assert!(!s.failed,"bounded dialog text read failed");s.text}
fn wait_no_dialog(owner:&mut Child){let end=Instant::now()+Duration::from_secs(5);while !window(owner.id(),"#32770").is_null(){assert!(owner.try_wait().unwrap().is_none());assert!(Instant::now()<end,"owned dialog remained open");thread::sleep(Duration::from_millis(20));}}
// A dialog can be enumerated before its controls exist. PostMessageW(NULL,...)
// succeeds by targeting the caller thread, silently losing a premature BM_CLICK.
#[track_caller]
fn ready_dialog_button(owner:&mut Child,dialog:H,id:i32,end:Instant)->H{
 loop{
  assert!(owner.try_wait().unwrap().is_none(),"owner exited before button ready");
  let b=unsafe{GetDlgItem(dialog,id)};let mut pid=0;
  if !b.is_null(){unsafe{GetWindowThreadProcessId(b,&mut pid);}}
  if !b.is_null()&&pid==owner.id()&&unsafe{IsWindowVisible(b)}!=0&&unsafe{IsWindowEnabled(b)}!=0{return b}
  assert!(Instant::now()<end,"dialog button {id} not ready; title={}",title(dialog));thread::sleep(Duration::from_millis(20));
 }
}
#[track_caller]
fn click_dialog_button(owner:&mut Child,dialog:H,id:i32){
 let button=ready_dialog_button(owner,dialog,id,Instant::now()+Duration::from_secs(5));
 post(button,0xf5,0,0);
}

#[link(name="user32")]unsafe extern "system"{fn GetDlgCtrlID(h:H)->i32;}
struct NoticeButtons { pid: u32, buttons: Vec<(H, i32)> }
unsafe extern "system" fn notice_button(h: H, data: isize) -> i32 {
    let state = unsafe { &mut *(data as *mut NoticeButtons) };
    let mut pid = 0;
    unsafe { GetWindowThreadProcessId(h, &mut pid); }
    if pid != state.pid { return 1; }
    let mut class = [0u16; 32];
    let n = unsafe { GetClassNameW(h, class.as_mut_ptr(), class.len() as i32) };
    if n > 0 && String::from_utf16_lossy(&class[..n as usize]) == "Button"
        && unsafe { IsWindowVisible(h) != 0 && IsWindowEnabled(h) != 0 } {
        state.buttons.push((h, unsafe { GetDlgCtrlID(h) }));
        if state.buttons.len() > 1 { return 0; }
    }
    1
}
fn dismiss_notice(pid:u32,dialog:H){
 assert_eq!(title(dialog),"Constellation Computer Tools local proof");
 let mut button=ptr::null_mut();let mut id=0;
 let end=Instant::now()+Duration::from_secs(5);
 loop{let ready=(||{
    let mut dp=0;unsafe{GetWindowThreadProcessId(dialog,&mut dp);}
    if dp!=pid || unsafe{IsWindowVisible(dialog)==0 || IsWindowEnabled(dialog)==0} { return false; }
    let mut state=NoticeButtons{pid,buttons:vec![]};
    unsafe{EnumChildWindows(dialog,Some(notice_button),&mut state as *mut _ as isize);}
    assert!(state.buttons.len()<=1,"informational notice has multiple actionable buttons");
    if let Some(&(h,control_id))=state.buttons.first(){
        assert!(matches!(control_id,1|2),"unexpected informational notice control ID");
        button=h;id=control_id;true
    }else{false}
 })();if ready{break}assert!(Instant::now()<end,"notice button not ready");thread::sleep(Duration::from_millis(20));}
 eprintln!("notice actionable button: id={id}");
 post(dialog,0x111,id as usize,button as isize);
}

// Requires the real MCP sibling built into the same target directory by windows-mcp.yml.
#[test]
#[ignore = "requires source-built MCP sibling; run by Windows MCP acceptance"]
fn native_owner_probe_destination_deny_success_and_stale_consent(){
 let mut owner=Guard(support::command(env!("CARGO_BIN_EXE_computer-link-owner-proof")).spawn().unwrap());
 let h=wait_window(&mut owner.0,"ComputerLinkOwnerProof");
 // Forged wakeups carry no authority or result.
 let mut ignored=0;assert_ne!(unsafe{SendMessageTimeoutW(h,0x8004,0,1,2,1000,&mut ignored)},0);assert!(!title(h).contains("passed"));
 // Capture and retain current synthetic CI window names using the real owner UI.
 post(h,0x111,6,0);let d=wait_window(&mut owner.0,"#32770");click_dialog_button(&mut owner.0,d,6);
 let end=Instant::now()+Duration::from_secs(5);let d=loop{let d=window(owner.0.id(),"#32770");if !d.is_null()&&title(d)=="Review captured window inventory"{break d}assert!(Instant::now()<end);thread::sleep(Duration::from_millis(20));};click_dialog_button(&mut owner.0,d,6);wait_no_dialog(&mut owner.0);
 // Decline first permission: no child or grant, then explicit retry is required.
 post(h,0x111,9,0);let d=wait_window(&mut owner.0,"#32770");let no=ready_dialog_button(&mut owner.0,d,7,Instant::now()+Duration::from_secs(5));assert_eq!(title(d),"Run local snapshot diagnostic");let body=dialog_body(d,owner.0.id());assert!(body.contains("Destination: this computer only"));assert!(body.contains("computer-link-mcp-session.exe"));assert!(body.contains("No ChatGPT"));post(no,0xf5,0,0);wait_no_dialog(&mut owner.0);assert!(title(h).contains("disconnected"));
 for approve in [false,true]{
 post(h,0x111,9,0);let d=wait_window(&mut owner.0,"#32770");click_dialog_button(&mut owner.0,d,6);
 let end=Instant::now()+Duration::from_secs(5);let d=loop{let d=window(owner.0.id(),"#32770");if !d.is_null()&&title(d)=="Authorize connected client"{break d}assert!(Instant::now()<end,"no actual child approval");thread::sleep(Duration::from_millis(20));};let button=ready_dialog_button(&mut owner.0,d,if approve{6}else{7},Instant::now()+Duration::from_secs(5));let body=dialog_body(d,owner.0.id());assert!(body.contains("LOCAL DIAGNOSTIC ONLY"));assert!(body.contains("computer-link-mcp-session.exe"));post(button,0xf5,0,0);wait_no_dialog(&mut owner.0);wait_title(&mut owner.0,h,if approve{"diagnostic passed; disconnected"}else{"diagnostic refused or failed; disconnected"});
 }
 // Disconnect while the actual child permission is pending kills the owned child;
 // clicking that same stale Yes cannot deliver a snapshot or restore the session.
 post(h,0x111,9,0);let d=wait_window(&mut owner.0,"#32770");click_dialog_button(&mut owner.0,d,6);
 let end=Instant::now()+Duration::from_secs(5);let d=loop{let d=window(owner.0.id(),"#32770");if !d.is_null()&&title(d)=="Authorize connected client"{break d}assert!(Instant::now()<end);thread::sleep(Duration::from_millis(20));};let yes=ready_dialog_button(&mut owner.0,d,6,Instant::now()+Duration::from_secs(5));
 let body=dialog_body(d,owner.0.id());let pid:u32=body.split("PID: ").nth(1).unwrap().lines().next().unwrap().trim().parse().unwrap();
 let child_handle=ProcessHandle(unsafe{OpenProcess(0x100000,0,pid)});assert!(!child_handle.0.is_null(),"cannot observe owned child");
 let mut ignored=0;assert_ne!(unsafe{SendMessageTimeoutW(h,0x8004,0,1,2,1000,&mut ignored)},0);assert!(!title(h).contains("passed"));
 post(h,0x111,4,0);wait_title(&mut owner.0,h,"disconnected");post(yes,0xf5,0,0);wait_no_dialog(&mut owner.0);assert!(title(h).contains("disconnected"));assert_eq!(unsafe{WaitForSingleObject(child_handle.0,2000)},0,"owned child survived Disconnect");
 // Disconnect while first permission is open invalidates even a late Yes.
 post(h,0x111,9,0);let d=wait_window(&mut owner.0,"#32770");let yes=ready_dialog_button(&mut owner.0,d,6,Instant::now()+Duration::from_secs(5));post(h,0x111,4,0);wait_title(&mut owner.0,h,"disconnected");post(yes,0xf5,0,0);wait_no_dialog(&mut owner.0);assert!(title(h).contains("disconnected"));
 post(h,0x111,5,0);let end=Instant::now()+Duration::from_secs(5);loop{if let Some(status)=owner.0.try_wait().unwrap(){assert!(status.success());break}assert!(Instant::now()<end);thread::sleep(Duration::from_millis(20));}
}

#[link(name="kernel32")]unsafe extern "system"{fn OpenProcess(access:u32,inherit:i32,pid:u32)->H;fn WaitForSingleObject(h:H,ms:u32)->u32;fn CloseHandle(h:H)->i32;}
struct ProcessHandle(H);impl Drop for ProcessHandle{fn drop(&mut self){unsafe{CloseHandle(self.0);}}}

// Real sibling/GUI lifecycle; this never opens a host or grants private data.
#[test]
#[ignore = "requires source-built MCP sibling; run by Windows MCP acceptance"]
fn native_interactive_status_consent_requests_disconnect_and_exit(){
 let mut owner=Guard(support::command(env!("CARGO_BIN_EXE_computer-link-owner-proof")).spawn().unwrap());
 let h=wait_window(&mut owner.0,"ComputerLinkOwnerProof");
 for message in [0x8005,0x8006]{let mut ignored=0;assert_ne!(unsafe{SendMessageTimeoutW(h,message,0,1,2,1000,&mut ignored)},0);}
 assert!(title(h).contains("disconnected"));
 post(h,0x111,10,0);let d=wait_window(&mut owner.0,"#32770");
 let no=ready_dialog_button(&mut owner.0,d,7,Instant::now()+Duration::from_secs(5));
 let body=dialog_body(d,owner.0.id());assert!(body.contains("Destination: this Constellation Computer Tools owner only"));assert!(body.contains("No snapshot or file bytes"));assert!(body.contains("computer-link-mcp-session.exe"));post(no,0xf5,0,0);wait_no_dialog(&mut owner.0);assert!(title(h).contains("disconnected"));
 // Late consent cannot start after explicit Disconnect.
 post(h,0x111,10,0);let d=wait_window(&mut owner.0,"#32770");let yes=ready_dialog_button(&mut owner.0,d,6,Instant::now()+Duration::from_secs(5));post(h,0x111,4,0);wait_title(&mut owner.0,h,"disconnected");post(yes,0xf5,0,0);wait_no_dialog(&mut owner.0);assert!(title(h).contains("disconnected"));
 for exit in [false,true]{
  post(h,0x111,10,0);let d=wait_window(&mut owner.0,"#32770");click_dialog_button(&mut owner.0,d,6);wait_no_dialog(&mut owner.0);wait_title(&mut owner.0,h,"local status verified");
  let pid:u32=title(h).split(" | PID ").nth(1).unwrap().parse().unwrap();
  let child_handle=ProcessHandle(unsafe{OpenProcess(0x100000,0,pid)});assert!(!child_handle.0.is_null());assert_eq!(unsafe{WaitForSingleObject(child_handle.0,0)},258);
  // Real repeat checks, same live process; no queued or periodic requests.
  for check in 2..=4{post(h,0x111,11,0);wait_title(&mut owner.0,h,&format!("check {check} |"));assert!(title(h).contains(&format!("PID {pid}")));}
  post(h,0x111,2,0);let d=wait_window(&mut owner.0,"#32770");assert_eq!(title(d),"Constellation Computer Tools local proof");let end=Instant::now()+Duration::from_secs(5);while !dialog_body(d,owner.0.id()).contains("Disconnect the local status session before preparing another grant."){assert!(Instant::now()<end,"wrong grant refusal");thread::sleep(Duration::from_millis(20));}dismiss_notice(owner.0.id(),d);wait_no_dialog(&mut owner.0);assert!(title(h).contains("local status verified"));
  for message in [0x8005,0x8006]{let mut ignored=0;assert_ne!(unsafe{SendMessageTimeoutW(h,message,0,1,2,1000,&mut ignored)},0);}
  assert!(title(h).contains("local status verified"));
  post(h,0x111,if exit{5}else{4},0);
  if !exit{wait_title(&mut owner.0,h,"disconnected");}
  assert_eq!(unsafe{WaitForSingleObject(child_handle.0,3000)},0,"status child survived owner cleanup");
 }
 let end=Instant::now()+Duration::from_secs(5);loop{if let Some(status)=owner.0.try_wait().unwrap(){assert!(status.success());break}assert!(Instant::now()<end);thread::sleep(Duration::from_millis(20));}
}
