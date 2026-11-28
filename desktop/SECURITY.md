# Constellation Commander Security Model

## Renderer separation

Constellation Commander deliberately separates the local shell and ChatGPT renderer.

- Both use `nodeIntegration=false`, `contextIsolation=true`, and Chromium sandboxing.
- The ChatGPT `WebContentsView` receives only the dedicated Commander chat preload.
- The local shell receives only `shell-preload.cjs`, which exposes a narrow `window.commanderShell` API rather than raw `ipcRenderer`.
- Main-process IPC validates the exact owning renderer before accepting a request.

## Local permissions

The user-visible sidebar is authoritative for local capability state:

- **GUI / computer control** gates Windows mouse/keyboard/screenshot/UI Automation tools.
- **Shell / terminal** gates command/process execution.
- **Filesystem access** is either explicit roots or intentionally selected Full PC (`allowedRoots=["*"]`).
- **Emergency Lock** is persisted and blocks GUI automation at the tool-policy layer, not only in the UI.

## ChatGPT session

ChatGPT runs in a dedicated persistent Electron partition (`persist:constellation-chatgpt`). Credentials and cookies stay in Chromium’s session store and are not exported by Commander.

Commander does not require an OpenAI API key and does not route the primary experience through separately billed OpenAI API endpoints.

## Navigation and permissions

Untrusted navigations are opened externally instead of being silently loaded into the privileged application surface. The dedicated ChatGPT session permits only the small browser permission set required by trusted login/chat origins.

## Packaging

Application JavaScript is packaged in ASAR. Only `native/**/*` is unpacked because the Windows computer-use helper must be executed as a real file. Release acceptance verifies the unpacked development runtime and the silently installed packaged runtime.

## Reporting

Do not place passwords, session cookies, bearer tokens, private keys, or other secrets in bug reports or diagnostics. Tool-call logs intentionally retain compact operation metadata rather than full secret-bearing argument payloads.


## 0.7.2 repair verification

See REPAIR-REPORT.md. Browser fixture success is not proof of a live authenticated ChatGPT session. Workspace file and terminal operations do not depend on the ChatGPT bridge. Emergency Lock blocks new mutation calls and stops Commander-owned processes.

Terminal permission is separate from filesystem roots. An enabled shell runs as your Windows account; roots constrain Commander file APIs and the initial working directory, not the capabilities of arbitrary shell programs. Disable Shell/terminal when only scoped file access is intended.
