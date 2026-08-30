# PCX-029 PC Bridge / MCP Bridge

A secure local-PC bridge for Project Constellation. It exposes a deliberately small set of truthful MCP tools instead of handing an AI an unrestricted shell.

## What works

- MCP `2026-07-28` discovery through `server/discover`.
- Legacy `2025-11-25` initialization for stdio clients.
- Stable tool IDs: `pc.status`, `fs.stat`, `fs.list`, `fs.read_text`, `pc.run_allowed`.
- Filesystem confinement to configured roots using resolved real paths, including symlink-escape protection.
- Bounded directory listings and file reads.
- Command execution only through administrator/user-defined command IDs; arbitrary command strings are rejected.
- HTTP mode binds to `127.0.0.1` by default and requires a >=32-character bearer token.
- Structured stderr audit events; stdout remains protocol-only in stdio mode.
- Windows installer can register persistent HTTP mode as a per-user logon Scheduled Task.

## Requirements

- Windows 11 (primary target; stdio tests are cross-platform)
- Node.js 22+

## Quick local stdio install

From PowerShell in this `pc-bridge` directory:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\windows\install-pc-bridge.ps1 -Mode stdio
```

The script installs to `%LOCALAPPDATA%\PCX-029-PC-Bridge` and prints the exact command an MCP host should launch.

## Persistent local HTTP mode

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\windows\install-pc-bridge.ps1 -Mode http -Port 8765
```

This creates the per-user Scheduled Task `PCX-029 PC Bridge`, listens on `http://127.0.0.1:8765/mcp`, and stores a cryptographically random bearer token in the current user's `PCX_BRIDGE_TOKEN` environment variable.

Retrieve it with:

```powershell
[Environment]::GetEnvironmentVariable('PCX_BRIDGE_TOKEN','User')
```

Do **not** port-forward 8765 directly to the public internet. If a remote MCP client must reach the bridge, put an authenticated TLS tunnel/reverse proxy in front of it and keep the bridge itself loopback-bound.

## Configure what the AI can see/do

Edit:

```text
%LOCALAPPDATA%\PCX-029-PC-Bridge\config.json
```

`roots` controls visible filesystem locations. `commands` maps stable IDs to exact executables and fixed arguments. Example:

```json
{
  "roots": ["%USERPROFILE%\\Desktop", "%USERPROFILE%\\Documents"],
  "commands": {
    "hostname": { "file": "hostname.exe", "args": [] },
    "systeminfo": { "file": "systeminfo.exe", "args": [], "timeoutMs": 30000 }
  }
}
```

There is intentionally no `shell` field and no user-supplied command line in `pc.run_allowed`.

## Protocol examples

Modern discovery:

```json
{"jsonrpc":"2.0","id":1,"method":"server/discover","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28"}}}
```

List tools:

```json
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
```

Read bridge status:

```json
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"pc.status","arguments":{}}}
```

## Verification

```powershell
npm test
```

The test suite spawns the real stdio server and verifies modern discovery, legacy initialization, stable tools, allowed file reads, outside-root denial, allowed command execution, and arbitrary-command denial.

## Trust model

The bridge assumes the operating-system account is trusted. MCP transport authorization is an additional boundary, not a replacement for Windows account security. Keep roots narrow. Keep command IDs minimal. Never place secrets in config files or commit bearer tokens. Server identity metadata is diagnostic only and must never be treated as an authorization signal.

## Roadmap after the core bridge is proven on the user's PC

1. Add an authenticated remote connector/tunnel profile selected for the actual ChatGPT client surface in use.
2. Add optional screen-capture and app/window inspection as explicit opt-in capability modules, disabled by default.
3. Add opt-in write/mutation tools with per-capability policy and audit receipts instead of a blanket shell.
4. Add Windows named-pipe/service transport if it improves the chosen client integration.
5. Run official MCP conformance alongside project-owned end-to-end capability fixtures.

The acceptance rule is strict: discovery or a transport handshake never counts as proof that a PC capability works. A capability is green only after the real local operation executes and its result is observed through MCP.
