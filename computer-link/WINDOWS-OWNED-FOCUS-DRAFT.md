# Tray-owned local foreground selector

Local development step after reviewed dffbf02 and integrated b7245ef. Owner menu
opens an explicitly consented child mode of the same installed executable, contained
in the existing kill-on-close Windows Job before resume. It lists bounded observed
window identities locally, consumes the entire candidate set when reviewing one,
and requires Cancel-default exact identity confirmation for one foreground request.
No typing/clicking, shell, browser profile/tab/DOM access, remote route or host grant.

Disconnect/Exit terminates pending child selection/prompts and descendant process
resources. An already-admitted foreground change cannot be recalled; termination
can race the effect. Owner shows active PID, waits on process exit without polling,
and ignores stale generation callbacks. Direct CLI invocation is explicitly labelled
as NOT tray-owned and asks its own consent. Unknown arguments fail closed.

The main tray stays responsive even if synchronous caption capture in the child
blocks. Only trusted/quiescent desktops are supported. Same-process HWND reuse and
check/effect mutation are not prevented. This is observed identity, not isolation.
Process creation inherits normal OS user context; installed source/folder must be
trusted. This is not full computer control or a supported dot connection.

Review corrections: drain candidates before nested confirmation, revoke local
selector state on destruction and check after consent, fail closed on null controls,
show actual active owner state. Enter/Escape cancel selector; final native dialog
uses Cancel default. Selection titles stay local/in-memory, not stdout or network.

Windows-target compile passes. Native tests proposed cover actual selector default
Cancel, selection cancel, owner Disconnect/Drop, duplicate review, close/stale
approval, Enter/Escape. Existing five foreground tests require actual transition.
Native runtime results pending; do not distribute or install until reviewed/tested.
This source-only branch has no artifact publication or owner-machine installation.
Remaining: full installed regression, visual/accessibility review, actual browser
adapters, action-specific click/type consent and reconciliation, safe file authority,
user-chosen endpoint/authentication and supported host admission.
