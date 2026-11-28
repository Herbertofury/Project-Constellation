//! Local selector in its own Job-owned process, keeping tray Disconnect responsive.
//! No IPC/action endpoint, hooks, polling, automatic retry or input injection.
use std::{cell::{RefCell,Cell},ffi::c_void,mem,ptr};
use crate::window_focus::{Target,choose_candidates};
type H=*mut c_void;
#[repr(C)]struct Point{x:i32,y:i32}
#[repr(C)]struct Msg{hwnd:H,msg:u32,w:usize,l:isize,time:u32,point:Point,private:u32}
#[repr(C)]struct Class{size:u32,style:u32,proc:Option<unsafe extern "system" fn(H,u32,usize,isize)->isize>,cls:i32,win:i32,instance:H,icon:H,cursor:H,brush:H,menu:*const u16,name:*const u16,small:H}
#[link(name="user32")]unsafe extern "system"{
 fn RegisterClassExW(c:*const Class)->u16;
 fn CreateWindowExW(ex:u32,class:*const u16,title:*const u16,style:u32,x:i32,y:i32,w:i32,h:i32,parent:H,menu:H,instance:H,param:H)->H;
 fn DefWindowProcW(h:H,m:u32,w:usize,l:isize)->isize;
 fn DestroyWindow(h:H)->i32;fn PostQuitMessage(code:i32);
 fn GetMessageW(m:*mut Msg,h:H,min:u32,max:u32)->i32;
 fn TranslateMessage(m:*const Msg)->i32;fn DispatchMessageW(m:*const Msg)->isize;
 fn SendMessageW(h:H,m:u32,w:usize,l:isize)->isize;
 fn GetDlgItem(h:H,id:i32)->H;fn SetFocus(h:H)->H;fn GetFocus()->H;
 fn MessageBoxW(h:H,t:*const u16,c:*const u16,f:u32)->i32;
 fn IsDialogMessageW(h:H,m:*const Msg)->i32;
}
#[link(name="kernel32")]unsafe extern "system"{fn GetModuleHandleW(n:*const u16)->H;}
thread_local!{static ALIVE:Cell<bool>=const{Cell::new(false)};static TARGETS:RefCell<Vec<Target>>=const{RefCell::new(vec![])};}
fn wide(s:&str)->Vec<u16>{s.encode_utf16().chain(Some(0)).collect()}
unsafe extern "system" fn procedure(h:H,m:u32,w:usize,l:isize)->isize{
 match m{
  0x111=>{match w&0xffff{
   2=>{unsafe{DestroyWindow(h);}},
   3=>{
    let selected=unsafe{SendMessageW(GetDlgItem(h,10),0x188,0,0)};
    let target=TARGETS.with(|v|{let mut v=v.borrow_mut();if selected<0||selected as usize>=v.len(){None}else{let chosen=v.swap_remove(selected as usize);v.clear();Some(chosen)}});
    if let Some(target)=target{
     // Selection is consumed regardless of consent/result; never retry stale targets.
     let result=target.ask_and_focus_owned(h,||ALIVE.with(Cell::get));
     if result.is_err()&&ALIVE.with(Cell::get){unsafe{MessageBoxW(h,wide("Window changed or the OS refused focus. No retry was made.").as_ptr(),wide("Local foreground request refused").as_ptr(),0);}}
     unsafe{DestroyWindow(h);}
    }
   },_=>{}}0},
  0x10=>{unsafe{DestroyWindow(h);}0},
  2=>{ALIVE.with(|v|v.set(false));TARGETS.with(|v|v.borrow_mut().clear());unsafe{PostQuitMessage(0);}0},
  _=>unsafe{DefWindowProcW(h,m,w,l)}
 }
}
pub fn run(){
 // Direct invocation does not imply owner/tray control, so state that explicitly.
 let text="List visible window titles locally for one foreground request? No remote access or input injection. Cancel stops. If launched from the tray, Disconnect/Exit terminates this selector. If launched directly, close this selector to stop it. Use only on a trusted, quiescent desktop; window identity is an observation, not a security boundary.";
 if unsafe{MessageBoxW(ptr::null_mut(),wide(text).as_ptr(),wide("Local window selection consent").as_ptr(),0x101)}!=1{return}
 let candidates=match choose_candidates(){Ok(v)=>v,Err(_)=>{return}};
 unsafe{
  let instance=GetModuleHandleW(ptr::null());let name=wide("ComputerLinkLocalFocusSelector");
  let mut c:Class=mem::zeroed();c.size=mem::size_of_val(&c) as u32;c.proc=Some(procedure);c.instance=instance;c.name=name.as_ptr();c.brush=6usize as H;
  if RegisterClassExW(&c)==0{return}
  let h=CreateWindowExW(0,name.as_ptr(),wide("Computer-Link local foreground selector").as_ptr(),0x10ca0000,160,160,840,420,ptr::null_mut(),ptr::null_mut(),instance,ptr::null_mut());if h.is_null(){return}ALIVE.with(|v|v.set(true));
  let make=|class:&str,title:&str,style:u32,x,y,w,ht,id|CreateWindowExW(0,wide(class).as_ptr(),wide(title).as_ptr(),0x50000000|style,x,y,w,ht,h,id as H,instance,ptr::null_mut());
  let label=make("STATIC","Visible windows. Use Tab and arrow keys to select, then focus Review and press Enter. Escape cancels.",0,12,12,800,36,11usize);
  let list=make("LISTBOX","",0x00a10001,12,52,800,260,10);
  if label.is_null()||list.is_null(){DestroyWindow(h);return}
  for target in &candidates{let row=target.description().replace('\n'," | ");if SendMessageW(list,0x180,0,wide(&row).as_ptr() as isize)<0{DestroyWindow(h);return}}
  TARGETS.with(|v|*v.borrow_mut()=candidates);
  let review=make("BUTTON","Review selected window",0x10000,12,328,240,32,3);
  let cancel=make("BUTTON","Cancel",0x10001,680,328,130,32,2);if review.is_null()||cancel.is_null(){DestroyWindow(h);return}SetFocus(cancel);
  let mut msg:Msg=mem::zeroed();
  while GetMessageW(&mut msg,ptr::null_mut(),0,0)>0{
   if msg.msg==0x100&&(msg.w==13||msg.w==27){
    // Enter activates review only when the user deliberately focused its button.
    // It never grants foreground access: the next native prompt defaults to Cancel.
    if msg.w==13&&msg.hwnd==review&&GetFocus()==review{SendMessageW(h,0x111,3,0);}
    else{DestroyWindow(h);}
    continue
   }
   if IsDialogMessageW(h,&msg)!=0{continue}TranslateMessage(&msg);DispatchMessageW(&msg);
  }
 }
}
