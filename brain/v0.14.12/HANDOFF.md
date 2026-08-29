# Project Constellation v0.14.12 handoff

## Objective

Make Constellation truthful enough that it never recommends interrupting a healthy long-running response from one stale signal, while durably rescuing useful streaming assistant output before a provider/page interruption can erase it.

## Implemented boundary

- Health Core v10 consensus with provider/transcript, DOM, tool, network, request lifecycle, current-turn ownership, stop/composer, and contradiction evidence.
- `uncertain-working` for stale uncorroborated activity with explicit do-not-interrupt guidance.
- Sanitized ChatGPT provider activity trail with bounded categorical fields only.
- ACK-backed `PC_RESCUE_TURN_COMMIT` IndexedDB transaction and Execution Pulse Work Rescue state.
- Pending rescue self-retry with bounded backoff and protection against old in-flight revisions replacing newer pending output.
- Healthy-state clearing of stale `retryForbidden`, `automaticRetryForbidden`, and failure metadata.
- Home/Needs Attention/Integrity propagation for fresh corroborated live health; `uncertain-working` is excluded from incident surfaces.
- Versioned Sentinel/probe/background hot-upgrade contract advanced together to 0.14.12.

## Verification so far

The complete local acceptance matrix is green: all 10 unit/contract suites, validation/UI/message contracts, a fresh v0.14.12 dev build, and all 27 browser smoke workflows using system Chromium at `/usr/bin/chromium`. The old bundled-Playwright-browser gap is bypassed without reducing browser coverage. Hot-upgrade smoke now explicitly proves that an uncorroborated stale tool label renders `uncertain-working` in the HUD without becoming stale/Needs Attention.

## Canonical base

Repository: `Herbertofury/Project-Constellation`

Base release/commit: `v0.14.11` / `3395512bb16fd79b3ee4dd17623592db0109b5ea`

## Next exact gate

Refresh and round-trip verify the runnable/source v0.14.12 Drive checkpoint, then publish one coherent GitHub head for clean-room CI. After exact-head CI is green, use the repository release workflow secrets for the production OAuth build/package, publish the GitHub Release + final Drive bytes, and verify hashes/size round-trip before calling v0.14.12 complete.
