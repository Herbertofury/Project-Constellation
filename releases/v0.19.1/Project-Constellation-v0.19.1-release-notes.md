# Project Constellation 0.19.1

Project Constellation 0.19.1 is the recovery-efficiency hotfix for the unified 0.19 desktop + browser release. It preserves all 0.19.0 behavior while stopping unchanged Scheduled/recovery state from causing repeated checks.

## Recovery efficiency

- Replaces the Scheduled self-healer's fixed one-minute repeating alarm with adaptive one-shot fallback checks: 2 minutes while the Scheduled page is still loading, 5 minutes during an active recovery, 10 minutes when attention exists, 15 minutes while a real permission/security/user-draft hold exists, and 30 minutes when idle.
- Migrates any old repeating `pcx-schedule-recovery-v2` alarm on service-worker startup instead of leaving the old cadence behind after upgrade.
- Debounces Scheduled DOM changes and sends a compact meaningful-state signature. Repeated mutations that do not change task/approval/run/recovery state are ignored.
- Coalesces mutations that arrive during an inspection into at most one follow-up inspection rather than immediately starting a chain of duplicate cycles.
- Keeps manual **Check now** and real state transitions responsive; the longer timer is only a fallback safety net.
- Removes the Home recovery card's 1.1-second refresh loop. Approval-recovery and Scheduled-recovery cards now redraw from `chrome.storage.onChanged`, so the UI reacts to actual state changes without polling.

## Safety preserved

- No permission, approval, login, browser-verification, draft, or ambiguous-control bypass was added.
- Side-effect intent is still persisted before clicks and actions remain deduplicated by task/run/action fingerprint.
- The stable Constellation extension identity and Commander-derived desktop bridge protocol are unchanged.

## Verification

- Added recovery polling policy and static regression coverage that rejects a one-minute repeating recovery alarm, rejects the old Home 1.1-second recovery loop, and requires DOM-signature deduplication.
- Full root regression/validation/build/smoke and retained desktop reliability suites are release gates for this hotfix.
