# Project Constellation Portable

Project Constellation is the portable Windows command center for ChatGPT sessions, project continuity, local file/code work, and guarded computer access.

## Goal

Unzip the portable package and double-click `Project Constellation.exe`. No Node.js install, npm setup, PowerShell installer, service install, MCP command line, OpenAI API key, or separately billed API credits are required for the primary experience.

Project Constellation is intended to behave like a local Work agent: it can inspect files, create/edit source and text files, organize project files, and run approved developer tooling inside enabled/project-linked workspaces instead of stopping at read-only inspection.

## ChatGPT Session mode

Project Constellation hosts the real `chatgpt.com` experience inside a persistent WebView2 profile and uses the user's normal ChatGPT account/session. It does **not** call the OpenAI Responses API and does **not** use separately billed API credits.

On first launch, ChatGPT may ask the user to sign in inside Project Constellation once. That browser profile is then retained under Project Constellation's data directory. ChatGPT itself continues to own the account, model picker, subscription limits, browsing features, chat history, and normal web UI.

Project Constellation injects a local-tool bridge into the ChatGPT page. When ChatGPT needs approved local work, it emits a nonce-bound request. The desktop host validates the session nonce, enforces Access policy and Emergency Lock, performs the local operation, and returns the observed result into the conversation. Internal bridge messages are hidden from the visible chat UI.

The same guarded broker is available to normal `chatgpt.com` tabs through the Project Constellation browser extension on `127.0.0.1:17342`. No ChatGPT Developer Mode/custom-app setup or API billing is required for that path.

The `PC_BUDDY_*` marker names remain internal wire-protocol identifiers for backward compatibility. They are not the product name.

## Work-agent tools

When enabled by Access policy and the current tool manifest, Project Constellation exposes:

- `pc_status` — host/app/policy/workspace summary.
- `pc_windows` — visible top-level app windows.
- `pc_processes` — bounded process summary.
- `fs_stat` — metadata for a permitted path.
- `fs_list` — bounded directory listing.
- `fs_read_text` — bounded text/source reading.
- `fs_write_text` — create, overwrite atomically, or append UTF-8 text/source files.
- `fs_replace_text` — exact text/code replacement with atomic rewrite.
- `fs_mkdir` — create directory trees.
- `fs_copy` — copy files inside/between permitted workspaces.
- `fs_move` — rename/move files or directories inside/between permitted workspaces.
- `fs_trash` — reversible removal into a `.project-constellation-trash` folder within the permitted root.
- `project_run` — run approved developer executables with explicit argv and cwd inside a permitted workspace.
- `pc_run_allowed` — fixed Windows diagnostic IDs enabled in Access.

Approved developer executables include Git, .NET, npm/npx/pnpm/yarn, Cargo/Rust, Gradle/Maven, Java/Javac, and project-local wrapper names where applicable. These are launched directly; Project Constellation does not expose a general `cmd.exe`/PowerShell shell-string tool.

## Project workspaces

The Projects page stores multiple independent project tabs with ChatGPT URLs, related chats, local root, GitHub/Drive links, checkpoint, blocker, exact next action, and notes.

A local root linked from a Project tab becomes part of that project's permitted Work-agent workspace set. Desktop/Documents/Downloads can also be enabled from Access. This means coding work is not limited to the portable app's own data directory.

Project metadata is saved atomically under portable data and reloaded on restart.

## Portable behavior

Project Constellation first tries to keep state beside the executable under `data/`. If Windows blocks writes in the executable directory, it falls back to `%LOCALAPPDATA%\ProjectConstellation\data` and shows the active path in the UI.

State includes settings, activity receipts, project metadata, and the persistent ChatGPT WebView2 profile under `data/chatgpt-session/`.

## Safety controls

- Emergency Lock disables local tool execution immediately.
- File mutations are confined to enabled folders and project-linked roots.
- Windows final-path resolution is used before access/mutation so junction/symlink escape does not bypass the workspace boundary.
- Overwrites and precise text edits use temporary-file atomic replacement.
- `fs_trash` is reversible and is preferred to irreversible deletion.
- Developer commands run only approved executable names from a permitted cwd and have bounded execution time/output.
- Git path-redirection flags that could escape the approved cwd are blocked.
- ChatGPT local-tool requests require the current per-conversation random nonce.
- Browser-companion sessions use short-lived random tokens plus the per-chat nonce.
- Duplicate tool-call IDs are rejected/ignored.
- Activity is recorded locally as JSONL.
- No OpenAI API key or API token is stored or read by the primary session mode.

## Project Constellation ecosystem

The desktop app, browser extension, project/checkpoint manager, Google Drive/GitHub lineage, and ChatGPT companion Skill are one product. The local implementation currently remains under the repository's `pc-buddy/` source directory to preserve development history; that folder name is not user-facing branding.

The older PCX-029 MCP bridge remains in `pc-bridge/` for supported MCP deployments. It is optional and is not required for normal Project Constellation ChatGPT-session/browser-companion use.

## Build and verification

The `Project Constellation Work Agent` Windows workflow verifies the actual work contract, not only compilation:

1. source gate rejects the old billable API transport/API-key store
2. browser companion and Skill validation
3. .NET 10 compile and self-contained publish
4. packaged EXE creates a real text file on the Windows Desktop
5. edits and reads that Desktop file back
6. copies and moves/renames Desktop files
7. writes source code in a linked custom workspace
8. runs an approved `dotnet --version` developer command from that workspace
9. verifies Emergency Lock blocks mutation
10. persists/reloads a Project tab ledger
11. performs a tokenized browser-companion -> `fs_write_text` -> real Desktop file round-trip
12. runs the WebView2 DOM bridge smoke and WPF UI launch smoke
13. assembles a portable package with SHA-256 receipts

The package contains `Project Constellation.exe`, the Browser Extension, ChatGPT Skill, README, self-test/bridge/UI receipts, and `SHA256SUMS.txt`.

No separate .NET runtime is required on the target PC. Web rendering uses Microsoft's WebView2 runtime, which is part of current Windows 11 / Microsoft Edge installations.
