# Agent Monitor

Agent Monitor brings current chat problems, audible alerts, and browser coverage
into one view. Open **Agent Monitor** from the extension popup, Home, or side
panel. The existing Command Center, Chat Vault, project memory, capture, desktop
bridge, and recovery tools remain available.

## What it observes

| State | What appears | Next step |
| --- | --- | --- |
| Permission request | Approval needed, with the affected chat | Review permission opens the chat; choose the provider's permission yourself |
| Provider error | Error evidence from a live provider surface | Open the chat to inspect or retry |
| Rate limit | Rate-limited incident | Follow the provider's cooldown |
| Conversation limit | Capacity warning or limit incident | Preserve a checkpoint and use the existing continuation tools |
| Waiting for input/sign-in | A review or sign-in incident | Open the provider and finish the requested step |
| Corroborated stalled activity | A qualified warning with observed evidence | Inspect the chat; quiet work alone is not treated as failure |
| Suspended/discarded/closed tab | Unavailable or closed source | Restore or reopen the tab; stale saved state is not live coverage |
| Completed work | Completed state, optional completion alert | Review the response |

ChatGPT and the existing supported-provider adapters supply rich observations
in the Chromium extension. The Firefox sensor uses visible current-turn
controls and live provider alert surfaces. It does not inspect hidden reasoning,
private server job state, or another browser's internal profile databases.

An empty inbox means no current problem has been reported. It cannot prove that
an inaccessible or disconnected chat is healthy. Browser coverage shows that
distinction explicitly.

Chat Guardian rechecks a recoverable conversation after waiting for its composer
or Send control. If the draft changes, a permission/review hold appears, the
conversation changes, or the provider resumes or finishes, it cancels that
continuation. These cancellations preserve the current draft and never trigger
a reload or switch the active tab.

## Audible alerts that survive a closed dashboard

Sound and desktop notifications are separate channels. Chromium playback uses
an extension offscreen document; Firefox playback uses its background document.
The monitor records whether each channel accepted delivery and exposes errors.
**Test alert** explicitly checks both channels in the current browser, even
when normal delivery is muted or disabled; it uses the selected volume and
reports those conditions. A successful browser receipt does not
verify speaker volume, the selected audio device, or Windows/macOS focus mode.

The first observed problem creates an incident immediately. Repeated snapshots
of the same problem update that incident instead of producing repeated alerts.
Incidents, acknowledgements, snoozes, and preferences persist through service
worker restarts. Tabs restored from saved state begin as unavailable until a
fresh observation arrives.

Use these controls:

- **Automatic alerts** enables or pauses delivery while observations continue.
- **Acknowledge** records that you have seen a problem and stops its reminders.
- **Snooze 10 min** schedules a one-shot reminder for that incident.
- **Mute for 1 hour** stops delivery while keeping the inbox up to date.
- **Repeat unresolved alerts** is off by default. Optional repeats are bounded.
- **Completion alerts** are off by default and require an observed transition
  from active work to a completed response.
- **Open chat** uses the original tab and conversation identity. It refuses a
  stale tab that now contains a different conversation.

The hub elects one connected browser to deliver shared alerts. While connected,
alert preferences are shared: mute, sound, volume, desktop notifications,
completion alerts and reminder preferences apply to the elected delivery
browser. A connected dashboard updates the hub policy, and ownership changes
retain that policy. The first profile initializes the policy from its existing
preferences once; later profiles cannot silently overwrite it. Other connected
browsers continue collecting observations. When the hub disconnects, the
extension returns to local monitoring and marks remote sources unavailable.

## Cross-browser setup

**Install one native companion, then enable a sensor in each browser/profile
you want to monitor.** A Chrome extension cannot inspect Firefox, Edge, or Opera
GX tabs through Chrome's own Tabs API. The Rust companion combines authorized
sensor observations; it does not bypass browser isolation.

### Windows

