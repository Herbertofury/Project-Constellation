# Contributor and agent continuation

## Canonical state

- Local: `C:\Users\Owner\Desktop\Project Constellation`
- GitHub: `Herbertofury/Project-Constellation`
- Drive: the Project Constellation folder and ACTIVE CHECKPOINT identified in the latest release receipt
- Base lineage: v0.13.0; current line: v0.14.x

ProjectDump is historical input only. Do not write Project Constellation changes back into it. Preserve unrelated ProjectDump content.

## Start-of-work checklist

1. Read `AGENTS.md`, this document, latest `CHANGELOG.md`, release receipt, and the highest-versioned `brain/` state present. Never hardcode an older brain version as the continuation authority.
2. Run `git status`, inspect remote/tag/release state, and compare Drive checkpoint metadata before assuming currentness.
3. Run `npm run verify` to establish the local baseline.
4. Treat generated `build/` and `logs/` as disposable; never infer release success from stale output.

## Engineering invariants

- Preserve provider content and native functionality.
- Do not add content-script network traffic.
- Keep observations bounded, batched, idle-scheduled, and visibility-aware.
- Use semantic/accessible selectors with provider-specific priority and tested fallback.
- Do not claim completeness beyond recorded coverage.
- Separate OAuth tokens from exported/synced state.
- Keep production build/release gates truthful.
- Maintain the stable manifest key/extension ID unless a coordinated OAuth migration is explicitly approved.

## End-of-work checklist

1. Add/update tests and run full verification.
2. Update docs/wiki/changelog for behavior changes.
3. Build production only with secure OAuth client ID injection.
4. Load/test the actual built extension in Chrome and exercise signed-in Google, GitHub, ChatGPT, storage, service-worker restart, restore, and failure states.
5. Package, checksum, sign/tag/commit, publish release/wiki, upload Drive artifacts, verify all remotes, and append the ACTIVE CHECKPOINT.
6. Record unresolved external acceptance explicitly; never translate “code path tested” into “account integration verified.”
