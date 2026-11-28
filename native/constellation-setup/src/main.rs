#![cfg_attr(windows, windows_subsystem = "windows")]
use constellation_setup::{EMBEDDED_PAYLOAD, payload::Payload};
use std::io;

fn main() {
    if let Err(error) = run() {
        eprintln!("Constellation Setup: {error}");
        #[cfg(windows)]
        {
            if !std::env::args().any(|a| a == "--quiet") {
                constellation_setup::ui::message(&error.to_string(), true);
            }
        }
        std::process::exit(1);
    }
}

fn run() -> io::Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    #[cfg(windows)]
    if !args.is_empty() {
        unsafe {
            use windows::Win32::System::Console::{
                ATTACH_PARENT_PROCESS, AttachConsole, GetStdHandle, STD_OUTPUT_HANDLE,
            };
            // A GUI executable may already have a redirected output pipe.
            // Attaching the parent's console can replace it and silently lose
            // structured CLI output used by installers and diagnostics.
            if !GetStdHandle(STD_OUTPUT_HANDLE)
                .map(|handle| !handle.is_invalid())
                .unwrap_or(false)
            {
                let _ = AttachConsole(ATTACH_PARENT_PROCESS);
            }
        }
    }
    let command = args.first().map(String::as_str).unwrap_or("manage");
    if command == "--help" || command == "help" {
        println!(
            "Project Constellation Windows Setup\n\nDouble-click for the native setup window.\n\nCommands:\n  install [--dir ABSOLUTE_PATH] [--quiet]\n  manage [--dir ABSOLUTE_PATH]\n  doctor [--dir ABSOLUTE_PATH]\n  verify [--dir ABSOLUTE_PATH]\n  rollback [--dir ABSOLUTE_PATH] [--quiet]\n  uninstall [--dir ABSOLUTE_PATH] [--quiet]\n  payload-info\n\nEverything is installed for the current user; no administrator access is needed.\nThe browser still requires you to enable its sensor. Firefox's included sensor is unsigned and temporary.\nUninstall preserves data and restores only registrations still owned by this install."
        );
        return Ok(());
    }
    if command == "payload-info" {
        let payload = Payload::parse(EMBEDDED_PAYLOAD)?;
        println!(
            "{}",
            serde_json::to_string_pretty(
                &serde_json::json!({"sha256":payload.sha256,"manifest":payload.manifest})
            )?
        );
        return Ok(());
    }
    #[cfg(not(windows))]
    {
        let _ = args;
        Err(io::Error::other(
            "This is the Windows installer. Its transaction engine tests run on Linux; actual system integration requires Windows.",
        ))
    }
    #[cfg(windows)]
    {
        use constellation_setup::{engine, windows as host};
        let option = |name: &str| -> io::Result<Option<&str>> {
            if let Some(index) = args.iter().position(|a| a == name) {
                Ok(Some(
                    args.get(index + 1)
                        .filter(|v| !v.starts_with("--"))
                        .ok_or_else(|| io::Error::other(format!("{name} needs a value")))?,
                ))
            } else {
                Ok(None)
            }
        };
        for (index, arg) in args.iter().enumerate().skip(1) {
            if ["--dir", "--quiet", "--wait-parent"].contains(&arg.as_str()) {
                continue;
            }
            if index > 1 && ["--dir", "--wait-parent"].contains(&args[index - 1].as_str()) {
                continue;
            }
            return Err(io::Error::other(format!("Unknown argument: {arg}")));
        }
        let root = option("--dir")?
            .map(std::path::PathBuf::from)
            .map(Ok)
            .unwrap_or_else(host::default_root)?;
        let options = host::options(root.clone())?;
        if command == "manage" {
            return constellation_setup::ui::show(root);
        }
        if let Some(parent) = option("--wait-parent")? {
            if command != "uninstall" {
                return Err(io::Error::other(
                    "--wait-parent is only used by the uninstall helper.",
                ));
            }
            host::wait_for_parent(
                parent
                    .parse()
                    .map_err(|_| io::Error::other("Invalid parent process ID."))?,
            )?;
        }
        let quiet = args.iter().any(|a| a == "--quiet");
        let mut system = host::WindowsSystem::new()?;
        let mut healthy = true;
        let output = match command {
            "install" => serde_json::to_string_pretty(&engine::install(
                &options,
                &Payload::parse(EMBEDDED_PAYLOAD)?,
                &mut system,
            )?)?,
            "rollback" => serde_json::to_string_pretty(&engine::rollback(&options, &mut system)?)?,
            "uninstall" => {
                if host::detached_uninstall(&options, quiet)? {
                    return Ok(());
                }
                serde_json::to_string_pretty(&engine::uninstall(&options, &mut system)?)?
            }
            "doctor" | "verify" => {
                let report = if command == "doctor" {
                    host::doctor_report(&options)?
                } else {
                    engine::verify(&options)?
                };
                healthy = report["ok"] == true;
                serde_json::to_string_pretty(&report)?
            }
            _ => {
                return Err(io::Error::other(
                    "Unknown command. Run help for supported commands.",
                ));
            }
        };
        println!("{output}");
        if !quiet {
            constellation_setup::ui::message(&output, !healthy);
        }
        if !healthy {
            return Err(io::Error::other(
                "Installation checks failed. Review the diagnostic report and run Install / Repair.",
            ));
        }
        Ok(())
    }
}
