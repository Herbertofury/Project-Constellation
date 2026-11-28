//! Explicit-handle-list pipes for an owner-owned local status-only MCP session.
//! No process adoption, implicit stdout forwarding, network endpoint, or grants.
use std::{ffi::c_void,fs::File,io,mem,os::windows::io::{AsRawHandle,FromRawHandle},ptr};
type H=*mut c_void;
#[repr(C)] struct Security{size:u32,descriptor:*mut c_void,inherit:i32}
#[link(name="kernel32")] unsafe extern "system"{
 fn CreatePipe(read:*mut H,write:*mut H,attributes:*const Security,size:u32)->i32;
 fn SetHandleInformation(handle:H,mask:u32,flags:u32)->i32;
 fn InitializeProcThreadAttributeList(list:*mut c_void,count:u32,flags:u32,size:*mut usize)->i32;
 fn UpdateProcThreadAttribute(list:*mut c_void,flags:u32,attribute:usize,value:*mut c_void,size:usize,previous:*mut c_void,returned:*mut usize)->i32;
 fn DeleteProcThreadAttributeList(list:*mut c_void);
 fn CreateFileW(name:*const u16,access:u32,share:u32,security:*const Security,creation:u32,flags:u32,template:H)->H;
}
/// Blocking local pipes. The owner owns the process separately: dropping these
/// is NOT a disconnect. Always call Owner::disconnect or drop the Owner as well.
/// Consumers must bound reads and run them off the UI thread. No remote sink.
pub struct LocalStdio{pub input:File,pub output:File}
pub(crate) struct Pipes{
 parent:LocalStdio,child_in:File,child_out:File,child_err:File,
 // Stable allocations: UpdateProcThreadAttribute retains the handles pointer.
 handles:Box<[H;3]>,list:Vec<usize>,initialized:bool,
}
impl Pipes{
 pub fn new()->io::Result<Self>{unsafe{
  let security=Security{size:mem::size_of::<Security>() as u32,descriptor:ptr::null_mut(),inherit:1};
  fn pipe(security:&Security)->io::Result<(File,File)>{unsafe{
   let(mut r,mut w)=(ptr::null_mut(),ptr::null_mut());
   if CreatePipe(&mut r,&mut w,security,0)==0{return Err(io::Error::last_os_error())}
   Ok((File::from_raw_handle(r),File::from_raw_handle(w)))
  }}
  let(child_in,input)=pipe(&security)?;let(output,child_out)=pipe(&security)?;
  for f in [&input,&output]{if SetHandleInformation(f.as_raw_handle(),1,0)==0{return Err(io::Error::last_os_error())}}
  let null:Vec<u16>="NUL\0".encode_utf16().collect();
  let err=CreateFileW(null.as_ptr(),0x40000000,3,&security,3,0,ptr::null_mut());
  if err as isize == -1{return Err(io::Error::last_os_error())}
  let child_err=File::from_raw_handle(err);
  let handles=Box::new([child_in.as_raw_handle(),child_out.as_raw_handle(),child_err.as_raw_handle()]);
  let mut bytes=0;InitializeProcThreadAttributeList(ptr::null_mut(),1,0,&mut bytes);
  if bytes==0||bytes>65536{return Err(io::Error::other("invalid process attribute size"))}
  let mut this=Self{parent:LocalStdio{input,output},child_in,child_out,child_err,handles,list:vec![0;bytes.div_ceil(mem::size_of::<usize>())],initialized:false};
  if InitializeProcThreadAttributeList(this.attributes(),1,0,&mut bytes)==0{return Err(io::Error::last_os_error())}
  this.initialized=true;
  if UpdateProcThreadAttribute(this.attributes(),0,0x00020002,this.handles.as_mut_ptr() as _,mem::size_of::<[H;3]>(),ptr::null_mut(),ptr::null_mut())==0{return Err(io::Error::last_os_error())}
  Ok(this)
 }}
 pub fn attributes(&mut self)->*mut c_void{self.list.as_mut_ptr() as _}
 pub fn child_handles(&self)->[H;3]{*self.handles}
 pub fn into_parent(mut self)->LocalStdio{
  // Delete attributes before releasing their referenced handle storage.
  unsafe{DeleteProcThreadAttributeList(self.attributes())};self.initialized=false;
  // Moving fields out of Drop types is prohibited: use ManuallyDrop and consume
  // all fields exactly once. Child endpoints must close now for EOF propagation.
  let this=mem::ManuallyDrop::new(self);
  unsafe{
   drop(ptr::read(&this.child_in));drop(ptr::read(&this.child_out));drop(ptr::read(&this.child_err));
   drop(ptr::read(&this.handles));drop(ptr::read(&this.list));ptr::read(&this.parent)
  }
 }
}
impl Drop for Pipes{fn drop(&mut self){if self.initialized{unsafe{DeleteProcThreadAttributeList(self.attributes())}}}}
