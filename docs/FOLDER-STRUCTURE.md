# Folder structure

```text
Project Constellation/
├─ extension/              Manifest V3 installable source
│  └─ src/                 Shared/content runtime modules
├─ tests/
│  └─ smoke/               Browser and service-worker workflows
├─ tools/                  Build, validate, package, test orchestration
├─ benchmarks/             Large-chat fixtures and performance inputs
├─ docs/                   Canonical manuals mirrored to the wiki
├─ config/oauth/           Non-secret provisioning templates
├─ assets/screenshots/     Versioned documentation evidence
├─ build/                  Generated unpacked build (not committed)
├─ releases/               Immutable artifacts, receipts, checksums, evidence
├─ logs/                   Generated local verification output (not committed)
├─ recovery/
│  ├─ imports/             Preserved local historical unpacked builds
│  └─ projectdump-migration/  Relevant ProjectDump state snapshot
├─ brain/                  Durable continuation/agent state
└─ .github/workflows/      CI and gated release automation
```

## Placement rules

- Runtime code/assets used by Chrome belong only in `extension/`.
- Tests never live in the release package.
- Generated build output is disposable; release evidence is immutable.
- OAuth examples contain client IDs/placeholders only—never client secrets or tokens.
- Imported state is read-only evidence, not an alternative current source.
- ProjectDump-wide unrelated files never enter this repository.

The standalone repository preserves the filtered ProjectDump ancestry plus a no-loss snapshot under `recovery/projectdump-migration/`. The current tree is intentionally organized rather than reproducing ProjectDump’s historical layout at repository root.
