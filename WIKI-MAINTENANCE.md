# Project Constellation Tracked-Project Wiki Maintenance

This is the durable documentation-maintenance checkpoint for the **projects tracked inside Project Constellation**. Project Constellation itself is the control plane and is excluded from target-project wiki coverage.

## Current checkpoint

- Detailed target-project wiki coverage: **46 tracked projects**.
- Latest material wiki addition: **PRJ-010 - RuneLite FlipForge / Farm Material Ranker / No-Hitch / 117HD Family**.
- Wiki path: `wikis/PRJ-010-runelite-flipforge-family.md`.
- Current connected GitHub publication point: `Herbertofury/FlipForge`, `main`.
- Verified repository boundary: the connected FlipForge repository currently contains only an 11-byte `README.md` with `# FlipForge`, repository size `0`, no detected language, and only the initial commit `03cb2057c480929831852fed8fd866954e3ad5c0`. It is a project identity/publication placeholder, not the recovered implementation source.
- Durable PRJ-010 evidence preserves the family components: FlipForge (`flipfore-osrs` historical naming), Farm Material Ranker, Rust dashboard/bridge, No-Hitch RuneLite launcher/runtime, and 117HD/RLHD integration.
- Latest recovered Farm Material Ranker identity: **v1.1.0**, with searchable sidebar, OSRS/GE pricing, item icons, sorting, monster metadata and shortest-path routing; artifact name `farm-material-ranker.zip`.
- Known-good No-Hitch reference identity: `hitchless-runelite-main.jar`, SHA-256 `80d99e72d82ad28a5fe7779d7325450b487edb2c9c1f617b2e75acfa39f61d89`, size `57,842,944` bytes, main class `com.bertsplugins.hitchless.HitchlessRuneLiteMain`, embedded RuneLite `1.12.29.1`, recorded source commit `68ff80e`.
- Material blocker: current connected Drive search resolves these artifacts only through durable Project Constellation continuity references; the implementation source, Farm Material Ranker ZIP, Rust bridge source, and 117HD wiring were not independently recovered during this documentation pass.
- Hard release gate preserved: both external plugins must be visible, enabled, functional, and persistent after restart in the actual Jagex-launched RuneLite client. Compilation, JAR inspection, or developer-mode loading alone is insufficient.
- Highest-value next PRJ-010 documentation step: recover the latest FlipForge/Farm Material Ranker/No-Hitch implementation artifacts, reconcile hashes and manifests without overwriting the known-good reference, restore canonical source, then replace recovery-only wiki sections with exact project-owned build/install/configuration/API/module instructions and perform the real-client restart-persistence qualification.

## Maintenance rule

Update this same file after future material tracked-project wiki work. Keep it concise: coverage count, latest project(s), source baseline, important newly verified facts, material unresolved boundaries, and the next documentation/verification target. Do not create one checkpoint file per project and do not use this log as a substitute for the detailed project wiki itself.
