# Project Constellation

Project Constellation is a privacy-conscious Chrome extension that turns AI chats into an organized, searchable, recoverable workspace. It passively captures mounted conversation state, tracks generated artifacts and project continuity, detects stalled or blocked work, and creates verified recovery checkpoints without adding network traffic from the content script.

The v0.14 line is the standalone successor to v0.13.0. This repository is now the canonical source; it no longer depends on ProjectDump.

## What it does

- Organizes chats, projects, groups, files, links, decisions, recommendations, and follow-ups across supported AI providers.
- Preserves a local IndexedDB “brain,” full-text index, continuity cards, integrity baselines, and recovery events.
- Offers zero-tab cataloguing plus an explicit visible-window Full Capture workflow.
- Shows an Execution Pulse HUD for model/tool activity, stalls, approvals, provider limits, stale tabs, and safe handoff guidance.
- Syncs verified snapshots and journals to a user-owned Google Drive folder.
- Optionally mirrors snapshots to a selected GitHub repository.
- Uses a restrained purple-and-blue night-sky interface with reduced-motion and constrained-device fallbacks.

Supported surfaces currently include ChatGPT, Claude, Gemini, Grok, DeepSeek, Perplexity, Microsoft Copilot, Le Chat, Poe, Meta AI, Qwen Chat, Kimi, Character.AI, HuggingChat, You.com Chat, Pi, and Duck.ai. Provider sessions remain browser-session based; Constellation distinguishes signed-in, guest-ready, sign-in-required, and unverified states instead of inventing unsupported provider APIs.

## Install

For a published release:

1. Download `Project-Constellation-v0.14.0-unpacked.zip` and `SHA256SUMS.txt` from the GitHub Release.
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

- The content script performs no `fetch` or XHR requests.
- Google uses `chrome.identity` with the narrow `drive.file` scope.
- GitHub uses device authorization, honors polling backoff, rotates refresh tokens, and retries one authenticated request after refresh.
- OAuth tokens are never included in Drive/GitHub snapshots or exported brain files.
- External links are restricted to HTTPS (plus local HTTP development hosts).
- Destructive local-catalog clearing requires a deliberate two-click confirmation.

Read [Security](SECURITY.md) and the [security audit](docs/SECURITY-AUDIT.md).

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
- [AI provider support](docs/PROVIDERS.md)
- [ChatGPT compatibility](docs/CHATGPT-COMPATIBILITY.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Performance](docs/PERFORMANCE.md)
- [Development and building](docs/DEVELOPMENT.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Recovery](docs/RECOVERY.md)
- [FAQ](docs/FAQ.md)
- [Agent continuation](docs/CONTINUATION.md)
- [Changelog](CHANGELOG.md)

## Verification status

The repository runs six deterministic core suites, seventeen browser workflow smokes, structural validation, UI ownership checks, message-contract checks, and an actual extension service-worker load. Production release packaging additionally requires real Google and GitHub OAuth product configuration.

Project Constellation is maintained at [Herbertofury/Project-Constellation](https://github.com/Herbertofury/Project-Constellation).
