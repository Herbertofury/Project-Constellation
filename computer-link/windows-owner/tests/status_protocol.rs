#[path="../src/status_protocol.rs"] mod status_protocol;
use std::io::Cursor;
use serde_json::json;
fn responses(tail:serde_json::Value)->Vec<u8>{
 let init=json!({"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","serverInfo":{"name":"Computer-Link local session"}}});
 let tools=json!({"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"connection_status"}]}});
 format!("{init}\n{tools}\n{tail}\n").into_bytes()
}
fn status()->serde_json::Value{json!({"jsonrpc":"2.0","id":3,"result":{"isError":false,"content":[{"type":"text","text":"Protocol initialized. Dot integration: NOT CONNECTED. No file, browser, desktop or command access. No endpoint or credentials."}]}})}
#[test]fn fixed_commands_exact_status(){let mut output=vec![];let mut c=status_protocol::StatusClient::initialize(Cursor::new(responses(status())),&mut output).unwrap();c.check().unwrap();drop(c);let sent=String::from_utf8(output).unwrap();assert_eq!(sent.lines().count(),4);assert!(!sent.contains("read_owner_snapshot"));assert!(sent.contains("connection_status"));}
#[test]fn reject_wrong_id_errors_and_invented_connection(){for reply in [json!({"jsonrpc":"2.0","id":99,"result":{}}),json!({"jsonrpc":"2.0","id":3,"error":{}}),json!({"jsonrpc":"2.0","id":3,"result":{"isError":false,"content":[{"type":"text","text":"Connected to ChatGPT"}]}})]{let mut c=status_protocol::StatusClient::initialize(Cursor::new(responses(reply)),vec![]).unwrap();assert!(c.check().is_err());}}
#[test]fn reject_bad_handshake_and_frame_bound(){for frame in [vec![],vec![b'x';8193],b"{}".to_vec(),b"{bad}\n".to_vec(),b"{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}\n".to_vec()]{assert!(status_protocol::StatusClient::initialize(Cursor::new(frame),vec![]).is_err());}}
#[test]fn reject_extra_snapshot_capability(){let data=String::from_utf8(responses(status())).unwrap().replace("[{\"name\":\"connection_status\"}]","[{\"name\":\"connection_status\"},{\"name\":\"read_owner_snapshot\"}]");assert!(status_protocol::StatusClient::initialize(Cursor::new(data.into_bytes()),vec![]).is_err());}
