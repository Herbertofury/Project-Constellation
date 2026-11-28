# Experimental local MCP stdio bridge

This standalone crate implements a bounded newline stdio MCP subset pinned to protocol 2025-06-18. It is not a production remote desktop tool, an HTTP server, an OAuth implementation, or a verified ChatGPT/dot integration.

`--status-only` exposes only connection status. On Windows, `--owner-approved-snapshot PIPE OWNER_PID` additionally permits ONE attempt to read an owner-approved snapshot through the existing local named pipe. Initialization and readiness are mandatory; no path or command arguments are accepted. Owner PID is pinned; the owner independently approves the connecting process. UTF-8 output is bounded to 4096 bytes. Failure consumes the attempt. Input frames are limited to 8192 bytes and sessions to 128 messages.

Only use with an explicitly trusted LOCAL host. The owner approval identifies the immediate executable, not a downstream host/provider. It does not authorize forwarding stdout to an external provider. Destination-aware explicit consent and a supported host integration remain release gates. Snapshot content is untrusted data, never execution instructions.

The executable is owned by its launching host, NOT the tray Job Object. Disconnect cancels owner pipe I/O but cannot recall returned bytes or terminate a process blocked on stdin/stdout. Tray Exit completeness, actual owner dialog through MCP, visual review, broad client compatibility and real dot admission remain unverified.

`http_gate` and `binding` are offline status-only prerequisites: no listener, token verification or credentials. Trusted middleware must perform authentication; constructing claims is not proof of authorization. Do not expose these modules as a server.

Run `cargo test --locked --manifest-path mcp-session/Cargo.toml`. Windows tests use only synthetic fixture bytes, local pipes and actual child processes. CI has read-only repository permission and produces no published artifacts. A passing synthetic test is not evidence of owner-PC installation or remote access. No performance improvement is claimed; runtime performance comparison remains unmeasured.

Protocol sources: [lifecycle](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle), [transports](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports), [authorization](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization).
