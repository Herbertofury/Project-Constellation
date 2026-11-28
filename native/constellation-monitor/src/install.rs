use crate::{
    CHROMIUM_ID, FIREFOX_ID, HOST_NAME, broker, platform,
    state::{BROWSERS, Store},
    wire,
};
use serde_json::{Value, json};
#[cfg(unix)]
use std::fs;
use std::{
    io,
    path::{Path, PathBuf},
};

pub fn host_manifest(
    browser: &str,
    executable: &Path,
    chromium_id: &str,
    firefox_id: &str,
) -> io::Result<Value> {
    if !BROWSERS.contains(&browser) {
        return Err(io::Error::other("unknown browser"));
    }
    if chromium_id.len() != 32 || !chromium_id.bytes().all(|b| (b'a'..=b'p').contains(&b)) {
        return Err(io::Error::other(
            "Chromium extension ID must contain 32 letters a-p",
        ));
    }
    if firefox_id.is_empty()
        || firefox_id.len() > 100
        || !firefox_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"@._-{}".contains(&b))
    {
        return Err(io::Error::other("invalid Firefox extension ID"));
    }
    let mut manifest = json!({"name":HOST_NAME,"description":"Project Constellation local agent monitor",
        "path":executable,"type":"stdio"});
    if browser == "firefox" {
        manifest["allowed_extensions"] = json!([firefox_id]);
    } else {
        manifest["allowed_origins"] = json!([format!("chrome-extension://{chromium_id}/")]);
    }
    Ok(manifest)
}

pub fn windows_registry_key(browser: &str) -> io::Result<String> {
    let vendor = match browser {
        "chrome" | "opera_gx" => r"Google\Chrome",
        "edge" => r"Microsoft\Edge",
        "firefox" => "Mozilla",
        "chromium" => "Chromium",
        _ => return Err(io::Error::other("unknown browser")),
    };
    Ok(format!(
        r"HKCU\Software\{vendor}\NativeMessagingHosts\{HOST_NAME}"
    ))
}

pub fn user_manifest_paths(browser: &str, home: &Path, config: &Path) -> io::Result<Vec<PathBuf>> {
    let file = format!("{HOST_NAME}.json");
    let dirs = match browser {
        "chrome" => vec![config.join("google-chrome/NativeMessagingHosts")],
        "edge" => vec![config.join("microsoft-edge/NativeMessagingHosts")],
        "chromium" => vec![config.join("chromium/NativeMessagingHosts")],
        "firefox" => vec![home.join(".mozilla/native-messaging-hosts")],
        // Opera's published documentation uses Chrome's host lookup. Include
        // profile-local locations for installations that use those instead.
        "opera_gx" => vec![
            config.join("google-chrome/NativeMessagingHosts"),
            config.join("opera/NativeMessagingHosts"),
            config.join("opera-gx/NativeMessagingHosts"),
        ],
        _ => return Err(io::Error::other("unknown browser")),
    };
    Ok(dirs.into_iter().map(|path| path.join(&file)).collect())
}

#[cfg(unix)]
fn home_directory() -> io::Result<PathBuf> {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
        .map(PathBuf::from)
        .ok_or_else(|| io::Error::other("user home directory unavailable"))
}
#[cfg(unix)]
fn config_directory(home: &Path) -> PathBuf {
    std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".config"))
}

