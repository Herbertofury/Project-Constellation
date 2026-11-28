# Project Constellation 0.25.0 — verification record

This checkpoint records executed local candidate evidence on 2026-11-28. The
candidate starts from released v0.24.0 commit
`fc9a2322c6fb521f09f056d6f8208d6431fdfc07`, tree
`ad1e2f3fbe1169eb3187acda1c5a47852dcf5d1a`. Current candidate bytes are bound by
the source hashes and receipts below; the baseline HEAD is not mislabeled as a
new release commit. Matching hosted workflows, clean committed source and the
published artifact receipts must establish final-source acceptance.

## Executed local results

| Area | Actual evidence and scope |
| --- | --- |
| Root regressions | All **52 npm test command entries pass**, including the existing service, sensor, bridge, dashboard, generated-build and scheduler suites and the added local-agent suite |
| Source/UI/message contracts | `validate.mjs` and `ui-contract.mjs` pass; `message-contract.mjs` passes all **94 UI message types** |
| Complete browser smoke run | **39 of 43 workflows pass**; four failures are retained: three installed-MV3 capability failures and a missing Firefox executable |
| Separate minimal sensor check | The unchanged fixture passes its supported Chromium-only mode: **26 observed events**, zero page errors, zero provider requests, zero permission clicks and preserved draft text; this does not replace Firefox acceptance |
| Agent Monitor | Actual production logic regressions and real Chromium rendered fixtures pass, including bulk triage, uncertain replies, profile-save races, delivery identity, complete inventory, DOM reuse, focus and narrow-window controls |
| Desktop | `npm run check` and `npm test` pass: **22 task/search tests + 81 runtime tests**, static/package/relay/device-agent checks and the real Chromium → desktop bridge → disk round trip; the Windows-only computer-use smoke explicitly skips locally |
| Native hub | **28 Linux unit tests + 18 real child-process/transport tests** pass on final 0.25.0 inputs; formatting and strict Linux/Windows-GNU Clippy pass, with Windows-GNU results limited to compilation/static analysis |
| Windows Setup engine | **31 Linux transaction tests + 1 digest unit** pass after the version sweep; link/ancestor recovery and external-target preservation regressions are retained |
| Setup builder | All **7 Python builder tests** pass |
| Optional local recovery agent | All **9 Node-reported tests** pass, including six top-level tests and three positive-retry subtests; Windows PowerShell launcher/copy and task lifecycle execution remain hosted gates |
| Generated account configuration | Existing production/development/unprovisioned build regressions pass and exercise actual generated GitHub accessor behavior and Google manifest configuration; no signed-in account round trip is inferred |

The local run uses Node **24.22.3**, Python **3.12.14**, Playwright Python
**1.62.0**, Chromium headless shell **158.0.8127.0** and cached Rust **1.99.0**.
These supplement, rather than replace, the selected hosted stack in
[RELEASE-STACK-0.25.0.json](RELEASE-STACK-0.25.0.json): Node 26.13.1, Rust
1.100.1, Playwright Python 1.65.2, the optional recovery runtime's Node Playwright
1.65.1 and Electron 45.5.0.

### Complete smoke result and separate sensor evidence

The full `npm run verify` rerun passed all 52 root command entries, validation,
94 message contracts and the development build, then ran **every one of the 43
smoke workflows**. It finished with `AggregateError: 4/43 smoke workflows failed`
and a failing overall result. The failures were not removed, converted into
skips or relabeled as a successful full run.

| Failed workflow | Observed local result |
| --- | --- |
| `browser_monitor_sensor_smoke.py` | Chromium completed before Firefox launch failed because Playwright's `firefox-1538/firefox/firefox` executable was absent |
| `drive_autosync_smoke.py` | Installed extension popup navigation failed with `net::ERR_ABORTED` |
| `extension_load_smoke.py` | No installed MV3 service worker appeared within the fixture's 15-second deadline |
| `multitab_reliability_smoke.py` | Installed extension popup navigation failed with `net::ERR_ABORTED` |

