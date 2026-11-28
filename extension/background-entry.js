import './src/drive-sync-policy.js';
import './src/drive-sync-guard.js';
import './src/chat-vault-core.js';
import './src/command-center-action-core.js';
import './src/closed-chat-watch-core.js';
import './src/attention-background.js';
import './src/native-monitor-bridge.js';
import './background.js';
import './src/notification-repair.js';
import './src/closed-chat-watch.js';
import './src/closed-chat-vault-bridge.js';
import './src/command-center-actions.js';

import './src/local-work-controller.js';
import './src/scheduled-task-recovery-controller.js';

// Upgrade from the original carrier without leaving retired repeating alarms
// waking the worker beside the event-driven guardian and manual-review monitor.
for (const alarm of ['project-constellation-tab-supervisor','project-constellation-approval-supervisor']) {
  chrome.alarms.clear(alarm).catch(() => {});
}
