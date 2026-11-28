//! Offline status-only MCP core. Not an HTTP server or authorization mechanism.
pub mod binding;
pub mod http_gate;
use serde_json::{json, Value};
mod strict_json;
pub const VERSION: &str = "2025-06-18";
const MAX_FRAME: usize = 8192;
const MAX_MESSAGES: usize = 128;
#[derive(Debug, PartialEq)]
enum Phase { New, AwaitingReady, Ready, Revoked }
#[derive(Debug, PartialEq)]
pub enum Outcome { Reply(Value), Notification, Rejected }
pub struct Session { phase: Phase, messages: usize, snapshot: Option<Box<dyn FnOnce() -> std::io::Result<Vec<u8>>>>, snapshot_enabled: bool }
impl Default for Session { fn default() -> Self { Self {phase:Phase::New,messages:0,snapshot:None,snapshot_enabled:false} } }
fn error(id: Value, code: i64, message: &str) -> Outcome { Outcome::Reply(json!({"jsonrpc":"2.0","id":id,"error":{"code":code,"message":message}})) }
fn empty_params(p: &Value) -> bool { p.as_object().is_some_and(|o| o.iter().all(|(k,v)| k == "_meta" && v.is_object())) }
fn result(id: Value, value: Value) -> Outcome { Outcome::Reply(json!({"jsonrpc":"2.0","id":id,"result":value})) }
impl Session {
    /// Local-process adapter only. The callback must obtain explicit owner consent;
    /// never attach this to an HTTP gate or remote client without separate authorization.
    pub fn with_local_snapshot(read: impl FnOnce() -> std::io::Result<Vec<u8>> + 'static) -> Self {
        Self { snapshot:Some(Box::new(read)),snapshot_enabled:true,..Self::default() }
    }
    /// Called by the future owner/transport on Disconnect. Irreversible for this session.
    pub fn revoke(&mut self) { self.phase = Phase::Revoked; self.snapshot = None; }
    pub fn handle(&mut self, bytes: &[u8]) -> Outcome {
        if self.phase == Phase::Revoked { return Outcome::Rejected; }
        self.messages += 1;
        if self.messages > MAX_MESSAGES || bytes.len() > MAX_FRAME { self.revoke(); return Outcome::Rejected; }
        let v = match strict_json::parse(bytes) { Ok(v) => v, Err(_) => return error(Value::Null,-32700,"Invalid JSON") };
        let Some(object) = v.as_object() else { return error(Value::Null,-32600,"Invalid request"); };
        let id = object.get("id");
        if id.is_some_and(|id| !(id.is_string() || id.as_i64().is_some() || id.as_u64().is_some())) { return error(Value::Null,-32600,"Invalid request id"); }
        if v.get("jsonrpc") != Some(&json!("2.0")) || !v.get("method").is_some_and(Value::is_string)
            || object.contains_key("result") || object.contains_key("error") {
            return error(Value::Null,-32600,"Invalid request");
        }
        let method=v["method"].as_str().unwrap();
        let params=v.get("params");
        // Notifications never generate JSON-RPC responses and cannot call tools.
        if id.is_none() {
            if method == "notifications/initialized" && self.phase == Phase::AwaitingReady && params.is_none_or(empty_params) { self.phase=Phase::Ready; }
            return Outcome::Notification;
        }
        let id=id.unwrap().clone();
        if params.is_some_and(|p| !p.is_object()) { return error(id,-32602,"Invalid params"); }
        if method == "ping" { return result(id,json!({})); }
        if method == "initialize" {
            if self.phase != Phase::New { return error(id,-32600,"Already initialized"); }
            let valid=params.is_some_and(|p| p.get("protocolVersion").is_some_and(Value::is_string)
                && p.get("capabilities").is_some_and(Value::is_object)
                && p.pointer("/clientInfo/name").is_some_and(Value::is_string)
                && p.pointer("/clientInfo/version").is_some_and(Value::is_string));
            if !valid { return error(id,-32602,"Invalid initialization"); }
            self.phase=Phase::AwaitingReady;
            return result(id,json!({"protocolVersion":VERSION,"capabilities":{"tools":{}},"serverInfo":{"name":"Computer-Link local session","version":"0.1.0"}}));
        }
        if self.phase != Phase::Ready { return error(id,-32002,"Session not initialized"); }
        match method {
            "tools/list" if params.is_none_or(empty_params) => { let mut tools = vec![json!({"name":"connection_status","description":"Reports protocol readiness and configured local capability; does not assert an owner connection.","inputSchema":{"type":"object","properties":{},"additionalProperties":false},"annotations":{"readOnlyHint":true,"destructiveHint":false,"openWorldHint":false}})];
                if self.snapshot_enabled { tools.push(json!({"name":"read_owner_snapshot","description":"One attempt to read the owner-selected immutable UTF-8 snapshot through the local Windows owner approval dialog. No path arguments; not general file access.","inputSchema":{"type":"object","properties":{},"additionalProperties":false},"annotations":{"readOnlyHint":true,"destructiveHint":false,"openWorldHint":false}})); }
                result(id,json!({"tools":tools}))
            },
            "tools/call" => {
                if self.snapshot_enabled && params.is_some_and(|p| p.get("name")==Some(&json!("read_owner_snapshot")) && p.get("arguments").is_none_or(|a| a==&json!({})) && p.as_object().unwrap().iter().all(|(k,v)| matches!(k.as_str(),"name"|"arguments") || (k=="_meta" && v.is_object()))) {
                    let text = self.snapshot.take().and_then(|read| read().ok()).filter(|b| b.len() <= 4096).and_then(|b| String::from_utf8(b).ok());
                    return match text {
                        Some(text) => result(id,json!({"content":[{"type":"text","text":text}],"isError":false})),
                        None => result(id,json!({"content":[{"type":"text","text":"Snapshot unavailable, refused, or one-shot attempt already consumed. Request fresh owner selection and approval; no automatic retry."}],"isError":true})),
                    };
                }
                if !params.is_some_and(|p| p.get("name")==Some(&json!("connection_status")) && p.get("arguments").is_none_or(|a|a==&json!({})) && p.as_object().unwrap().iter().all(|(k,v)|matches!(k.as_str(),"name"|"arguments") || (k=="_meta" && v.is_object()))) { return error(id,-32602,"Unsupported tool or arguments"); }
                let status = if self.snapshot_enabled {
                    "Protocol initialized. Dot integration: NOT CONNECTED. One owner-approved local snapshot attempt is configured, not proof of connection. No general file, browser, desktop or command access. No remote endpoint or credentials."
                } else {
                    "Protocol initialized. Dot integration: NOT CONNECTED. No file, browser, desktop or command access. No endpoint or credentials."
                };
                result(id,json!({"content":[{"type":"text","text":status}],"isError":false}))
            },
            "tools/list" => error(id,-32602,"Unsupported list parameters"),
            _ => error(id,-32601,"Method not found")
        }
    }
}
#[cfg(test)] mod tests {
use super::*;
fn call(s:&mut Session,v:Value)->Outcome{s.handle(&serde_json::to_vec(&v).unwrap())}
fn init(s:&mut Session)->Outcome{call(s,json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"future-version","capabilities":{},"clientInfo":{"name":"fixture","version":"1"}}}))}
fn ready(s:&mut Session){init(s);call(s,json!({"jsonrpc":"2.0","method":"notifications/initialized"}));}
fn list(s:&mut Session)->Outcome{call(s,json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}))}
#[test]fn metadata_params(){let mut s=Session::default();init(&mut s);call(&mut s,json!({"jsonrpc":"2.0","method":"notifications/initialized","params":{"_meta":{"fixture":true}}}));assert_eq!(s.phase,Phase::Ready);let r=call(&mut s,json!({"jsonrpc":"2.0","id":2,"method":"tools/list","params":{"_meta":{}}}));assert!(format!("{r:?}").contains("connection_status"));assert!(!empty_params(&json!({"_meta":"invalid"})));}
#[test]fn lifecycle(){let mut s=Session::default();assert!(format!("{:?}",list(&mut s)).contains("not initialized"));assert!(format!("{:?}",init(&mut s)).contains(VERSION));assert!(format!("{:?}",list(&mut s)).contains("not initialized"));call(&mut s,json!({"jsonrpc":"2.0","method":"notifications/initialized"}));assert!(format!("{:?}",list(&mut s)).contains("connection_status"));assert!(format!("{:?}",init(&mut s)).contains("Already initialized"));}
#[test]fn early_ready_and_bad_init_do_not_unlock(){let mut s=Session::default();call(&mut s,json!({"jsonrpc":"2.0","method":"notifications/initialized"}));call(&mut s,json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}));assert_eq!(s.phase,Phase::New);}
#[test]fn notifications_do_not_execute_or_respond(){let mut s=Session::default();ready(&mut s);assert_eq!(call(&mut s,json!({"jsonrpc":"2.0","method":"tools/call","params":{"name":"run"}})),Outcome::Notification);}
#[test]fn only_status_and_no_parameters(){let mut s=Session::default();ready(&mut s);let r=call(&mut s,json!({"jsonrpc":"2.0","id":"a","method":"tools/call","params":{"name":"connection_status"}}));assert!(format!("{r:?}").contains("NOT CONNECTED"));for params in [json!({"name":"run"}),json!({"name":"connection_status","arguments":{"path":"secret"}})]{assert!(format!("{:?}",call(&mut s,json!({"jsonrpc":"2.0","id":2,"method":"tools/call","params":params}))).contains("Unsupported"));}}
#[test]fn revocation_and_limit(){let mut s=Session::default();ready(&mut s);s.revoke();assert_eq!(list(&mut s),Outcome::Rejected);assert_eq!(init(&mut s),Outcome::Rejected);let mut s=Session::default();for _ in 0..128 {s.handle(b"{}");}assert_eq!(s.handle(b"{}"),Outcome::Rejected);}
#[test]fn malformed_and_oversized(){for b in [b"[]".as_slice(),b"{\"jsonrpc\":\"2.0\",\"id\":1,\"id\":2,\"method\":\"initialize\"}",b"{\"jsonrpc\":\"2.0\",\"id\":null,\"method\":\"ping\"}"]{let mut s=Session::default();assert!(matches!(s.handle(b),Outcome::Reply(_)));assert_eq!(s.phase,Phase::New);}let mut s=Session::default();assert_eq!(s.handle(&vec![b' ';8193]),Outcome::Rejected);}
}
#[cfg(test)] mod local_bridge_tests {
    use super::*;
    use std::{rc::Rc, cell::Cell};
    fn request(s:&mut Session,method:&str,params:Value)->Outcome { s.handle(&serde_json::to_vec(&json!({"jsonrpc":"2.0","id":1,"method":method,"params":params})).unwrap()) }
    fn ready(s:&mut Session) { request(s,"initialize",json!({"protocolVersion":VERSION,"capabilities":{},"clientInfo":{"name":"fixture","version":"1"}}));s.handle(br#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#); }
    fn read(s:&mut Session)->Outcome {request(s,"tools/call",json!({"name":"read_owner_snapshot","arguments":{}}))}
    #[test] fn callback_requires_ready_exact_tool_and_consumes_once() {
        let count=Rc::new(Cell::new(0));let c=count.clone();let mut s=Session::with_local_snapshot(move||{c.set(c.get()+1);Ok(b"selected snapshot".to_vec())});
        read(&mut s);assert_eq!(count.get(),0);ready(&mut s);
        request(&mut s,"tools/call",json!({"name":"read_owner_snapshot","arguments":{"path":"not allowed"}}));assert_eq!(count.get(),0);
        s.handle(br#"{"jsonrpc":"2.0","method":"tools/call","params":{"name":"read_owner_snapshot"}}"#);assert_eq!(count.get(),0);
        assert!(format!("{:?}",read(&mut s)).contains("selected snapshot"));assert_eq!(count.get(),1);
        assert!(format!("{:?}",read(&mut s)).contains("already consumed"));assert_eq!(count.get(),1);
    }
    #[test] fn revoke_prevents_callback() {let mut s=Session::with_local_snapshot(||panic!("revoked callback"));ready(&mut s);s.revoke();assert_eq!(read(&mut s),Outcome::Rejected);}
    #[test] fn default_never_offers_snapshot() {let mut s=Session::default();ready(&mut s);assert!(!format!("{:?}",request(&mut s,"tools/list",json!({}))).contains("read_owner_snapshot"));assert!(format!("{:?}",read(&mut s)).contains("Unsupported"));}
    #[test] fn failure_size_and_utf8_are_consumed_without_details() { for bytes in [None,Some(vec![0;4097]),Some(vec![255])] {
        let mut s=Session::with_local_snapshot(move||bytes.ok_or_else(||std::io::Error::other("PRIVATE PATH MUST NOT LEAK")));ready(&mut s);
        let r=format!("{:?}",read(&mut s));assert!(r.contains("isError"));assert!(!r.contains("PRIVATE PATH"));assert!(r.contains("unavailable"));assert!(format!("{:?}",read(&mut s)).contains("already consumed"));
    }}
}
