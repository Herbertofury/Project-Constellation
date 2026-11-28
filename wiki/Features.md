# Features

## Workspace and organization

Home provides cross-provider search, projects/groups, smart collections, pinned/favorite chats, artifact lineage, activity, attention queues, and configurable workbench panels. **Project Atlas** groups work by project and then Active / Needs attention / Completed / Archived state, while **Project Brain** compiles a bounded working context from source-backed Knowledge Vault records. A **Living Project Room** layers next actions, decisions, live work, coordination signals, latest artifacts, evidence, and project-scoped search over that brain. The **Safe Router** can rank likely project homes locally, but it never auto-assigns: Confirm and manual Move are the only assignment paths, while Not this project records a fingerprint-specific dismissal. v0.17 adds the **Dependency Brain**, version awareness, cross-chat handoffs, duplicate-work prevention, What Changed, bounded per-chat Context Packets, and Guarded Project Autopilot. The giant Project Brain still accumulates reusable project-wide lessons; Context Packets are merely smaller chat-specific projections. Knowledge Vault continues to preserve the detailed local records for decisions, recommendations, links, code, commands, versions, packages, media, and follow-ups.

## Capture modes

- **Passive mounted capture:** observes only DOM nodes already rendered by the provider.
- **Zero-tab catalogue:** combines the local catalogue, optional browser history, and governed authenticated HTML reads; it does not open hidden tabs.
- **Full Capture:** an explicit user-initiated visible window that walks conversation history when a complete provider API/export is unavailable.
- **Import/export:** local brain snapshots and supported provider export workflows.

Coverage labels are explicit: metadata-only, server-rendered content, partial DOM walk, full DOM walk, or export-derived. Constellation does not label partial capture as complete.

## Execution Pulse

The page HUD correlates mounted DOM progress, passive provider network evidence, current visible agent/tool step summaries, stored turn state, capacity thresholds, and integrity findings. Its expanded default view shows **Observed now**, observable-confidence sources, and a seven-row local activity ledger covering response changes, tool steps, page status, recovery, handoff, and sanitized request start/response/completion events. It detects running, quiet, stalled, dead, approval-blocked, rate-limited, auth-required, unavailable, stale-page, degraded-render, and capacity-handoff conditions.

The HUD never sends provider requests and never claims access to hidden model reasoning. Site-background/history/session traffic stays visible as auxiliary activity but cannot be used as proof that an agent is working. Healthy status can be hidden; corner, density, thresholds, and watchdog behavior are configurable.

### Live severity lanes and instant alerts

Live chats use five distinct underlying states: **🔴 Critical**, **🛡️ On Hold**, **⚠️ Needs Attention/Stale**, **🟣 Active**, and **✅ Completed**. ChatGPT's explicit “Our systems are thinking a bit more about this request before responding” review surface maps to 🛡️ blue On Hold and does not participate in stall escalation. The detailed state appears in the title/favicon beacon, Constellation-owned native Chrome group, toolbar badge, and popup Chat Pulse. The tiny collapsed in-page Pulse intentionally compresses those states to **Active · Needs · Done** so it stays readable: `Needs` is the sum of Critical + 🛡️ On Hold + Stale, and opening it still shows each row's real substate. When the hold surface clears, Constellation issues a one-shot review-cleared notification. Constellation also issues its own local completion and Critical transition notifications, backed by compact browser-session transition state so service-worker suspension does not erase the prior state. Alerts only focus an existing tab when clicked and never trigger provider-side actions automatically.

**Chrome Stability Guard** keeps this presentation path idempotent: an unchanged title/favicon/group does not get rewritten, Constellation-owned group events do not fan out into global presentation invalidation, and title/Pulse/health observers stay scoped to relevant surfaces instead of waking on unrelated provider DOM churn. Completed native groups are not automatically collapsed; a one-time v0.17.4 migration expands groups previously collapsed by Constellation and then leaves collapse/expand entirely to the user. This preserves the status UX while preventing self-amplifying browser work across many open chats.

### Chat Pulse Context Lens

The popup Chat Pulse and the collapsed in-page Pulse navigator share one canonical live-tab snapshot. Opening Active, Needs Attention, or Completed shows every matching open chat with a compact three-level row: the provider/browser title, a bounded task context line, then project/provider/state/model/group metadata. When the browser title is vague, the task line uses the latest locally captured user request; active chats can additionally show the current observable tool label as `Now: …`. Completed chats retain `Last task · …` so a finished tab is still recognizable later.

Project names come from Constellation’s existing local workspace/provider catalog. Native managed groups default to **Project + state** when that identity is known, with a State-only compatibility option. A user-created Chrome tab group remains explicitly a **Group**, not a guessed project, and is never stolen by automatic sorting. Context enrichment is local IndexedDB work only: capture maintains a bounded latest-user excerpt for fast reads, older records use a bounded reverse lookup, and no new provider-page request or transcript-wide scan is introduced by opening Pulse.

The side-panel Pulse/Command view also has a **Current Chat** project shortcut. It detects the exact active supported conversation, shows its current Constellation project, lists user-created projects, supports **Create + add**, and can change/remove assignment. The backend rechecks the exact active tab and chat ID at commit time, so switching chats while the chooser is open fails safely instead of filing the wrong conversation.

### Dependency Brain + Guarded Project Autopilot

