# Constellation Commander v0.7.0 — Final Windows Release Checkpoint

## Acceptance

Final Windows acceptance is complete.

- Workflow run: 35825013797
- Job: 107064743792
- Result: SUCCESS
- GitHub Actions artifact: 10734103762
- Actions artifact SHA-256: 1015dd83800eb9b440eae65cb0c65263fe726776492d08309eabc4d9988a90dd
- Canonical source ZIP SHA-256: 43266bac1a43732bb41a52c819cd9f2d10e3ab60d0cd70dcb61d34989eed0dd0
- Canonical 57-file tree manifest SHA-256: 89ccb6612f1ad47d65c6ee1523c7b0668b1a75d14b84c88e434addd56753413c

All final Windows gates passed:
- exact canonical source archive verification
- Electron/runtime dependency verification
- full regression suite
- Windows-native computer-use suite
- visible Commander shell runtime
- direct local-tool runner
- integrated ChatGPT -> Commander tool loop
- ASAR-backed NSIS and portable packaging
- packaged layout/hash validation
- silent NSIS installation
- installed visible-shell + ChatGPT IPC round trip
- artifact upload

## Product changes from v0.6

v0.7 replaces the hidden-interceptor-first experience with a visible, collapsible Commander control plane around ChatGPT. It includes explicit local-tool modes, permission controls, Emergency Lock, live state/activity, desktop observe/window controls, recovery/diagnostics, and a direct manual local-tool console that uses the same production permission-enforced runtime as ChatGPT.

The old WinForms companion lane is removed from the canonical v0.7 source.

## Final binaries

- Installer: Constellation-Commander-0.7.0-x64.exe
  - SHA-256: 0bca6818bc240c6c2c1c61b9eb1b89162ae1526056fdb872c4df304aa4a2aa34
- Portable ZIP: Constellation-Commander-0.7.0-x64.zip
  - SHA-256: 358a8bc09350bc50b26a20420de8b325d264defaab849ddd011d3a637a005a13

## Drive durability

Final Drive folder ID: 1WiczS9ShbFLZ1vBH28RDKpUpAnB79pQR

The final Windows bundle is stored as five <=64 MiB parts plus a recombination manifest because the large-file path is unreliable. All five parts were remotely read back from Drive and streamed in numeric order. The recombined SHA-256 is:

7274bad4c5765277436b08aefe2c72412302b97339a915e4f6a21f24003c75c6

The source ZIP and tree manifest were also remotely read back and match their canonical hashes exactly.

## Cleanup

CI-only proof PRs #41 and #42 are closed. The dedicated proof branch is not a product merge path.
