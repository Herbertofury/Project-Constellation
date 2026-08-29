# Project Constellation v0.14.11 handoff

## Objective

Fix the real failure where ChatGPT reaches **“You've reached the maximum length for this conversation … starting a new chat”** before Constellation tells the user to branch, while preserving the existing stall, interruption, state-convergence, and no-surprise-navigation safety work.

## Root causes fixed

- The exact current ChatGPT maximum-length phrase was missing from the hard provider-limit matcher.
- Capacity Guard relied heavily on visible/stored user/assistant turns and measured text, while structured tool/app messages could expand the active branch without comparable visible text.
- The old untouched default profile (180 warning / 260 handoff / 240k warning chars / 400k handoff chars) was too late for the observed failure class.
- Urgency was mostly hidden in detail text rather than the primary Branch action.

## Implemented

- Health Core v9 uses visible/stored messages, measured characters, full active-branch messages, structured/tool-app messages, and tool-message pressure lanes.
- ChatGPT MAIN-world transcript reduction exports only numeric structured/tool counts; transcript text and auth material remain outside extension state.
- Exact hard-limit copy becomes `capacity-reached`; provider near-limit wording becomes immediate `capacity-handoff` when exposed.
- Default local safety profile is now 120 warning / 180 handoff and 160k / 280k measured characters. Upgrade migration changes the legacy default tuple only; custom threshold values remain custom.
- Adaptive structured-branch pressure warns/handoffs before a fixed visible-turn threshold when tool/app activity is consuming runway quickly.
- Execution Pulse changes its explicit user action to **Branch soon** at watch and **Branch now** at handoff/reached. Passive monitoring still never opens, focuses, navigates, reloads, retries, or branches ChatGPT automatically.
- Capacity pressure at or above the configured handoff threshold renders as `100%+` rather than misleading values such as 150%.
- DOM-only counts no longer claim `full-branch measurement`; that chip requires actual transcript/branch evidence.
- Approval Autopilot settings copy now truthfully says recovery is open-tabs-only and never creates a hidden recovery window.

## Verification boundary

- 10/10 unit/contract suites pass.
- Validation + UI/message contracts pass (56 owned UI message types).
- All 27 browser smoke workflows pass in bounded gates.
- Exact regression: 130 visible messages with no provider banner -> `capacity-watch` / Branch soon.
- Exact provider banner -> `capacity-reached` immediately.
- Structured/tool pressure scenarios warn/handoff earlier than visible-turn-only counting.
- Legacy default migration -> 120/180 and 160k/280k; custom values are preserved.
- Existing 121-second unchanged-tool stall, 270-turn handoff, Interruption Guardian, State Convergence, Approval Recovery open-tabs-only, Branch & Continue, full capture, provider, popup, Home, sidepanel, Workbench and tab-beacon smokes remain green.

## Durable checkpoint

Drive folder: `1vgnNohRG09qEZZpJM-vEeF-q5sIzKST3` (`v0.14.11 Early Branch Guard`).

A runnable dev ZIP and full source checkpoint are published and round-trip verified there before PR/CI. Final source-checkpoint SHA will be refreshed after this handoff/status file is included.

## Next gate

Freeze the exact v0.14.11 delta against canonical v0.14.10 commit `a32f01c278529b5d598f707bb17c2266597f94c5`, publish through branch -> PR clean-room CI -> squash merge -> production release. Redownload and hash the production bytes, replace the Drive folder with/add the final production release assets, and append the ACTIVE CHECKPOINT.