The supplied headless shell does not provide the installed extension
pages/service-worker acceptance required by the three MV3 workflows. No cached
Firefox executable or archive was found in the available scratch/runtime
locations. The default sensor fixture still requires both Chromium and Firefox.
Its separate unchanged invocation with
`PROJECT_CONSTELLATION_TEST_BROWSERS=chromium` passed all assertions; the result
is scoped to Chromium and does not turn the full inventory into a 40/43 result.
Hosted Chromium/Firefox and installed-extension lanes remain required.

The raw complete-run log is `logs/release-0.25.0/full-verify.log`; the four
per-workflow logs remain under `logs/smoke`. Separate sensor proof is
`logs/release-0.25.0/browser/browser-monitor-sensor-chromium.log`. Sensor lifecycle
coverage dispatches pagehide/pageshow events in the real renderer; it does not
claim a genuine browser-cache navigation cycle or an owner browser profile.

### Initial integration failure

The first full verification attempt stopped in the existing
`live-state-policy.test.mjs` assertion because the new guarded Pulse condition
omitted the spaces expected by its source-contract regex. The production
condition's spacing was restored. Both current-evidence checks and the original
managed-group mismatch guard remain present; the assertion was not changed.
All 52 root test command entries then passed, and the complete verification
rerun above followed.

`logs/release-0.25.0/full-verify-integration-formatting-failure.log` preserves the
failure. `browser/INTEGRATION-FORMATTING-PROOF.json` under the same release log
directory proves that reversing that single whitespace-only change reconstructs
the previously accepted full-file SHA256 exactly. Independent review accepted
the scoped change while retaining the original probe/test bindings. Earlier
renderer evidence retains its original source hash; current worker source is
`d2107d244ec682b90e5085d330b5c83e7b83af473df9615848d7bd1cfd9afd6b`.

## What the behavioral regressions establish

### Alerts, observations and lifecycle

Failed reminder persistence restores the consumed reminder count and preserves
the due work. Recovery uses the bounded 2/10/30-second schedule; an exhausted
storage budget is not rearmed by routine ownership refresh or transfer. Startup
and scoped-close retries flush dirty state before returning success.

Audio grouping uses the actual sound claim time. A lost playback reply or a
partially scheduled tone group remains **interrupted/uncertain**, retains its
claim and is not replayed automatically. Partial WebAudio setup releases the
whole group. Notification/audio operations have finite deadlines; late
notification creates or clears reconcile the latest intent for the stable ID
without repeating sound. An accepted API call is not physical speaker or system
notification proof.

The worker preserves provider observation time through live pushes, tab reads,
durable acknowledgement, legacy caches and Pulse. Rejected or older observations
cannot clear a newer permission request. Newly accepted evidence wins across
session-storage reads, metadata enrichment and badge awaits. Legacy timestamp-less
reads use request-start time; the same rule now applies to manual native-monitor
refresh, and malformed refresh timestamps request a rescan.

Weak evidence cannot supersede a confirmed incident or use an untrusted run
label to reset its acknowledgement. Stronger same-state evidence promotes a
weak episode in place even when its confirmed run label differs. The native
bridge represents missing reliable evidence as suspension under protocol one.
No provider draft mutation, automatic permission decision or new provider
request is introduced.

### Dashboard actions and profile edits

Bulk actions retain exact source/incident/document/run context and send at most
four existing per-incident requests concurrently. Stop, timeout, rejected
transport and missing/malformed receipts stop unsent work while retaining
unconfirmed selection. An explicit boolean `ok:false` remains a confirmed
backend refusal. These controls acknowledge or snooze Constellation incidents;
they do not approve provider permission requests.

Profile drafts survive background refresh and edits made while saving. A failed
follow-up read cannot replace a successful save with stale configuration, and a
pre-save GET cannot overwrite the accepted normalized response. Delivery details
require one unambiguous current context and matching local ledger. Complete
matching sessions and incidents remain rendered; retained controls read their
current row data, including after reordering and source disconnection.

### Native closure durability

Real broker reproductions show that the released v0.24.0 binary can recreate a
removed session, including a closure that preceded its first observation. The
candidate persists private closure ordering before ACK and rejects those stale
observations after restart. Failed writes roll back visible and private state;
exact retries add no rewrite or duplicate broadcast. Contextual closure replay
precedes the latest live per-tab evidence after reconnect, and persistent native
write failures exhaust the finite reconnect budget.

