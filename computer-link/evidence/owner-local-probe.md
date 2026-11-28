# Owner-controlled local bridge probe

This private incremental implementation builds on public owner lifecycle source a4579aed. Owner::launch_local_snapshot_probe starts the actual MCP bridge within the existing suspended-launch Job Object and binds its paired approval to that exact child's PID. Its fixed local protocol transcript initializes a Session and consumes one bounded owner-approved snapshot. The probe has no stdin command interface and writes no snapshot to stdout, a file, a socket or a provider. Only process completion status is available to the owner. It still requires a caller-supplied trusted executable and explicit consent callback; there is no GUI button or implicit approval.

Disconnect uses the existing revoke-first/kill-owned-tree path, retaining sticky fences on uncertain cleanup. No worker adoption, restart, handles inherited, host forwarding, endpoint, persistent grant, installer or owner-PC installation is added. Child process containment does not restrict its inherited OS token/environment/CWD; this is not a sandbox.

Verification: 36 Linux tests passed (30 library, 3 binary, 3 subprocess); Windows-target cargo check --tests passed. Five additional actual-child Windows tests are written but not executed yet: success/one approval, denial, revoked pending session cleanup, invalid snapshot no launch, and subprocess stdout/stderr snapshot non-disclosure. The existing disconnect test does not yet prove abrupt tray process termination, nor a live native owner dialog. The pending-child test blocks its synthetic approval callback until Disconnect revokes it; actual native approval UI remains untested.

Remaining release gates: Windows runtime tests, failure injection, native GUI integration, destination-aware consent for any downstream host, supported dot admission, actual Windows ChatGPT desktop/browser control, file edits/write/delete, signed delivery and real owner-machine installation. The Windows execution backend restriction remains in force. This probe is not the full Computer-Link product or a solution to that restriction.

## Windows results, exact source c3218c94a541372e07e6d36d037bc8271e32aaab

MCP run44684644813/job136115983164 passed all47 tests:30 library,3 binary,4 owner lifecycle,10 subprocess. Includes the actual contained bridge, denial, Disconnect while synthetic approval pending, and no snapshot stdout/stderr disclosure. Core run44684644816 passed all4 jobs. All3 runs report zero artifacts.

Broader setup run44684644839/job136115983234 FAILED installed `actual_inventory_preview_keep_and_paired_read`: `owned dialog remained open` at gui.rs83. Normal library23, GUI4, selection5, and10 consent repetitions passed before failure. Do not describe this commit as all-green or ready for installation.

Diagnosis found inventory fixture clicks immediately after enumerating dialog, without checking control readiness. GetDlgItem may return NULL; PostMessageW(NULL,BM_CLICK) succeeds by posting to calling thread, losing the click without test failure. This is a concrete test defect consistent with the observed timeout, not proof of its exact timing in the failed run. Strengthened inventory-only helper waits for nonnull PID-owned visible/enabled control, then clicks once; retains all original consent and snapshot assertions. Windows-target check --tests passes; runtime rerun pending. No increased existing response deadlines, skip, retry-to-pass, or product permission change.

## Revised run, exact source addecf7975fbe4919e2cce47445ce96a13a5ebdb

One revised source-only CI run44685032860/job136117218916 failed a DIFFERENT unchanged test: `actual_window_denial_grant_disconnect_exit_and_restart` at gui.rs28, assertion `!no.is_null()`. This directly captured a dialog whose No control did not yet exist. The corrected inventory test passed. Library23 passed; setup/install phase was not reached. Core run44685032882 passed. No retry performed after this result. Next change should consistently reuse bounded PID-owned/visible/enabled button readiness for remaining immediate GetDlgItem clicks, preserving all assertions, then independently review and test. Latest public source is not all-green or deployable.

## Consistent button readiness follow-up

Following explicit null-control evidence in run44685032860 and parent authorization, generalized readiness to all remaining immediate dialog clicks in gui.rs. Existing readiness loops retain their original end deadlines; existing response waits and semantic assertions remain. The late-Yes and peer-exit cases obtain a ready button BEFORE deliberate revocation/client exit, then click that same button afterward, preserving stale-consent coverage. No product code, permission, workflow, or installer change. Windows-target --tests check passes; one reviewed source-only CI run planned, stopping on any new failure.

## Final bounded follow-up result

Source218be665233c3cd4d2c62edb9217951dfa586776: Windows setup run44685428018/job136118492777 PASSED on its first run. Logs verified23 library (2 deliberately ignored subprocess fixtures),4 GUI,5 selection tests; all10 consent stress iterations; installed fixture4 GUI/5 selection; disposable setup exact bytes, existing-folder refusal and unrelated-data preservation. Artifacts array empty. Core run44685428071 all4 jobs passed. MCP code unchanged since the47-test passing run44684644813. Prior failed runs remain documented above. This is synthetic CI acceptance, not real user-PC installation or full Computer-Link functionality.

## Native owner UI integration candidate

Adds a real menu action using the sibling `computer-link-mcp-session.exe`, exact selected-source/byte-count and local-only destination disclosure, then a second exact child PID approval. The child remains Job-owned. A bounded process-handle wait reports completion through an internal channel; window messages are wakeups only. Disconnect/Exit revoke and terminate owned processes; generation fencing rejects late consent and stale results. No stdout forwarding, external endpoint, host registration, permission grant or real-owner installation.

Independent review identified forged completion-message parameters as a false-success risk; corrected to a private result channel with a regression test. The executable is NOT signature/hash verified or race-pinned: this requires a trusted/quiescent installation folder and is not a sandbox. Exact local GUI wording explains that trust boundary. The app does not auto-download the missing sibling. CI builds both reviewed sources into the same disposable directory. The new GUI test is explicitly ignored in generic owner-only tests because it requires this sibling; the dedicated MCP CI explicitly runs it with `--ignored`, no skip-to-pass.

Local validation: Windows MSVC target check including tests passes; 36 Linux MCP tests pass. New native GUI runtime cases are written but not yet executed: first/second denial, success, local recipient disclosure, pending-child Disconnect/late Yes, initial-consent Disconnect/late Yes and fabricated completion wakeups. Existing broader setup and owner tests must remain green. No claim of actual owner-PC or full browser/ChatGPT functionality.
