#![cfg(windows)]
//! Native file-dialog acceptance on disposable fixtures.
use std::{ffi::c_void,process::Child,time::{Duration,Instant},thread,ptr};
mod support;
type H=*mut c_void;
#[link(name="user32")]unsafe extern "system"{
fn EnumWindows(cb:Option<unsafe extern "system" fn(H,isize)->i32>,d:isize)->i32;fn EnumChildWindows(h:H,cb:Option<unsafe extern "system" fn(H,isize)->i32>,d:isize)->i32;
fn GetWindowThreadProcessId(h:H,p:*mut u32)->u32;fn GetClassNameW(h:H,b:*mut u16,n:i32)->i32;fn GetWindowTextW(h:H,b:*mut u16,n:i32)->i32;fn GetDlgItem(h:H,id:i32)->H;fn GetDlgCtrlID(h:H)->i32;
fn GetWindowLongPtrW(h:H,index:i32)->isize;fn IsWindowEnabled(h:H)->i32;fn IsWindowVisible(h:H)->i32;
fn PostMessageW(h:H,m:u32,w:usize,l:isize)->i32;fn SendMessageTimeoutW(h:H,m:u32,w:usize,l:isize,f:u32,ms:u32,r:*mut usize)->isize;
}
#[link(name="kernel32")]unsafe extern "system"{fn SetLastError(code:u32);fn GetLastError()->u32;}
struct Find{pid:u32,class:&'static str,h:H}
unsafe extern "system" fn visit(h:H,d:isize)->i32{let f=unsafe{&mut*(d as *mut Find)};let mut pid=0;unsafe{GetWindowThreadProcessId(h,&mut pid);}let mut b=[0u16;128];let n=unsafe{GetClassNameW(h,b.as_mut_ptr(),128)};if pid==f.pid&&n>0&&String::from_utf16_lossy(&b[..n as usize])==f.class{f.h=h;return 0}1}
fn find(pid:u32,class:&'static str)->H{let mut f=Find{pid,class,h:ptr::null_mut()};unsafe{EnumWindows(Some(visit),&mut f as *mut _ as isize);}f.h}
fn text(h:H)->String{let mut b=[0u16;32768];let n=unsafe{GetWindowTextW(h,b.as_mut_ptr(),b.len() as i32)};String::from_utf16_lossy(&b[..n.max(0)as usize])}
struct Bodies{pid:u32,rows:Vec<String>,failed:bool}
unsafe extern "system" fn collect(h:H,d:isize)->i32{let state=unsafe{&mut*(d as *mut Bodies)};let mut pid=0;unsafe{GetWindowThreadProcessId(h,&mut pid);}if pid!=state.pid{return 1}let mut class=[0u16;32];let n=unsafe{GetClassNameW(h,class.as_mut_ptr(),32)};if n<=0||String::from_utf16_lossy(&class[..n as usize])!="Static"{return 1}
 let mut buffer=[0u16;32768];let mut count=0usize;let ok=unsafe{SendMessageTimeoutW(h,0xd,buffer.len(),buffer.as_mut_ptr() as isize,2,2000,&mut count)};if ok==0||count>=buffer.len(){state.failed=true;return 0}state.rows.push(String::from_utf16_lossy(&buffer[..count]));1}
fn content(h:H)->String{let mut pid=0;unsafe{GetWindowThreadProcessId(h,&mut pid);}assert_ne!(pid,0);let mut state=Bodies{pid,rows:vec![],failed:false};unsafe{EnumChildWindows(h,Some(collect),&mut state as *mut _ as isize);}assert!(!state.failed,"bounded cross-process WM_GETTEXT failed");state.rows.join("\n")}
struct Field{pid:u32,h:H,seen:Vec<(i32,String)>}
unsafe extern "system" fn filename(h:H,d:isize)->i32{let f=unsafe{&mut*(d as *mut Field)};let mut pid=0;unsafe{GetWindowThreadProcessId(h,&mut pid);}if pid!=f.pid{return 1}let mut b=[0u16;128];let n=unsafe{GetClassNameW(h,b.as_mut_ptr(),128)};if n<=0{return 1}let class=String::from_utf16_lossy(&b[..n as usize]);let id=unsafe{GetDlgCtrlID(h)};if f.seen.len()<100{f.seen.push((id,class.clone()));}if matches!(id,1148|1152)&&matches!(class.as_str(),"ComboBox"|"ComboBoxEx32"|"Edit")&&unsafe{IsWindowVisible(h)!=0&&IsWindowEnabled(h)!=0}{f.h=h;return 0}1}
unsafe extern "system" fn filename_edit(h:H,d:isize)->i32{let f=unsafe{&mut*(d as *mut Field)};let mut pid=0;unsafe{GetWindowThreadProcessId(h,&mut pid);}if pid!=f.pid{return 1}let mut b=[0u16;32];let n=unsafe{GetClassNameW(h,b.as_mut_ptr(),32)};if n>0&&String::from_utf16_lossy(&b[..n as usize])=="Edit"&&unsafe{IsWindowVisible(h)!=0&&IsWindowEnabled(h)!=0}{f.h=h;return 0}1}
fn editable(container:H,pid:u32)->H{let mut f=Field{pid,h:ptr::null_mut(),seen:vec![]};unsafe{filename_edit(container,&mut f as *mut _ as isize);}if f.h.is_null(){unsafe{EnumChildWindows(container,Some(filename_edit),&mut f as *mut _ as isize);}}f.h}
fn field(dialog:H,pid:u32)->Field{let mut f=Field{pid,h:ptr::null_mut(),seen:vec![]};unsafe{EnumChildWindows(dialog,Some(filename),&mut f as *mut _ as isize);}f}
fn post(h:H,m:u32,w:usize,l:isize){assert_ne!(unsafe{PostMessageW(h,m,w,l)},0)}
fn until(pid:u32,phase:&str,mut f:impl FnMut()->bool){let end=Instant::now()+Duration::from_secs(8);while !f(){if Instant::now()>=end{let d=find(pid,"#32770");let caption=if d.is_null(){String::new()}else{text(d)};let body=if d.is_null(){String::new()}else{content(d)};panic!("native dialog condition timed out: phase={phase}, dialog={}, owner_notice={}, permission={}, selected_notice={}, selection_refused={}, choose_required={}",!d.is_null(),caption=="Constellation Computer Tools local proof",caption=="Explicit local permission",body.contains("Nothing shared yet"),body.contains("Selection refused"),body.contains("Choose a bounded UTF-8 file first"));}thread::sleep(Duration::from_millis(20));}}
// MB_OK's visible button uses ID2 on the observed Windows CI build.
// Inspect the sole actionable owned button rather than assuming IDOK=1.
// The caller first verifies the exact informational notice and expected body.
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
 assert_eq!(text(dialog),"Constellation Computer Tools local proof");
 let mut button=ptr::null_mut();let mut id=0;
 until(pid,"notice-button-ready",||{
    let mut dp=0;unsafe{GetWindowThreadProcessId(dialog,&mut dp);}
    if dp!=pid || unsafe{IsWindowVisible(dialog)==0 || IsWindowEnabled(dialog)==0} { return false; }
    let mut state=NoticeButtons{pid,buttons:vec![]};
    unsafe{EnumChildWindows(dialog,Some(notice_button),&mut state as *mut _ as isize);}
    assert!(state.buttons.len()<=1,"informational notice has multiple actionable buttons");
    if let Some(&(h,control_id))=state.buttons.first(){
        assert!(matches!(control_id,1|2),"unexpected informational notice control ID");
        button=h;id=control_id;true
    }else{false}
 });
 eprintln!("notice actionable button: id={id}");
 post(dialog,0x111,id as usize,button as isize);
}
struct Guard(Child);impl Drop for Guard{fn drop(&mut self){if self.0.try_wait().ok().flatten().is_none(){let _=self.0.kill();let _=self.0.wait();}}}
#[test]fn actual_file_dialog_selection_and_cancel_preserve_fixture(){ file_dialog_case(false,false,false); }
#[test]fn disconnected_file_dialog_cannot_capture_stale_selection(){ file_dialog_case(true,false,false); }
#[test]fn selected_link_requires_explicit_browser_confirmation(){ file_dialog_case(false,true,false); }
#[test]fn maximum_link_prompt_retains_exact_target(){ file_dialog_case(false,true,true); }
fn file_dialog_case(disconnect_while_open:bool,browser_link:bool,long_link:bool){
 let dir=std::env::temp_dir().join(format!("owner-dialog-{}-{}",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));std::fs::create_dir(&dir).unwrap();let path=dir.join("fixture.txt");let long_url=format!("https://example.com/{}#end", "x".repeat(2048-"https://example.com/".len()-"#end".len()));let fixture:&[u8]=if long_link {long_url.as_bytes()} else if browser_link {b"https://example.com/approved-path?query=value"} else {b"native dialog fixture"};if long_link {assert_eq!(fixture.len(),2048);assert!(computer_link_owner_proof::browser_handoff::HttpsLink::parse(fixture).is_ok());}std::fs::write(&path,fixture).unwrap();
 let mut owner=Guard(support::command(env!("CARGO_BIN_EXE_computer-link-owner-proof")).spawn().unwrap());let pid=owner.0.id();until(pid,"owner-window",||!find(pid,"ComputerLinkOwnerProof").is_null());let h=find(pid,"ComputerLinkOwnerProof");
 post(h,0x111,1,0);until(pid,"choose-dialog",||!find(pid,"#32770").is_null());let dialog=find(pid,"#32770");let deadline=Instant::now()+Duration::from_secs(8);let field=loop{let f=field(dialog,pid);if !f.h.is_null(){let edit=editable(f.h,pid);if !edit.is_null(){break edit}}assert!(Instant::now()<deadline,"native filename control missing; class/id metadata only: {:?}",f.seen);thread::sleep(Duration::from_millis(20));};
 use std::os::windows::ffi::OsStrExt;let value:Vec<u16>=path.as_os_str().encode_wide().chain(Some(0)).collect();let mut result=0;unsafe{SetLastError(0);}let sent=unsafe{SendMessageTimeoutW(field,0xc,0,value.as_ptr() as isize,2,2000,&mut result)};let set_error=unsafe{GetLastError()};let mut observed=vec![0u16;32768];let mut length=0;unsafe{SetLastError(0);}let read=unsafe{SendMessageTimeoutW(field,0xd,observed.len(),observed.as_mut_ptr() as isize,2,2000,&mut length)};let read_error=unsafe{GetLastError()};let exact=length<observed.len()&&observed[..length]==value[..value.len()-1];
 // Bounded metadata only: no field contents, paths or secrets in diagnostics.
 eprintln!("filename diagnostics: sent={sent} result={result} set_error={set_error} read={read} read_error={read_error} count={length} exact={exact} id={} enabled={} visible={} style={:#x}",unsafe{GetDlgCtrlID(field)},unsafe{IsWindowEnabled(field)},unsafe{IsWindowVisible(field)},unsafe{GetWindowLongPtrW(field,-16)});
 assert_ne!(sent,0,"WM_SETTEXT dispatch failed");assert_ne!(result,0,"filename Edit refused WM_SETTEXT");assert_ne!(read,0,"WM_GETTEXT dispatch failed");assert!(length<observed.len());assert!(exact,"filename readback differs");
 if disconnect_while_open {
  // Synchronously process Disconnect inside the modal file dialog's message loop.
  // Require success and the owner still being disconnected before confirming Open.
  let mut acknowledged=0;
  assert_ne!(unsafe{SendMessageTimeoutW(h,0x111,4,0,2,2000,&mut acknowledged)},0,"Disconnect dispatch failed");
  assert!(text(h).contains("disconnected"));
 }
 post(dialog,0x111,1,0);
 if disconnect_while_open {
  until(pid,"stale-selection-dismissed",||find(pid,"#32770").is_null());
  // A stale dialog must not retain readable file data or create a new read grant.
  post(h,0x111,3,0);until(pid,"stale-selection-refused",||!find(pid,"#32770").is_null());
  let refusal=find(pid,"#32770");assert!(content(refusal).contains("Choose a bounded UTF-8 file first"));
  dismiss_notice(pid,refusal);until(pid,"stale-refusal-dismissed",||find(pid,"#32770").is_null());
  assert!(text(h).contains("disconnected"));
  post(h,0x111,5,0);until(pid,"stale-owner-exited",||owner.0.try_wait().unwrap().is_some());
  assert!(owner.0.try_wait().unwrap().unwrap().success());
  assert_eq!(std::fs::read(&path).unwrap(),fixture);std::fs::remove_dir_all(dir).unwrap();return;
 }
 until(pid,"selected-notice",||{let d=find(pid,"#32770");!d.is_null()&&text(d)=="Constellation Computer Tools local proof"&&content(d).contains("Nothing shared yet")});let notice=find(pid,"#32770");assert!(content(notice).contains(&format!("{} bytes",fixture.len())));dismiss_notice(pid,notice);until(pid,"selected-notice-dismissed",||find(pid,"#32770").is_null());
 if browser_link {
  post(h,0x111,7,0);
  until(pid,"browser-confirmation",||{let d=find(pid,"#32770");!d.is_null()&&text(d)=="Open HTTPS link locally"});
  let dialog=find(pid,"#32770");
  // A window title can be set before static controls and buttons exist.
  // Wait for this exact expected body, without weakening the final equality
  // substring assertion using the existing per-phase readiness timeout.
  until(pid,"browser-confirmation-body-ready",||content(dialog).contains(std::str::from_utf8(fixture).unwrap()));
  let body=content(dialog);
  assert!(body.contains(std::str::from_utf8(fixture).unwrap()),"exact URL absent from dialog text");
  assert!(body.contains("Host: example.com"));assert!(body.contains("cookies"));assert!(body.contains("remains open"));
  until(pid,"browser-deny-ready",||{let no=unsafe{GetDlgItem(dialog,7)};!no.is_null()&&unsafe{IsWindowVisible(no)!=0&&IsWindowEnabled(no)!=0}});
  post(unsafe{GetDlgItem(dialog,7)},0xf5,0,0);
  until(pid,"browser-denied",||find(pid,"#32770").is_null());
  assert!(text(h).contains("disconnected"));
 }
 // Selecting alone never opens a grant; an explicit read confirmation remains necessary.
 assert!(text(h).contains("disconnected"));post(h,0x111,3,0);until(pid,"read-permission",||!find(pid,"#32770").is_null());let permission=find(pid,"#32770");assert!(content(permission).contains("fixture.txt"));post(unsafe{GetDlgItem(permission,7)},0xf5,0,0);until(pid,"read-permission-dismissed",||find(pid,"#32770").is_null());assert!(text(h).contains("disconnected"));
 // Cancel a new selection; the prior choice must not silently remain selectable.
 post(h,0x111,1,0);until(pid,"reselection-dialog",||!find(pid,"#32770").is_null());post(find(pid,"#32770"),0x111,2,0);until(pid,"reselection-cancelled",||find(pid,"#32770").is_null());post(h,0x111,3,0);until(pid,"missing-selection-notice",||!find(pid,"#32770").is_null());let refusal=find(pid,"#32770");assert!(content(refusal).contains("Choose a bounded UTF-8 file first"));dismiss_notice(pid,refusal);until(pid,"missing-selection-dismissed",||find(pid,"#32770").is_null());
 post(h,0x111,5,0);until(pid,"owner-exited",||owner.0.try_wait().unwrap().is_some());assert!(owner.0.try_wait().unwrap().unwrap().success());assert_eq!(std::fs::read(&path).unwrap(),fixture);std::fs::remove_dir_all(dir).unwrap();
}

#[test]fn folder_picker_cancel_creates_no_capture_or_grant(){
 let mut owner=Guard(support::command(env!("CARGO_BIN_EXE_computer-link-owner-proof")).spawn().unwrap());let pid=owner.0.id();
 until(pid,"folder-owner-window",||!find(pid,"ComputerLinkOwnerProof").is_null());let h=find(pid,"ComputerLinkOwnerProof");
 post(h,0x111,8,0);until(pid,"folder-picker",||{let d=find(pid,"#32770");!d.is_null()&&content(d).contains("Select ONE local folder")});let dialog=find(pid,"#32770");
 assert!(content(dialog).contains("Select ONE local folder"));
 until(pid,"folder-cancel-ready",||{let cancel=unsafe{GetDlgItem(dialog,2)};!cancel.is_null()&&unsafe{IsWindowVisible(cancel)!=0&&IsWindowEnabled(cancel)!=0}});
 post(unsafe{GetDlgItem(dialog,2)},0xf5,0,0);until(pid,"folder-picker-cancelled",||find(pid,"#32770").is_null());
 assert!(text(h).contains("disconnected"));
 post(h,0x111,3,0);until(pid,"folder-cancel-no-capture",||{let d=find(pid,"#32770");!d.is_null()&&content(d).contains("Choose a bounded UTF-8 file first")});let refusal=find(pid,"#32770");
 assert!(content(refusal).contains("Choose a bounded UTF-8 file first"));dismiss_notice(pid,refusal);
 until(pid,"folder-refusal-dismissed",||find(pid,"#32770").is_null());post(h,0x111,5,0);
 until(pid,"folder-owner-exited",||owner.0.try_wait().unwrap().is_some());assert!(owner.0.try_wait().unwrap().unwrap().success());
}

