# Agent Monitor handoff

Continue from canonical root and the current Git branch. Do not replay old
release carriers over this source. See docs/MONITOR-VERIFICATION.md for checks.

Implemented: attention service/background audio, native Rust browser hub,
responsive Agent Monitor, Firefox sensor, exact-tab routing, tests and packaging.

Outstanding acceptance must remain explicit: real target browser registration,
physical sound/OS notifications, signed Firefox distribution, signed-in account
round trips and final hosted CI outcomes. Never infer them from simulated sensors.

Do not re-enable permission auto-clicking. Cross-browser monitoring requires a
sensor in each browser/profile. Existing project features and historical release
evidence are retained. Stop the native broker with its `stop` command.


## Publication checkpoint

Automatic approval review rejected two public pushes. Do not retry publication
through another interface. Obtain explicit approval for the prepared
`upgrade/constellation-agent-monitor` branch on
`Herbertofury/Project-Constellation` after presenting the candidate artifacts.
No remote branch, PR, tag or release exists for this upgrade yet.

The Windows x64 hub is cross-built with Windows-system DLL imports. Native
host processes and the broker have real local transport tests; browser fixtures
have real Chromium rendering. The complete installed-extension browser cannot
start here because its Unix singleton socket is denied. Full verification is
not green until the installed-browser gates execute in a suitable environment.

The shared alert policy must remain hub-owned while connected: changing mute in
any connected profile must affect the elected output browser and survive owner
transfer. Standalone mode retains local preferences. Keep the actual final
source commit and artifact digests in the packaging receipt.
