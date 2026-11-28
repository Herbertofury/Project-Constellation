//! Local fixed-drive admission and retained directory handles; no socket API.
//! Does not claim protection against hostile DOS-device mapping or kernel actors.
use std::{fs::{File,OpenOptions},io,path::{Path,PathBuf,Component,Prefix},os::windows::fs::OpenOptionsExt};
#[link(name="kernel32")] unsafe extern "system"{fn GetDriveTypeW(root:*const u16)->u32;}
pub fn ordinary_drive(path:&Path)->io::Result<PathBuf>{
 let mut c=path.components();let drive=match c.next(){Some(Component::Prefix(p))=>match p.kind(){Prefix::Disk(d)=>d,_=>return Err(io::Error::other("ordinary drive path required"))},_=>return Err(io::Error::other("ordinary drive path required"))};
 if !matches!(c.next(),Some(Component::RootDir)){return Err(io::Error::other("absolute drive path required"))}
 let mut count=0;for x in c{match x{Component::Normal(n) if !n.is_empty()=>count+=1,_=>return Err(io::Error::other("normalized path required"))}}
 if count==0{return Err(io::Error::other("new child directory required"))}
 Ok(PathBuf::from(format!("{}:\\",drive as char)))
}
pub fn pin_directory(path:&Path)->io::Result<File>{
 // Deny subsequent write/delete sharing while this handle is alive. Existing
 // incompatible writers cause refusal. BACKUP_SEMANTICS opens directories;
 // OPEN_REPARSE_POINT opens the link itself rather than following it.
 let file=OpenOptions::new().read(true).share_mode(1).custom_flags(0x02200000).open(path)?;
 use std::os::windows::fs::MetadataExt;
 let attrs=file.metadata()?.file_attributes();
 if attrs&0x400!=0||attrs&0x10==0{return Err(io::Error::other("reparse or non-directory ancestor refused"))}Ok(file)
}
pub fn pin_parents(path:&Path)->io::Result<Vec<File>>{
 let drive=ordinary_drive(path)?;let wide:Vec<u16>=drive.to_string_lossy().encode_utf16().chain(Some(0)).collect();
 if unsafe{GetDriveTypeW(wide.as_ptr())}!=3{return Err(io::Error::other("local fixed drive required"))}
 let parent=path.parent().ok_or_else(||io::Error::other("parent required"))?;
 let mut cur=drive;let mut pins=vec![pin_directory(&cur)?];
 for part in parent.components().skip(2){if let Component::Normal(n)=part{cur.push(n);pins.push(pin_directory(&cur)?)}else{return Err(io::Error::other("normal ancestor required"))}}
 Ok(pins)
}
#[cfg(test)] mod tests{use super::*;#[test]fn namespaces_refused_without_io(){for p in [r"\\server\share\new",r"\\?\C:\new",r"\\.\C:\new",r"C:relative",r"C:\",r"C:\parent\..\new"]{assert!(ordinary_drive(Path::new(p)).is_err(),"{p}");}assert_eq!(ordinary_drive(Path::new(r"C:\parent\new")).unwrap(),PathBuf::from(r"C:\"));}}
