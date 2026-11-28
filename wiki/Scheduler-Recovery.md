# Scheduler recovery

The external supervisor checks the last committed scheduler audit. A stale
record means fresh evidence is missing; it does not establish current ChatGPT
service health. Only an actual native scheduler audit may refresh the heartbeat.

In **Actions → External ChatGPT Scheduler Rescue**, read the run summary and
the retained `health.json` / `result.json` artifact. The run distinguishes a
fresh audit, a pending native audit, a blocked recovery channel and unexpected
failure. A successful supervising job may still report a policy-blocked PR
bridge; it never translates that into a repaired task.

The recovery incident is saved before optional PR or diagnostic work. Repeated
unchanged failures reuse it without comment spam. Diagnostic tests dispatch
once per audit episode, and failed attempts or PR pulses have a one-hour
cooldown recorded before the external action. The watchdog retries only the
latest default-branch failure or timeout, up to three total attempts. A newer
success or active run prevents retrying an obsolete failure.

GitHub's UI-rescue workflow runs isolated CI fixtures. It does not operate your
browser or demonstrate live scheduler repair. The separate local-agent wake
signal also does not prove that a task ran. Repository policy and user permission
decisions remain explicit; the supervisor does not change either.

See the complete [watchdog guide](https://github.com/Herbertofury/Project-Constellation/blob/main/docs/TASK-WATCHDOG.md)
for workflow roles, cadence, future/invalid timestamp handling, blocked-bridge
diagnosis and recovery boundaries. See [Recovery](Recovery) for project data
recovery and [Release process](Release-Process) for verified publication.
