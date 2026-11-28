# Current continuation: Project Constellation 0.23.0

Read `brain/v0.23.0/COMPASS.json`, `STATUS.json`, `HANDOFF.md`,
`docs/v0.23.0-release-notes.md`, `docs/MONITOR-VERIFICATION.md`, the optimization
and stack receipts, and the matching published release receipt first.

The root preserves the original application, native Agent Monitor, repairable
Windows setup and Computer Tools migration. Continue from accepted source;
never unpack a historical carrier archive over it. The source candidate records
local evidence; the matching GitHub tag, workflow and release receipts record
final runtime and publication evidence. The owner requires a versioned GitHub
release at upgrade closeout.

Each monitored browser/profile still needs its sensor enabled. Permission
choices remain direct user actions. Firefox's temporary sensor, publisher
signing, actual speakers and account-specific acceptance remain documented.
Preserve the Computer-Link repository and private history bundles.

## Historical continuation records

The following text preserves prior lineage and operating instructions. Its
older version strings do not override the current checkpoint above.

# Contributor and agent continuation

## Canonical state

- Local: `C:\Users\Owner\Desktop\Project Constellation`
- GitHub: `Herbertofury/Project-Constellation`
- Drive: the Project Constellation folder and ACTIVE CHECKPOINT identified in the latest release receipt
- Base lineage: v0.13.0; current verified development line: v0.17.6 (Drive-backed v0.17.x; canonical GitHub catch-up remains pending)

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


## v0.17.6 continuation checkpoint

- Treat explicit provider terminal UI as authoritative: delivery timeout/interrupted send failures and provider-declared maximum conversation length are red Critical even if stale network/tool evidence looks active.
- Current ChatGPT terminal cards may be plain styled DOM. Use the bounded current-frontier fallback in Live Sentinel/content health; do not regress to ARIA-only detection.
- Keep historical/quoted error text out of current-state detection. Long-chat status collection must favor the newest bounded controls.
- Pulse/Popup bucketing must use `healthState` as well as `status`, especially `capacity-reached` with an otherwise idle provider status.
- Never auto-click provider Retry or auto-branch on a hard limit; recovery remains explicit user action.