#[repr(C)]struct GuiThreadInfo{size:u32,flags:u32,active:H,focus:H,capture:H,menu:H,moving:H,caret:H,rect:[i32;4]}
#[link(name="user32")]unsafe extern "system"{fn GetGUIThreadInfo(thread:u32,info:*mut GuiThreadInfo)->i32;}
fn keyboard_focus(h:H)->H{let tid=unsafe{GetWindowThreadProcessId(h,ptr::null_mut())};let mut info:GuiThreadInfo=unsafe{std::mem::zeroed()};info.size=std::mem::size_of::<GuiThreadInfo>() as u32;assert_ne!(unsafe{GetGUIThreadInfo(tid,&mut info)},0);info.focus}
fn set_edit(h:H,value:&str){let v:Vec<u16>=value.encode_utf16().chain(Some(0)).collect();let mut r=0;assert_ne!(unsafe{SendMessageTimeoutW(h,0xc,0,v.as_ptr() as isize,2,2000,&mut r)},0);assert_ne!(r,0);}
fn read_edit(h:H)->String{let mut b=vec![0u16;32768];let mut n=0;assert_ne!(unsafe{SendMessageTimeoutW(h,0xd,b.len(),b.as_mut_ptr() as isize,2,2000,&mut n)},0);assert!(n<b.len());String::from_utf16_lossy(&b[..n])}
fn select_export_fixture(h:H,pid:u32,path:&std::path::Path){
 post(h,0x111,1,0);until(pid,"export-source-dialog",||!find(pid,"#32770").is_null());let d=find(pid,"#32770");let mut edit=ptr::null_mut();
 until(pid,"export-source-edit",||{let f=field(d,pid);if !f.h.is_null(){edit=editable(f.h,pid);}!edit.is_null()});
 set_edit(edit,path.to_str().unwrap());post(d,0x111,1,0);
 until(pid,"export-source-captured",||{let d=find(pid,"#32770");!d.is_null()&&text(d)=="Constellation Computer Tools local proof"&&content(d).contains("Nothing shared yet")});
 dismiss_notice(pid,find(pid,"#32770"));until(pid,"export-source-notice-closed",||find(pid,"#32770").is_null());
}
fn open_export_preview(h:H,pid:u32,destination:&std::path::Path)->H{
 post(h,0x111,12,0);
 until(pid,"export-folder-picker",||{let d=find(pid,"#32770");!d.is_null()&&content(d).contains("trusted local NTFS folder")});let d=find(pid,"#32770");
 let mut edit=ptr::null_mut();until(pid,"export-folder-edit",||{edit=editable(d,pid);!edit.is_null()});
 set_edit(edit,destination.to_str().unwrap());post(d,0x111,1,0);
 // EnumWindows can observe CreateWindowEx before show() has created its controls.
 // Never cache a null GetDlgItem result as the expected keyboard-focus handle.
 let mut preview=ptr::null_mut();let mut observed_unready=false;
 until(pid,"export-scrollable-preview",||{
  let p=find(pid,"ComputerLinkExportPreview");if p.is_null(){return false}
  if unsafe{IsWindowVisible(p)}==0{observed_unready=true;return false}
  for id in [100,1,2] {
   let control=unsafe{GetDlgItem(p,id)};let mut owner_pid=0;
   if control.is_null(){observed_unready=true;return false}unsafe{GetWindowThreadProcessId(control,&mut owner_pid);}
   if owner_pid!=pid||unsafe{IsWindowVisible(control)}==0||unsafe{IsWindowEnabled(control)}==0{return false}
  }
  let cancel=unsafe{GetDlgItem(p,2)};
  if keyboard_focus(p)!=cancel{return false}
  preview=p;true
 });eprintln!("synthetic preview readiness: observed_hidden_or_missing_controls={observed_unready}");preview
}
fn export_result(pid:u32,expected:&str){
 until(pid,"export-result",||{let d=find(pid,"#32770");!d.is_null()&&text(d)=="Constellation Computer Tools local proof"&&content(d).contains(expected)});
 dismiss_notice(pid,find(pid,"#32770"));until(pid,"export-result-dismissed",||find(pid,"#32770").is_null());
}
fn click_export(pid:u32,p:H,id:i32){until(pid,"export-button-ready",||{let b=unsafe{GetDlgItem(p,id)};!b.is_null()&&unsafe{IsWindowEnabled(b)!=0&&IsWindowVisible(b)!=0}});post(unsafe{GetDlgItem(p,id)},0xf5,0,0);}

