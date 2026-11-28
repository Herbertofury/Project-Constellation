#![cfg(windows)]
use computer_link_owner_proof::Owner;
use std::{path::Path,time::{Duration,Instant},thread};
fn bridge()->&'static Path{Path::new(env!("CARGO_BIN_EXE_computer-link-mcp-session"))}
fn complete(owner:&Owner)->u32{let deadline=Instant::now()+Duration::from_secs(8);loop{if let Some(code)=owner.local_worker_exit_code().unwrap(){return code}assert!(Instant::now()<deadline,"owned bridge did not finish");thread::sleep(Duration::from_millis(10));}}
#[test]fn owner_launches_actual_bridge_one_read_no_forwarding(){
 let mut owner=Owner::default();let count=std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));let calls=count.clone();
 owner.launch_local_snapshot_probe(bridge(),b"PRIVATE SYNTHETIC ONLY".to_vec(),move|_,_,_|{calls.fetch_add(1,std::sync::atomic::Ordering::SeqCst);Ok(true)}).unwrap();
 assert_eq!(complete(&owner),0);assert_eq!(count.load(std::sync::atomic::Ordering::SeqCst),1);
 assert!(owner.launch_local_snapshot_probe(bridge(),vec![],|_,_,_|Ok(true)).is_err());owner.disconnect().unwrap();
}
#[test]fn owner_probe_denial_reports_failure(){let mut owner=Owner::default();owner.launch_local_snapshot_probe(bridge(),b"private".to_vec(),|_,_,_|Ok(false)).unwrap();assert_ne!(complete(&owner),0);owner.disconnect().unwrap();}
#[test]fn owner_probe_disconnect_kills_pending_child(){
 let mut owner=Owner::default();let (tx,rx)=std::sync::mpsc::channel();
 owner.launch_local_snapshot_probe(bridge(),b"private".to_vec(),move|_,_,stop|{tx.send(()).unwrap();let end=Instant::now()+Duration::from_secs(8);while !stop.stopped(){if Instant::now()>=end{return Err(std::io::Error::other("fixture stop timeout"))}thread::sleep(Duration::from_millis(5));}Ok(false)}).unwrap();
 rx.recv_timeout(Duration::from_secs(5)).unwrap();assert!(owner.local_worker_exit_code().unwrap().is_none());owner.disconnect().unwrap();assert!(owner.local_worker_exit_code().unwrap().is_none());
}
#[test]fn owner_probe_invalid_snapshot_starts_nothing(){let mut owner=Owner::default();assert!(owner.launch_local_snapshot_probe(bridge(),vec![0;4097],|_,_,_|Ok(true)).is_err());assert!(owner.local_worker_exit_code().unwrap().is_none());owner.disconnect().unwrap();}
