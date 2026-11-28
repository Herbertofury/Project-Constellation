#![cfg(windows)]
use std::{path::Path, process::Command};

#[test]
fn cli_runs_owned_fixture_and_confirms_cleanup() {
    let fixture = Path::new(env!("CARGO_BIN_EXE_job-fixture"));
    let result = Command::new(env!("CARGO_BIN_EXE_owned-worker"))
        .arg("--program").arg(fixture).arg("--workdir").arg(std::env::temp_dir())
        .args(["--timeout-ms", "5000", "--", "--check-minimal-environment"])
        .output().unwrap();
    assert!(result.status.success(), "{}", String::from_utf8_lossy(&result.stderr));
    let result = String::from_utf8(result.stdout).unwrap();
    assert!(result.contains("\"exitCode\":0"));
    assert!(result.contains("\"ownedTreeStopped\":true"));
    assert!(result.contains("\"timedOut\":false"));
}

#[test]
fn cli_timeout_ends_only_its_owned_job() {
    let result = Command::new(env!("CARGO_BIN_EXE_owned-worker"))
        .arg("--program").arg(env!("CARGO_BIN_EXE_job-fixture"))
        .arg("--workdir").arg(std::env::temp_dir())
        .args(["--timeout-ms", "50", "--", "--sleep"]).output().unwrap();
    assert_eq!(result.status.code(), Some(124));
    let result = String::from_utf8(result.stdout).unwrap();
    assert!(result.contains("\"ownedTreeStopped\":true"));
    assert!(result.contains("\"timedOut\":true"));
}
