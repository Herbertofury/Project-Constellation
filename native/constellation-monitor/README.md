# Constellation native browser monitor

A portable Rust companion merges status changes from Constellation sensors in
Chrome, Edge, Firefox, and Opera GX into one local browser dashboard. It keeps
browser/profile identities separate, deduplicates incidents, persists
acknowledgements and shared alert preferences, and routes **Open chat** to the
owning browser.

**Install one companion; enable a sensor in each browser/profile you want to
monitor.** A Chrome extension alone cannot observe Firefox or Edge tabs. The
`discover` and `doctor` commands distinguish a detected browser from a connected
sensor. They never claim a browser is monitored just because its executable or
profile folder exists.

Permission requests are reported as incidents. Constellation can bring the
affected chat into view for your decision. This companion has no operation to
click approval controls, accept permissions, send chat messages, run shell
commands, or launch arbitrary URLs.

## Build and connect

Rust 1.89 or newer is required; CI uses Rust 1.99.0 with the checked-in lockfile.

```sh
cargo build --release --locked
```

On Windows, copy `target/release/constellation-monitor.exe` into the portable
folder where you intend to keep it, then run:

```powershell
.\constellation-monitor.exe install --browser all
.\constellation-monitor.exe doctor
```

On Linux, copy `target/release/constellation-monitor` into your portable folder:

```sh
./constellation-monitor install --browser all
./constellation-monitor doctor
```

`install` registers the native host for the current user. It does not install
extensions or require administrator privileges. Load/enable Constellation in
each Chromium browser and the companion sensor in Firefox, then choose
**Connect browser hub** in the extension. The native host starts the shared
broker on demand. `manifest` or `install --dry-run` prints exactly what would be
registered without changing browser configuration.

The supplied IDs are:

| Browser package | Allowed extension ID |
| --- | --- |
| Chromium Constellation | `geljambmkfjkhodgkpjhnmfojkpcamig` |
| Firefox sensor | `constellation-monitor@project-constellation.local` |

Use `--chromium-id` or `--firefox-id` only if your deliberately installed sensor
has a different ID. Firefox installation/signing rules still apply; the native
host cannot bypass them.

## Portable state and operation

The default state folder is `constellation-data` beside the executable. A
`CONSTELLATION_DATA_DIR` environment variable or `--data-dir PATH` CLI option can
choose another location. `install --data-dir PATH` records that location in a
small `constellation-monitor.config.json` next to the executable because native
host manifests cannot pass arbitrary command arguments. Paths inside the
portable folder are saved relative to the executable. Re-run `install` after
moving the folder so browser registrations point to its new location.

| Command | Purpose |
| --- | --- |
| `install --browser all` | Register current-user native hosts |
| `manifest --browser firefox` | Preview the Firefox manifest without writing |
| `doctor` | Check transport, saved state, connected sensors and browser discovery |
| `discover` | Look for standard browser executable/profile locations without reading chat profiles |
| `snapshot` | Read the current shared hub state as JSON |
| `stop` | Save state, stop the shared broker and disconnect all native ports |
| `daemon` | Run the browser-bound broker in the foreground for diagnostics |

The companion waits on OS sockets/pipes and browser events. It runs no scanning
loop, recurring heartbeat, remote-debugging session, or external network
connection. A short bounded retry is used only while starting the shared
broker. No startup task, Windows service, or permanent background supervisor is
needed.

Each authenticated native sensor connection holds one lifetime lease. Closing
one browser releases only its lease; other connected browsers/profiles keep the
hub available. After the final lease closes, a **five-second reconnect grace**
starts. A new connection during that grace cancels shutdown. If no connection
arrives, the hub marks persisted clients offline, flushes state, closes all
transports, removes its endpoint, and exits. Diagnostic `doctor`/`snapshot`
connections and unauthenticated sockets never extend that grace. A broker
started manually with `daemon` also exits after the grace if no sensor connects.

Windows Job limits remain authoritative. When the launching process belongs to
a Job that permits breakaway, the hub can obtain independent lifetime. When a
Job forbids it, the hub starts inside that Job instead of failing with Access
Denied or trying to change the policy. Its owner may terminate it sooner than
the native sensor lease deadline. The surviving sensors can reconnect and
restore saved state. `doctor` and `health.processLifetime` report whether the
process is Job-managed, whether breakaway is allowed, and whether closing the
Job ends its processes. The shared sensor lease and idle shutdown rules apply
within those OS limits.

