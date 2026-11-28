# Changelog

## 0.25.0 — Bulk Triage and Durable Closure Recovery

- Select visible incidents for acknowledgement or a 5/10/30/60-minute snooze; keep per-item results, bounded concurrency, stop controls, context invalidation and explicit unconfirmed-action deadlines.
- Preserve profile drafts during live updates and failed or overlapping saves; search full recorded chat URLs and show exact matching per-incident delivery evidence.
- Reuse the complete derived dashboard model within a snapshot, preserve all rendered rows and update existing mute/snooze deadlines without polling.
- Retain source timestamps and authority through delayed full-extension reads, pushes and presentation work; weak run labels cannot manufacture a new confirmed incident.
- Bound browser delivery API waits, group sounds by their actual attempt time, retain uncertain playback as interrupted and recover reminder persistence without unbounded rearming.
- Persist private native closure ordering through restart and client/session retirement; reconcile offline closed documents on reconnect and keep persistence recovery retries bounded.
- Reject linked managed data/runtime/version paths before installer staging or permission changes; preserve external targets while completing ownership-aware uninstall.
- Read PowerShell UTF-8 BOM configuration, quote launcher paths literally, propagate runtime exit codes, bound heartbeat reads and persist recovery attempt cooldowns before side effects.
- Add actual Windows PowerShell 5.1 launcher acceptance to the hosted setup gate; require the local recovery Linux/Windows CDP and disposable-task fixtures before release, with current Node/Playwright and Actions versions.
- Retain every existing release/runtime family and refresh exact-source optimization, stack, Wiki and closeout evidence.

## 0.24.0 — Durable Observations and Reliable Recovery

- Keep failed browser-storage writes eligible for retry; do not acknowledge unsaved in-memory observations.
- Reconcile startup responses with their actual run/document identity and observation time; scope delayed navigation and close events to their originating context.
- Recover interrupted notification delivery with stable IDs, retry audio that had not started, and report already-claimed audio as interrupted without replaying or claiming success.
- Bound sensor acknowledgement waits and pause observers while a document is in the back/forward cache.
- Persist native ordering watermarks before acknowledging them, including accepted clock skew across restart; reject stale closure and persistence failures without losing newer incidents.
- Read complete Windows byte-pipe authorization/token frames across partial reads while preserving deadlines, cancellation, revocation and peer checks.
- Reject linked active sensor folders before setup mutations and recover previously committed linked backups without touching external target files or trapping later repair/uninstall.
- Repair the external scheduler's undeclared dispatch input and incident-after-PR failure; retain blocked channel evidence without claiming live task recovery.
- Share strict audit validation with the independent hourly monitor, read current default-branch evidence, reuse existing issues, and bound obsolete/failed workflow retries.
- Fix production GitHub OAuth injection replacing its own placeholder-rejection guard; execute the generated accessor in regression and release-package verification.
- Retain current verified stable dependencies, update the two changed operational workflows to an exact current github-script commit, and preserve the full release/runtime verification contract.

## 0.23.0 — Reliable Alerts and Resilient Monitoring

- Retry failed sound/notification channels independently at bounded deadlines, preserving successful delivery, acknowledgement, snooze, mute, ownership and restart state.
- Require observation acknowledgements, retry transient persistence failures, and keep run identity stable when earlier conversation history or hidden hydration nodes mount.
- Reject delayed previous-document observations; advance ordering watermarks without broadcasting duplicate observations or incorrectly clearing newer incidents.
- Coalesce pending hub snapshots while retaining direct replies and focus commands, recover hung native ports, and retry failed remote imports.
- Keep disconnected chats and incidents visible as unavailable; fail incomplete/timed-out status reads honestly and disable stale actions.
- Add pending/acknowledged/snoozed/unavailable inbox views and shared search. Reconcile local/native history one-to-one and retain all rendered rows with incremental DOM updates and stable keyboard focus.
- Recover failed upgrades despite later browser-folder edits, verify/repair the retained setup manager after rollback, and flag pending recovery journals as unhealthy.
- Upgrade Electron to 45.5.0, electron-builder to 26.18.1, release Node to 26.13.1, release Rust to 1.100.1 and Playwright to 1.65.2; align the native hub version with the product.
- Require diagnostics and retained-manager repair in exact-source Windows release acceptance. Keep current source, live Wiki, artifacts, checksums and receipts together.


## 0.22.0 — Windows Setup and Computer Tools

- Add a self-contained Rust Windows installer with current-user registration, native setup controls, repair, rollback, recovery journals and ownership-aware uninstall.
- Stop the shared native hub after the last browser disconnects; reopen on demand, including browsers left in background-app mode. Protect replacement connections from delayed old-reader cleanup.
- Integrate Computer-Link native inventory, snapshots, export, focus, local MCP, workspace and owned-worker tools; preserve all 26 branch trees, 92 commits, original diagnostics and independent utilities.
- Add desktop native-tool status, local launch/stop controls and connector diagnostics; keep optional tools independent from ordinary desktop operations.
- Make paused/connecting hub state visible and allow disabling a pending or paused connection. Do not report a generic acknowledgement as a successful connection.
- Revalidate delayed chat continuations before staging and sending. Preserve edits and new permission/review holds, stop on navigation or composer replacement, and cancel unnecessary sends when the provider resumes or finishes.
- Require matching source, version and artifact hashes when assembling a release; publish native setup, browser packages, desktop packages, source, receipts and checksums together.


## 0.21.0 — Agent Monitor (candidate)

- Recover the verified complete v0.20.1 source into the canonical root; test the
  current tree in CI while retaining historical release evidence.
- Add compact responsive Agent Monitor, persisted incident inbox, audible and OS
  alerts, exact-tab review, acknowledge/snooze, filters and connection diagnostics.
- Add a Rust cross-browser hub with native messaging, portable durable state,
  safe focus routing, current-user registrations, CLI and Linux/Windows tests.
- Add Firefox sensor packaging and actual-browser detector fixtures.
- Preserve manual permission decisions, drafts, suspended/disconnected truth and
  browser-specific identities; remove automatic consent clicking.
