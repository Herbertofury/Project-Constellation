# Independent architecture and delivery gates

The local process is a tool executor, not an additional AI agent. Clients provide reasoning. The provider-neutral registry has no knowledge of ChatGPT, dot, model selection or billing.

1. Core registry: available/effect metadata, duplicate detection, explicit failure, read-only call mode. Implemented and fixture-tested.
2. Diagnostics adapter: OS/architecture/runtime and optional selected-volume capacity. Implemented; no hostnames, account names, full paths, environment or file content returned.
3. Transport: local JSON-lines implemented. MCP protocol integration remains pending; use an official SDK rather than claiming JSON-lines equals MCP. Remote authentication, pairing and consent design must precede any network listener.
4. Workspace adapter: candidate reuse, bounded read/write, backups/conflict readback, separate permission. Not implemented.
5. Process adapter: candidate reuse, argv contracts, output streaming, cancellation and job termination scope. Not implemented.
6. Desktop adapter: Windows UIA first, visual input explicit fallback. Not implemented.
7. Browser adapter: supported browser tools first, isolated from desktop. Not implemented.
8. Client adapters: ordinary chat, dot and generic MCP clients each get independent acceptance matrices. Not implemented.

Disable/remove any optional adapter without breaking diagnostics, CLI or other adapters. Unexpected adapter exceptions return a generic `capability failed` response with the request ID, without exposing exception text or terminating the JSON-lines session; later independent calls continue. Process shutdown signals are not swallowed. Responses are fully encoded before writing a line; unsupported objects, circular values and non-finite numbers produce a generic request-correlated error rather than crashing the session or emitting invalid JSON. No Constellation, Hover, Agent-Foundry, or game project should require this service for unrelated features. Shared governance is a pinned documentation snapshot, not a runtime dependency.

## Security boundaries

This foundation is not a hardened service or permission sandbox. Python code loaded into the process is trusted; the registry effect label is not protection against malicious adapters. No HTTP listener or persistent grants are created. Future external adapters require provenance/license review and OS-enforced boundaries appropriate to their privileges. Never expose shell, filesystem, clipboard, screen or UI control through unauthenticated public endpoints. Do not implement automatic approval clicking, credential harvesting, quota bypass, or hidden monitoring.

## Acceptance checklist

- [x] Independent registry/adapter removal tested.
- [x] Unsupported operations and malformed inputs fail without execution.
- [x] Local subprocess JSON-line recovery and disk capacity readback tested on Linux.
- [ ] Windows clean install/uninstall and native diagnostics verified.
- [ ] Comparative upstream benchmark and license pinning.
- [ ] Official MCP transport conformance; cancellation and output budgets.
- [ ] Authenticated pairing, revoke/disconnect, visible activity and per-capability configuration.
- [ ] File edit / process / UI workflows with backups and effect verification.
- [ ] Ordinary chat and dot end-to-end actual supported connection tested separately.
- [ ] No-loss compatibility, latency and memory evidence on real Windows workflows.

## Local request budget

The current no-payload diagnostics protocol accepts at most 65,536 Unicode characters per request line, including its newline if present. Oversized lines are drained using bounded reads and produce one `request too large` error without dispatching a truncated prefix. The next complete request remains usable, including after oversized input at EOF. This is a transport resource budget, not a catalog/content cap. Future bulk adapters require a separately designed streaming contract; the current transport is still not a hardened permission sandbox.

Duplicate JSON object members, including nested parameters, are rejected before dispatch. A repeated method, request ID or params field is ambiguous rather than a last-value-wins override. The rejection is uncorrelated `invalid JSON` because no unambiguous request identity exists; the following complete request remains usable.

The registry separates its own public validation failures from handler failures. Handler-raised `ValueError` and `PermissionError` are normalized before reaching the transport, so arbitrary adapter text is not mistaken for an approved request diagnostic. Known unsupported-method, parameter and read-only refusals remain useful; shutdown signals still propagate. Loaded adapters remain trusted code, not sandboxed.

The JSON-lines wire encoding is UTF-8, independently of the host locale. Invalid UTF-8 bytes are retained only long enough to reject their bounded line as `invalid JSON`; they are never dispatched or echoed. Later valid UTF-8 requests remain usable, even when the underlying reader buffered both lines together. The existing Unicode-character request budget and oversized-line draining remain unchanged. This is transport recovery, not Windows/client integration acceptance.

Registration validates a nonempty string name, callable handler and declared read/write effect before changing the registry. Invalid optional registrations leave existing discovery and diagnostics intact and do not reserve the rejected name; corrected adapters may register afterward. This catches accidental adapter contract failures, not malicious trusted Python code.
