# Constellation Recommendation Atlas

> Project Constellation addon for durable, low-overhead recommendation memory.

This is an **addon**, not a 64th tracked project. It must preserve the existing 63-project catalog and act only as a recommendation/evidence index.

## Recovered historical hit

The strongest recoverable match for the GitHub JEI optimization recommendation from the July 2, 2026 hidden-gems thread is [JEIOptimizer](https://github.com/bigenergy/JEIOptimizer). The historical retriever preserved the date/topic but did **not** expose the original ChatGPT conversation URL, so the source link remains `unresolved` instead of being guessed.

## Core behavior

- Capture recommendation entities, not entire chat transcripts.
- Store the canonical project/mod URL and the originating ChatGPT conversation URL when available.
- Make the recommendation **name itself** the primary clickable link in all human-facing UI/docs.
- Keep secondary official links (GitHub, Modrinth, CurseForge, docs, releases) as explicit additional URLs.
- Track recommendation state separately from user decision state.
- Never promote `suggested` to `verified`, `installed`, or `worked` without evidence/user confirmation.
- Version- and project-scope every recommendation so old Forge 1.20.1 advice cannot silently bleed into another loader/version.
- Preserve contradictions as supersession history instead of overwriting the old record.
- Mark stale records; stale data remains searchable but is excluded from automatic context.

## Performance / anti-poisoning contract

1. **No global prompt injection.** Never append the full recommendation DB to every chat.
2. Retrieval is on-demand or narrowly triggered by relevant project/entity context.
3. Default retrieval is top-8 with a hard output budget; exact name/URL matches outrank semantic matches.
4. Local runtime storage should use IndexedDB with lightweight indexes; semantic vectors are optional, lazy, and background-only.
5. Observe only newly completed assistant messages. Do not repeatedly rescan full conversations.
6. Batch/debounce writes and sync during idle time. ChatGPT UI must never wait on Drive/GitHub sync.
7. Store compact excerpts/fingerprints, not full transcripts.
8. Backfill is chunked, resumable, and explicit; never run an all-history sweep on every startup.
9. Missing source URLs stay unresolved. Never fabricate provenance.
10. Recommendation memory cannot mutate the canonical Project Constellation project catalog by itself.

## Source-link capture

For future recommendations capture:

- `sourceChatUrl`
- `sourceConversationId` when derivable
- `sourceChatTitle`
- `sourceMessageFingerprint`
- `sourceTimestamp`
- compact `sourceExcerpt`

If ChatGPT exposes a stable message anchor, store it. Otherwise, link to the conversation and use the message fingerprint to locate/highlight the source message.

## State model

`suggested -> verified -> installed -> tested_good | tested_bad -> superseded`

The state machine is intentionally not automatic: user confirmation and runtime evidence outrank assistant recommendations.

## Data files

- `recommendation.schema.json` — record contract.
- `recommendations.seed.json` — seeded Minecraft performance recommendations from the current repair/research thread plus the recovered July 2 historical reference.

## Human dashboard

A Google Doc mirror lives in the Project Constellation Drive folder under **Recommendation Atlas - Chat Memory Addon**. It contains the memory-safety contract, seeded recommendations, and linked project/mod names.
