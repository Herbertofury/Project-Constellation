# OAuth provisioning and production acceptance checklist

This is the exact production handoff for Project Constellation v0.14.0. The extension source, stable ID, build injection, token refresh logic, failure states, and mocked regression coverage are already in place. The Google Chrome Extension client is provisioned and stored in GitHub Actions; a final production package still requires the GitHub OAuth App client ID plus real signed-in acceptance tests.

Do not put a client secret, access token, refresh token, password, recovery code, or browser profile in this repository. The two client IDs below are public application identifiers.

## Known-good product identity

| Setting | Required value |
| --- | --- |
| Extension name | `Project Constellation` |
| Release line | `v0.14.0` |
| Chrome extension ID | `geljambmkfjkhodgkpjhnmfojkpcamig` |
| Google Cloud project name | `Project Constellation` |
| Google Cloud project ID | `project-constellation-506518` |
| Google OAuth audience | `External` |
| Google scope | `https://www.googleapis.com/auth/drive.file` |
| GitHub repository | `https://github.com/Herbertofury/Project-Constellation` |
| Public privacy policy | `https://github.com/Herbertofury/Project-Constellation/blob/main/PRIVACY.md` |

The manifest `key` is already fixed to the extension ID above. Do not regenerate or remove it.

## Google: finish the existing setup

Already completed on 2026-08-24:

- dedicated unbilled project `project-constellation-506518` created;
- Google Drive API enabled;
- Google Auth Platform configured with app name `Project Constellation`;
- support/contact account set to `herbertofury@gmail.com`;
- audience set to External;
- Google API Services User Data Policy accepted.
- Chrome Extension OAuth client created for the stable extension ID;
- public Google client ID stored as the `PROJECT_CONSTELLATION_GOOGLE_CLIENT_ID` GitHub Actions secret.

