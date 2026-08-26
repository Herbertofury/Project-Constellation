# Changelog

All notable Project Constellation changes are recorded here.

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
