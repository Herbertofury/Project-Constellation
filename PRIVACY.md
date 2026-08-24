# Project Constellation privacy policy

Effective date: 2026-08-24

Project Constellation is a user-controlled Chrome extension for organizing, searching, monitoring, and recovering AI conversations. This policy describes what the extension processes and where that data goes.

## Data the extension processes

When enabled on a supported AI site, Project Constellation can read conversation content already rendered in that browser tab, including message text, titles, links, generated-file references, provider/project identifiers, and local health or continuity signals. It also stores user-created organization data such as projects, groups, tags, saved layouts, recovery checkpoints, and settings.

Project Constellation does not ask for or intentionally collect AI-provider passwords, payment details, Google passwords, GitHub passwords, two-factor codes, or browser cookies.

## Where data is stored

By default, catalog and configuration data remains in the user's Chrome profile using IndexedDB and Chrome extension storage.

If the user explicitly connects and enables remote sync:

- Google Drive receives Project Constellation snapshot, journal, and index files in the user's own Drive. The extension requests only `https://www.googleapis.com/auth/drive.file`, which limits it to files it creates or files the user explicitly opens with it.
- GitHub receives a Project Constellation snapshot at the repository and path selected by the user. GitHub device authorization is used; the extension never embeds or requests an OAuth client secret.

AI-page content scripts do not make network requests. Remote Google Drive and GitHub operations are owned by the extension service worker and occur only for connection verification or user-configured sync/recovery behavior.

## Authentication data

Google authorization is managed through Chrome Identity. GitHub access and refresh tokens are stored in Chrome extension-local storage so the selected sync can continue. OAuth tokens are excluded from exported recovery data, synced snapshots, logs, source archives, and release artifacts.

Disconnecting an account removes its locally cached authorization state. Revoking Project Constellation in the Google or GitHub account's authorized-app settings invalidates remote access.

## Sharing, sale, and advertising

Project Constellation does not sell personal information, use conversation content for advertising, operate an analytics/advertising backend, or transmit catalog data to the project maintainer. Data is shared only with the user's selected Google Drive or GitHub destination when the user enables those features, or with a supported AI provider through that provider's own website and existing browser session.

## Permissions

The extension uses Chrome permissions for local storage, tabs, side panel UI, alarms, identity, offscreen parsing, idle-aware work, passive request-lifecycle health signals, and optional history/download workflows. Host access is limited to documented supported AI chat sites and optional Google/GitHub endpoints. The [security audit](docs/SECURITY-AUDIT.md) and [OAuth documentation](docs/OAUTH.md) explain these boundaries in detail.

## Retention and deletion

Local catalog data remains until the user clears it, removes the Chrome profile/extension data, or uninstalls the extension. Remote snapshots remain in the user's Drive or GitHub repository until the user deletes them there. Project Constellation provides deliberate confirmation for destructive local clearing and never silently deletes the source conversations on AI-provider sites.

## Third-party services

Use of Google Drive, GitHub, and supported AI sites is also governed by those providers' terms and privacy policies. Project Constellation is not affiliated with or endorsed by those providers.

## Changes and contact

Material policy changes will be documented in the repository changelog and released with the corresponding extension version. Questions or privacy requests can be opened in the [Project Constellation issue tracker](https://github.com/Herbertofury/Project-Constellation/issues).
