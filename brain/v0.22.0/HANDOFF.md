# Project Constellation 0.22.0 handoff

Continue from the current canonical root. The full original application,
0.21 attention/sensor work, browser-bound Rust lifecycle, quick Windows setup
and complete Computer-Link migration belong together. Preserve all source and
historical Git bundles. Do not delete the upstream Computer-Link repository as
part of this work.

The owner authorized GitHub publication and explicitly requires release
closeout. The supported GitHub app can publish commits/branches/PRs; missing
local `gh` authentication is not proof the app lacks write access. The release
workflow can start from `release/v0.22.0` and create its own matching tag/release.
Never put an unrelated service credential into Git to bypass an auth failure.

Run and inspect all five reusable gates in `.github/workflows/release.yml`.
Use the exact accepted commit for all builds. Runtime receipts, hashes and
actual published-byte readback are the final release evidence. Source
checkpoints remain truthful about their pre-publication state; the attached
release receipts record the final commit without requiring a circular commit.

Four pre-existing local edits in `tools/chatgpt-ui-rescue/*.ps1` were outside this
upgrade. Preserve them and exclude them from the coordinated release commit.
Build from a clean isolated checkout when the owner's workspace contains those
unrelated edits. Generated output is under `build/` and `logs/`.

The compact native installer and full desktop installer are separate products
of the same source. The compact setup stages sensors and native tools; browser
enablement remains manual. Each monitored browser/profile requires a sensor.
The unsigned Firefox sensor is temporary. Native Computer Tools require their
local session controls and keep a separate explicit lifetime from the browser
hub. Monitor observations alone grant no computer control.

Read the migration map and optimizer receipt before changing native APIs or
removing diagnostics. The optional Python diagnostics and utility recipes are
preserved. No unmeasured speedup or forced Rust rewrite was accepted.

The local renderer can prove DOM/layout/content-script behavior but not an
installed MV3 extension. `extension_load_smoke.py` now asserts a real worker,
identity, runtime reply and rendered popup. Keep that meaningful failure gate.
Physical sound, owner browser coverage and account-specific backup acceptance
remain target-machine work even after hosted Windows/browser tests pass.

## Historical bundle publication restriction

Automatic approval review rejected the public all-history Git bundle even
after fresh public-ref comparison, strict graph verification and a bounded
credential scan. Do not re-encode it or upload it indirectly. Both `.bundle`
files remain excluded from public source and release artifacts. A verified
private history checkpoint preserves them for the owner. The source verifier
must keep exact ref/tree/import checks when using a read-only public-upstream
fallback. Obtain specific approval for that historical binary before public
archive migration; do not delete upstream while that work is incomplete.
