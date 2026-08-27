# Project Constellation v0.14.7 handoff

Current release line: **v0.14.7 — Runway Sentinel**.

## Canonical continuation authority

- Repository: `Herbertofury/Project-Constellation`
- Base commit at start of this release: `0286951dbfd36a0e5949fa64878bef8156abf3be` (v0.14.6 Context Lens)
- Drive root: `1mUSeFlumpIOBtVCmlwbhN11kChRsdblV`
- Active checkpoint: `1cGHmUG-iMUnDoncLSWsZL9ZudZ80fltnYRn-Ogwd4rU`
- Drive checkpoint was still at v0.14.5 when this work resumed; GitHub v0.14.6 was the newer source delta.

## Release objective

Make chat-limit warning and stall detection trustworthy enough that the user does not need to watch ChatGPT manually. A long chat must remain long after reload, an unchanged spinner must not count as progress, total response duration must be visible independently from no-progress duration, and any proven stall/capacity warning must propagate to the same canonical state used by Chat Pulse and notifications.

## Implemented invariants

- Capacity evidence takes the maximum of stored, session/mounted, and ChatGPT full-active-branch counts/characters.
- ChatGPT MAIN-world transcript proof exports only bounded metadata; prompt/answer text and authentication data stay in MAIN world.
- Response timing uses current-branch response timestamps when available and does not mis-age regenerated assistant branches from an older user timestamp.
- Tool/transcript heartbeats require a changed progress signature; persistent busy/spinner state alone cannot reset `lastProgressAt`.
- v6 Tool Watchdog and Capacity Guard severity outrank the faster Sentinel lifecycle repaint.
- Hot upgrades inject the current Health Core alongside the Sentinel; already-open legacy tabs receive standalone v6 stall/capacity classification without a page refresh.
- Watchdog/capacity attention propagates from Execution Pulse into Live Sentinel → background live-tab map → Chat Pulse/toolbar/tab presentation.
- Native stall/runway alerts are transition-gated and independently configurable.
- Stored-capacity scans are bounded by a short aggregate cache to avoid O(chat) work on every streaming capture mutation.

## Verification already observed locally

- Core/unit suites pass after the v0.14.7 changes.
- Live Sentinel browser regression proves an unchanged tool label leaves `lastProgressAt` fixed while `elapsedMs`/`quietForMs` advance, then a real label change advances `lastProgressAt` and resets quiet age.
- The same browser regression proves a v6 `tool-stalled` HUD state becomes the Sentinel's canonical `healthState` with `healthStale=true` instead of being repainted active.
- ChatGPT transcript browser regression proves full-branch counts/chars/timestamps and verifies the mock access token never appears in serialized extension-visible state.
- Background browser regression proves completion notification remains intact and `capacity-handoff` becomes the stale/attention bucket plus a one-shot **Secure a chat handoff** notification.
- Popup and Pulse UX browser smokes remain green.
- Hot-upgrade browser regression proves an unchanged legacy tool state becomes `tool-stalled` after the configured hard silence window and a 270-turn pre-existing legacy tab becomes `capacity-handoff`, with the old HUD repaired in place and the handoff control exposed.

## Remaining finalization

1. Run the full validator/build/smoke matrix from the final source.
2. Commit through a feature/release branch, verify GitHub CI, merge to main, and run the production release workflow for `v0.14.7`.
3. Redownload and hash the production release artifacts.
4. Publish the complete v0.14.7 release bundle to the canonical Drive project area, verify readback/hashes, and update the ACTIVE CHECKPOINT to point at v0.14.7.
5. Reconcile GitHub main/tag/release, Drive, checksums, and this handoff before declaring current.
