# Constellation Commander v0.4.0 — Final Full Computer Use Checkpoint

Status: **Windows release verified and published**

## Canonical release identity

- Branch: `feature/constellation-commander-v0.4.0`
- Exact release-source workflow commit: `36ba7219a4dab7431f808ca5bfe87332f6d8408b`
- Final Windows Actions run: `35763651353`
- Actions artifact ID: `10711566870`
- Actions outer artifact SHA-256: `1f19914875a94ca6d6a028f50eaa77e88589514dcfe094086062b61fec8eef36`
- Deterministic browser companion ID: `khfbmdpkpnaghpfnacidbjfaaikfmanh`

## Final artifacts

- Windows: `Constellation-Commander-Windows-x64-v0.4.0.zip`
  - SHA-256: `cdd9b5affa4dce63d7254a086c4f5ce1fa37bf1bf3203296793af1fe0f1d6ea4`
  - Drive file ID: `1J11FeBStFsfwO_narRlulbAHD2Jy3sC5`
  - Size: 101,577,666 bytes
- Source: `Constellation-Commander-v0.4.0-source.zip`
  - SHA-256: `74db9559aca1f5e62040d3b09d4f2091d87f99122751f592e75591dec44616a9`
  - Drive file ID: `1MrSnDcz5ByGWqqyxwBxmJEIF1kZbDLRR`
  - Size: 92,670 bytes
- Plugin: `Constellation-Commander-Plugin-v0.4.0.zip`
  - SHA-256: `1b59d08540d369739db7fee1b848ea7e8f4ff0c7c46801607a843de50cd37e4f`
  - Drive file ID: `1DVWPt-T4j5njyD9GGpHJYHGhHCFDBTwk`
  - Size: 3,373 bytes
- Combined checksum file Drive ID: `1xRheXDnwz7pVgjJ4JOBhfTH_crB2wb4m`
- Verification receipt Drive ID: `1lLnNR0iOWfNR57GsS-arbRjgWLvTtKHh`
- Canonical final Drive folder ID: `1VfZA21MpUyz6xT7h4fmDz1gmGhPilIPr`

All final Drive raw files were fully re-materialized; the three ZIP SHA-256 values matched local verified bytes exactly, and the checksum + verification files were byte-identical.

## Full computer-use surface

v0.4 contains 22 dedicated `computer_*` tools plus the existing file/search/process/open-path tools.

Visual/GUI capabilities:
- `computer_observe`: displays + cursor + visible windows + fresh screenshot
- desktop/monitor/window/region screenshots
- move/click/double-click/drag/vertical+horizontal scroll
- keypress/hotkey/Unicode text typing/wait
- grouped action batches with screenshot-after
- window list/focus/restore/minimize/maximize/close
- clipboard read/write
- Windows UI Automation search and semantic click-by-element
- per-monitor DPI awareness for coordinate/screenshot alignment
- screenshot output as real MCP image content
- screenshot output as a real image file attachment in normal-chat browser transport
- Emergency Lock that blocks GUI automation

Normal path remains:
`ordinary chatgpt.com -> bundled MV3 companion -> 127.0.0.1:47721 -> local Commander executor -> Windows desktop/files/processes`

No ChatGPT Work handoff, OpenAI API key, or Commander-side quota is required for this normal path.

## Final verification evidence

Run `35763651353` reconstructed the exact source SHA `74db9559aca1f5e62040d3b09d4f2091d87f99122751f592e75591dec44616a9` and passed:
- complete Node/check suite
- local MCP file/process/PDF smoke
- relay/device routing and actual device-agent ping/write/read
- browser bridge/background
- real Chromium content script -> bridge -> disk E2E
- Windows native full computer-use smoke
- clipboard empty/non-empty round trip
- screenshot capture and MCP `image` content
- Windows UI Automation
- self-contained .NET 8 x64 build
- actual `INSTALL-COMPANION.cmd`
- installed EXE remained running
- installed native helper + browser companion present
- installed health: version `0.4.0`, `computerUseSupported=true`, `guiAutomationEnabled=true`, `emergencyLock=false`, `quotaEnforced=false`

Post-CI independently verified:
- outer Actions ZIP digest matched GitHub metadata
- inner Windows ZIP matched its embedded SHA-256
- executable is PE32+ x86-64 GUI
- required computer-use/browser/runtime files are present
- final Drive bytes match local release bytes

## Exact next action

Install the final Windows ZIP and complete Chrome/Edge's one-time **Load unpacked** trust step if the deterministic companion is not already loaded. Then, in a normal ChatGPT chat, ask to **test full computer use now**. The acceptance sequence should start with `computer_observe`, inspect the returned screenshot, then perform a harmless visible action through `computer_actions` and verify with a fresh screenshot.
