# Project Constellation Desktop 0.24.0

Project Constellation is the unified desktop runtime and browser companion for authenticated ChatGPT work, project continuity, local computer tools, saved tasks, recovery, provider health, and durable project state. The normal ChatGPT experience uses the user's existing signed-in web session; it does **not** require a separate OpenAI API key.

## Included 0.22.0 foundation

- **Native Computer Tools in Connections.** Inspect component availability, explicitly open or stop the migrated native owner application, and run a bounded real status-only MCP check. Installer/packaged payload receipts and executable hashes are verified before launch.
- **Confirmed shutdown.** Stop waits for child-process exit; a delayed force-stop remains owned until completion. Quit does not report successful cleanup when managed native or terminal processes remain alive.
- **Optional native integration.** Missing Computer Tools report a clear unavailable state while the existing files, terminal, browser, tasks and remote-device modules remain independently usable.
- **Current release packaging.** The native resources ship in the full Windows desktop artifacts, alongside their provenance and dependency notices. The compact Rust setup remains available separately for browser monitoring and native tools without Electron.

## Preserved application capabilities

- **All-tab Chat Guardian.** Every open ChatGPT conversation tab is independently supervised; unfinished failed/stalled turns can receive one safe `Continue the unfinished task.` turn without auto-clicking native Retry or replaying uncertain tool side effects.
- **Current ChatGPT recovery UI support.** Stream-recovery timeout/error surfaces, including `ChatGPT stream recovery polling timed out`, are classified semantically and trigger event-first recovery with bounded one-shot fallback checks.
- **Draft/hold-safe recovery.** User drafts, approvals, authentication, rate limits, provider review, unavailable conversations, and capacity handoff states remain non-bypassable; reload fallback is fingerprinted and capped.
- **Project Constellation identity everywhere.** Commander-era application IDs, data/config paths, CLI aliases, persistent ChatGPT partition, extension ID, and bridge contracts are retained where changing them would break upgrades or strand user state, but the product presented to the user is Project Constellation.
- **Pinned desktop runtime.** Desktop runtime is pinned to Electron 45.5.0 and electron-builder 26.18.1.
- **Event-first runtime.** Browser/desktop route and status tracking use real state/route events with bounded one-shot fallbacks rather than permanent high-frequency polling.
- **Provider Health.** Adapter capabilities can be scored independently so provider DOM/API drift is reported as a specific degraded capability instead of a vague failure.
- **Incident Brain.** Verified failure fingerprints can retain the proven recovery recipe, invalidation conditions, and regression protection so repeat incidents do not require rediscovery.
- **Brain DB v11.** Shared IndexedDB connection/migration ownership adds durable provider-health, incident-recipe, and migration-receipt stores.
- **Update Center + rollback.** A stable release can be checked, downloaded, SHA-256 verified, staged, installed after exit, and rolled back to the previous application directory if replacement fails.
- **Broad capability model preserved.** The browser companion intentionally retains the existing broad permission/provider-host direction. 0.20.1 does not reduce those capabilities.

## Start

### Portable Windows build

Extract the complete `Project-Constellation-v0.24.0-Windows-Portable.zip` into a new folder and run **Project Constellation.exe**. Keep the extracted folder together.

Project Constellation intentionally reuses the existing Commander/Constellation application identity and persistent ChatGPT partition for upgrade continuity. Existing local settings, tasks, project state, and signed-in browser state are not intentionally reset by this upgrade.

### Development

Requires Node 22.12+; current release CI uses pinned Node 26.13.1.

```text
npm run check
npm test
npm run build:portable:win
```

Repository-level browser validation is run from the repository root:

```text
npm test
npm run validate
npm run build:dev
npm run test:smoke
```

## Local computer tools

The desktop exposes guarded local capabilities around the real ChatGPT web experience, including:

- scoped file read/write/edit/copy/move/trash operations;
- real terminal/process execution and incremental output;
- saved durable tasks with persisted step results;
- desktop screenshots, pointer/keyboard, clipboard, window inspection/focus, and Windows UI Automation where supported;
- project workspace roots and permission modes;
- browser-extension ↔ desktop loopback bridge;
- optional remote relay/device-agent support;
- Update Center and diagnostics.

**Emergency Lock remains authoritative.** Off/denied permissions are enforced by the runtime, not just by UI state. Security/login/provider permission prompts are not bypassed.

## Browser companion

The stable extension ID is:

```text
geljambmkfjkhodgkpjhnmfojkpcamig
```

The companion talks to the local desktop bridge over loopback and preserves the existing bearer-session/per-chat-nonce authorization boundary. It supports ChatGPT plus the existing provider host set retained by the extension manifest.

## Saved tasks

Activity contains persistent Tasks. Tasks are explicit sequences of existing local tools; completed steps are checkpointed, uncertain interrupted side effects are **not** blindly replayed, and resume/cancel ownership remains scoped to the originating authorized context.

Search is indexed/paginated and handles files beyond the old 16 MB scan ceiling. Partial/inaccessible searches remain explicitly partial rather than being reported as complete.

## Updates

The desktop retains the integrated update service. Stable updates are staged only after SHA-256 verification. The updater keeps a rollback copy of the previous application directory and provides explicit apply/rollback scripts. Update availability is checked on startup/on demand rather than by a permanent short-interval poll.

## Verification contract

The authoritative Windows release gate is `../.github/workflows/windows-runtime.yml`. A release-ready 0.24.0 build must prove the exact source revision on Windows with:

- root regression/contract checks;
- desktop syntax + full regression/security tests;
- native Windows computer-use smoke;
- real integrated Electron smoke;
- fresh NSIS + portable ZIP build;
- fresh extraction and launch of the produced portable application;
- SHA-256/size receipt generation.

Browser acceptance additionally includes the complete 43-workflow smoke inventory, the installed-extension and multi-tab recovery checks, and Chromium/Firefox sensor fixtures.

See `../docs/MONITOR-VERIFICATION.md`, `../docs/v0.24.0-release-notes.md` and the published runtime receipts for the current release contract. `RELEASE-MANIFEST.json` preserves historical baseline evidence.

## Compatibility notes

The historical Electron application ID (`com.constellation.commander`) and some Commander-named internal/CLI paths remain deliberately unchanged for migration compatibility. They are implementation compatibility identifiers, not separate products.

Project Constellation is not an official OpenAI/ChatGPT desktop application registration and does not remove account/platform limits. User-authenticated ChatGPT acceptance remains a final user-environment check after delivery; local fixtures are never presented as proof of account-specific behavior.
