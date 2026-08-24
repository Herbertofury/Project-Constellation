# Project Constellation handoff

Current release: **v0.13.0 — Execution Pulse + Tool Watchdog**.

## Canonical continuation authority

Start with Google Drive. The verified base release is **v0.12.0 — Capacity Guard + Safe Handoff** in Drive folder `1imFkQAFjx53Xtax6F3UXchhGsqtd9iMm`; its full source file is `1d1RfauC1u5O8RAQz-04DPM2b55CqQUd2` with SHA-256 `41f3ef8c5c3734f7d33670179722e7c2b3518804528eeda14f68060661013e6b`. v0.13.0 was derived from those verified Drive bytes.

The ProjectDump v0.5 presentation line is not extension source. The reconstructed `v0.11.1 Atlas + Chat Guardian` lineage is NONCANONICAL_SUPERSEDED and must never be resumed or merged as current extension code.

## v0.13 behavior

- Replaces ambiguous bottom-right health wording with **CONSTELLATION · EXECUTION PULSE**.
- Exposes Last proof, Network, Activity, Tool pulse, Project, Page, Capacity, and Handoff in the expanded HUD; the collapsed HUD still exposes current phase/proof state.
- Counts repeated generic provider events such as `Called tool` as distinct timeline progress rather than ignoring them because their label repeats.
- Keeps a nearby informative tool label when the newest row is generic, while the activity phase still reports the actual newest event type.
- Adds `tool-running`, `tool-quiet`, `tool-stalled`, `tool-dead`, `request-stalled`, and `dead` classifications from combined DOM/tool/network evidence.
- Ages the oldest pending provider request plus latest real request/DOM/tool progress, so a zombie open request cannot keep a dead chat green indefinitely.
- Projects fresh live health/activity/tool-step state into Home, Attention, Inspector, Recovery, Search, and Organizer cards.
- Adds Tool-call watchdog enable/disable and a separate appears-dead threshold to Live Health settings.
- Preserves Capacity Guard + Safe Handoff, Knowledge Vault, Project Integrity/request governance, Approval Autopilot, Full Capture, Workbench, OAuth/durability, and the no-provider-page-fetch performance contract.
- Never clicks provider Retry for delivery/connection recovery; browser refresh remains the only automatic recovery primitive for that failure class.

## Verification completed for the candidate

- `npm test`: PASS.
- `npm run validate`: PASS, including UI/message contracts (49 literal UI message types owned).
- Execution Pulse browser smoke: PASS; repeated generic tool rows increment Tool pulse while healthy progress continues, then a static busy tool becomes `tool-stalled` after the hard threshold with no live request/progress.
- Home browser smoke: PASS; a fresh `liveHealthState=tool-stalled` overrides the older coarse `running` badge and renders watchdog detail.
- Background telemetry/knowledge, 320-turn DOM/deep capture, Approval Recovery, and Full Capture regressions: PASS.
- v0.12 Ferrum gate remains historical evidence: true unpacked-extension execution in this container was blocked before extension startup by the system Chromium policy `Loading of unpacked extensions is disabled by the administrator.` Do not convert that external policy into a false pass.

## Verified v0.13 Drive release

The canonical v0.13.0 release folder is `10pAXUoi3jRJz9e8uY7aZ37-B3OJcZ_Vu` (`v0.13.0 Execution Pulse + Tool Watchdog`). Primary Drive IDs: source `1BE4BxzKCr-sjVnFiwE-cv50vwhGM6GZI`, unpacked `1j5p_9MeJhz2yF6kWjZb4l8d1LY1YIwvv`, evidence `1ewvzPJXWmOnRTZXsw1PL9wuSpppHbt4R`, Execution Pulse proof PNG `1-JsY58YQgLP2TwtoEmKx1fqeosAVknz9`. Final SHA-256/size/readback evidence is stored beside them in the release checkpoint, checksum file, and publication receipt. Unpacked/evidence/PNG remote redownloads are already byte-identical; final source readback is performed after this source package is regenerated in place.

## Persistence rule

For every continuation: **Drive first**. Work from the newest verified FULL Drive state and publish complete material source/build/evidence/checkpoints back to Drive. GitHub/ProjectDump, File Library, hashes, manifests, patches, diffs, receipts, or fragments are never substitutes for the full Drive project deliverable.
