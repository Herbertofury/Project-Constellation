# ChatGPT.com compatibility

Project Constellation treats ChatGPT’s web UI as a changing provider surface, not a stable internal API.

## Current verified contracts

Live compatibility was checked against `https://chatgpt.com/` on 2026-08-24. Current conversation turns use `data-testid="conversation-turn-N"` containers with nested `data-message-author-role` and `data-message-id`. The composer exposes a visible contenteditable element with role `textbox` and accessible name **Chat with ChatGPT**; the similarly named textarea can be hidden. Streaming exposes a visible **Stop answering** control and/or busy/streaming attributes.

The selector strategy prefers top-level conversation-turn containers, then falls back to role/message IDs. This prevents duplicate capture from nested current markup. Root-path anonymous conversations receive an in-tab session ID so they are not mistaken for the empty Home screen.

## What Constellation observes

- chat links and route changes;
- rendered user/assistant turn containers and structured links/code;
- attachment/download/link evidence;
- visible status, approval, delivery failure, rate-limit, auth, and unavailable surfaces;
- visible tool-state evidence and passive network timing from the service worker.

The content script makes no network calls, does not patch ChatGPT JavaScript, does not remove messages, and does not depend on undocumented ChatGPT backend APIs.

## Approval and recovery

Approval Recovery searches accessible dialogs/menus for connected-app approval semantics. Always-allow behavior is disabled until the user explicitly acknowledges its risk. Delivery failures request a controlled browser refresh; Constellation never loops on ChatGPT’s Retry button. Rate-limit signals enter the provider request governor and stop Constellation-originated background work during cooldown.

## Maintaining compatibility

When ChatGPT changes:

1. Reproduce on the live site without inspecting cookies, session storage, passwords, or private profile data.
2. Capture accessibility and non-sensitive DOM attribute evidence.
3. Update provider-specific selectors with semantic fallbacks.
4. Add a minimized current-DOM fixture under `tests/smoke/`.
5. Verify exactly-once turns, composer preservation, status/tool behavior, no content-script fetch, and bounded message counts.
6. Run the complete suite and update the “current verified” date.

`tests/smoke/chatgpt_current_dom_smoke.py` is the compatibility sentinel for the current markup.
