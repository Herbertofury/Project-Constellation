# Release runbook

The owner requests a GitHub release at closeout. Release only exact, committed
source with matching artifacts and executed evidence. Installation is described
in [Windows Setup](Windows-Setup) and [Installation](Installation).

## Prepare the source

Read `AGENTS.md`, the highest-versioned `brain/` checkpoint,
`docs/CONTINUATION.md`, and the current GitHub and Drive metadata. Preserve
unrelated changes, historical releases, original functionality and all migrated
source. Historical Computer-Link Git bundles are currently excluded from public
artifacts by automatic approval review; preserve the private checkpoint and
use the exact public-ref verification fallback until specific approval is given.
Do not reconstruct an old carrier archive over the current root.

Keep root, extension, desktop, native payload and release versions aligned.
Preserve the stable manifest key and extension ID
`geljambmkfjkhodgkpjhnmfojkpcamig`. Update README, changelog, current notes,
installation docs, wiki and continuation together. Complete the pinned Athena
shrink-anything, fast-anything and rust-anything assessments in isolation and
retain only demonstrated zero-loss improvements.

Run `npm run verify`, the native Rust/Computer Tools checks and the desktop
checks. Record any local environment restriction. A restricted local renderer
cannot replace installed-extension or Windows runtime acceptance. Commit the
coherent source without unrelated user edits, publish a review branch, inspect
hosted results and fix the causes of failures before proceeding.

## Production configuration

Supply public OAuth client IDs through the environment or Actions secrets:
`PROJECT_CONSTELLATION_GOOGLE_CLIENT_ID` and
`PROJECT_CONSTELLATION_GITHUB_CLIENT_ID`. Never commit tokens, client secrets,
profiles or user chat exports. The normal production build is `npm run build`.

A monitoring prerelease may explicitly use:

```sh
node tools/build.mjs --mode=production --allow-unprovisioned-oauth
```

Its `build/build-info.json` must truthfully record each missing provider.
Do not advertise signed-in backup acceptance for an unprovisioned build, or
replace a known provisioned installation without explaining that difference.
The build metadata must report the matching version, production mode and stable
extension identity in either case.

## Hosted release gates

`.github/workflows/release.yml` is triggered by a `release/vX.Y.Z` branch, a
matching version tag, or an explicit workflow dispatch. The branch route lets
an authorized maintainer publish through the supported GitHub app without
placing a personal access token in the workspace. The workflow checks that its
requested version is the source version. A pre-existing tag must point to that
same source commit. Merge workflow changes to the default branch before starting
publication with the Actions token; a release branch alone does not satisfy
GitHub's workflow-file permission rules.

All of these reusable workflows must pass before publication:

| Workflow | Required evidence |
| --- | --- |
| `ci.yml` | Root tests, 94 UI message contracts, complete real-browser smoke inventory, desktop tests |
| `windows-runtime.yml` | Native Windows computer use, integrated Electron, native payload inclusion, actual packaged portable launch |
| `windows-setup.yml` | Actual EXE install/repair/rollback/uninstall, setup and owner GUI checks, restored registry and shortcut integrations |
| `native-monitor.yml` | Linux and Windows Rust tests; Chromium and Firefox detector and rendering fixtures |
| `computer-tools.yml` | Source/bundle verification, native tests and status-only MCP handshakes |

The runtime jobs upload immutable workflow artifacts. The release job downloads
them from the same workflow run and validates version, commit, file size and
SHA-256. Desktop packaging verifies the clean expected Git tree before and
after building and records that evidence; missing clean-source evidence is a
publication failure. The Windows setup receipt must explicitly reject acceptance-fixture
status and carry all seven mandatory real-Windows checks. Compiler success
alone is insufficient. No artifact is selected through a loose version glob.

## Artifact assembly

`tools/package-unified-release.mjs` requires clean committed source, matching
production extension metadata and verified receipts. Its generated output is
`build/releases/vX.Y.Z/`; the historical `releases/` directory is never erased.

The release contains:

- the compact `Constellation-X.Y.Z-Windows-Setup.exe` for the Rust hub, sensors
  and Computer Tools;
- the full desktop portable ZIP and desktop installer;
- the full Chromium extension, Firefox sensor and Linux browser hub;
- an exact Git source archive, release notes, executed runtime receipts and
  a unified receipt identifying source commit and tree;
- SHA256SUMS covering every published data artifact, including the unified
  receipt itself.

The full desktop installer uses `Windows-Desktop-Setup` in its release filename
so it cannot be confused with the compact native installer.

## Publish and verify

1. Merge the accepted review branch with its exact expected head SHA.
2. Start the release workflow on that commit using the matching release branch
   or tag. The workflow creates a GitHub prerelease for 0.22.0 because Firefox
   signing, Windows publisher signing and target-account acceptance remain open.
3. The workflow refuses to overwrite an existing release. Download the release
   assets and verify all hashes again; do not equate upload completion with
   byte-level verification. It creates a missing tag without force, resolves
   the live remote tag before publication, and checks that target again after
   downloading the release assets.
4. Synchronize `wiki/*.md` to the live GitHub Wiki and read back its remote head.
   A local wiki mirror alone is not a completed remote documentation update.
5. Preserve the same artifacts and evidence in the versioned Drive checkpoint
   when that integration is available. Read back sizes and hashes and update
   ACTIVE CHECKPOINT. If the connected Drive operation fails, record the exact
   failure without claiming a remote checkpoint was written.
6. Verify the source commit/tree, tag, GitHub Release, receipt, live wiki and
   continuation record agree. Link the real release and identify the appropriate
   installer in the handoff.

Physical sound, notification visibility, enrollment in the owner's actual
browsers and signed-in Google/GitHub round trips require target-machine
acceptance. Preserve those boundaries in release notes and receipts. A real
external failure should be documented and repaired when possible; it must not
be hidden by marking a failed or skipped check as passed.
