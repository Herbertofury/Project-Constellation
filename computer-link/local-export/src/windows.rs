//! Experimental backend: local fixed NTFS only. Not exposed to owner UI/MCP.
//! Root is retained and all creates/renames are single-leaf handle-relative.
use std::{ffi::c_void,fs::File,io::{self,Write},os::windows::io::{AsRawHandle,FromRawHandle},path::{Path,PathBuf},ptr,sync::Arc};
use crate::{Session,Preview};
#[path="root_scope.rs"] mod root_scope;
type Handle=*mut c_void;
#[repr(C)] struct Unicode {len:u16,max:u16,buffer:*mut u16}
#[repr(C)] struct Attributes {len:u32,root:Handle,name:*mut Unicode,flags:u32,security:Handle,quality:Handle}
#[repr(C)] struct Status {status:usize,information:usize}
#[repr(C)] struct Rename {replace:u32,root:Handle,length:u32,name:[u16;81]}
#[link(name="ntdll")] unsafe extern "system" {
    fn NtCreateFile(out:*mut Handle,access:u32,attrs:*mut Attributes,status:*mut Status,allocation:*const i64,file_attrs:u32,share:u32,disposition:u32,options:u32,ea:Handle,ea_len:u32)->i32;
    fn RtlNtStatusToDosError(status:i32)->u32;
    fn NtSetInformationFile(file:Handle,status:*mut Status,info:*const c_void,size:u32,class:u32)->i32;
}
#[link(name="kernel32")] unsafe extern "system" {
    fn GetVolumeInformationByHandleW(file:Handle,name:*mut u16,name_len:u32,serial:*mut u32,max_component:*mut u32,flags:*mut u32,fs:*mut u16,fs_len:u32)->i32;
}
// Microsoft WinBase.h FILE_RENAME_INFO union (DWORD/BOOLEAN), HANDLE,
// DWORD, WCHAR[1] layout. Native FILE_RENAME_INFORMATION uses the same fields.
// Explicit x64-only ABI gate: no guessed 32-bit/native ABI support.
#[cfg(not(target_arch="x86_64"))]
compile_error!("local export candidate currently supports x86_64 Windows only");
const _: () = {
    assert!(std::mem::offset_of!(Rename,replace)==0);
    assert!(std::mem::offset_of!(Rename,root)==8);
    assert!(std::mem::offset_of!(Rename,length)==16);
    assert!(std::mem::offset_of!(Rename,name)==20);
    assert!(std::mem::size_of::<Rename>()==184);
    assert!(std::mem::size_of::<Status>()==16);
};
struct Root {path:PathBuf,dir:File,_parents:Vec<File>}
/// Construct only from an explicit owner local selection. Retains locks for the
/// export lifetime. No remote caller/API is connected to this constructor.
pub struct LocalExport {root:Arc<Root>,session:Session}
pub struct ExportPreview {root:Arc<Root>,preview:Preview}
impl LocalExport {
    pub fn selected_local_directory(path:&Path)->io::Result<Self> {
        let parents=root_scope::pin_parents(path)?;
        let dir=root_scope::pin_directory(path)?;
        let mut filesystem=[0u16;32];
        if unsafe{GetVolumeInformationByHandleW(dir.as_raw_handle(),ptr::null_mut(),0,ptr::null_mut(),ptr::null_mut(),ptr::null_mut(),filesystem.as_mut_ptr(),32)}==0 {return Err(io::Error::last_os_error())}
        let count=filesystem.iter().position(|x|*x==0).unwrap_or(32);
        if String::from_utf16_lossy(&filesystem[..count])!="NTFS" {return Err(io::Error::other("only local NTFS admitted"))}
        Ok(Self{root:Arc::new(Root{path:path.into(),dir,_parents:parents}),session:Session::new()})
    }
    pub fn preview(&self,name:&str,text:&str)->io::Result<ExportPreview> {
        Ok(ExportPreview{root:self.root.clone(),preview:self.session.preview(name,text)?})
    }
    pub fn revoke(&self){self.session.revoke()}
}
impl Drop for LocalExport {fn drop(&mut self){self.revoke()}}
impl ExportPreview {
    pub fn display(&self)->String {format!("Selected local folder: {:?}\n{}\nThis does not share text with a remote agent.",self.root.path,self.preview.display())}
    /// true is for this exact displayed preview only; false causes no disk I/O.
    pub fn confirm(self,yes:bool)->io::Result<bool> {
        let Some(approved)=self.preview.approve(yes) else{return Ok(false)};
        approved.commit(|name,bytes|publish(&self.root.dir,name,bytes))?;Ok(true)
    }
}
fn create_relative(root:&File,name:&str)->io::Result<File> {
    let mut wide:Vec<u16>=name.encode_utf16().collect();
    let mut unicode=Unicode{len:(wide.len()*2) as u16,max:(wide.len()*2) as u16,buffer:wide.as_mut_ptr()};
    let mut attrs=Attributes{len:std::mem::size_of::<Attributes>() as u32,root:root.as_raw_handle(),name:&mut unicode,flags:0x40,security:ptr::null_mut(),quality:ptr::null_mut()};
    let mut status=Status{status:0,information:0};let mut h=ptr::null_mut();
    // WRITE_DATA | READ_ATTRIBUTES | DELETE (rename only) | SYNCHRONIZE.
    // FILE_CREATE; synchronous, non-directory, open-reparse itself; share none.
    let result=unsafe{NtCreateFile(&mut h,0x00110082,&mut attrs,&mut status,ptr::null(),0x80,0,2,0x00200060,ptr::null_mut(),0)};
    if result<0 {return Err(io::Error::from_raw_os_error(unsafe{RtlNtStatusToDosError(result)} as i32))}
    Ok(unsafe{File::from_raw_handle(h)})
}
fn publish(root:&File,name:&str,bytes:&[u8])->io::Result<()> {
    publish_before_rename(root,name,bytes,||{})
}
fn publish_before_rename(root:&File,name:&str,bytes:&[u8],before_rename:impl FnOnce())->io::Result<()> {
    publish_with_writer(root,name,bytes,|file,bytes|file.write_all(bytes).and_then(|_|file.sync_all()),before_rename)
}
fn publish_with_writer(root:&File,name:&str,bytes:&[u8],write:impl FnOnce(&mut File,&[u8])->io::Result<()>,before_rename:impl FnOnce())->io::Result<()> {
    // Deliberately deterministic, visibly related staging name; never opens or
    // overwrites an existing stage. A previous failed stage requires owner review.
    let stage=format!("{name}.pending");
    let mut file=create_relative(root,&stage)?;
    write(&mut file,bytes).map_err(|e|io::Error::other(format!("unpublished stage may remain ({stage}); do not retry automatically: {e}")))?;
    before_rename();
    let wide:Vec<u16>=name.encode_utf16().collect();
    let mut rename:Rename=unsafe{std::mem::zeroed()};rename.length=(wide.len()*2) as u32;rename.name[..wide.len()].copy_from_slice(&wide);
    // Native FileRenameInformation: NULL RootDirectory plus a simple leaf means
    // rename within the source file's existing directory, NOT process cwd.
    // The source handle is exclusive and its parent/ancestors stay pinned.
    // ReplaceIfExists remains FALSE. No Win32-relative or joined-path fallback.
    let mut status=Status{status:0,information:0};
    let result=unsafe{NtSetInformationFile(file.as_raw_handle(),&mut status,&rename as *const _ as *const c_void,std::mem::size_of::<Rename>() as u32,10)};
    if result!=0 {
        return Err(io::Error::other(format!("native publish not confirmed; {stage} retained or outcome uncertain; do not retry: NTSTATUS 0x{:08x}, IO status 0x{:08x}, {}",result as u32,status.status as u32,io::Error::from_raw_os_error(unsafe{RtlNtStatusToDosError(result)} as i32))))
    }
    Ok(()) // atomic namespace publication, NOT a power-loss/directory-fsync claim
}
#[cfg(test)] mod tests {
    use super::*;
    fn fixture()->PathBuf {let p=std::env::temp_dir().join(format!("link-export-{}-{}",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));std::fs::create_dir(&p).unwrap();p}
    #[test] fn publish_exact_and_existing_destination_preserved(){
        let p=fixture();let e=LocalExport::selected_local_directory(&p).unwrap();
        assert!(e.preview("copy.txt","first").unwrap().confirm(true).unwrap());
        assert_eq!(std::fs::read(p.join("copy.txt")).unwrap(),b"first");assert!(!p.join("copy.txt.pending").exists());
        assert!(e.preview("copy.txt","second").unwrap().confirm(true).is_err());
        assert_eq!(std::fs::read(p.join("copy.txt")).unwrap(),b"first");
        assert_eq!(std::fs::read(p.join("copy.txt.pending")).unwrap(),b"second");
        assert!(e.preview("copy.txt","third").unwrap().confirm(true).is_err());
        assert_eq!(std::fs::read(p.join("copy.txt.pending")).unwrap(),b"second");
        drop(e);std::fs::remove_dir_all(p).unwrap();
    }
    #[test] fn denial_and_revocation_create_nothing(){
        let p=fixture();let e=LocalExport::selected_local_directory(&p).unwrap();
        assert!(!e.preview("no.txt","text").unwrap().confirm(false).unwrap());
        let stale=e.preview("stale.txt","text").unwrap();e.revoke();assert!(stale.confirm(true).is_err());
        assert_eq!(std::fs::read_dir(&p).unwrap().count(),0);drop(e);std::fs::remove_dir(p).unwrap();
    }
    #[test] fn root_rename_refused_and_owner_drop_revokes_preview(){
        let p=fixture();let e=LocalExport::selected_local_directory(&p).unwrap();
        assert!(std::fs::rename(&p,p.with_extension("moved")).is_err());
        let stale=e.preview("stale.txt","text").unwrap();drop(e);assert!(stale.confirm(true).is_err());
        assert_eq!(std::fs::read_dir(&p).unwrap().count(),0);std::fs::remove_dir(p).unwrap();
    }
    #[test] fn destination_hardlink_does_not_change_original(){
        let p=fixture();std::fs::write(p.join("original.txt"),"keep").unwrap();std::fs::hard_link(p.join("original.txt"),p.join("target.txt")).unwrap();
        let e=LocalExport::selected_local_directory(&p).unwrap();assert!(e.preview("target.txt","new").unwrap().confirm(true).is_err());
        assert_eq!(std::fs::read_to_string(p.join("original.txt")).unwrap(),"keep");drop(e);std::fs::remove_dir_all(p).unwrap();
    }
    #[test] fn destination_appearing_after_stage_is_not_replaced(){
        let p=fixture();let e=LocalExport::selected_local_directory(&p).unwrap();
        assert!(publish_before_rename(&e.root.dir,"raced.txt",b"candidate",||{
            assert!(!p.join("raced.txt").exists());
            std::fs::write(p.join("raced.txt"),"concurrent owner data").unwrap();
        }).is_err());
        assert_eq!(std::fs::read_to_string(p.join("raced.txt")).unwrap(),"concurrent owner data");
        drop(e);std::fs::remove_dir_all(p).unwrap();
    }
    #[test] fn preexisting_stage_hardlink_is_never_opened_for_write(){
        let p=fixture();std::fs::write(p.join("original.txt"),"keep").unwrap();
        std::fs::hard_link(p.join("original.txt"),p.join("target.txt.pending")).unwrap();
        let e=LocalExport::selected_local_directory(&p).unwrap();
        assert!(e.preview("target.txt","replace").unwrap().confirm(true).is_err());
        assert_eq!(std::fs::read_to_string(p.join("original.txt")).unwrap(),"keep");
        assert!(!p.join("target.txt").exists());drop(e);std::fs::remove_dir_all(p).unwrap();
    }

    fn junction(link:&Path,target:&Path) {
        // CI-only fixtures. cmd's metacharacters are refused, not escaped guesses.
        for p in [link,target] { assert!(!p.to_string_lossy().contains(['&','|','<','>','^','"','%','!','\n','\r'])); }
        let out=std::process::Command::new("cmd.exe").args(["/D","/C","mklink","/J"]).arg(link).arg(target).output().unwrap();
        assert!(out.status.success(),"junction fixture failed: {}",String::from_utf8_lossy(&out.stderr));
    }
    #[test] fn stage_and_destination_reparse_points_never_followed(){
        let p=fixture();let outside=fixture();std::fs::write(outside.join("sentinel.txt"),"keep").unwrap();
        junction(&p.join("stage.txt.pending"),&outside);junction(&p.join("destination.txt"),&outside);
        let e=LocalExport::selected_local_directory(&p).unwrap();
        assert!(e.preview("stage.txt","bad").unwrap().confirm(true).is_err());
        assert!(e.preview("destination.txt","bad").unwrap().confirm(true).is_err());
        assert_eq!(std::fs::read_to_string(outside.join("sentinel.txt")).unwrap(),"keep");
        assert_eq!(std::fs::read_dir(&outside).unwrap().count(),1);
        assert!(!p.join("stage.txt").exists());drop(e);
        std::fs::remove_dir(p.join("stage.txt.pending")).unwrap();std::fs::remove_dir(p.join("destination.txt")).unwrap();
        std::fs::remove_dir_all(p).unwrap();std::fs::remove_dir_all(outside).unwrap();
    }
    #[test] fn selected_reparse_root_and_ancestor_are_refused(){
        let p=fixture();let outside=fixture();std::fs::create_dir(outside.join("child")).unwrap();
        junction(&p.join("linked"),&outside);
        assert!(LocalExport::selected_local_directory(&p.join("linked")).is_err());
        assert!(LocalExport::selected_local_directory(&p.join("linked/child")).is_err());
        std::fs::remove_dir(p.join("linked")).unwrap();std::fs::remove_dir_all(p).unwrap();std::fs::remove_dir_all(outside).unwrap();
    }
    #[test] fn pinned_ancestor_rename_and_incompatible_writer_refused(){
        use std::os::windows::fs::OpenOptionsExt;
        let p=fixture();let child=p.join("child");std::fs::create_dir(&child).unwrap();
        let e=LocalExport::selected_local_directory(&child).unwrap();
        assert!(std::fs::rename(&p,p.with_extension("moved")).is_err());
        drop(e);
        // Existing directory DELETE access conflicts with retained read-only sharing.
        let writer=std::fs::OpenOptions::new().access_mode(0x10000).share_mode(7).custom_flags(0x02200000).open(&child).unwrap();
        assert!(LocalExport::selected_local_directory(&child).is_err());drop(writer);
        std::fs::remove_dir_all(p).unwrap();
    }
    #[test] fn failed_partial_write_or_sync_never_publishes(){
        let p=fixture();let e=LocalExport::selected_local_directory(&p).unwrap();
        assert!(publish_with_writer(&e.root.dir,"partial.txt",b"complete",|f,_|{f.write_all(b"part")?;Err(io::Error::other("injected write failure"))},||panic!("rename after failure")).is_err());
        assert!(!p.join("partial.txt").exists());assert_eq!(std::fs::read(p.join("partial.txt.pending")).unwrap(),b"part");
        assert!(publish_with_writer(&e.root.dir,"sync.txt",b"complete",|f,b|{f.write_all(b)?;Err(io::Error::other("injected sync failure"))},||panic!("rename after sync failure")).is_err());
        assert!(!p.join("sync.txt").exists());assert_eq!(std::fs::read(p.join("sync.txt.pending")).unwrap(),b"complete");
        drop(e);std::fs::remove_dir_all(p).unwrap();
    }
    #[test] fn short_long_names_and_final_handle_released(){
        let p=fixture();let e=LocalExport::selected_local_directory(&p).unwrap();
        for name in ["x".to_string(),"x".repeat(80)] {
            assert!(e.preview(&name,"exact").unwrap().confirm(true).unwrap());
            assert_eq!(std::fs::read(p.join(&name)).unwrap(),b"exact");
            // Read/write open proves publish released its exclusive file handle.
            assert!(std::fs::OpenOptions::new().read(true).write(true).open(p.join(&name)).is_ok());
        }
        drop(e);std::fs::remove_dir_all(p).unwrap();
    }

    #[test]
    #[ignore="subprocess fixture invoked explicitly by same_parent_does_not_use_cwd"]
    fn same_parent_worker(){
        let p=PathBuf::from(std::env::var_os("COMPUTER_LINK_SYNTHETIC_ROOT").expect("fixture root"));
        let e=LocalExport::selected_local_directory(&p).unwrap();
        assert!(e.preview("context.txt","same-parent").unwrap().confirm(true).unwrap());
    }
    #[test] fn same_parent_does_not_use_cwd(){
        let p=fixture();let other=fixture();
        let out=std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact","windows::tests::same_parent_worker","--ignored","--test-threads=1"])
            .current_dir(&other).env("COMPUTER_LINK_SYNTHETIC_ROOT",&p).output().unwrap();
        assert!(out.status.success(),"child failed: {} {}",String::from_utf8_lossy(&out.stdout),String::from_utf8_lossy(&out.stderr));
        assert_eq!(std::fs::read(p.join("context.txt")).unwrap(),b"same-parent");
        assert_eq!(std::fs::read_dir(&other).unwrap().count(),0);
        std::fs::remove_dir_all(p).unwrap();std::fs::remove_dir(other).unwrap();
    }

}
