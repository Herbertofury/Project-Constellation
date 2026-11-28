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
| `npm test` | 52 deterministic regression command entries |
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

1. Update current versions, changelog, release notes, README, guides and Wiki together; preserve historical evidence.
2. Run `npm run verify` and the changed native/desktop/setup checks. Record actual environment limits without converting failures into passing results.
3. Complete the required pinned optimizer assessments, official stack review and exact-source performance/equivalence evidence. Commit the reviewed source and open the release PR.
4. Pass the retained hosted workflow families on the accepted source, including real Windows setup, launcher, pipes and packaged desktop acceptance. Merge only the reviewed, verified tree.
5. Follow [the unified release runbook](RELEASING.md) to build and package from that clean accepted commit. The production job injects the retained OAuth client IDs, inspects build information, checks source/version/artifact identities and verifies checksums before publication.
6. Verify the actual published GitHub assets and tag, read back the live Wiki, and confirm the source commit/tree, downloaded hashes and public release receipt agree.
7. Report remaining owner-profile, physical sound/notification, authenticated-account and signing acceptance explicitly. A configured build or isolated fixture is not a signed-in round trip.

Historical ProjectDump ancestry has already been preserved. Do not repeat an import or unpack an old carrier archive over the current root during an ordinary release.

## Test maintenance

Smoke tests are standalone Python workflows orchestrated by `tools/run-smokes.mjs`. Each writes complete stdout/stderr to `logs/smoke`. Keep fixtures free of private content and use current semantic DOM attributes.