pub fn install(
    directory: &Path,
    browser: &str,
    chromium_id: Option<&str>,
    firefox_id: Option<&str>,
    dry_run: bool,
) -> io::Result<Value> {
    let browsers = if browser == "all" {
        BROWSERS.to_vec()
    } else {
        vec![browser]
    };
    let executable = std::env::current_exe()?.canonicalize()?;
    #[cfg(unix)]
    let home = home_directory()?;
    #[cfg(all(unix, not(target_os = "macos")))]
    let config = config_directory(&home);
    let mut registrations = Vec::new();
    if !dry_run {
        platform::secure_directory(directory)?;
    }
    for browser in browsers {
        let manifest = host_manifest(
            browser,
            &executable,
            chromium_id.unwrap_or(CHROMIUM_ID),
            firefox_id.unwrap_or(FIREFOX_ID),
        )?;
        let source = directory.join(format!("{browser}-host.json"));
        if !dry_run {
            platform::atomic_write(&source, &serde_json::to_vec_pretty(&manifest)?)?;
        }
        #[cfg(windows)]
        {
            let key = windows_registry_key(browser)?;
            if !dry_run {
                let output = std::process::Command::new("reg.exe")
                    .args(["ADD", &key, "/ve", "/t", "REG_SZ", "/d"])
                    .arg(&source)
                    .arg("/f")
                    .output()?;
                if !output.status.success() {
                    return Err(io::Error::other(format!(
                        "native host registration failed for {browser}"
                    )));
                }
            }
            registrations.push(json!({"browser":browser,"registryKey":key,"manifestPath":source,"manifest":manifest,
                "scope":"current_user","sensorInstalled":false}));
        }
        #[cfg(all(unix, not(target_os = "macos")))]
        {
            let paths = user_manifest_paths(browser, &home, &config)?;
            for target in &paths {
                if !dry_run {
                    let parent = target
                        .parent()
                        .ok_or_else(|| io::Error::other("invalid manifest path"))?;
                    fs::create_dir_all(parent)?;
                    platform::atomic_write(target, &serde_json::to_vec_pretty(&manifest)?)?;
                }
            }
            registrations.push(
                json!({"browser":browser,"manifestPaths":paths,"manifest":manifest,
                "scope":"current_user","sensorInstalled":false}),
            );
        }
        #[cfg(target_os = "macos")]
        {
            let vendor = match browser {
                "chrome" | "opera_gx" => "Google/Chrome",
                "edge" => "Microsoft Edge",
                "firefox" => "Mozilla",
                "chromium" => "Chromium",
                _ => unreachable!(),
            };
            let target = home
                .join("Library/Application Support")
                .join(vendor)
                .join("NativeMessagingHosts")
                .join(format!("{HOST_NAME}.json"));
            if !dry_run {
                fs::create_dir_all(target.parent().unwrap())?;
                platform::atomic_write(&target, &serde_json::to_vec_pretty(&manifest)?)?;
            }
            registrations.push(json!({"browser":browser,"manifestPath":target,"manifest":manifest,"scope":"current_user","sensorInstalled":false}));
        }
    }
    if !dry_run {
        // The browser cannot pass custom CLI flags in a native host manifest.
        // Store only the data path next to this executable; no credentials.
        let parent = executable
            .parent()
            .ok_or_else(|| io::Error::other("missing executable directory"))?;
        let saved_path = directory.strip_prefix(parent).unwrap_or(directory);
        platform::atomic_write(
            &parent.join("constellation-monitor.config.json"),
            &serde_json::to_vec_pretty(&json!({"dataDir":saved_path}))?,
        )?;
    }
    Ok(
        json!({"ok":true,"dryRun":dry_run,"executable":executable,"dataDirectory":directory,
        "registrations":registrations,"note":"Host registration does not install browser sensors. Enable the sensor in each browser/profile. Re-run install after moving the portable folder.",
        "operaGxValidation":"Requires a real Opera GX native-messaging smoke test on the destination machine"}),
    )
}

pub fn discover() -> Value {
    #[cfg(unix)]
    let home = home_directory().unwrap_or_default();
    #[cfg(unix)]
    let config = config_directory(&home);
    let mut results = Vec::new();
    for browser in BROWSERS {
        let mut candidates: Vec<PathBuf> = Vec::new();
        #[cfg(windows)]
        {
            let local = std::env::var_os("LOCALAPPDATA")
                .map(PathBuf::from)
                .unwrap_or_default();
            let roaming = std::env::var_os("APPDATA")
                .map(PathBuf::from)
                .unwrap_or_default();
            let programs = std::env::var_os("PROGRAMFILES")
                .map(PathBuf::from)
                .unwrap_or_default();
            let programs_x86 = std::env::var_os("PROGRAMFILES(X86)")
                .map(PathBuf::from)
                .unwrap_or_default();
            let relative = match *browser {
                "chrome" => "Google/Chrome/Application/chrome.exe",
                "edge" => "Microsoft/Edge/Application/msedge.exe",
                "firefox" => "Mozilla Firefox/firefox.exe",
                "chromium" => "Chromium/Application/chrome.exe",
                "opera_gx" => "Programs/Opera GX/launcher.exe",
                _ => "",
            };
            candidates.extend([
                local.join(relative),
                programs.join(relative),
                programs_x86.join(relative),
            ]);
            if *browser == "opera_gx" {
                candidates.extend([
                    local.join("Programs/Opera GX/opera.exe"),
                    roaming.join("Opera Software/Opera GX Stable"),
                ]);
            }
        }
        #[cfg(unix)]
        {
            let names: &[&str] = match *browser {
                "chrome" => &["google-chrome", "google-chrome-stable"],
                "edge" => &["microsoft-edge", "microsoft-edge-stable"],
                "firefox" => &["firefox"],
                "chromium" => &["chromium", "chromium-browser"],
                "opera_gx" => &["opera", "opera-gx"],
                _ => &[],
            };
            for name in names {
                for root in ["/usr/bin", "/usr/local/bin", "/snap/bin"] {
                    candidates.push(Path::new(root).join(name));
                }
            }
        }
        let found: Vec<PathBuf> = candidates
            .into_iter()
            .filter(|path| path.exists())
            .collect();
        let mut registration_found = false;
        #[cfg(windows)]
        {
            if let Ok(key) = windows_registry_key(browser) {
                registration_found = std::process::Command::new("reg.exe")
                    .args(["QUERY", &key, "/ve"])
                    .output()
                    .is_ok_and(|o| o.status.success());
            }
        }
        #[cfg(unix)]
        {
            if let Ok(paths) = user_manifest_paths(browser, &home, &config) {
                registration_found = paths.iter().any(|p| p.is_file());
            }
        }
        results.push(json!({"browser":browser,"detected":!found.is_empty(),"evidencePaths":found,
            "hostRegistered":registration_found,"connected":false,
            "coverage":"unconfirmed_until_sensor_hello","detection":"best_effort_standard_locations"}));
    }
    json!({"browsers":results,"note":"Detected binaries or profile folders do not prove a running browser, installed sensor, or monitored tabs."})
}

