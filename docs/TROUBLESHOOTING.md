# Troubleshooting

## Google says setup required

Check the installed build’s `manifest.json`. A production build must contain a real `oauth2.client_id` ending in `.apps.googleusercontent.com`. If `oauth2` is absent, you installed a development build. If the extension ID differs from `geljambmkfjkhodgkpjhnmfojkpcamig`, the manifest key changed or the wrong folder was loaded; the Google Chrome Extension OAuth client will not match.

If authorization opens but Connect fails, confirm the Drive API is enabled, the consent screen/test-user or production status is correct, `drive.file` was granted, and Chrome has the optional `www.googleapis.com` host permission. Disconnect and reconnect only after correcting configuration.

## GitHub sign-in never completes

Confirm device flow is enabled on the GitHub OAuth App and the client ID is correct. Keep the Connections surface open while entering the device code. Constellation respects GitHub’s polling interval; repeated clicks do not accelerate approval. If refresh authorization expired/revoked, disconnect and sign in again.

## ChatGPT is not captured

Open the exact conversation and verify Constellation is enabled in the popup. Reload the extension and page after an update. Current ChatGPT turns should expose `conversation-turn-*` or `data-message-author-role`/`data-message-id`. Root anonymous conversations are session-only and will not have a reopenable `/c/` URL.

If ChatGPT changed markup, follow [ChatGPT compatibility](CHATGPT-COMPATIBILITY.md) and add a sanitized regression fixture before changing selectors.

## Settings or organizer actions show an `IDBKeyRange.only` error

Reload the unpacked extension from the current v0.14.0 build. An earlier candidate queried boolean organization flags as IndexedDB keys, so a setting could be written successfully and then appear to fail when Home refreshed. The repaired build upgrades the local brain from v8 through v10: v9 rewrites those indexes to valid numeric derived keys and migrates existing flags in place, while v10 adds Output Vault revision/snapshot stores. Rapid settings changes are serialized and pinned/favorite/archive state is preserved. Do not clear storage: settings and captured chats are retained by the migration.

Home’s status bar reports verified local IndexedDB counts. While the index is loading it shows a loading marker, and if an outdated service worker cannot answer it requests one extension reload instead of claiming there are zero chats.

## HUD says stale or degraded

“This tab is behind” means the local catalogue has a newer authoritative revision while the visible page is at the conversation bottom. Use the HUD’s Refresh action. “Page render degraded” means semantic content is present but not visibly rendered; refresh after ensuring important work is checkpointed.

## Pulse says Saved output is missing

This is a specific local comparison result, not a generic error string. After the page finished hydrating at the conversation bottom, the rendered tail was missing a saved assistant turn or exposed a meaningfully poorer text/code/link/media revision. Open **⇄ Output Vault**, review the highlighted side-by-side card and its **Versions**, then copy, download, or branch from the saved copy. Refreshing again is optional; it is not required to access the durable revision.

If the vault shows a remote image/video/audio reference but Preview no longer loads, the provider or remote host may have expired the URL. Inline bounded `data:` media is embedded locally; remote and `blob:` references are preserved as evidence but are not silently re-downloaded. Save important generated files to a durable external location while their original link is still live.

## High CPU or jank

Turn on Adaptive motion relief, collapse/hide healthy HUD state, and close duplicate AI tabs. Confirm you are on v0.14+; v0.13 used faster polling and broader tool scans. Check popup pressure metrics and `logs/smoke` only during development. Reduced-motion and constrained-device fallbacks apply automatically to Constellation’s own starfield.

## Full Capture appears stuck

Full Capture intentionally uses one visible window because hidden/minimized pages can be throttled. Bring that window forward with **Show capture window**, resolve provider login/approval, then resume. Stop is safe; already captured state remains.

## Build fails on OAuth

This is intentional for production. Use `npm run build:dev` for credential-free development. Use `npm run build` only after setting both client IDs. Never “fix” the gate by reintroducing placeholders or deleting OAuth from a package you intend to release.

## Reset/recover

Before clearing anything, export the local brain or complete Drive round-trip verification. See [Recovery](RECOVERY.md). Removing the extension may delete browser storage.
