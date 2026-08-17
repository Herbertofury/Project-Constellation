# Project Constellation Tracked-Project Wiki Maintenance

This is the durable documentation-maintenance checkpoint for the **projects tracked inside Project Constellation**. Project Constellation itself is the control plane and is excluded from target-project wiki coverage.

## Current checkpoint

- Detailed target-project wiki coverage: **44 tracked projects**.
- Latest material wiki addition: **PRJ-004 - Aesthetic Media Companion / Living Room Platform**.
- Wiki path: `wikis/PRJ-004-aesthetic-media-companion-living-room.md`.
- Historical Project Constellation status remains `PRECURSOR / MERGED`, but newer project-owned evidence proves a substantial current Living Room implementation in `Herbertofury/Gamesync` plus the cross-host schema/ownership contract in `Herbertofury/GameSync-Next`.
- Verified shipping baseline: GameSync `0.6.3`, `main` observed at commit `a8e37976eb0b3ee3c4ec5e802b02d3bfa1f41928`.
- Verified current implementation includes the Room tab, persistent room state and manual snapshots, Pixi-rendered scene source, Rapier-compatible physics with fallback, Asset Vault, aesthetic catalogue/explorer/media companion, mascot/loot integration, Mystery Engine, world time/weather/season orchestration, AI assistant, export/import, bounded backups, onboarding, and accessibility helpers.
- Verified shared contract: `GameSync-Next/packages/shared/src/livingRoom.ts`, contract version 1, with Opera Extension -> Extension V2 -> desktop rollout order and a real Extension V2 host bridge.
- Material unresolved boundary: shipping GameSync loads a checked-in `living-room-tab.bundle.js`, while the current root package/scripts inspected in this pass do not expose a verified reproducible command/dependency path that rebuilds that bundle from the modular Living Room source. `npm run build` is verified for packaging the extension, not for regenerating the Living Room bundle.
- Highest-value next Living Room proof: recover or establish the canonical bundle-generation command/dependency graph, regenerate the bundle from current modular source, then exercise the Room tab end-to-end in the real Opera GX extension with persistence/restart and Extension V2 parity checks.

## Maintenance rule

Update this same file after future material tracked-project wiki work. Keep it concise: coverage count, latest project(s), source baseline, important newly verified facts, material unresolved boundaries, and the next documentation/verification target. Do not create one checkpoint file per project and do not use this log as a substitute for the detailed project wiki itself.
