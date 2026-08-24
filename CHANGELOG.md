# Changelog

All notable Project Constellation changes are recorded here.

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
