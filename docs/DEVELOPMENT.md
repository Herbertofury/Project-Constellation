# Development and building

## Bootstrap

```powershell
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m playwright install chromium
npm run verify
```

There are no runtime npm dependencies. The extension is plain JavaScript/CSS/HTML so the browser receives reviewable source.

## Commands

| Command | Purpose |
| --- | --- |
| `npm test` | Six deterministic core suites |
| `npm run validate` | Manifest, safety, UI ownership, and message contracts |
| `npm run build:dev` | Development unpacked build without fake OAuth |
| `npm run test:smoke` | All cross-platform browser/service-worker workflows |
| `npm run verify` | Full development verification sequence |
| `npm run build` | Production build; requires both OAuth clients |
| `npm run package` | Production ZIPs, checksums, and release receipt |

## Build behavior

Source files are copied from `extension/` to `build/unpacked`. Google OAuth is injected into the copied manifest; GitHub’s client placeholder is replaced in the copied service worker. Source files retain placeholders so credentials/config are never silently baked into development commits.

Production build refuses missing or malformed clients. Development build removes Google `oauth2`, blanks the built GitHub client, and sets an explicit development `version_name`.

## Release checklist

1. Update package/manifest version, changelog, notes, README, and wiki.
2. Run `npm run verify`.
3. Set secure OAuth client ID environment variables.
4. Run `npm run build` and inspect `build/build-info.json`.
5. Load `build/unpacked` in Chrome and run signed-in Google/GitHub/ChatGPT acceptance.
6. Run `npm run package`; independently verify checksums.
7. Commit, merge the preserved filtered ProjectDump ancestry if not already present, and tag `vX.Y.Z`.
8. Push source/tag, publish the GitHub Release, push the wiki, upload Drive artifacts, and verify remote bytes/metadata.
9. Update Drive checkpoint/receipt and confirm all three canonical surfaces agree.

## Test maintenance

Smoke tests are standalone Python workflows orchestrated by `tools/run-smokes.mjs`. Each writes complete stdout/stderr to `logs/smoke`. Keep fixtures free of private content and use current semantic DOM attributes.
