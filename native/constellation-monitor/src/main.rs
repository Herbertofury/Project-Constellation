use constellation_monitor::{broker, install, platform};
use serde_json::json;
use std::io::{self, IsTerminal};

fn main() {
    if let Err(error) = run() {
        eprintln!("Constellation companion: {error}");
        std::process::exit(1);
    }
}

fn run() -> io::Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let first = args.first().map(String::as_str).unwrap_or("");
    // Browsers launch native hosts with their origin or manifest path. Those
    // arguments are metadata, never executable commands or file inputs.
    let native_launch = first.starts_with("chrome-extension://")
        || first.ends_with(".json")
        || (first.is_empty() && !io::stdin().is_terminal());
    let command = if native_launch { "native" } else { first };
    let option = |name: &str| -> io::Result<Option<&str>> {
        if let Some(index) = args.iter().position(|arg| arg == name) {
            Ok(Some(
                args.get(index + 1)
                    .filter(|s| !s.starts_with("--"))
                    .ok_or_else(|| io::Error::other(format!("{name} requires a value")))?
                    .as_str(),
            ))
        } else {
            Ok(None)
        }
    };
    let directory = platform::data_dir(option("--data-dir")?)?;
    match command {
        "native" => broker::native(&directory),
        "daemon" => broker::daemon(&directory),
        "doctor" => {
            println!(
                "{}",
                serde_json::to_string_pretty(&install::doctor(&directory))?
            );
            Ok(())
        }
        "discover" => {
            println!("{}", serde_json::to_string_pretty(&install::discover())?);
            Ok(())
        }
        "snapshot" => {
            println!(
                "{}",
                serde_json::to_string_pretty(&broker::admin_request(&directory, "snapshot")?)?
            );
            Ok(())
        }
        "stop" => {
            println!("{}", broker::admin_request(&directory, "shutdown")?);
            Ok(())
        }
        "install" | "manifest" => {
            let result = install::install(
                &directory,
                option("--browser")?.unwrap_or("all"),
                option("--chromium-id")?,
                option("--firefox-id")?,
                command == "manifest" || args.iter().any(|arg| arg == "--dry-run"),
            )?;
            println!("{}", serde_json::to_string_pretty(&result)?);
            Ok(())
        }
        "version" | "--version" => {
            println!(
                "{}",
                json!({"name":"constellation-monitor","version":env!("CARGO_PKG_VERSION"),"protocol":1})
            );
            Ok(())
        }
        "" | "help" | "--help" => {
            println!(
                "Project Constellation companion\n\nCommands:\n  install [--browser all|chrome|edge|opera_gx|firefox|chromium] [--dry-run]\n  manifest [--browser NAME]\n  doctor\n  discover\n  snapshot\n  stop\n  daemon\n  native\n\nOptions:\n  --data-dir PATH       Portable data directory (default beside the executable)\n  --chromium-id ID      Explicit allowed Chromium extension ID for install\n  --firefox-id ID       Explicit allowed Firefox extension ID for install\n\nRegistering the host never installs browser sensors or grants website permissions.\nRun install again after moving the portable folder. No administrator access required."
            );
            Ok(())
        }
        _ => Err(io::Error::other(
            "unknown command; run constellation-monitor help",
        )),
    }
}
