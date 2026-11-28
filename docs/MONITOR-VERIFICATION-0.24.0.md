# Project Constellation 0.24.0 — verification record

This source checkpoint records local candidate evidence. The matching published
release receipt and completed GitHub workflows establish the final commit/tree,
actual Windows and installed-browser acceptance, and shipped bytes. A prepared
workflow, a compiler check or a configuration flag is not runtime acceptance.

## Local regression evidence

| Area | Executed local evidence and scope |
| --- | --- |
| Root regressions | All 51 npm test command entries retained; browser persistence/lifecycle, scheduler and generated production-build checks exercise the actual production modules |
| Source/UI/message contracts | Validation passes with all 94 existing UI message contracts; no added content-script network or provider actions |
| Full browser smoke inventory | 40 of 43 workflows pass with the available real Chromium headless shell; three installed-extension checks fail at the documented local capability boundary |
| Desktop | `npm run check` and `npm test` pass: 22 task/search tests, 81 runtime tests, static/package/relay/device-agent checks and a real Chromium-to-desktop bridge-to-disk round trip |
| Native hub | 22 Linux unit tests and 14 actual child-process/transport tests pass; formatting and strict Linux/Windows-GNU Clippy pass |
| Installer | 29 Linux transaction tests, one digest-format unit and seven Python builder tests pass; Windows junction cases compile and require actual hosted execution |
| Computer Tools | 23 Python tests pass; 14 Windows transport tests typecheck, including four fragmented-frame/deadline/authorization regressions that require actual Windows execution |
| Scheduler supervision | 19 Node and 11 Python tests pass, including independent failure channels, malformed/future audit evidence, persistent attempt claims, cooldowns and post-side-effect save failures |
| Released browser regressions | Six focused behavioral cases fail against released `7fe2bf4` and pass against the repaired service; native and browser agents independently cross-reviewed the final implementation |
| Generated account configuration | Production/development/unprovisioned build regressions execute the generated GitHub client-ID accessor and inspect Google manifest configuration; this is local configuration proof, not a signed-in account round trip |
| Stack and optimization | Official current-stack evidence and the pinned, isolated optimizer results are recorded in the matching 0.24.0 receipts |

The full local `npm run verify` run used Node 24.22.3, Python 3.12.14,
Playwright 1.62.0 and Chromium 158.0.8127.0. Native local checks used Rust 1.99.0.
These are not the selected hosted release versions: Node 26.13.1, Rust 1.100.1,
Playwright 1.65.2 and Electron 45.5.0 remain required in their release jobs.

The three local failures are `drive_autosync_smoke.py`,
`extension_load_smoke.py` and `multitab_reliability_smoke.py`. The available
headless shell does not load the installed MV3 extension pages/worker; full
Chromium startup requires a Unix socket unavailable in this execution environment.
The failures are retained, and local `npm run verify` exits 1. They are not
converted into skips or passing status. Hosted CI must execute the complete
inventory using its isolated display and actual installed-browser support.

The full smoke run followed the coordinated version sweep. A subsequent
build-only OAuth correction has separate generated-build regression coverage
and the final full root test pass; hosted verification binds the complete final
tree. The first local version-sweep attempt stopped on one stale version regex;
that assertion was corrected and the full run restarted. Raw failure and rerun
logs remain available rather than being overwritten as passing evidence.

## What the regressions establish

Browser storage tests verify failed-write retries, durable advancing ordering,
same-timestamp authority changes and repeated mirrored native ACK/snooze after a
failed save. Native tests abruptly stop a real hub immediately after an ACK and
restart it, preserving the accepted watermark; forced persistence failures leave
the prior accepted state intact. Exact retries add no write or duplicate alert.

Lifecycle tests distinguish old navigation/close/discard callbacks from current
tab state and document/run identity. Reconnection restores quiet remote coverage
without inventing a newer provider observation; native history restored as
explicitly disconnected remains unavailable until fresh evidence arrives.

The extended sensor test runs in a real renderer with controlled extension
messaging. It verifies response deadlines, bounded fresh retries, inert late
ACKs, dispatched page lifecycle pause/resume and disposed-sensor reinjection,
with preserved draft text, zero provider requests and zero permission clicks.
Dispatched page events are not claimed as a genuine browser-cache navigation
cycle or installed-extension acceptance.

Alert tests recover unstarted delivery and retain stable notification IDs.
Already-claimed audio becomes **interrupted** with an explicit error; it is not
silently marked successful or automatically replayed. Neither an accepted audio
API call nor a mocked notification proves physical sound or OS visibility.

