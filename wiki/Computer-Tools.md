# Computer-Link → Project Constellation migration

## Result and provenance

Project Constellation 0.22.0 contains an active Computer Tools component, a native
Windows payload, command entrypoints and desktop integration. It retains the
Computer-Link source repository's independent diagnostics, Rust components,
tests, native ownership and permission boundaries. Existing Constellation file,
process, UI Automation, browser, saved-task and remote-device tools remain the
broader agent tool surface.

The authoritative source was `Herbertofury/Computer-Link` (GitHub repository ID
1457387896), inspected read-only on 2026-11-28. It has 26 branch heads, 92 reachable
commits, no tags and no GitHub releases. Nine historical pull requests are closed;
their recorded metadata and descriptions are preserved. The live wiki has two
commits and one Home page.

| Source | Exact commit | Integration |
| --- | --- | --- |
| `main` | `4523fd6cb1ca65817b5bbca81fa2f5ee5411533b` | Python diagnostics/tests and current governance |
| `review/windows-keyboard-focus` | `5a5798b41252a4027dfa97209d34819858752ec4` | Latest cumulative Windows owner, transport, workspace, local export and MCP source |
| `review/rust-owned-workers` | `f55e056a7c0f20ce5e368b1cc82ddc7f2ea7b685` | Independent creation-time Job Object worker backend, now with runnable `owned-worker` CLI |
| `review/windows-workspace` | `fa1d749ed6d65d29c8e04ae17e3bd36dfbb58b3e` | Workspace implementation incorporated in cumulative tree; unique integration note retained |
| `build/sse-nif-optimizer-3.2.2` | `4bf4c7b4bbc0f83ea04608a573e59032c25b28b3` | Independent pinned optimizer build recipe under `computer-link/utilities/sse-nif-build` |
| `test/sse-nif-3.2.2-fixtures` | `272aa60053b31fd14337b2135a73851e4abbdc32` | Independent mesh conversion verifier and fixture tooling under `computer-link/utilities/sse-nif-fixtures` |
| Wiki `master` | `127117242908f78111dee2b7afe7772d575e6698` | Exact page mirror; complete wiki history preserved privately |

All branch heads and per-branch file trees are listed in
`recovery/computer-link/SOURCE-MANIFEST.json`. Complete Git bundles preserve the
original authors, commit graph, messages, source and prior failures **in private
local recovery only**. Automatic approval review rejected publication of the
full-history archive. Both `.bundle` files are excluded from public source and
release artifacts; this migration does not re-encode or upload their bytes by
another route. Durable publication of the complete original history remains
pending specific approval and verification.

`node tools/computer-link/verify-import.mjs` checks private bundles when present.
A public checkout instead fetches the recorded public branch heads and wiki into
an automatically removed temporary bare repository. Both routes enforce the same
exact commit/tree identities, reachable commit counts, original source path/blob
and byte identities, and Git object integrity checks. `--source upstream` requires
the public fetch route; `--source bundles --bundle-dir ABSOLUTE_DIR` verifies a
separately supplied private recovery copy. Fetching validates upstream history;
it neither publishes it nor makes Constellation independent of upstream history
availability. Missing, changed or inaccessible recorded refs fail verification.

The source repository has not been deleted. Hosted Actions logs, expired build
artifacts, pull-request discussion threads and private machine state are not
claimed as exported. The source/history checkpoint and native acceptance must be
durably verified before retiring the original repository.

## Complete capability map

