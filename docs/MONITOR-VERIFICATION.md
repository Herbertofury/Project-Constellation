# Project Constellation 0.23.0 — verification record

This source checkpoint records local candidate evidence. The matching published
release receipt and successful GitHub workflow are authoritative for the final
source SHA, executed Windows/browser acceptance and published bytes. A prepared
workflow is never recorded here as an executed pass.

## Regression evidence

| Area | Local evidence and scope |
| --- | --- |
| Root regressions | 50 existing npm test scripts retained; targeted changed alert, sensor, bridge, UI and release-artifact checks pass |
| Source/UI/message contracts | Existing 94 UI message contracts retained; no added content-script network or provider actions |
| Full browser smoke inventory | 40 real DOM workflows passed with the available Chromium headless shell; three installed-MV3 workflows failed for the documented local capability boundary |
| Native hub | 21 unit and 12 actual process/transport tests, including a 96-tab burst and resumed paused reader; strict Linux/Windows-GNU Clippy |
| Installer | 26 transaction tests, a digest vector test and seven payload-builder tests; four new recovery failures were reproduced against the prior engine before repair |
| Dashboard | Actual rendered desktop/narrow layouts; triage/search, stale-read recovery, unavailable-source retention, complete inventory, stable focus and action routing |
| Browser regression proof | The released baseline fails the new observation-retry, run-identity and failed-delivery deadline cases; the candidate passes |
| Stack migration | Official release evidence, causal repair records and exact validation versions in RELEASE-STACK-0.23.0.json |
| Optimization assessments | Fresh pinned shrink-anything, fast-anything and rust-anything assessments in isolation; see RELEASE-OPTIMIZATION-0.23.0.json |

The three local installed-worker failures are `drive_autosync_smoke.py`,
`extension_load_smoke.py` and `multitab_reliability_smoke.py`. Full Chromium
startup requires a Unix socket denied by this local execution environment;
the available headless shell supplies real DOM rendering but no installed MV3
service worker. No passing status is inferred from missing workers. Local
`npm run verify` is therefore not reported as fully green.

Raw local evidence is under `logs/release-0.23.0`, `logs/alerts-browser`,
`logs/setup-0.23`, `logs/optimization-0.23` and `logs/smoke`.
The renderer benchmark report in AGENT-MONITOR-PERFORMANCE-0.23.0.json uses complete identical datasets and forces full layout;
its source hashes and results are linked by the optimization receipt. Nothing
is hidden or capped to manufacture timings. Historical 0.22 evidence remains
in MONITOR-VERIFICATION-0.22.0.md and its published immutable receipts.

## Required hosted gates

1. **Verify:** root regressions/contracts, complete installed-browser smoke
   inventory and desktop regressions with the selected tool versions.
2. **Windows runtime:** actual native computer use, integrated Electron and
   launch/exit of the exact packaged portable application.
3. **Windows setup:** real install, repair, diagnostics, rollback,
   retained-manager corruption/repair, uninstall, setup/owner UI and restored
   registry/shortcut integrations. Fixtures are never publishable artifacts.
4. **Native monitor:** formatting, strict Clippy and native transport tests on
   Linux/Windows; Chromium and Firefox detector/rendered fixtures.
5. **Computer Tools:** unchanged source/history provenance, supported native
   tests and real status-only MCP handshakes.

The unified release checks clean committed source, exact versions and hashes,
production build metadata and all nine named Windows setup acceptance routes.
It refuses an existing immutable release, verifies its tag target before and
after publication, downloads all published bytes, verifies checksums and
synchronizes the live Wiki. Source snapshots remain truthful about evidence
obtained before the hosted release job; attached runtime receipts establish
which target-platform gates actually executed for the final SHA.

## Target-machine and distribution acceptance

The owner still needs to verify physical speakers, OS notification visibility,
Chrome/Edge/Opera GX/Firefox profile enrollment and signed-in account backup,
restore and revocation. Firefox's sensor is unsigned/temporary and Windows
executables lack publisher signing. These remain explicit prerelease boundaries.
The browser can report accepted audio/notification calls without proving sound
from a physical speaker or visibility through OS focus settings.

Run `npm run verify` from the root, the documented native checks and the desktop
commands. See RELEASING.md for exact artifact assembly and publication; use the
matching published receipt for the completed source commit and runtime evidence.
