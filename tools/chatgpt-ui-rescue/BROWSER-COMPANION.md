# Constellation Task Recovery 1.0.0

A browser-native controller for existing ChatGPT scheduled runs. No Desktop Commander, Node.js, Python, separate browser profile, API key or remote-control service is required to use the extension.

## One-time installation

1. Extract `Constellation-Task-Recovery-1.0.0.zip` into a permanent folder.
2. In the browser profile where you already use ChatGPT, open `chrome://extensions` (Chrome) or `edge://extensions` (Edge). Enable Developer mode, choose **Load unpacked**, and select the extracted **browser-companion** folder.
3. Open **Constellation Task Recovery** from the extension toolbar. It starts automatically, opens its own background Scheduled tab and inspects using your existing signed-in session.

Install alongside your existing Project Constellation extension, not over it. Keep the extracted folder in place. Do not run multiple recovery clickers against the same tasks simultaneously.

## Automatic recovery

The browser service worker recreates its one-minute alarm on startup. It identifies attention-marked tasks, opens their Follow-up control, waits for asynchronously mounted task/dialog screens, and clicks an unambiguous **Resume** or **Continue generating** control tied to the same run. If the assistant explicitly asks to continue that run and no security or missing-input question is present, the controller can send a preservation-focused continuation message.

Action intent is saved before clicking. A lost acknowledgement or service-worker restart does not blindly replay that click. Waiting sessions remain under observation while independent tasks are inspected. After legitimate consent or session state changes, safe continuation is checked again automatically.

Discovery includes scrolling and explicit task pagination. It reports coverage rather than claiming that an unknown page has no blockers. The 151-card regression fixture verifies there is no first-100-card limit.

## Task preservation

The companion does not change task prompts, schedules, IDs or history. It does not remove Google Sheets/Docs/Drive work, GitHub publication, tests or email requirements. It does not export cookies, credentials or chat content. Diagnostics remain in local extension storage unless you explicitly export them.

**Running observed** means the UI showed progress. **UI completion observed** requires a positive completed state. Neither proves Sheet writes, GitHub publication or email delivery; those remain the existing worker's verification obligations.

## Scope and current proof

This is an installable software package, **not a claim that it is already installed on your browser or that your live tasks are repaired**. It needs the browser running and a valid signed-in session. A browser alarm or GitHub heartbeat cannot operate a powered-off machine or grant account authorization.

It does not auto-click security approval, Allow/Approve/Confirm/Grant controls, bypass browser verification, grant itself permissions, manufacture missing input or re-enable intentionally paused tasks. A real authorization requirement, expired session, policy restriction or unsupported layout remains explicitly unresolved. The original task-list API did not expose the reason behind your Follow-up screen, so the cause cannot be assumed to be ordinary interrupted generation.

Local validation covers 26 policy tests, 14 controller tests and 20 real-Chromium DOM fixture cases. The controller harness uses Chrome API stand-ins. The DOM runner uses in-memory pages and an injected Location dependency because the test container's browser policy blocks URL navigation and extension installation. Those restrictions were not changed or bypassed. A separate native-extension test is included for supported environments. Authenticated live-account execution is not verified by fixture tests.

## Controls

**Inspect now** runs an inspection without creating another scheduled task. **Pause recovery** stops new actions and removes only this companion's alarm. **Inspect this run** opens a preserved run page. The diagnostic controls expose interval, task discovery, continuation settings and a local evidence export.

Uninstall by removing this companion from the Extensions page; your ChatGPT tasks and original Project Constellation installation are unchanged.

## Development and evidence

Source: `Herbertofury/Project-Constellation`, base commit `181716a74abaaa4e2cc9d5d95a83c6f78059a77e`.

Run `node --test companion-tests/policy.cjs companion-tests/controller.cjs` from this package. Run `python companion-tests/dom_regression.py` with Python Playwright and Chromium for fixture tests. The standalone runtime needs neither dependency. Run `python companion-tests/native_extension_smoke.py` in an environment that permits unpacked extensions.

The tested duplicate-click defect was in a shared connection-retry helper: it resent side-effecting messages after an uncertain response. The corrected helper retries read-only inspections only. Action and pagination messages are not automatically resent.

Official references checked 2026-09-23:
- https://developer.chrome.com/docs/extensions/reference/api/alarms
- https://playwright.dev/python/docs/chrome-extensions
- https://help.openai.com/en/articles/10291617-tasks-in-chatgpt

Chrome may delay alarms and does not wake sleeping devices. One minute is the configured interval, not an exact delivery guarantee.
