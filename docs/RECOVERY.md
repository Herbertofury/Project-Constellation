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

## Automatic ChatGPT reliability rescue

When **Refresh Recovery** is enabled, v0.16 supervises every already-open ChatGPT conversation independently, including hidden/background tabs. The service worker periodically wakes each tab so browser visibility throttling does not turn foreground-tab monitoring into the only reliable path.

A chat is eligible for automatic rescue only when it is still unfinished and one of the bounded recovery conditions is met: an explicit message-delivery/connection/response/send failure, a corroborated dead/stalled state that has exceeded the dead-recovery threshold, or an unfinished user/running turn with no meaningful progress for two hours. Completed idle chats are not auto-continued.

Before a recovery reload, Constellation checkpoints the currently visible chat state. The affected existing tab is then reloaded and, after the native ChatGPT composer hydrates, receives a continuation prompt that preserves the exact project objective, decisions, repository/file/Drive/GitHub identities, paths, hashes, run/job IDs, tests already passed, blockers, no-repeat history, and exact unfinished next action. The prompt explicitly treats the final attempted write/tool action as potentially partially completed and requires verification before repeating it.

Recovery is loop-bounded by per-chat cooldown and attempt caps. Auth-required, rate-limited, unavailable, and approval-blocked states are not blindly reloaded. A non-empty composer is never overwritten; when a draft is present, automatic continuation stops and leaves the user's text intact.

Approval Autopilot remains a separate permission-recovery lane. When enabled and acknowledged, the service worker scans all open ChatGPT tabs concurrently but delegates actual permission execution to the established in-page recovery handler, preserving the configured persistent **Always allow** or allow-once behavior without competing click owners.

## Safe handoff

Execution Pulse’s Secure Handoff creates a local checkpoint and copies bounded Markdown containing the latest project/chat continuity. When Drive is available, it attempts a verified sync and reports whether remote verification succeeded; local checkpoint success is not misreported as Drive success.

Execution Pulse’s always-present **Branch & continue** action builds that checkpoint on demand, opens the provider's normal new-chat page, transfers the bounded continuation through the visible native composer, and records parent/child/checkpoint lineage after the provider assigns a new chat ID. It never writes over existing composer text. If the provider changes its composer or send control, Constellation leaves the handoff visibly prefilled or copies it for manual paste and labels the outcome honestly; the original checkpoint remains recoverable.

## Recover output lost after refresh

Open **⇄ Output Vault** from either the expanded Execution Pulse footer or its collapsed quick controls. A red/rose alert and affected cards mean the hydrated page tail is missing a saved assistant response or now exposes a meaningfully poorer revision.

1. Expand the affected card and compare **Saved richest revision** with **Currently rendered**.
2. Open **Versions** to inspect every retained distinct revision for that turn.
3. Use **Copy** for one output, **Copy full vault** for every richest assistant response, or **Download Markdown** for an offline recovery file.
4. Open captured files/links directly. Images, video, and audio preview only when clicked; inline embedded media can preview from its local record.
5. Use **Branch from saved** to create a normal continuation checkpoint and transfer the recovered context to a fresh provider chat.

Do not refresh repeatedly hoping the provider will restore the answer. Output Vault never claims the current provider transcript was repaired and never writes saved content back into it. Remote and `blob:` URLs are preserved as evidence, but only embedded inline media or independently durable external artifacts guarantee locally retained bytes.

## Repository recovery assets

- `releases/v0.13.0/` contains the original v0.13 receipts/evidence.
- `brain/v0.13.0/` contains the authoritative v0.13 handoff/compass/status state.
- `recovery/imports/v0.13.0-local-unpacked/` preserves the local base.
- `recovery/imports/v0.7.0-local-unpacked/` preserves the older local comparison.
- `recovery/projectdump-migration/` preserves all Project Constellation-specific ProjectDump state without bringing unrelated ProjectDump projects into this repository.

Imported recovery trees are evidence, not current source. Current runtime source is only `extension/`.

## Disaster recovery acceptance

A recovery is complete only when version, extension ID, chat/turn/file counts, integrity state, latest checkpoint, Drive receipt/hash, and repository release metadata agree. Keep the evidence in the matching versioned release directory.