- Record candidate acceptance and deployment gaps in docs/MONITOR-VERIFICATION.md.


## 0.20.1 — All-Tab Chat Guardian Hotfix

- Added an event-first Chat Guardian that independently supervises every open ChatGPT conversation tab and keeps recoverable tabs resident without stealing focus.
- Added semantic handling for ChatGPT’s new stream-recovery timeout/error wording, including `ChatGPT stream recovery polling timed out`, plus recovery-control-anchored fallback detection so future current-turn failure copy can change without breaking recovery.
- Automatically sends the separate safe continuation turn `Continue the unfinished task.` when a current task is demonstrably unfinished, instead of replaying ChatGPT’s native Retry control or duplicating prior tool side effects.
- Uses `Promise.allSettled` across all open ChatGPT tabs so one broken, discarded, frozen, or non-responsive tab cannot block recovery of the others; Chrome frozen/discarded transitions are tracked and reconciled immediately when the tab becomes runnable again.
- Preserves user drafts and non-bypassable provider-review, approval, authentication, rate-limit, unavailable, and conversation-capacity holds.
- Adds one bounded reload fallback only when an explicit terminal failure cannot be continued because the composer/send surface is unavailable; reload attempts are fingerprinted and capped.
- Replaces fixed guardian polling with state-transition triggers plus adaptive one-shot fallback alarms, and persists bounded per-chat recovery history for deduplication.
- Added unit, static-contract, real-browser DOM, and background integration regressions for multi-tab recovery, new provider error wording, healthy-tab non-interference, and native-Retry non-activation.

## 0.20.0 — Reliability Foundation

- Added a cross-surface state-event bus and removed fixed polling loops from key UI/route/recovery paths, including the legacy one-minute stall watchdog.
- Added provider capability health and a reusable Incident Brain with verified recovery recipes.
- Migrated the Project Brain to DB v11 with shared IndexedDB connection management and migration receipts.
- Added modular background message routing for new services.
- Added the desktop Update Center with SHA-256 staging, rollback backups, and one-shot startup checks.
- Unified user-facing desktop branding under Project Constellation while preserving migration-sensitive Commander state/CLI identities.
- Updated Electron to 44.4.4 stable and added a Windows-native build/runtime gate plus a unified immutable release workflow.
- Fixed Windows process execution with a short-lived PowerShell wrapper plus a structured-argv fast path for explicit simple native calls, preserving embedded quotes, exit codes, partial output, and large output without weakening real PowerShell semantics; Windows PowerShell 5.1 remains a compatibility fallback. Packaged the canonical ChatGPT page hook with byte-for-byte drift protection.
- Made the integrated Electron acceptance gate wait for shell-runtime proof before closing on the first tool result, removing a Windows-only timing race from release validation.
- Upgraded GitHub Actions to the current Node-24 action line and made Windows native-command failures fail the gate immediately.
- Made source archives reproducible from raw committed Git blobs so release ZIP contents cannot drift through export-time line-ending conversion.
- Made Linux desktop Chromium acceptance use the Playwright-managed browser installed by CI and made unified extension ZIP packaging sorted/file-only so verified extension bytes reproduce deterministically.
- Added regression protection for broad Project Constellation permissions/host access; no provider or permission coverage was reduced.

## 0.19.1 - Recovery Efficiency Hotfix

- Replace Scheduled self-healing's fixed one-minute polling alarm with adaptive one-shot fallback checks.
- Debounce and fingerprint Scheduled DOM recovery signals so unchanged streaming/UI churn does not retrigger inspections.
- Coalesce in-flight recovery invalidations instead of chaining duplicate cycles.
- Replace the Home approval-recovery 1.1-second refresh loop with storage-change-driven UI updates.
- Preserve manual recovery responsiveness and every permission/security/user-draft hold.

## 0.18.0 - Smart Project Icons + Chat Menu QOL


## 0.18.1 - Runtime Error Hardening

- Fixed ChatGPT page-probe `postMessage` failures in sandboxed/opaque-origin estuary/content documents.
- Skip transcript-probe startup on `/backend-api/*` and `/api/*` documents where it has no work to do.
- Harden Scheduled Task bridge `postMessage` calls for opaque-origin frames.
- Restored the missing `maybeStartAutomaticCatalog()` maintenance entrypoint so the hourly catalog alarm cannot throw `ReferenceError`.
- Added regression coverage for both reported extension-error classes.

- Add native-style vector project icons and semantic icon suggestions to Command Center and side-panel project creation.
- Make ChatGPT sidebar chats inherit confirmed/matched project identity automatically, including related-project badges for split project families.
- Add Constellation actions to the native ChatGPT chat menu for appearance, smart project matching, favorite, pin, and Command Center navigation.
- Keep project assignment explicit while preserving every v0.17.9 Scheduled Task, closed-chat heartbeat, notification, and safety invariant.

## 0.17.9

- Forward-port the AI Command Center, verified Gather/Smart Collapse/Stash actions, native ChatGPT rename/styling, adaptive closed-chat heartbeat, durable notifications, and no-dead-button QOL onto the verified v0.17.8 Scheduled Task Command Center baseline.
- Preserve v0.17.8 Scheduled Task Guardian, Scheduled Task Command Center, project intelligence, privacy/safety invariants, provider coverage, and scale behavior.

## 0.17.8 — Scheduled Task Command Center

- Upgrades Scheduled Task Guardian into a premium **Scheduled Task Command Center** with native Chrome popups for observed run completions, failures, pauses, action/approval-needed states, and resumptions.
- Adds transition-aware deduplication so combined states such as a completed run that immediately becomes paused produce one useful alert instead of notification spam.
- Adds **Open Scheduled** and **Mute 1 hour** actions to Guardian notifications, plus a real **Test popup** control, task-health badge count, bounded recent-activity history, and Home/side-panel health metrics.
- Adds opt-in controls for task-state observation, desktop popups, successful-run alerts, and state-change alerts while preserving existing keep-warm, auto-repair, and cadence controls.
- Observes only bounded task-health metadata (IDs/titles/status/timestamps/run identity/attention flags) and explicitly excludes prompts, instructions, messages, task results, output, bodies, and page HTML from Guardian persistence.
- Uses passive resource metadata plus bounded authenticated refreshes instead of monkeypatching ChatGPT fetch/network behavior; first observation establishes a baseline and never fabricates a run-complete transition from elapsed time.
- Canonicalizes Scheduled navigation to `https://chatgpt.com/scheduled` while accepting older `/schedules` and `/tasks` aliases as safe inputs.
- Keeps every v0.17.7 safety invariant: no inactive/minimized ChatGPT tabs/windows, no existing-tab navigation hijack, no new Chrome permissions, and cloud-task execution is never attributed to the hidden browser workspace.

