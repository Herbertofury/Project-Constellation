# Project Constellation v0.14.10 handoff

## Objective

Fix the screenshot-proven split-brain state where a healthy/running ChatGPT turn can remain in Project Constellation's Needs Attention group, then harden nearby convergence paths so the extension self-heals without a reload or popup ritual.

## Root causes fixed

- A stale current-version HUD `data-state="tool-stalled"` could be read back by Live Sentinel as watchdog truth even after fresh tool progress had recovered.
- Health Core and Live Sentinel could both repaint the same current HUD, producing mixed clocks/state and stale hidden metadata.
- Tab-presentation signatures were cached before Chrome proved the managed-group move succeeded, so one transient group API failure could make the wrong bucket sticky indefinitely.
- An old pre-upgrade Sentinel listener could briefly win a state reply/push race after hot injection and regress a recovered tab.

## Implemented

- Health Core v8 is the single current HUD renderer; Sentinel only patches legacy HUDs.
- Sentinel re-derives stall/dead/provider failure state from current evidence and imports only capacity state from the current content-owned HUD.
- Sentinel publishes a sanitized transition event; content performs an urgent bounded health refresh so visible HUD state converges promptly.
- Fresh Sentinel working/tool-running state clears an older content-loop stall while real current stalls and capacity attention remain protected.
- Managed-group reconciliation returns explicit success/failure, verifies the physical bucket, and commits presentation cache only after success.
- Failed managed-group reconciliation schedules a bounded repair; live Pulse also audits Constellation-owned group drift and self-heals it.
- User-created groups remain untouched. Active and Needs Attention managed groups expand when used.
- Background rejects stale Sentinel versions for both pushed state and direct reads, forcing the current hot-upgrade path.
- Continuation docs no longer hardcode `brain/v0.14.0` as the newest brain.

## Verification so far

Targeted unit/browser coverage is green for the exact screenshot regression, transient group-failure recovery, Live Sentinel, live health stability, Runway Sentinel hot upgrade, live Chat state, 320-turn capture, popup, Pulse UX, Tab Beacons, and Approval Recovery No Surprise Navigation.

The exact state-convergence fixture starts with an old danger HUD and fresh `Inspecting ModForge source and report formats` progress. Canonical state must recover to `tool-running`; a legacy HUD must visibly repair; a current v8 HUD must not be mutated by Sentinel.

The group convergence contract forces one Chrome group mutation to fail, proves that failure is not cached as success, then proves the identical healthy state retries and reaches Active. A user-created group is never moved.

## Verified convergence boundary

- Unit/contract suite, validation contracts, and development build pass.
- All 27 smoke workflows pass. The broad `npm run verify` wrapper reached the execution tool's 120-second wall after smoke 8/27; the remaining workflows were continued from that exact durable log boundary in bounded gates rather than rerunning the monolith.
- Drive checkpoint folder: `1eOuf6Q713B05Z6C851hAxiSnwLGOgg1P`.
- Round-trip-verified checkpoint: `Project-Constellation-v0.14.10-state-convergence-targeted-green.tgz`, 3,726,467 bytes, SHA-256 `23f2a1c04e455d422c1968b5ee876727348c8171a6af7511818b38f43b9de54a`.

## Next gate

Freeze the final source delta, publish through branch -> PR clean-room CI -> squash merge -> production release. Redownload/hash production bytes, publish them to the v0.14.10 Drive folder, and append the ACTIVE CHECKPOINT.
