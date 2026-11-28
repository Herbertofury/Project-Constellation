# Windows setup and background lifecycle

Open **Project Constellation Setup** from the Windows Start menu to return to the native installer and repair controls. The full desktop app keeps its separate **Project Constellation** entry.

Download **Constellation-0.22.0-Windows-Setup.exe** and its checksum from the
matching Project Constellation GitHub release. This compact installer contains
the Rust browser hub, Chromium extension, Firefox sensor and native Computer
Tools. It installs without a compiler, Python or an additional payload download.

## Quick installation

1. Open Setup and choose **Install / Repair**. The default destination is
   `%LOCALAPPDATA%\Project Constellation`. You can choose another writable local
   folder. Registration applies to your Windows user.
2. Choose your browser in Setup. It opens the supported extensions page and
   copies the sensor path. In Chrome, Edge or Opera GX enable Developer mode,
   choose **Load unpacked**, and paste the copied folder.
3. Open the extension's **Agent Monitor** and choose **Connect browser hub**.
   Make the browser permission decision yourself. Name the profile.
4. Repeat the sensor step in each browser/profile you want to monitor. One
   companion serves them all; one browser's extension cannot inspect another
   browser without its sensor.
5. Open a supported chat, click **Refresh**, inspect coverage, then choose
   **Test alert** and confirm that you hear the sound and see the notification.

Firefox uses **about:debugging → This Firefox → Load Temporary Add-on** and the
copied manifest path. Its sensor is unsigned and temporary, so it must be loaded
again after a Firefox restart. Signed permanent distribution is still pending.

## When the background app runs

A connected browser sensor invokes the registered native host. That host starts
the shared Rust hub if needed. Closing the last normal browser window releases
that browser's native port, including when background-app mode keeps the browser
process alive. Other connected browsers keep the shared hub running.

After the final connection closes, a five-second grace permits quick browser
restarts. With no reconnect the hub saves offline state, removes its endpoint and
exits. The next native call starts it again. No login startup entry, Windows
service, scheduled task or repeating process scanner is needed.

The monitor's lifetime is separate from an explicitly opened Computer Tools
window. That window owns its local sessions and workers. Use its Disconnect/Exit
controls to end them. Constellation's desktop controls stop only the native owner
they launched, not another application with the same executable name.

## Updates and repair

Run the new Setup and choose **Install / Repair**. Browser files stay in stable
paths. Reload the extension in each browser after the update to activate the new
code. Repair verifies payload hashes and restores installed files. A prior
version can be selected through Setup's rollback action when its verified files
are available.

The installer uses current-user native-host registration for Chrome, Chromium,
Edge and Firefox. Opera GX uses the Chrome host registration. Moving the
installation folder requires running Setup again for the new location.

## Native computer tools

Choose **Computer Tools** in Setup, or **Open native tools** in the desktop app's
Connections screen. The native owner provides local file/folder/window snapshots,
new-file export, local window focus, HTTPS handoff and local status sessions.
Select the intended scope in its own controls. A local snapshot grant does not
automatically authorize forwarding content to an external provider.

The full desktop shell is distributed separately as the versioned desktop
portable ZIP and desktop installer. It includes files, terminal, saved tasks and
the existing chat bridge. Both distributions discover the same native modules.

## Diagnostics and uninstall

Setup's diagnostics inspect installed ownership, registration and monitor state.
Agent Monitor shows connected profiles, unavailable sources and delivery errors.
Its test result confirms browser acceptance, not physical speaker output or OS
focus-mode behavior.

Use Setup's uninstall action or the Windows Apps entry. Only owned, unmodified
files are removed. Settings, incident history, modified files and unknown files
are preserved. Locked files are reported instead of being silently deleted.
Registrations belonging to a later installation are preserved. A failed or
interrupted install can recover from its journal.

## Release boundaries

Executables are unsigned. Google/GitHub account backup needs configured public
OAuth client IDs; inspect `build-info.json` and the release receipt before
replacing a build with working account configuration. Source, receipts, hashes
and exact remaining acceptance are linked in the matching GitHub release.
