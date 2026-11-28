# Private setup recipe, not delivered installer

Inno Setup is preinstalled on official GitHub Windows2025 runner inventory (currently6.7.1). This recipe uses that official installed compiler, no third-party binary fetch, privileges lowest and no elevation/registry/service/autostart/network/extension steps. New folder only, no in-place upgrade. Optional launch unchecked; no owner installation authorized by tests. It packages existing reviewed runtime, not new access capability.

Proposed disposable Windows acceptance: stage exact Cargo-tested debug owner/client, compile setup, run silent setup into unique RUNNER_TEMP/new folder, verify installed binary hashes, create unrelated synthetic user-data marker, attempt same-folder reinstall and require refusal/marker unchanged, invoke generated uninstaller on disposable folder, verify marker survives and installed EXEs removed. No artifact upload until exact authorized packaging scope; no connection/installer readiness before actual tests.

Official sources: https://github.com/actions/runner-images/blob/main/images/windows/Windows2025-Readme.md ; https://jrsoftware.org/ishelp/topic_setup_privilegesrequired.htm ; https://jrsoftware.org/ishelp/topic_setup_createuninstallregkey.htm . Temporary installer files can live in OS temp during setup; portable installed runtime remains folder-local. Signing, exact installed GUI acceptance, upgrades/rollback, accessibility and direct-dot admission remain gates.

Review boundaries: x64compatible payload gate; ISCC engine banner must match reviewed6.7.1 (fixed verified version logged, refuses drift); executable resource version is diagnostic only. The pre-install existence check is not atomic against hostile path/reparse mutations. Lowest does not demote an already elevated caller. Uninstall removes installed paths even if a user replaced those bytes; preservation claim only concerns differently named unrelated data. Refused reinstall now rechecks both installed program hashes. Recipe does not strip Inno embedded notices; no binary redistribution yet. Official compiler license: https://jrsoftware.org/files/is/license.txt .

Observed first actual CI44658809522:11 application tests passed, then executable FileVersion0.0.0.0 caused intended refusal before compilation/install. Official pinned is-6_7_1 ISCC.dpr does not support newer --version and prints actual ISDllGetVersion engine identity during compilation. Updated gate consumes compiler output without collecting the whole transcript, suppresses raw paths/licensee text, and applies a cumulative1,048,576 UTF16-character gate (not a byte or hard memory bound; PowerShell materializes individual lines) and requires exact engine6.7.1 before ever executing generated setup, preserving version refusal rather than allowing0.0.0.0. Source: https://github.com/jrsoftware/issrc/blob/is-6_7_1/Projects/ISCC.dpr . No successful installer test yet.

## Verified baseline and installed-runtime extension
The source-only setup baseline at `7bcc5c8601b4dfa5775ac00607568f83018e9797` passed actual disposable Windows CI run 44659552763: 8 unit + 3 GUI tests, compiler identity 6.7.1, setup installation with exact EXE hashes, same-folder refusal, uninstall and unrelated-marker preservation. This supersedes the earlier pending-acceptance sentence above. No artifact was uploaded.

The independently repaired native selection test passed on source `7f02098b49adbab23ea3b4f219f0055992e02e5f` in run 44661771655. Its previous failure was a test assumption: the sole informational message-box button on this runner uses control ID 2, not assumed ID 1. The test now finds exactly one owned visible/enabled informational button, requires ID 1 or 2, and retains all permission, cancellation and unchanged-file checks.

The next test-only setup delta runs the full selection acceptance before packaging, then repeats GUI, local pairing, inventory and file-selection/cancellation/Exit workflows against the actually installed owner/client EXEs with installed-folder working directories. Only test code reads `COMPUTER_LINK_TEST_INSTALLED_DIR`; missing installed files fail rather than fall back to build-tree files. The script restores that environment value and rechecks both binary hashes afterward. This extension is not Windows-executed yet. It changes no production access, installer recipe, remote endpoint, autostart, artifact distribution or owner's PC. Pixel/tray-pointer/accessibility QA, signed distribution and direct dot admission remain unverified.

## Installed-runtime result
Source `29463903f837ebc54303d69564e7b5bb452fc72a` passed Windows run https://github.com/Herbertofury/Computer-Link/actions/runs/44662851103. Pre-install 8 unit + 3 GUI + 1 selection tests passed; following actual setup, 3 GUI + 1 selection tests passed again using installed executables and installed working directories. Both program hashes remained unchanged; reinstall refusal and uninstall preservation passed. Four Python core matrix jobs passed in run 44662851047. Artifacts API confirmed zero uploads. Inventory paired-read coverage uses the test-process library client, while the separately launched local-client EXE is exercised for status/denial/stale-consent cases. No speedup, signing, rendered/pointer/accessibility, owner-PC or direct-dot claim. This supersedes the prior extension-pending note; historical failures are retained.

## Packaged snapshot-read coverage extension
The GUI inventory acceptance now additionally obtains a fresh explicit one-use read grant and owner approval for the actual packaged `local-client` executable, checks its intentionally redacted byte-count response against the reviewed inventory size, then verifies a second read using the consumed pipe fails. The preceding library-client exact-byte comparison remains unchanged. This does not assert the CLI exposes bytes, nor change runtime or access. Windows-target Rust metadata compilation passed using the existing cached dependency metadata; fresh Cargo check was blocked by absent offline serde index in the recovered environment. Actual Windows CI is pending. No artifacts or owner-PC effects.

Packaged-read extension CI at `fb03222aa1beb1394e4067b842f1fa442c996fe1` (run44664887792) failed BEFORE setup in the existing separate-client grant test: title remained disconnected after clicking Yes. The extended inventory case passed, as did 8 unit tests and other GUI case. Thus new CLI read acceptance is verified only pre-install; installed rerun was not reached. Potential dialog-control readiness race needs diagnosis, not assertion removal; no retry made. Filtered failure retained in evidence/windows-packaged-read-acceptance.txt.

### Bounded consent reliability sample
The source-only workflow repeats the existing separate-client consent test ten times,
each with a fresh owner process and all five denial/allow/wrong-operation/late-consent/
peer-exit cases. It stops on the first failure, retains diagnostics in the CI log and
never retries a failed iteration. Existing assertions and five-second deadlines are
unchanged. This is a serial sample on one disposable runner, not concurrency, native
click accessibility, root-cause proof, or a statistical reliability guarantee. That historical
job used a ten-minute timeout and uploaded no artifacts; the integrated candidate
below has a fifteen-minute bound.

## Integrated installer candidate (2026-11-20, pending Windows acceptance)
The old two-executable payload omitted `computer-link-mcp-session.exe`, so the
installed owner could not run its sibling-dependent status session or snapshot
probe. The candidate now stages all three executables from an explicit shared
absolute `CARGO_TARGET_DIR`, packages the MCP sibling, and verifies all three
hashes after install, installed acceptance, and refused reinstall. Uninstall must
remove all three while preserving an unrelated synthetic user-data file.

Source-only isolated branch `review/windows-integrated-setup` builds/tests local
export, MCP and owner, then compiles and installs into a disposable runner folder.
Installed acceptance repeats GUI + selection (including exact-preview new-file
export) and the explicitly ignored probe/status tests, with no build-tree fallback.
The script restores its test-only routing variable even on test failure. The
notice now describes local create-new export and post-admission cancellation
limits, replacing obsolete no-write and failed-file-dialog statements.

No owner install, distributed installer, signing, remote endpoint, browser/ChatGPT
control or external grant is added. Native Windows execution of this updated
installer is pending; Linux/static checks are not a substitute. Historical evidence
above remains historical, not acceptance of this candidate.
