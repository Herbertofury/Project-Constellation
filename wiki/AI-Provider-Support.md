# AI provider support

Project Constellation integrates with consumer AI chat websites through the page the user already opened. It passively captures mounted conversation content, identifies durable chat routes where the provider exposes them, and can perform an explicit user-started Full Capture. It does not send extra model requests from its content script.

## Authentication truth

- **Signed in** means an open provider tab exposes a usable chat surface without visible sign-in controls.
- **Guest ready** means the page is usable anonymously but still offers sign-in. Guest chats may lack durable server history and receive a stable in-tab Constellation session ID.
- **Sign in required** means the provider redirected to or rendered authentication without a usable composer.
- **Check session** means Constellation has not observed enough evidence to claim either state.

Google Drive and GitHub are the only app-level OAuth integrations. AI provider account login stays inside each provider’s website. No provider is described as having an official conversation-history API when it does not.

## Supported sites

| Provider | Official web surface | Constellation connection | Durable discovery |
|---|---|---|---|
| ChatGPT | `chatgpt.com` | Browser session or guest | Routes, browser history, live capture, ChatGPT export import |
| Claude | `claude.ai` | Browser session | Routes, browser history, live/manual capture |
| Gemini | `gemini.google.com` | Browser session | Routes, browser history, live capture, Google Takeout path |
| Grok | `grok.com` | Browser session or guest | Routes when available, browser history, live/manual capture |
| DeepSeek | `chat.deepseek.com` | Browser session | Routes, browser history, live/manual capture |
| Perplexity | `perplexity.ai` | Browser session or guest | Search/page routes, browser history, live/manual capture |
| Microsoft Copilot | `copilot.microsoft.com` | Browser session or guest | Routes, browser history, live capture, Microsoft account export path |
| Le Chat | `chat.mistral.ai` | Browser session | Routes, browser history, live/manual capture |
| Poe | `poe.com` | Browser session | Chat routes, browser history, live/manual capture |
| Meta AI | `meta.ai` | Browser session | Live/manual capture; account export path where offered |
| Qwen Chat | `chat.qwen.ai` | Browser session or guest | Routes when available, browser history, live/manual capture |
| Kimi | `kimi.com` | Browser session | Routes when available, browser history, live/manual capture; current guest composer is login-gated on submit |
| Character.AI | `character.ai` | Browser session | Chat routes, browser history, live/manual capture |
| HuggingChat | `huggingface.co/chat` | Browser session | Conversation routes, browser history, live/manual capture |
| You.com Chat | `you.com/chat` | Browser session | Chat/search routes, browser history, live/manual capture |
| Pi | `pi.ai` | Browser session or guest | Routes when available, browser history, live/manual capture |
| Duck.ai | `duck.ai` | Local guest session | Live/manual capture only; no remote-history claim |

## Selector resilience

The capture engine favors semantic markers such as message roles, message IDs, provider-defined test IDs, custom elements, and accessible article labels. ChatGPT gets a stricter top-level turn selector to avoid nested duplicate capture. Other providers share bounded fallbacks and provider-specific selectors; route changes degrade to an in-tab session ID rather than merging unrelated conversations or claiming success without turns.

Website UIs change independently of the extension. A provider is considered healthy only when its open-tab check and an actual capture produce the expected state/turn records. Report selector drift with the provider, URL shape, visible symptom, and Constellation version—never include conversation text or account credentials.

## Current reliability and shared-capability work record

The v0.25.0 candidate keeps original observation time and authority through
the full Chromium extension, browser sensor and native bridge. Weak fallback
evidence cannot clear a confirmed incident or manufacture a new confirmed run.
Delayed metadata or presentation work must recheck the latest accepted context.
Closed-document reconciliation retains lifecycle ordering across offline work
and hub restarts. These are tested metadata contracts; they do not establish
live health for every supported provider or the owner's signed-in profiles.

Current proof is linked from [MONITOR-VERIFICATION.md](https://github.com/Herbertofury/Project-Constellation/blob/main/docs/MONITOR-VERIFICATION.md),
the [release notes](https://github.com/Herbertofury/Project-Constellation/blob/main/docs/v0.25.0-release-notes.md) and the matching completed GitHub
workflow/receipt. Preserve provider coverage and distinct native, installed-MV3,
Electron and rendered-page acceptance lanes. The next provider work is to
capture authorized, sanitized evidence of a specific current UI drift and add
its exact regression before broadening any detector.

The Athena shared-capability registry was reviewed at
`10dfc3592967f7b4e291a2e1fb87edd54f758111`. The existing
`engineering.release-checkout` validator is reused and refreshed. For
`engineering.browser-runtime-proof`, the candidate
[Ferrum Lightpanda adapter](https://github.com/Herbertofury/Ferrum-Browser/blob/687e7a509f8af5ef9401bf905bdc87e32d8645e6/src/browser/lightpanda.mjs)
was inspected at its exact source pin. It supplies a headless-page CDP route;
equivalence for installed MV3 service workers, browser audio/offscreen documents,
native messaging and Electron has not been established. Constellation retains
its existing real Chromium/Electron/native gates. A future shared adapter trial
must pass those unchanged contracts on the same workload before adoption.
No duplicate browser harness or speculative replacement is introduced here.

This document owns the local M2/M3 provider/browser-proof work. The portfolio's
older version label is historical inventory; the accepted GitHub release and
its source-bound receipts establish the current Constellation version. Share
verified reusable contract changes through the canonical Athena capability
record; do not copy a weaker acceptance route into this project to claim parity.
