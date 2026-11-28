//! Local owner export worker. No RPC, listener, command-line authority or auto retry.
//! File chooser/admission/write/sync/rename never execute on the owner UI thread.
use std::{io,sync::{Arc,atomic::{AtomicU8,Ordering},mpsc},thread};
use computer_link_local_export_candidate::windows::LocalExport;
const WAITING:u8=0;const ADMITTED:u8=1;const CANCELLED:u8=2;const DONE:u8=3;
#[derive(Clone)]struct Gate(Arc<AtomicU8>);
impl Gate{
 fn new()->Self{Self(Arc::new(AtomicU8::new(WAITING)))}
 fn admit(&self)->bool{self.0.compare_exchange(WAITING,ADMITTED,Ordering::AcqRel,Ordering::Acquire).is_ok()}
 fn cancel(&self){let _=self.0.compare_exchange(WAITING,CANCELLED,Ordering::AcqRel,Ordering::Acquire);}
 fn cancelled(&self)->bool{self.0.load(Ordering::Acquire)==CANCELLED}
 fn done(&self){self.0.store(DONE,Ordering::Release);}
}
pub enum Event { Preview{display:String,approval:mpsc::Sender<bool>}, Finished(Result<String,String>) }
pub struct Task {gate:Gate,events:mpsc::Receiver<Event>,approval:Option<mpsc::Sender<bool>>}
impl Task{
 pub fn start(bytes:Vec<u8>,notify:impl Fn()+Send+'static)->io::Result<Self>{
  if bytes.len()>4096||std::str::from_utf8(&bytes).is_err(){return Err(io::Error::other("bounded UTF8 snapshot required"))}
  let gate=Gate::new();let worker_gate=gate.clone();let(tx,events)=mpsc::channel();
  thread::Builder::new().name("owner-local-export".into()).spawn(move||{
   let result=std::panic::catch_unwind(std::panic::AssertUnwindSafe(||run(bytes,&worker_gate,&tx,&notify)))
    .unwrap_or_else(|_|Err("Export worker failed; outcome may be uncertain. Inspect the selected folder before retrying.".into()));
   worker_gate.done();let _=tx.send(Event::Finished(result));notify();
  })?;
  Ok(Self{gate,events,approval:None})
 }
 pub fn poll(&mut self)->Option<Event>{self.events.try_recv().ok()}
 pub fn set_approval(&mut self,approval:mpsc::Sender<bool>)->bool{
  if self.gate.cancelled(){let _=approval.send(false);false}else{self.approval=Some(approval);true}
 }
 pub fn approve(&mut self,yes:bool){if let Some(tx)=self.approval.take(){let _=tx.send(yes&&!self.gate.cancelled());}}
 /// Nonblocking: denies future admission. An already admitted write can finish.
 /// Do not announce cancellation/rollback or allow another operation until Finished.
 pub fn cancel(&mut self){self.gate.cancel();self.approve(false);}
}
impl Drop for Task{fn drop(&mut self){self.cancel();}}
fn run(bytes:Vec<u8>,gate:&Gate,events:&mpsc::Sender<Event>,notify:&impl Fn())->Result<String,String>{
 if gate.cancelled(){return Ok("Export cancelled before folder selection; no file created.".into())}
 // No main-window ownership: a shell dialog waiting on a provider must not disable
 // or synchronously block the main UI. Exit terminates this in-process worker.
 let Some(path)=crate::folder_inventory::choose_titled(0,"Select a trusted local NTFS folder for new text export; nothing written before preview approval.").map_err(|e|format!("Folder selection refused: {e}"))? else{return Ok("Export cancelled; no file created.".into())};
 if gate.cancelled(){return Ok("Export cancelled before folder admission; no file created.".into())}
 let export=LocalExport::selected_local_directory(&path).map_err(|e|format!("Folder admission refused: {e}"))?;
 if gate.cancelled(){return Ok("Export cancelled before preview; no file created.".into())}
 let preview=export.preview("computer-link-export.txt",std::str::from_utf8(&bytes).map_err(|_|"UTF8 refused")?).map_err(|e|e.to_string())?;
 let display=format!("{}\n\nOnly continue for a trusted, quiescent local NTFS folder. No remote destination or arbitrary file edits. Disconnect before admission cancels. Once writing starts it may finish; cancellation does not undo a saved file. Exit ends this process, but its final disk outcome may be uncertain.",preview.display());
 let(approval,answer)=mpsc::channel();events.send(Event::Preview{display,approval}).map_err(|_|"Owner UI closed".to_string())?;notify();
 if !answer.recv().unwrap_or(false)||!gate.admit(){return Ok("Export cancelled before write admission; no file created.".into())}
 preview.confirm(true).map_err(|e|format!("Export not confirmed: {e}. Inspect {path:?} before retrying."))?;
 Ok(format!("Created computer-link-export.txt in {path:?}. Existing files were not overwritten. Nothing was shared remotely."))
}
#[cfg(test)]mod tests{
 use super::*;
 #[test]fn cancellation_fences_pending_admission(){let g=Gate::new();g.cancel();assert!(!g.admit());assert!(g.cancelled());}
 #[test]fn admitted_work_is_not_falsely_cancelled(){let g=Gate::new();assert!(g.admit());g.cancel();assert!(!g.cancelled());assert!(!g.admit());g.done();assert!(!g.admit());}
 #[test]fn cancel_sends_denial_without_waiting_for_worker(){let(tx,rx)=mpsc::channel();let(_out,events)=mpsc::channel();let mut t=Task{gate:Gate::new(),events,approval:Some(tx)};t.cancel();assert!(!rx.try_recv().unwrap());assert!(!t.gate.admit());}
 #[test]fn late_preview_after_cancel_is_denied(){let(_out,events)=mpsc::channel();let mut t=Task{gate:Gate::new(),events,approval:None};t.cancel();let(tx,rx)=mpsc::channel();t.set_approval(tx);assert!(!rx.try_recv().unwrap());t.approve(true);}
}
