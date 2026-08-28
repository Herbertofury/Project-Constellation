# Project Constellation v0.14.11 handoff

## Objective

Prevent a healthy tool-heavy chat from reaching ChatGPT’s hard maximum-conversation banner without an earlier Branch & continue warning.

## Root causes

1. The exact provider text “You’ve reached the maximum length for this conversation … starting a new chat” was not matched by the existing hard-limit regex.
2. Capacity Guard received ChatGPT `activeBranchMessages` metadata but discarded it; tool/app/structured branch messages could grow substantially while visible turn count stayed below 180/260 and measured text stayed below the old character thresholds.
3. Existing installations could preserve the older default threshold tuple, so changing source defaults alone would not improve an upgraded user.

## Implementation

- Health Core v9 adds reusable provider capacity-signal classification, full active-branch and structured-message pressure, adaptive watch/handoff zones, and earlier defaults.
- ChatGPT MAIN-world transcript reduction adds only numeric structured/tool-message counts.
- Live Sentinel scans targeted non-turn provider status surfaces for hard/near-limit wording and feeds the result into Health Core.
- Content merges Sentinel capacity evidence back into the single Execution Pulse renderer, keeping capacity attention primary while work is healthy.
- Background migrates only untouched legacy capacity defaults to the safer profile; explicit custom threshold choices are preserved.

## Safety

No automatic branching, navigation, reload, or retry. Branch & continue remains a user click.

## Targeted verification checkpoint

- 11/11 unit/contract suites pass, including a dedicated one-shot legacy-default migration regression.
- `npm run validate` passes all static/UI/message contracts.
- State Convergence smoke passes with Health Core v9 as the single current HUD owner.
- Live Health smoke proves `Branch now while this chat is healthy` stays primary while response time, no-progress, network, and tool-step telemetry continue updating.
- Runway hot-upgrade smoke proves the 121-second real stall, 270-turn handoff, and exact provider hard-limit banner still classify correctly.
- Fresh development build v0.14.11 is runnable at `build/unpacked`.

## QoL polish

- Legacy hot-upgrade HUDs use `hard limit · branch`, `branch now`, and `branch soon` instead of the older secure/watch wording.
- Approval Recovery settings now truthfully state that recovery is open-tabs-only and never opens/navigates/reloads hidden ChatGPT windows.
- Capacity warnings no longer blank the active response timer simply because capacity is the primary state.

