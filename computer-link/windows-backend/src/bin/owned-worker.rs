//! Project Constellation local CLI for the preserved creation-time Job backend.
//! Explicit trusted executable only; no shell, inherited handles or credentials.
const USAGE: &str = "owned-worker --program ABSOLUTE_EXE --workdir ABSOLUTE_FOLDER [--timeout-ms N] -- [arguments...]\nRuns one trusted local executable in an owned Windows Job Object with a minimal environment. The local caller must authorize the executable. Child stdout/stdin are not forwarded. Descendants are terminated on completion, timeout or owner exit. No remote listener or persistent grant.";

#[cfg(windows)]
fn run() -> std::io::Result<i32> {
    use athena_owned_windows_workers::windows::Workers;
    use std::{io, path::PathBuf, time::Duration};
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut program = None;
    let mut workdir = None;
    let mut timeout = None;
    let mut index = 0;
    while index < args.len() && args[index] != "--" {
        if index + 1 >= args.len() { return Err(io::Error::other(USAGE)); }
        match args[index].as_str() {
            "--program" if program.is_none() => program = Some(PathBuf::from(&args[index + 1])),
            "--workdir" if workdir.is_none() => workdir = Some(PathBuf::from(&args[index + 1])),
            "--timeout-ms" if timeout.is_none() => {
                let ms: u32 = args[index + 1].parse().map_err(|_|io::Error::other("invalid timeout"))?;
                if ms == 0 || ms == u32::MAX { return Err(io::Error::other("timeout must be 1..4294967294 ms")); }
                timeout = Some(Duration::from_millis(ms as u64));
            },
            _ => return Err(io::Error::other(USAGE)),
        }
        index += 2;
    }
    if args.get(index).map(String::as_str) != Some("--") { return Err(io::Error::other(USAGE)); }
    let program = program.ok_or_else(||io::Error::other(USAGE))?;
    let workdir = workdir.ok_or_else(||io::Error::other(USAGE))?;
    let mut workers = Workers::new(&std::env::temp_dir())?;
    let child = workers.spawn(&program, &args[index + 1..], &workdir)?;
    let code = child.wait(timeout)?;
    // Observe Job shutdown before announcing success. No unrelated process is
    // enumerated or killed. The preserved private temp scope is not deleted.
    workers.exit()?;
    match code {
        Some(code) => {
            println!("{{\"pid\":{},\"exitCode\":{},\"ownedTreeStopped\":true,\"timedOut\":false}}", child.id, code);
            Ok(if code == 0 { 0 } else { 1 })
        },
        None => {
            println!("{{\"pid\":{},\"exitCode\":null,\"ownedTreeStopped\":true,\"timedOut\":true}}", child.id);
            Ok(124)
        },
    }
}

fn main() {
    if std::env::args().skip(1).eq(["--help"]) { println!("{USAGE}"); return; }
    #[cfg(windows)]
    match run() {
        Ok(code) => std::process::exit(code),
        Err(error) => { eprintln!("Owned worker refused: {error}"); std::process::exit(2); },
    }
    #[cfg(not(windows))]
    { eprintln!("Owned worker requires Windows; no host shell fallback."); std::process::exit(2); }
}
