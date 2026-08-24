# Project Constellation v0.11.0 — Atlas + Chat Guardian

This release finishes the two continuity features requested after the v0.10 long-chat failure.

## Knowledge Graph / Atlas
- First-class searchable entities: recommendations, URLs, artifacts/files, repositories, packages/mods, code, decisions, TODOs, versions, commands, project state and checkpoints.
- Conversation provenance is preserved on captured entities.
- Incremental append-only ingestion of newly completed assistant turns.
- Stable content-fingerprint dedupe.
- Local IndexedDB storage and low-overhead toolbar search popup.
- No full-database prompt injection and no all-history rescan just to redraw Home.
- Existing Project Constellation capture/headless pipeline can feed bounded resumable backfill batches; a manual `Index loaded chat` action handles the current DOM.

## Chat Guardian
- Premium configurable bottom-corner HUD.
- Response activity, tool activity, quiet/thinking and apparent-stall states.
- Conservative degraded-view warning and best-effort newer-page-build signal.
- Optional coding/developer-context indicator.
- Conversation runway meter with warn / critical / handoff thresholds.
- Automatic local safety checkpoint at the handoff threshold.
- One-click Save checkpoint and Copy handoff.
- Explicit no-auto-retry / no-auto-resubmit policy.

## Verification
- `npm test`: 4/4 pass.
- Static package verification: pass.
- Runtime JS syntax checks: pass.
- ZIP integrity: pass.
- Chromium visual preview was attempted but the container browser stalled on D-Bus initialization; live ChatGPT visual/runtime success is therefore not claimed yet.

Artifact SHA-256: `36f9c37eee9a76ef61dbe1a58eb2e759fcbdfead7f4a62d8ae24a0ad41a1d16f`.
