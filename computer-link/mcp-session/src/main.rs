//! Local stdio client adapter. No listener, credentials, registration or remote access.
use computer_link_mcp_session::{Session, Outcome};
use std::io::{self, BufRead, Write};
fn frame(r: &mut impl BufRead) -> io::Result<Option<Vec<u8>>> {
    let mut out = Vec::new();
    loop {
        let b = r.fill_buf()?;
        if b.is_empty() { return if out.is_empty() { Ok(None) } else { Err(io::Error::other("truncated frame")) }; }
        let n = b.iter().position(|&x| x == b'\n').map_or(b.len(), |p| p + 1);
        if out.len() + n > 8192 { return Err(io::Error::other("frame too large")); }
        out.extend_from_slice(&b[..n]); r.consume(n);
        if out.last() == Some(&b'\n') { return Ok(Some(out)); }
    }
}
fn main() -> io::Result<()> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    #[cfg(windows)]
    if args.len()==3 && args[0]=="--owner-local-probe" {
        let pid:u32=args[2].parse().map_err(|_|io::Error::other("invalid owner PID"))?;
        if pid==0{return Err(io::Error::other("invalid owner PID"))}
        let pipe=args[1].clone();
        return local_probe(Session::with_local_snapshot(move||computer_link_local_transport::paired_client(&pipe,pid,2)));
    }
    let mut session = if args == ["--status-only"] { Session::default() } else {
        #[cfg(windows)] {
            if args.len() != 3 || args[0] != "--owner-approved-snapshot" { return Err(io::Error::other("use --status-only or --owner-approved-snapshot PIPE OWNER_PID")); }
            let pid: u32 = args[2].parse().map_err(|_| io::Error::other("invalid owner PID"))?;
            if pid == 0 { return Err(io::Error::other("invalid owner PID")); }
            let pipe = args[1].clone();
            Session::with_local_snapshot(move || computer_link_local_transport::paired_client(&pipe, pid, 2))
        }
        #[cfg(not(windows))] { return Err(io::Error::other("only --status-only is available on this OS")); }
    };
    let mut input = io::stdin().lock(); let mut output = io::stdout().lock();
    while let Some(bytes) = frame(&mut input)? {
        match session.handle(&bytes) {
            Outcome::Reply(v) => { writeln!(output, "{v}")?; output.flush()?; }
            Outcome::Notification => (),
            Outcome::Rejected => break,
        }
    }
    session.revoke();
    Ok(())
}
#[cfg(test)] mod tests {
    use super::*;
    #[test] fn frame_boundaries() {
        assert_eq!(frame(&mut io::Cursor::new(b"{}\n")).unwrap(),Some(b"{}\n".to_vec()));
        assert!(frame(&mut io::Cursor::new(b"{}")).is_err());
        assert!(frame(&mut io::Cursor::new(vec![b'a';8193])).is_err());
        assert_eq!(frame(&mut io::Cursor::new(b"")).unwrap(),None);
    }
}

// Fixed protocol transcript, no stdin or stdout and no data sink. Probe reports
// success/failure only through exit status. Never use this as host forwarding.
#[cfg(any(windows,test))]
fn local_probe(mut session:Session)->io::Result<()> {
    let initialize=br#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"owner-local-probe","version":"1"}}}"#;
    let result=(||{
        if !matches!(session.handle(initialize),Outcome::Reply(_)){return Err(io::Error::other("probe initialize failed"))}
        if !matches!(session.handle(br#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#),Outcome::Notification){return Err(io::Error::other("probe initialization failed"))}
        let Outcome::Reply(reply)=session.handle(br#"{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"read_owner_snapshot","arguments":{}}}"#) else{return Err(io::Error::other("probe failed"))};
        let value=reply;
        if value["result"]["isError"]==false {Ok(())}else{Err(io::Error::other("probe refused"))}
    })();session.revoke();result
}
#[cfg(test)]mod probe_tests {
 use super::*;
 #[test]fn fixed_local_probe_requires_snapshot(){assert!(local_probe(Session::default()).is_err());}
 #[test]fn fixed_local_probe_reads_exactly_once(){let count=std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));let calls=count.clone();assert!(local_probe(Session::with_local_snapshot(move||{calls.fetch_add(1,std::sync::atomic::Ordering::SeqCst);Ok(b"synthetic".to_vec())})).is_ok());assert_eq!(count.load(std::sync::atomic::Ordering::SeqCst),1);}
}
