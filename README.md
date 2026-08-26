# Project Constellation

Project Constellation is a privacy-conscious Chrome extension that turns AI chats into an organized, searchable, recoverable workspace. It passively captures mounted conversation state, tracks generated artifacts and project continuity, detects stalled or blocked work, and creates verified recovery checkpoints without adding network traffic from the content script.

The v0.14 line is the standalone successor to v0.13.0. This repository is now the canonical source; it no longer depends on ProjectDump.

## What it does

- Organizes chats, projects, groups, files, links, decisions, recommendations, and follow-ups across supported AI providers.
- Preserves a local IndexedDB “brain,” immutable assistant-output revisions, full-text index, continuity cards, integrity baselines, and recovery events.
- Offers zero-tab cataloguing plus an explicit visible-window Full Capture workflow.
- Shows a live Execution Pulse with the specific observable agent/tool step, response and status progress, categorized request lifecycle, proof confidence, recent activity ledger, stalls, approvals, provider limits, stale tabs, safe handoff guidance, and an always-available **Branch & continue** action.
- Uses deeper ChatGPT-specific live-state proof when available: the page-world probe reduces the current transcript branch to sanitized status metadata (`finished_successfully`, `end_turn`, model/task/widget state) while the extension keeps exact current-turn DOM evidence as a fallback. Conversation text and ChatGPT authentication material never cross that probe boundary.
- Adds **Tab Beacons** for open AI chats: configurable Active/Needs Attention/Completed emoji in tab titles, dynamic status favicons, optional native Chrome status groups, toolbar live counts, persistent custom emoji/short tags, and right-click tag presets.
- Resolves opted-in ChatGPT connected-app cards as soon as they mount, including the current split **Allow ▾** control and provider-specific **Allow … for this conversation** option; recovered prompts are recorded only after the card visibly clears.
- Adds an always-available, collapsible and full-workspace **Output Vault** beside Execution Pulse. The two surfaces share a collision-free corner dock, with Vault stacked above a compact live Pulse. It keeps the richest captured revision when a provider refresh replaces it with a shorter/tool-only state, reconstructs ChatGPT-like headings/lists/quotes/tables/code/links in Reader mode (with Raw text one click away), and recovers media references, inline media, files, builds, and revision history through copy, Markdown download, or a continuation branch.
- Branches any supported conversation into a fresh provider chat with a durable checkpoint, automatic native-composer context transfer, parent/child lineage, and truthful prefilled/copied fallbacks when automatic sending is unavailable.
- Syncs verified snapshots and journals to a user-owned Google Drive folder.
- Optionally mirrors snapshots to a selected GitHub repository.
- Uses a restrained purple-and-blue night-sky interface with reduced-motion and constrained-device fallbacks.

Supported surfaces currently include ChatGPT, Claude, Gemini, Grok, DeepSeek, Perplexity, Microsoft Copilot, Le Chat, Poe, Meta AI, Qwen Chat, Kimi, Character.AI, HuggingChat, You.com Chat, Pi, and Duck.ai. Provider sessions remain browser-session based; Constellation distinguishes signed-in, guest-ready, sign-in-required, and unverified states instead of inventing unsupported provider APIs.

## Install

For a published release:

1. Download the latest `Project-Constellation-v*-unpacked.zip` and `SHA256SUMS.txt` from the GitHub Release.
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

The repository runs six deterministic core suites, twenty-four browser workflow smokes, structural validation, UI ownership checks, message-contract checks, and an actual extension service-worker load. Production release packaging additionally requires real Google and GitHub OAuth product configuration.

Project Constellation is maintained at [Herbertofury/Project-Constellation](https://github.com/Herbertofury/Project-Constellation).
