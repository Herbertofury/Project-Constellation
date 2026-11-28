# Experimental Windows disposable workspace proof

Source-only CI candidate, not an installer or computer connector. Windows stdio supports bounded list/read/create-new and process-local revoke in a newly selected directory. No overwrite/delete/admin, socket server or remote pairing.

Use only a known local disposable temp directory. CLI selection is not authenticated human consent. UNC/device namespaces are rejected and ordinary drive roots must report DRIVE_FIXED. Trusted quiescent ancestors/root are required: joined paths are not handle-relative protection against replacement/junction races. ACLs inherit parent; blocking operations are not preemptively revoked. Interrupted effects are uncertain and not transaction-journal bound. Do not expose remotely.

CI compiles and runs disposable tests only; no owner files, deployment or artifact delivery. Passing CI does not establish production safety, desktop control or connection to an assistant.

Follow-up candidate: ordinary drive-letter paths only, fixed-drive check, retained no-write/no-delete-sharing directory handles from drive root through selected root, rejecting reparse ancestors. This mitigates ordinary rename/replacement while held, but does NOT claim full hostile filesystem confinement: directory creation-to-open identity race, DOS-device mapping changes and attribute-only reparse mutation require further work/tests. No endpoint exposure. Official API references: https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew and https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getdrivetypew . Actual ancestor-rename and reparse-ancestor fixtures remain missing; the current fixture tests selected-root rename only.

SelectedRead library adapter additionally binds one validated leaf for read-only transport; selection remains name-based, not an immutable content/identity snapshot. Original local stdio write_new mode remains distinct and is not exposed through the transport.
