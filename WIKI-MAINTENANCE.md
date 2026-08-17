# Project Constellation Tracked-Project Wiki Maintenance

This is the durable documentation-maintenance checkpoint for the **projects tracked inside Project Constellation**. Project Constellation itself is the control plane and is excluded from target-project wiki coverage.

## Current checkpoint

- Detailed target-project wiki coverage: **45 tracked projects**.
- Latest material wiki addition: **PRJ-008 - Mascot Games / Sports and Golf Flagship**.
- Wiki path: `wikis/PRJ-008-mascot-games-sports-golf.md`.
- Historical Project Constellation evidence describes Golf as the flagship and requires real playable sports loops across mascot hosts.
- Verified current implementation baseline: `Herbertofury/Gamesync` `0.6.3`, `main` observed at commit `a8e37976eb0b3ee3c4ec5e802b02d3bfa1f41928`.
- Current shipping source proves a broad mascot-game framework with **23 accepted `GS_START_GAME` IDs**, strict allowlisted dynamic script injection, shared dt-based game rendering/physics, authentic Shimeji-pack mascot drawing, daily/weekly challenges, game modifiers, unlock/loadout progression, loot/social state, skins and Mascot Studio integration.
- Current source includes substantial real sports/game implementations such as Bowling and Tennis. Tennis includes ball spin/curve, seven shot types, deuce/advantage/game/set/match scoring, adaptive AI and match-point effects; Bowling includes a fixed physics loop, ten-frame structure, live mascot pins and collision/fling behavior.
- Material correction: **Golf is not in the current verified shipping game-launch registry, the inspected shared mascot-game tree has no Golf module, and the script-injection allowlist has no Golf path.** Golf therefore remains a preserved historical requirement, not verified current behavior.
- Material verification boundary: the root package exposes no dedicated Mascot Games automated test suite, and this pass does not claim that all 23 accepted game paths were exercised end-to-end in Opera GX.
- Highest-value next PRJ-008 proof: run the built `dist/` extension in real Opera GX and qualify all accepted game IDs, prioritizing Bowling, Tennis, Racing, Air Hockey, Volleyball, Pinball and Fishing, including launch, controls, authored mascot rendering, progression, cleanup, persistence and restart behavior. Then establish GameSync Next parity and decide the disposition of the Golf flagship requirement.

## Maintenance rule

Update this same file after future material tracked-project wiki work. Keep it concise: coverage count, latest project(s), source baseline, important newly verified facts, material unresolved boundaries, and the next documentation/verification target. Do not create one checkpoint file per project and do not use this log as a substitute for the detailed project wiki itself.
