# Constellation Commander v0.5.0 — Final Control-Handoff Checkpoint

Status: **verified Windows release / browser-handoff repair complete**

## Why v0.4 failed on the user's real chat

The Windows computer-use engine itself was not the failing layer. The real user message arrived without trusted Project Constellation local context, which proved the browser companion did not successfully arm the ChatGPT request. v0.4 could write hidden context into the visible ProseMirror composer DOM, but that did not guarantee ChatGPT's internal editor/network request included it.

## v0.5 fix

- Adds `browser-companion/page-hook.js` in the page MAIN world at `document_start`.
- Injects/validates trusted Commander context in the actual outgoing ChatGPT request payload.
- Keeps composer-DOM insertion only as a fallback.
- Adds strict bridge/browser version matching so stale browser code cannot silently look healthy.
- On extension install/update, automatically reloads already-open ChatGPT tabs so the new MAIN-world hook becomes active immediately after the user reloads the unpacked extension.
- Adds a bundled `constellation-commander-control-test.mjs` to independently prove Windows mouse/keyboard/clipboard/screenshot control.
- Leaves the already-proven v0.4 native Windows input helper intact.

## Exact release lineage

- Branch: `feature/constellation-commander-v0.5.0`
- Final workflow head: `7d3724fc8bc6f0a07ea242a3380065dd53622c8d`
- Windows Actions run: `35769725463`
- Actions artifact ID: `10714085817`
- Actions outer artifact SHA-256: `c9da15a72351a83fe1a5855cf6cc53f2b4d064f385667c9ca38e353bdc537773`

## Final artifacts

- Windows: `Constellation-Commander-Windows-x64-v0.5.0.zip`
  - SHA-256: `15ad42ec5200fe2c8cb0048ef3abe5e7d6d096265ddd3be94a08c255beb26ea2`
  - Size: 101,586,931 bytes
  - Drive file ID: `18lWzp7Rq13V41_6BmwRcaWBfTASiG8Bp`
- Source: `Constellation-Commander-v0.5.0-source.zip`
  - SHA-256: `c28d6899e2f112bcb072d566e510d87783a9a23f8d16734fcf57e86ea03278d4`
  - Size: 103,213 bytes
  - Drive file ID: `11byq7WbU02j1qJ29_tpIZ6Ld3gpfPUPB`
- Portable plugin: `Constellation-Commander-Plugin-v0.5.0.zip`
  - SHA-256: `03242939e4c8b49f64ae2c0a2d0bbe4605dd03db963e6816a96699ca7b2b0ed8`
  - Size: 3,249 bytes
  - Drive file ID: `1Q2lsFypFVaJ-P93I1DqSYpYBeWXy1Go9`
- Verification receipt:
  - SHA-256: `bbc4a6172a2755fa8a9bcf09994f9d216f5a81b08ce5ddfe710b1fd3d6b9e516`
  - Drive file ID: `1zZwObfRpa21zazos0WWv_dcHv3z_RMDS`
- Canonical Drive folder ID: `1-x-bzjfqgfVssmzK0R9jc3v0jF7pKht3`

All three final Drive ZIPs were fully re-materialized after upload and independently hashed; every SHA-256 matched the tested local release bytes exactly.

## Final Windows proof

Run `35769725463` passed:
- exact source reconstruction and SHA verification
- MAIN-world ChatGPT request-hook smoke
- browser background -> real loopback bridge
- real Chromium content-script -> real bridge -> disk E2E
- Windows full computer-use native smoke
- self-contained .NET 8 x64 build
- fresh-bundle Full Control Test
- actual `INSTALL-COMPANION.cmd`
- installed bridge health
- installed Full Control Test
- artifact upload

Observed final values:
- `bridge_version=0.5.0`
- `computer_use=True`
- `gui_automation=True`
- `native_control_test=True`
- `bundled_node=v22.20.0`
- `artifact_sha256=15ad42ec5200fe2c8cb0048ef3abe5e7d6d096265ddd3be94a08c255beb26ea2`

Independent post-CI:
- downloaded Actions outer artifact SHA matched GitHub metadata
- inner Windows ZIP matched its embedded checksum
- EXE is PE32+ x86-64 Windows GUI
- release contains `page-hook.js`, native helper, Full Control Test, browser companion, bridge, and one-click installer
- MV3 manifest is version 0.5.0 and loads `page-hook.js` in MAIN world
- background script contains ChatGPT-tab auto-refresh behavior after extension update/install

## Live user-PC boundary

This conversation still contains no trusted Constellation local context, so no claim is made that this chat already controlled the user's physical PC. The external Desktop Commander connector also reports zero connected devices.

Exact next action:
1. install/update the final v0.5 Windows bundle;
2. on `chrome://extensions`, click **Reload** once on Constellation Commander (or **Load unpacked** once if not installed);
3. v0.5 automatically refreshes open ChatGPT tabs;
4. in the refreshed normal chat, ask **take control of my computer in full**;
5. the acceptance sequence should receive trusted local context, call `computer_observe`, receive the actual desktop screenshot, perform a harmless visible action, and verify with a fresh screenshot.
