# Performance behavior

The main risk is doing too much work on rapidly mutating AI pages. v0.14 reduces that risk while keeping capture and health responsive.

## Content-path budgets

- No content-script network requests.
- Mutation work is coalesced through `requestIdleCallback` (timeout fallback 120ms).
- Pending roots are nested-root deduplicated and capped at 40; overload collapses to one main/document scan.
- Capture scans only added/changed roots, not the whole document on every mutation.
- Tool evidence uses targeted selectors, scans at most the last 220 candidates, and is cached until relevant mutations dirty it.
- Semantic events are batched (up to 120 per message) rather than sent one by one.
- Hidden tabs disconnect the mutation observer and slow health/status timers to 30 seconds.
- Default Execution Pulse cadence is 2.5 seconds while active and 12 seconds while idle.
- Service-worker health context is cached for five seconds.

## Starfield budget

The atmospheric background is one pointer-free pseudo-element with sparse radial gradients and a single `translate3d` animation over 95–115 seconds. It does not animate particles individually. Reduced-motion disables animation. Devices reporting four or fewer logical cores or 4 GB or less device memory use a static layer; effects can be removed entirely.

## Pressure relief

The Performance Engine watches long tasks in a rolling window. When adaptive motion relief is enabled and measured pressure is high, it shortens only decorative `aria-hidden` animation. It never hides, virtualizes, or deletes provider conversation content.

## Request governance

Background provider reads are serialized per provider, enforce minimum intervals, use freshness windows/conditional headers, honor Retry-After, and back off on 429/errors. Global connection refresh does not fan out provider HTTP probes; explicit provider checks do.

## Verification

`content_smoke.py` exercises 320 mounted turns and asserts full retention, bounded runtime messaging, and zero page errors. `live_health_smoke.py` verifies progress/stall transitions at configured fast test cadence. The default production cadence remains slower.
