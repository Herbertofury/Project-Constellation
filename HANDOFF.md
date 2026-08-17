# Project Constellation Active Handoff

Project Constellation is **ACTIVE** in **NORMAL OPERATION** at **v0.5.0**. Missing ephemeral files are not a restoration condition.

## Startup

Read the root `AGENTS.md`, then this directory's `AGENTS.md`, `PROJECT.json`, `STATUS.json`, `Project-Constellation-Automation-State.json`, `ACTIVE-CHECKPOINT.json`, and the Drive-published `Project-Constellation-Project-Catalog.json`. Locate same-named artifacts in Drive and compare their hashes with `lastAutomationHash`. If a newer user-edited artifact exists, merge from it and preserve the user's state.

## Current product

The v0.5.0 line contains exactly 63 tracked records and keeps Sports Group Hub absent. It retains quick checkpoints, resume capsules, Ideas & Research decisions, snapshot export/import, and the permanent zero-setup Quick View. This pass adds persistent Continuity Lenses, an explicit Today queue, the Review Queue with reviewed/defer controls, Changed Since Last Visit, legacy v0.4.x local-state migration, research promotion that sets the exact next action, 63 standalone wiki pages, and a self-contained master continuity command center.

The first 25 records preserve the durable 2026-08-09 project database detail. The remaining 38 current continuity records are evidence-backed project tracks assembled from durable artifacts and previously verified Project Constellation continuity because the exact prior v0.4.2 63-entry catalog bytes were not found. Their metadata can be refined by newer project-owned evidence without dropping user state or silently changing the 63-record list.

## Research cursor

This pass refreshed PRJ-014, PRJ-015, PRJ-016, PRJ-019, and PRJ-020, plus the global Continuity Lenses app research. Next run should rotate away from those unless fresh evidence materially changes them.

## Verification

Static validation passed for 63 records, Sports Group Hub absence, JavaScript syntax, JSON parsing, goal/requirements/history presence, research contract rendering data, local wiki links, hash agreement, and both ZIP integrity checks. All four presentation artifacts were re-downloaded from Drive and SHA-256 matched. Chromium was attempted but timed out with D-Bus runtime errors before producing a DOM, so browser interaction is not claimed.

## Tracked-project wiki maintenance checkpoint

ProjectDump maintains source-controlled Markdown wikis under `wikis/` for projects tracked inside Project Constellation rather than documenting Project Constellation itself. The current indexed detailed-wiki coverage is **16 tracked projects**.

Latest verified addition: `PCX-040 - Pinterest Nocturne`. The wiki is grounded in the exact Drive-published v1.9.0 source archive plus the project-owned UltraDeck recovery repository. The documentation pass downloaded the 400,272-byte source ZIP, recorded SHA-256 `e2fa38831c8969fc4a8b1919f92a69e1e50dec607a5c6425ee2e3b5a6734a8d7`, verified ZIP integrity, passed `npm run build`, `npm run test:static`, and `npm run package`, and documented the manifest, popup/settings, MAIN-world page engine, Lean Browsing, Deep Horizon, media-gated idle runway, Interaction Priority behavior, build/package/test commands, browser installation, modification map, correctness invariants, and troubleshooting. The current-run `test:interaction` lane exceeded the execution window, so fresh runtime interaction success is not claimed.

`PRJ-025 - UltraDeck` also received a material freshness update after the canonical repository began staging a v8.2.0 multi-part source bootstrap. The transfer advanced through commit `da8730240779d1e2508737a0b8c5eee38a0bd11d`, message `Stage UltraDeck v8.2 bootstrap 005/018`, exposing `v82.b64.000` through `v82.b64.004`. v8.2 is therefore recorded as an incomplete in-progress successor and is not promoted over the fully described v8.1.0 line until all 18 parts are reconstructed and verified.

Wiki index: `wikis/README.md`.

## Next pass

Continue normal Project Constellation operation from this checkpoint. Do not begin with a broad restoration sweep.