| Computer-Link capability | Active Constellation location and route | Relation to existing Constellation tools |
| --- | --- | --- |
| Independent capability registry; adapter registration/removal; read-only effect enforcement | `computer-link/computer_link`; `run.mjs diagnostics` | Preserved optional Python source adapter; does not become a dependency of monitoring |
| OS/architecture/runtime summary without account, host or path disclosure | `system.summary` in diagnostics JSON-lines | Existing `get_system_info` remains the fuller desktop diagnostic |
| Explicitly selected volume disk capacity with user-available semantics | `workspace.disk`; `run.mjs diagnostics --workspace ABSOLUTE_DIR` | No file listing/content is returned by this capability |
| Bounded JSON-lines recovery, duplicate-member refusal, invalid UTF-8 recovery, bad optional adapter isolation | Original Python implementation and all 23 tests | Legacy protocol remains independently executable and is not mislabeled as MCP |
| Local MCP initialization/discovery/status with bounded frames and lifecycle | `computer-link/mcp-session`; `run.mjs mcp`; desktop read-only status probe | Actual native process is exercised; status checks do not start the owner or grant access |
| One-shot owner-selected immutable snapshot read | `windows-owner`, `windows-transport`, `mcp-session --owner-approved-snapshot PIPE OWNER_PID` | Requires initial local selection/grant and separate connecting-client confirmation; not automatically forwarded into a provider chat |
| Same-user named-pipe pairing with process pinning, expiry and revoke | `computer-link/windows-transport` | Retains one-use bearer IPC and existing trusted-local threat model; no public listener or bearer on command line |
| Text snapshot selection and file identity/size checks | Native Computer Tools → Choose text file | Existing desktop `read_file` continues to serve broader scoped file workflows |
| Visible top-level window inventory | Native Computer Tools → Capture window inventory locally | Can be reviewed as a captured snapshot; existing `computer_windows` remains the general desktop tool |
| Owner-selected folder inventory | Native Computer Tools → Capture folder inventory locally | Existing `list_directory` remains the broad scoped filesystem tool |
| Exact HTTPS browser handoff | Native Computer Tools → Open selected HTTPS link locally | Explicit exact-link confirmation; does not confer browser control or sign-in permission |
| New-file text export with complete escaped preview, per-operation consent and no replace | `computer-link/local-export` wired into native owner → Export selected text as new local file | Preserves retained directory handles, stage/write/sync/no-replace publication, retained failed stages and uncertainty reporting |
| Interactive local status session and owner-contained MCP child | Native Computer Tools → Start local status session / Check local status | Event-driven child completion; no repeated polling; Disconnect/Exit ends owned workers |
| Chosen-window foreground transition with actual readback and keyboard review | Native owner → Bring a window forward locally; independent `run.mjs focus` | Preserves Cancel-default review and does not add typing or automatic button approval |
| Independent bounded new workspace list/read/create/revoke | `computer-link/windows-workspace`; `run.mjs workspace --new ABSOLUTE_NEW_DIR` | Existing desktop file tools remain available for broader scopes; this narrow mode keeps its original contracts |
| Job-owned children, minimal environment, creation-time membership and scoped observed Exit | `computer-link/windows-backend`; installed `owned-worker` and `run.mjs worker` | Now callable from Constellation instead of retained as an unused library; no shell or inherited handles; no unrelated PID lookup |
| Local native setup scripts and acceptance fixtures | Original `windows-owner/setup` retained; unified Constellation Setup installs the payload | Original setup history is retained; current installer owns per-user versioned install/discovery/uninstall |
| Offline HTTP/principal binding validation contracts | `computer-link/mcp-session/src/http_gate.rs` and `binding.rs`, with tests | Library contracts only; no authentication service or network listener was invented |
| Current MCP SDK/alternative tool research and client-admission gates | `computer-link/docs` and original wiki mirror | Preserved research is not presented as a deployed integration |
| Pinned SSE NIF Optimizer build, native GUI/CLI smoke and mesh conversion verification recipe | `computer-link/utilities` | Independently usable optional developer utility; upstream binary/source/license obligations retained; no game assets or optimizer binary installed implicitly |

The cumulative Windows branch includes `windows-transport`, `windows-inventory`,
`windows-setup`, `windows-local-export`, `windows-local-export-ui`,
`windows-integrated-setup`, `windows-local-focus`, `windows-owned-focus`,
`windows-owned-focus-installed`, `windows-status-revocation` and
`windows-keyboard-focus`. The divergent `windows-selection` and
`windows-workspace` Rust functions/tests have no unique function missing from the
active combined tree; the separate workspace integration note was copied too.
Diagnostic fix branches are represented by the later hardened main implementation
and the privately preserved original commit objects. Historical variations are
verified through those private bundles or the exact recorded public refs.

## Integration contracts

`desktop/src/computer-link.mjs` provides:

- `getComputerLinkStatus()` for installed/available capabilities and owned process state;
- `getComputerLinkMcpStatus()` for one real, bounded, status-only native MCP exchange;
- `launchComputerLinkOwner({ ownerInitiated: true })` for the trusted local shell UI;
- `stopComputerLinkOwner()` for only the process created by that adapter;
- `subscribeComputerLink(listener)` for start/exit/error notifications without polling.

An untrusted agent request cannot choose an executable path or open an owner
grant through the read-only status calls. Host-only binary-directory overrides
exist for packaging and tests. Standard installed discovery reads the per-user
Constellation receipt, validates product/schema and the single version path,
rejects link/reparse aliases, and verifies executable byte count and SHA-256
against the active release entry. Electron resource and explicit portable package
roots are also supported.