The browser adapter listens for normal-window creation/removal. It disconnects
when that profile's last normal browser window closes, even if the browser
keeps its background process running. Popups, offscreen audio and extension
background documents do not keep the hub alive. Reopening a normal window
reconnects automatically with the existing opt-in and identity; it does not
require enabling the hub again. Window checks happen on startup and window
events, with no recurring polling. The adapter reports `waitingForWindow:true`
while suspended and does not schedule reconnect alarms or own alert audio.

The next `runtime.connectNative` call starts a fresh hub when necessary. Startup
election uses separate private process locks, so simultaneous profiles converge
on one hub and a call racing the previous hub's shutdown waits for its state
writes to finish. Old reader cleanup cannot remove or mutate a newer connection
with the same identity. `stop` still explicitly saves and disconnects every
sensor immediately; it affects only the monitor hub, not separately launched
Constellation desktop or Computer-Link compatibility processes.

For diagnostics or automated tests, `CONSTELLATION_IDLE_GRACE_MS` can override
the grace with an integer from 100 through 60000 milliseconds. The default is
5000. The variable must be present in the native host's launch environment;
`--data-dir` does not change the grace. A single cancellable deadline handles
the idle transition, rather than a timer that periodically scans for browsers.

## Reliability and privacy

- Each browser connection authenticates to a **127.0.0.1-only** broker with an
  OS-random 256-bit credential. That credential never crosses the extension
  boundary and is never printed by `doctor` or `snapshot`.
- The data directory is private to its owner: Unix mode 0700 with 0600 files;
  a protected owner/System DACL on Windows. Existing Windows private files have
  their DACL restricted before use, including files copied with explicit broad
  permissions. Unsafe Unix private-file permissions are rejected. The host
  does not follow a symlink for the data directory or credential file.
- Saved metadata includes chat title, normalized URL, short status reason,
  browser/profile IDs, and incident times. Query strings and fragments are
  removed. No transcript, cookies, tokens, browser profile databases, or
  screenshots are collected by this companion.
- Snapshots are bounded to 16 clients, 128 sessions, and 256 incidents. Frames
  are capped at 1,000,000 bytes before allocation, below the browser's native
  message limit. The maximum complete snapshot, including escaped text and
  historical chat identities, is covered by a size regression. Active records
  are not silently evicted to make room; stale disconnected or resolved history
  is retired first.
- Writes use a synced temporary file and atomic replacement. Persistence
  failures roll back the requested observation, acknowledgement, snooze, or
  removal in memory and surface an error. An acknowledgement is never reported
  as applied when it could not be saved.
- Restarted records are marked disconnected until the browser re-observes the
  live page. A stale saved incident does not imply current monitoring coverage.
- Suspension pauses an unresolved incident without claiming recovery. Seeing
  the same issue again resumes its existing episode and acknowledgement.
  Snoozing clears acknowledgement so that episode can remind after its deadline.
- Mute, sound, notification, volume, completion, and reminder preferences are
  shared by the hub. The first connecting profile supplies its existing
  preferences once; later profiles receive that durable policy. A follower's
  mute applies to the elected delivery owner and survives ownership transfer or
  broker restart. Invalid or unsaved updates are rejected without applying a
  browser-only substitute. Use matching current sensors in every browser.
- Policy and prior acknowledgements/snoozes are applied before a new delivery
  owner is enabled. Ordinary snapshots leave reminder alarms alone, and native
  snoozes retain their exact absolute deadline instead of gaining another minute
  during transfer.
- Incident history retains the original title, URL, document and run identity;
  navigating the same tab cannot rename an earlier incident to the new chat.
- Focus requests contain only the previously observed tab/document identity,
  and go only to its currently connected owning sensor. The sensor must verify
  the tab/document again before focusing it.

Anyone who can run code as the same OS user can inspect that user's local files;
the loopback credential is not a sandbox against a compromised user account.

## Browser-specific registration

On Windows, current-user registry keys are used:

| Browser | Registry key |
| --- | --- |
| Chrome / Opera GX | `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.project_constellation.monitor` |
| Edge | `HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.project_constellation.monitor` |
| Firefox | `HKCU\Software\Mozilla\NativeMessagingHosts\com.project_constellation.monitor` |
| Chromium | `HKCU\Software\Chromium\NativeMessagingHosts\com.project_constellation.monitor` |

