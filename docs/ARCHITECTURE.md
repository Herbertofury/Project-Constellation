# Architecture

Project Constellation is a Chrome Manifest V3 extension with four runtime surfaces.

1. **Content runtime (`extension/src/content.js`)** detects the provider, passively observes mounted DOM, batches semantic events, derives local page/tool evidence, and renders the isolated Execution Pulse shadow DOM.
2. **Service worker (`extension/background.js`)** owns IndexedDB, search, organization, recovery state machines, provider request governance, Drive/GitHub adapters, alarms, and UI message routing.
3. **Owned UI (`home.*`, `sidepanel.*`, `popup.*`)** reads service-worker projections and sends typed `PC_*` commands. UI actions are verified by ownership and message-contract tools.
4. **Offscreen parser (`offscreen.*`)** parses authenticated/exported documents away from AI pages using the Manifest V3 `DOM_PARSER` reason.

## Data flow

```text
Mounted provider DOM
  -> bounded content scans
  -> batched semantic events
  -> service worker
  -> IndexedDB stores + search index + integrity/knowledge projections
  -> Home / side panel / popup
  -> optional verified Drive snapshot and GitHub mirror
```

The content path does not perform network requests. Passive `webRequest` observation in the service worker tracks request timing/status without reading request or response bodies.

## Storage

IndexedDB database `project-constellation-brain` uses versioned stores for providers, groups, projects, smart collections, chats, turns, files, knowledge items/sources, continuity, events, checkpoints, sync receipts, catalogue runs, integrity baselines/findings, and search documents.

Small settings and runtime state live in `chrome.storage.local`. Pending GitHub device authorization uses `chrome.storage.session` when available. OAuth access/refresh tokens remain separate storage keys and are not part of brain snapshots.

## Provider abstraction

`provider-core.js` owns host detection, canonical chat IDs/URLs, provider metadata, and external-link classification. Provider catalogue capabilities declare whether browser history, background HTML, live passive capture, exports, or manual Full Capture are supported. No provider is advertised as having an official history API when it does not.

## Recovery invariants

- Mounted messages are never removed or hidden.
- Content scripts do not issue provider traffic.
- Network/delivery recovery refreshes the page; it does not repeatedly click Retry.
- Rate-limit evidence enters the shared request governor.
- Full Capture is visible and user-initiated; hidden/minimized recovery is isolated to the bounded approval-recovery lane.
- Remote restore is merge-newer, followed by search-index rebuild and receipt creation.

## Release invariants

- Package and manifest versions agree.
- The stable manifest key remains present.
- Production packages contain real Google and GitHub client IDs and no placeholder.
- Source, installable ZIP, checksums, release receipt, notes, README, wiki, Drive state, and GitHub tag agree.
