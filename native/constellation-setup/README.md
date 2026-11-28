# Project Constellation Windows Setup

`Constellation-0.25.0-Windows-Setup.exe` is a self-contained, current-user
Windows x64 installer for the browser hub, browser sensors, and the migrated
Computer Tools executables. Double-click it, click **Install / Repair**, then
choose the browsers you want to connect. The destination computer does not
need Rust, Python, PowerShell, an archive tool, or a package manager.

The native setup window includes installation, browser setup, copied sensor
paths, Computer Tools, diagnostics, previous-version rollback, and uninstall.
The default folder is `%LOCALAPPDATA%\Project Constellation`; the folder field
and `--dir` option support a different writable local drive folder. Installation
is per Windows user and requests no administrator elevation.

Open **Project Constellation Setup** from Start to return to this manager.
The desktop dashboard keeps its separate **Project Constellation** entry.

## Finish browser setup

1. Click **Install / Repair**. Setup verifies and writes its embedded payload,
   creates the current-user Start Menu entry, adds an Apps & Features entry,
   and registers the native messaging host for Chrome, Edge, Firefox and
   Chromium. Opera GX uses the Chrome native-host registration.
2. Click your browser's button. Setup opens its extension management page and
   copies the exact sensor path to the clipboard.
3. In Chrome, Edge or Opera GX, enable **Developer mode**, choose **Load
   unpacked**, and paste the copied `browsers\chromium` folder. Each browser and
   profile that should be monitored needs its own sensor enabled.
4. Open the extension's **Agent Monitor**, connect the browser hub, choose the
   browser permission yourself, and identify this browser/profile.
5. Use **Test alert** and confirm that you can hear the sound on this computer.
   Live status in Agent Monitor is the evidence that a browser has connected;
   detecting an installed browser executable alone is not coverage.

For Firefox, the button opens `about:debugging`. Choose **This Firefox → Load
Temporary Add-on** and paste `browsers\firefox\manifest.json`. The included
sensor is unsigned and temporary; reload it after Firefox restarts. Permanent
Firefox distribution requires Mozilla signing. This build does not claim an
available Chrome Web Store or Firefox Add-ons listing.

Browser confirmation is part of supported installation. Chrome's Windows
external-install route requires a Web Store-hosted extension and user enable
confirmation. This installer therefore stages the local development build and
opens the supported manual load flow. It does not write enterprise policy,
edit browser profile databases, add remote-debugging flags, or auto-click an
Allow prompt. The full extension can only use the host after its own browser
permission has been granted.

Primary browser documentation:

