# Computer Tools source and dependency notices

Computer Tools brings the owner's `Herbertofury/Computer-Link` sources into Project
Constellation under the user's explicit migration instruction. Computer-Link did
not contain a top-level LICENSE file at any inspected branch. This migration does
not invent a license or claim that its original code was MIT licensed. Original
authors, commit objects, branch heads, dependency locks and documentation remain
in `recovery/computer-link/SOURCE-MANIFEST.json` and the complete Git bundles.

Native binary dependencies are pinned by each preserved Cargo.lock. The imported
runtime uses Rust's standard library and `serde`, `serde_core`, `serde_json`,
`itoa`, `memchr` and `zmij`; their original package notices are retained alongside
the build's dependency license receipt. Optional derive/build dependencies include
`serde_derive`, `proc-macro2`, `quote`, `syn` and `unicode-ident`. Their licenses are
not replaced by Project Constellation's license.

The isolated `utilities/sse-nif-build` and `utilities/sse-nif-fixtures` directories
preserve the repository's separately pinned SSE NIF Optimizer build and mesh-test
recipes. Those recipes refer to GPLv3 SSE NIF Optimizer, its nifly submodule, and
wxWidgets under its own license. No optimizer binary, mesh, game asset, or bundled
third-party source is silently installed by Constellation Setup. Running that
optional recipe retrieves its pinned upstream sources and preserves corresponding
source/license delivery as originally required. This utility is unrelated to the
agent monitor runtime and remains independently usable.

No credentials, browser profiles, private workspace data or installed-machine
configuration were imported. Source test values are synthetic fixtures. Product
permission and lifecycle boundaries remain active after migration.
