//! Explicit one-level metadata capture. Never opens entry content or follows entries.
//! This is a bounded observation, not an atomic directory snapshot or access grant.
use std::io;
const MAX_ROWS: usize = 64;
const MAX_BYTES: usize = 4096;
#[derive(Clone, Copy)]
pub enum Kind { File, Directory, Reparse, Other }
fn label(kind: Kind) -> &'static str {
    match kind { Kind::File => "file", Kind::Directory => "directory", Kind::Reparse => "reparse-not-followed", Kind::Other => "other" }
}
// JSON escape controls and directional formatting without altering the actual name.
fn quoted(value: &str) -> String {
    let mut result = String::from("\"");
    for c in value.chars() {
        match c {
            '"' => result.push_str("\\\""), '\\' => result.push_str("\\\\"),
            c if c.is_control() || matches!(c, '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}') => {
                use std::fmt::Write;
                for unit in c.encode_utf16(&mut [0; 2]) { write!(&mut result, "\\u{unit:04x}").unwrap(); }
            }
            c => result.push(c),
        }
    }
    result.push('"'); result
}
pub fn encode(mut rows: Vec<(String, Kind)>) -> io::Result<Vec<u8>> {
    if rows.len() > MAX_ROWS { return Err(io::Error::other("folder exceeds 64 entries")); }
    rows.sort_by(|a,b| a.0.cmp(&b.0));
    let mut result = String::from("{\"schema\":\"local-folder-inventory/v1\",\"recursive\":false,\"entries\":[");
    for (index,(name,kind)) in rows.iter().enumerate() {
        // The public helper also refuses inputs that could masquerade as paths.
        if name.is_empty() || name == "." || name == ".." || name.contains(['/', '\\', '\0']) {
            return Err(io::Error::other("invalid leaf name"));
        }
        if index != 0 { result.push(','); }
        result.push_str(&format!("{{\"name\":{},\"kind\":\"{}\"}}",quoted(name),label(*kind)));
        if result.len()+2 > MAX_BYTES { return Err(io::Error::other("folder inventory exceeds 4096 bytes")); }
    }
    result.push_str("]}"); Ok(result.into_bytes())
}
/// Late approval after Disconnect must not cause even a local enumeration.
pub fn capture_if_current<T>(approved: bool, generation: u64, current: u64, read: impl FnOnce() -> T) -> Option<T> {
    if approved && generation == current { Some(read()) } else { None }
}
#[cfg(windows)]
pub fn capture(path: &std::path::Path) -> io::Result<Vec<u8>> {
    use std::os::windows::fs::MetadataExt;
    let _parents = crate::root_scope::pin_parents(path)?;
    let _directory = crate::root_scope::pin_directory(path)?;
    let mut rows = Vec::new();
    for entry in std::fs::read_dir(path)? {
        if rows.len() == MAX_ROWS { return Err(io::Error::other("folder exceeds 64 entries")); }
        let entry = entry?;
        let name = entry.file_name().into_string().map_err(|_| io::Error::other("non-Unicode filename refused"))?;
        // DirEntry::metadata does not follow symlinks; on Windows it uses enumeration data.
        let metadata = entry.metadata()?;
        let kind = if metadata.file_attributes() & 0x400 != 0 { Kind::Reparse }
            else if metadata.is_dir() { Kind::Directory }
            else if metadata.is_file() { Kind::File } else { Kind::Other };
        rows.push((name,kind));
    }
    encode(rows)
}
/// Native owner-only folder selection. Shell browsing itself may contact shell providers.
/// No path from a remote client is accepted. MAX_PATH conversion failure is a refusal.
#[cfg(windows)]
pub fn choose(owner: isize) -> io::Result<Option<std::path::PathBuf>> {
    choose_titled(owner,"Select ONE local folder for a names/types inventory; no child contents.")
}
#[cfg(windows)]
pub(crate) fn choose_titled(owner: isize, label:&str) -> io::Result<Option<std::path::PathBuf>> {
    use std::{ffi::c_void, ptr, os::windows::ffi::OsStringExt};
    type H = *mut c_void;
    #[repr(C)] struct Browse { owner:H, root:H, display:*mut u16, title:*const u16, flags:u32,
        callback:Option<unsafe extern "system" fn(H,u32,isize,isize)->i32>, data:isize, image:i32 }
    #[link(name="ole32")] unsafe extern "system" {
        fn CoInitializeEx(reserved:H,flags:u32)->i32; fn CoUninitialize(); fn CoTaskMemFree(p:H);
    }
    #[link(name="shell32")] unsafe extern "system" {
        fn SHBrowseForFolderW(info:*mut Browse)->H; fn SHGetPathFromIDListW(id:H,path:*mut u16)->i32;
    }
    if unsafe { CoInitializeEx(ptr::null_mut(),2) } < 0 { return Err(io::Error::other("folder dialog initialization failed")); }
    struct Com; impl Drop for Com { fn drop(&mut self) { unsafe { CoUninitialize(); } } }
    let _com=Com;
    let title:Vec<u16>=label.encode_utf16().chain(Some(0)).collect();
    let mut display=[0u16;260];
    let mut info=Browse{owner:owner as H,root:ptr::null_mut(),display:display.as_mut_ptr(),title:title.as_ptr(),
        flags:0x1|0x10|0x40|0x200|0x400,callback:None,data:0,image:0};
    let id=unsafe { SHBrowseForFolderW(&mut info) };
    if id.is_null() { return Ok(None); }
    let mut path=[0u16;260]; let ok=unsafe { SHGetPathFromIDListW(id,path.as_mut_ptr()) };
    unsafe { CoTaskMemFree(id); }
    if ok==0 { return Err(io::Error::other("folder path unavailable or too long")); }
    let n=path.iter().position(|c|*c==0).ok_or_else(||io::Error::other("folder path too long"))?;
    if n==0 { return Err(io::Error::other("empty folder path refused")); }
    Ok(Some(std::path::PathBuf::from(std::ffi::OsString::from_wide(&path[..n]))))
}
#[cfg(test)] mod tests {
    use super::*;
    #[test] fn sorted_escaped_typed_and_no_paths() {
        let result=String::from_utf8(encode(vec![("z\"\n\u{202e}".into(),Kind::File),("a".into(),Kind::Directory),("link".into(),Kind::Reparse)]).unwrap()).unwrap();
        assert!(result.contains("\"name\":\"z\\\"\\u000a\\u202e\""));
        assert!(result.find("\"name\":\"a\"").unwrap()<result.find("\"name\":\"z").unwrap());
        assert!(result.contains("reparse-not-followed")); assert!(result.contains("\"recursive\":false"));
        for name in ["", ".", "..", "a/b", "a\\b", "a\0b"] { assert!(encode(vec![(name.into(),Kind::File)]).is_err()); }
    }
    #[test] fn exact_count_and_byte_bounds_no_partial_output() {
        assert!(encode((0..64).map(|n|(n.to_string(),Kind::File)).collect()).is_ok());
        assert!(encode((0..65).map(|n|(n.to_string(),Kind::File)).collect()).is_err());
        let overhead=encode(vec![("x".into(),Kind::File)]).unwrap().len()-1;
        assert_eq!(encode(vec![("x".repeat(MAX_BYTES-overhead),Kind::File)]).unwrap().len(),MAX_BYTES);
        assert!(encode(vec![("x".repeat(MAX_BYTES-overhead+1),Kind::File)]).is_err());
        assert!(encode(vec![("\n".repeat(1000),Kind::File)]).is_err());
    }
    #[test] fn denied_or_revoked_consent_never_enumerates() {
        assert!(capture_if_current(false,4,4,||panic!("denied capture")).is_none());
        assert!(capture_if_current(true,4,5,||panic!("revoked capture")).is_none());
        assert_eq!(capture_if_current(true,5,5,||42),Some(42));
    }
    #[cfg(windows)]
    #[test] fn actual_directory_metadata_only_and_no_recursion() {
        let dir=std::env::temp_dir().join(format!("owner-folder-{}-{}",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        std::fs::create_dir(&dir).unwrap(); std::fs::create_dir(dir.join("nested")).unwrap();
        std::fs::write(dir.join("a.txt"),b"private content must not be captured").unwrap();
        std::fs::write(dir.join("nested/hidden.txt"),b"child content").unwrap();
        let bytes=capture(&dir).unwrap(); let value=String::from_utf8(bytes.clone()).unwrap();
        assert!(value.contains("a.txt")); assert!(value.contains("nested"));
        assert!(!value.contains("private content")); assert!(!value.contains("hidden.txt"));
        assert!(!value.contains(dir.to_str().unwrap()));
        std::fs::write(dir.join("later.txt"),b"later").unwrap(); assert!(!value.contains("later.txt"));
        assert_ne!(capture(&dir).unwrap(),bytes);
        for n in 0..64 { std::fs::write(dir.join(format!("entry{n}")),b"").unwrap(); }
        assert!(capture(&dir).is_err());
        assert!(capture(&dir.join("a.txt")).is_err());
        assert_eq!(std::fs::read(dir.join("a.txt")).unwrap(),b"private content must not be captured");
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[cfg(windows)]
    #[test] fn junction_entry_not_followed_and_junction_scope_refused() {
        let root=std::env::temp_dir().join(format!("owner-junction-{}-{}",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let scope=root.join("scope"); let outside=root.join("outside"); let link=scope.join("link");
        std::fs::create_dir_all(&scope).unwrap(); std::fs::create_dir_all(outside.join("child")).unwrap();
        std::fs::write(outside.join("private.txt"),b"not shared").unwrap();
        let output=std::process::Command::new("cmd.exe").args(["/d","/c","mklink","/J"]).arg(&link).arg(&outside).output().unwrap();
        assert!(output.status.success(),"disposable junction creation failed");
        let value=String::from_utf8(capture(&scope).unwrap()).unwrap();
        assert!(value.contains("\"name\":\"link\",\"kind\":\"reparse-not-followed\""));
        assert!(!value.contains("private.txt")); assert!(!value.contains("not shared"));
        assert!(capture(&link).is_err()); assert!(capture(&link.join("child")).is_err());
        std::fs::remove_dir(&link).unwrap();
        assert_eq!(std::fs::read(outside.join("private.txt")).unwrap(),b"not shared");
        std::fs::remove_dir_all(root).unwrap();
    }

}