## 0.17.7 — Scheduled Task Guardian

- Adds a premium-designated **Scheduled Task Guardian** for ChatGPT Scheduled at `https://chatgpt.com/schedules`.
- Reuses Constellation's single existing MV3 offscreen document instead of spawning hidden/minimized ChatGPT tabs or windows.
- Keeps an opt-in 1px Scheduled workspace warm when ChatGPT permits framing; detects frame-blocking response headers and automatically falls back to a lighter authenticated reachability heartbeat.
- Uses a bounded 15/30/60/180-minute alarm cadence (30 minutes by default), Chrome-startup repair, single-flight probes, and no offscreen polling loop.
- Adds Home + side-panel controls for enable/disable, embedded-workspace mode, auto-repair, cadence, manual repair, and explicit foreground **Open Scheduled** navigation.
- Treats Scheduled tasks truthfully as ChatGPT cloud jobs: Guardian protects the browser/session/management surface but never claims a hidden page itself executes the task.
- Adds URL confinement, frame-header classification, auth/degraded-state classification, UI/message ownership, and no-hidden-navigation regression coverage.


## 0.17.6 — Terminal State Truth Guard

- Fixed plain-DOM bottom-of-chat timeout/error cards being missed when ChatGPT omits ARIA/error semantics.
- Added bounded Retry-anchored and bottom-tail terminal detection for provider failures and hard conversation limits.
- Provider hard failures and maximum-length exhaustion now outrank stale running/network/completion evidence and surface as red Critical.
- Long-chat status sampling now prefers newest controls and rejects historical/quoted terminal text.
- Pulse/Popup critical bucketing now respects health-state-only terminal signals such as `capacity-reached`.
- Added exact screenshot-shape terminal regressions and Critical Pulse rows for delivery timeout + maxed conversation.
- Fixed current ChatGPT connector permission sheets that say `Allow access to drive.google.com` / `github.com`: Approval Autopilot now recognizes host-shaped prompts, opens split-button menus, selects `Allow all` when available, and confirms the sheet actually cleared before reporting recovery.
- Added explicit Google Drive + GitHub `Allow all` browser regressions while preserving fallback Allow-once and never-auto-Retry safety.


## 0.17.5 — Project Identity + Semantic Output Guard

- Adds a shared ChatGPT-style project identity picker with emoji, native color wheel, hex entry, presets, live preview, and one persisted identity used across Pulse, Projects, Project Rooms, Popup context, and managed project/state grouping.
- Makes Output Vault warnings semantic instead of raw-DOM literal: transient Thinking/tool/search/build progress can disappear normally without becoming a false “saved output is missing” alarm, while actual substantive truncation and lost resources remain protected.
- Tightens UI ownership validation so merely mentioning a button ID no longer passes the contract.
- Adds a process-tree smoke watchdog, exact workflow matching/resume, direct-to-log browser execution, and Linux Chromium teardown hardening.
- Adds dedicated project-identity and semantic-output regression coverage.

## 0.17.4 — Chrome Stability Guard

- Fixes a crash-class presentation feedback loop by making repeated Tab Beacon applications idempotent and skipping already-correct native tab-group writes.
- Prevents Constellation-owned group update events from globally invalidating every tab-presentation signature, eliminating self-amplifying group/beacon churn across many open chats.
- Narrows title, Pulse, and Live Sentinel MutationObservers so provider streaming/class churn does not wake unrelated Constellation work.
- Deduplicates live-transition session writes and unchanged Sentinel presentation syncs while preserving 🛡️ On Hold / Review, Critical/completion/review-cleared alerts, user-created group ownership, and no-automatic-provider-action safety.
- Stops auto-collapsing Completed native Chrome groups. A one-time migration reopens groups collapsed by older Constellation builds, then group collapse/expand remains entirely user-controlled.
- Restores the compact in-page Pulse navigator to three chips — **Active · Needs · Done** — with Critical + 🛡️ On Hold + Stale rolled into the yellow Needs count only on that compact surface; opening Needs still shows each chat's true detailed state.
- Regression benchmarks: 10,000 identical hold presentations drop from 20,001 DOM mutations to 0 extra after initial setup; 1,000 stable group reconciliations drop from 1,000 Chrome group updates to 0.

## 0.17.3 — Shield Hold

- Replaces the default On Hold / Review marker from 🔵 to 🛡️ while preserving the blue hold color and native Chrome blue group.
- Migrates the legacy default hold emoji to 🛡️, updates title/group/Pulse presentation, and renders the hold favicon as a blue vector shield instead of the generic status circle.

## 0.17.2 — Review Hold + Instant Alerts

- Adds a dedicated blue **On Hold / Review** state for ChatGPT's explicit provider-review banner instead of misclassifying it as a stall or Critical failure.
- Adds 🔵 title/favicon beacons, a blue native Chrome On Hold group, Chat Pulse/Pulse-pin counts, and toolbar priority below Critical but above Active.
- Adds one-shot **Review cleared** notifications when the hold surface disappears, plus immediate Project Constellation local notifications when a live chat completes or crosses into Critical.
- Persists compact per-tab transition state in `chrome.storage.session` so Manifest V3 background suspension does not cause completion/Critical/review-release notifications to be missed; chat identity guards prevent cross-chat false alerts when a tab navigates.
- Keeps all notification actions passive: clicking an alert only focuses the exact existing tab; no retry, reload, provider navigation, context injection, or Send action is automatic.
- Adds exact banner appearance/disappearance browser coverage and extends blue hold coverage across Popup, in-page Pulse, tab beacons, and native tab-group convergence.

