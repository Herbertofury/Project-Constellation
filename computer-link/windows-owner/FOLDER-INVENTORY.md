# Owner-selected local folder inventory (experimental)

The **Capture folder inventory locally** menu selects ONE folder through a native owner dialog, asks permission before enumeration, and previews the result before retaining it. Cancel, No, or a newer Disconnect generation discards that capture. It does not automatically create a session. A retained snapshot can use the existing separate **Allow selected read once** flow and connected-client approval. It is not a remote path API or a ChatGPT connection.

- One level, names and entry kinds only. File contents are never opened. Child directories and reparse entries are not followed.
- At most 64 entries and 4096 UTF-8 bytes, including JSON framing. Overflow, unreadable metadata, or non-Unicode names refuse the entire capture; no silent partial listing.
- Stable name sorting, JSON escaping (including directional formatting/control characters), schema `local-folder-inventory/v1`. Reparse entries are labeled `reparse-not-followed`, not treated as ordinary files.
- Only local fixed-drive scope admitted by the existing parent-handle policy; reparse scope/ancestors are refused. No persistence, watcher, recursive traversal, new network endpoint, write/delete authority, background service or autostart.
- The captured result is immutable after capture; its names/types can immediately become stale and confer no later access authority. No absolute directory path is included in the transmitted snapshot; the owner confirmation shows it locally.

## Explicit limitations

This is trusted/quiescent local filesystem behavior, NOT hostile filesystem confinement. Existing DOS-device, ACL, attribute/reparse mutation and same-user-process limitations remain. Enumeration is synchronous and can stall the UI: size bounds are not a latency/cancellation guarantee, and Disconnect/Exit cannot preempt blocked filesystem I/O. The OS shell picker can contact shell providers before local-path admission. It uses the legacy shell folder dialog with MAX_PATH path conversion; long/unrepresentable paths are refused. A modern IFileDialog and asynchronous bounded capture are future work, not implemented claims.

## Verification scope

Three platform-independent formatting/bounds/consent tests run on Linux. All owner targets compile-check for Windows MSVC. Windows fixture tests cover metadata-only capture, no recursion, immutable result, overflow, junction classification, junction scope/ancestor refusal, and native picker cancellation/no grant/Exit. These native tests are authored for source-only disposable Windows CI; their presence is not a claim that the runner has passed. Actual owner PC use, rendered preview readability, selecting a folder through the dialog and keeping/sharing it end-to-end, interrupted preview, hostile races, blocked I/O and access admission remain unverified.

Sources consulted:
- https://learn.microsoft.com/en-us/windows/win32/api/shlobj_core/nf-shlobj_core-shbrowseforfolderw
- https://learn.microsoft.com/en-us/windows/win32/api/shlobj_core/nf-shlobj_core-shgetpathfromidlistw
- https://doc.rust-lang.org/std/fs/struct.DirEntry.html#method.metadata
