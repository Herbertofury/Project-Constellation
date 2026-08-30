# PC Buddy Portable

PC Buddy is the no-terminal front end for Project Constellation PCX-029.

## Goal

Unzip the portable package and double-click `PC Buddy.exe`. No Node.js install, npm, PowerShell setup, service install, or MCP command line is required for the primary experience.

## Primary mode: PC Buddy Direct

PC Buddy talks to the OpenAI Responses API directly and exposes its bounded local Windows tools as function tools. This avoids ChatGPT custom-app/developer-mode setup entirely.

Current default model: `gpt-5.6-sol`.

A one-time OpenAI API key is required unless `OPENAI_API_KEY` is already present in Windows. A key pasted into the UI is encrypted using Windows DPAPI and stored in the portable `data` directory; the plaintext key is never written to disk.

Direct API usage is billed through the OpenAI API separately from a ChatGPT subscription.

## Current local tools

- `pc_status` — host/app/policy summary.
- `pc_windows` — visible top-level app windows when enabled.
- `pc_processes` — bounded process summary when enabled.
- `fs_stat` — metadata for an allowed path.
- `fs_list` — bounded listing inside enabled roots.
- `fs_read_text` — bounded read-only text access inside enabled roots.
- `pc_run_allowed` — only fixed diagnostic IDs explicitly enabled in Access.

There is no arbitrary shell tool and no file-write tool in this release.

## Portable behavior

PC Buddy first tries to keep all state beside the executable under `data/`. If Windows blocks writes in the executable directory, it transparently falls back to `%LOCALAPPDATA%\PCBuddyPortable\data` and shows that state in the UI.

State includes settings, encrypted credentials, activity receipts, and the previous OpenAI response ID used to continue the conversation across restarts.

## Safety controls

- Emergency Lock immediately disables local tool execution and cancels the in-flight Buddy request.
- Allowed filesystem roots are explicit and read-only.
- Windows final-path resolution is used before filesystem access so junction/symlink escape does not bypass the enabled roots.
- Diagnostic commands have fixed executable names and fixed arguments.
- The API key is encrypted with the current Windows account through DPAPI.
- Activity is recorded locally as JSONL.

## Optional ChatGPT connection

The older PCX-029 MCP bridge remains in `pc-bridge/` for compatibility. If the user later wants the same tools inside ChatGPT, the app links to OpenAI's supported Secure MCP Tunnel / connector path. It is not required for PC Buddy Direct.

## Build

The `PC Buddy Portable` GitHub Actions workflow builds a self-contained .NET 10 Windows x64 single-file executable and packages:

- `PC Buddy.exe`
- `README.txt`
- `SHA256SUMS.txt`

into `PC-Buddy-Portable-win-x64.zip`.

No .NET runtime is required on the target PC because the executable is self-contained.
