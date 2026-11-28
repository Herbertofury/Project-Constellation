# Scheduled Task Watchdog

The external supervisor checks the most recent **committed scheduler audit**.
An old or invalid heartbeat means that fresh audit evidence is missing. It does
not establish an outage in ChatGPT or prove that any particular task is stopped.
Only a successful live audit through the native scheduler controls may refresh
`watchdog/heartbeat.json`. A release, a green CI run or a successful GitHub API
call must never fabricate that heartbeat.

## Current workflow roles

| Workflow | Purpose and configured cadence |
| --- | --- |
| `external-chatgpt-scheduler-rescue.yml` | Every ten minutes: validate the committed audit, preserve a recovery incident, supervise the PR event bridge and inspect bounded failed-watchdog retries |
| `chatgpt-watchdog-external.yml` | Hourly at minute 17: independently report an old/malformed committed audit in its existing issue |
| `chatgpt-local-rescue-heartbeat.yml` | Every five minutes: update the separate public local-agent wake signal in issue #40; this is not proof that the local agent or ChatGPT completed recovery |
| `chatgpt-ui-scheduler-rescue.yml` | Manually dispatched or source-triggered isolated fixture/CDP/Windows installation tests; it does not attach to the owner's browser from GitHub |
| `chatgpt-task-watchdog.yml` | Legacy compatibility notice pointing to the external supervisor; it no longer implements the old six-hour monitor or daily keepalive |

These are configured schedules, not guarantees of GitHub start times. The
live native ChatGPT task schedule must be inspected through its own controls;
repository documentation alone does not establish its current cadence.

## Read the outcome

Open **Actions → External ChatGPT Scheduler Rescue**. Each run retains
`health.json` and `result.json` in its `external-scheduler-recovery-*` artifact
and writes a readable summary. The health file records the actual audit age,
threshold, canonical UTC timestamp and an episode identifier. The result records
the independent incident, diagnostic-validation, PR-bridge and retry outcomes.

The default external threshold is 75 minutes. An explicit positive finite
`external_stale_after_minutes` in the heartbeat overrides it. Missing, malformed,
timezone-free and invalid-threshold evidence requires attention. A timestamp
more than five minutes in the future also requires attention rather than being
accepted indefinitely as healthy; small clock skew is shown as a negative age.
The independent hourly monitor shares this validation while retaining its own
`stale_after_hours` threshold (four hours by default). Runs using the updated
operational workflow definitions explicitly check out the current default branch,
including manual dispatches and reruns of those definitions, and retain separate
incidents. Rerunning a pre-fix historical execution retains its original workflow
revision; it does not acquire the repaired checkout step. After upgrading, start
a fresh dispatch on the default branch to use the new supervisor. GitHub documents
that [reruns retain the original event's commit and ref](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs).

| Result | Meaning |
| --- | --- |
| `healthy-audit` | The committed audit is fresh and valid; matching external incidents and pulse PRs were closed |
| `awaiting-native-audit` | Inspection was requested or remains in its cooldown; actual native task recovery has not been established |
| `blocked` | The incident is preserved, but repository policy or token permissions block a recovery channel; the summary remains explicit even when the supervising job completes successfully |
| `failed` | An unexpected API/persistence/cleanup failure occurred; the job fails and retains its evidence |

## Recovery without repeated repository activity

The supervisor creates or refreshes the incident **before** trying optional
diagnostic dispatch or PR work. GitHub denying PR creation therefore cannot
prevent the incident from being recorded. Existing open incidents are searched
through the full paginated inventory, excluding pull requests with a matching
title. Unchanged failures reuse that incident and do not append repeated comments.

Each recovery episode is identified by its audit state, successful audit time
and threshold; time passing alone does not create another episode. The diagnostic
CI workflow is dispatched once per episode after acceptance. Failed requests and
uncertain interrupted attempts have a one-hour cooldown. PR pulses also use that
cooldown. A durable attempt claim is saved before each external side effect so a
runner crash cannot immediately cause another dispatch or pulse. A later valid
audit starts a new episode, and fresh healthy evidence closes the old records.

The watchdog retry lane examines only the latest run on the default branch.
It retries failure or timeout up to three total attempts. A newer success,
in-flight run, intentional cancellation or approval-required result prevents
retrying an obsolete failure behind it. Exhausted attempts remain visible.

## A blocked PR bridge

GitHub has a repository setting controlling whether Actions may create and
approve pull requests. Granting `pull-requests: write` in YAML does not by itself
override that setting. See GitHub's [workflow permission documentation](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository).

If the bridge reports `blocked`, review the actual repository policy through an
authorized administrative workflow. Constellation does not change permissions,
substitute a personal token or claim a successful PR from a denied request. The
incident remains available for the next authorized native scheduler audit. A
later permitted attempt resumes after its cooldown.

Diagnostic dispatch sends no undeclared `target_tasks` input. GitHub requires
[workflow dispatch inputs to match the target workflow](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event).
The target is a CI validation workflow; a successful dispatch is not proof that
its tests finished, and its tests are not a live scheduler repair.

## Credentials and execution boundaries

This supervisor uses its normal repository `GITHUB_TOKEN`. It does not call the
OpenAI API, store browser sessions, use private task prompts or operate the
owner's active desktop. GitHub cannot directly mutate native ChatGPT scheduled
tasks through this implementation. The authorized native audit follows
[`watchdog/recovery-protocol.md`](../watchdog/recovery-protocol.md), preserves
intentionally retired tasks, and records actual results before updating the
heartbeat. Never treat an enabled flag alone as execution proof.
