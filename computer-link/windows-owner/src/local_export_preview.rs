//! Modeless owner-only, scrollable exact export preview. Closing means No.
use std::{cell::Cell,ffi::c_void,io,mem,ptr,rc::Rc,sync::OnceLock};
type H=*mut c_void;
#[repr(C)]struct Class{size:u32,style:u32,proc:Option<unsafe extern "system" fn(H,u32,usize,isize)->isize>,cls:i32,win:i32,instance:H,icon:H,cursor:H,brush:H,menu:*const u16,name:*const u16,small:H}
#[repr(C)]struct Rect{left:i32,top:i32,right:i32,bottom:i32}
#[link(name="user32")]unsafe extern "system"{
 fn RegisterClassExW(c:*const Class)->u16;
 fn CreateWindowExW(ex:u32,class:*const u16,title:*const u16,style:u32,x:i32,y:i32,w:i32,h:i32,parent:H,menu:H,instance:H,param:H)->H;
 fn SetWindowLongPtrW(h:H,index:i32,value:isize)->isize;fn GetWindowLongPtrW(h:H,index:i32)->isize;
 fn DefWindowProcW(h:H,m:u32,w:usize,l:isize)->isize;fn DestroyWindow(h:H)->i32;fn ShowWindow(h:H,n:i32)->i32;
 fn GetClientRect(h:H,r:*mut Rect)->i32;fn MoveWindow(h:H,x:i32,y:i32,w:i32,height:i32,repaint:i32)->i32;
 fn SendMessageW(h:H,m:u32,w:usize,l:isize)->isize;
 fn GetWindowTextLengthW(h:H)->i32;fn GetWindowTextW(h:H,b:*mut u16,max:i32)->i32;
 fn EnableWindow(h:H,enabled:i32)->i32;fn SetFocus(h:H)->H;
}
#[link(name="kernel32")]unsafe extern "system"{fn GetModuleHandleW(n:*const u16)->H;}
type Subclass=Option<unsafe extern "system" fn(H,u32,usize,isize,usize,usize)->isize>;
#[link(name="comctl32")]unsafe extern "system" {
 fn SetWindowSubclass(h:H,procedure:Subclass,id:usize,data:usize)->i32;
 fn RemoveWindowSubclass(h:H,procedure:Subclass,id:usize)->i32;
 fn DefSubclassProc(h:H,m:u32,w:usize,l:isize)->isize;
}
// A standard multiline EDIT requests all keys (native diagnostic: 0x8d).
// This read-only preview must instead let IsDialogMessage route Tab/Enter/Escape.
// Preserve all text-selection/copy/scroll behavior for other keys.
unsafe extern "system" fn preview_edit(h:H,m:u32,w:usize,l:isize,id:usize,_data:usize)->isize {
 if m==0x82 {unsafe{RemoveWindowSubclass(h,Some(preview_edit),id);}}
 let result=unsafe{DefSubclassProc(h,m,w,l)};
 if m==0x87&&matches!(w,9|13|27){result&!(0x4|0x2)}else{result}
}
fn wide(s:&str)->Vec<u16>{s.encode_utf16().chain(Some(0)).collect()}
struct Data{edit:H,yes:H,no:H,alive:Rc<Cell<bool>>,answer:Option<Box<dyn FnOnce(bool)>>}
pub struct Window{h:H,alive:Rc<Cell<bool>>}
impl Window{pub fn handle(&self)->isize{self.h as isize}}
impl Drop for Window{fn drop(&mut self){if self.alive.get(){unsafe{DestroyWindow(self.h);}}}}
unsafe extern "system" fn procedure(h:H,m:u32,w:usize,l:isize)->isize{
 if m==0x400{return 0x534b0002} // DM_GETDEFID: Cancel is the default.
 if m==0x401{return 0} // Do not silently change the default to Create.
 let raw=unsafe{GetWindowLongPtrW(h,-21)} as *mut Data;
 if !raw.is_null(){
  if m==0x111 {
   let d=unsafe{&mut*raw};let id=w&0xffff;
   if w>>16==0 && ((id==1&&l==d.yes as isize)||(id==2&&(l==d.no as isize||l==0))){
    if let Some(answer)=d.answer.take(){answer(id==1);}unsafe{DestroyWindow(h);}return 0
   }
  }
  if m==5 {let d=unsafe{&*raw};let mut r:Rect=unsafe{mem::zeroed()};unsafe{GetClientRect(h,&mut r);MoveWindow(d.edit,12,12,(r.right-24).max(80),(r.bottom-72).max(60),1);MoveWindow(d.yes,12,(r.bottom-48).max(80),170,32,1);MoveWindow(d.no,194,(r.bottom-48).max(80),120,32,1);}return 0}
  if m==0x82 {unsafe{SetWindowLongPtrW(h,-21,0);}let mut d=unsafe{Box::from_raw(raw)};d.alive.set(false);if let Some(answer)=d.answer.take(){answer(false);}}
 }
 unsafe{DefWindowProcW(h,m,w,l)}
}
pub fn show(owner:isize,text:&str,answer:impl FnOnce(bool)+'static)->io::Result<Window>{
 if text.encode_utf16().count()>32760 || text.contains('\0'){return Err(io::Error::other("preview display bound exceeded"))}
 static REGISTERED:OnceLock<bool>=OnceLock::new();
 let instance=unsafe{GetModuleHandleW(ptr::null())};let class=wide("ComputerLinkExportPreview");
 if !*REGISTERED.get_or_init(||{let mut c:Class=unsafe{mem::zeroed()};c.size=mem::size_of::<Class>() as u32;c.proc=Some(procedure);c.instance=instance;c.name=class.as_ptr();c.brush=6usize as H;unsafe{RegisterClassExW(&c)!=0}}){return Err(io::Error::other("preview class unavailable"))}
 let displayed=text.replace("\r\n","\n").replace('\n',"\r\n");
 let encoded:Vec<u16>=displayed.encode_utf16().collect();
 if encoded.len()>32760{return Err(io::Error::other("normalized preview too large"))}
 let h=unsafe{CreateWindowExW(0,class.as_ptr(),wide("Create new local text file — review all text").as_ptr(),0x00cf0000,140,140,860,620,owner as H,ptr::null_mut(),instance,ptr::null_mut())};
 if h.is_null(){return Err(io::Error::last_os_error())}
 let edit=unsafe{CreateWindowExW(0x200,wide("EDIT").as_ptr(),ptr::null(),0x50210844,12,12,810,500,h,100usize as H,instance,ptr::null_mut())};
 let yes=unsafe{CreateWindowExW(0,wide("BUTTON").as_ptr(),wide("Create this new file").as_ptr(),0x50010000,12,530,170,32,h,1usize as H,instance,ptr::null_mut())};
 let no=unsafe{CreateWindowExW(0,wide("BUTTON").as_ptr(),wide("Cancel").as_ptr(),0x50010001,194,530,120,32,h,2usize as H,instance,ptr::null_mut())};
 if edit.is_null()||yes.is_null()||no.is_null(){unsafe{DestroyWindow(h);}return Err(io::Error::other("preview controls unavailable"))}
 if unsafe{SetWindowSubclass(edit,Some(preview_edit),1,0)}==0 {
  unsafe{DestroyWindow(h);}return Err(io::Error::other("preview keyboard routing unavailable"))
 }
 // Create remains disabled until the entire normalized display is verified.
 unsafe{EnableWindow(yes,0);SendMessageW(edit,0xc5,32760,0);}
 let set=unsafe{SendMessageW(edit,0xc,0,wide(&displayed).as_ptr() as isize)};
 let length=unsafe{GetWindowTextLengthW(edit)};
 let mut actual=vec![0u16;encoded.len()+1];
 let copied=unsafe{GetWindowTextW(edit,actual.as_mut_ptr(),actual.len() as i32)};
 if set==0||length!=encoded.len() as i32||copied!=encoded.len() as i32||actual[..encoded.len()]!=encoded{
  unsafe{DestroyWindow(h);}return Err(io::Error::other("exact preview readback failed; no approval enabled"))
 }
 let alive=Rc::new(Cell::new(true));let data=Box::new(Data{edit,yes,no,alive:alive.clone(),answer:Some(Box::new(answer))});
 let raw=Box::into_raw(data);
 unsafe{SetWindowLongPtrW(h,-21,raw as isize);}
 if unsafe{GetWindowLongPtrW(h,-21)}!=raw as isize {
  unsafe{drop(Box::from_raw(raw));DestroyWindow(h);}return Err(io::Error::other("preview state binding failed"))
 }
 unsafe{EnableWindow(yes,1);ShowWindow(h,5);SetFocus(no);}
 Ok(Window{h,alive})
}
