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

The page HUD correlates mounted DOM progress, passive provider network evidence, current visible agent/tool step summaries, stored turn state, capacity thresholds, and integrity findings. Its expanded default view shows **Observed now**, observable-confidence sources, and a seven-row local activity ledger covering response changes, tool steps, page status, recovery, handoff, and sanitized request start/response/completion events. It detects running, quiet, stalled, dead, approval-blocked, rate-limited, auth-required, unavailable, stale-page, degraded-render, and capacity-handoff conditions.

The HUD never sends provider requests and never claims access to hidden model reasoning. Site-background/history/session traffic stays visible as auxiliary activity but cannot be used as proof that an agent is working. Healthy status can be hidden; corner, density, thresholds, and watchdog behavior are configurable.

### Chat Pulse Context Lens

The popup Chat Pulse and the collapsed in-page Pulse navigator share one canonical live-tab snapshot. Opening Active, Needs Attention, or Completed shows every matching open chat with a compact three-level row: the provider/browser title, a bounded task context line, then project/provider/state/model/group metadata. When the browser title is vague, the task line uses the latest locally captured user request; active chats can additionally show the current observable tool label as `Now: …`. Completed chats retain `Last task · …` so a finished tab is still recognizable later.

Project names come from Constellation’s existing local workspace/provider catalog. A user-created Chrome tab group remains explicitly a **Group**, not a guessed project. Context enrichment is local IndexedDB work only: capture maintains a bounded latest-user excerpt for fast reads, older records use a bounded reverse lookup, and no new provider-page request or transcript-wide scan is introduced by opening Pulse.

### Output Vault

The permanent **⇄ Output Vault** control opens a second owned surface beside Execution Pulse. A shared dock temporarily compacts Pulse and always stacks the vault above or below it according to the configured corner; live resize measurements reserve Pulse space in normal, collapsed, mobile, and full-workspace modes. The vault lists every captured assistant output with searchable text, code blocks, links, generated media, files/builds, and distinct revision history. Reader mode reconstructs captured semantic headings, paragraphs, emphasis, lists, quotes, tables, inline/fenced code, links, and compact agent-activity groups; Raw mode preserves the exact flattened text view. Older output cards stay collapsed and defer rich-text construction until opened. Media preview is lazy: opening the vault does not fetch remote images, video, or audio. Inline `data:` media is retained in a bounded embedded file record; ordinary remote and `blob:` media keeps its captured reference and dimensions.

At a hydrated conversation bottom, outside active generation, Constellation compares a bounded fingerprint of the mounted tail against its durable best revisions. If a refresh removes a response or replaces a complete answer with a shorter/tool-only state, the Pulse becomes **Saved output is missing**, Needs Attention includes the chat, and affected vault cards show **Saved richest revision** beside **Currently rendered**. The saved version can be copied individually, exported with the complete vault as Markdown, or used to branch into a continuation. Constellation never writes the saved copy back into the provider DOM.

**Branch & continue** is always available in the Pulse, so a conversation can be continued early instead of waiting for a provider limit. It creates a durable checkpoint, opens a fresh chat for the same provider, transfers bounded continuation context through the provider's native composer, and links the child chat to its parent/project. The button gains urgency at the secure-handoff threshold but is never hidden before it. Constellation will not overwrite an occupied composer and reports `sent`, `prefilled`, or `copied` according to the outcome it can actually observe.

Needs Attention settings use accessible ON/OFF switches. Every change is autosaved through a serialized background mutation, while each section also offers an explicit Save Settings button and live saved/saving/error feedback. Reloaded Home pages render directly from the persisted settings response.

## Recovery and durability

- Two-phase browser-refresh recovery for delivery failures (never a blind Retry click).
- Approval Recovery for ChatGPT connected-app prompts with explicit risk acknowledgement, immediate current-card detection, provider-specific conversation-wide permission selection, bounded retry, and post-click clearance confirmation.
- Safe handoff Markdown/checkpoints plus one-click branch-and-continue before or after a long conversation reaches proactive thresholds.
- Immutable per-turn revision capture, bounded rendered-tail snapshots, and Output Vault compare/export/branch recovery for provider-side output loss.
- Google Drive full snapshot plus incremental journal, SHA-256 descriptions, metadata verification, byte-size verification, and round-trip reads.
- Optional GitHub mirror with device OAuth, refresh rotation, repository discovery, and verified commit receipts.

## Performance engine

Long-task pressure measurement automatically disables only decorative `aria-hidden` provider motion/blur while pressure is high. Mutation capture is idle-scheduled, nested-root deduplicated, pressure-aware, and bounded. Repeated semantic upserts are coalesced before runtime messaging, tool evidence scans are cached and dirtied by relevant DOM changes, and HUD DOM writes are change-gated. Hidden tabs disconnect broad capture observation and use slow health/status pulses; a separate narrowly filtered approval observer remains available so an opted-in permission card cannot silently strand work.

## Visual identity and accessibility

Owned UI uses deep midnight/navy surfaces, violet/electric-blue accents, restrained glow, and high-contrast text. Sparse composited star layers drift slowly behind an equally restrained SVG constellation field; animation uses only transform/opacity and never captures pointer input. `prefers-reduced-motion` disables animation, while low-core/low-memory devices use a static or absent effect. Native ChatGPT content is never recolored by the theme.
