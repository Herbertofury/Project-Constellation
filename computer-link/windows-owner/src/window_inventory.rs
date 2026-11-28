//! Explicit, read-only capture. Identifiers/titles are untrusted observations, not control grants.
use std::{ffi::c_void,io};
type H=*mut c_void;
#[link(name="user32")] unsafe extern "system"{
 fn EnumWindows(cb:Option<unsafe extern "system" fn(H,isize)->i32>,data:isize)->i32;
 fn IsWindowVisible(h:H)->i32;fn GetWindowThreadProcessId(h:H,p:*mut u32)->u32;
 fn GetWindowTextW(h:H,b:*mut u16,n:i32)->i32;
}
struct Capture{pid:Option<u32>,rows:usize,seen:usize,text:String,failed:bool}
unsafe extern "system" fn visit(h:H,data:isize)->i32{
 let c=unsafe{&mut*(data as *mut Capture)};c.seen+=1;if c.seen>4096{c.failed=true;return 0}
 let mut pid=0;unsafe{GetWindowThreadProcessId(h,&mut pid);}if pid==0||c.pid.is_some_and(|p|p!=pid)||unsafe{IsWindowVisible(h)}==0{return 1}
 let mut b=[0u16;257];let n=unsafe{GetWindowTextW(h,b.as_mut_ptr(),257)};if n<0||n>=256{c.failed=true;return 0}
 let Ok(title)=String::from_utf16(&b[..n as usize])else{c.failed=true;return 0};
 let title:String=title.chars().map(|v|if v.is_control()||matches!(v,'\u{202a}'..='\u{202e}'|'\u{2066}'..='\u{2069}'){'�'}else{v}).collect();
 if !append(c,pid,h as usize,&title){return 0}1
}
fn append(c:&mut Capture,pid:u32,handle:usize,title:&str)->bool{
 let row=format!("PID {pid}; HWND {handle:x}; title: {title}\n");
 if c.rows>=32||c.text.len()+row.len()>4096{c.failed=true;return false}c.rows+=1;c.text.push_str(&row);true
}
fn capture(pid:Option<u32>)->io::Result<Vec<u8>>{
 let mut c=Capture{pid,rows:0,seen:0,text:"Visible top-level window snapshot. Unverified titles; identifiers may become stale. No control authority.\n".into(),failed:false};
 if unsafe{EnumWindows(Some(visit),&mut c as *mut _ as isize)}==0||c.failed{return Err(io::Error::other("window inventory unavailable or exceeds bounded capture"))}Ok(c.text.into_bytes())
}
pub fn consent_current(captured:u64,current:u64)->bool{captured==current}
pub fn capture_if_current<T>(captured:u64,current:u64,read:impl FnOnce()->T)->Option<T>{if consent_current(captured,current){Some(read())}else{None}}
/// Caller must obtain explicit local capture consent before calling. Never auto-shares.
pub fn capture_visible()->io::Result<Vec<u8>>{capture(None)}
#[cfg(test)]mod tests{
 use super::*;use std::ptr;
 #[link(name="user32")]unsafe extern "system"{fn CreateWindowExW(ex:u32,class:*const u16,title:*const u16,style:u32,x:i32,y:i32,w:i32,h:i32,parent:H,menu:H,instance:H,param:H)->H;fn DestroyWindow(h:H)->i32;}
 struct Window(H);impl Drop for Window{fn drop(&mut self){unsafe{DestroyWindow(self.0);}}}
 fn window(title:&str,visible:bool)->Window{let class:Vec<u16>="STATIC\0".encode_utf16().collect();let title:Vec<u16>=title.encode_utf16().chain(Some(0)).collect();let h=unsafe{CreateWindowExW(0,class.as_ptr(),title.as_ptr(),if visible{0x10000000}else{0},0,0,100,50,ptr::null_mut(),ptr::null_mut(),ptr::null_mut(),ptr::null_mut())};assert!(!h.is_null());Window(h)}
 #[test]fn stale_capture_consent_refuses(){assert!(consent_current(7,7));assert!(!consent_current(7,8));let mut called=false;assert_eq!(capture_if_current(7,8,||{called=true;1}),None);assert!(!called);assert_eq!(capture_if_current(8,8,||2),Some(2));}
 #[test]fn row_and_byte_bounds(){let mut c=Capture{pid:None,rows:0,seen:0,text:String::new(),failed:false};for _ in 0..32{assert!(append(&mut c,1,1,"x"))}let before=c.text.clone();assert!(!append(&mut c,1,1,"x"));assert_eq!(c.text,before);let mut c=Capture{pid:None,rows:0,seen:0,text:"x".repeat(4096-26),failed:false};assert!(append(&mut c,1,1,"xxx"));assert_eq!(c.text.len(),4096);let before=c.text.clone();assert!(!append(&mut c,1,1,""));assert_eq!(c.text,before);}
 #[test]fn actual_owned_visible_windows_only_and_bounds(){let a=window("synthetic-visible",true);let _hidden=window("synthetic-hidden",false);let out=String::from_utf8(capture(Some(std::process::id())).unwrap()).unwrap();assert!(out.contains("synthetic-visible"));assert!(!out.contains("synthetic-hidden"));assert!(out.len()<=4096);drop(a);assert!(!String::from_utf8(capture(Some(std::process::id())).unwrap()).unwrap().contains("synthetic-visible"));let _long=window(&"x".repeat(300),true);assert!(capture(Some(std::process::id())).is_err());}
}
