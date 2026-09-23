# ChatGPT Scheduled-Task UI Rescue

This worker targets the **Scheduled page itself**. It does not use the ChatGPT permission-setting API.

Every run:

1. Opens `https://chatgpt.com/schedules` in an authenticated Chromium session.
2. Finds task cards showing **This task needs your attention**, **Needs attention**, **Follow-up**, **Permission required**, **Action required**, or **Approval required**.
3. Opens the affected task card.
4. Uses the approval UI shown inside that task, including persistent choices such as **Allow all actions**, **Always allow**, **Never ask**, or **Don't ask again** when the task presents them.
5. Clicks **Allow / Approve / Confirm / Continue**.
6. Clicks **Resume / Retry / Continue / Run now / Enable / Turn on** as needed.
7. Returns to Scheduled and verifies the blocker disappeared.
8. Repeats until no matching blocked task remains or no further progress is possible.

## Authentication

The online runner needs the same authenticated ChatGPT browser state as the account that owns the tasks.

Run once on Windows:

```powershell
powershell -ExecutionPolicy Bypass -File .\bootstrap-auth.ps1
```

A Chromium window opens. Sign into ChatGPT normally and leave the Scheduled page visible. The bootstrap stores the resulting browser storage state in the encrypted GitHub Actions secret `CHATGPT_STORAGE_STATE_B64`, then deletes the local state file.

The secret is never committed to the repository and the rescue workflow never prints it.

## Target filtering

By default the worker repairs every blocked Scheduled task.

Set workflow input `target_tasks` to a comma-separated list to restrict it, for example:

`Minecraft Mod Catalogue Updater,Scheduled Task Watchdog`

## Exit status

- 0: all targeted blocked cards were cleared or none were blocked.
- 2: ChatGPT authentication bootstrap/refresh required.
- 3: at least one targeted card remains blocked after all supported UI actions were attempted.
