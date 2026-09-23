# ChatGPT Scheduled Task Rescue

This tool repairs ChatGPT **Scheduled** tasks that become stuck in states such as:

- This task needs your attention
- Follow-up
- Permission required / Approval required
- Paused / Disabled when the task is not an intentional tombstone

It preserves intentional `REPLACED —`, `RETIRED —`, and `LEGACY —` tombstones.

## Current architecture

The old datacenter-browser design was retired after ChatGPT/Cloudflare verification rejected the GitHub-hosted browser.

The supported design is now:

1. **GitHub heartbeat — external/online**
   - Workflow: `.github/workflows/chatgpt-local-rescue-heartbeat.yml`
   - Public, non-secret heartbeat: Project Constellation issue #40
   - Refreshes every five minutes.
2. **Windows local rescue agent**
   - Installed under `%LOCALAPPDATA%\ProjectConstellation\ChatGPTRescueAgent`.
   - Runs every minute and at logon through Windows Task Scheduler.
   - Uses a dedicated persistent Chrome profile under
     `%LOCALAPPDATA%\ProjectConstellation\ChatGPTRescueChrome`.
3. **Real local Chrome**
   - Chrome is launched normally on the user's Windows machine with a localhost-only CDP port.
   - The rescue worker attaches over CDP rather than launching a datacenter browser.
   - ChatGPT sees the user's normal machine/network/session.
4. **Recovery worker**
   - Opens `https://chatgpt.com/schedules`.
   - Finds blocked non-tombstone task cards.
   - Selects persistent permission choices when the UI offers them.
   - Approves and resumes/retries/enables the task.
   - Rechecks until the blocker is gone or reports the exact remaining blocker.

No ChatGPT cookies, passwords, 2FA codes, or browser storage are stored in GitHub.

## Install on Windows

Run `install-local-agent.ps1` from this directory, or download the current script from the repository and run it in PowerShell.

The installer:

- verifies/installs Node.js LTS with winget when needed;
- verifies/installs Google Chrome when needed;
- downloads the current rescue worker and agent files;
- installs the Node dependency;
- creates the dedicated persistent Chrome profile;
- registers `Project Constellation - ChatGPT Scheduled Rescue` in Windows Task Scheduler;
- starts the agent immediately.

On first run, the dedicated Chrome profile opens ChatGPT Scheduled. Sign in normally there once. If ChatGPT asks for a normal browser verification, complete it in that **local** Chrome window. The next one-minute run continues automatically.

## Status

Run:

```powershell
.\status-local-agent.ps1
```

The status command shows the Windows task state, last result, next run, latest agent state, recent repaired task titles, remaining blockers, and recent agent log lines.

## Uninstall

Run:

```powershell
.\uninstall-local-agent.ps1
```

Add `-RemoveChromeProfile` only if the dedicated ChatGPT rescue Chrome profile should also be deleted.

## Tests

The CI workflow `.github/workflows/chatgpt-ui-scheduler-rescue.yml` performs:

- JavaScript syntax validation;
- the complete in-memory Needs attention -> Allow all actions -> Allow -> Resume fixture;
- a real Chrome DevTools Protocol integration test that launches Chrome, attaches the rescue worker over CDP, and requires the blocker to disappear;
- Windows PowerShell syntax validation for the installer/status/uninstaller.

The CI workflow does **not** attempt to sign into ChatGPT from a GitHub datacenter browser.
