# Computer Link

Local-first tools that let an ordinary chat or compatible assistant inspect and operate a user-authorized computer without requiring a separate autonomous coding-agent loop.

## Status

Early implementation and research. No desktop installation or live dot integration is verified. This project does not bypass model usage limits, security controls, approvals, or provider restrictions; a client must expose a supported tool connection.

## Independent architecture

- Provider-neutral local core and deterministic capability registry.
- Read-only diagnostics, workspace files, command execution, browser automation and desktop UI Automation are separate adapters. Removing any adapter must leave the others usable.
- Optional MCP transport, explicit local pairing, revocation and visible activity records. No network listener, credential access or persistent grant is enabled by repository creation.
- Ordinary chat, dot and third-party client acceptance are separate test gates. No assumption that one client supports another client's connector.

## Existing projects checked

Accessible repository inventory, ProjectDump contents and chat-history searches found related pieces in Project Constellation (chat organization), Hover (app-specific native control), and Agent-Foundry (shared governance), but no verified standalone general computer bridge. Local unpublished work is not ruled out. These projects remain separate and reusable through adapters.

## Comparison shortlist

- [Desktop Commander](https://github.com/wonderwhy-er/DesktopCommanderMCP): MIT terminal/file MCP reference; first foundation candidate to evaluate.
- [Windows MCP](https://github.com/sbroenne/mcp-windows): MIT UI Automation/CLI candidate, Windows-specific acceptance required.
- [ChatGPT Computer MCP](https://github.com/qDeizer/chatGPT-Computer-MCP): scoped local Windows bridge; inspect upstream, license and transport before reuse.
- [PC Bridge](https://github.com/Martin123132/PC-Bridge): similar chat/workspace product; license restrictions require review.
- [ChatCmd](https://github.com/int04/ChatCmd): local-first bridge; unofficial DOM integration is not equivalent to supported provider APIs.

None is declared fastest or best without measured comparison. Full dated source/license inventory, reproducible evaluation and implementation roadmap belong in the repository docs.

## Acceptance

Test clean install/uninstall, read-only mode, permissions, cancellation, stale targets, reboot/reconnect, non-ASCII paths, no secret logging, and bounded CPU/memory. Verify command effects and files by readback, not a tool success response alone. Use temporary fixtures before private user files.

## MeshCentral candidate review

[MeshCentral / MeshCtrl evaluation](https://github.com/Herbertofury/Computer-Link/blob/main/docs/research.md#meshcentral--meshctrl-evaluation-2026-11-14) now records Apache-2.0 licensing, the 1.3.1 research pin, server/endpoint requirements, command-output semantics and an explicit Windows acceptance matrix. Upstream's release notice warns of active attacks, so deployment requires a fresh security review. This is an optional remote-management candidate, not a replacement for the local core or a verified dot integration. No server, credentials, persistent grants or endpoint installation were created. Native testing remains pending.
