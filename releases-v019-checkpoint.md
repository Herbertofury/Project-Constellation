# Project Constellation 0.19.0 checkpoint

Project Constellation 0.19.0 unifies the existing 0.18.x browser extension and Commander 0.7.4 desktop runtime into one product source tree.

Implemented at this checkpoint:
- `desktop/` contains Commander 0.7.4's durable task/search/local Work runtime, re-versioned and branded as Project Constellation 0.19.0 while preserving the existing `.constellation-commander` state directory and `com.constellation.commander` app identity for migration continuity.
- The Project Constellation extension is now the only browser companion. The retired standalone Commander extension is not shipped.
- The desktop bridge trusts the stable Project Constellation extension ID `geljambmkfjkhodgkpjhnmfojkpcamig` and retains the proven loopback/session-token/nonce protocol.
- Current ChatGPT Scheduled canonical navigation is `https://chatgpt.com/schedules`; legacy route aliases remain accepted by observers.
- Scheduled Task Self-Healing keeps one controller-owned Scheduled tab, inventories sanitized task state, opens real Follow-up/Resume controls, persists action intent before clicking, deduplicates side effects, and keeps genuine permission/security/login/missing-input prompts as held states rather than bypassing them.
- Home and side panel expose recovery enable/check controls, recovery/approval counters, observed task inventory, and desktop-runtime connectivity.

Current verification before durable checkpoint:
- scheduled-task-guardian regression: PASS
- unified 0.19 product regression: PASS
- desktop `npm run check`: PASS
- desktop full retained `npm test`: PASS (22 durable-task/search tests, 50 retained reliability tests, shell/Electron/relay/device-agent/plugin, strict bridge tests, real-Chromium extension -> desktop -> disk E2E)
- Windows native computer-use smoke: SKIP on Linux by design; remains required on Windows for final native proof.

Next action: run root full verification and browser smoke gates from this exact checkpoint, package extension/source/Windows portable/manual migration patch, fresh-extract verify, then publish with hashes to Drive and GitHub.
