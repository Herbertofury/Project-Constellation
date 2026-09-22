# Constellation Commander v0.1.0

Self-hosted MCP/local-computer agent for Project Constellation.

## Purpose

Constellation Commander provides a Desktop Commander-style local file/process/system tool surface without a vendor relay quota, credit meter, or per-call billing layer. It is designed for private use with ChatGPT custom MCP apps while preserving Project Constellation continuity.

## Verified artifact

- Artifact: `Constellation-Commander-v0.1.0.zip`
- Size: 27,007 bytes
- SHA-256: `6d7010d5b4025a9bf74e9b6c367028454440ae6f09d7b20240f8c85fb0a45612`
- Drive file ID: `16L_VNwnB7GkBZ0L9Diu7DNNahMBAlr7S`
- Drive folder ID: `160E_EDIbtvtBsQM5wJ4Y3zyOiupMZIY3`
- Drive verification: full re-materialization was byte-identical to the locally verified artifact.

## Current verification

The package was extracted to a clean directory and passed:
- Node syntax checks
- MCP initialize + tool discovery
- real write/read file round trip
- persistent process launch + output recovery
- PDF creation smoke
- 2025-06-18 initialize/session compatibility
- 2026-07-28 server/discover compatibility
- quota endpoint reports `quotaEnforced: false`

Windows installer/runtime and ChatGPT Scan Tools remain an external acceptance gate until the package is installed on the target Windows machine.

## GitHub lineage guard

Do not merge this branch into `main` yet.

At checkpoint time GitHub `main` was v0.16.1 at `0ab31e2133393dee9fd26c5fb9868f2c3f591a8b`, while the canonical Project Constellation Drive tree contained releases through v0.18.1. Reconcile the newer Drive source lineage first, then transplant/integrate Constellation Commander into the current source tree without regressing later Project Constellation work.

The complete v0.1.0 ZIP contains the implementation source and Windows installer scripts.
