//! Local-only foreground request. No keystrokes, clicks, restore, elevation or remote route.
//! Window identities are mutable observations, not a hostile-process security boundary.
use std::{ffi::c_void, io};
type H = *mut c_void;
#[link(name="user32")] unsafe extern "system" {
 fn EnumWindows(cb:Option<unsafe extern "system" fn(H,isize)->i32>,data:isize)->i32;
 fn IsWindowVisible(h:H)->i32;
 fn GetWindowThreadProcessId(h:H,p:*mut u32)->u32;
 fn GetWindowTextW(h:H,b:*mut u16,n:i32)->i32;
 fn GetClassNameW(h:H,b:*mut u16,n:i32)->i32;
 fn SetForegroundWindow(h:H)->i32;
 fn GetForegroundWindow()->H;
 fn MessageBoxW(h:H,text:*const u16,caption:*const u16,flags:u32)->i32;
}
#[link(name="kernel32")] unsafe extern "system" {
 fn OpenProcess(access:u32,inherit:i32,pid:u32)->H;
 fn CloseHandle(h:H)->i32;
 fn WaitForSingleObject(h:H,ms:u32)->u32;
}
fn refused()->io::Error {io::Error::other("target changed, unavailable, or foreground request refused")}
fn string(h:H,class:bool)->io::Result<String>{
 let mut b=[0u16;257];
 let n=unsafe {if class {GetClassNameW(h,b.as_mut_ptr(),257)} else {GetWindowTextW(h,b.as_mut_ptr(),257)}};
 if n<=0 || n>=256 {return Err(refused())}
 let s=String::from_utf16(&b[..n as usize]).map_err(|_|refused())?;
 // Reject deceptive/control captions rather than silently changing the preview.
 if s.chars().any(|c|c.is_control()||matches!(c,'\u{202a}'..='\u{202e}'|'\u{2066}'..='\u{2069}')) {return Err(refused())}
 Ok(s)
}
#[derive(Clone,PartialEq,Eq)] struct Identity {hwnd:usize,pid:u32,thread:u32,title:String,class:String}
fn identify(h:H)->io::Result<Identity>{
 if unsafe{IsWindowVisible(h)}==0 {return Err(refused())}
 let mut pid=0;let thread=unsafe{GetWindowThreadProcessId(h,&mut pid)};
 if pid==0||thread==0 {return Err(refused())}
 Ok(Identity{hwnd:h as usize,pid,thread,title:string(h,false)?,class:string(h,true)?})
}
pub struct Target {identity:Identity,process:H}
impl Drop for Target {fn drop(&mut self){unsafe{CloseHandle(self.process);}}}
impl Target {
 fn capture(h:H)->io::Result<Self>{
  let identity=identify(h)?;
  let process=unsafe{OpenProcess(0x00100000,0,identity.pid)}; // SYNCHRONIZE only
  if process.is_null(){return Err(refused())}
  let t=Self{identity,process};t.validate()?;Ok(t)
 }
 fn validate(&self)->io::Result<()> {
  if unsafe{WaitForSingleObject(self.process,0)}!=258 || identify(self.identity.hwnd as H)?!=self.identity {return Err(refused())} Ok(())
 }
 pub fn description(&self)->String {format!("{}\nClass: {}\nPID: {}; thread: {}; HWND: {:x}",self.identity.title,self.identity.class,self.identity.pid,self.identity.thread,self.identity.hwnd)}
 /// Consumes selection. Cancellation never invokes the foreground API. No automatic retries.
 pub fn ask_and_focus(self)->io::Result<bool> {
  self.ask_and_focus_owned(std::ptr::null_mut(),||true)
 }
 pub(crate) fn ask_and_focus_owned(self,owner:H,still_allowed:impl FnOnce()->bool)->io::Result<bool>{
  self.validate()?;
  let text=format!("Bring this selected observed window to the foreground once?\n\n{}\n\nLocal-only. No typing, clicking, restoring or remote control. Window titles are untrusted. Do not use on a hostile or rapidly changing desktop. Cancel stops without action.",self.description());
  let approved=unsafe{MessageBoxW(owner,wide(&text).as_ptr(),wide("Computer Link: one local foreground request").as_ptr(),0x1|0x100|0x30)}==1;
  self.perform_if(approved&&still_allowed())
 }
 fn perform_if(self,approved:bool)->io::Result<bool>{
  self.perform_with(approved,|h| unsafe{SetForegroundWindow(h)}!=0 && unsafe{GetForegroundWindow()}==h)
 }
 fn perform_with(self,approved:bool,effect:impl FnOnce(H)->bool)->io::Result<bool>{
  if !approved {return Ok(false)}
  self.validate()?;
  if !effect(self.identity.hwnd as H){return Err(refused())} Ok(true)
 }
}
fn wide(s:&str)->Vec<u16>{s.encode_utf16().chain(Some(0)).collect()}
/// Explicit caller action only. Captions stay in memory; capped at 64 eligible targets.
pub fn choose_candidates()->io::Result<Vec<Target>>{
 struct Scan{out:Vec<Target>,seen:usize,overflow:bool}
 unsafe extern "system" fn visit(h:H,p:isize)->i32{
  let s=unsafe{&mut*(p as *mut Scan)};s.seen+=1;
  if s.seen>4096 {s.overflow=true;return 0}
  if let Ok(t)=Target::capture(h){if s.out.len()==64{s.overflow=true;return 0}s.out.push(t)}1
 }
 let mut scan=Scan{out:vec![],seen:0,overflow:false};
 if unsafe{EnumWindows(Some(visit),&mut scan as *mut _ as isize)}==0||scan.overflow{return Err(io::Error::other("window candidate bound exceeded"))}
 Ok(scan.out)
}
#[cfg(test)]mod tests{
 use super::*;
 #[link(name="user32")]unsafe extern "system"{fn CreateWindowExW(ex:u32,class:*const u16,title:*const u16,style:u32,x:i32,y:i32,w:i32,h:i32,parent:H,menu:H,instance:H,param:H)->H;fn DestroyWindow(h:H)->i32;fn SetWindowTextW(h:H,t:*const u16)->i32;}
 struct Fixture(H);impl Drop for Fixture{fn drop(&mut self){unsafe{DestroyWindow(self.0);}}}
 fn fixture()->Fixture{let n=std::ptr::null_mut();let h=unsafe{CreateWindowExW(0,wide("STATIC").as_ptr(),wide("Disposable Computer Link focus fixture").as_ptr(),0x10000000,0,0,120,60,n,n,n,n)};assert!(!h.is_null());Fixture(h)}
 #[test]fn cancellation_does_not_cross_effect_boundary(){let f=fixture();let t=Target::capture(f.0).unwrap();let mut calls=0;assert!(!t.perform_with(false,|_|{calls+=1;true}).unwrap());assert_eq!(calls,0);}
 #[test]fn cancelled_target_never_requests_focus(){let f=fixture();let t=Target::capture(f.0).unwrap();let before=unsafe{GetForegroundWindow()};assert!(!t.perform_if(false).unwrap());assert_eq!(unsafe{GetForegroundWindow()},before);}
 #[test]fn renamed_or_closed_target_refused(){let f=fixture();let t=Target::capture(f.0).unwrap();unsafe{SetWindowTextW(f.0,wide("changed").as_ptr());}assert!(t.perform_if(true).is_err());let t=Target::capture(f.0).unwrap();drop(f);assert!(t.perform_if(true).is_err());}
 #[test]fn control_and_bidi_titles_refused(){let f=fixture();unsafe{SetWindowTextW(f.0,wide("deceptive\u{202e}caption").as_ptr());}assert!(Target::capture(f.0).is_err());}
 #[test]fn actual_foreground_request_reports_os_result(){let f=fixture();let other=fixture();assert_ne!(f.0,other.0);assert_ne!(unsafe{SetForegroundWindow(other.0)},0);assert_eq!(unsafe{GetForegroundWindow()},other.0);let target=Target::capture(f.0).unwrap();assert!(target.perform_if(true).expect("synthetic foreground activation must succeed on this runner"));assert_eq!(unsafe{GetForegroundWindow()},f.0);}
}