// Test-only spelling adapter for disposable trusted NTFS fixtures. Never use
// string normalization alone as proof of destination identity.
#[repr(C)]
struct FileInformation {
 attributes:u32, creation:[u32;2], access:[u32;2], write:[u32;2],
 volume:u32, size_high:u32, size_low:u32, links:u32, index_high:u32, index_low:u32,
}
#[link(name="kernel32")]unsafe extern "system" {
 fn GetLongPathNameW(input:*const u16,output:*mut u16,size:u32)->u32;
 fn GetFileInformationByHandle(handle:H,information:*mut FileInformation)->i32;
}
fn fixture_long_path(path:&std::path::Path)->std::path::PathBuf {
 use std::os::windows::{ffi::{OsStrExt,OsStringExt},fs::OpenOptionsExt,io::AsRawHandle};
 let input:Vec<u16>=path.as_os_str().encode_wide().chain(Some(0)).collect();
 assert!(!input[..input.len()-1].contains(&0));
 let mut output=vec![0u16;32768];
 let n=unsafe{GetLongPathNameW(input.as_ptr(),output.as_mut_ptr(),output.len() as u32)} as usize;
 assert!(n>0&&n<output.len(),"fixture path expansion failed: {}",std::io::Error::last_os_error());
 assert_eq!(output[n],0);
 let expanded=std::path::PathBuf::from(std::ffi::OsString::from_wide(&output[..n]));
 let open=|p:&std::path::Path|std::fs::OpenOptions::new().access_mode(0)
     .share_mode(7).custom_flags(0x02000000|0x00200000).open(p).unwrap();
 // Keep both handles alive during comparison; reject a final-component reparse.
 let original=open(path);let long=open(&expanded);
 let identity=|file:&std::fs::File|{
   let mut info:FileInformation=unsafe{std::mem::zeroed()};
   assert_ne!(unsafe{GetFileInformationByHandle(file.as_raw_handle(),&mut info)},0,
       "fixture identity query failed: {}",std::io::Error::last_os_error());
   assert_ne!(info.attributes&0x10,0,"fixture must be a directory");
   assert_eq!(info.attributes&0x400,0,"fixture must not be a reparse point");
   (info.volume,info.index_high,info.index_low)
 };
 assert_eq!(identity(&original),identity(&long),"short and expanded fixture paths differ");
 expanded
}
#[test]fn local_export_exact_preview_deny_save_and_preserve_existing(){
 let dir=std::env::temp_dir().join(format!("owner-export-{}-{}",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));std::fs::create_dir(&dir).unwrap();
 let dest=dir.join("destination");std::fs::create_dir(&dest).unwrap();let source=dir.join("source.txt");let fixture=format!("{}\nEND-EXACT-EXPORT", "x".repeat(4079));assert_eq!(fixture.len(),4096);std::fs::write(&source,&fixture).unwrap();
 let mut owner=Guard(support::command(env!("CARGO_BIN_EXE_computer-link-owner-proof")).spawn().unwrap());let pid=owner.0.id();until(pid,"export-owner",||!find(pid,"ComputerLinkOwnerProof").is_null());let h=find(pid,"ComputerLinkOwnerProof");select_export_fixture(h,pid,&source);
 let p=open_export_preview(h,pid,&dest);let e=unsafe{GetDlgItem(p,100)};assert!(!e.is_null());let display=read_edit(e);assert!(display.contains(&format!("{fixture:?}")));let expected=fixture_long_path(&dest);assert_eq!(display.lines().next(),Some(format!("Selected local folder: {expected:?}").as_str()),"exact expanded synthetic destination required");assert!(display.contains("computer-link-export.txt"));assert!(display.contains("No overwrite"));assert_ne!(unsafe{GetWindowLongPtrW(e,-16)}&0x800,0,"preview must be read-only");
 let no=unsafe{GetDlgItem(p,2)};until(pid,"export-default-cancel-focus",||keyboard_focus(p)==no);
 post(no,0x100,0x0d,0);export_result(pid,"cancelled");assert_eq!(std::fs::read_dir(&dest).unwrap().count(),0);
 // Enter and Escape from the readonly text itself must also deny, never create.
 for key in [13usize,27] {
  let p=open_export_preview(h,pid,&dest);let no=unsafe{GetDlgItem(p,2)};let edit=unsafe{GetDlgItem(p,100)};
  until(pid,"export-text-default",||keyboard_focus(p)==no);post(no,0x100,9,0);
  until(pid,"export-text-focus",||keyboard_focus(p)==edit);post(edit,0x100,key,0);
  export_result(pid,"cancelled");assert_eq!(std::fs::read_dir(&dest).unwrap().count(),0);
 }
 // Tab traversal remains usable, but Escape always denies even with Create focused.
 let p=open_export_preview(h,pid,&dest);let no=unsafe{GetDlgItem(p,2)};let edit=unsafe{GetDlgItem(p,100)};let yes=unsafe{GetDlgItem(p,1)};
 until(pid,"export-second-default",||keyboard_focus(p)==no);post(no,0x100,9,0);until(pid,"export-tab-edit",||keyboard_focus(p)==edit);
 // Bounded control metadata only; no preview/owner data is logged.
 let mut dlgcode=0;assert_ne!(unsafe{SendMessageTimeoutW(edit,0x87,9,0,2,2000,&mut dlgcode)},0);
 assert_eq!(dlgcode&6,0,"preview must yield Tab to dialog navigation");
 eprintln!("synthetic tab-before: focus_id={}, edit_dlgcode={dlgcode:#x}, create_enabled={}, create_visible={}",
   unsafe{GetDlgCtrlID(keyboard_focus(p))},unsafe{IsWindowEnabled(yes)},unsafe{IsWindowVisible(yes)});
 post(edit,0x100,9,0);thread::sleep(Duration::from_millis(150));
 eprintln!("synthetic tab-after: focus_id={}",unsafe{GetDlgCtrlID(keyboard_focus(p))});
 until(pid,"export-tab-create",||keyboard_focus(p)==yes);post(yes,0x100,0x1b,0);export_result(pid,"cancelled");assert_eq!(std::fs::read_dir(&dest).unwrap().count(),0);
 let p=open_export_preview(h,pid,&dest);click_export(pid,p,2);export_result(pid,"cancelled");assert_eq!(std::fs::read_dir(&dest).unwrap().count(),0);
 let p=open_export_preview(h,pid,&dest);click_export(pid,p,1);export_result(pid,"Created computer-link-export.txt");assert_eq!(std::fs::read_to_string(dest.join("computer-link-export.txt")).unwrap(),fixture);
 let p=open_export_preview(h,pid,&dest);click_export(pid,p,1);export_result(pid,"Export not confirmed");assert_eq!(std::fs::read_to_string(dest.join("computer-link-export.txt")).unwrap(),fixture);assert!(dest.join("computer-link-export.txt.pending").exists());
 post(h,0x111,5,0);until(pid,"export-owner-exit",||owner.0.try_wait().unwrap().is_some());assert!(owner.0.try_wait().unwrap().unwrap().success());assert_eq!(std::fs::read_to_string(&source).unwrap(),fixture);std::fs::remove_dir_all(dir).unwrap();
}
struct Named{pid:u32,title:&'static str,h:H}
unsafe extern "system" fn named_visit(h:H,data:isize)->i32{let n=unsafe{&mut*(data as *mut Named)};let mut p=0;unsafe{GetWindowThreadProcessId(h,&mut p);}if p==n.pid&&text(h)==n.title{n.h=h;return 0}1}
fn named(pid:u32,title:&'static str)->H{let mut n=Named{pid,title,h:ptr::null_mut()};unsafe{EnumWindows(Some(named_visit),&mut n as *mut _ as isize);}n.h}
#[test]fn local_export_disconnect_fences_preview_and_exit_ends_picker(){
 let dir=std::env::temp_dir().join(format!("owner-export-cancel-{}-{}",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));std::fs::create_dir(&dir).unwrap();let source=dir.join("source.txt");std::fs::write(&source,"cancelled fixture").unwrap();let dest=dir.join("destination");std::fs::create_dir(&dest).unwrap();
 let mut owner=Guard(support::command(env!("CARGO_BIN_EXE_computer-link-owner-proof")).spawn().unwrap());let pid=owner.0.id();until(pid,"export-cancel-owner",||!find(pid,"ComputerLinkOwnerProof").is_null());let h=find(pid,"ComputerLinkOwnerProof");select_export_fixture(h,pid,&source);
 let _preview=open_export_preview(h,pid,&dest);
 for m in [0x8007,0x8008]{let mut r=0;assert_ne!(unsafe{SendMessageTimeoutW(h,m,1,1,2,1000,&mut r)},0);}
 assert_eq!(std::fs::read_dir(&dest).unwrap().count(),0);
 post(h,0x111,4,0);until(pid,"export-revoked-preview",||find(pid,"ComputerLinkExportPreview").is_null());export_result(pid,"cancelled");assert_eq!(std::fs::read_dir(&dest).unwrap().count(),0);
 post(h,0x111,12,0);until(pid,"export-exit-picker",||{let d=find(pid,"#32770");!d.is_null()&&content(d).contains("trusted local NTFS folder")});
 let mut r=0;assert_ne!(unsafe{SendMessageTimeoutW(h,0,0,0,2,1000,&mut r)},0,"folder picker must not block main UI");
 post(h,0x111,5,0);until(pid,"export-exit-warning",||!named(pid,"Exit during local export").is_null());let d=named(pid,"Exit during local export");assert!(content(d).contains("outcome")||content(d).contains("may already exist"));
 until(pid,"export-exit-yes",||{let b=unsafe{GetDlgItem(d,6)};!b.is_null()&&unsafe{IsWindowEnabled(b)!=0&&IsWindowVisible(b)!=0}});post(unsafe{GetDlgItem(d,6)},0xf5,0,0);
 until(pid,"export-picker-process-exited",||owner.0.try_wait().unwrap().is_some());assert!(owner.0.try_wait().unwrap().unwrap().success());assert_eq!(std::fs::read_dir(&dest).unwrap().count(),0);std::fs::remove_dir_all(dir).unwrap();
}