1. Run **Constellation-0.23.0-Windows-Setup.exe** from the matching GitHub release and choose **Install / Repair**.
2. Use the button for Chrome, Edge or Opera GX. Setup opens its extension page and copies the sensor path. Enable Developer mode, choose **Load unpacked**, and select that folder.
3. Open **Agent Monitor**, choose **Connect browser hub**, and approve the browser's native-messaging permission yourself.
4. Repeat sensor setup in each browser/profile. Use a clear name such as `Chrome · Work` or `Edge · Testing`.
5. Open a supported chat, use **Refresh**, inspect browser coverage, and use **Test alert**. Confirm sound on your actual output device.

Setup registers the native host for your Windows user and provides diagnostics,
repair, rollback and uninstall. Its **Computer Tools** button opens the migrated
native desktop application. See [Windows setup](Windows-Setup) for portable
paths, updating, and which actions remain in the browser.

The ZIP/CLI route remains available: extract the Browser Hub ZIP, run
`constellation-monitor.exe install --browser all`, then `doctor`; load the
separately packaged sensors. Keep the folder in place or register its new path.

### Firefox

The Firefox package is a lightweight monitoring sensor. Extract it, open
`about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and
select `manifest.json`. Its toolbar button opens Agent Monitor. Connect it to
the same hub as your Chromium browser.

**This development sensor is unsigned.** Temporary Firefox extensions are
removed when Firefox restarts. A permanent Firefox distribution needs Mozilla
signing. No installer or native host bypasses that requirement.

### Linux and portable locations

```sh
./constellation-monitor install --browser all
./constellation-monitor doctor
```

The default state directory is `constellation-data` beside the native binary.
`--data-dir PATH` selects another location. Re-run `install` after moving the
portable folder so native host manifests point to its new path. Custom portable
browser profile directories may require their documented native host location.

Opera's documented native messaging lookup uses Chrome-compatible locations.
The package prepares those registrations, but actual Opera GX installation
must be verified on the destination system. A detected executable is never
displayed as a connected sensor.

## Approval prompts

Constellation detects active permission controls, opens the affected chat, and
can bring the prompt into view. It **does not automatically click** Allow once,
Allow for this conversation, authorization, sign-in, security, or consent
controls. Saved older Approval Autopilot preferences cannot enable permission
clicking in this build. Existing user drafts are preserved.

For fewer repeated interruptions, the user may choose a provider's supported
conversation-scoped permission option directly in its own prompt. The monitor
records the observed prompt clearing; it never invents approval success.

## Diagnostics and shutdown

| Command/action | Purpose |
| --- | --- |
| `constellation-monitor doctor` | Browser discovery, registration and broker readiness |
| `constellation-monitor discover` | Known browser installation locations, without reading chat databases |
| `constellation-monitor snapshot` | Local merged metadata as JSON |
| `constellation-monitor manifest --browser firefox` | Inspect a native host manifest |
| `constellation-monitor install --dry-run` | Preview installation writes |
| `constellation-monitor stop` | Save state and stop the shared broker |
| Disconnect browser hub | Disconnect this browser and continue local monitoring |
| Export monitoring diagnostics | Download status counts and delivery errors without chat titles, URLs, transcripts or credentials |

The native broker waits on sockets and browser events. There is no recurring
browser scanning loop. Reconnection uses a small bounded set of one-shot
alarms; repeated failure stays visible and needs an explicit retry. The broker
exits after its final authenticated sensor disconnects and the five-second reconnect grace expires. The next native-messaging call restarts it. Normal browser-window events release connections even when a browser remains in background-app mode; no repeating process watcher is used.

The hub uses an authenticated loopback connection and private local state.
Stored status metadata includes chat titles, normalized URLs, short issue
reasons, browser/profile identity, and incident times. Query strings and
fragments are removed. No chat transcript, cookie, sign-in token, screenshot,
or full browser profile is sent through this monitoring protocol.

## Verification and known limits

The repository includes real native child-process/broker tests, browser adapter
unit tests, and rendered browser fixtures for the monitor and permission/error
detectors. The workflows test the current canonical source, not an older
embedded source archive.

Synthetic sensor tests prove transport and state behavior; they are not proof
of the user's live Chrome/Firefox/Edge/Opera GX installation. The exact verified
commands and unresolved acceptance items are recorded in
[`MONITOR-VERIFICATION.md`](https://github.com/Herbertofury/Project-Constellation/blob/main/docs/MONITOR-VERIFICATION.md). Real signed-in providers,
OS notification behavior, Firefox signing, and browser-specific native host
setup require target-environment evidence.

Protocol limits are reported explicitly. The current native broker permits
16 browser/profile clients, 128 simultaneous chat sessions and 256 incident
records. Active records are not silently discarded; capacity errors appear in
the connection status. These are native transport limits, not a claim that all
possible agents or providers are covered.

## Source and build continuity

The repository previously used an older root source plus release archives and
patches. This change restores the complete v0.20.1 source into the canonical
root, verified against tree `89b711f46672830e786ba3afcdf0d1973325a896`, before
applying the monitor upgrade. Historical release evidence and incomplete
v0.20.2 parts are retained. The latter are not represented as a recovered build.

New cross-browser coordination and persistence live in Rust. Browser DOM and
WebExtension API adapters remain JavaScript where those APIs require browser
bindings. The existing desktop and project features are preserved; this is not
a claim that the entire historical Electron/JavaScript application has been
converted to Rust.

## Official API references

- [Chrome Tabs](https://developer.chrome.com/docs/extensions/reference/api/tabs)
- [Chrome native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
- [Edge native messaging](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/native-messaging)
- [Firefox native messaging](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_messaging)
- [Firefox background configuration](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background)
- [Opera native messaging](https://help.opera.com/en/extensions/message-passing/)
- [Chrome offscreen audio](https://developer.chrome.com/docs/extensions/reference/api/offscreen)


## Account integration build configuration

The provided monitoring kit does not embed Google/GitHub OAuth client IDs. Its
manifest version name and artifact receipt report this explicitly. If an
existing configured build provides working account backup integrations, retain
its public client IDs and supply them to the normal production build before
replacing that configured installation. The monitor and local browser hub work
without account integrations. Do not put client secrets or tokens in source,
installer scripts, or shared diagnostics.

## 0.23 reliability and triage

Use the shared search and browser filter above the inbox to find a chat or problem in both lists. The inbox can show all open incidents, only incidents that need you, acknowledged incidents, snoozed incidents, or unavailable sources. **Show resolved** includes retained history. Acknowledgement and snooze do not erase an incident; separate failures within one conversation remain separate history entries.

Every matching chat and incident remains rendered. Live updates reuse unchanged rows, preserving keyboard focus. There is no pagination limit, viewport culling or background refresh loop. When a source disconnects, its last known chats stay visible with **Unavailable** status. A failed, incomplete or timed-out status read cannot claim connected coverage. Refresh or a fresh event restores controls after a valid response.

If an automatic alert channel fails, only that failed channel retries after 2, 10 and 30 seconds. A sound or notification already accepted is not replayed by those retries. Mute, snooze, acknowledgement, source availability and shared alert ownership still apply. Exhausted retries remain visible in alert-delivery diagnostics. **Test alert** remains an explicit way to check the browser's channels; physical speaker playback and operating-system suppression still require checking on your own PC.

Sensors now require a successful persistence acknowledgement. A transient failure retries after 250 ms, 1 second and 3 seconds; a later explicit refresh can retry after exhaustion. Provider content, draft text and consent controls are never changed by these observation retries. Loading older conversation messages no longer creates a false new run. Late observations from an earlier document cannot replace the current tab's evidence.

The native hub keeps direct responses and focus actions in order and combines redundant pending snapshots into the newest complete state. This prevents a burst of tab observations from expelling a healthy browser. A hung native request disconnects the stale port and uses the existing bounded reconnect sequence; a failed local import remains retryable.