- [Chrome extension installation](https://developer.chrome.com/docs/extensions/how-to/distribute/install-extensions)
- [Edge alternate distribution](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/alternate-distribution-options)
- [Firefox temporary installation](https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/)
- [Firefox signing and distribution](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/)

## Background lifetime and Computer Tools

The browser's native-messaging call launches the Rust hub when needed.
Authenticated sensor connections keep it alive. After the last sensor
disconnects, the hub allows a short reconnect grace period and shuts down.
A later native connection starts it again. There is no Windows service,
login-startup entry, scheduled task, or permanently running setup process.
The shared browser bridge closes its sensor port when that profile's final
normal browser window closes, including when the browser remains in background
mode. Opening a normal window reconnects using the saved opt-in. Other connected
browsers and profiles continue to keep the shared hub alive.

On Windows, an enclosing Job can impose an earlier process lifetime. The hub
requests independent lifetime only when that Job permits it; otherwise it runs
inside the existing limits. Setup diagnostics and the hub health snapshot show
this condition. If that Job's owner ends the hub, surviving browser sensors can
reconnect and recover the saved incident history. Setup never changes Job limits
or bypasses a managed process restriction.

**Computer Tools** explicitly opens the migrated owner application. Its local
session and grant controls remain in that owner window. Merely installing or
opening it creates no computer-control session and grants no permission. The
setup window waits for the verified owner process to display its window before
reporting success. An early exit or a startup timeout remains visible in Setup;
the window stays responsive while that check runs. The
full payload includes:

| Executable | Purpose |
| --- | --- |
| `computer-link-owner-proof.exe` | Constellation Computer Tools owner UI and local session controls |
| `local-client.exe` | Native transport client |
| `local-window-focus.exe` | Interactive terminal focus/keyboard companion |
| `computer-link-mcp-session.exe` | Session-scoped MCP adapter |
| `computer-link-workspace-candidate.exe` | Native workspace operations |
| `owned-worker.exe` | Windows Job object worker supervisor |

The sibling executable layout is preserved. Computer Tools provenance,
dependency license texts, build hashes and Windows import reports ship in the
`computer-link` payload. Existing product state is not deleted or silently
migrated from a different repository by the installer.

## Updates, rollback and uninstall

Setup stages each version in its own directory and verifies every file before
changing registrations. Native runtimes are never overwritten in place while
a browser may be using them. The browser extensions use stable paths under
`browsers`; after an update or rollback, use **Reload** in each browser's
extension page to activate the new files.

The transaction journal records previous registry values, the shortcut and
the browser-directory swap before they are changed. A normal failure restores
the prior installation. An interrupted transaction is recovered on the next
setup run. A committed installation is identified by an atomic receipt update;
cleanup retries never undo that committed state. A per-folder OS file lock
prevents overlapping operations, and the Windows backend also serializes
registry changes across installation folders for the current user/session.
Recovery preserves registrations and shortcuts taken over by a newer
installation. If another managed folder already owns a value, the new install
inherits its original pre-Constellation baseline rather than creating a chain
that could later restore a deleted installation. Apps & Features ownership is
checked using the installation path and uninstall command as a group.

If a browser or user writes a new or changed file while a failed update is
being undone, recovery moves those bytes into a named
`preserved-browsers-recovery-*` folder and restores the previous sensor tree.
The recovery message includes that folder path. Changed files therefore remain
available without trapping subsequent repairs in a directory-restore loop.

Install, Repair and Roll back reject an active `browsers` path that is a
symbolic link or Windows junction before changing registrations or committing
a transaction. If an older setup already committed with a linked browser
backup, recovery preserves the link entry in a named
`preserved-browsers-link-*` location and reports that exact path. It does not
traverse the link or alter its target, including when the target has moved or
no longer exists. Cleanup can then finish so repair and uninstall remain
usable. An active linked sensor folder must be replaced with an ordinary
folder before repair; removing only its link entry leaves external files intact.

The managed `data\monitor` and `versions` paths must also have ordinary directory
ancestors. Setup checks them before staging an update or changing directory
permissions, and diagnostics reports linked paths as needing attention. If you
moved data outside the installation, back up that data and restore ordinary
directories before using Install / Repair or Roll back. Uninstall remains
available: it preserves linked runtime directories and their targets, reports
their locations, and does not invoke the hub against a linked data path.

An older local Setup candidate's shared Start Menu name is migrated after the
new installation commits. Its previous desktop shortcut is restored only when
the old link still matches Setup's recorded bytes; a desktop link installed
later is preserved. Recovery retains that comparison and does not undo a later
desktop installation. Rollback restores the previous browser hub and sensors
while keeping the latest verified manager for Setup and uninstall.
Verification includes that retained manager even when its release's browser
payload is no longer active. If the manager is missing or changed, Install /
Repair from a fresh copy of the downloaded setup EXE stages a verified
replacement and preserves the changed original.

**Roll back** selects the previous installed release and restores its native
host registration and browser files. Settings and incident history remain in
the stable `data\monitor` directory. Old release files must still match their
recorded hashes before they can be activated.

**Uninstall** restores only registry values and shortcuts that still match
this installation. It removes tracked files whose hashes still match, keeps
changed or unknown files, and always preserves `data`. A temporary copy of the
setup executable performs uninstall when the installed management executable
would otherwise lock itself; that copy has no startup hook and remains in the
user's temporary folder for normal temporary-file cleanup. Files still locked
by a connected browser are reported and preserved. Browser extensions must be
removed through each browser's own extension settings.
An interrupted uninstall retains its receipt; registration removal stops at
the first error and restores the unique ownership anchors last so retrying
Uninstall can finish without altering a different installation's entry.

The root ownership marker and uninstalled receipt remain beside preserved data
to support a later reinstall. Setup never recursively deletes an arbitrary
selected directory. A nonempty unmarked folder is rejected. Symbolic links,
Windows junctions, path traversal, case-colliding payload names, alternate data
streams and reserved Windows device names are rejected.

## CLI

From a terminal, the GUI executable attaches to its parent console when needed
and preserves an existing redirected output pipe. Setup commands, `verify`, and
`doctor` emit JSON. Use `--quiet` to suppress result message boxes.

```powershell
.\Constellation-0.25.0-Windows-Setup.exe install --quiet
.\Constellation-0.25.0-Windows-Setup.exe manage
.\Constellation-0.25.0-Windows-Setup.exe doctor --quiet
.\Constellation-0.25.0-Windows-Setup.exe verify --quiet
.\Constellation-0.25.0-Windows-Setup.exe rollback --quiet
.\Constellation-0.25.0-Windows-Setup.exe uninstall --quiet
.\Constellation-0.25.0-Windows-Setup.exe install --dir "D:\Apps\Constellation" --quiet
.\Constellation-0.25.0-Windows-Setup.exe payload-info
```

`verify` checks active installed files and the retained setup manager and reports
an incomplete recovery transaction as unhealthy; `doctor` also compares the
native-host and Apps & Features registrations and Start Menu shortcut with the active receipt,
then asks the verified hub executable for connection and saved-state diagnostics.
Both commands exit unsuccessfully when their checks fail. A stopped hub with
valid state is healthy because the next sensor call starts it. Invalid saved
state is reported without overwriting the user's incident history.
Diagnostic child processes have a
15-second deadline. A custom installation folder must be supplied again with
`--dir` when using a downloaded setup executable. The installed Start Menu
shortcut remembers it.

## Stable discovery receipt

`%LOCALAPPDATA%\Project Constellation\constellation-install.json` has schema 1,
product `project-constellation`, an absolute `root`, an `active` relative path
of exactly `versions/<one safe segment>`, and version/payload hash fields.
`releases` records each directory and its files as `{path, sha256, bytes}`.
The desktop resolver selects the active release and verifies the chosen
Computer Tools executable's hash before launching it. Custom folders can be
passed through the desktop host's explicit `binaryDirectory` option.

The receipt and payload digests detect accidental corruption and mismatches;
they are not a substitute for an Authenticode publisher signature. This
candidate executable is unsigned, and target-machine Windows runtime
acceptance remains a separate gate from a successful cross-build.

## Reproduce the build

From the repository root, build the Windows Computer Tools payload first. The
setup builder rebuilds the production extension, Firefox sensor, and native
monitor from the current source. Supply existing
public OAuth client IDs if producing a build that includes account backup;
`--allow-unprovisioned-oauth` creates an explicitly unprovisioned build.

```sh
# Windows, using the pinned Rust host toolchain and Windows SDK:
node tools/computer-link/build.mjs --test
python tools/build-windows-setup.py --require-clean-source
# Linux cross-build, with the GNU target and MinGW toolchain installed:
node tools/computer-link/build.mjs --target x86_64-pc-windows-gnu
python3 tools/build-windows-setup.py --target x86_64-pc-windows-gnu
```

The builder uses the pinned Rust lockfile. On Windows it defaults to MSVC,
statically links the C runtime, and uses Windows SDK `rc.exe`. On Linux it
defaults to the GNU Windows target and MinGW `windres`; set
`CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER`, `--windres` or `RC`, and `PATH`
for the installed cross toolchain. `--resource-compiler` selects either tool
explicitly. A read-only PE parser verifies the actual system-DLL imports of
every native payload executable and the finished setup. It embeds the existing product
icon, a Windows `asInvoker` manifest and version resources. Use `--prepare-only`
to create the verified embedded payload without linking. A reduced monitor-only
package is possible only with an explicit `--monitor-only` flag.

Output: `build/monitor-artifacts/Constellation-0.25.0-Windows-Setup.exe`, its
`.sha256`, and `windows-setup-receipt.json`. The intermediate payload manifest
records every embedded file. Build receipts truthfully record unsigned status,
browser confirmation requirements, scoped source commit/dirty status and the
hashes of build inputs. `--require-clean-source` refuses uncommitted release
inputs, a supplied monitor binary, or Computer Tools built from another commit.
It does not include the unrelated local rescue PowerShell changes in that scope.
The build receipt itself never claims the installed Windows runtime was tested;
that evidence is recorded separately by the acceptance harness.

```sh
cargo fmt --manifest-path native/constellation-setup/Cargo.toml --check
cargo test --locked --all-targets --manifest-path native/constellation-setup/Cargo.toml
cargo clippy --locked --all-targets --manifest-path native/constellation-setup/Cargo.toml -- -D warnings
cargo clippy --locked --all-targets --target x86_64-pc-windows-gnu --manifest-path native/constellation-setup/Cargo.toml -- -D warnings
python3 -m unittest discover -s native/constellation-setup/tests -p 'test_*.py'
```

The transaction tests use an in-memory registry backend and real isolated
filesystem operations. They cover update/uninstall ownership, failed writes,
interrupted recovery, rollback, checksums, path handling and file locking.
They do not establish live browser registration, sound playback, native owner
UI behavior or a successful Windows installation. Those require the Windows
acceptance procedure below.

## Windows acceptance

`.github/workflows/windows-setup.yml` source-builds native MSVC payloads and runs
the actual final EXE on a disposable hosted Windows account. The harness uses
direct Win32 control messages and window captures for Setup and Computer Tools;
it never drives the user's mouse, browser profile, or permission prompts.

```sh
python tools/build-windows-setup.py --require-clean-source --acceptance-fixture --output build/windows-setup-fixture-artifacts
python tools/build-windows-setup.py --require-clean-source --output build/monitor-artifacts
python tools/windows-setup-acceptance.py --setup build/monitor-artifacts/Constellation-0.25.0-Windows-Setup.exe --fixture build/windows-setup-fixture-artifacts/Constellation-0.25.0-Windows-Setup-Acceptance-Fixture.exe --allow-disposable-user-integration
```

The labeled fixture is the same source revision with an extra marker file,
which creates a distinct payload for real rollback testing. It is never a
published release and does not stand in for compatibility testing an older
source version. The harness checks initial install and upgrade, deliberate
corruption and repair, missing-registration diagnostics, rollback and return to
the final payload, the actual Install / Repair and Check installation buttons,
both visible native windows, clean owner exit/relaunch,
shared native browser ports, final-port hub shutdown, demand restart and durable
incident history. It executes uninstall from the installed management EXE to
exercise Windows file locking and the detached helper. Original registry slots
and shortcut bytes must be restored, and data must remain intact.

The final `windows-setup-acceptance.json` binds those observed checks to the
EXE's source commit, version, size, and SHA-256. Failed runs cannot upload the
`Constellation-Windows-Setup` release artifact; they upload diagnostic evidence
separately. Real browser enabling, provider OAuth, and audible sound acceptance
remain distinct checks and are not inferred from this native harness.

On a Windows 10/11 x64 test account, run the actual EXE and check its rendered
window, current-user installation and Apps & Features entry. Enable the sensor
in two browsers, confirm both in the Agent Monitor, trigger an alert, hear its
sound, close all connected browsers and confirm hub exit. Reopen a connected
browser and confirm hub restart. Open Computer Tools and exercise one local
session. Install another version, reload sensors, roll back, and verify that
settings survive. Finally uninstall, check that registered host values return
to their prior state, and confirm that user data remains. Record actual results
instead of treating the cross-built PE file as runtime acceptance.
