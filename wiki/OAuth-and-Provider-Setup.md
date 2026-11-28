# OAuth and provider configuration

OAuth client IDs are public application identifiers, not secrets. Access tokens, refresh tokens, and client secrets must never be committed, placed in the manifest, written to documentation, or included in release notes.

Use the repository's [provisioning checklist](https://github.com/Herbertofury/Project-Constellation/blob/main/docs/OAUTH-PROVISIONING-CHECKLIST.md) for the retained product configuration, current release checks and clearly labeled historical provisioning notes.

## Use a configured release

Published builds with Google/GitHub configuration include the existing product
client IDs. Open **Accounts & Connections**, choose the provider and complete its
sign-in and permission prompts. Ordinary users do not need to create a Google
Cloud project or GitHub OAuth application. The matching release receipt and
`build-info.json` identify which providers are configured. Real signed-in backup,
restore and token-refresh acceptance must still be demonstrated separately.

The build instructions below are for release maintainers or deliberate custom
builds. Preserve the existing product clients and stable extension identity.

## Google Drive

Project Constellation uses Chrome Identity and `https://www.googleapis.com/auth/drive.file`. The scope lets the app create and manage files it creates/opens; it does not grant blanket access to every Drive file.

Reuse the existing product's Chrome Extension client. If a replacement is
explicitly planned, preserve the stable extension ID and use these settings:

1. Select the product’s Google Cloud project and configure the OAuth consent screen.
2. Enable the Google Drive API.
3. Create an OAuth client of type **Chrome Extension**.
4. Enter extension ID `geljambmkfjkhodgkpjhnmfojkpcamig`.
5. Add the release/owner account as a test user if the consent screen is still in testing, or complete Google production/verification requirements before public distribution.
6. Put the resulting `*.apps.googleusercontent.com` client ID in `PROJECT_CONSTELLATION_GOOGLE_CLIENT_ID` only at build time.

At runtime, Connect requests the optional `https://www.googleapis.com/*` host permission, opens Chrome Identity interactively from the user gesture, verifies that `drive.file` was actually granted, and calls Drive `about` before reporting success. A 401 removes the cached access token and retries once through Chrome Identity. Chrome manages Google token refresh/caching.

The normal production build gate rejects a missing/malformed client. An explicitly
unprovisioned monitoring build must identify that limitation in its receipts, as
described below. The stable manifest `key` must remain unchanged or Google will
see a different extension ID.

## GitHub

Reuse the existing GitHub OAuth App owned by the project owner/organization.
An explicitly planned replacement uses these settings:

1. Name it **Project Constellation**.
2. Use the repository URL as Homepage URL.
3. Use a valid HTTPS callback URL even though the extension uses device flow; GitHub OAuth App settings require one.
4. Enable device flow in the OAuth App settings.
5. Enable expiring user tokens/refresh tokens when the GitHub application settings expose that option.
6. Put the OAuth App client ID in `PROJECT_CONSTELLATION_GITHUB_CLIENT_ID` at build time. Never embed a client secret.

The extension requests `repo`, `read:user`, and `offline_access`, opens GitHub’s device verification page, respects `interval`/`slow_down`, stores the pending device code in session storage, validates `/user`, records scopes, and rotates refresh tokens. A 401 triggers one serialized refresh and one retry. Disconnect removes access, refresh, and expiry metadata.

For least privilege, choose a dedicated repository mirror. The `repo` scope is required for private repositories; a future public-only build may offer a narrower mode.

## AI providers

ChatGPT, Claude, Gemini, Grok, DeepSeek, Perplexity, Copilot, Le Chat, Poe, Meta AI, Qwen Chat, Kimi, Character.AI, HuggingChat, You.com Chat, Pi, and Duck.ai use the browser’s existing web session. Constellation does not collect their passwords and does not claim unsupported OAuth/history APIs. Session checks prefer already-open tabs, distinguish signed-in sessions from usable guest sessions, and perform network checks only when explicitly requested.

An AI service’s own “Continue with Google/Apple/Microsoft” login button authenticates the user to that service; it is not an OAuth integration granted to Project Constellation. Provider API keys are likewise separate developer credentials and are intentionally not requested or stored by this browser-session capture architecture. See [AI provider support](AI-Provider-Support) for the verified capability boundary.

## Build configuration

Retain the existing public client IDs in the release environment. For a local
maintainer build, `config/oauth/.env.release.example` provides the variable names;
the build reads process environment variables and does not automatically read
`.env.release`.

```powershell
$env:PROJECT_CONSTELLATION_GOOGLE_CLIENT_ID = '...apps.googleusercontent.com'
$env:PROJECT_CONSTELLATION_GITHUB_CLIENT_ID = '...'
npm run build
```

Inspect `build/build-info.json`; an account-enabled production build must report
both OAuth entries as `true`. The release runbook permits an explicit
`--allow-unprovisioned-oauth` monitoring build whose receipts identify any missing
providers. Such a build must not claim working account backup. See the
[release runbook](Release-Process) for packaging and acceptance requirements.
