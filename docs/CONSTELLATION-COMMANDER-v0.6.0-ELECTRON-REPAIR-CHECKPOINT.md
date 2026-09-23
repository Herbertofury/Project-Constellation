# Constellation Commander v0.6.0 — Electron Repair Completion Checkpoint

Date: 2026-09-22/23
Repository: Herbertofury/Project-Constellation

## Final verified state

- Windows acceptance workflow run: 35816599639
- Windows job: 107039342063
- Result: SUCCESS
- GitHub Actions artifact ID: 10731957935
- Actions artifact SHA-256: 041fc060b1b29204411ef1d6eb1405c00487a9c7554d7693a8000a1c3049dd4d
- Original trusted v0.6.0 source SHA-256: 78a83fa73ad1498db5338552f8f3c13c4485972c4629227dc67aa5d113a0040b
- Consolidated repair patch path: releases/constellation-commander/v0.6.0/electron-v060-final-consolidated.patch
- Consolidated repair patch Git blob: 1ffffd7d42c236df7762bdfbf73581ff9dee475f
- Canonical repaired source ZIP SHA-256: d624e0618aff64baf0193973f06d9616a58d14d74cc41fddc98f2a8baa841c42

## Root causes repaired

1. Electron preload observed document.documentElement before it existed.
2. Electron fallback bridge called nonexistent listen/close methods instead of start/stop.
3. Fixture startup depended on fragile renderer timing/click behavior; acceptance now uses deterministic Electron/native input and stage tracing.
4. Assistant tool-call nodes without an explicit call id were rescanned repeatedly; a new UUID was generated on every scan, creating an 8,959-call feedback storm. Tool-call identity is now persisted on the DOM node and claimed before asynchronous IPC execution.
5. The installed-app CI gate incorrectly checked LASTEXITCODE after starting the GUI NSIS installer. It now waits on the installer process and checks its real ExitCode.

## Windows acceptance evidence

The final run passed every gate:

- exact repaired-source reconstruction and source hash verification
- Electron 44.4.3 dependency/runtime verification
- full regression suite
- real Windows native computer-use smoke
- integrated Electron ChatGPT -> Commander -> tool-result round trip
- NSIS installer build
- portable ZIP build
- packaged artifact/checksum validation
- silent NSIS installation
- installed Constellation Commander.exe launch
- installed integrated Electron ChatGPT -> direct Commander IPC tool loop
- GitHub Actions artifact upload

## Final binaries

- Installer: Constellation-Commander-0.6.0-x64.exe
  - SHA-256: dd48931a70c68a600f1e54099f69d02b149b84e6239cf6ce7b384fdc12d3e30d
- Portable: Constellation-Commander-0.6.0-x64.zip
  - SHA-256: a1800585d70ef9c79972693ed1277edd94b126112d2fc53e7fbf27ff08fed25

## Google Drive durability

Checkpoint folder ID: 1mqZqw4k9bjJxevE_xPw2_65liYGpNBYM

Drive contains:
- canonical repaired source ZIP
- SHA256SUMS
- Windows artifact split into five <=64 MiB parts
- recombination/SHA-256 manifest

Remote read-back verification:
- every Drive split part was re-downloaded and SHA-256 verified
- recombined Drive parts SHA-256: 041fc060b1b29204411ef1d6eb1405c00487a9c7554d7693a8000a1c3049dd4d
- recombined value exactly matches the GitHub Actions artifact digest
- repaired source was re-downloaded and is byte-identical to the local canonical source
