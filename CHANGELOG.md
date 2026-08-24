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

### Fixed

- Google OAuth builds no longer silently masquerade as production when the client is missing.
- Google connection success now requires a real Drive API verification response and the granted `drive.file` scope.
- GitHub access tokens now refresh safely on expiry or a 401 response.
- GitHub device polling continues to honor `interval` and `slow_down` responses.
- Current ChatGPT nested role markup no longer creates duplicate turns.
- Anonymous ChatGPT conversations are captured as stable tab-session chats instead of being discarded as Home.
- Untrusted external links are constrained to HTTPS/local development URLs.
- Windows build path and browser-smoke portability failures from v0.13.0 are repaired.
- Release/update documentation now names the actual generated unpacked archive and validation prevents required OAuth/release support files from silently disappearing.

### Performance

- Default active health polling increased from 1.8s to 2.5s; idle polling increased from 5s to 12s.
- Health context caching increased and hidden-tab pulses reduced to 30s.
- Tool scans are dirty/cached, use narrower selectors, and examine fewer nodes.
- Mutation roots are deduplicated and capped before bounded idle processing.
- Content capture remains network-free and preserves native conversation DOM.

## 0.13.0

- Execution Pulse and Tool Watchdog.
- Conversation Capacity Guard and safe handoff checkpoints.
- Knowledge Vault and project-continuity extraction.
- Approval Recovery, adaptive request governor, verified Drive snapshots, and GitHub mirror foundations.

Historical v0.13 evidence and state are preserved under `releases/v0.13.0`, `brain/v0.13.0`, and `recovery/`.
