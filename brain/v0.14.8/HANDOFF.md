# Project Constellation v0.14.8 handoff

Regression root cause: v0.14.7's accurate `stalled` state fed the pre-existing Approval Recovery queue. When Approval Autopilot/background recovery was enabled, `watchForStalls()` could start the legacy recovery sweep. That sweep created a minimized window at a saved `chatgpt.com` URL and navigated/reloaded it across chats. Installed-app/PWA link capture can hand those navigations to the Windows ChatGPT app, causing unsolicited opens or thrashing.

v0.14.8 makes watchdog/runway observation side-effect free, removes hidden approval-recovery navigation, scans only already-open ChatGPT tabs, kills persisted legacy recovery on upgrade/startup, and removes Pulse's missing-tab URL-create fallback.
