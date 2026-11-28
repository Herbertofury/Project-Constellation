#![cfg(windows)]
//! Disposable real executable acceptance; never reads owner files or starts services.
use std::{fs,io::Write,path::PathBuf,process::{Command,Stdio},time::{SystemTime,UNIX_EPOCH}};
use serde_json::Value;
fn fresh()->PathBuf { std::env::temp_dir().join(format!("computer-link-stdio-{}-{}",std::process::id(),SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos())) }
fn run(p:&PathBuf, input:&[u8])->std::process::Output {
 let mut child=Command::new(env!("CARGO_BIN_EXE_computer-link-workspace-candidate")).args(["--consent-new-workspace",p.to_str().unwrap()]).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
 child.stdin.take().unwrap().write_all(input).unwrap(); child.wait_with_output().unwrap()
}
fn rows(out:&std::process::Output)->Vec<Value>{String::from_utf8(out.stdout.clone()).unwrap().lines().map(|s|serde_json::from_str(s).unwrap()).collect()}
#[test]fn executable_roundtrip_preserves_and_revokes(){
 let p=fresh();let out=run(&p,b"{\"op\":\"write_new\",\"name\":\"one.txt\",\"text\":\"keep\"}\n{\"op\":\"read\",\"name\":\"one.txt\"}\n{\"op\":\"write_new\",\"name\":\"one.txt\",\"text\":\"replace\"}\n{\"op\":\"revoke\"}\n{\"op\":\"list\"}\n");
 assert!(out.status.success());let r=rows(&out);assert_eq!(r.len(),5);assert_eq!(r[0]["ok"],true);assert_eq!(r[1]["result"]["text"],"keep");assert_eq!(r[2]["ok"],false);assert_eq!(r[4]["error"],"revoked");assert_eq!(fs::read_to_string(p.join("one.txt")).unwrap(),"keep");fs::remove_dir_all(p).unwrap();
}
#[test]fn malformed_and_unsupported_requests_have_no_effect(){
 let p=fresh();let out=run(&p,b"{\"op\":\"list\",\"op\":\"revoke\"}\n{\"op\":\"delete\",\"name\":\"one\"}\n{\"op\":\"list\",\"text\":\"irrelevant\"}\n{\"op\":\"list\"}\n");assert!(out.status.success());let r=rows(&out);assert_eq!(r.len(),4);for row in &r[..3]{assert_eq!(row["ok"],false);}assert_eq!(r[3]["result"],serde_json::json!([]));assert_eq!(fs::read_dir(&p).unwrap().count(),0);fs::remove_dir(p).unwrap();
}
#[test]fn truncated_and_session_exhaustion_fail_closed(){
 let p=fresh();let out=run(&p,b"{\"op\":\"list\"}");assert!(!out.status.success());assert!(out.stdout.is_empty());fs::remove_dir(p).unwrap();
 let p=fresh();let out=run(&p,&[b"{\"op\":\"list\"}\n".repeat(128),b"{\"op\":\"write_new\",\"name\":\"must-not-exist\",\"text\":\"bad\"}\n".to_vec()].concat());assert!(!out.status.success());assert_eq!(rows(&out).len(),128);assert_eq!(fs::read_dir(&p).unwrap().count(),0);fs::remove_dir(p).unwrap();
}
