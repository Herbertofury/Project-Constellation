# Project Constellation Portable

Project Constellation is the portable Windows command center for your ChatGPT sessions, project continuity, and guarded local-computer access.

## Goal

Unzip the portable package and double-click `Project Constellation.exe`. No Node.js install, npm, PowerShell setup, service install, MCP command line, OpenAI API key, or separately billed API credits are required for the primary experience.

## ChatGPT Session mode

Project Constellation hosts the real `chatgpt.com` experience inside a persistent WebView2 profile and uses the user's normal ChatGPT account/session. It does **not** call the OpenAI Responses API and does **not** use separately billed API credits.

On first launch, ChatGPT may ask the user to sign in inside Project Constellation once. That browser profile is then retained under Project Constellation's data directory. ChatGPT itself continues to own the account, model picker, subscription limits, browsing features, chat history, and normal web UI.

Project Constellation injects a narrow local-tool bridge into the ChatGPT page. When ChatGPT needs approved local evidence, it can emit a nonce-bound local companion request. The desktop host validates the session nonce, enforces the Access policy and Emergency Lock, performs the local operation, and returns the observed result into the conversation. Internal bridge messages are hidden from the visible chat UI.

The `PC_BUDDY_*` marker names remain internal wire-protocol identifiers for backward compatibility. They are not the product name.

## Current local tools

- `pc_status` — Project Constellation host/app/policy summary.
- `pc_windows` — visible top-level app windows when enabled.
- `pc_processes` — bounded process summary when enabled.
- `fs_stat` — metadata for an allowed path.
- `fs_list` — bounded listing inside enabled roots.
- `fs_read_text` — bounded read-only text access inside enabled roots.
- `pc_run_allowed` — only fixed diagnostic IDs explicitly enabled in Access.

There is no arbitrary shell tool and no file-write tool in this release.

## Portable behavior

Project Constellation first tries to keep state beside the executable under `data/`. If Windows blocks writes in the executable directory, it transparently falls back to `%LOCALAPPDATA%\ProjectConstellation\data` and shows the active path in the UI.

State includes settings, activity receipts, and the persistent ChatGPT WebView2 profile under `data/chatgpt-session/`.

## Safety controls

- Emergency Lock disables local tool execution immediately.
- Allowed filesystem roots are explicit and read-only.
- Windows final-path resolution is used before filesystem access so junction/symlink escape does not bypass enabled roots.
- Diagnostic commands have fixed executable names and fixed arguments.
- ChatGPT local-tool requests are accepted only when they carry the current per-conversation random nonce.
- The nonce rotates when the embedded ChatGPT conversation changes.
- Duplicate tool-call IDs are ignored.
- Activity is recorded locally as JSONL.
- No OpenAI API key or API token is stored or read by the primary session mode.

## Project Constellation ecosystem

The desktop app, Project Constellation browser extension, project/checkpoint management, Google Drive/GitHub lineage, and ChatGPT companion skill are one product. The local companion implementation currently remains under the repository's `pc-buddy/` source directory to preserve development history; that folder name is not user-facing branding.

The older PCX-029 MCP bridge remains in `pc-bridge/` for supported MCP deployments. It is optional and is not required for normal Project Constellation ChatGPT-session use.

## Build and verification

The `Project Constellation Portable` GitHub Actions workflow builds a self-contained .NET 10 Windows x64 executable and runs:

1. a source gate that rejects the previous billable API transport and API-key store
2. compile and self-contained publish
3. packaged executable local-tool/protocol self-test
4. a real WebView2 DOM bridge smoke using a local ChatGPT-shaped fixture
5. packaged WPF UI launch smoke, including the `Project Constellation` window title
6. portable artifact assembly with SHA-256 receipts

The portable package contains:

- `Project Constellation.exe`
- `README.txt`
- `SELF-TEST-RECEIPT.json`
- `BRIDGE-DOM-SMOKE-RECEIPT.json`
- `UI-SMOKE-RECEIPT.json`
- `SHA256SUMS.txt`

No separate .NET runtime is required on the target PC. Web rendering uses Microsoft's WebView2 runtime, which is part of current Windows 11 / Microsoft Edge installations.
