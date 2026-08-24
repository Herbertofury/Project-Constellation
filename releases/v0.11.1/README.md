# Project Constellation v0.11.1 — Atlas + Chat Guardian

Continuity patch after the long conversation died at the platform limit. It implements both pending blue-message commands and preserves the older v0.11.0 checksum-only lineage instead of overwriting it.

## Atlas / durable project memory
- First-class searchable entities: recommendations, URLs, artifacts/files, repositories, packages/mods, code, decisions, TODOs, versions, commands, project state and checkpoints.
- Exact conversation provenance on captured evidence where available.
- Incremental ingestion of newly completed assistant turns with stable content fingerprints.
- Local IndexedDB knowledge graph and fast search popup.
- No full-history rescan to redraw Home and no entire-database prompt injection.
- Bounded resumable backfill integration contract for Project Constellation's existing capture/headless pipeline.

## Chat Guardian / long-chat protection
- Premium configurable bottom-corner HUD.
- Thinking, active response, tool activity, apparent stall, refresh-recommended, degraded-view and limit states.
- Best-effort developer/coding-context and newer-page-build indicators.
- Estimated conversation runway with warn / critical / handoff thresholds.
- Automatic local safety checkpoint at handoff threshold plus one-click Save checkpoint and Copy handoff.
- Never auto-resubmits prompts or retries tool calls.

## Verification
- `npm test`: 4/4 pass.
- `npm run verify`: pass.
- Runtime JS syntax checks: pass.
- ZIP integrity: pass.
- Live logged-in ChatGPT visual verification is **not claimed**: Chromium preview in the build container stalled during D-Bus initialization.

## Reassemble GitHub multipart artifact
On Windows CMD from this directory:

```bat
copy /b Project-Constellation-v0.11.1-Atlas-Chat-Guardian.zip.part00+Project-Constellation-v0.11.1-Atlas-Chat-Guardian.zip.part01+Project-Constellation-v0.11.1-Atlas-Chat-Guardian.zip.part02+Project-Constellation-v0.11.1-Atlas-Chat-Guardian.zip.part03+Project-Constellation-v0.11.1-Atlas-Chat-Guardian.zip.part04 Project-Constellation-v0.11.1-Atlas-Chat-Guardian.zip
```

Expected SHA-256: `e8bad053b611497884cf79356533df88cffec17fa7528a56becb12e254009924`.
