# ChatGPT Scheduled Task Recovery Protocol

This directory is the durable external recovery brain for the ChatGPT Scheduled Task Watchdog.

## Goal

Keep recurring ChatGPT automations working even when a scheduled execution loses context, a connector action changes, a permission-management endpoint fails, a task is unexpectedly paused, a prompt is damaged, a remote write fails, or a run stalls.

## Recovery order

1. **Do real work first.** A worker must never gate its real task on Plugin Management.
2. **Use available native tools directly.** GitHub and Google Drive are primary durable state/persistence connectors. Web, Files/Library, Gmail, Outlook, automations, and other available tools may be used when their task needs them.
3. **Never ask for permission in an unattended run.** The stored automation prompt is standing user authorization for the actions explicitly described by that task. If the platform itself requires interactive confirmation, skip only that blocked optional step and continue every unblocked step.
4. **Email is last and non-blocking.** A mail approval failure cannot invalidate completed project/catalogue/research work.
5. **Repair recurring task state.** Unexpected disabled/paused state, prompt truncation, stale schedule/cadence, or accidental completion must be repaired when the recurring intent is explicit.
6. **Preserve scope.** Never replace a rich task with a summary. Patch only the damaged section and preserve repositories, Drive IDs, safety/quality gates, schedules, publication rules, and acceptance criteria.
7. **Change strategy after repeated failure.** Do not retry an unchanged broken endpoint indefinitely. Use a different supported route, preserve partial progress, and move on.
8. **Checkpoint externally.** Record last-known-good task definitions, failure fingerprints, current blocker, last durable checkpoint, and exact next action in this repository and mirror material state to the connected Drive when possible.
9. **Recover Project Constellation work.** When a task/project has a Project Constellation checkpoint or known repository/Drive identity, treat that checkpoint as the resume watermark. Repair from the latest durable state instead of restarting discovery.
10. **Never self-disable.** A healthy no-op, temporary provider failure, missing optional email, or completed single run must leave recurring services enabled.

## Failure classes the watchdog must handle

- permission-management 404 or unavailable action
- connector transient/rate-limit/provider error
- OAuth truly disconnected
- scheduled task unexpectedly disabled/paused
- malformed or drifted schedule
- prompt damage/truncation or lost standing rules
- repeated unchanged failure / no-progress stall
- GitHub/Drive publication mismatch
- missing build/checkpoint/evidence
- changed tool name/schema
- stale heartbeat
- lost Project Constellation continuation state

## External GitHub monitor

`.github/workflows/chatgpt-watchdog-external.yml` runs independently of ChatGPT. It checks the committed ChatGPT heartbeat. If the heartbeat becomes stale or malformed, it opens/updates a GitHub issue that serves as an external recovery queue item. When the heartbeat becomes healthy again, it closes the stale-heartbeat issue.

GitHub cannot directly force an arbitrary ChatGPT conversation to resume without a supported ChatGPT automation/webhook API. Its role is to make watchdog failure externally visible and preserve enough recovery state that the next healthy watchdog or project chat can resume without rediscovery.

## Security

Never commit passwords, tokens, cookies, OAuth secrets, private session data, or full private task contents that do not belong in the repository.

## Interactive-attention poison rule

A scheduled worker must never invoke an action that is known to require interactive approval and then expect to recover from the returned error. ChatGPT can suspend the run before the action returns, producing **This task needs your attention / Follow-up** and preventing downstream recovery logic from executing.

Therefore:

- prevent the gated call **before invocation**;
- while Gmail/Outlook are not app-specific **Allow all actions**, unattended workers must not call them at all;
- the scheduled-task result is the delivery channel until mail full access is actually confirmed;
- `is_enabled=true` is not proof of health: if `last_run_time` stops advancing for at least two expected intervals while future runs remain scheduled, treat the instance as poisoned/stalled;
- recover a poisoned worker by preserving its complete prompt/schedule/scope, creating a clean replacement with interactive deadlocks removed, and tombstoning the old instance as `REPLACED — ...` so watchdogs never resurrect it.
