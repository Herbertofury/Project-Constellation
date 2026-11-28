# Rust owned-worker Windows acceptance candidate

Experimental independent Windows10+ Job Object worker lifecycle crate. Creation-time job membership, kill-on-close, explicit scoped Exit, bounded shutdown observation, explicit minimal environment and separate worker temp directory. No inherited handles, shell, elevation, service, endpoint or autostart. Not a security sandbox; caller must authorize trusted executables and quiescent paths.

Tests exercise disposable helper/grandchild cleanup, unrelated helper survival, explicit new-session restart, Drop cleanup and minimal environment. Run `cargo test --locked --manifest-path windows-backend/Cargo.toml --test windows_acceptance -- --nocapture --test-threads=1`. Linux cross-link succeeded; Windows runtime results must be checked on the exact CI commit. No installer, desktop/browser control, filesystem mutation API, recycle implementation, pairing or dot integration is supplied.

Supervisor crash/failure injection, nested-job behavior, tray lifecycle, browser-native shim authority, real Recycle Bin restore and direct client admission remain open. Drop is best-effort; confirmed explicit Exit requires observed zero active workers. Temporary folders are preserved, not recursively deleted. No performance advantage claimed.

API references: https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects and https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute .

## Windows CI correction
The first Windows Server 2025 run (44633974930, commit6d7be6) compiled and executed three tests: two passed; explicit descendant Exit failed because job active-count zero preceded direct-child handle signaling. Exit now retains owned process handles and requires all direct children signaled plus job active-count zero within the existing deadline. The original assertion remains; added dropped-caller-handle coverage. Check the latest exact-commit CI result before treating these tests as passed. No broader installer/client readiness follows.
