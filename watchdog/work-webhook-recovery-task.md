# External Recovery Bridge — GitHub PR Activity -> ChatGPT Work

## Purpose

This is the bridge between the independent GitHub Actions scheduler and ChatGPT's own automation control plane.

The external workflow `.github/workflows/external-chatgpt-scheduler-rescue.yml` runs every 10 minutes on GitHub-hosted infrastructure. When `watchdog/heartbeat.json` becomes stale or unreadable, it creates or updates a pull request titled:

`[Watchdog] External ChatGPT scheduler recovery pulse`

The PR branch is:

`watchdog/external-recovery-pulse`

Repeated recovery checks update `watchdog/resume-pulse.json` on that branch, producing pull-request commit activity.

## ChatGPT Work event-triggered task

Create one event-triggered Work task bound to GitHub pull-request activity for the repository:

`Herbertofury/Project-Constellation`

Trigger on pull-request activity for the recovery PR, including new commits/updates. Narrow by PR title when the UI allows it:

`[Watchdog] External ChatGPT scheduler recovery pulse`

### Recovery prompt

When this GitHub recovery PR changes, treat it as an external wake signal that the normal ChatGPT scheduled-task system may be stalled.

FIRST use native ChatGPT automation controls only. Do not use GitHub, Drive, Gmail, Outlook, Plugin Management, web, skills, or other connectors before the automation repair phase completes.

1. Inspect the complete live scheduled-task set, including disabled tasks, last_run_time, cadence, timing mode, and titles.
2. Keep intentional tombstones whose titles begin REPLACED —, RETIRED —, or LEGACY — disabled.
3. For every other permanent recurring task, repair unexpected disablement, pauses, malformed schedule, accidental completion, or stale execution state.
4. is_enabled=true is not enough. If last_run_time failed to advance for at least two expected intervals or the task is stuck in Follow-up/needs-attention, preserve its COMPLETE prompt/scope/schedule, create a clean replacement that preserves every capability, tombstone the poisoned instance, and leave the replacement enabled.
5. Never fix permission failures by deleting functionality. Preserve Google Drive/Sheets, GitHub, email, testing, publication, repositories, Drive IDs, recipient addresses, and acceptance criteria.
6. Do not invoke a provider known to trigger interactive approval during this recovery wake. Queue mandatory blocked external actions in Google Sheet `Scheduled Tasks — Pending External Actions` ID `12ovNEfPKp7gM6StGic7K2GvpvHBJyW_gsKNSse34eV8` instead of dropping them.
7. Ensure Scheduled Task Watchdog and Scheduled Task Failsafe are enabled and retain their zero-capability-loss recovery rules.
8. Finish the recovery task without asking the user. A healthy no-op is success.

The GitHub Actions supervisor will close the recovery PR/incident after the committed ChatGPT heartbeat becomes healthy again.

## Important platform boundary

This bridge uses a supported GitHub pull-request event to wake ChatGPT Work. It does not store ChatGPT cookies, session tokens, or OAuth secrets.

Connected-app permissions, workspace controls, and action approvals still apply inside ChatGPT. The external GitHub runner cannot override or mutate ChatGPT workspace/app approval policy; its job is to keep a separate online scheduler alive and generate the supported recovery event.
