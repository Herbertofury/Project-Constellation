# PC Buddy Portable

PC Buddy is the no-terminal front end for Project Constellation PCX-029.

## Goal

Unzip the portable package and double-click `PC Buddy.exe`. No Node.js install, npm, PowerShell setup, service install, MCP command line, OpenAI API key, or API credits are required for the primary experience.

## Primary mode: ChatGPT Session

PC Buddy hosts the real `chatgpt.com` experience inside a persistent WebView2 profile and uses the user's normal ChatGPT account/session. It does **not** call the OpenAI Responses API and does **not** use separately billed API credits.

On first launch, ChatGPT may ask the user to sign in inside the Buddy window once. That browser profile is then retained under PC Buddy's data directory. ChatGPT itself continues to own the account, model picker, subscription limits, browsing features, chat history, and normal web UI.

PC Buddy injects a narrow local-tool bridge into the ChatGPT page. When ChatGPT needs approved local evidence, it can emit a nonce-bound PC Buddy tool request. The desktop host validates the session nonce, enforces the Access policy and Emergency Lock, performs the local operation, and returns the observed result into the conversation. Internal bridge messages are hidden from the visible chat UI.

This session bridge deliberately avoids unsupported private ChatGPT backend/API endpoints. It operates through the normal ChatGPT web UI, which means a future ChatGPT DOM change can require selector maintenance; PC Buddy surfaces a truthful bridge status instead of pretending a failed injection worked.

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

PC Buddy first tries to keep state beside the executable under `data/`. If Windows blocks writes in the executable directory, it transparently falls back to `%LOCALAPPDATA%\PCBuddyPortable\data` and shows the active path in the UI.

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
- No API key or API token is stored or read by PC Buddy Session mode.

## Compatibility MCP bridge

The older PCX-029 MCP bridge remains in `pc-bridge/` for supported ChatGPT Apps/MCP deployments. It is optional and is not required for PC Buddy Session mode.

## Build and verification

The `PC Buddy Portable` GitHub Actions workflow builds a self-contained .NET 10 Windows x64 executable and runs:

1. a source gate that rejects the previous billable API transport and API-key store
2. compile and self-contained publish
3. packaged executable local-tool/protocol self-test
4. a real WebView2 DOM bridge smoke using a local ChatGPT-shaped fixture; this is also the decisive proof that the published executable can instantiate the WebView2 native runtime
5. packaged WPF UI launch smoke
6. portable artifact assembly with SHA-256 receipts

The portable package contains:

- `PC Buddy.exe`
- `README.txt`
- `SELF-TEST-RECEIPT.json`
- `BRIDGE-DOM-SMOKE-RECEIPT.json`
- `UI-SMOKE-RECEIPT.json`
- `SHA256SUMS.txt`

If .NET publish emits `WebView2Loader.dll` as a sidecar, the workflow packages it too. With the current single-file settings (`IncludeNativeLibrariesForSelfExtract=true`) the native loader may instead be embedded into the executable; the real packaged WebView2 DOM smoke, not the presence of a ceremonial sidecar file, is the release gate.

No separate .NET runtime is required on the target PC. Web rendering uses Microsoft's WebView2 runtime, which is part of current Windows 11 / Microsoft Edge installations. The project pins the current stable `Microsoft.Web.WebView2` SDK package used for the WPF host.
