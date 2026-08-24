# Project Constellation v0.14.0 handoff

Current candidate: **v0.14.0 — Nightfall**.

## Canonical continuation authority

- Local workspace: `C:\Users\Owner\Desktop\Project Constellation`
- Repository: `Herbertofury/Project-Constellation`
- Wiki: `Herbertofury/Project-Constellation.wiki.git`
- Drive root: `1mUSeFlumpIOBtVCmlwbhN11kChRsdblV`
- Active checkpoint: `1cGHmUG-iMUnDoncLSWsZL9ZudZ80fltnYRn-Ogwd4rU`
- Base release: v0.13.0 in Drive folder `10pAXUoi3jRJz9e8uY7aZ37-B3OJcZ_Vu`

ProjectDump is historical input only. Never write current Project Constellation work back to it or use it as a recovery authority.

## Candidate state

The v0.14.0 source, tests, Nightfall UI, provider adapters, OAuth backends, documentation, wiki, workflows, production build gates, and packaging pipeline are complete. Both public OAuth client IDs are installed as GitHub Actions secrets and the credentialed local production build passes. The Needs Attention persistence regression is repaired: no boolean is passed to `IDBKeyRange.only`, rapid settings mutations are serialized, accessible ON/OFF switches autosave while explicit Save Settings buttons confirm the complete visible state, organizer/recovery actions report real backend failures, and browser regression coverage exercises save/readback, full UI reconstruction, plus pinned, favorite, and archive filters. If a newly loaded Home page is temporarily paired with an older failing service worker, it now reads settings directly and shows a background-reload warning instead of false OFF placeholders.

The remaining non-simulated gate is signed-in acceptance in the user's existing Chrome profile. Do not tag a production release until Google connection, GitHub device authorization, account identity verification, token refresh/retry behavior, repository selection, sync, disconnect, service-worker restart, and persistence/recovery have been exercised with the actual production build.

## Finalization sequence

1. Connect Codex to the user's existing Chrome through the supported Chrome browser extension.
2. Load `build/unpacked`, confirm extension ID `geljambmkfjkhodgkpjhnmfojkpcamig`, and run the signed-in OAuth and persistence acceptance checklist.
3. Update this brain state with the observed evidence; run `npm run verify` again.
4. Rebuild and package production from a clean final commit.
5. Tag `v0.14.0`, let the release workflow publish, and redownload/verify every release asset.
6. Create `v0.14.0 Nightfall` under the canonical Drive root, upload the complete release set, redownload/hash material files, and append the ACTIVE CHECKPOINT.
7. Reconcile local main, origin/main, tag, release, wiki, Drive folder, checksums, and continuation pointers before declaring current.
