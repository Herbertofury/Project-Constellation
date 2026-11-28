//! Local-only one-use text export candidate. No overwrite, delete, socket or RPC.
//! Native backend remains opt-in to review, not owner UI integrated.
use std::{io, sync::{Arc, Mutex}};
#[cfg(windows)] pub mod windows;
const MAX_BYTES: usize = 4096;
#[derive(Clone)]
pub struct Session(Arc<Mutex<bool>>);
impl Default for Session { fn default() -> Self { Self::new() } }
impl Session {
    pub fn new() -> Self { Self(Arc::new(Mutex::new(false))) }
    /// Serializes with commit. A commit already admitted finishes before this returns;
    /// nothing can start afterwards. Not cancellation of blocking filesystem I/O.
    pub fn revoke(&self) { *self.0.lock().unwrap_or_else(|e| e.into_inner()) = true; }
    pub fn preview(&self, name: &str, text: &str) -> io::Result<Preview> {
        if *self.0.lock().map_err(|_| io::Error::other("session unavailable"))? { return Err(io::Error::other("revoked")); }
        validate_leaf(name)?;
        if text.len() > MAX_BYTES { return Err(io::Error::other("4096 byte limit")); }
        Ok(Preview { session:self.clone(), name:name.into(), text:text.into() })
    }
}
fn validate_leaf(name:&str)->io::Result<()> {
    let stem=name.split('.').next().unwrap_or("").to_ascii_uppercase();
    if name.is_empty() || name.len()>80 || name.starts_with('.') || name.ends_with('.') ||
        !name.bytes().all(|c| c.is_ascii_alphanumeric() || b"._-".contains(&c)) ||
        ["CON","PRN","AUX","NUL"].contains(&stem.as_str()) ||
        ((stem.starts_with("COM") || stem.starts_with("LPT")) && stem.len()==4 && stem.as_bytes()[3].is_ascii_digit()) {
        return Err(io::Error::other("ordinary ASCII leaf required"));
    }
    Ok(())
}
pub struct Preview { session:Session, name:String, text:String }
impl Preview {
    pub fn name(&self)->&str { &self.name }
    pub fn text(&self)->&str { &self.text }
    /// Escaped display preserves control characters without visual spoofing.
    pub fn display(&self)->String { format!("NEW local file: {:?}\nUTF-8 bytes: {}\nExact text: {:?}\nNo overwrite. A failed attempt may leave a .pending file. No automatic retry.",self.name,self.text.len(),self.text) }
    /// Consumes preview even on refusal/failure. Owner adapter must show exact root,
    /// name and text, and pass true only for this particular local approval.
    pub fn approve(self, approved:bool)->Option<Approved> { approved.then_some(Approved(self)) }
}
pub struct Approved(Preview);
impl Approved {
    // Backend is deliberately crate-private: no arbitrary external callback can
    // claim confinement or treat approval as remote authority.
    fn commit(self, effect:impl FnOnce(&str,&[u8])->io::Result<()>)->io::Result<()> {
        let guard=self.0.session.0.lock().map_err(|_|io::Error::other("session unavailable"))?;
        if *guard { return Err(io::Error::other("revoked")); }
        effect(&self.0.name,self.0.text.as_bytes())
    }
}
#[cfg(test)] mod tests {
    use super::*;
    #[test] fn preview_exact_and_no_effect_on_deny() {
        let p=Session::new().preview("copy.txt","new\ntext\u{202e}").unwrap();
        assert_eq!(p.text(),"new\ntext\u{202e}"); assert!(p.display().contains("\\u{202e}"));
        assert!(p.approve(false).is_none());
    }
    #[test] fn stale_preview_and_approval_refused() {
        let s=Session::new(); let p=s.preview("a.txt","hello").unwrap(); s.revoke();
        let mut called=false; assert!(p.approve(true).unwrap().commit(|_,_|{called=true;Ok(())}).is_err());
        assert!(!called); assert!(s.preview("b.txt","").is_err()); s.revoke();
    }
    #[test] fn distinct_session_cannot_revive_old_consent() {
        let s=Session::new(); let a=s.preview("x","").unwrap().approve(true).unwrap();s.revoke();
        let _new=Session::new();assert!(a.commit(|_,_|panic!("revived")).is_err());
    }
    #[test] fn bounds_and_namespace() {
        for n in ["", ".", "..", "../x", "x/y", "x\\y", "C:x", "CON", "nul.txt", "COM1.txt", "LPT9", "x.", "x ", "é", "x:y"] {
            assert!(Session::new().preview(n,"").is_err(),"{n}");
        }
        assert!(Session::new().preview("a",&"x".repeat(4096)).is_ok());
        assert!(Session::new().preview("a",&"x".repeat(4097)).is_err());
    }
    #[test] fn approved_bytes_are_immutable_and_failure_propagates() {
        let p=Session::new().preview("out.txt","keep exact").unwrap();
        assert!(p.approve(true).unwrap().commit(|n,b|{assert_eq!(n,"out.txt");assert_eq!(b,b"keep exact");Err(io::Error::other("uncertain"))}).is_err());
    }
    #[test] fn revocation_waits_for_admitted_operation_then_blocks() {
        let s=Session::new(); let a=s.preview("a","").unwrap().approve(true).unwrap();
        let later=s.preview("b","").unwrap().approve(true).unwrap();
        let (started,wait)=std::sync::mpsc::channel(); let (finish,done)=std::sync::mpsc::channel();
        let job=std::thread::spawn(move||a.commit(|_,_|{started.send(()).unwrap();done.recv().unwrap();Ok(())}));
        wait.recv().unwrap();let revoker=std::thread::spawn(move||s.revoke());finish.send(()).unwrap();
        job.join().unwrap().unwrap();revoker.join().unwrap();assert!(later.commit(|_,_|panic!("post revoke effect")).is_err());
    }
}
