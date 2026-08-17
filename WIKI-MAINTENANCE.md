# Project Constellation Tracked-Project Wiki Maintenance

This is the durable documentation-maintenance checkpoint for the **projects tracked inside Project Constellation**. Project Constellation itself is the control plane and is excluded from target-project wiki coverage.

## Current checkpoint

- Detailed target-project wiki coverage: **48 tracked projects**.
- Latest material wiki addition: **PRJ-007 - PF Magic Petz Runtime Integration**.
- Wiki path: `wikis/PRJ-007-pf-magic-petz-runtime-integration.md`.
- Strongest current implementation source: `Herbertofury/GameSync-Next`, `main`, with dedicated `packages/petz-engine`, `packages/petz-compat`, `packages/petz-formats`, and `packages/petz-bridge` workspaces. The current JavaScript `Herbertofury/Gamesync` extension remains the user-facing parity baseline.
- Newly verified architecture: the typed Petz engine is platform-agnostic; compatibility packs cover Dogz 1, Catz 1, Oddballz, Petz 2, Petz 3, Petz 4, Babyz and Petz 5; the formats package contains breed/LNZ/pet/toy/clothing/scene readers; and the mascot bridge maps the shared engine into the GameSync mascot contract for shipping Opera GameSync and Extension V2.
- Newly verified domain behavior: six motives, a 22-trait PF Magic-style personality model, semantic Petz actions, physics, pack/content registration, serialize/restore helpers, custom content bundles and per-family compatibility settings are present in current typed source.
- Material implementation boundaries: `petz-bridge` currently contains a TODO for restoring loaded save data during spawn; its inspected tick environment still supplies placeholder cursor/toy proximity data; the Petz workspace manifests expose build/typecheck but no dedicated Petz test scripts; and the root `build:packages` command does not currently include the Petz workspaces.
- Historical source continuity still records `C:\Users\Owner\Desktop\GameSync\PF Magic`, but that local source tree was not directly readable through the connected source evidence in this pass and has not been byte-reconciled against the GitHub packages.
- Documentation synchronization debt discovered: `wikis/PCX-061-petz-shared-core.md` still says GameSync Next / desktop parity is unverified and treats shipping GameSync as the only verified implementation host. Current GameSync Next source materially supersedes that statement. Preserve the page's existing detailed shipping-runtime material, but refresh its source-resolution, shared-core architecture, host-adapter and verification-boundary sections on the next Petz-focused pass.
- Highest-value PRJ-007 engineering proof: add Petz-specific engine/compat/formats/bridge tests, finish bridge restore, feed real cursor/toy environment data, explicitly integrate Petz workspaces into the intended aggregate build/test lane, then run representative Catz/Dogz/Oddballz scenarios across shipping GameSync, Extension V2 and desktop with restart persistence evidence.
- Remaining uncovered tracked-project documentation candidates include PRJ-001, PRJ-009, PRJ-011 through PRJ-021, and PCX-062. Prefer current project-owned source evidence over recovery-only summaries.

## Maintenance rule

Update this same file after future material tracked-project wiki work. Keep it concise: coverage count, latest project(s), source baseline, important newly verified facts, material unresolved boundaries, and the next documentation/verification target. Do not create one checkpoint file per project and do not use this log as a substitute for the detailed project wiki itself.
