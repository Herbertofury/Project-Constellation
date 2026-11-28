# Experimental local one-shot foreground request

This follows the integrated installer acceptance source b7245ef. It is a separate
owner-invoked `local-window-focus.exe`, NOT part of the installer, owner UI, MCP
transport, remote routing or dot access. No endpoint or persistent grant is added.

The interactive console refuses arguments/piped stdin/stdout. Enter permits a bounded
local visible-window list (64 candidates/4096 enumerated windows). Owner selects one
number, then an exact title/class/PID/thread/HWND modal with Cancel default authorizes
one foreground request. Targets are consumed, never retried, restored, clicked or
typed into. Close/Ctrl+C terminates the console; no worker, timer, listener or saved
window list remains. A completed foreground change cannot be undone by later exit.

A SYNCHRONIZE-only process handle is held while the captured identity is checked
before consent and again immediately before SetForegroundWindow. Renamed, hidden,
closed, dead-process, malformed, overlong or control/bidi-caption targets refuse.
Success requires nonzero OS result and immediate foreground HWND observation.
Windows foreground policy may reject the request; no AttachThreadInput, simulated
input, foreground-lock modification or elevation workaround is used.

## Scope limits
Same-process GetWindowText can synchronously block. The console has no UI worker or
hard operation deadline; closing it terminates the process. Empty titles are skipped.
Caption/class/handle identity checks are NOT a security boundary: foreign windows
can change between check and operation; same-process handle reuse is not excluded.
Use only on a trusted, quiescent interactive desktop. It does not promise exact
future target identity under adversarial mutation, protected/secure desktop access,
all browser tabs, DOM/UI Automation or ChatGPT control. These remain backlog gates.
The program itself does not log titles, but console scrollback belongs to the terminal.

## Verification
Windows-target `cargo check --locked --all-targets` passes. Native runtime tests are
not yet run. Added synthetic Windows tests cover cancel/no-focus, renamed/closed
refusal, deceptive caption rejection, and mandatory successful foreground activation. No user
window is used by these tests. Independent review and native source-only CI required
before any distribution/integration. The actual interactive console-to-modal default Cancel, dialog close and process-stop paths are not yet tested. No claim this draft passes native acceptance.

## Next integration gates
- Reviewed target-selection UI with immediate cancel and nonblocking bounded capture.
- Fresh target binding and intent policy for each UIA/action type, including race limits.
- Separate permission to type/click, safe interruption, effect reconciliation, no replay.
- Browser-specific native/extension grants and fixture tests before browser control.
- Authenticated reachable self-owned endpoint + actual host admission before dot use.

Official API references:
https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setforegroundwindow
https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getwindowtextw

## Independent review corrections
Review required mandatory activation success, no racy failure assertion, and a
call-count cancellation boundary test; these are now in source. Renamed the prompt
to "selected observed window" to avoid overstating race resistance. This separate
console is NOT controlled by owner GUI Disconnect/Exit. Only its own Cancel, Ctrl+C
or console close stops it. Do not integrate/distribute without owned lifecycle.
Terminal checks/modal consent are usability controls, not proof against same-user
automation. Activation can trigger application activation handlers, even though
there is no input injection. Actual console/modal/stop acceptance remains pending.
