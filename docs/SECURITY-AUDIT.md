# Security audit — v0.14.0

Date: 2026-08-24. Scope: JavaScript Manifest V3 source, OAuth adapters, content capture, UI rendering/navigation, remote sync, build/release handling, and browser workflow tests.

## Threat model

Protected assets are private chat content, generated artifacts, local organization state, Drive/GitHub tokens, remote snapshots, and extension identity. Trust boundaries include provider DOM (untrusted), imported/exported data (untrusted), Chrome extension storage, Google/GitHub APIs, optional remote repositories, and release artifacts.

## Findings repaired

### High — fake/unusable Google OAuth production build

v0.13 source contained a placeholder and the build silently removed OAuth. v0.14 has separate development/production modes; production requires a syntactically real Chrome Extension client, validates granted `drive.file`, and calls Drive `about` before reporting connected.

### High — GitHub refresh tokens unused

v0.13 stored refresh tokens but failed every expired session. v0.14 stores expiry metadata, serializes refresh rotation to avoid reuse races, proactively refreshes near expiry, refreshes once on 401, retries once, and clears invalid/expired authorization. Device polling honors GitHub interval and `slow_down`.

### Medium — untrusted URL navigation

Captured URLs were escaped for HTML but could be passed directly to `chrome.tabs.create`. Home/side panel now parse and allow HTTPS, extension-local URLs, and local HTTP development hosts only. The GitHub verification URL uses the same gate.

### Medium — misleading Drive connection state

A cached local status could remain connected even when remote verification failed. Verification now starts disconnected and records the exact non-success/error. Connect returns success only after the Drive API responds.

### Medium — duplicate/current ChatGPT capture

Broad nested selectors could duplicate current ChatGPT turns, increasing stored sensitive content and work. Current top-level turn containers are preferred, with role/message fallback and a regression test.

### Low — cross-platform test blind spot

Windows path/Chromium assumptions prevented the complete suite from running. Tool paths use `fileURLToPath`; smoke tests use Playwright-managed Chromium and UTF-8; all workflows are centrally orchestrated/logged.

## Controls confirmed

- Manifest V3 default CSP; no `eval`/`new Function`/remote code.
- Content script contains no fetch/XHR.
- Dynamic UI data is HTML-escaped before template insertion.
- OAuth tokens are not included in snapshots/exports.
- Google scope is `drive.file`, with optional Google API host permission.
- GitHub/Google tokens are sent only in Authorization/form exchanges to their official HTTPS origins.
- Remote Drive restore validates schema, bytes, and hashes where provided.
- Destructive catalogue clearing uses explicit confirmation.
- Recovery and request state machines are bounded.

## Residual risks

- Chrome extension local storage is browser-profile protected, not an application-level encrypted vault. A compromised OS/browser profile can access tokens and chat data.
- Provider DOM changes can cause missed/misclassified state; tests and live compatibility review are required per release.
- `repo` scope is broad for private GitHub mirrors. Users should choose a dedicated repository; future releases should explore a GitHub App or public-only narrow scope.
- Approval Autopilot can authorize connected-app actions; it is off until explicit risk acknowledgement and must remain opt-in.
- Host permissions cover multiple providers because cross-provider capture is a core feature. Removing unused providers from a custom build reduces exposure.

No critical unresolved code defect was found in the audited scope. Signed-in production OAuth acceptance remains a release gate, not something mocked tests can prove.
