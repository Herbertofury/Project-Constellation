# Recovery

## Recovery order

1. Preserve the current browser profile/extension installation; do not uninstall first.
2. Export the local brain from the side panel if Home is still usable.
3. Record extension version/ID and current Drive/GitHub receipts.
4. Prefer a verified newer local record; otherwise restore/merge from the latest verified Drive snapshot and journal.
5. Rebuild the search index (automatic after Drive restore).
6. Reopen provider chats and use explicit Full Capture for gaps.
7. Run integrity scan and compare counts/receipts before clearing the incident.

Drive restore validates metadata size, downloads bytes, checks SHA-256 when present, decompresses/validates schema, merges newer records store by store, applies only a journal compatible with the recovered full snapshot, rebuilds search, and writes a restore receipt.

## Safe handoff

Execution Pulse’s Secure Handoff creates a local checkpoint and copies bounded Markdown containing the latest project/chat continuity. When Drive is available, it attempts a verified sync and reports whether remote verification succeeded; local checkpoint success is not misreported as Drive success.

Execution Pulse’s always-present **Branch & continue** action builds that checkpoint on demand, opens the provider's normal new-chat page, transfers the bounded continuation through the visible native composer, and records parent/child/checkpoint lineage after the provider assigns a new chat ID. It never writes over existing composer text. If the provider changes its composer or send control, Constellation leaves the handoff visibly prefilled or copies it for manual paste and labels the outcome honestly; the original checkpoint remains recoverable.

## Repository recovery assets

- `releases/v0.13.0/` contains the original v0.13 receipts/evidence.
- `brain/v0.13.0/` contains the authoritative v0.13 handoff/compass/status state.
- `recovery/imports/v0.13.0-local-unpacked/` preserves the local base.
- `recovery/imports/v0.7.0-local-unpacked/` preserves the older local comparison.
- `recovery/projectdump-migration/` preserves all Project Constellation-specific ProjectDump state without bringing unrelated ProjectDump projects into this repository.

Imported recovery trees are evidence, not current source. Current runtime source is only `extension/`.

## Disaster recovery acceptance

A recovery is complete only when version, extension ID, chat/turn/file counts, integrity state, latest checkpoint, Drive receipt/hash, and repository release metadata agree. Keep the evidence in the matching versioned release directory.
