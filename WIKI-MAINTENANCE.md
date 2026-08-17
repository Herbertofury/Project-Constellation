# Project Constellation Tracked-Project Wiki Maintenance

This is the durable documentation-maintenance checkpoint for the **projects tracked inside Project Constellation**. Project Constellation itself is the control plane and is excluded from target-project wiki coverage.

## Current checkpoint

- Detailed target-project wiki coverage: **56 tracked projects**.
- Reader-facing documentation surface: **https://github.com/Herbertofury/ProjectDump/wiki**.
- Canonical version-controlled Wiki source: `Herbertofury/ProjectDump`, `main`, directory `wikis/`.
- Real GitHub Wiki repository: `Herbertofury/ProjectDump.wiki.git`.
- Publication workflow: `.github/workflows/sync-github-wiki.yml` calling `tools/github-wiki/wiki-sync.sh`.
- Latest Wiki-structure source commit verified for this checkpoint: `cc5d0395f483e968fd7b439306652f67b2a26de0` (`docs: make GitHub Wiki the published project documentation surface`).
- Verified GitHub Actions run: `32057181995`, conclusion `success`.
- Verified published Wiki master commit: `757c64f982600522cb05b648a678ff0b7173dfca`.
- The publisher pushed the source changes into `ProjectDump.wiki.git`, fresh-cloned the Wiki after publication, and byte-compared the complete remote page set against `wikis/`; the comparison passed.
- `Home.md` now identifies the GitHub Wiki as the live project-documentation surface and directs readers to the complete project index.
- `_Sidebar.md` now provides real GitHub Wiki navigation grouped across core products, GameSync systems, mascot/Shimeji/Petz, Feature Foundry, RuneLite, Sims, MO2, project tooling, and other tracked projects.
- `README.md` now states explicitly that `wikis/` is the source tree rather than the final documentation destination and requires successful `.wiki.git` publication plus fresh-clone verification before a wiki update is complete.
- `PCX-036 - Project Constellation` remains only a preserved legacy control-plane reference and is excluded from the 56-project target coverage count.
- Remaining tracked projects without detailed target-project Wiki pages are **PRJ-015 through PRJ-020**. The current research cursor already prioritizes PRJ-015 through PRJ-019 next, with PRJ-020 remaining after that pass.

## Maintenance rule

For every future material project-wiki update:

1. edit or create the project page under `wikis/` on the canonical ProjectDump `main` branch;
2. preserve verified project detail and avoid cosmetic churn;
3. require the `Sync GitHub Wiki` workflow to complete successfully;
4. require the publisher's fresh-clone byte comparison against `ProjectDump.wiki.git` to pass;
5. treat the **actual GitHub Wiki page** as the published documentation result, not merely the Markdown source file in the normal repository;
6. point user-facing documentation links to `https://github.com/Herbertofury/ProjectDump/wiki/...` whenever the corresponding Wiki page is published;
7. update this same checkpoint only after material documentation or publication-state changes.