## 0.17.1 — Critical Redline

- Added a dedicated red Critical chat state for hard-stop conditions such as message-delivery timeout, interrupted/failed sends, refresh-required blocks, dead tool/chat states, and conversation capacity reached.
- Critical chats now get a red tab favicon/title beacon and their own native Chrome tab group (`PC ✦ 🔴 … · Critical`) without stealing user-created groups.
- Chat Pulse and the collapsed Pulse status pin now show Critical separately from ordinary Needs Attention, and the extension badge prioritizes red critical counts.

# Changelog

## 0.17.0 — Dependency Brain + Guarded Autopilot

- Adds a bounded Dependency Brain that relates source-backed decisions, procedures, versions, artifacts, files, and cross-chat work, and marks downstream evidence as possibly stale when a newer observed dependency/version supersedes it.
- Adds version awareness across project knowledge and artifact families, preserving literal observed labels and separating current-observed from older-observed evidence without deleting history.
- Adds cross-chat handoff proposals and duplicate-work prevention for concurrent project chats, with direct source/chat provenance and conservative inferred-overlap wording.
- Adds **What changed** project deltas with an explicit caught-up watermark, so Project Rooms can summarize meaningful changes since the user last acknowledged them.
- Adds Guarded Project Autopilot: it may detect, prepare, and propose stale-dependency reviews, handoffs, duplicate-work reviews, and fresh context, but it cannot send provider messages or silently inject context.
- Adds per-chat Context Packets that select bounded task-relevant evidence while still including reusable project-wide lessons (for example performance, workflow, validation, compatibility, and recovery patterns) from the giant Project Brain.
- Makes provider writing approval-gated and hash-checked: exact text must be reviewed/approved before it can be staged into an already-open exact chat; staging never opens/navigates a provider and never presses Send. Legacy Branch & Continue is also locked to review/stage only; automatic Send is removed.
- Adds a prominent **Current Chat → Add to Project** Pulse action that detects the exact active supported chat, lists user-created Constellation projects, supports **Create + add**, change/remove, and re-checks active tab/chat identity before saving.
- Preserves local bounded execution and the 500-project / 10,000-chat scale gate so Dependency Brain/Autopilot work stays outside the live provider-capture critical path.
- Hardens release builds by copying the complete runtime `src/` closure and failing the build when a relative module import or manifest-referenced runtime file is missing, preventing source-green/package-broken releases.

## 0.16.0 — Living Project Rooms + Safe Router

- Adds a confirmation-only local Project Router that ranks likely project homes without ever auto-assigning a chat; every assignment still requires an explicit user Confirm or Move action, and dismissed matches stay suppressed for that exact evidence fingerprint.
- Upgrades the selected-project surface into a Living Project Room with next actions, decisions, live project work, curated memory, project evidence, latest artifacts, and exact source navigation.
- Adds bounded multi-chat coordination signals so simultaneous active/attention chats can surface shared focus, parallel-work overlap, and handoff risk without pretending an inferred overlap is a proven conflict.
- Extends universal search with project-scoped retrieval across chats, source turns, knowledge, files, artifacts, and indexed standalone evidence, plus direct source/chat actions and Project Room command-palette entry points.
- Adds a 500-project / 10,000-chat scale torture test and optimizes router scoring to vectorize each chat once before project comparison; representative local routing fell from about 5.2 s to about 1.1 s while keeping the benchmark unchanged.
- Keeps router and coordination computation local and bounded, outside live provider capture; preserves v0.15 Project Brain, native project/state grouping, user-created group ownership, and all v0.14 safety/recovery invariants.
- Hardens organizer drag/drop with a standards-compatible `text/plain` fallback while retaining the Constellation-specific MIME payload.

## 0.15.0 — Project Atlas + Compounding Brain

- Adds a deterministic, source-backed Project Brain compiler over Knowledge Vault/project continuity with bounded working context, provenance, confidence, active work, and memory coverage.
- Adds a durable concept-level memory policy ledger: Pin, Ignore, Restore, and superseded history survive recompilation/re-indexing without deleting raw evidence.
- Reorganizes Home around Project + state clusters and Active / Needs attention / Completed / Archived lanes, with State-only and Flat compatibility modes.
- Makes native Chrome groups project-aware by default while preserving the existing never-steal-user-groups and verify-before-cache convergence contracts.
- Grounds the second-brain architecture in the full WikiSkill paper review under `docs/research/wikiskill-2608.27454-integration.md`.
- Preserves v0.14.12 Black Box Truth, Work Rescue, Capacity Guard, Output Vault, No Surprise Navigation, and recovery behavior.

## 0.14.12 — Black Box Truth + Work Rescue

- Replaces single-signal stall conclusions with Health Core v10 multi-signal arbitration across provider/transcript heartbeats, DOM/tool progress, network/request lifecycle, current-turn ownership, composer/stop state, and contradiction evidence.
- Adds `uncertain-working` as an explicit **do not interrupt yet** verdict when stale running UI is not corroborated; stale labels alone no longer become a stall incident.
- Adds a privacy-bounded ChatGPT provider activity trail containing only categorical phase/operation/status/progress/timestamps—never prompt text, answer text, tool arguments, auth material, or chain-of-thought.
- Adds ACK-backed Work Rescue journaling: streaming assistant revisions are reported saved only after the IndexedDB rescue transaction commits, with bounded self-retry and newest-revision preservation.
- Clears stale `retryForbidden`, `automaticRetryForbidden`, and failure metadata after genuine recovery, and propagates fresh truth state into Home, Needs Attention, Project Integrity, and hot-upgrade HUD rendering.
- Keeps `uncertain-working` out of Needs Attention/Integrity incidents while preserving corroborated stall/dead, provider interruption, capacity, and output-integrity alerts.
- Preserves No Surprise Navigation: passive monitoring never retries, reloads, branches, opens, focuses, or navigates provider tabs automatically.

## 0.14.11 — Early Branch Guard

