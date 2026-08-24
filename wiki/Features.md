# Features

## Workspace and organization

Home provides cross-provider search, projects/groups, smart collections, pinned/favorite chats, artifact lineage, activity, attention queues, and configurable workbench panels. Knowledge Vault derives bounded local records for decisions, recommendations, links, code, commands, versions, packages, media, and follow-ups.

## Capture modes

- **Passive mounted capture:** observes only DOM nodes already rendered by the provider.
- **Zero-tab catalogue:** combines the local catalogue, optional browser history, and governed authenticated HTML reads; it does not open hidden tabs.
- **Full Capture:** an explicit user-initiated visible window that walks conversation history when a complete provider API/export is unavailable.
- **Import/export:** local brain snapshots and supported provider export workflows.

Coverage labels are explicit: metadata-only, server-rendered content, partial DOM walk, full DOM walk, or export-derived. Constellation does not label partial capture as complete.

## Execution Pulse

The page HUD correlates mounted DOM progress, passive provider network evidence, visible tool activity, stored turn state, capacity thresholds, and integrity findings. It detects running, quiet, stalled, dead, approval-blocked, rate-limited, auth-required, unavailable, stale-page, degraded-render, and capacity-handoff conditions.

The HUD never sends provider requests. Healthy status can be hidden; corner, density, thresholds, and watchdog behavior are configurable.

## Recovery and durability

- Two-phase browser-refresh recovery for delivery failures (never a blind Retry click).
- Approval Recovery for ChatGPT connected-app prompts with explicit risk acknowledgement.
- Safe handoff Markdown/checkpoints before a long conversation reaches proactive thresholds.
- Google Drive full snapshot plus incremental journal, SHA-256 descriptions, metadata verification, byte-size verification, and round-trip reads.
- Optional GitHub mirror with device OAuth, refresh rotation, repository discovery, and verified commit receipts.

## Performance engine

Long-task pressure measurement can disable only decorative provider motion. Mutation capture is idle-scheduled, nested-root deduplicated, and bounded. Tool evidence scans are cached and dirtied by relevant DOM changes. Hidden tabs disconnect capture observation and use slow health/status pulses.

## Visual identity and accessibility

Owned UI uses deep midnight/navy surfaces, violet/electric-blue accents, restrained glow, and high-contrast text. Sparse composited star layers drift slowly behind an equally restrained SVG constellation field; animation uses only transform/opacity and never captures pointer input. `prefers-reduced-motion` disables animation, while low-core/low-memory devices use a static or absent effect. Native ChatGPT content is never recolored by the theme.
