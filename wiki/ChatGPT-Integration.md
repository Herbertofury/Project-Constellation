# ChatGPT.com compatibility

Project Constellation treats ChatGPT’s web UI as a changing provider surface, not a stable internal API.

## Current verified contracts

Live compatibility was checked against `https://chatgpt.com/` on 2026-08-24. Current conversation turns use `data-testid="conversation-turn-N"` containers with nested `data-message-author-role` and `data-message-id`. The composer exposes a visible contenteditable element with role `textbox` and accessible name **Chat with ChatGPT**; the similarly named textarea can be hidden. Streaming exposes a visible **Stop answering** control and/or busy/streaming attributes.

Current agent activity uses legacy generic `group/tool-message` rows alongside concise step summaries styled with tertiary text classes; the active summary uses `loading-shimmer-tertiary`. Constellation prefers the active concise summary (for example, an observable “Inspecting…” or “Implementing…” label), deduplicates nested copies, and keeps generic `Called tool` rows only as bounded step-count evidence.

The selector strategy prefers top-level conversation-turn containers, then falls back to role/message IDs. This prevents duplicate capture from nested current markup. Root-path anonymous conversations receive an in-tab session ID so they are not mistaken for the empty Home screen.

ChatGPT project routes shaped as `/g/g-p-...` are treated as provider project identities. Visible project-sidebar entries are mirrored into Constellation’s project catalog so project discovery is not limited to whichever ChatGPT tab happens to be foregrounded.

## What Constellation observes

- chat links and route changes;
- rendered user/assistant turn containers plus structured text, links, code, images, video, audio, documents, and generated-output metadata;
- attachment/download/link evidence;
- visible status, approval, delivery failure, rate-limit, auth, and unavailable surfaces;
- visible agent/tool step summaries, tool-state evidence, and sanitized passive request lifecycle from the service worker;
- a bounded local activity ledger for response DOM changes, page status, tool progress, handoff/recovery, and request start/response/completion;
- a hydrated, bottom-of-conversation output-tail fingerprint used to detect missing or meaningfully shortened assistant revisions after a refresh;
- lightweight per-tab reliability state for every already-open ChatGPT conversation, including hidden/background tabs.

The content runtime does not patch ChatGPT JavaScript, does not remove messages, and does not depend on undocumented ChatGPT backend APIs. It cannot see private chain-of-thought and never pretends otherwise. Request URLs and prompt content are not placed in the HUD ledger; only a sanitized category, lifecycle phase, method/status, and duration are exposed. History/sidebar/session traffic is auxiliary and cannot prove that the model is alive.

The Pulse's **Branch & continue** control uses only an explicit user click, the normal ChatGPT new-chat route, and the visible native composer. It waits for the usable composer/send control, dispatches native input events, confirms a send from observable composer/route changes, and then links the resulting chat ID to the source checkpoint. It does not call a hidden conversation API, overwrite existing draft text, or claim success from a click alone.

The Pulse's permanent **⇄ Output Vault** control reads only Constellation's captured IndexedDB state. The service worker keeps each distinct turn revision and prevents a lower-richness assistant observation from replacing the richest canonical output. During changed-turn ingestion, the content runtime also serializes the mounted semantic answer container into bounded Markdown so Reader mode can reproduce ChatGPT-like headings, emphasis, lists, quotes, tables, code, and links without storing executable HTML. Comparison is suppressed during streaming, before hydration, and while browsing away from the bottom. Vault and Pulse use coordinated isolated shadow DOMs, share a measured collision-free dock, and never insert recovered content into ChatGPT's conversation tree. Remote media preview is user-triggered so simply opening the vault creates no ChatGPT or media traffic.

## Browser-wide reliability supervisor

v0.16 separates reliability monitoring from the broad foreground capture loop. Every already-open ChatGPT tab has a lightweight supervisor that continues evaluating when the document is hidden. A Manifest V3 service-worker alarm enumerates all open ChatGPT tabs, wakes their supervisor, and can hot-bootstrap the supervisor into tabs that were already open when the extension updated.

When **Refresh Recovery** is enabled, Constellation may automatically rescue an unfinished existing conversation after an explicit message-delivery/connection/response/send failure, a corroborated dead/stalled state that exceeds the dead threshold, or two hours without meaningful progress on an unresolved user/running turn. Completed idle chats do not qualify.

Before reload, current visible state is checkpointed. After the existing tab reloads and the native composer hydrates, Constellation inserts a continuity-safe prompt that preserves the exact objective, accepted decisions, project/repository/file/Drive/GitHub identities, paths, hashes, run/job IDs, tests already passed, blockers, no-repeat history, and exact unfinished next action. The prompt treats the last attempted tool/write side effect as potentially partial and requires verification before repeating it.

Automatic recovery is bounded by cooldown and per-chat attempt caps. It does not create or focus a missing chat, does not overwrite a non-empty composer, and does not blindly reload auth-required, rate-limited, unavailable, or approval-blocked states.

## Approval and recovery

Approval Recovery recognizes both accessible dialogs and the current ordinary inline provider card (for example, **Allow ChatGPT to use GitHub?**). A narrow approval-only observer reacts when a usable prompt mounts, including in a background tab. It finds ChatGPT's split **Allow ▾** control by semantics, DOM proximity, and geometry; opens its portalled menu; prefers the provider-specific **Allow [provider] for this conversation** option (plus equivalent Always allow/Never ask variants); and falls back to the main Allow action only when the saved setting permits it.

Always-allow behavior remains off until the user explicitly acknowledges its risk. A click is not treated as success: the approval card must visibly disappear, otherwise the attempt is reported as failed and retried with a bounded backoff.

In v0.16, approval execution still has a single owner: the existing tested in-page `PC_APPROVAL_RECOVERY_SCAN` handler. The browser-wide approval supervisor enumerates all open ChatGPT tabs and fans that handler out concurrently with per-tab in-flight guards. This removes the old serial/foreground bottleneck without introducing a second competing permission-button click path. Rate-limit signals still enter the provider request governor and stop Constellation-originated background work during cooldown.

## Maintaining compatibility

When ChatGPT changes:

1. Reproduce on the live site without inspecting cookies, session storage, passwords, or private profile data.
2. Capture accessibility and non-sensitive DOM attribute evidence.
3. Update provider-specific selectors with semantic fallbacks.
4. Add a minimized current-DOM fixture under `tests/smoke/`.
5. Verify exactly-once turns, composer preservation, status/tool behavior, background-tab supervision, no content-script provider API fetch, and bounded message counts.
6. Run the complete suite and update the “current verified” date.

`tests/smoke/chatgpt_current_dom_smoke.py` is the turn/composer compatibility sentinel. `tests/smoke/approval_recovery_smoke.py` covers the current generic-card, nested icon-only split button, portalled provider menu, and mutation-triggered automatic approval contract. `tests/smoke/multitab_reliability_smoke.py` launches the packaged extension in extension-capable Chromium, keeps one ChatGPT tab in the background, and requires both stale unfinished chats to reload and actually send the continuation prompt.
