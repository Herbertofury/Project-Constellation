# Constellation Commander v0.3.0 — Final Checkpoint

Status: **verified release candidate / normal-chat transport complete**

## Canonical release identity

- Branch: `feature/constellation-commander-v0.3.0`
- Final CI commit: `071cc6e174c6e6e7062f71a6d9bcd487bf01e2a2`
- Final Windows Actions run: `35756966921`
- Actions artifact ID: `10708183115`
- GitHub outer artifact digest: `91afb66fa7309aeb2345d78bf3999b233a0eabc21629f8422a35737497fefd82`
- Deterministic browser companion ID: `khfbmdpkpnaghpfnacidbjfaaikfmanh`

## Final artifacts

- Windows: `Constellation-Commander-Windows-x64-v0.3.0.zip`
  - SHA-256: `9752551c833aed251156edec21c7ee27a5b8b001a4f530c5c4713b7c7cf51809`
  - Drive file ID: `1s6dpIwThicjV0BK68bK1dHFy7L3HPB1K`
- Source: `Constellation-Commander-v0.3.0-source.zip`
  - SHA-256: `9fe8264cd6a09b41bd11cba4c99f0806fa1aa2245b05f1f99acef70bd2fe53cb`
  - Drive file ID: `1p1gNITgDqgL37FrtIaFdz9U3634G_bbh`
- Portable plugin: `Constellation-Commander-Plugin-v0.3.0.zip`
  - SHA-256: `f0aa995fa1b1cefc059a72b3fa71225d6a56032413b51299a96db5aba6e89bca`
  - Drive file ID: `1DFXuVF3-YAt8hDetu3XeTZqDRrM5XH0i`
- Combined checksums Drive ID: `1Ah72duQnI5l7f36Ll6UJKcSPs5qNpk2M`
- Verification receipt Drive ID: `1xsjyztV52_UN1bq6YdaYb7ugHvAp5Got`
- Canonical Drive folder ID: `15Mqc4Yo9lKS8T_4FAWRjpUMcD6UlQssy`

## Default architecture

Normal Chat mode no longer depends on OpenAI directory publication or a hosted relay:

`ordinary chatgpt.com chat -> bundled MV3 browser companion -> 127.0.0.1:47721 bridge -> local Commander executor`

The browser companion injects a short-lived trusted per-chat nonce/tool manifest, executes exactly one local call at a time through the loopback bridge, returns the local result as a hidden turn, and scrubs the protocol plumbing from the visible UI.

Hosted OAuth/MCP transport remains optional in the desktop app's Advanced section for future/native directory parity.

## One-time setup boundary

On an unmanaged Windows Chrome/Edge installation, the browser intentionally requires one user trust action for an off-store extension. The release installer:
1. installs Commander per-user;
2. starts the normal-chat bridge;
3. enables Start with Windows;
4. locates Chrome or Edge from standard Windows locations;
5. opens its extension manager;
6. opens the exact bundled `browser-companion` folder and copies its path.

The user performs **Developer mode -> Load unpacked -> select the opened folder** once. This browser trust action is not bypassed.

After that, Commander reconnects across normal chats and Windows restarts with no Work handoff or OpenAI API-key transport.

## Verification evidence

Final source fresh-extraction suite: PASS.

Final Windows run `35756966921`: PASS:
- exact source reconstructed and SHA-verified;
- full protocol/browser/device suite passed on Windows;
- self-contained .NET 8 x64 companion built;
- bundled official Node v22.20.0 verified;
- actual `INSTALL-COMPANION.cmd` path executed;
- installed Commander remained running;
- installed browser companion remained present;
- installed bridge returned product `Constellation Commander`;
- version `0.3.0`;
- mode `normal-chat-loopback`;
- `quotaEnforced=false`.

Independent post-CI:
- outer Actions artifact digest matched GitHub metadata;
- inner Windows ZIP matched embedded checksum;
- executable is PE32+ x86-64 GUI;
- manifest public key derives extension ID `khfbmdpkpnaghpfnacidbjfaaikfmanh`;
- final Drive Windows ZIP redownload is byte-for-byte identical to the verified local release.

## Exact next action

Install the final Windows ZIP, complete Chrome/Edge's single **Load unpacked** trust step, then open an ordinary ChatGPT chat and request a local action such as creating/opening a text file. The browser companion should arm that chat automatically; no Work mode or API key is part of this path.
