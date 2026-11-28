# Agent Monitor 0.21.0 — verification record

Checked on 2026-11-27 (America/Denver). This is a locally prepared candidate,
not a published release or proof of installation on the user's PC.

## Executed checks

| Check | Recorded result | What the evidence establishes |
| --- | --- | --- |
| Extension `npm test` | PASS: 49 test scripts | Current attention, shared policy, transport, detector, UI logic and preserved original test inventory |
| `npm run validate` | PASS | Source validation, UI references and 94 UI message types with backend ownership |
| Rust formatting and strict Clippy | PASS | Linux and Windows-target static correctness; no warnings allowed |
| Native Rust tests (20 total) | PASS: 15 unit + 5 integration | Real native-host child processes and authenticated local broker; simulated browser sensors |
| Linux native release build | PASS | Compiled native companion |
| Windows x64 GNU release build | PASS | PE32+ executable; Windows-system DLL imports only; not executed on Windows |
| Desktop `npm run check` and `npm test` | PASS with the existing Windows-only native gate skipped | 74 Node tests plus existing static, relay, device, hook, bridge and update checks |
| Desktop content-script integration | PASS in real isolated Chromium | Actual browser content script → actual local bridge → filesystem; not a loaded MV3 extension |
| Agent Monitor browser fixture | PASS in isolated Chromium | Real rendering and control routing at 1512 px and 390 px; labelled synthetic observations |
| Current permission DOM fixture | PASS | Four prompt variants; zero permission clicks; draft preserved |
| Minimal browser sensor fixture | PASS in Chromium | 14 observations, zero provider requests/clicks, draft preserved, no page errors |
| Full `npm run verify` | BLOCKED at installed-extension acceptance | See environment restrictions below; no full-green claim |
| Firefox browser acceptance | NOT EXECUTED | The supported two-browser fixture remains enabled by default for hosted verification |
| Pre-release optimizer assessments | COMPLETED | See `MONITOR-OPTIMIZATION.json`; no unproven optimization or speedup retained |

The complete local Chromium fixture inventory has 42 workflows: **39 passed**,
with **3 installed-extension workflows blocked** (`drive_autosync_smoke.py`,
`extension_load_smoke.py`, and `multitab_reliability_smoke.py`). The available
renderer does not execute the Firefox path. The opt-in two-profile
`native/constellation-monitor/tests/chromium_native_smoke.py` also reports
blocked before its native messaging assertions execute.
API acceptance of sound/notifications is not proof of physical speaker playback
or of the destination operating system displaying a toast.

## Runtime environment restrictions

The official Playwright browser download returned HTTP 403. A pinned
`@sparticuz/chromium` distribution supplied a working real Chromium 158
headless renderer. It supports DOM, layout and content-script testing, but
cannot load MV3 extension service workers.

A complete official Debian Chromium 156 executable was then downloaded and
checksum-verified. Its dependencies resolve, but actual startup is blocked by
the execution environment: `process_singleton_posix.cc:297`, `socket()` fails
with `Operation not permitted`. This happens before extension startup. The
installed extension, Drive guard, multitab runtime and real browser/native host
registration gates remain outstanding. No syscall substitution, preload,
sandbox escalation, or fabricated browser success was used.

Hosted workflows for Linux, Windows, Chromium and Firefox are prepared. They
have not run because the source branch has not been published.

## Publication and artifacts

The candidate is on the local branch `upgrade/constellation-agent-monitor`.
Automatic approval review rejected publication to the verified public
repository `Herbertofury/Project-Constellation`: publishing the source requires
explicit user approval. No remote branch, pull request, tag or release was
created by this work.

The packaging tool records the actual source commit, build configuration,
per-artifact SHA-256, and native binary SHA-256 in `artifact-receipt.json`.
Artifacts must be regenerated after committing the final source. The Windows
Monitor Kit includes the hub executable, Chromium extension, Firefox sensor,
setup instructions and this verification record.

The monitoring candidate uses the existing supported production build option
`--allow-unprovisioned-oauth`. Google/GitHub OAuth client IDs are not embedded;
`build/build-info.json` must state `oauth.google=false` and
`oauth.github=false`. Monitoring and the local hub do not need those account
integrations. Signed-in backup/account round trips are not certified, and
normal OAuth provisioning is still required for those features.

## Target-environment acceptance still required

- Live Chrome, Edge, Opera GX and Firefox registration and sensor connections
  on the user's Windows machine.
- Physical sound, OS notification visibility, device volume and focus mode.
- Windows runtime execution, including the Windows-only copied-file ACL test.
- Mozilla signing for permanent Firefox distribution. The provided sensor is
  an unsigned temporary development add-on and is removed on Firefox restart.
- Signed-in Google/GitHub integrations and existing remote desktop acceptance.

Cross-browser coverage requires a sensor in each browser/profile. A detected
browser executable is never presented as a connected sensor. Approval prompts
are detected and opened for direct review; permission decisions remain manual.

## Source continuity and preserved behavior

- Exact v0.20.0 source archive SHA-256:
  `4a8d71f9eb5eb9aab263d6fa15c59aad250d63aa60def368f5306b48a3e3eb26`.
- Complete v0.20.1 patch SHA-256:
  `adf9338cfe92d3835607bf9dce103f8015458e580081cacd38aa1ae3439f20b3`.
- Reconstructed tree matched
  `89b711f46672830e786ba3afcdf0d1973325a896` before import.
- All 323 restored source files and all 46 historical main test files are
  retained. All original 15 main test commands remain represented.
- Carrier-only Drive guards, project discovery and acknowledged persistence
  were integrated into the active runtime. See
  `SOURCE_PRESERVATION_0.21.0.md` for the complete mapping and defect audit.
- Historical carrier evidence and incomplete v0.20.2 fragments are retained;
  incomplete fragments are not represented as a recovered release.
- The Drive metadata lookup did not complete, so this record does not certify
  a latest Drive checkpoint or declare v0.20.1 the user's newest external copy.

## Reproducible commands

```sh
npm test
npm run validate
npm run verify
npm run build:sensors
cargo fmt --manifest-path native/constellation-monitor/Cargo.toml --all --check
cargo clippy --manifest-path native/constellation-monitor/Cargo.toml --locked --all-targets -- -D warnings
cargo test --manifest-path native/constellation-monitor/Cargo.toml --locked --all-targets
cargo build --manifest-path native/constellation-monitor/Cargo.toml --release --locked
node tools/build.mjs --mode=production --allow-unprovisioned-oauth
node tools/build-browser-sensors.mjs
python3 tools/package-agent-monitor.py --require-native
```

An available local Chromium executable can be selected with
`PROJECT_CONSTELLATION_CHROMIUM`. A deliberate Chromium-only sensor run uses
`PROJECT_CONSTELLATION_TEST_BROWSERS=chromium`; that is partial browser coverage,
not a Firefox pass. The standard hosted sensor fixture runs both browsers.
