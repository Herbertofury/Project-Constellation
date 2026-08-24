# Project Constellation agent contract

`C:\Users\Owner\Desktop\Project Constellation` is the canonical local project home. `Herbertofury/Project-Constellation` is the canonical repository. Do not treat ProjectDump as a writable or current source.

Read the highest-versioned `brain/*/COMPASS.json`, its `STATUS.json` and `HANDOFF.md`, `docs/CONTINUATION.md`, and the latest release receipt before making release or recovery decisions. Reconcile Drive and GitHub metadata before declaring a version current.

Source changes belong in `extension/`; tests in `tests/`; tooling in `tools/`; documentation in `docs/`; generated local output in `build/` or `logs/`; immutable evidence in the matching `releases/vX.Y.Z/`; non-current imported state in `recovery/`.

Never commit OAuth secrets, access tokens, refresh tokens, browser profiles, or user chat exports. Google and GitHub client IDs are public configuration, but production builds must receive them through the environment. Preserve the manifest `key` unless intentionally migrating the extension ID and all associated Google OAuth configuration.

Before handoff, run `npm run verify`. Before packaging, run the production build gate, inspect `build/build-info.json`, package, verify `SHA256SUMS.txt`, and update README/docs/wiki/release notes together. Never claim OAuth or remote round-trip success from a mocked test.