pub fn doctor(directory: &Path) -> Value {
    let broker = broker::admin_request(directory, "snapshot");
    let mut discovery = discover();
    if let Ok(snapshot) = &broker
        && let (Some(browsers), Some(clients)) = (
            discovery["browsers"].as_array_mut(),
            snapshot["data"]["clients"].as_array(),
        )
    {
        for browser in browsers {
            browser["connected"] = json!(clients.iter().any(|client| client["browser"]
                == browser["browser"]
                && client["connected"] == true));
            if browser["connected"] == true {
                browser["coverage"] = json!("sensor_connected");
            }
        }
    }
    let persisted = match platform::read_private(&directory.join("state.json"), wire::MAX_FRAME) {
        Ok(bytes) => match serde_json::from_slice::<Value>(&bytes) {
            Ok(value) => match Store::restore(&value, crate::now_ms()) {
                Ok(_) => "valid".to_string(),
                Err(error) => format!("invalid: {error}"),
            },
            Err(_) => "invalid JSON".into(),
        },
        Err(error) if error.kind() == io::ErrorKind::NotFound => "not created yet".into(),
        Err(error) => format!("unreadable: {}", error.kind()),
    };
    json!({"hostName":HOST_NAME,"version":env!("CARGO_PKG_VERSION"),"dataDirectory":directory,
        "brokerConnected":broker.is_ok(),"brokerError":broker.as_ref().err().map(|e|e.to_string()),
        "state":persisted,"discovery":discovery,"snapshot":broker.ok().and_then(|v|v.get("data").cloned()),
        "permissions":"Manual approval only; the host cannot click permission prompts",
        "transport":"Authenticated 127.0.0.1 TCP; no external network, polling, or remote debugging"})
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn manifests_use_browser_specific_allowlists_and_per_user_paths() {
        let chrome = host_manifest(
            "chrome",
            Path::new("/portable/monitor"),
            CHROMIUM_ID,
            FIREFOX_ID,
        )
        .unwrap();
        let firefox = host_manifest(
            "firefox",
            Path::new("/portable/monitor"),
            CHROMIUM_ID,
            FIREFOX_ID,
        )
        .unwrap();
        assert!(chrome["allowed_origins"].is_array());
        assert!(chrome.get("allowed_extensions").is_none());
        assert_eq!(firefox["allowed_extensions"][0], FIREFOX_ID);
        assert!(firefox.get("allowed_origins").is_none());
        assert!(
            windows_registry_key("edge")
                .unwrap()
                .starts_with("HKCU\\Software\\Microsoft\\Edge")
        );
        assert_eq!(
            windows_registry_key("opera_gx").unwrap(),
            windows_registry_key("chrome").unwrap()
        );
        assert_eq!(
            user_manifest_paths(
                "firefox",
                Path::new("/users/test"),
                Path::new("/users/test/config")
            )
            .unwrap()[0],
            Path::new("/users/test/.mozilla/native-messaging-hosts")
                .join(format!("{HOST_NAME}.json"))
        );
        assert!(host_manifest("chrome", Path::new("/portable/monitor"), "*", FIREFOX_ID).is_err());
    }
}
