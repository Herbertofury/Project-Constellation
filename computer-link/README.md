# Project Constellation Computer Tools

Computer-Link is now an active component of Project Constellation. Its native
Windows owner, independent stdio MCP bridge, scoped workspace, export, inventory,
foreground selector and Job Object worker runtime build and install together.
The original Python diagnostics remain independently usable. No separate
Computer-Link repository checkout is needed for these commands.

## Run from Constellation

Open **Connections → Computer Tools** in the desktop to inspect native availability
and open the owner window. Its menus provide explicit local operations: selecting
a text snapshot, capturing window/folder inventories, opening an approved HTTPS
URL, previewing a new-file export, and choosing a window to bring forward.
Disconnect revokes the current local session and ends owned workers; Exit closes
the owner. Those local choices do not silently forward data into a provider chat.

Constellation Setup installs the native binaries together. On a source checkout:

```sh
node tools/computer-link/build.mjs --test
node tools/computer-link/run.mjs status
node tools/computer-link/run.mjs mcp-status
node tools/computer-link/run.mjs owner
```

Windows cross-build from a configured Linux Rust/MinGW toolchain:

```sh
node tools/computer-link/build.mjs --target x86_64-pc-windows-gnu
```

Output is `build/computer-link/windows-x64/`. All six executables must stay in the
same directory, particularly the owner and its fixed MCP sibling. The build does
not create grants, open a network listener, or install browser policies. Native
Windows UI/installation acceptance remains a separate Windows gate.

## Independent native commands

| Command | Implemented behavior | Authority and boundaries |
| --- | --- | --- |
| `run.mjs owner` | Native owner/tray and inventory, snapshot, export, HTTPS and focus UI | Local owner makes each operation/permission choice |
| `run.mjs mcp` | MCP initialization, tool discovery and `connection_status` | Status only, no files or desktop authority |
| `run.mjs mcp --snapshot PIPE OWNER_PID` | One attempt to read a captured snapshot through paired local IPC | Native owner approval; no path parameters; no automatic retry |
| `run.mjs workspace --new ABSOLUTE_NEW_DIR` | JSON-lines list/read/create-new/revoke in a new trusted local directory | Windows fixed-drive scope; no overwrite/delete; retained handles |
| `run.mjs focus` | Interactive console window selector and explicit foreground confirmation | Windows terminal required; no typing/clicking automation |
| `run.mjs client OWNER_PID PIPE status` | Separate local paired-client status call | Native owner reviews observed process identity |
| `run.mjs worker --program ABSOLUTE_EXE --workdir ABSOLUTE_DIR -- ARGS` | Creation-time Job Object containment and observed child/tree cleanup | Trusted explicit executable, minimal environment, no shell or inherited handles |
| `run.mjs diagnostics` | Legacy diagnostics registry and JSON-lines system summary | Optional Python 3.11+, no writes/network/desktop authority |
| `run.mjs diagnostics --workspace ABSOLUTE_DIR` | Selected-volume disk capacity | Does not return filenames or file contents |

For the bounded workspace process, send JSON objects such as
`{"op":"write_new","name":"notes.txt","text":"hello"}`,
`{"op":"read","name":"notes.txt"}`, `{"op":"list"}` and
`{"op":"revoke"}`. It preserves the original 4096-byte text and 100-entry
resource contracts, reports exceeded budgets explicitly, and never truncates a
result into a false success. Constellation's existing desktop file/process tools
remain available for broader authorized workflows.

The worker launcher has `--timeout-ms N`; it waits on the actual process handle
without a periodic polling loop, terminates only its own Job on timeout/completion,
and reports success only after its cleanup checks. It retains the upstream
private temporary directory for inspection. No output forwarding is claimed.

## What was migrated

The import combines the latest cumulative Windows implementation from
`review/windows-keyboard-focus` at `5a5798b41252a4027dfa97209d34819858752ec4`,
main diagnostics/governance at `4523fd6cb1ca65817b5bbca81fa2f5ee5411533b`,
and independent owned workers at `f55e056a7c0f20ce5e368b1cc82ddc7f2ea7b685`.
All 26 source branch heads and 92 reachable commits, plus the wiki's two commits,
are recoverable from verified complete Git bundles kept in private local recovery.
Automatic approval review blocked publication of the full-history archive, so
both bundles are excluded from public source and artifacts. Public checkout
verification instead fetches the recorded public refs into disposable temporary
Git state and enforces the same exact commit/tree/blob checks; it creates no
history archive. Durable migration of the complete history remains pending
specific approval and verification. Branch-specific workspace and
selection deltas are retained in the cumulative implementation. The separate
SSE NIF Optimizer build and fixture recipes are available under `utilities/`;
they are not a runtime dependency and their third-party binaries are not bundled.

See `../docs/COMPUTER-LINK-MIGRATION.md` for capability, dependency, branch and
acceptance mapping. `../recovery/computer-link/SOURCE-MANIFEST.json` records exact
upstream Git blob and SHA-256 identity for every imported source file.
`UPSTREAM-README.md` and the original module documents retain historical claims,
failures and limitations; they are history, not a claim of current release proof.

## Verification and remaining boundaries

The upstream tests are preserved. The integrated build runs the Python suite and
all six Rust crates, and Constellation has a separate real native status transcript
test and host adapter tests. Windows Job, GUI, pipe, filesystem, export and focus
tests require a real Windows machine; a cross-compiled executable alone does not
prove them. The native code continues to be for trusted, quiescent local paths and
owner-selected operations. Existing source limitations are not erased by merging.

The local MCP protocol is pinned to `2025-06-18`; the Python JSON-lines protocol
is independently available and is not labelled MCP. No custom ChatGPT/dot
connection, OAuth service, remote listener, account admission or remote snapshot
forwarding has been created. Constellation's own supported desktop/browser bridge
continues to own its existing client connection and permission model.

Source Computer-Link has not been deleted or modified remotely. Do not delete it
until the Constellation source, recoverable history, artifacts and native Windows
acceptance have been durably verified in the user's canonical destinations.
