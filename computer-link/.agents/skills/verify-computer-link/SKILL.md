---
name: verify-computer-link
description: Verify Computer Link local capabilities, adapter independence and actual client integration without confusing mocked diagnostics with remote desktop acceptance.
---

Run `python -m unittest discover -s tests -v`. Exercise the actual JSON-line process with capabilities.list and system.summary; verify unknown methods fail. For optional workspace.disk, use a disposable temporary directory and confirm no path/content leakage. Remove an optional adapter and verify diagnostics remain functional. Read docs/architecture.md and report current stage precisely: the local protocol is not MCP and Linux tests are not Windows or dot acceptance. Preserve failures; never enable network listeners, credentials or persistent grants just to make a test pass. For new adapters, add cancellation, repeated-call, reconnect, permission, stale-state and effect-readback cases before integration. Compare existing upstreams from docs/research.md before replacing them.
