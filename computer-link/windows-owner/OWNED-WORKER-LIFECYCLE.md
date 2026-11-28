# Owned worker lifecycle primitive (2026-11-20)

Scope: internal Windows owner process lifecycle support. Not a live MCP connection, not a distributed executable, not an installer or permission change.

`OwnedWorker::launch` creates a specified absolute trusted executable suspended, configures a fresh unnamed kill-on-close job, assigns the process before any application code runs, and resumes only after assignment succeeds. It invokes no shell, inherits no handles, sets no breakaway, installs nothing, and never restarts a process. Arguments are encoded with Windows CRT quoting and NUL/length rejection. Environment, working directory and user token still inherit; this is lifecycle containment, **not process isolation**. The caller must select a fixed trusted executable; arbitrary executable input must never be exposed as an MCP capability.

Owner now retains an optional worker. Disconnect attempts BOTH snapshot revocation and process-tree termination, even if one path fails. Job active-process accounting must reach zero and the root handle must signal before cleanup succeeds. Any uncertainty leaves a sticky fence requiring owner exit; launch errors conservatively fence too. Drop makes a bounded cleanup attempt, then closing the job handle supplies kill-on-close. No running external MCP host, browser, or existing user process is adopted or terminated.

Synthetic tests added: argument encoding/rejection, repeated stop, kill on wrapper Drop, child/grandchild job containment and termination, unrelated-worker survival, active-pipe plus owned-worker Disconnect with no implicit relaunch, launch failure fencing. Fixtures execute only the current test binary and have bounded 30-second sleep fallbacks. A descendant-start test uses a 5-second deadline, not indefinite polling.

Independent review found three blockers and fixes were applied before approval for source-only CI: revoke/cleanup ordering, descendant termination confirmation, and uncertain failed-launch cleanup fencing.

## Unfinished and explicitly not claimed
- Existing MCP executable remains launched by its host, not automatically by the tray.
- No stdio routing/inherited-pipe design, destination-aware consent, host registration or UI launch added.
- No live endpoint, secret, forwarding, persistent grant, owner installation or artifact publication.
- Windows-target `cargo check --locked --all-targets` passes using Rust 1.99.0; it does not run Windows code. No Windows execution result yet at this checkpoint. Synthetic CI must pass before any claim of working Windows behavior.
- Failure injection, abrupt tray-process termination, native GUI Exit/Disconnect with this worker, and actual bridge/host integration are untested.
- Existing public deployment gates remain intact.
