//! Test-only executable routing. Production binaries do not read this variable.
use std::{path::PathBuf, process::Command};

pub fn command(cargo_binary: &str) -> Command {
    match std::env::var_os("COMPUTER_LINK_TEST_INSTALLED_DIR") {
        None => Command::new(cargo_binary),
        Some(directory) => {
            let directory = PathBuf::from(directory);
            assert!(directory.is_absolute(), "installed test directory must be absolute");
            assert!(directory.is_dir(), "installed test directory is missing");
            let name = std::path::Path::new(cargo_binary).file_name().expect("Cargo binary filename");
            let installed = directory.join(name);
            assert!(installed.is_file(), "installed test executable missing; refusing build-tree fallback");
            eprintln!("test executable source: installed fixture");
            let mut command = Command::new(installed);
            command.current_dir(directory);
            command
        }
    }
}
