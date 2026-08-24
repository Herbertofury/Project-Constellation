# Performance behavior

The main risk is doing too much work on rapidly mutating AI pages. v0.14 reduces that risk while keeping capture and health responsive.

## Content-path budgets

- No content-script network requests.
- Mutation work is coalesced through `requestIdleCallback` (timeout fallback 120ms).
- Pending roots are nested-root deduplicated and capped at 40; overload collapses to one main/document scan. During measured pressure, each pass is capped at 12 roots and defers nonessential chat-link/file catalogue scans until recovery while turn capture continues.
- Capture scans only added/changed roots, not the whole document on every mutation.
- Tool evidence uses targeted current-site selectors, scans at most the last 320 candidates, reduces nested duplicate labels, and is cached until relevant mutations dirty it.
- Semantic events are batched (up to 120 per message) rather than sent one by one, and repeated upserts for the same entity are coalesced before the message leaves the page.
- Hidden tabs disconnect the mutation observer and slow health/status timers to 30 seconds.
- Default Execution Pulse cadence is 2.5 seconds while active and 12 seconds while idle.
- Service-worker health context is cached for five seconds.
- HUD text/chips are changed only when their values differ; its activity ledger is capped at seven visible rows and rebuilt only when evidence or a five-second display bucket changes.

## Starfield budget

The atmospheric background is one pointer-free pseudo-element with sparse radial gradients and a single `translate3d` animation over 95–115 seconds. It does not animate particles individually. Reduced-motion disables animation. Devices reporting four or fewer logical cores or 4 GB or less device memory use a static layer; effects can be removed entirely.

## Pressure relief

The Performance Engine watches new long tasks in a rolling window without replaying buffered entries when a tab becomes visible again. When measured pressure is high, it automatically shortens only decorative `aria-hidden` animation and removes decorative `aria-hidden` blur work. The optional adaptive relief setting adds the same constraint to nested decorative motion. It never alters response text, progress labels, controls, or provider behavior and never hides, virtualizes, or deletes conversation content.

Pressure recovery writes metrics only on real metric/pressure changes rather than on every 500 ms recovery tick. Ordinary history/sidebar/session requests are classified as auxiliary traffic, so they cannot keep a stalled model falsely healthy.

## Request governance

Background provider reads are serialized per provider, enforce minimum intervals, use freshness windows/conditional headers, honor Retry-After, and back off on 429/errors. Global connection refresh does not fan out provider HTTP probes; explicit provider checks do.

## Verification

`content_smoke.py` exercises 320 mounted turns, a 120-node streaming burst, automatic decorative-pressure relief, native-control preservation, one-message coalescing for the burst, full retention, and zero page errors. `background_smoke.py` proves auxiliary history traffic cannot count as agent-bearing work. `live_health_smoke.py` verifies current agent-step markup, request lifecycle, the expanded ledger, progress/stall transitions, and stale-page recovery at configured fast test cadence. The default production cadence remains slower.
