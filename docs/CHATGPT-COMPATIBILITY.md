# ChatGPT.com compatibility

Project Constellation treats ChatGPT’s web UI as a changing provider surface, not a stable internal API.

## Current verified contracts

The v0.14.4 compatibility contract uses ChatGPT's current conversation-turn articles (`data-testid="conversation-turn-N"`, `data-turn="user|assistant"`, and nested message-role/message-id attributes), the exact generation Stop control, current-answer Copy control, and a sanitized current-branch transcript proof path. The transcript path is stronger than a DOM-only Stop/busy heuristic because ChatGPT can leave controls or layout state mounted briefly after a response has actually finished.

Current agent activity uses legacy generic `group/tool-message` rows alongside concise step summaries styled with tertiary text classes; the active summary uses `loading-shimmer-tertiary`. Constellation prefers the active concise summary (for example, an observable “Inspecting…” or “Implementing…” label), deduplicates nested copies, and keeps generic `Called tool` rows only as bounded step-count evidence.

The selector strategy prefers top-level conversation-turn containers, then falls back to role/message IDs. This prevents duplicate capture from nested current markup. Root-path anonymous conversations receive an in-tab session ID so they are not mistaken for the empty Home screen.

## What Constellation observes

- chat links and route changes;
- rendered user/assistant turn containers plus structured text, links, code, images, video, audio, documents, and generated-output metadata;
- attachment/download/link evidence;
- visible status, approval, delivery failure, rate-limit, auth, and unavailable surfaces;
- visible agent/tool step summaries, tool-state evidence, and sanitized passive request lifecycle from the service worker;
- a bounded local activity ledger for response DOM changes, page status, tool progress, handoff/recovery, and request start/response/completion.
- a hydrated, bottom-of-conversation output-tail fingerprint used to detect missing or meaningfully shortened assistant revisions after a refresh.

The ordinary isolated content runtime makes no provider network calls, does not remove messages, and cannot see private chain-of-thought. ChatGPT has one deliberately narrow exception: `chatgpt-page-probe.js` runs in the page's MAIN world and may read the current same-origin conversation transcript to derive status metadata. It exposes only a sanitized envelope (message/current-node IDs, status, `end_turn`, model slug, async/widget state, semantic phase/tool count, and a numeric progress value only when ChatGPT provides one). Transcript text and authentication material never cross to the isolated extension runtime. If transcript proof is unavailable or stale relative to the newest visible user turn, Constellation falls back to exact current-turn DOM evidence. Sanitized request lifecycle remains telemetry and cannot by itself prove the model is alive.

The Pulse's **Branch & continue** control uses only an explicit user click, the normal ChatGPT new-chat route, and the visible native composer. It waits for the usable composer/send control, dispatches native input events, confirms a send from observable composer/route changes, and then links the resulting chat ID to the source checkpoint. It does not call a hidden conversation API, overwrite existing draft text, or claim success from a click alone.

The Pulse's permanent **⇄ Output Vault** control reads only Constellation's captured IndexedDB state. The service worker keeps each distinct turn revision and prevents a lower-richness assistant observation from replacing the richest canonical output. During changed-turn ingestion, the content runtime also serializes the mounted semantic answer container into bounded Markdown so Reader mode can reproduce ChatGPT-like headings, emphasis, lists, quotes, tables, code, and links without storing executable HTML. Comparison is suppressed during streaming, before hydration, and while browsing away from the bottom. Vault and Pulse use coordinated isolated shadow DOMs, share a measured collision-free dock, and never insert recovered content into ChatGPT's conversation tree. Remote media preview is user-triggered so simply opening the vault creates no ChatGPT or media traffic.

## Approval and recovery

Approval Recovery recognizes both accessible dialogs and the current ordinary inline provider card (for example, **Allow ChatGPT to use GitHub?**). A narrow approval-only observer reacts when a usable prompt mounts, including in a background tab, without keeping the broad capture observer active. It finds ChatGPT's split **Allow ▾** control by semantics, DOM proximity, and geometry; opens its portalled menu; prefers the provider-specific **Allow [provider] for this conversation** option (plus equivalent Always allow/Never ask variants); and falls back to the main Allow action only when the saved setting permits it.

Always-allow behavior remains off until the user explicitly acknowledges its risk. A click is not treated as success: the approval card must visibly disappear, otherwise the attempt is reported as failed and retried with a bounded backoff. Open ChatGPT tabs react immediately, and the existing single-window recovery sweep revisits known blocked/stale chats. Delivery failures request a controlled browser refresh; Constellation never loops on ChatGPT’s Retry button. Rate-limit signals enter the provider request governor and stop Constellation-originated background work during cooldown.

## Maintaining compatibility

When ChatGPT changes:

1. Reproduce on the live site without inspecting cookies, session storage, passwords, or private profile data.
2. Capture accessibility and non-sensitive DOM attribute evidence.
3. Update provider-specific selectors with semantic fallbacks.
4. Add a minimized current-DOM fixture under `tests/smoke/`.
5. Verify exactly-once turns, composer preservation, transcript/DOM state precedence, status/tool behavior, sanitized probe isolation, and bounded message counts.
6. Run the complete suite and update the “current verified” date.

`tests/smoke/chatgpt_current_dom_smoke.py` is the turn/composer compatibility sentinel. `tests/smoke/approval_recovery_smoke.py` includes the current generic-card, nested icon-only split button, portalled provider menu, and mutation-triggered automatic approval contract.

`tests/smoke/chatgpt_transcript_probe_smoke.py` verifies the sanitized transcript contract; `tests/smoke/live_sentinel_smoke.py` verifies transcript/DOM-independent state behavior and HUD stability; `tests/smoke/tab_beacon_smoke.py` verifies tab title/favicon ownership and restoration.
