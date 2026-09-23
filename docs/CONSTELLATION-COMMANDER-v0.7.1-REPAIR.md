# Constellation Commander 0.7.1 reliability repair

Date: 2026-09-23
Status: implemented and locally regression-tested; native Windows and authenticated live ChatGPT acceptance remain unverified.

## Artifact location and exact identity

The complete corrected source, portable Windows repair, small manual patch, report, and evidence are saved in this Google Drive folder:
https://drive.google.com/drive/folders/1Fhg7m-U94XU58M1z9gGOaXbiW5FUTe0Q

This GitHub branch records the repair receipt and immutable artifact hashes. It does NOT claim that the corrected source tree or Windows binaries have been uploaded into this branch. The complete source snapshot is in Drive:
https://drive.google.com/file/d/1FBqnXERgb4FtX-J4vEhXX1AapeFDM6s4/view

The repair was derived from the shipped 0.7.0 source ZIP, SHA-256 43266bac1a43732bb41a52c819cd9f2d10e3ab60d0cd70dcb61d34989eed0dd0. Local source checkpoint: 330aeb9f03155cea5d2e73c7fa10850f7c1dcc06 (local commit, not a commit in this remote repository). Unrelated main-branch work is unchanged.

## Actual failures repaired

- Same-path overwrite move deleted its own source. Moves now preserve identical source/destination paths and retain replaced destinations as backups.
- Missing process working folders or executables could cause an unhandled spawn error. Managed process failures now return errors without terminating the runtime.
- Incremental terminal reads lost incomplete-line output. Byte-cursor reads now retain output, drain log writes, and preserve exit/timeout/termination state.
- Concurrent calls lost statistics and audit records. Logging is serialized, statistics are atomically replaced, and audit-write errors are reported separately from operation success.
- Lexical-only filesystem scope allowed symlink/junction targets outside the selected workspace. Resolved paths are checked; removing the last root leaves no authorized roots.
- Editor saves are atomic, verify the previously read SHA-256, preserve CRLF, and refuse binary/invalid UTF-8 data.
- Historical, quoted, user-authored, or remounted tool-call wrappers could be treated as fresh work. Fresh explicit assistant messages require the active nonce; production main-process call-ID deduplication independently prevents repeated identical execution and rejects changed arguments for a reused ID.
- Tool-result delivery could replace an unsent draft or repeat a completed action. Completed results are now saved before delivery; retry sends that saved result instead of re-executing the action and checks the originating conversation.
- IPC now checks the owning frame and origin; chat cannot modify its own permissions. Emergency Lock stops Commander-owned work and prevents new mutations.

## Usable workspace

The Workspace button opens a wide file editor and terminal without discarding the ChatGPT session. Folder browsing, text editing with conflict detection, command working folders, process output, exit status, and Stop work without relying on the chat bridge. Advanced tools remain available.

## Verification performed

- 29 Node regression tests passed: 22 actual runtime/file/process tests and 7 production main-boundary tests with an Electron API adapter.
- 11 Chromium UI scenarios passed, exercising real disk/process operations through a substituted IPC transport. The supplied relocated test harness was also executed successfully.
- Existing syntax, server, relay, device-agent, plugin, browser-bridge, request-hook, and real-Chromium-to-disk tests passed.
- 34 packaged application files were byte-compared with corrected source; ASAR offsets, sizes, per-file hashes, archive CRCs, and unchanged Windows launcher bytes were checked.
- Source, manual patch, and all three portable split parts were downloaded back from Drive and verified. The streamed parts reproduce the exact portable ZIP hash below.

## Explicit boundaries

This environment is Linux. Native Windows execution, the PowerShell patch/rollback scripts, and the user's authenticated live ChatGPT session have NOT been executed here. The Windows-only suite reports SKIP. Chromium DOM tests substitute IPC; they are not a real Electron or authenticated ChatGPT test. No new signed NSIS installer or successful Windows CI run is claimed.

The portable repair preserves the original Windows Electron executable, system libraries, and original embedded-integrity fuse configuration. Windows File Properties may still show 0.7.0; repaired application code/UI are 0.7.1. The bridge remains a DOM/request adapter, not an officially registered ChatGPT connector. It does not bypass platform quotas. Shell permission runs commands with the user's Windows privileges; scoped file roots are not an OS sandbox for arbitrary shell commands.

## Installation

Close Commander, extract the complete 0.7.1 portable ZIP into a new directory, and run Constellation Commander.exe. Keep the folder together. Do not run the old 0.7.0 installer afterward.

For existing 0.7.0 installations, the small manual patch includes APPLY-PATCH.cmd and rollback scripts. The scripts verify the exact old/new application archive hashes, refuse unknown or running installations, retain a backup, and leave the ChatGPT profile and settings intact. Their Windows execution remains unverified.

## SHA-256

```
06d3212d89904bf98eb157e4afa8ad36ff3cc77b08c1d124a96adf24c8e1e6e1  Constellation-Commander-0.7.1-Windows-Portable.zip
017f0c2e7976293ccd7661490509dd4aed56e90da450581393fb766976b063b2  Constellation-Commander-0.7.1-Manual-Patch.zip
3cad7d544770520d72b0b185cd549f6e70aeb080b91d61bb0e6657930f0c8902  Constellation-Commander-0.7.1-Source.zip
eaa8eb75877cd7d15dd06ade0d7385e7ee52e4283279d9c147356804fed04416  Constellation-Commander-0.7.1-Test-Evidence.zip
```
