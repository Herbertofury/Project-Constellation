# Project Constellation

## 0.24.0 — Durable observations and reliable recovery

This update fixes lost monitoring state after failed writes or abrupt restarts, delayed close/navigation events that could remove newer problems, and interrupted alert delivery. Browser sensors recover from hung acknowledgements and pause while a document is in the back/forward cache. The native hub saves ordering evidence before accepting it, and Windows Computer Tools handles fragmented local pipe messages without relaxing authorization or cancellation.

External scheduler supervision now preserves an incident before attempting a recovery PR, records permission blocks clearly, rejects invalid or future audit evidence, and avoids repeated unchanged repository activity. Its diagnostic CI dispatch is identified accurately; a stale committed audit is never presented as a live ChatGPT outage. See the [watchdog guide](docs/TASK-WATCHDOG.md).

The production build also fixes a GitHub sign-in configuration guard that rejected its own provisioned client ID. Published-package checks now inspect the generated configuration behavior in addition to the receipt flags.

The desktop runs Electron 45.5.0 with electron-builder 26.18.1. Current release jobs use Node 26.13.1, Rust 1.100.1 and Playwright 1.65.2; actual packaged Windows acceptance and published hashes remain mandatory.

**Start with the Windows Setup executable in [GitHub Releases](https://github.com/Herbertofury/Project-Constellation/releases).** It installs the Rust browser hub, stages the browser extensions, and includes Constellation Computer Tools migrated from Computer-Link. Setup has Repair, diagnostics, rollback and uninstall controls. Enable a sensor in each browser/profile you want to monitor.

**Agent Monitor** collects chat problems in a compact inbox with sound and desktop alerts, acknowledgement, snooze, search, filters and exact-chat review. Connected Chrome, Edge, Opera GX and Firefox profiles share one alert policy. Each browser needs its own sensor; a Chrome extension cannot read another browser's tabs by itself.

The Rust hub starts when a browser sensor calls it. Closing the last normal browser window disconnects that profile, including background-app mode. After the last profile disconnects, the hub exits following a five-second reconnect grace. Opening a normal window reconnects on demand. Separate Computer Tools sessions keep their own explicit lifetime.

Permission prompts remain visible for direct user review. Constellation does not click consent or authorization controls automatically. Firefox's sensor is currently unsigned and temporary; reloading after restart and permanent signing remain distribution limits. Configured release builds include the retained Google/GitHub product client IDs: open **Accounts & Connections** and sign in to use account backup. Users of those builds do not need to create OAuth applications. Check the matching build receipt for provider configuration; provisioning alone does not establish a successful signed-in backup or restore.

- [Windows installation and lifecycle](docs/WINDOWS-SETUP.md)
- [Agent Monitor guide](docs/AGENT-MONITOR.md)
- [Computer-Link capability and source migration](docs/COMPUTER-LINK-MIGRATION.md)
- [0.24.0 release notes](docs/v0.24.0-release-notes.md)
- [Verification and remaining acceptance](docs/MONITOR-VERIFICATION.md)
- [Rust companion CLI](native/constellation-monitor/README.md)

The complete v0.20.1 source has been restored into this repository's root from a
checksum- and tree-verified release lineage. Historical recovery artifacts are
retained. Earlier release descriptions below describe their original checkpoints.


Project Constellation is a privacy-conscious Chrome extension that turns AI chats into an organized, searchable, recoverable workspace. It passively captures mounted conversation state, tracks generated artifacts and project continuity, detects stalled or blocked work, and creates verified recovery checkpoints without adding network traffic from the content script.

The v0.17 line builds on Living Project Rooms + Safe Router with Dependency Brain, version awareness, guarded cross-chat handoffs, duplicate-work prevention, bounded per-chat Context Packets, What Changed, and a proposal-only Guarded Project Autopilot. This repository is the canonical source; it no longer depends on ProjectDump.

## What it does

- Organizes chats, projects, groups, files, links, decisions, recommendations, and follow-ups across supported AI providers, with Project + state lanes for concurrent work.
- Adds a confirmation-only local Project Router: Constellation can suggest a likely project, but it never silently assigns an unrelated chat; Confirm, Not this project, and manual Move remain user-owned decisions.
- Turns each selected project into a Living Project Room with next actions, decisions, live chats, bounded coordination signals, curated working memory, evidence, artifacts, and project-scoped universal search.
- Adds a **Dependency Brain** and version-awareness layer that connects project decisions/procedures/artifacts across chats, keeps older evidence visible, and flags downstream knowledge as possibly stale instead of silently treating it as current.
- Adds **cross-chat handoffs**, **duplicate-work prevention**, and **What changed** project deltas so parallel chats can coordinate without pretending inferred relationships are proven facts.
- Adds **Guarded Project Autopilot** and per-chat Context Packets. The giant Project Brain continues learning reusable project-wide lessons (including performance/workflow/validation patterns), while each chat receives only a bounded proposal relevant to its work. Provider-writing proposals require explicit review/approval and never auto-send.
- Adds a Pulse **Current Chat → Add to Project** shortcut with searchable existing projects, **Create + add**, change/remove, exact active-tab/chat revalidation, and a shared ChatGPT-style project identity picker with emoji, color wheel, hex entry, presets, and live preview.
- Compiles source-backed project knowledge into a bounded Project Brain working set with provenance, confidence, and durable Pin / Ignore / Restore policy history.
- Preserves a local IndexedDB “brain,” immutable assistant-output revisions, full-text index, continuity cards, integrity baselines, and recovery events.
- Offers zero-tab cataloguing plus an explicit visible-window Full Capture workflow.
- Shows a live Execution Pulse with the specific observable agent/tool step, response and status progress, categorized request lifecycle, proof confidence, recent activity ledger, stalls, approvals, provider limits, stale tabs, safe handoff guidance, and an always-available **Branch & continue** action.
- Uses deeper ChatGPT-specific live-state proof when available: the page-world probe reduces the current transcript branch to sanitized status metadata (`finished_successfully`, `end_turn`, model/task/widget state) while the extension keeps exact current-turn DOM evidence as a fallback. Conversation text and ChatGPT authentication material never cross that probe boundary.
- Adds **Tab Beacons** for open AI chats: configurable Critical/On Hold/Active/Needs Attention/Completed emoji in tab titles, dynamic status favicons, optional native Chrome Project + state groups, toolbar live counts, persistent custom emoji/short tags, and right-click tag presets.
- Adds **Review Hold + Instant Alerts**: ChatGPT's explicit provider-review banner becomes a blue On Hold state instead of a stall; Constellation raises a one-shot alert when the banner disappears and its own immediate local notifications when a watched chat completes or crosses into Critical. Compact transition state survives Manifest V3 service-worker sleep without enabling any automatic provider action.
- Adds **Chrome Stability Guard**: repeated tab beacons and already-correct native groups are true no-ops, presentation caches are no longer globally invalidated by Constellation's own group updates, and live DOM observers ignore unrelated provider streaming/class churn. Completed groups are never auto-collapsed, and the compact in-page Pulse is back to **Active · Needs · Done** while preserving the full five-state truth underneath.
- Adds a **Context Lens** to Chat Pulse and the collapsed Execution Pulse navigator: beneath each open-chat title it can show the latest locally captured task, canonical Constellation project, current observable tool step, provider/model/state, and tab-group context. Generic browser titles stay useful without any extra provider request.
- Detects ChatGPT connected-app permission cards, including split **Allow** controls, and raises an actionable review incident. The user makes the permission decision in the original chat.
- Adds **Semantic Output Guard** so temporary provider progress rows such as Thinking/tool/search/build telemetry can settle or disappear without false saved-output warnings; real substantive truncation and lost resources remain protected.
- Adds an always-available, collapsible and full-workspace **Output Vault** beside Execution Pulse. The two surfaces share a collision-free corner dock, with Vault stacked above a compact live Pulse. It keeps the richest captured revision when a provider refresh replaces it with a shorter/tool-only state, reconstructs ChatGPT-like headings/lists/quotes/tables/code/links in Reader mode (with Raw text one click away), and recovers media references, inline media, files, builds, and revision history through copy, Markdown download, or a continuation branch.
- Branches any supported conversation into a fresh provider chat with a durable checkpoint and parent/child lineage, but continuation text is only staged for review; Constellation never presses the provider Send control. Approved project context is likewise hash-checked and staged only into the exact already-open chat after explicit review.
- Syncs verified snapshots and journals to a user-owned Google Drive folder.
- Optionally mirrors snapshots to a selected GitHub repository.
- Uses a restrained purple-and-blue night-sky interface with reduced-motion and constrained-device fallbacks.

Supported surfaces currently include ChatGPT, Claude, Gemini, Grok, DeepSeek, Perplexity, Microsoft Copilot, Le Chat, Poe, Meta AI, Qwen Chat, Kimi, Character.AI, HuggingChat, You.com Chat, Pi, and Duck.ai. Provider sessions remain browser-session based; Constellation distinguishes signed-in, guest-ready, sign-in-required, and unverified states instead of inventing unsupported provider APIs.

## Install

For a published release:

1. Download `Project-Constellation-v0.24.0-Extension.zip` and `SHA256SUMS-v0.24.0.txt` from the matching GitHub Release.
2. Verify the archive checksum.
3. Extract the archive to a permanent folder.
4. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the extracted folder.
5. Pin Project Constellation and open **Accounts & Connections**.

The stable manifest key preserves extension ID `geljambmkfjkhodgkpjhnmfojkpcamig`, which is required by the Chrome Extension Google OAuth client.

See [Installation](docs/INSTALLATION.md) and [OAuth setup](docs/OAUTH.md) for complete instructions.

## Develop and verify

Requirements: Node.js 22+, Python 3.11+, and Chromium installed through Playwright.

```powershell
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m playwright install chromium
npm run verify
```

`npm run build:dev` produces `build/unpacked` with OAuth deliberately omitted and a development label. `npm run build` is a production gate: it refuses to build unless both real product OAuth client IDs are supplied.

```powershell
$env:PROJECT_CONSTELLATION_GOOGLE_CLIENT_ID = 'your-chrome-extension-client.apps.googleusercontent.com'
$env:PROJECT_CONSTELLATION_GITHUB_CLIENT_ID = 'your-github-oauth-client-id'
npm run build
npm run package
```

No OAuth client secret belongs in this repository or extension package.

## Safety and privacy

- The ordinary isolated content runtime performs no provider `fetch` or XHR requests. ChatGPT alone has a narrowly scoped MAIN-world probe that may make a same-origin transcript request using the existing browser session; only sanitized state metadata crosses into the extension, never transcript text or authentication material.
- Output comparison is local and change-gated. Remote media never auto-loads in the vault; previews load only after an explicit click. Inline `data:` media can be embedded in the durable file record within a bounded size limit.
- Google uses `chrome.identity` with the narrow `drive.file` scope.
- GitHub uses device authorization, honors polling backoff, rotates refresh tokens, and retries one authenticated request after refresh.
- OAuth tokens are never included in Drive/GitHub snapshots or exported brain files.
- External links are restricted to HTTPS (plus local HTTP development hosts).
- Destructive local-catalog clearing requires a deliberate two-click confirmation.

Read the [privacy policy](PRIVACY.md), [Security](SECURITY.md), and the [security audit](docs/SECURITY-AUDIT.md).

## Repository map

| Path | Purpose |
| --- | --- |
| `extension/` | Installable Manifest V3 source |
| `tests/` | Unit and browser workflow regression tests |
| `tools/` | Validation, build, packaging, and smoke orchestration |
| `benchmarks/` | Large-chat performance fixtures |
| `docs/` | Canonical manuals, architecture, OAuth, recovery, and continuation guidance |
| `config/oauth/` | Non-secret OAuth templates and provisioning notes |
| `assets/` | Screenshots and documentation assets |
| `build/` | Generated unpacked build (ignored except its guide) |
| `releases/` | Versioned receipts, checksums, evidence, and release artifacts |
| `logs/` | Generated local verification logs (ignored except its guide) |
| `recovery/` | Preserved v0.13/v0.7 imports and ProjectDump migration state |
| `brain/` | Durable project/agent continuation state |

See [Folder structure](docs/FOLDER-STRUCTURE.md) for the complete contract.

## Documentation

- [Installation](docs/INSTALLATION.md)
- [Features](docs/FEATURES.md)
- [OAuth and providers](docs/OAUTH.md)
- [OAuth provisioning checklist](docs/OAUTH-PROVISIONING-CHECKLIST.md)
- [AI provider support](docs/PROVIDERS.md)
- [ChatGPT compatibility](docs/CHATGPT-COMPATIBILITY.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Performance](docs/PERFORMANCE.md)
- [Development and building](docs/DEVELOPMENT.md)
- [Production release runbook](docs/RELEASING.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Recovery](docs/RECOVERY.md)
- [FAQ](docs/FAQ.md)
- [Agent continuation](docs/CONTINUATION.md)
- [Changelog](CHANGELOG.md)

## Verification status

The root `npm test` command invokes 51 deterministic test scripts. Repository verification also covers browser workflow smokes, structural validation, UI ownership and message contracts. The service-worker load smoke requires a browser environment that permits unpacked-extension loading. See [verification and remaining acceptance](docs/MONITOR-VERIFICATION.md) for the commands actually executed, their results and any environment limits. Account-enabled production builds require the retained Google/GitHub product configuration; real signed-in backup and restore acceptance remains a separate check.

Project Constellation is maintained at [Herbertofury/Project-Constellation](https://github.com/Herbertofury/Project-Constellation).
