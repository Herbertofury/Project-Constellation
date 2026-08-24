# Production release runbook

This runbook is for maintainers publishing Project Constellation. User installation and upgrades are documented in [Installation](INSTALLATION.md). OAuth provisioning is documented in the [production acceptance checklist](OAUTH-PROVISIONING-CHECKLIST.md).

## Release invariants

- `main` is clean and pushed to `Herbertofury/Project-Constellation`.
- `package.json` and `extension/manifest.json` contain the same version.
- The manifest `key` still produces extension ID `geljambmkfjkhodgkpjhnmfojkpcamig`.
- Both public OAuth client IDs are supplied through the environment or GitHub Actions secrets.
- No access token, refresh token, client secret, browser profile, or chat export is tracked.
- `npm run verify` is green locally and in GitHub Actions.
- Real signed-in Google Drive and GitHub acceptance is recorded; mocks alone are not release evidence.
- README, changelog, release notes, wiki, checksums, receipt, GitHub Release, and Drive checkpoint all describe the same commit and version.

## Prepare

1. Read `AGENTS.md`, `docs/CONTINUATION.md`, the latest release receipt, and `brain/v0.13.0` state.
2. Reconcile the local branch with `origin/main`, the GitHub Wiki, and the latest Google Drive checkpoint.
3. Update version, changelog, release notes, README, docs, and wiki together.
4. Run `git diff --check`, review every tracked change, and commit it.
5. Run `npm ci` and `npm run verify`.

## Production build

```powershell
$env:PROJECT_CONSTELLATION_GOOGLE_CLIENT_ID = '<google-client-id>.apps.googleusercontent.com'
$env:PROJECT_CONSTELLATION_GITHUB_CLIENT_ID = '<github-client-id>'
npm run build
Get-Content -Raw build/build-info.json
npm run package
```

`build/build-info.json` must report production mode, both OAuth entries `true`, and stable extension identity. Packaging refuses a dirty tracked tree or an incomplete production build.

Independently compare each artifact with `releases/vX.Y.Z/SHA256SUMS.txt` and inspect `RELEASE-RECEIPT.json` for the expected source commit, version, mode, and OAuth booleans.

## Acceptance

Load the packaged build—not the source directory—and exercise:

- extension startup, service-worker restart, storage persistence, and upgrade from the previous release;
- Google connect, scope grant verification, Drive `about`, sync, readback/restore, 401 recovery, revoke, and reconnect;
- GitHub device flow, `/user`, repository selection, sync, refresh-token rotation, 401 retry, revoke, and reconnect;
- ChatGPT capture/navigation plus the supported provider smoke matrix;
- recovery export/import and proof that OAuth tokens are excluded;
- reduced motion, constrained performance mode, keyboard navigation, contrast, and all owned UI surfaces.

Record failures truthfully. Do not convert a mocked check, UI render, or successful token acquisition into a claim of end-to-end sync success.

## Publish

1. Ensure GitHub Actions contains `PROJECT_CONSTELLATION_GOOGLE_CLIENT_ID` and `PROJECT_CONSTELLATION_GITHUB_CLIENT_ID`.
2. Create the annotated `vX.Y.Z` tag on the accepted source commit and push it.
3. Confirm the Production release workflow passes and the GitHub Release contains the unpacked ZIP, source ZIP, `SHA256SUMS.txt`, and `RELEASE-RECEIPT.json`.
4. Download the published assets and independently verify their hashes and receipt.
5. Push the matching `wiki/` tree to the repository's `.wiki.git` remote.
6. Upload the same full artifacts and evidence to a versioned Google Drive release folder.
7. Re-read/download the Drive objects, verify byte sizes and SHA-256 values, and update the native ACTIVE CHECKPOINT.
8. Confirm local `HEAD`, `origin/main`, tag, GitHub Release receipt, wiki, and Drive checkpoint all agree.

If any acceptance or remote reconciliation step fails, leave the tag/release unpublished or mark it as a prerelease and record the exact external gate.
