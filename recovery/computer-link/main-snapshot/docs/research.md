# Computer tools research, 2026-11-14

## Discovery and reuse decision

Accessible Herbertofury repository inventory and current READMEs identify Project Constellation as browser chat organization/recovery, Hover as native previews with app-specific control, Noxviola as a project index, Agent-Foundry as governance. ProjectDump contents and conversation searches for bridge/MCP/regular chats did not establish an existing standalone general computer connector. This is bounded negative evidence, not proof that unpublished local work does not exist. Preserve all these projects. Computer Link is the new standalone destination, not a forced dependency for them.

## Candidates from official repositories

| Candidate | Evidence and role | License/reuse | Evaluation needed |
|---|---|---|---|
| [Desktop Commander](https://github.com/wonderwhy-er/DesktopCommanderMCP) | File/search/edit and terminal MCP, ordinary chat computer access product | MIT per upstream repository; first existing foundation to evaluate | Pin version; inspect command/file boundaries, cancellation and result readback; compare local operation cost |
| [Windows MCP](https://github.com/sbroenne/mcp-windows) | Windows UI Automation semantic actions plus CLI | MIT per upstream | Actual Windows app targets, stale-element behavior, focus/DPI/multiple windows; not proven by Linux tests |
| [Chat on Steroids](https://github.com/totec448-spec/chat-on-steroids) | Upstream of qDeizer/chatGPT-Computer-MCP; Windows scoped chat bridge | [MIT](https://github.com/totec448-spec/chat-on-steroids/blob/main/LICENSE) | Prefer upstream evaluation over obscure forks; verify transport, scope, consent and installer before reuse |
| [ChatCmd](https://github.com/int04/ChatCmd) | Local-first chat bridge; repository describes unofficial DOM bridge | [MIT](https://github.com/int04/ChatCmd/blob/main/LICENSE) | Browser UI changes, explicit sending semantics, provider terms and connection support. DOM automation does not establish supported dot access |
| [PC Bridge](https://github.com/Martin123132/PC-Bridge) | Similar ordinary chat to Windows workspace product | [PolyForm Noncommercial or Small Business](https://github.com/Martin123132/PC-Bridge/blob/main/LICENSE), source-available, not OSI open source | Reference only pending use-specific license review; do not blindly copy into MIT project |
| [pywinauto](https://github.com/pywinauto/pywinauto) | Mature Windows text/property GUI automation foundation | Verify exact pinned package license before vendoring | Compare against .NET UIA on real apps; do not build a duplicate UIA engine without evidence |
| [Microsoft Hybrid Computer Use](https://microsoft.github.io/Hybrid-Computer-Use/assets/Hybrid-Computer-Use.pdf) | Research combining programmatic, semantic and visual interfaces | Paper, not a redistribution grant for arbitrary implementation | Good comparison design: choose strongest supported interface per task; no performance claim from paper alone |

Other leads: [Windows GUI MCP](https://github.com/dcl632/windows-gui-mcp), [Windows Commander MCP](https://github.com/exalsch/windows-commander-mcp), [Easy Local MCP](https://github.com/Ryanma-YX/easy-local-mcp). Discovery only; licenses, security, maintenance and real target behavior not yet qualified. No upstream executable was run and no upstream source was copied in this checkpoint.

## Recommendation, not a proven winner

Evaluate Desktop Commander for file/terminal reuse and Windows MCP for semantic desktop actions first; keep ordinary chat transport and desktop mechanics separate. Build only the orchestration, explicit capability control and evidence that existing candidates do not supply well enough. A bridge cannot force an unsupported client to gain tools or waive its billing. Dot acceptance requires the actual dot tool surface, not just a working local MCP client.

## Comparative evidence protocol

For each pinned candidate: record commit/version/license, install size, cold startup, idle CPU/RSS, round-trip latency (p50/p95), cancellation, reconnect and complete results on identical temporary workspaces. Include non-ASCII names, permission failures, large output, stale targets, repeated calls and disconnected clients. Save raw results, failures and exact harness identity. Benchmark actual workflows, not only synthetic dispatch. Do not call a tool best/fastest until target comparisons prove it without reduced capabilities.

## MeshCentral / MeshCtrl evaluation (2026-11-14)

**Decision: isolated remote-management candidate, not a replacement for the local core or a proven winner.** MeshCentral adds a server and enrolled endpoint software; MeshCtrl is its Node.js management client, not a standalone local computer-control service. Its endpoint “agent” is remote-management software, not an AI agent. Neither establishes supported dot connectivity or changes any client's usage charges. [Official MeshCtrl guide](https://docs.meshcentral.com/meshctrl/).

### Pinned evidence and security gate

The release index displayed **1.3.1** as latest at review. Git tag resolves to `f436143527458d56da0336ea3047c006703fb4e4`. This is a research pin, not an installed or certified version. The [release warning](https://github.com/Ylianst/MeshCentral/releases/tag/1.3.1) reports active attacks against servers and clients and urges an upgrade. It also records command-reply routing and file-access permission fixes. Recheck advisories and subsequent fixes before any deployment; this note does not establish that 1.3.1 eliminates every vulnerability.

The pinned [package metadata](https://github.com/Ylianst/MeshCentral/blob/1.3.1/package.json) declares Node >=20 and Apache-2.0; the pinned [LICENSE](https://github.com/Ylianst/MeshCentral/blob/1.3.1/LICENSE) confirms Apache-2.0. Node's minimum version is not a recommendation to deploy an unsupported runtime. Record supported runtime, server, MeshCtrl, endpoint binary version/hash/signature and dependency licenses separately before reuse. Preserve upstream notices when distributing applicable code. No upstream code was copied or run in this review.

[Discussion #6260](https://github.com/Ylianst/MeshCentral/discussions/6260) documents `RunCommand --reply` and Windows PowerShell/user-context options. The [1.3.1 client source](https://github.com/Ylianst/MeshCentral/blob/1.3.1/meshctrl.js) independently shows per-process response correlation and config/environment login inputs. These support a testable candidate, not proof of complete stdout/stderr, exit-code semantics or cancellation. An accepted command is not completed execution.

### Comparison and architecture

| Candidate | Distinct contribution | Cost and unresolved evidence |
|---|---|---|
| Computer Link current core | Independent deterministic local diagnostics; no listening server | No desktop, remote transport or supported chat connection yet |
| Desktop Commander / Windows MCP | File/terminal or semantic desktop candidate | Actual client compatibility and Windows target acceptance remain unproven here |
| MeshCentral + MeshCtrl | Existing remote-management plane with CLI operations | Server operation, authentication, enrollment, patching, audit and endpoint lifecycle; no target benchmark performed |

If selected, implement an optional remote adapter behind narrow capability contracts. Its absence must not break diagnostics, local file/desktop adapters or other clients. Do not expose the entire administrative CLI through a generic chat passthrough. Keep authentication and device enrollment separate from ordinary operation. Use least-privilege device-scoped rights, explicit consent, TLS validation, revocation and private audit storage. Review [secure installation](https://docs.meshcentral.com/install/security/secure/) and [security architecture](https://docs.meshcentral.com/meshcentral/security/). Server login keys and configuration credentials are secrets; do not put them in command histories, repository fixtures or logs. Credential-source support alone is not secure storage.

### Windows acceptance plan, not completed tests

1. In an explicitly authorized isolated Windows test environment, pin server/client/endpoint identities, supported Node runtime and network topology. Confirm endpoint identity and uninstall/revocation behavior. No enrollment or persistent grant is authorized by this research note.
2. Run harmless marked-output commands under standard-user context. Compare returned output and exit status with native execution, including stderr, nonzero exit, Unicode, multiline and large output. Record truncation/completion semantics instead of assuming them.
3. Run two simultaneous requests under the same account and different sessions; verify correlation and no cross-session output. Exercise offline endpoints, reconnect, timeout and cancellation. Determine whether cancellation kills the remote process or only disconnects the client; never blindly retry a possibly completed write.
4. Verify denied device, denied terminal/file access, expired/revoked session, user refusal and TLS errors fail without widening permissions. Test logged-in versus no-user contexts and privilege boundaries; do not silently fall back to elevated execution.
5. Independently test desktop capture/control, UAC/secure desktop boundaries, DPI/multiple monitors, consent and actual GUI outcome if those capabilities are proposed. A shell test cannot qualify GUI control.
6. Measure startup, idle server/endpoint CPU and RAM, disk footprint and end-to-end p50/p95 latency against local candidates on equivalent work. Retain sanitized raw evidence and all failures. No performance or reliability superiority is claimed.

**Current state:** source/document review only; no server, credentials, endpoint installation, network exposure, remote command or Windows acceptance test performed. Next gate is an approved isolated deployment with exact version/security review, then the comparison above.

## MCP compatibility foundation refresh (2026-11-14)

**Status: research candidate, not an implemented integration or performance winner.** The prior review covered desktop/remote-management products; this pass covers the protocol boundary they do not solve for our current JSON-lines CLI.

### Current primary-source evidence

The official Python SDK release page currently marks [v2.3.0](https://github.com/modelcontextprotocol/python-sdk/releases/tag/v2.3.0) latest. Relevant release changes include Windows executable resolution moved off the event loop, corrected empty-metadata handling for older protocol connections, and registration-time rejection of invalid header annotations. These are upstream claims, not Computer Link benchmark results. The version also changes HTTP dependency requirements; evaluate a locked dependency graph rather than installing floating latest.

The pinned [package metadata](https://github.com/modelcontextprotocol/python-sdk/blob/v2.3.0/pyproject.toml) requires Python >=3.10, compatible with our Python 3.11+ floor. Its [MIT license](https://github.com/modelcontextprotocol/python-sdk/blob/v2.3.0/LICENSE) requires retention of the copyright and permission notice when redistributing applicable source. Check transitive licenses independently. The [versioned README](https://github.com/modelcontextprotocol/python-sdk/blob/v2.3.0/README.md) documents the v2 MCPServer API and links migration guidance; do not mix v1 FastMCP examples into a v2 implementation without checking compatibility.

The [2026-07-28 transport specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports) distinguishes JSON-RPC semantics from newline framing. It uses per-request protocol/capability metadata and describes compatibility with earlier initialization-based sessions. Therefore “it reads JSON lines” is not MCP acceptance, and testing only an old initialize handshake would also be insufficient.

### Reproduced local baseline

Against source/tests identical to main `5c215f9f236a25c8c5afb062c8db20cd75ffbf24`, the existing 23 Python unit tests passed on Linux. An actual CLI sequence containing a JSON-RPC initialize request followed by native capabilities.list produced:

```json
{"error": "invalid request"}
{"id": 2, "result": [{"name": "system.summary", "effect": "read"}]}
```

This confirms the documented boundary and continued native operation, not a regression: JSON-RPC's jsonrpc member is deliberately outside the CLI contract.

### Bounded next evaluation

Compare an **optional** pinned SDK stdio adapter with the unchanged CLI, exposing only existing read-only diagnostics. Reuse protocol machinery rather than relaxing the native parser into a partial MCP implementation. No HTTP listener, OAuth, device enrollment, shell capability or persistent grant is part of this candidate.

Acceptance must cover current and legacy client modes, discovery/schema fidelity, complete results, protocol errors versus tool failures, Unicode and malformed input, cancellation/EOF, repeated calls and absent optional dependencies. Verify the actual target client independently. Retain existing request-budget and diagnostic-independence protections; do not assume SDK defaults reproduce them.

Measure cold startup, first successful diagnostic, repeated-call p50/p95 latency, peak RSS and installed dependency size on equivalent workloads. A dependency increase must be explicit, not hidden behind warm-cache timings. Keep the standard-library core usable without the SDK. Native Windows, SDK execution, interoperability, performance and dot integration remain **untested** in this pass.
