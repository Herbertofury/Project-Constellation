# Production release process

A production Project Constellation release is a verified state shared by the canonical local folder, GitHub source/tag/release/wiki, and Google Drive checkpoint. A local ZIP by itself is not a release.

## Required gates

1. Clean, pushed source and matching package/manifest version.
2. Full `npm run verify` pass locally and in GitHub Actions.
3. Production build with both public OAuth client IDs and stable extension identity.
4. Real signed-in Google Drive and GitHub acceptance, including refresh/restart/revoke failure paths.
5. Packaged-build acceptance for storage, recovery, provider integration, accessibility, and performance behavior.
6. Independent SHA-256 verification of the installable and source archives.
7. Matching release notes, changelog, receipt, wiki, GitHub Release, and Drive ACTIVE CHECKPOINT.

The exact maintainer procedure is version-controlled in the [production release runbook](https://github.com/Herbertofury/Project-Constellation/blob/main/docs/RELEASING.md). OAuth console values and acceptance steps are in the [OAuth provisioning checklist](https://github.com/Herbertofury/Project-Constellation/blob/main/docs/OAUTH-PROVISIONING-CHECKLIST.md).

Never publish a development package, a placeholder OAuth build, or mocked OAuth results as a production release.
