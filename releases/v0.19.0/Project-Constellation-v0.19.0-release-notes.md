# Project Constellation 0.19.0

Project Constellation 0.19.0 unifies the Project Constellation browser extension and Commander 0.7.4 desktop runtime into one product.

## Unified desktop + extension

- Commander 0.7.4 is now the `desktop/` runtime for Project Constellation rather than a separate product.
- The existing Project Constellation extension is the only browser companion; the retired standalone Commander extension is not shipped.
- The desktop bridge trusts the stable Project Constellation extension identity and retains the proven loopback/session-token/per-chat-nonce protocol.
- Existing Commander state and application identity remain compatible so saved tasks, local Work settings, and desktop state migrate without a destructive reset.

## Current ChatGPT site compatibility

- Scheduled-task navigation now uses the current canonical `https://chatgpt.com/schedules` route.
- Legacy Scheduled aliases are still normalized by observers for compatibility.
- The scheduled-task adapter no longer depends on a private ChatGPT bearer-token/session endpoint for recovery.

## Scheduled Task Control Center + self-healing

- Home and side panel now expose **Self-heal interrupted runs**, manual recovery, observed-task inventory, active-recovery count, permission-hold count, and desktop-runtime connectivity.
- Recovery opens the existing Follow-up/Resume flow, persists action intent before clicking, and deduplicates side effects.
- Genuine sign-in, security approval, permission, browser-verification, user-draft, ambiguous-UI, and missing-input states are held rather than bypassed.
- When an authorized permission prompt is cleared, Constellation keeps the same run under observation and resumes safe continuation instead of abandoning the task.

## Verification focus

0.19.0 retains the Commander 0.7.4 durability/reliability suite, Constellation regression suite, strict extension-origin bridge checks, browser-extension-to-desktop disk E2E coverage, and browser smoke coverage for Scheduled recovery and the Task Control Center.
