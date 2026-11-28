# Computer-Link local text export candidate

Backlog scope: owner-selected local write/edit capability; preserve originals and
require exact per-operation consent. This candidate implements **export as a new
file**, not replacing an original. It is not wired to the tray UI, MCP, a listener,
the installer, or the owner's PC. No executable or public release is produced.

## Implemented boundary

* At most 4096 UTF-8 bytes, one ordinary ASCII leaf, immutable escaped preview.
* `LocalExport::selected_local_directory` requires an explicitly owner-selected
  existing ordinary fixed-drive NTFS directory. Ancestor and directory handles
  remain held, rejecting reparse objects and normal rename/delete sharing.
* Preview binds the retained directory, filename and bytes. Exact confirmation is
  consumed once, including failures; Deny has no disk effects.
* Revoke and owner drop invalidate old previews. Revoke serializes with an already
  admitted operation; it is **not** cancellation of blocking filesystem I/O.
* Create `<name>.pending` by `NtCreateFile` relative to the retained directory,
  FILE_CREATE, no sharing, FILE_OPEN_REPARSE_POINT, non-directory. Existing stage
  objects are never opened. Write and sync the exact retained file handle.
* Publish by native `NtSetInformationFile(FileRenameInformation)` with NULL root
  and a simple leaf: documented same-parent rename of the retained source handle,
  ReplaceIfExists FALSE. No second path open or process-CWD target resolution.
* Any failed stage is retained for explicit owner review. No automatic cleanup,
  retry, deleting, replacing, executing, remote transfer, or persistent grant.
* This is namespace publication after complete write, **not** crash/power-loss
  durability. Staging filenames are visible. ACLs inherit from the destination.

## Holds and remaining gates

This is not a general secure file server or an arbitrary editing API. The revised
native backend has cross-compiled but **has not run on Windows**. Earlier Win32
backend tests ran and failed publication; see results below. Exact Windows NTFS
rename and sharing behavior must pass native tests before owner UI wiring. The
inherited initial directory admission uses sequential Win32 paths, not complete
handle-relative traversal; hostile DOS-device remapping, kernel/admin interference,
and same-user attribute/ACL/reparse mutation are not proven safe. Only trusted,
quiescent local roots are in scope. Do not expose the API to untrusted callers.
An exact immutable preview API is not itself a real user-consent UI: caller
integration must show the selected root and complete escaped content and request
fresh local consent. No claim that boolean `true` authenticates an owner.

Backlog still open: independent security review, native synthetic tests (including
reparse/ancestor attacks and partial-I/O/power-loss evidence), accessible native
preview/consent UI, off-UI operation and cancellation semantics, dot admission.
Existing `windows-workspace` joined-path write is not reused or promoted.

## Evidence

Cloud `cargo test`: 6 state/validation tests passed. MSVC `cargo check --all-targets`:
passed. Authored Windows cases: publish exact bytes, no-overwrite/retained stages,
Deny/revoke no effects, root rename denial, drop revocation, destination hardlink,
destination appearing at publication, preexisting staging hardlink; unexecuted.
These initial authoring notes preceded the native runs described below.
Cleanup in tests applies only to unique synthetic temp fixtures, never product data.

Official API references consulted 2026-11-20:
- https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntcreatefile
- https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_rename_info
- https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-setfileinformationbyhandle

Run: `cargo test`; on disposable Windows NTFS runner `cargo test -- --test-threads=1`.
No network, dependencies, credentials, services or artifacts required.

## Expanded native acceptance candidate

Additional Windows tests exercise stage/destination directory junction refusal,
selected reparse root/ancestor refusal, pinned ancestor rename and incompatible
writer refusal, injected partial-write/sync failures, one/80-character names and
final exclusive-handle release. Injected failures are test seams, not an actual
hardware fault or power-loss test. Fixture junction creation uses Windows mklink
only within unique generated disposable directories, refuses shell metacharacters,
and requires success (no skipped reparse cases). Results below supersede the
initial unexecuted status of these fixtures.

## Native evidence and revised backend status

Win32 source8c66ca0: run44694666726 executed18 tests,16 passed and2 happy-path
publication cases failed (errors87 and24). Full-buffer source d5e779e:
run44695029154 again16 passed and2 failed (both error87). No-replace negative
tests alone are not proof when all rename attempts fail. Both runs produced no
artifacts and no owner installation. Failed runs remain part of the record.

This revised candidate instead uses the documented native same-parent form.
ABI comparison with Microsoft's official WinBase.h blob
b27c338c070353981b59fe3979a5af068fc99c00 found matching offsets, not an ABI bug.
Compile-time gates now restrict to x86_64 Windows and check field offsets/sizes.
A subprocess fixture changes only its own CWD to a different synthetic folder
and checks that publication stays in the selected source parent. The ignored
worker fixture is invoked explicitly by the normal parent test.

Revised candidate:6 Linux state tests and Windows MSVC all-target compilation
passed; **native runtime not yet run**, so publication is not confirmed fixed.
No UI/installer/MCP integration. All trusted/quiescent-root constraints remain.

Native contract references:
- https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/content/ntifs/nf-ntifs-ntsetinformationfile
- https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/ns-ntifs-_file_rename_information
- https://github.com/microsoft/win32metadata/blob/main/generation/WinSDK/RecompiledIdlHeaders/um/WinBase.h