- **Dependency Brain:** relates bounded source-backed project evidence and marks downstream nodes as possibly stale when newer version/dependency evidence supersedes an observed input.
- **Version awareness:** groups project and artifact version evidence into observed families, preserving both current-observed and older-observed history.
- **Cross-chat handoffs:** proposes relevant completed/parallel evidence to another project chat with provenance; no handoff text is silently written to a provider.
- **Duplicate-work prevention:** compares only bounded active/attention work and surfaces likely overlap for user review instead of stopping or redirecting chats automatically.
- **What changed:** stores a project watermark and reports meaningful changes since the last explicit caught-up action.
- **Context Packets:** select task-relevant evidence plus reusable project-wide lessons such as performance, compatibility, workflow, testing, recovery, and release patterns. Chats still contribute normally to the giant Project Brain; the packet is a bounded projection, not a separate silo.
- **Guarded Project Autopilot:** may detect, prepare, prioritize, and propose. Any proposal that would write provider-chat text must be reviewed and explicitly approved. Exact approved text is hash-checked before staging into the exact already-open chat, occupied composers are preserved, and Constellation never presses Send. Denied proposals remain denied for that fingerprint unless the user deliberately changes the decision.

### Output Vault

The permanent **⇄ Output Vault** control opens a second owned surface beside Execution Pulse. A shared dock temporarily compacts Pulse and always stacks the vault above or below it according to the configured corner; live resize measurements reserve Pulse space in normal, collapsed, mobile, and full-workspace modes. The vault lists every captured assistant output with searchable text, code blocks, links, generated media, files/builds, and distinct revision history. Reader mode reconstructs captured semantic headings, paragraphs, emphasis, lists, quotes, tables, inline/fenced code, links, and compact agent-activity groups; Raw mode preserves the exact flattened text view. Older output cards stay collapsed and defer rich-text construction until opened. Media preview is lazy: opening the vault does not fetch remote images, video, or audio. Inline `data:` media is retained in a bounded embedded file record; ordinary remote and `blob:` media keeps its captured reference and dimensions.

At a hydrated conversation bottom, outside active generation, Constellation compares a bounded fingerprint of the mounted tail against its durable best revisions. If a refresh removes a response or replaces a complete answer with a shorter/tool-only state, the Pulse becomes **Saved output is missing**, Needs Attention includes the chat, and affected vault cards show **Saved richest revision** beside **Currently rendered**. The saved version can be copied individually, exported with the complete vault as Markdown, or used to branch into a continuation. Constellation never writes the saved copy back into the provider DOM.

**Branch & continue** is always available in the Pulse, so a conversation can be continued early instead of waiting for a provider limit. It creates a durable checkpoint, opens a fresh chat for the same provider, stages bounded continuation context for review through the provider's native composer, and links the child chat to its parent/project. The extension never clicks Send; the user reviews/edits and uses the provider Send control personally. The button gains urgency at the secure-handoff threshold but is never hidden before it. Constellation will not overwrite an occupied composer and reports `prefilled` or `copied` according to the outcome it can actually observe; automatic `sent` transitions are no longer a supported extension action.

Needs Attention settings use accessible ON/OFF switches. Every change is autosaved through a serialized background mutation, while each section also offers an explicit Save Settings button and live saved/saving/error feedback. Reloaded Home pages render directly from the persisted settings response.

## Recovery and durability

- Two-phase browser-refresh recovery for delivery failures (never a blind Retry click).
- Approval Recovery for ChatGPT connected-app prompts with explicit risk acknowledgement, immediate current-card detection, provider-specific conversation-wide permission selection, bounded retry, and post-click clearance confirmation.
- Safe handoff Markdown/checkpoints plus one-click branch-and-continue before or after a long conversation reaches proactive thresholds.
- Immutable per-turn revision capture, bounded rendered-tail snapshots, and Output Vault compare/export/branch recovery for provider-side output loss.
- Google Drive full snapshot plus incremental journal, SHA-256 descriptions, metadata verification, byte-size verification, and round-trip reads.
- Optional GitHub mirror with device OAuth, refresh rotation, repository discovery, and verified commit receipts.

## Performance engine

Long-task pressure measurement automatically disables only decorative `aria-hidden` provider motion/blur while pressure is high. Mutation capture is idle-scheduled, nested-root deduplicated, pressure-aware, and bounded. Repeated semantic upserts are coalesced before runtime messaging, tool evidence scans are cached and dirtied by relevant DOM changes, and HUD DOM writes are change-gated. Hidden tabs disconnect broad capture observation and use slow health/status pulses; a separate narrowly filtered approval observer remains available so an opted-in permission card cannot silently strand work. Project routing and multi-chat coordination are local bounded organizer operations rather than live-provider capture work. A dedicated scale test exercises 500 projects and 10,000 chats and asserts hard result bounds plus runtime budgets so second-brain growth cannot quietly become a chat-stall path.

## Visual identity and accessibility

Owned UI uses deep midnight/navy surfaces, violet/electric-blue accents, restrained glow, and high-contrast text. Sparse composited star layers drift slowly behind an equally restrained SVG constellation field; animation uses only transform/opacity and never captures pointer input. `prefers-reduced-motion` disables animation, while low-core/low-memory devices use a static or absent effect. Native ChatGPT content is never recolored by the theme.
