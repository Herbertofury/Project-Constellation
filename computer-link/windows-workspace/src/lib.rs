//! Private Windows local-stdio workspace candidate. No socket API or installer.
#[cfg(windows)] mod strict_json;
#[cfg(windows)] mod root_scope;
#[cfg(windows)]
mod native {
 use std::{fs::{self,OpenOptions},io::{self,Read,Write,BufRead},path::{Path,PathBuf},os::windows::{fs::OpenOptionsExt,io::AsRawHandle},ffi::c_void};
 use serde_json::{Value,json};
 use crate::strict_json;
 
 #[repr(C)] struct Time{low:u32,high:u32}
 #[repr(C)] struct Info{attrs:u32,created:Time,access:Time,write:Time,volume:u32,size_high:u32,size_low:u32,links:u32,index_high:u32,index_low:u32}
 #[link(name="kernel32")] unsafe extern "system"{fn GetFileInformationByHandle(h:*mut c_void,i:*mut Info)->i32;}
 const REPARSE:u32=0x400;const DIRECTORY:u32=0x10;
 struct Root{path:PathBuf,revoked:bool,_pins:Vec<std::fs::File>}
 impl Root{
  fn new(p:&Path)->io::Result<Self>{if !p.is_absolute(){return Err(io::Error::other("absolute fresh trusted directory required"))}let mut pins=crate::root_scope::pin_parents(p)?;fs::create_dir(p)?;pins.push(crate::root_scope::pin_directory(p)?);let path=p.canonicalize()?;Ok(Self{path,revoked:false,_pins:pins})}
  fn leaf(&self,n:&str)->Result<PathBuf,&'static str>{if n.is_empty()||n.len()>80||!n.bytes().all(|c|c.is_ascii_alphanumeric()||b"._-".contains(&c))||n.starts_with('.')||n.ends_with('.') {return Err("invalid leaf")}
   let stem=n.split('.').next().unwrap().to_ascii_uppercase();if ["CON","PRN","AUX","NUL"].contains(&stem.as_str())||((stem.starts_with("COM")||stem.starts_with("LPT"))&&stem.len()==4&&stem.as_bytes()[3].is_ascii_digit()){return Err("device name refused")}Ok(self.path.join(n))}
  fn run(&mut self,v:&Value)->Result<Value,&'static str>{let o=v.as_object().ok_or("object required")?;let op=v["op"].as_str().ok_or("operation required")?;let fields:&[&str]=match op{"list"|"revoke"=>&["op"],"read"=>&["op","name"],"write_new"=>&["op","name","text"],_=>return Err("unsupported")};if o.len()!=fields.len()||o.keys().any(|k|!fields.contains(&k.as_str())){return Err("exact fields required")}
   if op=="revoke"{self.revoked=true;return Ok(json!({"revoked":true}))}if self.revoked{return Err("revoked")}
   if op=="list"{let mut rows=vec![];for e in fs::read_dir(&self.path).map_err(|_|"list failed")?.take(101){if rows.len()==100{return Err("list bound exceeded")};let e=e.map_err(|_|"entry failed")?;let name=e.file_name().into_string().map_err(|_|"non-Unicode name refused")?;self.leaf(&name).map_err(|_|"unsupported entry name refused")?;rows.push(name);}return Ok(json!(rows))}
   let p=self.leaf(v["name"].as_str().ok_or("name required")?)?;
   if op=="write_new"{let text=v["text"].as_str().ok_or("text required")?;if text.len()>4096{return Err("size refused")};let mut f=OpenOptions::new().write(true).create_new(true).custom_flags(0x00200000).open(p).map_err(|_|"creation refused; existing file preserved")?;f.write_all(text.as_bytes()).and_then(|_|f.sync_all()).map_err(|_|"write uncertain; inspect before retry")?;return Ok(json!({"created":true,"bytes":text.len()}))}
   let f=OpenOptions::new().read(true).custom_flags(0x00200000).open(p).map_err(|_|"open refused")?;let mut info:Info=unsafe{std::mem::zeroed()};if unsafe{GetFileInformationByHandle(f.as_raw_handle(),&mut info)}==0{return Err("handle inspection failed")};if info.attrs&(REPARSE|DIRECTORY)!=0||info.links!=1||info.size_high!=0||info.size_low>4096{return Err("not bounded single-link regular file")}
   let mut bytes=vec![];f.take(4097).read_to_end(&mut bytes).map_err(|_|"read failed")?;if bytes.len()>4096{return Err("read bound exceeded")};Ok(json!({"text":String::from_utf8(bytes).map_err(|_|"not UTF8")?}))
  }
 }
 /// Explicitly selected read-only file capability. No arbitrary request paths.
 pub struct SelectedRead{root:Root,name:String}
 impl SelectedRead{
  pub fn new_workspace(path:&Path,name:&str)->io::Result<Self>{let root=Root::new(path)?;root.leaf(name).map_err(io::Error::other)?;Ok(Self{root,name:name.to_owned()})}
  pub fn read(&mut self)->io::Result<Vec<u8>>{let v=self.root.run(&json!({"op":"read","name":self.name})).map_err(io::Error::other)?;Ok(v["text"].as_str().ok_or_else(||io::Error::other("read shape refused"))?.as_bytes().to_vec())}
 }
 #[cfg(test)] mod tests {
  use super::*;
  fn root()->(Root,PathBuf){let p=std::env::temp_dir().join(format!("computer-link-test-{}-{}",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));(Root::new(&p).unwrap(),p)}
  #[test]fn create_read_preserve_revoke(){let(mut r,p)=root();assert!(r.run(&json!({"op":"write_new","name":"test.txt","text":"first"})).is_ok());assert!(r.run(&json!({"op":"write_new","name":"test.txt","text":"second"})).is_err());assert_eq!(r.run(&json!({"op":"read","name":"test.txt"})).unwrap()["text"],"first");assert_eq!(r.run(&json!({"op":"list"})).unwrap().as_array().unwrap().len(),1);r.run(&json!({"op":"revoke"})).unwrap();assert_eq!(r.run(&json!({"op":"read","name":"test.txt"})),Err("revoked"));assert_eq!(r.run(&json!({"op":"write_new","name":"new.txt","text":"bad"})),Err("revoked"));assert_eq!(fs::read_to_string(p.join("test.txt")).unwrap(),"first");assert!(!p.join("new.txt").exists());drop(r);fs::remove_dir_all(p).unwrap();}
  #[test]fn pinned_root_refuses_rename_until_drop(){let(r,p)=root();let renamed=p.with_extension("moved");assert!(fs::rename(&p,&renamed).is_err());assert!(p.exists());drop(r);fs::rename(&p,&renamed).unwrap();fs::remove_dir(renamed).unwrap();}
  #[test]fn names_size_links_and_scope(){let(mut r,p)=root();for n in ["../outside","C:device","a/b","a\\b","CON","nul.txt","COM1","LPT9.log","trailing."]{assert!(r.run(&json!({"op":"read","name":n})).is_err());}assert!(r.run(&json!({"op":"write_new","name":"big","text":"x".repeat(4097)})).is_err());r.run(&json!({"op":"write_new","name":"one","text":"keep"})).unwrap();r._pins.clear();fs::hard_link(p.join("one"),p.join("two")).unwrap();r._pins=crate::root_scope::pin_parents(&p).unwrap();r._pins.push(crate::root_scope::pin_directory(&p).unwrap());assert_eq!(r.run(&json!({"op":"read","name":"one"})),Err("not bounded single-link regular file"));assert!(Root::new(&p).is_err());assert!(r.run(&json!({"op":"list","name":"irrelevant"})).is_err());assert!(r.run(&json!({"op":"delete","name":"one"})).is_err());assert_eq!(fs::read_to_string(p.join("one")).unwrap(),"keep");drop(r);fs::remove_dir_all(p).unwrap();}
 }

 pub fn run()->io::Result<()> {let a:Vec<_>=std::env::args().skip(1).collect();if a.len()!=2||a[0]!="--consent-new-workspace"{return Err(io::Error::other("requires --consent-new-workspace ABSOLUTE_NEW_TRUSTED_FOLDER"))}let mut root=Root::new(Path::new(&a[1]))?;let mut input=io::stdin().lock();let mut out=io::stdout().lock();for _ in 0..128{let mut b=vec![];let n=(&mut input).take(8193).read_until(b'\n',&mut b)?;if n==0{return Ok(())}if n>8192||b.last()!=Some(&b'\n'){return Err(io::Error::other("invalid frame"))}let result=match strict_json::parse(&b){Ok(v)=>match root.run(&v){Ok(v)=>json!({"ok":true,"result":v}),Err(e)=>json!({"ok":false,"error":e})},Err(_)=>json!({"ok":false,"error":"invalid JSON"})};writeln!(out,"{result}")?;out.flush()?;}Err(io::Error::other("session exhausted"))}
}
#[cfg(windows)] pub use native::{run,SelectedRead};
