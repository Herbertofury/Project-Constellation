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

The v0.14.0 source, tests, Nightfall UI, provider adapters, OAuth backends, documentation, wiki, workflows, production build gates, and packaging pipeline are complete. Both public OAuth client IDs are installed as GitHub Actions secrets and the credentialed local production build passes. The Needs Attention persistence regression is repaired at its source: IndexedDB v8 upgrades in place through v10, boolean organizer indexes become valid numeric derived keys, existing flags are migrated without clearing data, rapid settings mutations are serialized, accessible ON/OFF switches autosave while explicit Save Settings buttons confirm the complete visible state, organizer/recovery actions report real backend failures, and browser regression coverage exercises migration, save/readback, full UI reconstruction, plus pinned, favorite, and archive filters. Home also uses verified store counts and never renders a summary failure as fake zero chats. If a newly loaded Home page is temporarily paired with an older failing service worker, it reads settings directly and shows a background-reload warning instead of false OFF placeholders.

Approval Autopilot now matches ChatGPT's current ordinary inline provider card rather than requiring dialog roles or older connector wording. A narrow observer stays available independently of broad capture, detects new approval cards immediately, locates nested/icon-only split-button chevrons, opens portalled menus, and selects provider-specific **Allow … for this conversation** controls. Each action is confirmed by the card disappearing; ignored clicks return `failed/unconfirmed` and enter a bounded retry instead of generating fake recovery state. The approval browser sentinel recreates the current GitHub card structure and passes automatic mount-triggered selection, persistent, checkbox, fallback, refresh, rate-limit, resume, and rejected-click cases.

Execution Pulse now opens expanded even in compact mode and reports the current observable ChatGPT agent step, explicit evidence confidence, a bounded seven-row response/tool/status/network/recovery timeline, sanitized request lifecycle, page/capacity health, and real stale/stall escalation. It recognizes current tertiary/loading-shimmer step markup instead of stopping at generic `Called tool` rows. Agent-bearing response/tool/search/file traffic is separated from history/sidebar/session traffic, so background requests cannot fabricate “still working.” Its always-present **Branch & continue** action creates a durable checkpoint at any time, opens a fresh provider chat, transfers continuation context through the native composer, confirms observable outcomes, and records parent/child lineage without overwriting an existing draft. The provider-page performance path coalesces repeated upserts, defers nonessential scans under pressure, avoids buffered long-task replay and 500 ms storage-write churn, change-gates HUD rendering, and automatically removes only decorative aria-hidden animation/blur during measured pressure. Full core/validation and all 18 browser workflows pass, including branch transfer and a 320-turn/120-node burst preservation regression.

Execution Pulse also owns the permanent **⇄ Output Vault**. IndexedDB v10 retains distinct per-turn fingerprints and bounded authoritative output snapshots, while the canonical assistant turn keeps its richest known text, semantic formatting, code, links, and media instead of accepting a later truncated/tool-only overwrite. A shared `ResizeObserver`-driven corner dock temporarily compacts Pulse, stacks Vault without collision, reserves Pulse space even in full-workspace mode, and restores Pulse on close. Reader mode reconstructs safe ChatGPT-like headings, emphasis, lists, quotes, tables, code, links, and compact activity groups from bounded semantic Markdown; Raw mode preserves the exact flattened text, and older card bodies defer Reader construction until opened. The vault searches every saved assistant output, highlights saved/current differences, lists files and builds, lazily previews supported media, exposes revision history, exports Markdown, and branches from a selected saved answer. Passive comparison reads only a 96-turn tail, suppresses itself during streaming/hydration/off-bottom states, and never fetches provider media. Browser coverage recreates the exact refresh-loss failure and verifies preservation, critical health, Pulse/Vault stacking, Reader/Raw fidelity, comparison, collapse/expand, media/file/link/code rendering, and revision recovery.

The remaining non-simulated gate is signed-in acceptance in the user's existing Chrome profile. Do not tag a production release until Google connection, GitHub device authorization, account identity verification, token refresh/retry behavior, repository selection, sync, disconnect, service-worker restart, and persistence/recovery have been exercised with the actual production build.

## Finalization sequence

1. Connect Codex to the user's existing Chrome through the supported Chrome browser extension.
2. Load `build/unpacked`, confirm extension ID `geljambmkfjkhodgkpjhnmfojkpcamig`, and run the signed-in OAuth and persistence acceptance checklist.
3. Update this brain state with the observed evidence; run `npm run verify` again.
4. Rebuild and package production from a clean final commit.
5. Tag `v0.14.0`, let the release workflow publish, and redownload/verify every release asset.
6. Create `v0.14.0 Nightfall` under the canonical Drive root, upload the complete release set, redownload/hash material files, and append the ACTIVE CHECKPOINT.
7. Reconcile local main, origin/main, tag, release, wiki, Drive folder, checksums, and continuation pointers before declaring current.