Linux registration uses user-level `NativeMessagingHosts` folders for Chromium
browsers and `~/.mozilla/native-messaging-hosts` for Firefox. Opera registration
includes its profile-local folders and the Chrome compatibility location.
Opera's published documentation names Chrome's native-host location; actual GX
integration must be checked on the destination installation with `doctor` and
a sensor connection. A portable browser using a custom profile directory may
need its native host manifest placed in that directory according to its own
browser documentation.

## Validation

```sh
cargo fmt --all --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked --all-targets
cargo build --release --locked
```

The integration tests launch **real native-host child processes** and a shared
Rust broker. They test cross-browser status merging using simulated Chrome and
Firefox sensors, tab routing, duplicate incident suppression, acknowledgement
persistence, removal/recovery, malformed framing, authentication failure, and
restart/disconnect semantics. They do not prove a live browser installation or
native notification/audio delivery; those require the extension smoke suite
and real target-browser acceptance.

Lifecycle regressions use real native-host stdin EOF, multiple simultaneous
browser processes, a final-disconnect exit, reconnect within grace, automatic
restart with durable incidents/preferences, a retiring broker's held lock, and
unauthenticated/diagnostic sockets that must not keep the hub running. A
deterministic ownership regression covers delayed cleanup from an evicted
reader after a replacement registers. Browser bridge tests exercise normal
window close/reopen, background-only startup, multiple windows and cancelled
asynchronous setup for all four browser identities. These adapter tests use
browser API fixtures; they do not replace installed-browser acceptance.

The independent `native-monitor.yml` workflow runs the transport suite on Linux
and Windows and builds portable executables. A successful cross-target `cargo
check` is compile coverage only, not a Windows runtime result.

### Windows executable from a Linux build machine

With the Rust Windows GNU standard library and an x86-64 MinGW-w64 compiler
installed, the same locked source can produce the Windows portable executable:

```sh
rustup target add x86_64-pc-windows-gnu
CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER=x86_64-w64-mingw32-gcc-posix \
  cargo build --release --locked --target x86_64-pc-windows-gnu
```

The output is
`target/x86_64-pc-windows-gnu/release/constellation-monitor.exe`; the Linux
executable remains in `target/release/`. Use your toolchain's actual compiler
path if it is named differently. The cross-build was linked with Rust 1.99.0,
GCC MinGW-w64 14.2.0, and MinGW-w64 12.0.0. Its PE import table contains Windows
system DLLs only, so that build needs no separate MinGW runtime DLL. Linking and
inspecting the PE file does not establish that registration, ACLs, browser job
breakaway, or native ports have been exercised on a Windows machine. The
Windows CI suite includes a regression that repairs a copied private file's
explicit Everyone ACL before reading or reopening it. Another actual child
process test creates a Job with breakaway forbidden, verifies that the launched
broker remains in that Job, and checks native hello, idle exit, restart and
durable incident restoration. It leaves the hosted runner's own Job unchanged.

### Actual Chromium native-messaging smoke

On a Linux machine with Python Playwright and a full Chromium browser:

```sh
python tests/chromium_native_smoke.py --chromium /usr/bin/chromium \
  --report native-browser-result.json
```

This optional fixture copies the built executable into a temporary directory,
registers a minimal test extension only inside two isolated Chromium config
directories, and uses real `chrome.runtime.connectNative` ports. It checks shared
snapshots, equal tab IDs in separate profiles, acknowledgement/snooze persistence,
focus routing, removal, browser disconnect, and browser rejection of a third
extension absent from the host allowlist. It leaves `HOME`, existing profiles,
and system registrations untouched. It has no approval-control interaction.

A full Chromium binary is required; `chromium-headless-shell` does not establish
extension support. An environment that denies Chromium's required Unix
process-singleton socket produces a **blocked** report and exit code 2. That
condition prevented this installed-extension test from running in the build
workspace. It is separate from the passing native Rust child-process transport
suite; it is not a successful browser integration result.

See [PROTOCOL.md](PROTOCOL.md) for the exact sensor schema.

## Official integration references

- [Chrome native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
- [Chrome window events and queries](https://developer.chrome.com/docs/extensions/reference/api/windows)
- [Edge native messaging](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/native-messaging)
- [Firefox native messaging](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_messaging)
- [Firefox normal-window queries](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/windows/getAll)
- [Firefox background implementations](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background)
- [Opera native messaging](https://help.opera.com/en/extensions/message-passing/)
- [Chrome offscreen audio](https://developer.chrome.com/docs/extensions/reference/api/offscreen)
- [Windows file security and access rights](https://learn.microsoft.com/en-us/windows/win32/fileio/file-security-and-access-rights)

