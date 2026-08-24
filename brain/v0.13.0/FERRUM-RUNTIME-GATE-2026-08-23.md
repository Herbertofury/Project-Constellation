# Ferrum real-extension runtime gate — 2026-08-23

Project Constellation v0.12.0 was tested against the verified Ferrum v0.2.0 runtime package after the Drive-derived source reproduced the canonical v0.11.0 installable and all v0.12.0 source/smoke gates passed.

## Exact candidate identity

- Project Constellation: `0.12.0`
- Installable directory: `dist/project-constellation`
- Ferrum `hashDirectory` SHA-256: `f4b0f2329c312bc55770f764cdeacf158683888bc0093a3e47f6e8c207a2d01b`
- Files: `21`
- Manifest-key extension ID: `geljambmkfjkhodgkpjhnmfojkpcamig`
- Ferrum runtime: `0.2.0`
- Ferrum verified code lineage: `f4efb3f4f1f8b188bd0637137779fef46d8eaf6b`

## What was exercised

1. Canonical Ferrum CLI extension lane was run against the exact v0.12.0 unpacked directory with the system Chromium executable.
2. Ferrum recorded the exact candidate build identity before the runtime gate.
3. A second Ferrum-packaged Playwright/CDP evidence run connected to Chromium, resolved the expected manifest-key identity, and attempted to open the exact extension popup.
4. Chromium itself was run with verbose extension logging to distinguish a product failure from an environment/policy failure.

## Observed external blocker

The container's only installed Chromium is managed by an administrator policy that refuses unpacked extension loading. Chromium emitted this authoritative load error:

`Extension error: Failed to load extension from: /mnt/data/project-constellation-v0110-work/dist/project-constellation. Loading of unpacked extensions is disabled by the administrator.`

Because the extension was rejected before Chromium created Project Constellation runtime targets, the Ferrum CLI correctly could not resolve a loaded extension ID. A CDP compatibility run then received `net::ERR_BLOCKED_BY_CLIENT` when opening the expected `chrome-extension://.../popup.html` URL.

Ferrum's matching Playwright browser is not bundled in the packaged desktop artifact in this environment, and downloading it is blocked by this runtime's DNS/network restrictions. The system Chromium policy must not be bypassed or weakened merely to manufacture a passing result.

## Acceptance status

- Exact build hashing through Ferrum: **PASS**
- Ferrum evidence capture: **PASS**
- Real unpacked extension load in this managed container: **BLOCKED BY EXTERNAL CHROMIUM POLICY**
- Product source/unit/static/browser-smoke regression suite: **PASS**
- Real signed-in provider acceptance: **EXTERNAL GATE**

This gate is environmental evidence, not a claim that the real unpacked extension loaded. The next unrestricted Ferrum/Chrome environment should run the exact v0.12.0 installable SHA above and require runtime ID, service worker/content-script behavior, Capacity Guard/Safe Handoff, restart persistence, and clean diagnostics before promoting that external gate to PASS.