Continue at [Google Auth Platform](https://console.cloud.google.com/auth/overview?project=project-constellation-506518).

### 1. Configure Data Access

1. Open **Data Access**.
2. Choose **Add or remove scopes**.
3. Search for `drive.file`.
4. Select exactly `https://www.googleapis.com/auth/drive.file`.
5. Apply/update the selection and save.
6. Do not add broad `drive`, `drive.readonly`, Gmail, Calendar, profile, or identity scopes. The extension identifies the connected Drive account through Drive `about`, so no extra identity scope is needed.

`drive.file` is Google's recommended non-sensitive Drive scope. It limits Constellation to files it creates or files the user explicitly opens with it.

### 2. Configure Audience

1. Open **Audience**.
2. While the app is in Testing, add `herbertofury@gmail.com` as a test user.
3. For the public production release, choose **Publish app** / **In production** after confirming Data Access contains only `drive.file`.

If Branding asks for a privacy-policy URL, use the public policy listed in the identity table. Do not invent a domain or mark a domain as verified unless Google has actually verified it.

Testing is useful for the first acceptance run, but Testing authorizations can expire after seven days. Production status avoids that development-only expiry behavior. Because this app requests only the non-sensitive `drive.file` scope, sensitive/restricted-scope security assessment is not required. If Google later requires brand verification for public-facing links or a verified domain, treat that as a separate branding gate—do not broaden scopes to work around it.

### 3. Create the Chrome Extension client

1. Open **Clients**.
2. Choose **Create client**.
3. Application type: **Chrome Extension**.
4. Name: `Project Constellation v0.14`.
5. Item ID: `geljambmkfjkhodgkpjhnmfojkpcamig`.
6. Choose **Create**.
7. Copy the resulting public client ID ending in `.apps.googleusercontent.com`.
8. Do not create or use a client secret. Chrome Extension clients do not require one in the extension.

Record the public ID as `PROJECT_CONSTELLATION_GOOGLE_CLIENT_ID` in GitHub Actions and in the local release shell only.

## GitHub: create the device-flow OAuth App

Open [GitHub Developer settings / OAuth Apps](https://github.com/settings/developers), choose **OAuth Apps**, then **New OAuth App**.

Use these exact values:

| Field | Value |
| --- | --- |
| Application name | `Project Constellation` |
| Homepage URL | `https://github.com/Herbertofury/Project-Constellation` |
| Application description | `Private, recoverable AI workspace continuity and backup for Project Constellation.` |
| Authorization callback URL | `https://github.com/Herbertofury/Project-Constellation` |

After registration:

1. Enable **Device Flow** in the app settings.
2. Enable expiring user access tokens if GitHub exposes that setting.
3. Copy only the public Client ID.
4. Do not generate, copy, or embed a client secret; device flow does not require one for this extension.

The extension requests `repo read:user offline_access`, honors GitHub's polling interval and `slow_down`, stores the pending device code in session storage, rotates refresh tokens, verifies `/user`, retries once after a 401, and removes token state on disconnect.

## Add the public IDs to GitHub Actions

In the repository, open **Settings → Secrets and variables → Actions → New repository secret** and add:

- `PROJECT_CONSTELLATION_GOOGLE_CLIENT_ID`
- `PROJECT_CONSTELLATION_GITHUB_CLIENT_ID`

The values are public identifiers, but Actions secrets prevent accidental churn and keep release configuration out of source commits.

Alternatively, with an already authenticated GitHub CLI session:

```powershell
$googleClientId = Read-Host 'Google Chrome Extension client ID'
$githubClientId = Read-Host 'GitHub OAuth App client ID'
$googleClientId | gh secret set PROJECT_CONSTELLATION_GOOGLE_CLIENT_ID --repo Herbertofury/Project-Constellation
$githubClientId | gh secret set PROJECT_CONSTELLATION_GITHUB_CLIENT_ID --repo Herbertofury/Project-Constellation
```

## Build and package locally

Set the public IDs only for the current PowerShell process:

```powershell
$env:PROJECT_CONSTELLATION_GOOGLE_CLIENT_ID = '<number>-<value>.apps.googleusercontent.com'
$env:PROJECT_CONSTELLATION_GITHUB_CLIENT_ID = '<client-id>'
npm run verify
npm run build
Get-Content -Raw build/build-info.json
npm run package
Get-FileHash releases/v0.14.0/Project-Constellation-v0.14.0-unpacked.zip -Algorithm SHA256
Get-Content releases/v0.14.0/SHA256SUMS.txt
```

`build/build-info.json` must report `"mode": "production"`, both OAuth values as `true`, and `extensionIdStable` as `true`. `npm run package` refuses a development build or a dirty tracked source tree.

## Real acceptance test—required before release

1. Extract the production unpacked ZIP to a permanent test directory.
2. Load it from `chrome://extensions` and confirm ID `geljambmkfjkhodgkpjhnmfojkpcamig`.
3. Open **Accounts & Connections**.
4. Connect Google Drive, approve only `drive.file`, and confirm the UI shows the real account after the Drive `about` verification.
5. Run **Sync now**, confirm the snapshot/journal/index exist in the Project Constellation Drive folder, then restore/read back and compare the recorded SHA-256.
6. Restart Chrome or the extension service worker; confirm Google reconnects without a false-success state.
7. Connect GitHub with device flow, choose the standalone repository, and run a sync.
8. Restart the service worker and force/await token refresh; confirm `/user` and repository listing still succeed.
9. Revoke each authorization once and confirm Constellation reports a truthful disconnected/expired state and can reconnect.
10. Confirm tokens are absent from exported recovery data, Drive artifacts, logs, release artifacts, and `git grep` output.

Do not publish v0.14.0 as production until all ten checks are recorded as real signed-in results rather than mocked smoke results.

## Publish the release

After the two repository secrets and real acceptance results are in place:

```powershell
git status --short
git tag -a v0.14.0 -m 'Project Constellation v0.14.0 Nightfall'
git push origin v0.14.0
```

The tag triggers `.github/workflows/release.yml`, which verifies, builds with both configured clients, packages the source and installable ZIPs, generates SHA-256 checksums and a receipt, and creates the GitHub Release.
