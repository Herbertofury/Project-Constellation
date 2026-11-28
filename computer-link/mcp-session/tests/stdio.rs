use std::{process::{Child,Command,Stdio,Output},io::{Read,Write},thread,time::{Duration,Instant}};
const FLOW:&str = concat!(
"{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2025-06-18\",\"capabilities\":{},\"clientInfo\":{\"name\":\"fixture\",\"version\":\"1\"}}}\n",
"{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}\n",
"{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/list\"}\n");
fn spawn(args:&[&str])->Child {
    Command::new(env!("CARGO_BIN_EXE_computer-link-mcp-session")).args(args).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap()
}
// Drain concurrently: a valid escaped snapshot can exceed a platform's pipe buffer.
// Retain only a bounded prefix; continue draining so a regression cannot deadlock.
fn drain(mut r:impl Read)->Vec<u8>{let mut out=Vec::new();let mut buf=[0;4096];loop{let n=r.read(&mut buf).unwrap();if n==0{break}let keep=n.min(65537usize.saturating_sub(out.len()));out.extend_from_slice(&buf[..keep]);}out}
fn finish(mut child:Child,input:&str)->Output {
    let stdout=child.stdout.take().unwrap();let stderr=child.stderr.take().unwrap();
    let out=thread::spawn(move||drain(stdout));let err=thread::spawn(move||drain(stderr));
    // These fixtures are small enough to fit the input pipe. Close stdin after writing.
    assert!(input.len()<4096);
    child.stdin.take().unwrap().write_all(input.as_bytes()).unwrap();
    let end=Instant::now()+Duration::from_secs(10);
    let mut timed_out=false;
    let status=loop{if let Some(status)=child.try_wait().unwrap(){break status}if Instant::now()>=end{timed_out=true;child.kill().unwrap();break child.wait().unwrap()}thread::sleep(Duration::from_millis(10));};
    let stdout=out.join().unwrap();let stderr=err.join().unwrap();
    assert!(!timed_out,"bridge exceeded subprocess deadline");assert!(stdout.len()<=65536 && stderr.len()<=65536,"bridge output exceeded fixture bound");
    Output{status,stdout,stderr}
}
fn run(args:&[&str],input:&str)->Output {finish(spawn(args),input)}
fn lines(r:&Output)->Vec<serde_json::Value>{String::from_utf8(r.stdout.clone()).unwrap().lines().map(|s|serde_json::from_str(s).unwrap()).collect()}
#[test]fn real_stdio_lifecycle_has_no_notification_output(){let r=run(&["--status-only"],FLOW);assert!(r.status.success());let lines=lines(&r);assert_eq!(lines.len(),2);assert_eq!(lines[1]["result"]["tools"].as_array().unwrap().len(),1);assert_eq!(lines[1]["result"]["tools"][0]["name"],"connection_status");}
#[test]fn no_mode_is_refused_without_protocol_output(){let r=run(&[],"");assert!(!r.status.success());assert!(r.stdout.is_empty());}
#[test]fn real_stdio_truncated_frame_refused(){let r=run(&["--status-only"],"{}");assert!(!r.status.success());assert!(r.stdout.is_empty());}
#[cfg(windows)]mod windows {
    use super::*;
    use computer_link_local_transport::Server;
    const CALL:&str="{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"read_owner_snapshot\",\"arguments\":{}}}\n";
    enum Policy{Allow,Deny,Revoke,WrongOwner}
    fn fixture(policy:Policy,payload:Option<Vec<u8>>)->(Output,bool){
        let server=Server::new(Duration::from_secs(5)).unwrap();let (pipe,_)=server.pairing();
        let owner=if matches!(policy,Policy::WrongOwner){u32::MAX}else{std::process::id()};
        // Hold stdin until the synthetic owner knows the actual spawned bridge PID.
        let child=spawn(&["--owner-approved-snapshot",&pipe,&owner.to_string()]);let expected=child.id();
        let server_thread=thread::spawn(move||server.serve_paired(payload,move|peer,_,stop|{
            if peer.pid!=expected{return Ok(false)}
            match policy{Policy::Deny=>Ok(false),Policy::Revoke=>{stop.revoke()?;Ok(true)},_=>Ok(true)}
        }));
        let r=finish(child,&format!("{FLOW}{CALL}{CALL}"));
        let accepted=matches!(server_thread.join().unwrap(),Ok(false));
        assert!(r.status.success());assert!(r.stderr.is_empty());
        let records=lines(&r);assert_eq!(records.len(),4);assert_eq!(records[3]["result"]["isError"],true);
        (r,accepted)
    }
    #[test]fn actual_pipe_snapshot_is_bound_to_bridge_child_and_one_shot(){
        let payload="synthetic owner snapshot";let(r,accepted)=fixture(Policy::Allow,Some(payload.as_bytes().to_vec()));
        assert!(accepted);assert_eq!(lines(&r)[2]["result"]["content"][0]["text"],payload);
    }
    #[test]fn actual_pipe_maximum_escaped_snapshot_preserves_bytes(){
        let payload="\n".repeat(4096);let(r,accepted)=fixture(Policy::Allow,Some(payload.as_bytes().to_vec()));assert!(accepted);assert_eq!(lines(&r)[2]["result"]["content"][0]["text"],payload);
    }
    fn refused(policy:Policy,payload:Option<Vec<u8>>){let(r,accepted)=fixture(policy,payload);assert!(!accepted);assert_eq!(lines(&r)[2]["result"]["isError"],true);assert!(!String::from_utf8(r.stdout).unwrap().contains("PRIVATE-SYNTHETIC-BYTES"));}
    #[test]fn actual_owner_denial_never_exposes_snapshot(){refused(Policy::Deny,Some(b"PRIVATE-SYNTHETIC-BYTES".to_vec()));}
    #[test]fn actual_owner_revocation_before_grant_never_exposes_snapshot(){refused(Policy::Revoke,Some(b"PRIVATE-SYNTHETIC-BYTES".to_vec()));}
    #[test]fn actual_wrong_owner_pid_never_exposes_snapshot(){refused(Policy::WrongOwner,Some(b"PRIVATE-SYNTHETIC-BYTES".to_vec()));}
    #[test]fn actual_missing_snapshot_capability_is_refused(){refused(Policy::Allow,None);}
    #[test]fn local_probe_never_prints_snapshot(){
        for allow in [true,false]{
            let server=Server::new(Duration::from_secs(5)).unwrap();let(pipe,_)=server.pairing();
            let server_thread=thread::spawn(move||server.serve_paired(Some(b"PRIVATE-SYNTHETIC-BYTES".to_vec()),move|_,_,_|Ok(allow)));
            let r=run(&["--owner-local-probe",&pipe,&std::process::id().to_string()],"");
            assert_eq!(r.status.success(),allow);assert!(r.stdout.is_empty());
            assert!(!String::from_utf8_lossy(&r.stderr).contains("PRIVATE-SYNTHETIC-BYTES"));
            assert!(server_thread.join().is_ok());
        }
    }
}
