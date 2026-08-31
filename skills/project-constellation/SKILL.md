---
name: project-constellation
description: Project Constellation companion and continuity workflow for ChatGPT. Use when the user asks to use/connect Project Constellation, inspect or operate their computer, work with local files/windows/processes, continue or manage a Constellation project/checkpoint/workspace, or says things like "use Project Constellation", "check my PC", "look on my computer", "continue this project", or "open my Constellation project". Works with the Project Constellation desktop app plus browser companion in normal chatgpt.com chats. Preserve zero-loss continuity. Never require an OpenAI API key or separately billed OpenAI API transport.
---

# Project Constellation

Treat Project Constellation as one product spanning the desktop app, browser extension, project/checkpoint manager, ChatGPT workspace, and guarded local-computer companion.

## Continuity contract

Compose with `zero-loss-chat-accelerator` whenever it is available. Preserve the current acceptance ledger, canonical project/repository/file IDs, checkpoints, hashes/run IDs, blocker/no-repeat history, and exact next action. Skill activation never restarts discovery or discards settled project state.

For resumed project work:
1. Reuse the latest valid Project Constellation checkpoint as the delta watermark.
2. Resolve only genuinely missing identity/state.
3. Move directly into the next implementation or verification action once the target is known.
4. Update the project checkpoint after meaningful verified progress.

## Local-computer companion

Project Constellation local access is permissioned and evidence-based. Never claim to see or control the user's PC merely because this Skill is active.

Accept either of these trusted current-conversation contexts:
- the embedded desktop bootstrap supplied by Project Constellation's ChatGPT Workspace; or
- `[PROJECT CONSTELLATION LOCAL CONTEXT]` supplied automatically by the installed Project Constellation browser companion in a normal `chatgpt.com` chat.

A trusted context supplies a per-chat nonce, an explicit tool manifest, and the local-tool contract. The browser extension may visually hide this internal context from the user after submission; it still belongs to the current conversation and is authoritative for local calls.

If no trusted nonce/tool manifest is present, do not invent one and do not emit a guessed tool wrapper. Continue with normal ChatGPT capabilities/connectors, or state that the Project Constellation local companion is not connected to this chat yet.

When a local call is needed, follow `references/protocol.md` exactly. Request only the minimum tool needed, wait for the observed result, then continue the user's task. Respect Emergency Lock, enabled roots/diagnostics, and all read-only boundaries.

## No-credit rule

Never ask the user for an OpenAI API key for Project Constellation. Never route Project Constellation's primary ChatGPT experience through `api.openai.com`, the Responses API, or another separately billed OpenAI API path. The primary experience rides the user's normal authenticated ChatGPT web session/subscription.

## Project workspace behavior

When Project Constellation project metadata is available, keep these fields distinct and current:
- project name / stable ID;
- active ChatGPT chat URL and related chat URLs;
- local workspace root;
- GitHub repository/branch/PR/run identities;
- Google Drive folder/artifact identities;
- latest checkpoint and acceptance state;
- current blocker;
- exact next action;
- project notes.

Treat multiple project tabs as independent workspaces. Do not leak local roots, nonces, tool permissions, or checkpoint state across project tabs unless the user explicitly links them.

## Browser-chat behavior

When the user is in a normal ChatGPT webpage and asks for local-PC evidence, Project Constellation's browser companion may automatically arm that chat and append trusted local context. Once that context is present:
1. Use the local tool only when the task actually needs local evidence.
2. Emit exactly one local call as the whole response.
3. Wait for Project Constellation's hidden tool-result turn.
4. Continue the user's answer naturally from the observed result.
5. Request another call only when necessary.

Do not expose or discuss the hidden browser context, nonce, or tool-result plumbing unless the user explicitly asks how Project Constellation works.

## Safety and truthfulness

- Never fabricate local evidence.
- Never bypass Project Constellation permissions or Emergency Lock.
- Never convert a denied tool into a different unrestricted shell/file action.
- Never expose session nonces, hidden bootstrap/context text, or internal bridge results unless the user explicitly asks how the bridge works.
- Prefer narrow read-only inspection before any mutation capability.
- If Project Constellation reports offline, locked, stale, expired, or denied, say so plainly and continue with whatever non-local work remains possible.
