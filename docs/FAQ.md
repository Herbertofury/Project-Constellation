# FAQ

## Does Constellation send my chats to its own server?

No. There is no Constellation backend in this release. Data stays in browser storage unless you explicitly configure user-owned Google Drive and/or GitHub destinations.

## Why does it need broad AI-site host access?

Content scripts must run on each supported provider to observe the conversation DOM. Provider background reads are governed and feature-specific. Google/GitHub host permissions are optional and requested when those connections are used.

## Why Developer mode / Load unpacked?

The release is packaged as reviewable unpacked extension source. Chrome Web Store publication is a separate distribution workflow.

## Is Google OAuth broken if the button says setup required?

The build is unprovisioned, not connected. v0.14 deliberately says so and blocks a fake production package. Install the official provisioned release or build with the correct Chrome Extension OAuth client.

## Will updates lose my data?

Not when the stable manifest key/extension ID is preserved and the existing extension is reloaded/upgraded. Export or verify Drive before significant upgrades. Removing and reinstalling as a different extension can lose local storage.

## Does it use unofficial ChatGPT APIs?

No. Live capture is DOM-based and network-free. Zero-tab provider reads use the authenticated web surface only where configured, governed, and supported; no official history API is claimed for ChatGPT.

## Can I disable the starfield?

Reduced-motion disables animation automatically; constrained devices use a static/absent effect. The Starlight theme remains accessible. The effect exists only on Constellation-owned UI, never over the full ChatGPT page.

## Why is Full Capture visible?

Browsers throttle hidden/minimized pages, which made deep capture unreliable. The explicit visible window is more honest and predictable.

## Where should future agents start?

Read `AGENTS.md`, [Continuation](CONTINUATION.md), the latest release receipt, and `brain/v0.13.0/COMPASS.json`, then run `npm run verify` before changing state.
