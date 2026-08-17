# Project Constellation Tracked-Project Wiki Maintenance

This is the durable documentation-maintenance checkpoint for the **projects tracked inside Project Constellation**. Project Constellation itself is the control plane and is excluded from target-project wiki coverage.

## Current checkpoint

- Detailed target-project wiki coverage: **47 tracked projects**.
- Latest material wiki addition: **PCX-063 - Feature Foundry Aesthetic Vault**.
- Wiki path: `wikis/PCX-063-feature-foundry-aesthetic-vault.md`.
- Current verified implementation name: **Inspiration Vault**.
- Current implementation source: `Herbertofury/GameSync-Next`, `main`, primarily `apps/feature-foundry/src/ui/editors/InspirationVaultEditor.tsx`, with the typed capture contract in `packages/shared/src/featureFoundryCapture.ts` and GameSync Extension V2 bridge/runtime code under `apps/extension-v2/`.
- The separate connected `Herbertofury/Feature-Foundry` repository currently reports repository size `0`, so it is not the strongest implementation source for this track.
- Newly verified behavior: the vault persists structured reference records locally, exposes Inbox / Theme Objects / Sticker Tray / Mystery Games / World Thesis / Collector Cabinet boards, preserves capture/source/provider metadata, and includes browser-side cleanup, palette extraction, styling, and PNG export.
- Newly verified browser integration: GameSync Extension V2 registers Page/Image/Link/Selection context-menu captures under `Save to Feature Foundry`, stages a versioned capture envelope in `chrome.storage.local`, hands it through `feature-foundry-bridge.html`, and routes Feature Foundry directly to `ff-workspace=inspiration-vault`.
- Verified development/build commands: `npm ci`, `npm run dev:feature-foundry`, `npm run build:feature-foundry`; Feature Foundry dev URL is `http://127.0.0.1:5175/`.
- Material verification boundary: this pass verified current source and wire contracts but did not freshly exercise all four capture kinds in a real Opera/Chromium runtime, did not perform deterministic pixel-fixture validation of the cleanup bench, and found no dedicated Inspiration Vault automated test command. The Feature Foundry workspace `lint` script is currently a TODO echo.
- Highest-value next PCX-063 verification step: clean-build Feature Foundry and Extension V2 from one checkout, exercise all four context-menu capture paths in the real browser, verify bridge cleanup/duplicate suppression and restart persistence, then add focused capture/storage/cleanup regression coverage.
- Next uncovered tracked-project documentation candidates remain PRJ-001, PRJ-007, PRJ-009, PRJ-011 through PRJ-021, and PCX-062. Prefer the candidate with the strongest current project-owned source evidence rather than creating another recovery-only page when a live implementation can be documented.

## Maintenance rule

Update this same file after future material tracked-project wiki work. Keep it concise: coverage count, latest project(s), source baseline, important newly verified facts, material unresolved boundaries, and the next documentation/verification target. Do not create one checkpoint file per project and do not use this log as a substitute for the detailed project wiki itself.
