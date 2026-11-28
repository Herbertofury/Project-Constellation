# Project Constellation 0.22.0 — verification record

This source checkpoint was checked on 2026-11-27 (America/Denver). Published
runtime receipts are authoritative for the exact release commit. The prepared
Windows workflows below must actually pass before a GitHub release is created;
a prepared workflow is not recorded here as an executed pass.

## Local evidence

| Check | Result and scope |
| --- | --- |
| Root regression tests | 50 scripts, including artifact source/hash/acceptance validation |
| Source, UI and message contracts | Pass; 94 UI message types owned by the service-worker module graph |
| Rust browser hub | 18 unit and 11 real subprocess/transport tests passed; Linux and Windows-target strict Clippy |
| Native setup transaction engine | 22 Rust transaction tests and 7 Python builder tests passed; Linux and Windows-GNU strict Clippy; separate from Windows GUI acceptance |
| Computer-Link source migration | 26 branch trees and 92 commits restored; 123 active imported files mapped; full bundles pass strict Git checks |
| Original Constellation preservation | All 323 reconstructed original files and all 46 historical test files retained |
| Desktop and native adapter | 22 task + 81 combined tests, 13 other portable scripts and 27 real rendered UI workflows passed locally; native availability remains optional |
| Optimizer assessments | Pinned shrink-anything, fast-anything and rust-anything assessed in isolation; see RELEASE-OPTIMIZATION-0.22.0.json |
| Full local npm run verify | Installed-extension gates remain blocked locally; no full-green local claim |
| Delayed continuation revalidation | 13 real DOM race cases passed; the old source failed 10 of the initial 11 cases. Background tests preserve all six safe abort responses without reload or focus changes. |

The local runtime has a real Chromium renderer and supports content-script,
DOM, layout and mock-API fixtures. It does not provide a working installed MV3
extension service worker. The installed-extension tests require an actual worker,
correct extension identity and a real runtime response. A browser opening with
an empty worker list is now a failure, not a passing startup check.

The recorded complete local baseline evaluated 42 workflows: **39 passed**, with
**3 installed-extension workflows blocked** (`drive_autosync_smoke.py`,
`extension_load_smoke.py`, and `multitab_reliability_smoke.py`). Firefox runtime
acceptance runs in the hosted browser job; it was not executed locally.
The final inventory adds the separately passing 13-case continuation-race
workflow, for 43 workflows. The multitab acceptance now attaches to its own
fresh-profile Chromium without Playwright focus emulation and still requires
genuine hidden-tab state; its final installed-browser result is a hosted gate.

The authoritative local log set is under `logs/release-0.22.0` and `logs/smoke`.
These are generated evidence, not source. The previous candidate's complete
record is preserved in [MONITOR-VERIFICATION-0.21.0.md](MONITOR-VERIFICATION-0.21.0.md).
Do not use that historical candidate's publication state or test counts as the
current release result.

## Hosted gates required before publication

The unified release workflow requires all five reusable jobs:

1. **Project Constellation Verify:** root regressions and contracts, the complete
   browser smoke inventory with installed extension support, and desktop tests.
2. **Windows runtime:** actual native computer use, integrated Electron launch,
   native tool packaging, extraction and launch of the produced portable app.
3. **Windows setup:** actual install, repair, rollback, uninstall, rendered setup
   and owner windows, restored registrations and shortcuts. An intentionally
   altered acceptance fixture exercises rollback; it is never publishable.
4. **Native monitor:** Rust formatting, strict Clippy, real native transport tests
   on Linux and Windows, plus Chromium and Firefox detector/rendering fixtures.
5. **Computer Tools:** source/bundle verification, native tests and status-only
   MCP handshakes on the supported hosted platforms.

Packaging rejects stale versions, source commits, hashes, incomplete receipts,
failed acceptance or acceptance fixtures. It writes generated output under
`build/releases/v0.22.0`, leaves historical `releases/` evidence untouched and
includes the final receipt itself in SHA256SUMS. Publication refuses to replace
an existing release and downloads the published assets to verify their bytes.

## Installation and target-machine boundaries

The compact Rust EXE installs the hub, browser sensor folders and native
Computer Tools. The full desktop shell is provided as its own installer and
portable ZIP. Browser enablement remains a direct user action. Every monitored
browser/profile needs a sensor. Installed browser executables alone do not
prove connected coverage.

The shared hub starts through native messaging, exits after the final sensor
lease and a five-second reconnect grace period, and starts again on demand.
The bridge releases its lease when the last normal window closes, including
Chromium background mode. Native Computer Tools have a separate explicit
lifetime and local session controls.

Still required on the destination computer:

- physical speaker playback and visible operating-system notifications;
- real Chrome, Edge, Opera GX and Firefox profile enrollment and reconnection;
- account-specific Google Drive/GitHub sign-in, backup, restore and revocation;
- permanent Mozilla-signed Firefox distribution and Windows publisher signing.

The Firefox sensor is currently unsigned and temporary. Public OAuth client IDs
are injected only when supplied through release secrets; build metadata records
which providers were provisioned. No account round trip is inferred from that
configuration. The release remains a prerelease while these acceptance and
distribution gaps are open.

## Reproduce

Run `npm run verify` from the repository root. Follow the native monitor,
Windows setup and Computer Tools READMEs for their pinned native commands.
`docs/RELEASING.md` describes exact artifact assembly and GitHub closeout.