- Fixes missed maximum-conversation warnings by counting full active-branch messages and structured tool/app overhead in Capacity Guard instead of relying mainly on visible turns and measured text.
- Recognizes ChatGPT’s exact hard-stop copy: “You’ve reached the maximum length for this conversation … starting a new chat.”
- Moves the default runway profile earlier and migrates only untouched legacy 0.14.10 defaults; explicit user-custom thresholds remain preserved.
- Adds adaptive watch/handoff zones so high branch pressure can warn before a fixed threshold is crossed.
- Keeps capacity warnings primary while healthy tool work continues, and keeps Branch & continue urgent in both expanded and collapsed Execution Pulse.
- Preserves Interruption Guardian, State Convergence, Runway Sentinel, and No Surprise Navigation behavior.

All notable Project Constellation changes are recorded here.

## 0.14.10 - State Convergence

### Fixed

- Fixed a split-brain state where Execution Pulse could visibly recover to `Tool working` while a stale hidden HUD watchdog state kept the tab in the Constellation Needs Attention group.
- Removed the current-version dual-renderer race: Health Core now owns the v8 HUD while Live Sentinel emits a sanitized transition event that triggers an urgent bounded content refresh.
- Fresh Sentinel `tool-running` evidence now clears an older content-loop stall; true current stalls, provider interruptions, and capacity warnings remain authoritative.
- Managed tab-group moves are now verified before their presentation signature is cached. A transient Chrome group API failure schedules repair instead of making the wrong group sticky.
- Added a live managed-group convergence audit so Constellation-owned Active / Needs Attention / Completed grouping self-heals when browser state drifts, while user-created groups remain untouched.
- Rejected pre-upgrade Sentinel state pushes/replies so an old already-open listener cannot race the current version and move a recovered tab backward.

### QoL

- Active and Needs Attention Constellation groups expand when used so current work and required intervention stay visible.
- Current-state transitions refresh the single Execution Pulse renderer promptly instead of waiting for the ordinary health-poll interval.

### Tests

- Added exact screenshot-shaped state-convergence coverage for stale hidden warning state + fresh ModForge inspection progress.
- Added deterministic managed-group failure/retry coverage proving an identical healthy state can repair a transiently failed group move.
- Preserved Runway Sentinel stall/capacity regressions and No Surprise Navigation coverage.

## 0.14.9 - Interruption Guardian

### Added

- Added first-class `delivery-timeout`, `connection-interrupted`, `response-interrupted`, and `send-failed` chat states instead of collapsing provider failures into generic refresh-required.
- Added scoped discovery of provider-owned Retry / Try again / Regenerate response / Resend message / Reconnect controls on the current failure surface.
- Added an explicit Execution Pulse recovery button when a safe native provider recovery control is actually visible. Retry remains manual-only.
- Added interruption metadata for detection age, retry availability/label, partial assistant characters, preceding tool activity, and user-triggered retry count.
- Added specific Needs Attention and native notification copy for delivery timeout, connection interruption, response interruption, and send failure.

### Fixed

- Provider failure UI now outranks stale transcript/DOM `running` evidence, preventing a timed-out response from remaining falsely green.
- Approval Recovery reports provider interruptions without auto-retrying or mislabeling them as browser-refresh recovery.
- Integrity findings no longer tell users that every delivery timeout requires refresh or that Retry must never be used; they report the actual failure and whether an explicit native recovery is available.

### Safety invariant

- Passive monitoring never clicks Retry, opens/focuses/navigates/reloads ChatGPT, or recreates a missing chat. Native provider recovery can only run after an explicit user action in an already-open tab.

## 0.14.8 - No Surprise Navigation

### Fixed

- Decoupled Runway Sentinel stall detection from Approval Recovery. A stall/runway state is now observational only: warn, notify, record, and surface Needs Attention without starting recovery.
- Removed the legacy minimized ChatGPT recovery window and all approval-recovery URL navigation/reload behavior. Recovery scans only ChatGPT tabs that are already open.
- On extension update/startup, any persisted pre-v0.14.8 hidden recovery run is stopped and its legacy popup is closed before monitoring resumes.
- Live-chat focus never falls back to creating a ChatGPT URL when the original tab is gone, preventing OS/PWA link-capture from launching the ChatGPT desktop app.
- Enabling Approval Autopilot no longer starts a sweep through saved chats; normal in-page Autopilot remains active on already-open ChatGPT tabs.

### Safety invariant

- Passive monitoring and watchdog code may not create/focus/navigate/reload an AI page. External navigation requires an explicit user workflow (for example Branch & Continue or Full Capture), never a stall transition.

## 0.14.7 - Runway Sentinel

### Fixed

- Replaced mount-local capacity counting with full stored/transcript branch evidence so long ChatGPT conversations still warn correctly after an extension reload/update.
- Removed fake progress heartbeats from unchanged spinner/tool labels and repeated `running` transcript polls. Watchdog age now resets only when observable progress actually changes.
- Prevented the fast Live Sentinel from downgrading an authoritative Tool Watchdog stall or Capacity Guard state back to ordinary `working`, including in canonical Chat Pulse state.
- Fixed extension-update continuity for already-open tabs: hot injection now carries the current Health Core with Runway Sentinel, so legacy tabs can detect stalls/runway danger without a page refresh.

### Added

- Added separate **Response time** and **No progress** clocks to Execution Pulse. The first measures total output duration; the second measures silence since meaningful progress.
- Added full active-branch numeric metadata for ChatGPT: turn/message counts, measured characters, recent average size, current assistant size, and response timestamps, without exporting transcript text from MAIN world.
- Added predictive heavy-turn runway warnings and canonical `capacity-watch`, `capacity-handoff`, and `capacity-reached` Needs Attention states.
- Added separately toggleable native **Stall & runway alerts** for first entry into a real stall/dead or capacity-attention state.

### Performance / privacy

- Added a 15-second capacity-aggregate cache so streaming capture cannot repeatedly rescan an entire chat's IndexedDB turn history.
- ChatGPT transcript proof is reduced to bounded metadata before it reaches extension state; access tokens and transcript text remain in MAIN world.

### Tests

