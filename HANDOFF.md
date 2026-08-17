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

ProjectDump now maintains source-controlled Markdown wikis under `wikis/` for projects tracked inside Project Constellation rather than documenting Project Constellation itself. The current indexed detailed-wiki coverage is 10 tracked projects.

Latest verified addition: `PCX-038 - Shimeji Browser Extension`. Its wiki is grounded in the current GameSync `0.6.3` repository implementation, including the embedded Shimeji Browser Engine distribution, `shimeji-browser-bridge.js`, `shimeji-popup-shim.js`, modular mascot-pack runtime, ShimejiEE parser, Manifest V3 wiring, persistence, message flow, install/configuration behavior, modification paths, and verification guidance. The wiki explicitly records that a separate standalone Shimeji Browser Extension GitHub repository is still unresolved and must supersede the embedded GameSync evidence if a newer canonical source is found.

Wiki index: `wikis/README.md`.

## Next pass

Continue normal Project Constellation operation from this checkpoint. Do not begin with a broad restoration sweep.
