# Project Constellation: computer-link verification candidate

This is a desktop bridge status and evidence repair on the exact 0.20.1 source tree (89b711f46672830e786ba3afcdf0d1973325a896), not a reconstruction of the incomplete 0.20.2 staging release. The candidate retains the base app version, permissions, and profile layout. Test a new candidate copy before replacing a working install.

- An acknowledged local tool error now reports failure, not a verified bridge.
- A ping requires a positive pong. A visible tool-wrapper leak and an older unproven retry do not count as verification.
- A saved result retains its success evidence for retry; retry still does not reexecute the operation.
- The packaged Electron smoke requires a successful, non-leaking ping receipt in addition to the native shell proof.
- This does not change access selections, auto-grant new permission, or configure a relay.

Run `npm run check` and `npm test` in `desktop/`. The Electron/native fixture is an owned test endpoint, not a live signed-in ChatGPT test. On Windows, run the existing Windows-native smoke and `desktop/scripts/electron-smoke.ps1` before promoting a build.

Live acceptance remains separate: launch the candidate on the intended Windows machine, open a signed-in ChatGPT conversation inside Constellation, open **Connect > Test chat access**, and verify a completed ping receipt. In a user-selected disposable folder, request a test file write and read back the contents. Confirm that Off and Emergency Lock prevent actions, and that pending results stay in their originating conversation. This tests the app's integrated route, not a live attachment to a separate Dot chat.
