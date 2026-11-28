//! Fixed local status client. No caller-supplied methods, arguments or destination.
//! Blocking I/O belongs on a worker, never the window thread.
use std::io::{self, BufRead, Read, Write};
use serde_json::{json, Value};
pub struct StatusClient<R, W> { reader: R, writer: W, next_id: u64 }
impl<R: BufRead, W: Write> StatusClient<R, W> {
    pub fn initialize(reader: R, writer: W) -> io::Result<Self> {
        let mut client = Self { reader, writer, next_id: 1 };
        let reply = client.request("initialize", json!({"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"Computer-Link local owner","version":"0.1.0"}}))?;
        if reply["protocolVersion"] != "2025-06-18" || reply["serverInfo"]["name"] != "Computer-Link local session" {
            return Err(io::Error::other("unexpected local protocol"));
        }
        client.send(json!({"jsonrpc":"2.0","method":"notifications/initialized"}))?;
        let list = client.request("tools/list", json!({}))?;
        let tools = list["tools"].as_array().ok_or_else(||io::Error::other("missing tools"))?;
        if tools.len() != 1 || tools[0]["name"] != "connection_status" {
            return Err(io::Error::other("status-only capability required"));
        }
        Ok(client)
    }
    pub fn check(&mut self) -> io::Result<()> {
        // Bound total exchanges below the sibling's 128-frame lifetime.
        if self.next_id > 100 { return Err(io::Error::other("local session request limit reached")); }
        let reply = self.request("tools/call", json!({"name":"connection_status","arguments":{}}))?;
        let expected = "Protocol initialized. Dot integration: NOT CONNECTED. No file, browser, desktop or command access. No endpoint or credentials.";
        if reply["isError"] != false || reply["content"] != json!([{"type":"text","text":expected}]) {
            return Err(io::Error::other("unexpected status-only response"));
        }
        Ok(())
    }
    fn send(&mut self, value: Value) -> io::Result<()> {
        serde_json::to_writer(&mut self.writer, &value)?;
        self.writer.write_all(b"\n")?;
        self.writer.flush()
    }
    fn request(&mut self, method: &str, params: Value) -> io::Result<Value> {
        let id = self.next_id; self.next_id += 1;
        self.send(json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}))?;
        let mut bytes = Vec::new();
        self.reader.by_ref().take(8193).read_until(b'\n', &mut bytes)?;
        if bytes.len() > 8192 || !bytes.ends_with(b"\n") { return Err(io::Error::other("bounded complete response required")); }
        let value: Value = serde_json::from_slice(&bytes)?;
        if value["jsonrpc"] != "2.0" || value["id"] != id || value.get("error").is_some() {
            return Err(io::Error::other("mismatched or failed response"));
        }
        value.get("result").cloned().ok_or_else(||io::Error::other("missing result"))
    }
}
