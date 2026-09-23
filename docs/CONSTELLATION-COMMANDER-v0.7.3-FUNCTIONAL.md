# Commander 0.7.3 - functional chat bridge repair

Date: 2026-09-23
Scope: preserve the existing 0.7.2 layout; repair request targeting, execution and result delivery. Small visual changes only: consistent connection states, keyboard focus and a real Test chat access action.

## Canonical delivery

Complete source, exact-version manual patch, Windows portable split parts, evidence, report and checksums:
https://drive.google.com/drive/folders/1XHyS7sQRntsz_rCLvBbN316mT1T9krWb

Full corrected source ZIP:
https://drive.google.com/file/d/1qi4um53fGPGvlzKR1h_9SU32TL9-d_VK/view

Small manual patch:
https://drive.google.com/file/d/14CpGvbf9PNbKJLvWuL9iJOHfZrhhn2dZ/view

This branch contains the reviewed production request adapter at releases/constellation-commander/v0.7.3/request-page-hook.js, the runtime-provisioning workflow, and this receipt. The complete corrected source and binaries are in the linked artifacts, not represented as a complete repository source tree. Unrelated main-branch work was not changed.

## Causal repairs

- Target only the newest explicit user message on supported HTTPS chatgpt.com conversation requests; never rewrite older matching prompts or third-party/telemetry POSTs.
- Await a correlated arming acknowledgement before Send.
- Require a matching successful HTTP receipt for result delivery, rather than treating a cleared composer as success. HTTP 403/429 and network failures preserve a saved result.
- Wait for generation to finish, recheck unsent drafts, and retry saved outcomes without re-executing completed actions.
- Use independent outbox IDs and fresh authorization for each new user task. Preserve same-conversation follow-ups; Off cancels observation and forbids execution.
- Recognize complete fenced tool wrappers without accepting explanatory quotes, user-authored wrappers or stale nonces.
- Tolerate harmless query/fragment changes without permitting delivery to a different conversation or origin.
- Keep header, Inspector and footer status consistent: adapter loaded is not the same as a proven tool-result exchange.

Connections > Test chat access sends a harmless request through the actual adapter. It requires the model to call the local ping tool and the chat request path to accept its result; it does not synthesize a local green pass.

## Obtained proof

Seven new request-adapter regressions failed on the shipped baseline and pass after repair. All 50 Node regression tests passed. Existing syntax, server, relay, actual device-agent, plugin, browser/background and real-Chromium-to-disk suites passed; Windows-only automation explicitly skipped on Linux.

Seventeen scenarios passed in real Electron 44.4.4 on Linux against both unpacked application code and the final delivered app.asar. These used actual application main/preloads/IPC/CSP and real disk/process operations, not a substituted IPC API. Cases cover successful tool exchange, fenced responses, delayed generation, HTTP 429 retention, non-replaying retry, HTTP 403 rejection, file/editor saves and conflicts, terminal input/Stop, quoted/user/stale-wrapper rejection, unsent drafts, reload-safe outbox, conversation isolation, Test chat access, and Off enforcement/status.

The final ASAR was checked against source, including file offsets, sizes and integrity hashes. ZIP CRCs and all 73 unchanged non-ASAR portable archive entries were verified. Portable, manual-patch and native-tested ASAR bytes are identical.

Source, manual patch and all three portable parts were downloaded back from Drive. Every part's size/hash matched; streamed recombination equals the exact portable ZIP hash below.

## Explicit remaining boundaries

The ChatGPT server in these tests is an owned fixture, NOT the user's authenticated ChatGPT account. Native Windows execution, Windows PowerShell computer-control helper, microphone/camera and PowerShell patch/rollback execution remain unverified here. Linux test execution uses --no-sandbox because the test host runs as root; production launchers were not changed to disable sandboxing, and contextIsolation/nodeIntegration settings remain intact.

The Windows portable preserves the existing Electron 44.4.3 runtime; Linux native proof uses 44.4.4. Windows File Properties may show 0.7.0, while the application reports 0.7.3. No new signed NSIS installer or successful Windows release CI run is claimed. An accepted HTTP request is not proof of a subsequent model response or server-side persistence.

The embedded bridge remains a DOM/request adapter, not an officially registered ChatGPT app. No public relay or ordinary-browser app connection has been activated. No API key, paid inference route, automated repatcher or automatic permission grant was added. Platform quotas, user permissions and operating-system controls are not bypassed.

## Installation

Close Commander. For exact known 0.7.0/0.7.1/0.7.2 installations, extract the Manual Patch, run APPLY-PATCH.cmd, and select Constellation Commander.exe. The script verifies old/new archives, refuses running or unknown targets, keeps a backup and leaves profile/settings intact; ROLLBACK.cmd is included. Windows script execution remains unverified.

Alternatively, extract the complete portable ZIP into a NEW folder and run Constellation Commander.exe, keeping its files together. Do not reinstall an older EXE over the repair.

After signing in, finish any generation and leave no unsent draft, then use Connections > Test chat access. This is the remaining live-account verification action, not evidence already obtained.

## SHA-256

```
0a00bb92e2243b143959ee5273a9b7f43b5de6a42311137ab9164dce31e33e60  Constellation-Commander-0.7.3-Windows-Portable.zip
6a4674740f53d105eb2ff267b19c42448acfd55a3282ffac749339870cf0a6b0  Constellation-Commander-0.7.3-Manual-Patch.zip
5198e41e552445d39e99f9592739ae2461efe4ecdfb2a9e9c3d21cbb192466ee  Constellation-Commander-0.7.3-Source.zip
57addb92a2aa7693363e559c09af8680f0eefe5a21b116c3f0214503d1080468  Constellation-Commander-0.7.3-Test-Evidence.zip
a4f4f33ce5e31e12508a7c204d433452a71d0298b1905c90a4365e57f4fd6fd0  resources/app.asar
```

Native Linux runtime provisioning: GitHub Actions run 35907463968, artifact 10771861124, official runtime SHA-256 371dfb6eb7f300f83932d010984f3419af162146b1c20631a8c89938d4338f3e. This run provisioned the verified runtime; it is not a Windows application acceptance run.