Protocol-one `remove` accepts a validated optional source timestamp. New sensors
send it so delayed removal cannot close a newer accepted document; legacy
callers retain the prior receive-time default. Automatic retirement preserves
the last accepted source watermark rather than inventing newer provider time.
Private closure records share the existing durable-state byte budget and expire
only when the old evidence they reject falls outside the accepted 24-hour range.
Storage exhaustion refuses and rolls back a request instead of discarding an
unexpired ordering record. Public transport/history limits are not increased.

### Setup and optional local recovery

Managed-directory ancestor checks reject linked data/monitor or versions paths
before staging, permission or registration changes. Uninstall preserves the
first linked directory and its target while completing owned cleanup, avoiding
a permanent retry trap. Tests retain exact external bytes and registration
ownership.

The local recovery agent accepts valid BOM-prefixed JSON, bounds heartbeat
waiting, and durably claims an attempt before Chrome or a rescue worker can act.
Crash, failed-save and future-time cases retain an honest cooldown state;
fresh heartbeat, explicit force and elapsed intervals still permit recovery.
The existing lock is not promoted to an exactly-once guarantee.

The Windows launcher preserves runtime variables, literal paths and the actual
Node exit result. Its optional source directory validates all expected payload
files before copying, so the hosted test can install the exact checkout rather
than an unrelated `main` payload. The Windows PowerShell 5.1 copy/launcher and
disposable install/register/hash/uninstall branches are independently reviewed
but were not executed locally.

## Measured performance and preservation

### Complete dashboard workloads

[AGENT-MONITOR-PERFORMANCE-0.25.0.json](AGENT-MONITOR-PERFORMANCE-0.25.0.json)
records 11 alternating baseline/candidate fresh-page samples per size in the
same isolated Chromium renderer. Every session and one incident per two sessions
is present after every sample. The arrows below mean **v0.24.0 → v0.25.0**;
each timing cell gives **p50 / p95 in milliseconds**.

| Sessions / incidents | Complete cold render | Unchanged refresh | Two-row changed refresh |
| --- | --- | --- | --- |
| 100 / 50 | 30.4 / 40.2 → 32.3 / 48.7 | 3.2 / 7.1 → 4.0 / 5.4 | 3.2 / 5.0 → 3.2 / 4.9 |
| 1,000 / 500 | 138.8 / 238.5 → 194.8 / 237.7 | 9.0 / 15.4 → 12.6 / 18.4 | 13.6 / 19.4 → 11.6 / 17.7 |
| 2,000 / 1,000 | 331.2 / 426.3 → 335.3 / 462.8 | 19.3 / 24.8 → 18.0 / 25.9 | 27.7 / 38.3 → 22.6 / 36.9 |

The 1,000-session cold median increased by **56.0 ms**; that cost is retained in
the report rather than dismissed as a verified speedup. At 2,000 sessions,
changed-refresh medians are 27.7 → 22.6 ms while cold medians are 331.2 → 335.3 ms.
The candidate adds incident selection, bounded action handling, draft protection
and delivery evidence. Full-model reuse and stable-order reconciliation reduce
repeated equivalent work, but this mixed comparison is not a zero-cost or
blanket performance-win claim. At 11 samples the nearest-rank p95 and p99 both
select the maximum; full distributions remain in the receipt.

| Sessions / incidents | Median post-GC page JavaScript heap, bytes | Candidate increase, bytes |
| --- | --- | --- |
| 100 / 50 | 1,119,036 → 1,202,000 | +82,964 |
| 1,000 / 500 | 2,550,828 → 2,697,780 | +146,952 |
| 2,000 / 1,000 | 4,055,856 → 4,210,676 | +154,820 |

Cold includes evaluation, complete cloned status replies, DOM construction and
forced whole-document layout in a fresh page inside an already running browser.
It excludes browser process startup and physical disk-cache cold start. Heap is
CDP JavaScript heap after explicit collection, not process RSS, GPU memory or
peak memory. These synthetic complete-data fixtures use a real renderer and
preserve all rows; the 1,000/2,000-session stress cases exceed native capacity
without changing it. There is no pagination, culling, content-visibility
suppression, prewarming or deferred mandatory work.

