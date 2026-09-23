# Constellation Commander 0.7.4 - saved tasks and indexed search

Date: 2026-09-23
Status: implemented, packaged, regression-tested and tested in real Electron on Linux with an owned chat fixture. Native Windows and the user's authenticated ChatGPT account remain unverified.

## Complete artifacts

Drive release folder:
https://drive.google.com/drive/folders/1S7kSVKADM8q7bB_LKj1gniJqWvG2-od8

Complete editable source (81 files):
https://drive.google.com/file/d/1wmBUOnDTbWxtm5mK5A27FpD2uuVPIsX1/view

Manual update with rollback:
https://drive.google.com/file/d/1SbL0c3mCgO1y0xJzFS22qV02qoNkeSdg/view

Detailed release report:
https://drive.google.com/file/d/1jK_IuZtfEBA5RqvGc9-1UP3cf6zm_tAy/view

Test evidence:
https://drive.google.com/file/d/1qdBmMyz43j5C1Bb-lDFiz2lwx6HWZGLQ/view

The full Windows portable is stored in three ordered parts with a checksum manifest and reassembly script. The complete source and binaries are in these artifacts; this GitHub branch records the release receipt, not a full source-tree upload. Unrelated main-branch work was not changed.

Local source checkpoint: 68cb86263c80f598be929ff2937bab6d33cab8a6 (local commit, not a commit in this remote repository).
Baseline source ZIP: 5198e41e552445d39e99f9592739ae2461efe4ecdfb2a9e9c3d21cbb192466ee (0.7.3).

## Functional gains

The existing interface and 0.7.3 reliability fixes are preserved. Activity now includes Saved tasks; Terminal includes Run as saved task. Five task tools are added, while all 54 baseline runtime tool names remain: run_task, get_task, list_tasks, cancel_task, resume_task. There are 59 runtime tools; the chat catalog remains filtered by the existing permission/administrative rules.

Explicit multi-step plans validate before execution, persist individual step results, reuse previous results through {$result:"step_id/field"}, and enforce current permissions between steps. A task can read, safely edit and verify a file without a model round trip for every individual operation. Commands can wait for exit; nonzero exits stop later steps. Task and terminal readers have independent output cursors, preserving partial output without consuming one another's data.

Completed steps are reused on resume. Failed steps require explicit retry. In-flight steps left by a crash or failed post-action checkpoint are marked uncertain, not automatically repeated; only the local user can explicitly resolve them. Concurrent resumes cannot duplicate runners. Owners remain isolated across shell, chat, browser and remote access. Cancel is not rollback. Attachments are preserved through saved task results.

Search uses persisted per-row byte offsets rather than reparsing every saved result to fetch a page. Literal search streams large files instead of silently skipping those over 16 MB. General regular expressions retain whole-file semantics and can require proportional memory. Scan errors result in partial status; counts and configured exclusions remain visible. Saved results recheck authorized roots. Activity reads a bounded log tail and ignores incomplete final records.

## Measured performance, not an app-wide claim

Linux / Node v22.16.0; identical UTF-8 results; warm filesystem cache; median of nine measurements. Script: tests/benchmark-pagination.mjs in the delivered source.

| Operation | Old median | New median | Ratio |
| --- | ---: | ---: | ---: |
| Fetch 100 of 1,000 saved results | 1.018994 ms | 0.366682 ms | 2.77896x |
| Fetch 100 of 10,000 saved results | 6.147243 ms | 0.290688 ms | 21.14722x |
| Fetch 100 of 100,000 saved results | 73.900930 ms | 0.272641 ms | 271.05582x |
| Last 30 of 100,000 activity records | 47.298559 ms | 0.714425 ms | 66.20507x |

The 100,000-row page reads 18,616 bytes instead of 18,577,780 bytes with identical results. Index storage is 8 bytes per row (800,000 bytes for this fixture). Fixture data plus index creation took 113.19 ms and is not included in the page-read timings. This is NOT a 100x whole-app, model, network, scan-throughput or Windows performance claim.

## Verification performed

- 72 Node regressions passed: 22 new task/search tests and 50 retained tests. Existing syntax/server/relay/actual-device-agent/browser/plugin/Chromium-to-disk smoke suites passed.
- The delivered source ZIP was extracted independently; syntax, all 72 Node tests and the existing smoke suites passed again.
- 22 scenarios passed in real Electron 44.4.4 Linux against source and the exact final ASAR: actual main process, preloads, IPC, CSP and real file/process handlers. These retain the 17 preceding replay/draft/delivery/permissions scenarios and add Activity task execution, saved terminal output, chat-launched multi-step disk operations with result reuse, task-result retrieval and reload persistence.
- Challenge coverage includes incomplete audit writes, independent process readers, uncertain post-action checkpoint failure, uncommitted search tails, owner isolation, duplicate resume and saved attachments.
- 40 packaged application entries matched source; offsets/sizes/integrity hashes and ZIP CRCs passed. Original Windows runtime/helper entries and launcher/fuse configuration were preserved.
- Included scripts/package-repair.py was executed with the pinned 0.7.3 source artifacts and reproduced every portable entry's payload bytes and the exact ASAR. ZIP container timestamps may differ.
- Source and manual patch were downloaded back from Drive and byte-compared. All three portable parts were downloaded back, individually hash-verified and streamed in order; their combined digest matched the complete portable exactly.

## Explicit boundaries

The native test chat server is an owned fixture, not the user's signed-in ChatGPT account. Windows execution, native PowerShell computer-use, microphone/camera and Windows patch/rollback execution were NOT run; the Windows-only test reports SKIP. Linux root-host tests used --no-sandbox solely for that host, without changing production launchers or isolation preferences.

Windows retains the original Electron 44.4.3 runtime; Linux proof uses 44.4.4. File Properties can show the old 0.7.0 launcher version, while application code is 0.7.4. No new signed NSIS installer is claimed. The embedded adapter is not a registered external ChatGPT app; no hosted MCP service, new account permission, paid inference API or background repatcher was introduced. Filesystem roots are not an OS sandbox for arbitrary shell commands.

## Installation

Close Commander. Extract the complete portable ZIP into a new folder and run Constellation Commander.exe, keeping the folder contents together. Alternatively, extract Manual-Patch.zip and run APPLY-PATCH.cmd against the existing executable. It accepts exact known 0.7.0/0.7.1/0.7.2/0.7.3 app archives, retains a backup and includes ROLLBACK.cmd. It refuses unknown or running targets. Windows execution remains unverified; do not reinstall an older EXE afterward.

## SHA-256

```
1cea54ec6044684d2d49014d4f40aefbe6a039b301ad300daa6ea73ab22b1328  Constellation-Commander-0.7.4-Windows-Portable.zip
6ce8f2dd6740877f501214eb7d0649267b2a5abdb08acf58a7e1f61283de7a9c  Constellation-Commander-0.7.4-Manual-Patch.zip
07ef628a7b47c4392de7f8bdfca9ac8a466fc2317dfa987cceae66a67dab4365  Constellation-Commander-0.7.4-Source.zip
01983e5c260d42764ffa13dec7c1d301b500255bb10967316b91d67ecdc935dd  Constellation-Commander-0.7.4-Test-Evidence.zip
52124737024d9f2d7cd0450a5cba935246df0dfe7c272f731ee39548c17f0ceb  resources/app.asar
```
