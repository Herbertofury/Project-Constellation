#![cfg(windows)]
//! Real interactive owner-owned MCP, synthetic status only. No external host.
use computer_link_owner_proof::Owner;
use std::{io::{BufRead,BufReader,Write,Read},path::PathBuf,sync::mpsc,time::Duration};
fn bridge()->PathBuf{
 let built=PathBuf::from(env!("CARGO_BIN_EXE_computer-link-mcp-session"));
 let Some(dir)=std::env::var_os("COMPUTER_LINK_TEST_INSTALLED_DIR") else{return built};
 let dir=PathBuf::from(dir);assert!(dir.is_absolute()&&dir.is_dir(),"invalid installed fixture directory");
 let path=dir.join(built.file_name().unwrap());assert!(path.is_file(),"missing installed fixture, no build-tree fallback");
 eprintln!("status bridge source: installed fixture");path
}
fn read_lines(output:std::fs::File)->mpsc::Receiver<Vec<u8>>{
 let(tx,rx)=mpsc::channel();std::thread::spawn(move||{
  let mut reader=BufReader::new(output);loop{
   let mut line=Vec::new();match reader.by_ref().take(8193).read_until(b'\n',&mut line){
    Ok(0)=>break,Ok(_) if line.len()<=8192&&line.ends_with(b"\n")=>{if tx.send(line).is_err(){break}},_=>break
   }
  }
 });rx
}
fn reply(rx:&mpsc::Receiver<Vec<u8>>)->serde_json::Value{serde_json::from_slice(&rx.recv_timeout(Duration::from_secs(5)).expect("bounded MCP response")).unwrap()}
#[test]fn actual_interactive_status_child_routes_requests_and_disconnect_breaks_io(){
 let mut owner=Owner::default();let mut io=owner.launch_local_status_session(&bridge()).unwrap();
 assert!(owner.launch_local_status_session(&bridge()).is_err());
 let rx=read_lines(io.output);
 writeln!(io.input,"{}",r#"{"jsonrpc":"2.0","id":17,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"local-owner-test","version":"1"}}}"#).unwrap();
 assert_eq!(reply(&rx)["id"],17);
 writeln!(io.input,"{}",r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#).unwrap();
 writeln!(io.input,"{}",r#"{"jsonrpc":"2.0","id":29,"method":"tools/list"}"#).unwrap();
 let list=reply(&rx);assert_eq!(list["id"],29);
 assert!(!list.to_string().contains("read_owner_snapshot"));
 // Responses follow actual independent caller requests, not a fixed transcript.
 writeln!(io.input,"{}",r#"{"jsonrpc":"2.0","id":31,"method":"tools/call","params":{"name":"read_owner_snapshot","arguments":{}}}"#).unwrap();
 let denied=reply(&rx);assert_eq!(denied["id"],31);assert!(denied.get("error").is_some()||denied["result"]["isError"]==true);
 assert!(owner.local_worker_exit_code().unwrap().is_none());
 owner.disconnect().unwrap();
 assert!(matches!(rx.recv_timeout(Duration::from_secs(3)),Err(mpsc::RecvTimeoutError::Disconnected)),"stdout must close after Job termination");
 assert!(io.input.write_all(b"{}\n").is_err(),"stdin must not survive disconnect");
 owner.disconnect().unwrap();
}
#[test]fn actual_interactive_drop_terminates_waiting_child(){
 let mut owner=Owner::default();let io=owner.launch_local_status_session(&bridge()).unwrap();let rx=read_lines(io.output);
 drop(owner);
 assert!(matches!(rx.recv_timeout(Duration::from_secs(3)),Err(mpsc::RecvTimeoutError::Disconnected)));
}
#[test]fn actual_interactive_eof_exits_without_restart(){
 let mut owner=Owner::default();let io=owner.launch_local_status_session(&bridge()).unwrap();let rx=read_lines(io.output);
 drop(io.input);assert!(matches!(rx.recv_timeout(Duration::from_secs(3)),Err(mpsc::RecvTimeoutError::Disconnected)));
 // No automatic re-launch: the old worker remains owned until explicit cleanup.
 assert!(owner.launch_local_status_session(&bridge()).is_err());owner.disconnect().unwrap();
}

#[test]fn actual_partial_status_frame_disconnect_and_fresh_session(){
 use computer_link_owner_proof::status_protocol::StatusClient;
 let mut owner=Owner::default();
 let path=bridge();
 let io=owner.launch_local_status_session(&path).unwrap();
 let mut input=io.input;
 let rx=read_lines(io.output);
 writeln!(input,"{}",r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"disposable-partial-frame-fixture","version":"1"}}}"#).unwrap();
 assert_eq!(reply(&rx)["id"],1);
 writeln!(input,"{}",r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#).unwrap();
 writeln!(input,"{}",r#"{"jsonrpc":"2.0","id":2,"method":"tools/list"}"#).unwrap();
 let tools=reply(&rx);assert_eq!(tools["id"],2);
 let tools=tools["result"]["tools"].as_array().unwrap();assert_eq!(tools.len(),1);assert_eq!(tools[0]["name"],"connection_status");
 // Complete JSON, deliberately no terminating newline. The server must wait for
 // framing, rather than returning success for an incomplete request.
 let pending=br#"{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"connection_status","arguments":{}}}"#;
 input.write_all(pending).unwrap();input.flush().unwrap();
 assert!(matches!(rx.recv_timeout(Duration::from_millis(150)),Err(mpsc::RecvTimeoutError::Timeout)),"partial frame must not yield a response or terminate the child");
 owner.disconnect().unwrap();
 assert!(owner.local_worker_pid().is_none());
 assert!(matches!(rx.recv_timeout(Duration::from_secs(3)),Err(mpsc::RecvTimeoutError::Disconnected)),"old stdout must end without response");
 assert!(input.write_all(b"\n").is_err(),"old input must refuse frame completion after revocation");
 // No implicit respawn. Fresh owner launch + full handshake is required.
 let next=owner.launch_local_status_session(&path).unwrap();
 let mut client=StatusClient::initialize(BufReader::new(next.output),next.input).unwrap();
 client.check().unwrap();
 owner.disconnect().unwrap();
 assert!(client.check().is_err());
}
