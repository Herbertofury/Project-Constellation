# Original-main preservation audit for 0.21.0

The verified 0.20.1 release-source closure was restored on top of original main
`f46d7bd7` (the 0.16.1 carrier). The release archive omitted four test commands and
some main-only runtime composition. This audit checks the active implementation,
not merely whether the older files still exist in the tree.

## Regressions found and corrected

| Original guarantee | Finding | 0.21.0 correction and evidence |
| --- | --- | --- |
| Never-connected or explicitly disconnected Drive installations must not start automatic sync | The newer `background-entry.js` omitted the original policy/guard imports | Load `drive-sync-policy.js` and `drive-sync-guard.js` before background listeners. `drive-sync-policy.test.mjs` now checks the manifest-selected entry. Both original Drive tests run in the normal test gate. |
| Sidebar provider projects and `/g/g-p-*` project routes are persisted with an acknowledgment | Only the retired tab supervisor performed this discovery. The newer generic capture could assign a current project route to Inbox | Move project discovery into the existing content capture lane. Send project-only records through canonical `ingestBatch`, index them, mark Drive dirty, and deduplicate only after successful persistence. Failed writes retain pending records with bounded backoff; an older acknowledgment cannot delete a newer project name. |
| A delivered message is not proof that a tab is supervised | The newer fallback could accept an empty `{ok:true}` and invent an idle row | Require a current Sentinel identity/version and a chat status. Generic fallback acknowledgments without chat state are rejected before the DOM fallback. The preserved contract executes both invalid and valid response cases. |
| Keep every original main test in the normal gate | The archive package omitted four commands | Restore `drive-sync-policy`, `drive-sync-guard`, `tab-supervisor-core`, and `reliability-supervisor-contract`. The latter checks the entire original 15-test inventory explicitly. |

## Superseded implementations and equivalent coverage

The original `tab-supervisor-background.js`, `tab-supervisor.js`, and
`approval-supervisor-background.js` are not activated alongside the newer runtime.
Doing so would duplicate recovery and restore a fixed one-minute watchdog plus
automatic permission scans. The compatibility `service-worker.js` now imports the
same canonical `background-entry.js`; the two retired repeating alarms are cleared
when that entry starts.

The newer guardian and Sentinel preserve all-tab enumeration, concurrent independent
probes, hot reinjection and current-version acknowledgment. Runnable hidden tabs are
included. Frozen pages are explicitly deferred without piling up queued probes;
discarded ChatGPT pages are restored through the existing guardian policy without
focusing them. Activation, load and unfreeze events trigger reconciliation, with an
adaptive one-shot fallback. The restored reliability contract runs the production
guardian function against hidden, frozen, discarded, failed and permission-held
tabs to prove these properties.

The old policy's unconditional recovery after two hours of quiet is deliberately
not connected to the active runtime. Current detection requires provider evidence;
ordinary quiet work does not become a fabricated failure. Original pure-policy
tests remain as historical compatibility fixtures, while `chat-guardian-core`,
`chat-guardian-runtime-static`, `attention-service`, and the restored live contract
cover the active behavior. The Rust hub's explicit `no_visible_progress` state is
delivered as a warning labeled **No visible progress**, without claiming failure.

Permission controls remain for the user to review. The legacy content click
executor is removed; stored Always Allow preferences cannot reactivate it. Manual
scan messages force both approval options false. Existing explicit paused-response
resume, continuation draft checks, hydration wait and send dedup remain covered.
Work Rescue uses committed IndexedDB acknowledgments and preserves newer pending
assistant revisions after a failed acknowledgment.

Build closure validation now copies the full runtime source directory and checks
actual packaged relative imports and manifest references. This supersedes the
original hand-maintained build module list without losing its missing-module gate.

## Related startup correction

Persisted monitor sessions are marked offline at worker restart until fresh evidence
arrives. Firefox's minimal sensor uses `PC_MONITOR_RESCAN`, rather than the full
Chromium Sentinel protocol; startup now sends that one-shot fallback when needed.
The adapter test verifies that current full sensors, frozen pages and closed pages
do not receive redundant fallback requests.

## Verification scope

All restored original tests and the added production-function regression cases pass
locally. The full Node test gate, UI/message contracts and source validation pass.
These deterministic tests do not claim authenticated Drive round-trip or physical
speaker playback. An isolated Chromium 158 executable subsequently became available:
the permission DOM smoke passed four permission variants with zero clicks and a
preserved draft; the minimal sensor smoke passed 14 observations with zero provider
requests, zero clicks, a preserved draft and no page errors. Firefox remains a
separate acceptance target; the CI sensor smoke defaults to both browsers. Local
Chromium-only runs explicitly select that scope.

## Final alert delivery edge-case audit

Additional regression tests caught and corrected these ways an alert could remain
silent or misleading:

- An acknowledged incident from one run no longer silences the same kind of issue
  in a later run. Incidents retain a run identity, and the full Sentinel emits an
  opaque current-user-turn identity without exporting prompt text.
- A first incident during a mute receives a one-shot wake deadline even with repeat
  reminders disabled. Re-enabling automatic alerts or a previously disabled delivery
  channel announces still-current, previously suppressed incidents once.
- Explicit snooze wakeups work even when the automatic reminder cap is zero.
- Visible permission evidence outranks stale running/completion labels; suspension
  and closure preserve unresolved evidence without claiming provider recovery.
- Failed audio no longer suppresses the next incident through the short sound
  grouping window. Failure receipts include a timestamp so an older successful test
  cannot mask a newer delivery error.
- An offscreen document closed during transport is recreated once. A generic
  `{ok:true}` response cannot claim sound: playback must explicitly acknowledge
  `started:true`. Missing or blocked WebAudio is reported as a failure. No silent
  tone loop or recurring keepalive is added.
- OS notification cleanup errors cannot discard the user's durable acknowledgment.
- **Test alert** returns explicit diagnostic mode and a settings notice explaining
  that it tests both channels independently of automatic mute/channel switches. A
  zero volume or failed channel remains a failed test; browser acceptance does not
  prove that the user physically heard a speaker.

The shared audio helper is also exercised for zero volume, suspended/closed contexts,
bounded tone schedules and oscillator/gain cleanup. Browser fixtures still verify
DOM behavior separately from physical audio output.


## Shared cross-browser delivery policy

A follower dashboard must control the browser that actually emits shared alerts.
The hub now persists the eight supported alert preferences, initializes them
once from the first valid profile, merges subsequent explicit changes, and
broadcasts the authoritative policy. Invalid fields or values are rejected;
failed persistence rolls the mutation back. Simultaneous initializers cannot
overwrite the first accepted policy.

Browser synchronization pauses delivery only for a real policy/owner/suppression
transition. It applies policy, observations and matching acknowledgments/snoozes
before enabling the chosen output owner. Unchanged snapshots leave existing
alarm deadlines intact. Native snoozes are mirrored with absolute timestamps;
a sub-minute remaining duration is never extended to a fresh minute. Due
snoozes are flushed once on ownership transfer, and persisted mirror tokens
prevent expired state from replaying after restart. Document and run identities
must match before applying shared suppression.

Independent checks cover follower mute, policy persistence across ownership
transfer, exact 500ms and 23.5s deadlines, frequent snapshots at expiration,
acknowledged imports, stale runs, and marking remote sources unavailable before
standalone alerts resume. The dashboard displays authoritative hub preferences
while connected and exposes an Automatic alerts switch to recover explicitly
from disabled delivery.