Installer tests preserve exact external target bytes, ownership receipts and
registrations while rejecting active links before mutation or recovering an old
committed linked backup. Windows tests use disposable junctions, avoiding a
false requirement for symlink elevation. All installer/runtime fixtures remain
excluded from release artifacts.

The immutable v0.23.0 Extension ZIP reproduces the GitHub client-ID build defect:
a populated receipt coexists with an accessor that rejects the configured ID.
The repair changes only the intended configuration declaration. Package readback
must check actual generated behavior and the stable manifest identity, not only
whether a receipt says that IDs were supplied. No account credentials or owner
browser profile is used in these checks.

## Performance and preservation

[NATIVE-ACK-PERFORMANCE-0.24.0.json](NATIVE-ACK-PERFORMANCE-0.24.0.json)
contains five alternating baseline/candidate pairs for the final-version native
binary. Each run retains 96 sessions and 192 incidents, handles 384 advancing
observations and then 384 exact retries, and checks durable saved watermarks.
The median of per-run ACK medians rises from 0.159 ms to 1.297 ms because the
candidate performs required persistence before acknowledging. Exact-retry
medians are 0.150/0.155 ms, with zero retry rewrites or duplicate broadcasts.
Tail results, variance and full source/binary hashes remain in that report.
These are Linux measurements with ordinary OS caches, not Windows or physical
cold-cache claims and not a speedup over equivalent durable guarantees.

The exact dashboard HTML/CSS/JavaScript remains unchanged from the measured
v0.23.0 incremental renderer. Its historical performance evidence is explicitly
reused, not relabeled as a new v0.24.0 benchmark. Full matching rows and existing
features/tests remain intact; no new caps, culling, deferred work or content cuts
are introduced as an optimization tactic. Existing protocol retention limits
remain documented, including the separate direct-client replay/tombstone question.

[RELEASE-OPTIMIZATION-0.24.0.json](RELEASE-OPTIMIZATION-0.24.0.json) records
fresh pinned shrink-anything, fast-anything and rust-anything assessments on a
complete isolated source snapshot, together with the scoped Google
migrate-to-rust applicability decision. The changed native paths are already
Rust; browser host APIs and small audit/build orchestration do not supply a
material supported legacy compute boundary. No artificial migration is claimed.
The upstream shrink report's refusal without a destructive cut is recorded
explicitly; no cut is performed. No unmeasured optimization is retained.

Raw evidence is under `logs/release-0.24.0`, `logs/alerts-browser-0.24.0`,
`logs/review-setup-linked-browser` and `logs/review-scheduler-recovery`.
The prior verification record remains in
[MONITOR-VERIFICATION-0.23.0.md](MONITOR-VERIFICATION-0.23.0.md).

## Required hosted release gates

1. **Verify:** all root regressions, contracts, complete installed-browser smoke
   inventory and desktop regressions with the selected hosted stack.
2. **Windows runtime:** actual native computer use, integrated Electron,
   packaged portable launch/exit and graceful shutdown of the exact artifact.
3. **Windows setup:** real install, repair, diagnostics, rollback,
   retained-manager corruption/repair, uninstall, setup/owner UI and restored
   registry/shortcut integrations; linked-folder transaction regressions also
   execute on Windows.
4. **Native monitor:** formatting, strict Clippy and real transport tests on
   Linux/Windows; Chromium and Firefox detector/rendered fixtures.
5. **Computer Tools:** preserved provenance, supported native tests, fragmented
   authorization/token frames and real status-only MCP handshakes.

The unified release validates clean committed source, exact versions and hashes,
production configuration and all nine required Windows setup acceptance routes.
It refuses to overwrite an immutable release, verifies its tag target, downloads
all published bytes and checks checksums, then synchronizes the live Wiki.
Independent closeout reconstructs the source Git tree from ZIP bytes and modes,
checks the shipped extension and artifact receipts, verifies the live asset set
and mirrors the release with raw-download hash verification.

## Target-machine and distribution acceptance

Owner Chrome/Edge/Opera GX/Firefox profile enrollment, physical speaker and
system-notification visibility, signed-in backup/restore/revocation, permanent
Firefox signing and Windows publisher signing remain explicit prerelease
boundaries. Operational scheduler jobs record committed audit freshness and
actual channel outcomes; they do not certify live ChatGPT health or successful
native task recovery. Repository policy denial remains a truthful **blocked**
outcome, not repaired service health.

See [RELEASING.md](RELEASING.md) for exact assembly and publication. The matching
completed workflow and attached receipts establish which final-source platform
and artifact gates actually executed.
