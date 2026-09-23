# Constellation Commander 0.7.2 - Chat-first desktop workspace

Date: 2026-09-23
Status: implemented, packaged, locally regression-tested. Native Windows / real Electron / authenticated live ChatGPT verification remains outstanding.

## Canonical artifacts

Full source, portable Windows package split into three parts, exact-version manual patch, test evidence, report, previews, hashes, and reassembly script:
https://drive.google.com/drive/folders/1ddBAorOCkaKnzTd-b_8TkUNS9ejz4N0K

Full editable source ZIP:
https://drive.google.com/file/d/1m8oqZNttLFTVvZXDCr6zXgyjRGfr4qXJ/view

Manual update ZIP:
https://drive.google.com/file/d/1tJmgr6dmbJLV1eQTnRGSQr6wQdCXS_tC/view

This GitHub branch records the release identity and verification receipt. It does not contain the complete 0.7.2 source or binaries as repository files; those artifacts are in the linked Drive folder. Unrelated main-branch work was not changed. Local source checkpoint: 8a9fa4f6f4e82689f729e031b9a3e2528dacd65f (local, not a remote repository commit).

## Implemented

- Real online ChatGPT remains the central WebContentsView, in the same persistent profile. Local view navigation preserves that web session.
- Compact navigation rail: Chat, Files, Terminal, Desktop, Activity, Connections, Settings. Collapsible Computer access Inspector; narrow widths use a separate permission screen.
- System / Light / Dark themes, chat zoom, pin window, quick-action palette, keyboard shortcuts, download progress and reveal-in-folder, and credential-free diagnostic export.
- File browser/filter, parent navigation, open-in-system, conflict-safe text editor, retained unsaved drafts, and working-folder-aware terminal with interactive input, saved output, exit status and Stop.
- Searchable forms generated from actual tool schemas; Advanced JSON remains available.
- Explicit remote-MCP pairing to an operator-supplied HTTPS relay, restricted approval origin, credential reset on relay change, in-flight poll cancellation, and no action replay after failed result delivery.
- Local, remote and chat actions use the same production permission policy. Remote chat cannot grant itself permissions. Concurrent connect/disconnect state is guarded.
- All 54 prior tool names and the 0.7.1 nonce, replay, outbox, file-conflict, process and scope repairs are preserved.

## Verification actually obtained

42 Node regressions passed, including real file/process operations and production main-boundary code with an Electron API adapter. The same 42 passed after extracting the delivered source ZIP into a separate directory.

23 Chromium UI scenarios passed. These exercise real disk/process handlers through a substituted IPC transport: safe editing, terminal stdin and Stop, theme/zoom/pin dispatch, palette navigation, all production IDs, three responsive widths, tool forms, history/replay/nonce controls, unsent-draft retention, and Off mode. Browser loading is substituted because this sandbox blocks file/HTTP navigation. These tests do not prove real Electron, production CSP behavior, or a signed-in ChatGPT session.

Existing syntax/server/relay/device-agent/browser/plugin tests passed. The actual device-agent integration exercises the production agent and a real local relay. Focused delivery-failure tests substitute HTTP responses deliberately to reproduce network failures.

36 packaged application files match corrected source. ASAR offsets, sizes, integrity hashes, source identity, ZIP CRCs, and 71 unchanged Windows runtime files were checked. The original executable and fuse settings are byte-identical.

The source ZIP, manual patch and all portable split parts were downloaded back from Drive. Every part hash matched; streamed recombination reproduced the exact portable hash below.

## Outstanding acceptance / limits

Native Windows execution, real Electron rendering, the user's authenticated ChatGPT session, microphone/camera operation, native desktop input, and PowerShell patch/rollback execution have not been run in this Linux environment. The Windows-only suite reports SKIP. No new signed installer or successful Windows CI run is claimed.

The embedded bridge is a DOM/request adapter, not an officially registered ChatGPT connector. The optional relay source is included, but a hosted endpoint and authorized ChatGPT plugin registration are not configured by this release. Account/workspace features and platform restrictions still apply. No OpenAI API key or separate billed API is used for the primary embedded ChatGPT path.

The original Windows Electron launcher is reused: Windows File Properties may show 0.7.0, while the application/UI is 0.7.2. Filesystem roots are not an OS sandbox for arbitrary shell commands. UAC, secure desktop, local permissions and ChatGPT confirmations are not bypassed.

## Install

Close Commander. Extract the complete portable ZIP into a new directory and open Constellation Commander.exe; keep all files together. The profile/settings are not erased. Do not reinstall an older EXE afterward.

Alternatively, extract the small Manual Patch, run APPLY-PATCH.cmd and select the existing Constellation Commander.exe. Only exact known 0.7.0/0.7.1 app archives are accepted. The patch refuses running or unknown targets, retains a backup, and supports verified rollback. Its Windows execution remains unverified.

## SHA-256

```
017856a4507cb1574553ff15ad7a220e1a532692be79711fd615560ae4dc115c  Constellation-Commander-0.7.2-Windows-Portable.zip
39a079a61baf5aaff8bb5db3a5a4d53da461a687c51abfe1a60d9b29bc2d3193  Constellation-Commander-0.7.2-Source.zip
4a6c3631b19df241154f26fc34ca0a77573675a7f40bd53c08af9dd6c32fa826  Constellation-Commander-0.7.2-Manual-Patch.zip
cd4c95f1f0b7c7ed1dae2e310490bc4bf886e656b9a5c9180fc2a2bd39954e12  resources/app.asar
```