### Native durable acknowledgement workloads

[NATIVE-ACK-PERFORMANCE-0.25.0.json](NATIVE-ACK-PERFORMANCE-0.25.0.json)
records 20 runs: five alternating pairs for each of two scenarios. Each run
preserves 96 live sessions and 192 incidents, processes 384 advancing evidence
observations, then 384 exact retries. Both versions durably persist live ordering;
the second candidate scenario additionally retains 96 closure fences.

| Scenario | Median of per-run ACK p50, ms | Median complete 384 ACKs, ms | Median of per-run exact-retry p50, ms |
| --- | --- | --- | --- |
| 96 active sessions | 1.228 → 1.237 | 513.421 → 520.310 | 0.132 → 0.184 |
| 96 active + 96 retired sessions | 1.272 → 1.448 | 513.517 → 610.691 | 0.191 → 0.183 |

Both versions retain the complete active workload, with zero duplicate
broadcasts and zero exact-retry rewrites. The candidate's 96 retired-session
fences add **18,900 saved bytes** and additional durable-work cost; the baseline
does not provide equivalent retired-session replay protection. Values above are
rounded to three decimals; full per-run tails, maxima and binary/source hashes
remain in the report. These are Linux release-build measurements with fresh
processes and ordinary OS caches. They do not establish Windows disk latency,
physical cold-cache behavior, peak RSS or a speedup.

The final source-clock corrections were measured again. Earlier exploratory
source, binary and receipts remain under `logs/release-0.25.0/native/pre-clock-fix`
and are not used as final-source measurements.

## Source binding and independent review

The final dashboard JS/HTML/CSS hashes match the dashboard measurement receipt.
All eight recorded native implementation hashes match the native measurement
receipt. The following current production files anchor the browser, native,
setup and optional local-agent evidence; metadata-only and later formatting
differences are explained by the corresponding receipts rather than concealed.

| Current production file | SHA256 |
| --- | --- |
| `extension/background.js` | `d2107d244ec682b90e5085d330b5c83e7b83af473df9615848d7bd1cfd9afd6b` |
| `extension/src/attention-service.js` | `f341797c58c34ee54524c775d33539fa747757f12d64636a70a40314cc280675` |
| `extension/src/attention-background.js` | `073aa9e8c026d1916916b5c2341feb721864341d7dd1a492fb8ec435361c2842` |
| `extension/src/attention-audio.js` | `603963af2f6c530476eca9dbda9a188258fd0768bf274394c3c257cd4318be61` |
| `extension/src/native-monitor-bridge.js` | `f8f4cbbde3fb4a071f77f6a12a6cf0eec7218662035a315de590a78856e07eae` |
| `extension/agent-monitor.js` | `47f24a8891c3391faf0cde203b86ab616943a27958de3f095ec434e37e93f27b` |
| `extension/agent-monitor.html` | `21b7f20e72aad583f44e10084385f2a5d3cd912103f65c1c3fcd76cb09e23f20` |
| `extension/agent-monitor.css` | `011a16f5f4131c0ca3b6cc881cb10b1b303b757b7db539c1bb51885976e6b5d1` |
| `native/constellation-monitor/src/state.rs` | `c49d3b9056397858b672c14f4453d761be389dcd595f85ae9cae459a1895f23a` |
| `native/constellation-monitor/src/broker.rs` | `b63a05166cd1e0be65f66533c508b44c058faec78f68c2d8df1ae39c717235d2` |
| `native/constellation-setup/src/engine.rs` | `cc5c87f6b214b0baf7b94440d75555588e2639ccb1e32449d06681c7b4366805` |
| `tools/chatgpt-ui-rescue/local-agent.mjs` | `4940fb764858f3b3e9b32fee515f6d15ce09565722a436fd0643d27f2960f9e6` |
| `tools/chatgpt-ui-rescue/install-local-agent.ps1` | `aab862c71624fea4e7f712d0f4e35313ea5e281ddc55cacd8868f63087dd4553` |