- Added browser regressions for unchanged-spinner aging, real-progress reset, response elapsed time, watchdog-to-Chat-Pulse propagation, full-branch capacity metadata, native runway notifications, and no-refresh legacy-tab hot upgrades.
- Expanded health-core regressions for stored-character reload persistence, full transcript-turn dominance, and predictive large-message runway.

## 0.14.6 - Context Lens

### Added

- Chat Pulse and the collapsed Execution Pulse navigator now add a compact context line beneath every live chat title. It surfaces the latest captured user task when available, so vague titles such as “Continue project work” no longer hide what that tab is actually doing.
- Live rows now carry canonical project context from the local Constellation catalog. Workspace/project names appear before provider/state/model/group metadata, while user-created Chrome tab groups remain labeled as groups rather than being misrepresented as projects.
- Active rows can show both the stable task and the current observable tool/activity label (`Task · …` plus `Now: …`), giving a useful distinction between the goal and the step currently executing. Completed rows use `Last task · …`.

### Performance / privacy

- Context enrichment is local-only and adds no provider-page network traffic. A short-lived background cache joins each open tab to its existing IndexedDB chat record; new captures retain a bounded `lastUserExcerpt` so ordinary Pulse refreshes do not rescan transcript history. Older records use a bounded reverse lookup only until that compact task field is available.
- Context text is normalized and tightly bounded before it reaches popup/HUD rendering. The ChatGPT MAIN-world transcript proof remains metadata-only and unchanged.

### Tests

- Added regression coverage proving project/task/current-step context reaches the canonical live snapshot, popup navigator, and in-page pinned navigator while preserving focus navigation and user-owned tab-group labels.

## 0.14.5 - Pulse Navigator

### Fixed

- Reworked live-tab aggregation so every supported open AI chat remains represented in Chat Pulse even if one tab temporarily fails to answer the Sentinel probe. A bounded 1.6-second per-tab deadline prevents one broken tab from zeroing or hanging the entire 10+ tab snapshot; recently known state is retained briefly and genuinely unresponsive tabs become explicit Needs Attention/reconnecting rows instead of disappearing.
- Removed the expensive ChatGPT MAIN-world probe version check from every Pulse refresh. The background now reads the installed Live Sentinel first and only bootstraps the deep ChatGPT probe when the Sentinel is missing or stale.
- Added cache invalidation for tab create/update/replace/remove and tab-group changes so counts react to real browser topology changes instead of waiting on a long stale cache.
- Serialized Constellation-owned group mutations to prevent duplicate Active/Attention/Completed groups when many chats change state together.
- User-created tab groups are preserved exactly. Chats inside them still count, display their group in the navigator, and remain clickable. Tabs already in Constellation-owned status groups may still move between those groups so automatic sorting continues to work.

### Added

- Active / Stale / Completed cards in the extension popup now open an in-place, polished list of every chat in that state instead of jumping only to the newest chat. Each row shows provider, live phase/status, model when available, group context, and jumps directly to the existing tab.
- The collapsed Execution Pulse chips are now individually clickable and open the same live-chat navigator directly from the pinned HUD.
- Added a single `PC_FOCUS_LIVE_CHAT` path shared by popup and in-page Pulse navigation, with existing-tab focus first and URL reopen only as a fallback.
- Live Pulse rows now expose current tab-group metadata and whether the group is Constellation-managed or user-owned.

### Performance / resilience

- Collapsed Pulse count refreshes use a 4-second local cache and a 7-second visible-only refresh cadence; hidden tabs do not poll. The canonical background snapshot itself remains short-lived and event-invalidated.
- Pulse snapshots are always structurally complete: `openChatTabs` reflects every detected supported tab, `responsiveTabs` reports how many returned fresh evidence, and `partial` identifies reconnecting tabs without erasing them from the counts.

## 0.14.4 - Deep State + Tab Beacons

### Added

- Added a ChatGPT-only MAIN-world transcript probe that reduces the current conversation branch to sanitized generation metadata. Explicit `finished_successfully` + `end_turn` completion and unfinished current-node state can now outrank stale DOM controls without exposing conversation text or authentication material to the extension runtime.
- Added Deep Research/widget awareness, async-task metadata, model slug, semantic phase, tool count, and real numeric progress only when ChatGPT itself provides it.
- Added a full Tab Beacon system, enabled by default: configurable status emoji in tab titles, dynamic color favicons, native Active/Needs Attention/Completed tab groups, toolbar status/count badge, persistent manual emoji/short tags, and right-click tag presets.
- Added version-aware hot injection of the ChatGPT page probe, Live Sentinel, and Tab Beacon into already-open supported tabs.
- Added `npm run test:live-browser`, a persistent Chromium/Chrome-compatible unpacked-extension harness for signed-in live-site acceptance in environments that permit it.

### Fixed

- Replaced the remaining broad ChatGPT live-state fallback with exact current-turn semantics. Generic page-wide busy/loading wrappers, old answer controls, ordinary assistant prose, and auxiliary provider traffic can no longer decide that a chat is running.
- Aligned transcript authority to the newest visible user turn so a stale conversation snapshot cannot mark a newly submitted prompt complete.
- Classified ChatGPT response, Codex-response, and deep-research SSE/task transports for diagnostics while keeping network traffic non-authoritative.
- Made transcript confirmation event-driven at authoritative response-stream completion and slowed routine transcript polling, reducing redundant same-origin conversation reads during long-running chats.
- Unified popup Chat Pulse, Execution Pulse, completion notifications, title/favicon presentation, native tab grouping, and action-badge state around the same canonical live-tab record.
- Preserved user-created tab groups: automatic grouping only owns groups created with the Project Constellation prefix and will not pull a tab out of an unrelated existing group.

### Tests

- Added real-Chromium transcript tests for running/final states, Deep Research widget completion, model metadata, explicit progress, and token/content isolation.
- Added real-Chromium Tab Beacon tests for title/favicons, site-driven title renames, manual tags, status changes, and exact cleanup on disable.
- Retained the previous false-complete, false-active, HUD-race, network-tail, Output Vault-secondary, and active-to-completed regressions.

## 0.14.3 - Stable Live State Hotfix

### Fixed

