//! Offline HTTP envelope admission, not an HTTP parser, listener or authenticator.
//! A future audited server must bound raw headers/body while reading, authenticate
//! every request, and select the correct per-owner Session before calling this gate.
use crate::{Outcome, Session, VERSION};

pub struct Gate<'a> { pub authority: &'a str, pub allowed_origins: &'a [&'a str] }
pub struct Request<'a> {
    pub method: &'a str,
    pub path: &'a str,
    /// Raw duplicate-preserving headers from the HTTP library, never a flattened map.
    pub headers: &'a [(&'a str, &'a str)],
    pub body: &'a [u8],
}
#[derive(Debug, PartialEq)]
pub enum Response { Json(serde_json::Value), Accepted, Refused(u16) }
impl Gate<'_> {
    /// `authorized` is trusted middleware evidence, NEVER a client field/header.
    /// This does not verify a bearer token, bind sessions, or mint a grant.
    pub fn handle(&self, session: &mut Session, authorized: bool, r: Request<'_>) -> Response {
        if !authorized { return Response::Refused(401); }
        if r.headers.len()>32 || r.headers.iter().map(|(k,v)| k.len().saturating_add(v.len())).sum::<usize>()>8192 { return Response::Refused(431); }
        for (i,(name,value)) in r.headers.iter().enumerate() {
            if name.is_empty() || !name.bytes().all(|b| b.is_ascii_alphanumeric() || b==b'-') || value.bytes().any(|b| b<32 || b==127) {
                return Response::Refused(400);
            }
            if r.headers[..i].iter().any(|(n,_)|n.eq_ignore_ascii_case(name)) { return Response::Refused(400); }
        }
        let get=|name:&str|r.headers.iter().find(|(k,_)|k.eq_ignore_ascii_case(name)).map(|(_,v)|*v);
        if get("host")!=Some(self.authority) { return Response::Refused(403); }
        if get("origin").is_some_and(|o|!self.allowed_origins.contains(&o)) { return Response::Refused(403); }
        // No proxy-header trust or URL normalization. Only the configured endpoint.
        if r.path!="/mcp" { return Response::Refused(404); }
        if r.method!="POST" { return Response::Refused(405); }
        if get("transfer-encoding").is_some() || get("content-encoding").is_some() { return Response::Refused(400); }
        if get("content-type")!=Some("application/json") { return Response::Refused(415); }
        if match get("mcp-protocol-version") { Some(v) => v != VERSION, None => session.phase != crate::Phase::New } { return Response::Refused(400); }
        let Some(accept)=get("accept") else { return Response::Refused(406); };
        let accepted:Vec<_>=accept.split(',').map(str::trim).collect();
        if !accepted.contains(&"application/json") || !accepted.contains(&"text/event-stream") { return Response::Refused(406); }
        if r.body.len()>8192 { return Response::Refused(413); }
        let Some(length)=get("content-length") else { return Response::Refused(411); };
        if length.is_empty() || !length.bytes().all(|b|b.is_ascii_digit()) || length.parse::<usize>().ok()!=Some(r.body.len()) { return Response::Refused(400); }
        match session.handle(r.body) {
            Outcome::Reply(v)=>Response::Json(v), Outcome::Notification=>Response::Accepted,
            Outcome::Rejected=>Response::Refused(404),
        }
    }
}
#[cfg(test)] mod tests {
use super::*;
fn headers(body:&[u8])->Vec<(String,String)>{[("Host","link.example"),("Content-Type","application/json"),("Accept","application/json, text/event-stream"),("MCP-Protocol-Version",VERSION),("Origin","https://ui.example")].into_iter().map(|(k,v)|(k.into(),v.into())).chain([("Content-Length".into(),body.len().to_string())]).collect()}
fn run(s:&mut Session,auth:bool,b:&[u8],h:&[(String,String)])->Response{let hs:Vec<_>=h.iter().map(|(k,v)|(k.as_str(),v.as_str())).collect();Gate{authority:"link.example",allowed_origins:&["https://ui.example"]}.handle(s,auth,Request{method:"POST",path:"/mcp",headers:&hs,body:b})}
const INIT:&[u8]=br#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"fixture","version":"1"}}}"#;
#[test]fn actual_session_roundtrip_and_revoke(){let mut s=Session::default();assert!(matches!(run(&mut s,true,INIT,&headers(INIT)),Response::Json(_)));let b=br#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#;assert_eq!(run(&mut s,true,b,&headers(b)),Response::Accepted);let b=br#"{"jsonrpc":"2.0","id":2,"method":"tools/list"}"#;assert!(format!("{:?}",run(&mut s,true,b,&headers(b))).contains("connection_status"));s.revoke();assert_eq!(run(&mut s,true,b,&headers(b)),Response::Refused(404));}
#[test]fn denied_envelopes_never_initialize(){for (key,value,code) in [("Host","evil.example",403),("Origin","null",403),("Content-Type","text/plain",415),("MCP-Protocol-Version","unknown",400),("Content-Length","1",400),("Accept","application/json",406)]{let mut s=Session::default();let mut h=headers(INIT);h.iter_mut().find(|(k,_)|k==key).unwrap().1=value.into();assert_eq!(run(&mut s,true,INIT,&h),Response::Refused(code));assert_eq!(s.phase,crate::Phase::New);}}
#[test]fn auth_required_every_request(){let mut s=Session::default();assert_eq!(run(&mut s,false,INIT,&headers(INIT)),Response::Refused(401));assert_eq!(s.phase,crate::Phase::New);run(&mut s,true,INIT,&headers(INIT));assert_eq!(run(&mut s,false,INIT,&headers(INIT)),Response::Refused(401));}
#[test]fn ambiguous_and_injected_headers_rejected(){for pair in [("hOsT","link.example"),("Origin","https://ui.example"),("Transfer-Encoding","chunked"),("X-Test","abc\r\nHost: evil")]{let mut s=Session::default();let mut h=headers(INIT);h.push((pair.0.into(),pair.1.into()));assert_eq!(run(&mut s,true,INIT,&h),Response::Refused(400));assert_eq!(s.phase,crate::Phase::New);}}
#[test]fn nonbrowser_without_origin_allowed_but_auth_still_required(){let mut s=Session::default();let mut h=headers(INIT);h.retain(|(k,_)|k!="Origin");assert!(matches!(run(&mut s,true,INIT,&h),Response::Json(_)));}
#[test]fn size_and_method_limits(){let mut s=Session::default();let b=vec![b' ';8193];assert_eq!(run(&mut s,true,&b,&headers(&b)),Response::Refused(413));let h=vec![("X".into(),"a".repeat(8193))];assert_eq!(run(&mut s,true,INIT,&h),Response::Refused(431));assert_eq!(s.phase,crate::Phase::New);let h=headers(INIT);let hs:Vec<_>=h.iter().map(|(k,v)|(k.as_str(),v.as_str())).collect();assert_eq!(Gate{authority:"link.example",allowed_origins:&[]}.handle(&mut s,true,Request{method:"GET",path:"/mcp",headers:&hs.iter().copied().filter(|(k,_)|*k!="Origin").collect::<Vec<_>>(),body:INIT}),Response::Refused(405));}
}

#[cfg(test)] mod negotiation_tests {
    use super::*;
    #[test] fn protocol_header_optional_only_before_negotiation() {
        let mut session = Session::default();
        let body = br#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}"#;
        let length = body.len().to_string();
        let headers = [("Host", "link.example"), ("Content-Type", "application/json"), ("Accept", "application/json, text/event-stream"), ("Content-Length", length.as_str())];
        let gate = Gate { authority: "link.example", allowed_origins: &[] };
        assert!(matches!(gate.handle(&mut session, true, Request { method:"POST", path:"/mcp", headers:&headers, body }), Response::Json(_)));
        assert_eq!(gate.handle(&mut session, true, Request { method:"POST", path:"/mcp", headers:&headers, body }), Response::Refused(400));
        assert_eq!(session.phase, crate::Phase::AwaitingReady);
    }
}
