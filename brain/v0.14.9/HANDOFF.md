# Project Constellation v0.14.9 handoff

## Objective

Make provider delivery failures as observable and trustworthy as stalls without sacrificing v0.14.8's No Surprise Navigation invariant.

## Implemented

- Distinct `delivery-timeout`, `connection-interrupted`, `response-interrupted`, and `send-failed` health/chat states.
- Current-turn ownership for error surfaces: an old timeout/error banner before the newest user frontier is ignored.
- Interruption state overrides stale provider `running` evidence and persists through Sentinel/Health/Pulse arbitration.
- Execution Pulse reports the exact failure, time since detection, preserved partial-response characters, prior tool activity, and whether the provider exposes a native recovery control.
- The popup can expose Retry for a failed already-open chat when the provider itself exposes Retry/Try again/Regenerate/Resend/Reconnect.
- Retry is **explicit-user-only**. Detection, health scans, notifications, Approval Recovery, and background reconciliation never click Retry automatically. This avoids duplicating side effects from tool/app calls that may already have completed before delivery failed.
- Explicit retry revalidates the current failure and provider control immediately before one click. It does not create/focus/navigate/reload/recreate a ChatGPT surface.
- Approval Recovery reports interruptions as Needs Attention instead of treating delivery timeout as generic refresh-required.
- Native one-shot attention notifications use failure-specific titles and truthful recovery guidance.
- Runway Sentinel stall/no-progress/capacity behavior remains intact.

## Verification checkpoint

- 9/9 unit/contract suites pass, including `tests/interruption-safety.test.mjs`.
- 26/26 browser smoke workflows pass when executed as bounded gates.
- Exact screenshot-shaped `interruption_guardian_smoke.py` proves: current delivery timeout detected, partial output retained, no provider click during detection, one explicit Retry click, recovery back to running, the three other interruption classes, and historical-timeout immunity.
- Existing 121-second frozen-tool regression still becomes `tool-stalled`.
- Existing 270-turn hot-upgrade regression still becomes `capacity-handoff`.
- 15 legacy smoke harnesses now honor `PROJECT_CONSTELLATION_CHROMIUM`, eliminating accidental dependency on an unrelated Playwright-downloaded browser.
- Durable Drive checkpoint: `v0.14.9-interruption-guardian-bounded-green.tgz`, SHA-256 `028d6b6471c89b3b76fe20c50cf7593101d2046869a792ee863e99d8938b5b35`, 3,716,500 bytes in Drive folder `1j6lIbR3RS7wVKHTJW_j4jYanfKtduqEg`.

## Next gate

Create the production build/package from this coherent state, run the fast local contracts again, then publish through branch -> PR clean-room CI -> squash merge -> production release. Redownload and hash the production release assets, persist them to the v0.14.9 Drive folder, and update the ACTIVE CHECKPOINT.