- Tightened Live Sentinel so generic `aria-busy` / loading-layout wrappers and ordinary assistant prose cannot keep a completed ChatGPT response active. Weak progress rows must have a real progress-line shape, while current final controls suppress only leftover busy bits.
- Added a short running-to-idle settle window and a HUD mutation guard so transient DOM gaps or a lagging legacy renderer cannot visibly flicker Execution Pulse between healthy/active/warning states.
- Made the versioned Live Sentinel the single authoritative primary chat-state source across popup counts, notifications, content status, and Execution Pulse; background state now ignores legacy live-state pushes.
- Demoted provider-network activity to telemetry. Pending/stream-likely ChatGPT requests cannot resurrect a completed chat.
- Kept Output Vault mismatch warnings secondary: they no longer promote a completed chat into the active health-poll lane or decide its primary color/status.
- Hot-upgrade injection now replaces older Sentinel versions in already-open tabs.

### Tests

- Added completed-answer regression coverage using the exact production-release prose that was falsely displayed as `Tool working`, including stale `aria-busy` and `data-state=loading` ancestors.
- Added a 60/120-frame HUD race stress test that repeatedly writes wrong green/red/blue state while requiring zero visible bad frames.
- Added full content/health stability coverage with alternating pending provider traffic, an active secondary Output Vault mismatch, stale busy-attribute churn, real progress activation, and settled completion.
- Preserved the v0.14.2 current-tool regression: genuine `Searching…` / `Inspecting…` work still becomes Active immediately and only completes after the current response settles.

## 0.14.2 - Live Sentinel Hotfix

### Fixed

- Replaced the fragile current-response heuristic with a dedicated **Live Sentinel** that reasons from the current conversation frontier: the newest user turn, the assistant response after it, and tool/progress rows that occur after that user turn. Historical tool rows and controls from older assistant messages can no longer decide whether the current chat is active.
- Fixed the exact false-complete case where an older assistant message still exposed **Copy** controls while the current response was visibly running tool work outside a recognized assistant turn. Present-tense current progress now wins, so labels such as **Searching the web**, **Inspecting mob animation rendering logic**, **Checking build tools**, **Analyzing**, **Testing**, and related active verbs keep the chat in `running`.
- Expanded active tool semantics beyond search/fetch verbs to cover inspect/check/analyze/review/compare/audit/build/compile/package/test/edit/write/patch/modify/implement/fix/enhance/persist/port/open/click/type/trigger work.
- Tool evidence is now selected from the newest **current** progress row instead of the newest matching row in the entire historical DOM. This prevents a stale `Searched 20 websites` row from replacing a newer `Searching the web` or `Inspecting ...` state in Execution Pulse.
- Live Sentinel observes text-node (`characterData`) mutations as well as child/attribute mutations, so in-place transitions such as `Searching...` -> `Searched...` are recognized immediately.
- Existing open AI tabs are hot-upgraded with the new Sentinel through `chrome.scripting`. Reloading Project Constellation no longer leaves an old content script permanently controlling the on-page HUD until every ChatGPT tab is manually refreshed.
- The Sentinel can correct an already-mounted legacy Execution Pulse HUD in place, so `Chat complete` is replaced with the current tool-working state as soon as the Sentinel is injected.
- Background Chat Pulse now asks the Sentinel first, injects it when missing, and only then falls back to the older content-script/raw DOM probes. This keeps popup counts, completion notifications, and the on-page Pulse on one canonical live-state source.

### Tests

- Added a Chromium regression reproducing the reported DOM shape exactly: an older completed assistant with Copy controls, a newer user turn, current tool rows outside a recognized assistant turn, `Searched 20 websites`, `Searching the web`, `Inspecting mob animation rendering logic`, and generic `Called tool` rows. It must remain `running`, surface the newest current progress label, and repair a legacy HUD that initially says `Chat complete`.
- The same regression mutates the active rows in place to completed tense, mounts the current final assistant answer, and confirms the Sentinel transitions to `idle` only then.
- Existing live-chat-state integration coverage now loads Live Sentinel before the main content script and verifies the main status/health path consumes the canonical Sentinel state.

## 0.14.1 - Live Pulse Hotfix

### Fixed

- Replaced the broken Chat Pulse historical-count wiring with a real browser-tab census. Active, stale, and completed counts now come from the AI chat tabs that are actually open, not catalog fields the count API never returned.
- Added a direct DOM probe fallback for already-open tabs after an extension upgrade. v0.14.1 can classify existing ChatGPT tabs immediately without requiring every tab to be manually reloaded before the new content-script message contract exists.
- Generation detection now treats present-tense tool work such as **Searching Google Drive...** as active while refusing to treat stale shimmer/tool-card text as permanent proof that a chat is still running. Explicit stop/stream/busy signals, provider-network requests, tool progress, and final assistant controls are reconciled before a tab is called complete.
- Hidden tabs are re-sampled when they lose visibility and continue a lightweight active pulse while work is in progress, so switching away immediately after sending a prompt no longer leaves the tab incorrectly idle for up to 30 seconds.
- Provider-network start/completion events now invalidate the live-pulse cache and trigger a bounded tab reconciliation. Active to completed transitions can therefore produce the completion notification even when the popup is closed.
- Chat Pulse cards focus the existing browser tab instead of opening duplicate conversation tabs.
- Saved/page mismatch warnings remain secondary to the real chat state; Balanced sensitivity continues to suppress low-confidence tool/activity-card churn while preserving all raw revisions.

### Added

- **Review branched chats before send** toggle. When enabled (default), Branch & Continue prefills the fresh chat, lets you edit the handoff, and submits with **Enter**; **Shift+Enter** keeps inserting a newline. Disable the toggle to retain automatic send behavior.
- **Chat completion notifications** toggle, enabled by default. Notifications are emitted only for an observed active to completed transition rather than for every idle chat discovered at startup.
- Live-pulse regression coverage for the exact `Searching Google Drive...` to `Searched Google Drive...` transition, existing pre-upgrade tabs, multi-tab counts, completion notifications, and editable Branch & Continue submission.

## 0.14.0 — Constellation Nightfall

### Added

