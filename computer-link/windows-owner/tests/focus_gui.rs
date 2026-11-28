#![cfg(windows)]
//! Synthetic local GUI/Job lifecycle. No real user window or remote connection.
use std::{ffi::c_void,ptr,thread,time::{Duration,Instant}};
use computer_link_owner_proof::Owner;
mod support;
type H=*mut c_void;
#[link(name="user32")]unsafe extern "system"{
 fn EnumWindows(cb:Option<unsafe extern "system" fn(H,isize)->i32>,d:isize)->i32;
 fn GetWindowThreadProcessId(h:H,p:*mut u32)->u32;
 fn GetClassNameW(h:H,b:*mut u16,n:i32)->i32;
 fn GetDlgItem(h:H,id:i32)->H;
 fn PostMessageW(h:H,m:u32,w:usize,l:isize)->i32;
 fn SendMessageW(h:H,m:u32,w:usize,l:isize)->isize;
 fn IsWindowVisible(h:H)->i32;fn IsWindowEnabled(h:H)->i32;
}
struct Search{pid:u32,class:&'static str,h:H}
unsafe extern "system" fn visit(h:H,d:isize)->i32{let s=unsafe{&mut*(d as *mut Search)};let mut pid=0;unsafe{GetWindowThreadProcessId(h,&mut pid);}if pid==s.pid{let mut b=[0;128];let n=unsafe{GetClassNameW(h,b.as_mut_ptr(),128)};if n>0&&String::from_utf16_lossy(&b[..n as usize])==s.class{s.h=h;return 0}}1}
fn window(pid:u32,class:&'static str)->H{let mut s=Search{pid,class,h:ptr::null_mut()};unsafe{EnumWindows(Some(visit),&mut s as *mut _ as isize);}s.h}
fn wait(f:impl Fn()->bool){let end=Instant::now()+Duration::from_secs(10);while !f(){assert!(Instant::now()<end,"GUI condition timed out");thread::sleep(Duration::from_millis(10));}}
fn ready(pid:u32,class:&'static str,id:i32)->(H,H){wait(||{let h=window(pid,class);let b=unsafe{GetDlgItem(h,id)};!h.is_null()&&!b.is_null()&&unsafe{IsWindowVisible(b)}!=0&&unsafe{IsWindowEnabled(b)}!=0});let h=window(pid,class);(h,unsafe{GetDlgItem(h,id)})}
fn click(h:H){assert_ne!(unsafe{PostMessageW(h,0xf5,0,0)},0);}
fn start()->(Owner,u32){let mut owner=Owner::default();owner.launch_owned_worker(std::path::Path::new(support::command(env!("CARGO_BIN_EXE_computer-link-owner-proof")).get_program()),&["--local-focus-selector".into()]).unwrap();let pid=owner.local_worker_pid().unwrap();(owner,pid)}
#[test]fn selector_default_cancel_closes_without_window_list(){let(mut owner,pid)=start();let(h,cancel)=ready(pid,"#32770",2);assert_eq!(unsafe{SendMessageW(h,0x400,0,0)}&0xffff,2,"Cancel must be default");click(cancel);wait(||owner.local_worker_exit_code().unwrap().is_some());assert!(window(pid,"ComputerLinkLocalFocusSelector").is_null());owner.disconnect().unwrap();}
#[test]fn selector_can_cancel_after_explicit_capture(){let(mut owner,pid)=start();let(_,yes)=ready(pid,"#32770",1);click(yes);let(_,cancel)=ready(pid,"ComputerLinkLocalFocusSelector",2);click(cancel);wait(||owner.local_worker_exit_code().unwrap().is_some());owner.disconnect().unwrap();}
#[test]fn disconnect_terminates_pending_capture_consent(){let(mut owner,pid)=start();let _=ready(pid,"#32770",2);owner.disconnect().unwrap();assert!(window(pid,"#32770").is_null());assert!(owner.local_worker_pid().is_none());}
#[test]fn disconnect_terminates_open_selector(){let(mut owner,pid)=start();let(_,yes)=ready(pid,"#32770",1);click(yes);let _=ready(pid,"ComputerLinkLocalFocusSelector",2);owner.disconnect().unwrap();assert!(window(pid,"ComputerLinkLocalFocusSelector").is_null());}
#[test]fn owner_drop_terminates_pending_selector(){let(owner,pid)=start();let _=ready(pid,"#32770",2);drop(owner);wait(||window(pid,"#32770").is_null());}
#[link(name="user32")]unsafe extern "system"{
 fn CreateWindowExW(ex:u32,class:*const u16,title:*const u16,style:u32,x:i32,y:i32,w:i32,h:i32,parent:H,menu:H,instance:H,param:H)->H;
 fn DestroyWindow(h:H)->i32;fn GetForegroundWindow()->H;fn SetForegroundWindow(h:H)->i32;
}
fn wide(s:&str)->Vec<u16>{s.encode_utf16().chain(Some(0)).collect()}
struct Fixture(H);impl Drop for Fixture{fn drop(&mut self){unsafe{DestroyWindow(self.0);}}}
fn fixture(title:&str)->Fixture{let n=ptr::null_mut();let h=unsafe{CreateWindowExW(0,wide("STATIC").as_ptr(),wide(title).as_ptr(),0x10000000,0,0,100,100,n,n,n,n)};assert!(!h.is_null());Fixture(h)}
#[test]fn selected_prompt_cancel_close_duplicate_and_disconnect(){
 for mode in ["cancel","close","duplicate","disconnect"]{
 let f=fixture("Disposable unique foreground GUI target");let neutral=fixture("Disposable neutral foreground GUI fixture");assert_ne!(unsafe{SetForegroundWindow(neutral.0)},0);
 let(mut owner,pid)=start();let(_,yes)=ready(pid,"#32770",1);click(yes);let(selector,_)=ready(pid,"ComputerLinkLocalFocusSelector",3);
 let list=unsafe{GetDlgItem(selector,10)};let row=unsafe{SendMessageW(list,0x18f,usize::MAX,wide("Disposable unique foreground GUI target").as_ptr() as isize)};assert!(row>=0);unsafe{SendMessageW(list,0x186,row as usize,0);}
 assert_ne!(unsafe{PostMessageW(selector,0x111,3,0)},0);let(dialog,cancel)=ready(pid,"#32770",2);
 assert_eq!(unsafe{SendMessageW(dialog,0x400,0,0)}&0xffff,2);
 match mode{
 "disconnect"=>{owner.disconnect().unwrap();},
 "close"=>{assert_ne!(unsafe{PostMessageW(selector,0x10,0,0)},0);let _=unsafe{PostMessageW(dialog,0x111,1,0)};wait(||owner.local_worker_exit_code().unwrap().is_some());},
 "duplicate"=>{assert_ne!(unsafe{PostMessageW(selector,0x111,3,0)},0);click(cancel);wait(||owner.local_worker_exit_code().unwrap().is_some());},
 _=>{click(cancel);wait(||owner.local_worker_exit_code().unwrap().is_some());}}
 assert_ne!(unsafe{GetForegroundWindow()},f.0,"cancelled target must not become foreground");owner.disconnect().unwrap();
 }
}
#[test]fn selector_enter_and_escape_cancel(){for key in [13,27]{let(mut owner,pid)=start();let(_,yes)=ready(pid,"#32770",1);click(yes);let(h,_)=ready(pid,"ComputerLinkLocalFocusSelector",2);assert_ne!(unsafe{PostMessageW(h,0x100,key,0)},0);wait(||owner.local_worker_exit_code().unwrap().is_some());owner.disconnect().unwrap();}}

#[repr(C)]struct GuiThreadInfo{size:u32,flags:u32,active:H,focus:H,capture:H,menu:H,move_size:H,caret:H,caret_rect:[i32;4]}
#[link(name="user32")]unsafe extern "system"{fn GetGUIThreadInfo(thread:u32,info:*mut GuiThreadInfo)->i32;}
fn focused(thread:u32)->H{
 let mut info:GuiThreadInfo=unsafe{std::mem::zeroed()};info.size=std::mem::size_of_val(&info) as u32;
 if unsafe{GetGUIThreadInfo(thread,&mut info)}==0{ptr::null_mut()}else{info.focus}
}
fn key(h:H,key:usize){assert_ne!(unsafe{PostMessageW(h,0x100,key,0)},0);}
#[test]fn keyboard_tab_arrow_review_and_default_cancel(){
 let fixture_title="Constellation Computer Tools keyboard disposable fixture";
 let _fixture=fixture(fixture_title);
 let(mut owner,pid)=start();let(_,allow)=ready(pid,"#32770",1);click(allow);
 let(selector,cancel)=ready(pid,"ComputerLinkLocalFocusSelector",2);
 let mut actual_pid=0;
 let thread=unsafe{GetWindowThreadProcessId(selector,&mut actual_pid)};
 assert_eq!(actual_pid,pid);assert_ne!(thread,0);
 let list=unsafe{GetDlgItem(selector,10)};let review=unsafe{GetDlgItem(selector,3)};
 assert!(!list.is_null()&&!review.is_null());
 wait(||focused(thread)==cancel);
 key(cancel,9);wait(||focused(thread)==list);
 let row=unsafe{SendMessageW(list,0x18f,usize::MAX,wide(fixture_title).as_ptr() as isize)};
 assert!(row>=0);
 // Press Home and Down in the actual list to reach the known disposable row.
 key(list,0x24);wait(||unsafe{SendMessageW(list,0x188,0,0)}==0);
 for target in 1..=row{key(list,0x28);wait(||unsafe{SendMessageW(list,0x188,0,0)}==target);}
 key(list,9);wait(||focused(thread)==review);
 key(review,13);
 let(dialog,cancel)=ready(pid,"#32770",2);
 assert_eq!(unsafe{SendMessageW(dialog,0x400,0,0)}&0xffff,2,"final confirmation stays Cancel-default");
 click(cancel);wait(||owner.local_worker_exit_code().unwrap().is_some());owner.disconnect().unwrap();
}
