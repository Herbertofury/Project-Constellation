# Current continuation: Project Constellation 0.25.0

Read `brain/v0.25.0/COMPASS.json`, `STATUS.json`, `HANDOFF.md`,
`docs/v0.25.0-release-notes.md`, `docs/MONITOR-VERIFICATION.md`, the optimization
and stack receipts, and the matching published release receipt first.

The accepted baseline is v0.24.0, commit
`fc9a2322c6fb521f09f056d6f8208d6431fdfc07`. Its 15 GitHub assets and 24 live Wiki
pages were verified before this work. Resolve the current version and source
through the public repository, release receipts and completed hosted checks.
The user explicitly requested another substantial improvement pass using
multiple subagents and authorized release closeout.

This candidate adds scoped bulk incident triage and profile drafts; repairs
source timestamp/authority, uncertain delivery and reminder persistence;
retains native closure ordering across restart and reconnect; and hardens
managed-path setup plus the optional local recovery launcher. Preserve every
existing project, browser, desktop and Computer Tools capability, Computer-Link
source provenance and unrelated worktree edits.

Committed source records candidate evidence. The matching tag, completed
hosted jobs, shipped-byte readbacks and live Wiki establish public release
acceptance. Continue through those authorized publication steps.
Physical sound, OS notification visibility, owner profile enrollment, signed-in
account round trips, permanent Firefox signing and Windows publisher signing
remain explicit prerelease boundaries.

## Historical continuation records

The following notes retain earlier version lineage and technical operating
guidance. Checkout paths and release checks are portable across maintainer
machines. Older version strings do not override the current release record.

# Contributor and agent continuation

## Canonical state

- Local checkout: `<PROJECT_CONSTELLATION_CHECKOUT>` (replace this placeholder with your own absolute checkout path).
- GitHub: `Herbertofury/Project-Constellation`
- Release authority: matching public tags, release receipts, source trees and completed hosted checks.
- Base lineage: v0.13.0; historical development line: v0.17.6 within v0.17.x. Current published records take precedence over these earlier version labels.

ProjectDump is historical input only. Do not write Project Constellation changes back into it. Preserve unrelated ProjectDump content.

## Start-of-work checklist

1. Read `AGENTS.md`, this document, latest `CHANGELOG.md`, release receipt, and the highest-versioned `brain/` state present. Never hardcode an older brain version as the continuation authority.
2. Run `git status`, inspect the public remote/tag/release state, and compare the source commit/tree with the matching release receipt before assuming currentness.
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
5. Package, checksum, sign/tag/commit, publish the release and Wiki, and verify the public tag, source tree, asset readbacks and release receipt agree.
6. Record unresolved external acceptance explicitly; never translate “code path tested” into “account integration verified.”


## v0.17.6 continuation checkpoint

- Treat explicit provider terminal UI as authoritative: delivery timeout/interrupted send failures and provider-declared maximum conversation length are red Critical even if stale network/tool evidence looks active.
- Current ChatGPT terminal cards may be plain styled DOM. Use the bounded current-frontier fallback in Live Sentinel/content health; do not regress to ARIA-only detection.
- Keep historical/quoted error text out of current-state detection. Long-chat status collection must favor the newest bounded controls.
- Pulse/Popup bucketing must use `healthState` as well as `status`, especially `capacity-reached` with an otherwise idle provider status.
- Never auto-click provider Retry or auto-branch on a hard limit; recovery remains explicit user action.