Hosted preparation corrected the portable OAuth checklist validator and the
installer's missing-payload preflight. The launcher regression also now reads
the actual global native-process exit status. The
[executed recovery run for PR head `d7523d8`](https://github.com/Herbertofury/Project-Constellation/actions/runs/46143450799)
passed Windows PowerShell 5.1 literal-path and exit-7/exit-0 checks, rejection
of incomplete payloads, Linux/Windows CDP, and disposable installation/removal with
all three installed payload hashes verified. Earlier local receipts retain
their original source hashes. Final release acceptance still requires a
successful unified workflow and matching published receipts for the release
commit.

Raw source-bound reviews and failure reproductions are retained under
`logs/release-0.25.0/browser`, `logs/release-0.25.0/native` and
`logs/release-0.25.0/setup`. In particular:

- `browser/BROWSER-VERIFICATION.json` binds the browser implementation, original renderer capture, final 52-command integration pass and independently accepted formatting proof.
- `browser/INDEPENDENT-ROOT-UI-REVIEW.json` records the reproduced bulk-reply, profile-save and delivery-attribution failures and their passing final probes.
- `browser/INDEPENDENT-BRIDGE-REVIEW.json` binds the final bridge suite and actual-service manual-refresh reproduction.
- `native/NATIVE-RELIABILITY-EVIDENCE.json` binds the final 28/18 native tests, strict checks and real broker reproduction.
- `setup/SETUP-RELIABILITY-REVIEW.json` retains the initial setup/local-agent probe and test inputs; `setup/LOCAL-AGENT-SOURCE-BINDING-REVIEW.json` separately binds the later exact-checkout installer/workflow repair and its pending Windows execution.

The current stack selection is recorded in
[RELEASE-STACK-0.25.0.json](RELEASE-STACK-0.25.0.json). Final mandatory optimizer
assessment and publication must bind the complete accepted source snapshot;
this document does not assert that a prepared assessment or workflow has run.
The changed native paths remain Rust, and no destructive content/feature cut,
artificial work cap or speculative runtime replacement is used to manufacture
an optimization claim.

## Required hosted and target-machine acceptance

At this local checkpoint, the following acceptance is **pending**:

1. **Verify:** the selected hosted Node/Playwright stack, all root regressions and contracts, all 43 smoke workflows including installed MV3, and the complete desktop chain.
2. **Browser/native matrix:** actual Chromium and Firefox sensor/rendered checks, final-source Rust 1.100.1 tests, and real Windows transport/ACL/process lifecycle regressions.
3. **Windows runtime:** native Computer Tools use, integrated Electron, exact packaged portable launch/exit and graceful shutdown; local Windows-GNU compilation is not this proof.
4. **Windows Setup:** all required install, repair, diagnostics, rollback, retained-manager corruption/repair, uninstall, setup/owner UI and restored registry/shortcut routes, including linked-path transaction cases.
5. **Optional local recovery:** Linux/Windows synthetic CDP compatibility, Windows PowerShell 5.1 literal-path/exit tests and disposable exact-checkout install/register/hash/uninstall.
6. **Release assembly:** clean committed source, exact tag/tree/version and asset checksums, production OAuth behavior and stable extension identity, all required runtime/setup receipts, published-byte readback, live Wiki synchronization and the verified archive mirror.

Owner Chrome/Edge/Opera GX/Firefox profile enrollment, physical speaker and
system-notification visibility, signed-in backup/restore/revocation, permanent
Firefox signing and Windows publisher signing remain explicit target-machine
and distribution boundaries. Synthetic recovery tests do not certify live
ChatGPT task health or owner-account recovery. Direct permission decisions remain
with the owner.

See [RELEASING.md](RELEASING.md) for final assembly and publication gates. The
prior record is preserved byte-for-byte from the released HEAD in
[MONITOR-VERIFICATION-0.24.0.md](MONITOR-VERIFICATION-0.24.0.md), SHA256
`ffddb8e90864866c8c623dddc520ecf5a63872caf32cf9f170b7963132deab86`.
