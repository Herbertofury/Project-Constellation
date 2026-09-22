# Scheduled Task Watchdog

This is a two-layer watchdog for the user's recurring ChatGPT scheduled tasks.

## Layer 1 - ChatGPT self-healing watchdog

The ChatGPT automation named **Scheduled Task Watchdog** runs every 6 hours. It audits the complete live scheduled-task set, repairs recurring or indefinite tasks that unexpectedly become disabled or drift from their intended cadence, and leaves intentionally deleted/retired tasks alone.

Only after a successful audit and recheck does it update:

- `watchdog/heartbeat.json`

That heartbeat intentionally contains no task contents, credentials, or secrets.

## Layer 2 - independent GitHub-hosted watchdog

`.github/workflows/chatgpt-task-watchdog.yml` runs independently on GitHub-hosted infrastructure every 6 hours. It checks the heartbeat age. If the heartbeat is older than the configured threshold (18 hours by default), it opens and assigns a GitHub issue titled:

> External watchdog detected stale ChatGPT task heartbeat

When the heartbeat recovers, the workflow closes that alert issue automatically.

The workflow also updates `watchdog/external-alive.json` once per UTC day. This provides visible proof the external monitor itself is still running and creates regular repository activity. GitHub documents that scheduled workflows in public repositories can be auto-disabled after 60 days without repository activity, so the keepalive is intentionally part of the design.

## Cost and credentials

This implementation uses the public Project Constellation repository and standard GitHub-hosted Actions. It does not call the OpenAI API, does not require an OpenAI API key, and does not store any third-party secrets.

## Important boundary

GitHub cannot directly mutate ChatGPT scheduled tasks because there is no external scheduled-task control API exposed here. The internal ChatGPT watchdog performs the repair; the GitHub watchdog independently detects when that internal repair loop stops producing a heartbeat and raises an external alert.
