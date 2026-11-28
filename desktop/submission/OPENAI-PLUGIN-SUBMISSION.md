# Constellation Commander v0.7.2 — OpenAI plugin submission packet

## Product shape

- Public normal-chat plugin backed by a stable public HTTPS MCP relay.
- Optional bundled skill guides tool selection and continuity.
- Separate Windows companion pairs a user-controlled PC to the relay with outbound HTTPS only.
- The product does **not** depend on ChatGPT Work, a ChatGPT custom-app quick tunnel, the Responses API, or an OpenAI API key.

## MCP registration

Use the OpenAI submission portal's **With MCP** path for the public plugin. Do not add `mcp.json`/`.mcp.json` to this plugin package: imported plugins that declare MCP servers that way are Desktop-only, even for remote HTTPS servers. The public/normal-chat submission must register the production MCP service directly.

Register the production MCP endpoint as:

`https://<stable-production-hostname>/mcp`

Authentication: OAuth 2.1 authorization-code flow with PKCE S256.

The server exposes:

- `/.well-known/oauth-protected-resource`
- `/.well-known/oauth-authorization-server`
- `/oauth/register`
- `/oauth/authorize`
- `/oauth/token`

The relay recognizes ChatGPT's CIMD client ID `https://chatgpt.com/oauth/client.json` and stable issuer-aware redirect URI while also supporting dynamic client registration for compatible MCP clients.

## Review account / pairing

For review, provide OpenAI reviewers a temporary relay owner password and pair a dedicated non-sensitive review device. Do not provide the developer's personal workstation as the review target.

## Positive review cases

1. “List my paired computers and tell me which ones are online.”
2. “Create `commander-review.txt` in the review workspace with the text `hello from ChatGPT`, then read it back.”
3. “List the review workspace and show file metadata for the file you just created.”
4. “Start a harmless terminal command that prints the Node version and return its output.”
5. “Show recent Constellation Commander tool calls and confirm whether Commander itself enforces a quota.”

## Negative / safety review cases

1. With a path outside the configured allowed root, `read_file` must fail rather than bypass the workspace policy.
2. With the device offline, a device tool must report the device as offline rather than claiming success.
3. A request to permanently bypass local command policy must not silently weaken the local configured restrictions.

## Listing copy

**Name:** Constellation Commander

**Short description:** Work with your authorized computer from normal ChatGPT chats.

**Long description:** Connect ChatGPT to a computer you control through a self-hosted OAuth-protected relay and an outbound-only desktop companion. Read and edit files, search, run and interact with terminal processes, inspect processes, open local paths, and resume recent Commander execution history across chats. No OpenAI API-key transport is required, and Constellation Commander imposes no tool-call quota of its own.

## Required production URLs

Before submission, verify these public URLs are stable and accessible:

- Product/support: Project Constellation repository or dedicated site
- Privacy policy: `docs/CONSTELLATION-COMMANDER-PRIVACY.md`
- Terms: `docs/CONSTELLATION-COMMANDER-TERMS.md`
- MCP endpoint: stable production relay `/mcp`

A temporary tunnel is not the production endpoint.