- Truthful browser-session coverage for 17 common AI chat sites, including Meta AI, Qwen Chat, Kimi, Character.AI, HuggingChat, You.com Chat, Pi, and Duck.ai; anonymous guest sessions are kept distinct from authenticated accounts.
- Standalone canonical repository and professional source/build/release/docs/recovery layout.
- Cohesive purple-and-blue night-sky identity across Home, popup, side panel, and Execution Pulse.
- Sparse GPU-composited starfield with reduced-motion and constrained-device fallbacks.
- Current ChatGPT DOM regression coverage, including anonymous root-path conversations.
- Production OAuth build gates, cross-platform smoke orchestration, release receipts, and checksums.
- GitHub OAuth refresh-token rotation and authenticated retry coverage.
- Exact OAuth provisioning/acceptance and production release runbooks, a tracked non-secret environment template, and a public privacy policy.
- An expanded Execution Pulse with a real-time **Observed now** card, bounded activity ledger, proof-source/confidence display, categorized provider-request lifecycle, and explicit response/tool/status/page events.
- An always-present **Branch & continue** Pulse action that prepares a durable handoff, opens a fresh provider chat, transfers the continuation through the native composer, and links the new chat to its parent checkpoint. Capacity pressure changes its urgency, not its availability.
- A collapsible/expandable **Output Vault** companion to Execution Pulse with a shared collision-free corner dock, full-workspace mode that reserves Pulse space, ChatGPT-like semantic Reader rendering plus optional Raw view, per-output collapsing, saved/current comparison, loss highlighting, search, revision history, text/code/link/media/file/build cards, lazy media preview, per-output copy, full Markdown export, and branch-from-saved recovery.
- Immutable `turnRevisions` and bounded `outputSnapshots` stores. Every distinct captured turn revision survives, while the canonical turn retains the richest assistant output instead of allowing a later truncated or tool-only DOM state to erase it.

### Fixed

- The local brain upgrades in place from IndexedDB v8 to v9, migrates boolean organizer indexes to valid numeric derived keys, and preserves every existing pinned/favorite/archive flag. This eliminates the `IDBKeyRange.only` `DataError` that interrupted Home refreshes after settings or organizer actions.
- Approval Autopilot and Live Chat Health settings writes are serialized, immediately reflected from the confirmed storage response, and protected from rapid-toggle lost updates.
- Approval Autopilot now recognizes ChatGPT's current inline provider card without requiring dialog roles or stale generic keywords, discovers nested/icon-only split-button chevrons, selects provider-specific **Allow … for this conversation** menu items, reacts immediately through a low-overhead dedicated observer, and requires visible card clearance before reporting success.
- Needs Attention settings now use accessible ON/OFF switches, autosave feedback, and explicit Save Settings buttons that re-submit and confirm the complete visible state.
- Home now falls back to a direct settings read when a stale/background-mismatched service worker cannot build the full summary, so saved switches never render as unchecked startup placeholders during an extension update.
- Home counters now come from verified IndexedDB store counts, use a lightweight count-only fallback when the full summary is unavailable, and show a loading/unavailable state instead of a fake `0 chats` result.
- Recovery and organizer buttons now reject failed background actions instead of displaying success or refreshing as though the mutation worked.
- Google OAuth builds no longer silently masquerade as production when the client is missing.
- Google connection success now requires a real Drive API verification response and the granted `drive.file` scope.
- GitHub access tokens now refresh safely on expiry or a 401 response.
- GitHub device polling continues to honor `interval` and `slow_down` responses.
- Current ChatGPT nested role markup no longer creates duplicate turns.
- Anonymous ChatGPT conversations are captured as stable tab-session chats instead of being discarded as Home.
- Untrusted external links are constrained to HTTPS/local development URLs.
- Windows build path and browser-smoke portability failures from v0.13.0 are repaired.
- Release/update documentation now names the actual generated unpacked archive and validation prevents required OAuth/release support files from silently disappearing.
- Current ChatGPT agent-step summaries and loading-shimmer activity are recognized directly, replacing vague generic `Called tool` reporting with the specific observable step label.
- Ordinary chat-history, session, and sidebar traffic is separated from agent-bearing response/tool/search/file traffic, so background site requests cannot create a fake “chat is working” state or an alarming undifferentiated request count.
- Continuation transfer never overwrites a nonempty composer or reports a send without observable confirmation; changed provider markup falls back to an honestly labeled prefilled or copied handoff.
- Refresh-time output regression is detected only after hydration, at the conversation bottom, and outside active generation. Missing/shortened responses, code blocks, links, and media become a first-class `output-regressed` health state and Needs Attention item; the actual saved material remains immediately recoverable.

### Performance

- Needs Attention toggles no longer trigger a full Home/provider/connection reload after every saved setting.
- Default active health polling increased from 1.8s to 2.5s; idle polling increased from 5s to 12s.
- Health context caching increased and hidden-tab pulses reduced to 30s.
- Tool scans are dirty/cached, use narrower selectors, and examine fewer nodes.
- Mutation roots are deduplicated and capped before bounded idle processing.
- Content capture remains network-free and preserves native conversation DOM.
- Repeated semantic upserts are coalesced before runtime messaging; measured-pressure capture drops nonessential catalogue/file scans until recovery while turn capture stays active.
- Long-task observation no longer replays buffered entries after tab visibility changes, and pressure recovery no longer writes metrics to extension storage every 500 ms.
- The real provider page automatically sheds only decorative `aria-hidden` animation/blur work during measured pressure; native content and controls are preserved.
- HUD rendering updates only changed text/chips and rebuilds its bounded seven-row timeline only when evidence or displayed time buckets change.
- Output-tail comparison runs only when the mounted fingerprint changes or at a slow confirmation interval; snapshots are bounded per chat, revision history is capped per turn, and remote media is never fetched automatically.

## 0.13.0

- Execution Pulse and Tool Watchdog.
- Conversation Capacity Guard and safe handoff checkpoints.
- Knowledge Vault and project-continuity extraction.
- Approval Recovery, adaptive request governor, verified Drive snapshots, and GitHub mirror foundations.

Historical v0.13 evidence and state are preserved under `releases/v0.13.0`, `brain/v0.13.0`, and `recovery/`.