The MCP status adapter sends exactly initialization, readiness, tool discovery and
the read-only `connection_status` call. It accepts exactly three correlated
replies, caps total stdout/stderr at 64 KiB, applies a five-second deadline, and
kills/observes only its own child on failure. It never supplies a snapshot pipe,
workspace, host endpoint or owner grant. Missing, malformed, hung or unsupported
components remain explicitly unavailable/unverified.

Owner lifecycle events update the desktop without periodic probes. Owner stop
uses the process handle created by this module and waits for exit; a failed stop
retains the running process and reports unconfirmed cleanup. Its existing native
Job objects own their descendants. This does not terminate another same-named
process, an unrelated browser, or an independently launched Computer Tools UI.

## Source and dependency preservation

123 upstream files were imported with Git blob/SHA-256 identity. Original source
tests and original per-crate Cargo.lock files remain present. Seven documented
source deltas introduce the integrated README, Constellation native owner captions
with corresponding exact-caption fixtures, and an event-driven `Process.wait`
method. The runnable worker CLI, adapter, launcher/build tools and integration
tests are new files. `INTEGRATION-DELTAS.json` records their relationship to the
unchanged upstream objects.

The Python module uses Python 3.11+ and standard library only. Native crates use
Rust edition 2024 with locked serde/serde_json dependencies or no dependencies.
Windows calls are native FFI to operating-system APIs. The built Windows payload
has six executable files and imports Windows system DLLs only; no separate MinGW
DLL is required by the inspected PE import tables. Native builds carry the exact
dependency license texts, Rust library notices and applicable GNU/MinGW notices.
The upstream repository contains no top-level LICENSE; migration under the
owner's explicit instruction does not silently relicense it as MIT.

All 283 unique historical Git blobs, totaling 1,763,168 bytes, were inspected by a
bounded common credential/private-key pattern scan. It found no matches. Tracked
file inventory contained no browser profiles or private machine configuration.
Synthetic authorization/token fixtures remain intact. This is source hygiene
evidence, not a claim that arbitrary secrets can always be recognized.

## Verification and honest acceptance status

Commands from the Constellation root:

```sh
node tools/computer-link/verify-import.mjs
node tools/computer-link/verify-import.mjs --source upstream
node tools/computer-link/build.mjs --test
node --test desktop/tests/computer-link.test.mjs
node tools/computer-link/run.mjs mcp-status
node tools/computer-link/build.mjs --target x86_64-pc-windows-gnu
```

Observed in this integration: all 123 source-file identities recover correctly,
all 26 branch trees restore, both Git bundles verify as complete, 23 Python tests,
46 Linux Rust tests and ten Node adapter tests pass. These recovery assertions
also run through the public-fetch route without distributing a history archive.
The actual Linux Rust MCP
executable completes the Constellation status exchange. All six Windows binaries
build/link, and the Windows test targets of all six original Rust crates compile
and link. Windows binaries were not executed in this Linux session.

Desktop validation passes all 22 task tests, 81 combined boundary/adapter/process
tests and the full remaining smoke suite, with the Windows computer-use check
explicitly skipped on Linux. A real isolated Chromium renderer passes 27 desktop
and chat workflows, including an actual Rust MCP status exchange, real file and
process operations, and native-card failure/retry states. Windows owner UI states
in that renderer are labeled fixtures; they do not replace native Windows proof.
The desktop adapter checks trusted IPC, late permission revocation, launch/stop
ordering and quit cleanup. Managed process Stop waits for observed exit and
output drain; failed cleanup keeps the application open instead of claiming
termination. The standalone MCP CLI now also stops its owned process tree and
drains task/search/audit work before closing. Actual parent/descendant processes
were checked after MCP shutdown and POSIX SIGTERM; Windows forced termination is
not represented as a catchable POSIX signal. Windows packaging validates all six binaries before and after the
resource copy, then the Windows gate probes the bundled MCP executable from a
freshly extracted portable Electron app.

Original Windows GUI/pipe/filesystem/worker/export/focus tests remain the native
acceptance gate. The new worker CLI has Windows tests for successful contained
execution and timeout cleanup. A passing cross-build does not prove Windows UI,
native file publication, installer launch, tray behavior, accessibility or client
admission. Historical upstream failed and successful runs remain documented;
they are not substituted for acceptance of this integrated source.

The mandatory optimization review preserves native implementations, dependency
locks, source content and tests. It adds an event-driven owned-process wait rather
than introducing a permanent polling loop. No unmeasured latency or memory
speedup is claimed. Independent unrelated optimizer recipes are retained as
utilities and are not applied to product binaries without equivalent-work proof.
