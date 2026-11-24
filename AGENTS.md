# Project Constellation agent contract

`C:\Users\Owner\Desktop\Project Constellation` is the canonical local project home. `Herbertofury/Project-Constellation` is the canonical repository. Do not treat ProjectDump as a writable or current source.

Read the highest-versioned `brain/*/COMPASS.json`, its `STATUS.json` and `HANDOFF.md`, `docs/CONTINUATION.md`, and the latest release receipt before making release or recovery decisions. Reconcile Drive and GitHub metadata before declaring a version current.

Source changes belong in `extension/`; tests in `tests/`; tooling in `tools/`; documentation in `docs/`; generated local output in `build/` or `logs/`; immutable evidence in the matching `releases/vX.Y.Z/`; non-current imported state in `recovery/`.

Never commit OAuth secrets, access tokens, refresh tokens, browser profiles, or user chat exports. Google and GitHub client IDs are public configuration, but production builds must receive them through the environment. Preserve the manifest `key` unless intentionally migrating the extension ID and all associated Google OAuth configuration.

Before handoff, run `npm run verify`. Before packaging, run the production build gate, inspect `build/build-info.json`, package, verify `SHA256SUMS.txt`, and update README/docs/wiki/release notes together. Never claim OAuth or remote round-trip success from a mocked test.

## Mandatory pre-release optimization gate

Before finalizing every release, follow the owner-mandated [Athena zero-loss pre-release optimization standard](https://github.com/Herbertofury/Athena/blob/main/guidance/PRE_RELEASE_OPTIMIZATION.md). Evaluate shrink-anything, fast-anything and rust-anything using reviewed pinned tools in isolated worktrees; run applicable passes, compare equivalent complete workloads, keep only independently verified improvements, restore rejected changes, and record per-tool evidence or explicit inapplicability/blockers. Never weaken tests, delete required content, force a Rust rewrite or regress functionality, quality, portability, compatibility, security or protected performance metrics. Data/documentation-only releases and existing native Rust paths require honest applicability decisions, not artificial ports. Existing local and pinned governance requirements remain intact.

## Mandatory CLI-first / non-interruptive execution

For every task, follow the owner-mandated [Athena CLI-first execution standard](https://github.com/Herbertofury/Athena/blob/main/guidance/CLI_FIRST_EXECUTION.md). Prefer fast official CLI/headless commands, supported APIs/SDKs/connectors and tested local automation. If a required application has no usable structured interface, discover or build a reviewed [CLI-Anything](https://github.com/HKUDS/CLI-Anything) harness over the real supported backend (or a native command surface for first-party code). Use isolated browser/renderer/test sessions for necessary UI proof. Never take over the user's active desktop, mouse, keyboard, focus or browser profile without explicit authorization for unavoidable foreground interaction. Preserve real runtime acceptance, data, permissions, feature parity and portable mode. Record reusable command coverage and unresolved gaps; no fake CLI parity or unnecessary release delay.
