# Project Constellation Tracked-Project Wiki Maintenance

This is the durable documentation-maintenance checkpoint for the **projects tracked inside Project Constellation**. Project Constellation itself is the control plane and is excluded from target-project wiki coverage except for the preserved legacy PCX-036 reference.

## Current checkpoint

- Detailed target-project wiki coverage: **62 tracked projects**, which is the complete target set inside the 63-record Project Constellation catalog after excluding PCX-036 itself.
- Reader-facing documentation surface: **https://github.com/Herbertofury/ProjectDump/wiki**.
- Canonical version-controlled Wiki source: `Herbertofury/ProjectDump`, `main`, directory `wikis/`.
- Real GitHub Wiki repository: `Herbertofury/ProjectDump.wiki.git`.
- Publication workflow: `.github/workflows/sync-github-wiki.yml` calling `tools/github-wiki/wiki-sync.sh`.
- Current Wiki source index: `wikis/README.md`, reporting **62 tracked projects**.
- Current navigation includes PRJ-020 Master Desktop Pet Research in `_Sidebar.md`; all tracked project pages are indexed.
- `PCX-036 - Project Constellation` remains a preserved legacy control-plane reference and is excluded from the 62-project target coverage count.

## Latest verified publication proof

The Wiki publication path now emits a machine-readable commit status named `wiki-publication` only after the publisher has completed its fresh-clone byte comparison and resolved the remote Wiki master commit.

Latest verified source checkpoint that changed Wiki content:

- ProjectDump source commit: `9bb798006e34c1122e40eae1037144a1247f2001` (`docs: record machine-verifiable wiki publication proof`).
- GitHub Actions run: `32083218948`.
- Run conclusion: `success`.
- Published Wiki master commit: `31c2cc1347f86669ce45710963d1c2a970e93223`.
- Source-commit status: `wiki-publication = success`.
- The publisher pushed the Wiki update, fresh-cloned `Herbertofury/ProjectDump.wiki.git`, byte-compared the complete clone against `wikis/`, and reported the exact remote Wiki master commit.

The immediately preceding workflow self-verification checkpoint was source commit `60bb4e8bee1afdc20369432bc0e0b8231d1cb240`, Actions run `32083124479`, with `wiki-publication = success` and Wiki master `912305b14458ea5ac5340ed0ed1f3432fd9b97d3`. That run proved the new status mechanism even when the remote Wiki already matched the source.

## Recent coverage completion and material refreshes

The final missing target-project page was `PRJ-020 - Master Desktop Pet Research`. Its detailed source page is now `wikis/PRJ-020-master-desktop-pet-research.md`, and it is indexed in `README.md` and `_Sidebar.md`.

The subsequent PRJ-020/022/023/024/025 pass materially refreshed current project evidence while preserving runtime boundaries:

- PRJ-020: added the fresh NeurolingsCE Rust + Flutter rewrite as an architecture/parity benchmark only, while preserving the canonical `master desktop pet research.md` recovery requirement and v10/v14/v9/v7 lineage.
- PRJ-022: refreshed current Feral toolchain evidence and kept the generated base non-shippable until its real baseline/rehearsal/rollback gates pass.
- PRJ-023: refreshed Portable Feature Starter toolchain evidence while prioritizing truthful Vue/Tauri identity and reproducible generation before major migrations.
- PRJ-024: intentionally preserved the coordinated MO2 compatibility versions because the real Windows MO2 v2.5.2 drag/column/theme-DPI/restart gate remains the meaningful blocker.
- PRJ-025: advanced the UltraDeck wiki to canonical v8.5.0 and removed the stale assumption that the incomplete v8.2 bootstrap was the newest project state.

The PRJ-020/022/023/025 wiki mirrors and the corresponding Project Constellation research/checkpoint documents were also published to the connected Project Wikis / Project Constellation Google Drive locations and re-read as non-empty durable copies. The current checkpoint file for that pass is `project-constellation/evolution/2026-08-17T2338Z-prj-020-025.json`.

## Machine-verifiable Wiki publication contract

For every future material project-wiki update:

1. edit or create the project page under `wikis/` on canonical ProjectDump `main`;
2. preserve verified project detail and avoid cosmetic churn;
3. require the exact triggering source commit to receive `wiki-publication = success`;
4. follow that status to the exact `Sync GitHub Wiki` Actions run and require conclusion `success`;
5. inspect the publisher evidence when needed and require the fresh-clone byte comparison against `ProjectDump.wiki.git` to pass;
6. capture the exact published Wiki master commit from the workflow output/status description;
7. treat the **actual GitHub Wiki page** as the published documentation result, not merely the Markdown source file in the normal repository;
8. point user-facing documentation links to `https://github.com/Herbertofury/ProjectDump/wiki/...`;
9. publish the corresponding durable project-wiki/checkpoint output to the appropriate connected Google Drive folder and re-read/re-download it before treating dual publication as complete;
10. update this same checkpoint only after material documentation, coverage, or publication-path changes.

## Next maintenance direction

Coverage is complete, so future runs should be **freshness and depth passes**, not page-count churn. Prioritize tracked projects whose canonical repositories or artifacts materially changed, whose wiki still lacks verified install/build/test/operate detail, or whose current runtime evidence contradicts older Project Constellation summaries. Preserve the 62-target coverage invariant unless the user changes the tracked project catalog.
