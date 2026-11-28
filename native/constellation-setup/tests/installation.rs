use constellation_setup::{
    engine::{self, Options, RECEIPT},
    payload::{MAGIC, Payload, hash, safe_relative},
    system::{RegistryEntry, RegistryValue, System},
};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    fs, io,
    path::{Path, PathBuf},
};

struct Fixture {
    dir: PathBuf,
    options: Options,
}
impl Fixture {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!(
            "constellation-setup-test-{}",
            constellation_monitor::platform::random_hex(8).unwrap()
        ));
        fs::create_dir(&dir).unwrap();
        let exe = dir.join("setup-test.bin");
        fs::write(&exe, b"isolated setup fixture").unwrap();
        Self {
            options: Options {
                root: dir.join("Project Constellation"),
                setup_exe: exe,
                shortcut: Some(dir.join("Start Menu/Constellation.lnk")),
            },
            dir,
        }
    }
    fn payload(&self, version: &str) -> Vec<u8> {
        payload(
            version,
            &[
                (
                    "runtime/constellation-monitor.exe",
                    format!("test-monitor-{version}").as_bytes(),
                ),
                (
                    "browsers/chromium/manifest.json",
                    format!("{{\"version\":\"{version}\"}}").as_bytes(),
                ),
                ("browsers/firefox/manifest.json", b"{}"),
                (
                    "computer-link/computer-link-owner-proof.exe",
                    b"owner fixture",
                ),
            ],
        )
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.dir);
    }
}

#[derive(Default)]
struct FakeSystem {
    values: BTreeMap<(String, String), RegistryValue>,
    writes: usize,
    fail_at: Option<usize>,
    fail_after: Option<usize>,
    stops: usize,
}
impl System for FakeSystem {
    fn read_registry(&mut self, key: &str, name: &str) -> io::Result<Option<RegistryValue>> {
        Ok(self.values.get(&(key.to_owned(), name.to_owned())).cloned())
    }
    fn write_registry(&mut self, entry: &RegistryEntry) -> io::Result<()> {
        self.writes += 1;
        if self.fail_at == Some(self.writes) {
            self.fail_at = None;
            return Err(io::Error::other("injected registry failure"));
        }
        if self.fail_after.is_some_and(|n| self.writes >= n) {
            return Err(io::Error::other("persistent registry failure"));
        }
        let key = (entry.key.clone(), entry.name.clone());
        if let Some(value) = &entry.value {
            self.values.insert(key, value.clone());
        } else {
            self.values.remove(&key);
        }
        Ok(())
    }
    fn shortcut_bytes(&mut self, exe: &Path, root: &Path) -> io::Result<Vec<u8>> {
        Ok(format!("test link {} --dir {}", exe.display(), root.display()).into_bytes())
    }
    fn stop_monitor(&mut self, _: &Path, _: &Path) -> io::Result<()> {
        self.stops += 1;
        Ok(())
    }
}

fn payload(version: &str, files: &[(&str, &[u8])]) -> Vec<u8> {
    let mut data = Vec::new();
    let mut records = Vec::new();
    for (path, bytes) in files {
        records.push(
            json!({"path":path,"bytes":bytes.len(),"offset":data.len(),"sha256":hash(bytes)}),
        );
        data.extend_from_slice(bytes);
    }
    let manifest = serde_json::to_vec(&json!({"schema":1,"version":version,"files":records,"sourceCommit":"fixture","sourceDirty":false,"firefoxSigned":false,"computerLinkIncluded":true})).unwrap();
    let mut result = MAGIC.to_vec();
    result.extend_from_slice(&(manifest.len() as u32).to_le_bytes());
    result.extend_from_slice(&manifest);
    result.extend_from_slice(&data);
    result
}

#[test]
fn validates_windows_paths_before_any_extraction() {
    for path in [
        "../escape",
        "/absolute",
        "C:/escape",
        "a\\b",
        "a//b",
        "a/./b",
        "a/../b",
        "AUX.txt",
        "x/con",
        "COM1.exe",
        "x/space ",
        "x/dot.",
        "x/stream:secret",
        "x/asterisk*",
        "x\0y",
    ] {
        assert!(safe_relative(path).is_err(), "{path}");
    }
    for path in [
        "browsers/chromium/manifest.json",
        "docs/README.md",
        "computer-link/local-client.exe",
    ] {
        safe_relative(path).unwrap();
    }
}

#[test]
fn rejects_tampered_truncated_duplicate_and_alias_payloads() {
    let fixture = Fixture::new();
    let bytes = fixture.payload("0.22.0");
    Payload::parse(&bytes).unwrap();
    let mut bad = bytes.clone();
    *bad.last_mut().unwrap() ^= 1;
    assert!(Payload::parse(&bad).is_err());
    assert!(Payload::parse(&bytes[..bytes.len() - 1]).is_err());
    let duplicate = payload("0.22.0", &[("a", b"1"), ("A", b"2")]);
    assert!(Payload::parse(&duplicate).is_err());
    let collide = payload("0.22.0", &[("a", b"1"), ("a/b", b"2")]);
    assert!(Payload::parse(&collide).is_err());
    let device = payload("0.22.0", &[("NUL.txt", b"1")]);
    assert!(Payload::parse(&device).is_err());
    assert!(
        Payload::parse(&[])
            .unwrap_err_string()
            .contains("no embedded payload")
    );
}

trait ErrorString {
    fn unwrap_err_string(self) -> String;
}
impl<T> ErrorString for io::Result<T> {
    fn unwrap_err_string(self) -> String {
        match self {
            Err(e) => e.to_string(),
            Ok(_) => panic!("expected error"),
        }
    }
}

#[test]
fn first_install_registers_only_current_user_host_and_product_slots() {
    let fixture = Fixture::new();
    let bytes = fixture.payload("0.22.0");
    let mut system = FakeSystem::default();
    let outcome = engine::install(
        &fixture.options,
        &Payload::parse(&bytes).unwrap(),
        &mut system,
    )
    .unwrap();
    assert!(outcome.ok && outcome.browser_confirmation_required);
    let receipt = engine::read_receipt(&fixture.options).unwrap().unwrap();
    assert_eq!(receipt.version, "0.22.0");
    assert!(receipt.active.starts_with("versions/0.22.0-"));
    assert_eq!(system.values.len(), 14);
    assert_eq!(receipt.releases.len(), 1);
    assert!(
        engine::verify(&fixture.options).unwrap()["ok"]
            .as_bool()
            .unwrap()
    );
    let manifest: Value = serde_json::from_slice(
        &fs::read(
            fixture
                .options
                .root
                .join(&receipt.active)
                .join("hosts/chrome.json"),
        )
        .unwrap(),
    )
    .unwrap();
    assert_eq!(
        manifest["allowed_origins"][0],
        "chrome-extension://geljambmkfjkhodgkpjhnmfojkpcamig/"
    );
    assert!(
        fixture
            .options
            .root
            .join("browsers/chromium/manifest.json")
            .is_file()
    );
    assert!(fixture.options.root.join("data/monitor").is_dir());
}

#[test]
fn update_keeps_stable_sensor_paths_history_data_and_original_integrations() {
    let f = Fixture::new();
    let mut s = FakeSystem::default();
    let key = (
        r"Software\Google\Chrome\NativeMessagingHosts\com.project_constellation.monitor".to_owned(),
        String::new(),
    );
    s.values.insert(
        key.clone(),
        RegistryValue::string("previous manual host.json"),
    );
    let a = f.payload("0.22.0");
    engine::install(&f.options, &Payload::parse(&a).unwrap(), &mut s).unwrap();
    fs::write(
        f.options.root.join("data/monitor/user-history.json"),
        b"keep my history",
    )
    .unwrap();
    let old = engine::read_receipt(&f.options).unwrap().unwrap();
    let b = f.payload("0.23.0");
    engine::install(&f.options, &Payload::parse(&b).unwrap(), &mut s).unwrap();
    let new = engine::read_receipt(&f.options).unwrap().unwrap();
    assert_eq!(new.releases.len(), 2);
    assert_ne!(old.active, new.active);
    assert_eq!(old.initial_registry, new.initial_registry);
    assert!(
        f.options
            .root
            .join(&old.active)
            .join("runtime/constellation-monitor.exe")
            .exists()
    );
    assert_eq!(
        fs::read(f.options.root.join("data/monitor/user-history.json")).unwrap(),
        b"keep my history"
    );
    assert!(
        fs::read_to_string(f.options.root.join("browsers/chromium/manifest.json"))
            .unwrap()
            .contains("0.23.0")
    );
    assert_eq!(s.stops, 1);
}

#[test]
fn failed_update_restores_registry_shortcut_browser_and_active_receipt() {
    let f = Fixture::new();
    let mut s = FakeSystem::default();
    let a = f.payload("0.22.0");
    engine::install(&f.options, &Payload::parse(&a).unwrap(), &mut s).unwrap();
    let previous = fs::read(f.options.root.join(RECEIPT)).unwrap();
    let registry = s.values.clone();
    let shortcut = fs::read(f.options.shortcut.as_ref().unwrap()).unwrap();
    s.fail_at = Some(s.writes + 3);
    let b = f.payload("0.23.0");
    let error = engine::install(&f.options, &Payload::parse(&b).unwrap(), &mut s).unwrap_err();
    assert!(error.to_string().contains("restored"));
    assert_eq!(fs::read(f.options.root.join(RECEIPT)).unwrap(), previous);
    assert_eq!(s.values, registry);
    assert_eq!(
        fs::read(f.options.shortcut.as_ref().unwrap()).unwrap(),
        shortcut
    );
    assert!(engine::verify(&f.options).unwrap()["ok"].as_bool().unwrap());
    assert!(
        !f.options
            .root
            .join(".constellation-transaction.json")
            .exists()
    );
}

#[test]
fn interrupted_failed_rollback_is_recovered_before_next_install() {
    let f = Fixture::new();
    let mut s = FakeSystem::default();
    let a = f.payload("0.22.0");
    engine::install(&f.options, &Payload::parse(&a).unwrap(), &mut s).unwrap();
    s.fail_after = Some(s.writes + 3);
    let b = f.payload("0.23.0");
    assert!(engine::install(&f.options, &Payload::parse(&b).unwrap(), &mut s).is_err());
    assert!(
        f.options
            .root
            .join(".constellation-transaction.json")
            .exists()
    );
    s.fail_after = None;
    let result = engine::install(&f.options, &Payload::parse(&b).unwrap(), &mut s).unwrap();
    assert!(result.notes.iter().any(|n| n.contains("Recovered")));
    assert!(
        !f.options
            .root
            .join(".constellation-transaction.json")
            .exists()
    );
    assert!(engine::verify(&f.options).unwrap()["ok"].as_bool().unwrap());
}

#[test]
fn explicit_rollback_restores_previous_code_and_registration() {
    let f = Fixture::new();
    let mut s = FakeSystem::default();
    let a = f.payload("0.22.0");
    let b = f.payload("0.23.0");
    engine::install(&f.options, &Payload::parse(&a).unwrap(), &mut s).unwrap();
    let old = engine::read_receipt(&f.options).unwrap().unwrap();
    engine::install(&f.options, &Payload::parse(&b).unwrap(), &mut s).unwrap();
    let result = engine::rollback(&f.options, &mut s).unwrap();
    assert_eq!(result.version.as_deref(), Some("0.22.0"));
    assert_eq!(
        engine::read_receipt(&f.options).unwrap().unwrap().active,
        old.active
    );
    assert!(engine::verify(&f.options).unwrap()["ok"].as_bool().unwrap());
}

#[test]
fn legacy_shortcut_migration_preserves_desktop_and_keeps_new_manager_after_rollback() {
    use constellation_setup::system::UNINSTALL_KEY;

    for desktop_was_present in [false, true] {
        for desktop_replaced_legacy in [false, true] {
            let f = Fixture::new();
            let mut s = FakeSystem::default();
            let desktop = f.dir.join("Start Menu/Project Constellation.lnk");
            let setup = f.dir.join("Start Menu/Project Constellation Setup.lnk");
            fs::create_dir_all(desktop.parent().unwrap()).unwrap();
            let desktop_baseline =
                desktop_was_present.then_some(b"original desktop shortcut".as_slice());
            if let Some(bytes) = desktop_baseline {
                fs::write(&desktop, bytes).unwrap();
            }
            let setup_baseline = b"independent setup shortcut baseline";
            fs::write(&setup, setup_baseline).unwrap();
            let legacy = Options {
                shortcut: Some(desktop.clone()),
                ..f.options.clone()
            };
            fs::write(&legacy.setup_exe, b"legacy setup manager").unwrap();
            let a = f.payload("0.21.0");
            engine::install(&legacy, &Payload::parse(&a).unwrap(), &mut s).unwrap();
            let old = engine::read_receipt(&legacy).unwrap().unwrap();
            let later_desktop = b"desktop reinstalled after legacy setup";
            if desktop_replaced_legacy {
                fs::write(&desktop, later_desktop).unwrap();
            }
            let expected_desktop = if desktop_replaced_legacy {
                Some(later_desktop.as_slice())
            } else {
                desktop_baseline
            };
            let current = Options {
                shortcut: Some(setup.clone()),
                ..legacy.clone()
            };
            fs::write(&current.setup_exe, b"current setup manager").unwrap();
            let b = f.payload("0.22.0");
            engine::install(&current, &Payload::parse(&b).unwrap(), &mut s).unwrap();
            let upgraded = engine::read_receipt(&current).unwrap().unwrap();
            let owned_shortcut = upgraded.shortcut.as_ref().unwrap();
            assert_eq!(owned_shortcut.path, setup);
            assert_eq!(
                owned_shortcut.original.as_deref(),
                Some(setup_baseline.as_slice())
            );
            assert_eq!(fs::read(&desktop).ok().as_deref(), expected_desktop);
            let manager = current
                .root
                .join(&upgraded.active)
                .join("Constellation-Setup.exe");
            let new_link = s.shortcut_bytes(&manager, &current.root).unwrap();
            assert_eq!(fs::read(&setup).unwrap(), new_link);
            let apps_before: BTreeMap<_, _> =
                ["DisplayIcon", "UninstallString", "QuietUninstallString"]
                    .into_iter()
                    .map(|name| {
                        let key = (UNINSTALL_KEY.to_owned(), name.to_owned());
                        (key.clone(), s.values[&key].clone())
                    })
                    .collect();
            assert!(apps_before.values().all(|value| {
                value
                    .as_string()
                    .unwrap()
                    .contains(&manager.to_string_lossy().to_string())
            }));

            engine::rollback(&current, &mut s).unwrap();
            let rolled_back = engine::read_receipt(&current).unwrap().unwrap();
            assert_eq!(rolled_back.active, old.active);
            assert_eq!(rolled_back.version, "0.21.0");
            assert_eq!(
                fs::read(&setup).unwrap(),
                new_link,
                "payload rollback must retain the newer manager shortcut"
            );
            for (key, value) in apps_before {
                assert_eq!(
                    s.values.get(&key),
                    Some(&value),
                    "payload rollback must retain its current manager registration"
                );
            }
            let native_host_key = (
                r"Software\Google\Chrome\NativeMessagingHosts\com.project_constellation.monitor"
                    .to_owned(),
                String::new(),
            );
            assert_eq!(
                s.values[&native_host_key].as_string().unwrap(),
                current
                    .root
                    .join(&old.active)
                    .join("hosts/chrome.json")
                    .to_string_lossy()
            );
            assert_eq!(fs::read(&manager).unwrap(), b"current setup manager");
            assert!(engine::verify(&current).unwrap()["ok"].as_bool().unwrap());
            assert_eq!(fs::read(&desktop).ok().as_deref(), expected_desktop);

            engine::uninstall(&current, &mut s).unwrap();
            assert_eq!(
                fs::read(&desktop).ok().as_deref(),
                expected_desktop,
                "uninstall must not replace or remove the desktop shortcut"
            );
            assert_eq!(
                fs::read(&setup).unwrap(),
                setup_baseline,
                "the new shortcut has its own original baseline"
            );
            assert!(s.values.is_empty());
            assert!(!manager.exists());
        }
    }
}

#[test]
fn failed_legacy_shortcut_migration_preserves_both_shortcut_paths() {
    for desktop_replaced_legacy in [false, true] {
        let f = Fixture::new();
        let mut s = FakeSystem::default();
        let desktop = f.dir.join("Start Menu/Project Constellation.lnk");
        let setup = f.dir.join("Start Menu/Project Constellation Setup.lnk");
        fs::create_dir_all(desktop.parent().unwrap()).unwrap();
        fs::write(&desktop, b"original desktop shortcut").unwrap();
        fs::write(&setup, b"independent setup shortcut baseline").unwrap();
        let legacy = Options {
            shortcut: Some(desktop.clone()),
            ..f.options.clone()
        };
        let a = f.payload("0.21.0");
        engine::install(&legacy, &Payload::parse(&a).unwrap(), &mut s).unwrap();
        if desktop_replaced_legacy {
            fs::write(&desktop, b"later desktop shortcut").unwrap();
        }
        let old_desktop = fs::read(&desktop).unwrap();
        let old_setup = fs::read(&setup).unwrap();
        let receipt = fs::read(legacy.root.join(RECEIPT)).unwrap();
        let registry = s.values.clone();
        let current = Options {
            shortcut: Some(setup.clone()),
            ..legacy.clone()
        };
        let b = f.payload("0.22.0");
        s.fail_at = Some(s.writes + 3);
        let error = engine::install(&current, &Payload::parse(&b).unwrap(), &mut s).unwrap_err();
        assert!(error.to_string().contains("restored"), "{error}");
        assert_eq!(fs::read(&desktop).unwrap(), old_desktop);
        assert_eq!(fs::read(&setup).unwrap(), old_setup);
        assert_eq!(fs::read(current.root.join(RECEIPT)).unwrap(), receipt);
        assert_eq!(s.values, registry);
        assert!(engine::verify(&current).unwrap()["ok"].as_bool().unwrap());
        assert!(
            !current
                .root
                .join(".constellation-transaction.json")
                .exists()
        );
    }
}

#[test]
fn legacy_journal_recovery_uses_its_recorded_shortcut_path() {
    let f = Fixture::new();
    let mut s = FakeSystem::default();
    let desktop = f.dir.join("Start Menu/Project Constellation.lnk");
    let setup = f.dir.join("Start Menu/Project Constellation Setup.lnk");
    fs::create_dir_all(desktop.parent().unwrap()).unwrap();
    fs::write(&desktop, b"original desktop shortcut").unwrap();
    fs::write(&setup, b"independent setup shortcut baseline").unwrap();
    let legacy = Options {
        shortcut: Some(desktop.clone()),
        ..f.options.clone()
    };
    let a = f.payload("0.21.0");
    engine::install(&legacy, &Payload::parse(&a).unwrap(), &mut s).unwrap();
    let b = f.payload("0.22.0");
    s.fail_after = Some(s.writes + 3);
    assert!(engine::install(&legacy, &Payload::parse(&b).unwrap(), &mut s).is_err());
    let journal_path = legacy.root.join(".constellation-transaction.json");
    let journal: Value = serde_json::from_slice(&fs::read(&journal_path).unwrap()).unwrap();
    // Represent interruption after the old setup had written its shortcut but
    // before committing its receipt. Recovery must address this journal's path,
    // even when invoked by a manager with the new default shortcut name.
    let interrupted_manager = legacy
        .root
        .join(journal["next"]["active"].as_str().unwrap())
        .join("Constellation-Setup.exe");
    let interrupted_shortcut = s
        .shortcut_bytes(&interrupted_manager, &legacy.root)
        .unwrap();
    assert_eq!(
        hash(&interrupted_shortcut),
        journal["next"]["shortcut"]["installedSha256"]
    );
    fs::write(&desktop, interrupted_shortcut).unwrap();
    s.fail_after = None;
    let current = Options {
        shortcut: Some(setup.clone()),
        ..legacy
    };
    engine::uninstall(&current, &mut s).unwrap();
    assert_eq!(fs::read(&desktop).unwrap(), b"original desktop shortcut");
    assert_eq!(
        fs::read(&setup).unwrap(),
        b"independent setup shortcut baseline"
    );
    assert!(s.values.is_empty());
    assert!(!journal_path.exists());
    assert!(!current.root.join(RECEIPT).exists());
}

#[test]
fn uninstall_restores_prior_values_and_preserves_user_changes_and_data() {
    let f = Fixture::new();
    let mut s = FakeSystem::default();
    let key = (
        r"Software\Google\Chrome\NativeMessagingHosts\com.project_constellation.monitor".to_owned(),
        String::new(),
    );
    s.values
        .insert(key.clone(), RegistryValue::string("manual-host.json"));
    fs::create_dir_all(f.options.shortcut.as_ref().unwrap().parent().unwrap()).unwrap();
    fs::write(f.options.shortcut.as_ref().unwrap(), b"prior shortcut").unwrap();
    let a = f.payload("0.22.0");
    engine::install(&f.options, &Payload::parse(&a).unwrap(), &mut s).unwrap();
    let changed = f.options.root.join("browsers/chromium/manifest.json");
    fs::write(&changed, b"user modified code").unwrap();
    fs::write(
        f.options.root.join("data/my-settings.json"),
        b"precious settings",
    )
    .unwrap();
    let external = (
        r"Software\Mozilla\NativeMessagingHosts\com.project_constellation.monitor".to_owned(),
        String::new(),
    );
    s.values.insert(
        external.clone(),
        RegistryValue::string("other-install.json"),
    );
    let result = engine::uninstall(&f.options, &mut s).unwrap();
    assert!(result.ok);
    assert_eq!(
        s.values.get(&key),
        Some(&RegistryValue::string("manual-host.json"))
    );
    assert_eq!(
        s.values.get(&external),
        Some(&RegistryValue::string("other-install.json"))
    );
    assert_eq!(fs::read(&changed).unwrap(), b"user modified code");
    assert_eq!(
        fs::read(f.options.root.join("data/my-settings.json")).unwrap(),
        b"precious settings"
    );
    assert_eq!(
        fs::read(f.options.shortcut.as_ref().unwrap()).unwrap(),
        b"prior shortcut"
    );
    assert!(!f.options.root.join(RECEIPT).exists());
}

#[test]
fn update_preserves_unmanaged_browser_files_in_named_backup() {
    let f = Fixture::new();
    let mut s = FakeSystem::default();
    let a = f.payload("0.22.0");
    engine::install(&f.options, &Payload::parse(&a).unwrap(), &mut s).unwrap();
    fs::write(
        f.options.root.join("browsers/chromium/my-note.txt"),
        b"keep this",
    )
    .unwrap();
    let b = f.payload("0.23.0");
    let result = engine::install(&f.options, &Payload::parse(&b).unwrap(), &mut s).unwrap();
    assert!(
        result
            .notes
            .iter()
            .any(|n| n.contains("preserved-browsers"))
    );
    let backup = fs::read_dir(&f.options.root)
        .unwrap()
        .filter_map(Result::ok)
        .find(|p| {
            p.file_name()
                .to_string_lossy()
                .starts_with("preserved-browsers-")
        })
        .unwrap()
        .path();
    assert_eq!(
        fs::read(backup.join("chromium/my-note.txt")).unwrap(),
        b"keep this"
    );
}

#[test]
fn refuses_arbitrary_existing_folder_and_tampered_receipt_registry() {
    let f = Fixture::new();
    let mut s = FakeSystem::default();
    let a = f.payload("0.22.0");
    fs::create_dir(&f.options.root).unwrap();
    fs::write(f.options.root.join("my-file"), b"do not replace").unwrap();
    assert!(engine::install(&f.options, &Payload::parse(&a).unwrap(), &mut s).is_err());
    assert!(s.values.is_empty());
    fs::remove_file(f.options.root.join("my-file")).unwrap();
    engine::install(&f.options, &Payload::parse(&a).unwrap(), &mut s).unwrap();
    let p = f.options.root.join(RECEIPT);
    let mut receipt: Value = serde_json::from_slice(&fs::read(&p).unwrap()).unwrap();
    receipt["initialRegistry"][0]["key"] = json!(r"Software\SomeOtherProduct");
    fs::write(&p, serde_json::to_vec(&receipt).unwrap()).unwrap();
    assert!(engine::uninstall(&f.options, &mut s).is_err());
}

#[test]
fn concurrent_setup_is_rejected_by_os_file_lock() {
    let f = Fixture::new();
    let mut s = FakeSystem::default();
    let a = f.payload("0.22.0");
    engine::install(&f.options, &Payload::parse(&a).unwrap(), &mut s).unwrap();
    let lock = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(f.options.root.join(".setup.lock"))
        .unwrap();
    lock.lock().unwrap();
    let error = engine::install(&f.options, &Payload::parse(&a).unwrap(), &mut s).unwrap_err();
    assert!(error.to_string().contains("already"));
}

#[test]
fn rollback_refuses_tampered_old_runtime_without_changing_active_install() {
    let f = Fixture::new();
    let mut s = FakeSystem::default();
    let a = f.payload("0.22.0");
    let b = f.payload("0.23.0");
    engine::install(&f.options, &Payload::parse(&a).unwrap(), &mut s).unwrap();
    let old = engine::read_receipt(&f.options).unwrap().unwrap();
    engine::install(&f.options, &Payload::parse(&b).unwrap(), &mut s).unwrap();
    let active = fs::read(f.options.root.join(RECEIPT)).unwrap();
    let registry = s.values.clone();
    fs::write(
        f.options
            .root
            .join(old.active)
            .join("runtime/constellation-monitor.exe"),
        b"tampered runtime",
    )
    .unwrap();
    assert!(engine::rollback(&f.options, &mut s).is_err());
    assert_eq!(fs::read(f.options.root.join(RECEIPT)).unwrap(), active);
    assert_eq!(s.values, registry);
    assert!(engine::verify(&f.options).unwrap()["ok"].as_bool().unwrap());
    assert!(
        !fs::read_dir(&f.options.root)
            .unwrap()
            .filter_map(Result::ok)
            .any(|p| p
                .file_name()
                .to_string_lossy()
                .starts_with(".browser-stage-"))
    );
}

#[test]
fn repair_reuses_verified_release_and_never_executes_tampered_old_runtime() {
    let f = Fixture::new();
    let mut s = FakeSystem::default();
    let a = f.payload("0.22.0");
    engine::install(&f.options, &Payload::parse(&a).unwrap(), &mut s).unwrap();
    let original = engine::read_receipt(&f.options).unwrap().unwrap();
    fs::write(
        f.options.root.join("browsers/chromium/manifest.json"),
        b"user edit",
    )
    .unwrap();
    let repaired = engine::install(&f.options, &Payload::parse(&a).unwrap(), &mut s).unwrap();
    assert_eq!(repaired.action, "repaired");
    assert_eq!(
        engine::read_receipt(&f.options)
            .unwrap()
            .unwrap()
            .releases
            .len(),
        1
    );
    assert_eq!(
        engine::read_receipt(&f.options).unwrap().unwrap().active,
        original.active
    );
    assert!(engine::verify(&f.options).unwrap()["ok"].as_bool().unwrap());
    let stops = s.stops;
    fs::write(
        f.options
            .root
            .join(&original.active)
            .join("runtime/constellation-monitor.exe"),
        b"do not execute this",
    )
    .unwrap();
    let restored = engine::install(&f.options, &Payload::parse(&a).unwrap(), &mut s).unwrap();
    assert_eq!(restored.action, "installed");
    assert_eq!(
        s.stops, stops,
        "unverified executable must never be launched to stop a hub"
    );
    assert!(engine::verify(&f.options).unwrap()["ok"].as_bool().unwrap());
}

#[test]
fn different_install_roots_preserve_active_owner_and_original_baseline() {
    let f = Fixture::new();
    let mut s = FakeSystem::default();
    let a = f.payload("0.22.0");
    let old_host = (
        r"Software\Google\Chrome\NativeMessagingHosts\com.project_constellation.monitor".to_owned(),
        String::new(),
    );
    s.values
        .insert(old_host, RegistryValue::string("original-manual-host.json"));
    let baseline = s.values.clone();
    fs::create_dir_all(f.options.shortcut.as_ref().unwrap().parent().unwrap()).unwrap();
    fs::write(f.options.shortcut.as_ref().unwrap(), b"original shortcut").unwrap();
    engine::install(&f.options, &Payload::parse(&a).unwrap(), &mut s).unwrap();
    let other = Options {
        root: f.dir.join("Another installation"),
        ..f.options.clone()
    };
    engine::install(&other, &Payload::parse(&a).unwrap(), &mut s).unwrap();
    let active_registry = s.values.clone();
    let active_shortcut = fs::read(other.shortcut.as_ref().unwrap()).unwrap();
    engine::uninstall(&f.options, &mut s).unwrap();
    assert_eq!(
        s.values, active_registry,
        "uninstalling A must preserve all B Apps & Features values, including identical shared strings"
    );
    assert_eq!(
        fs::read(other.shortcut.as_ref().unwrap()).unwrap(),
        active_shortcut
    );
    assert!(engine::verify(&other).unwrap()["ok"].as_bool().unwrap());
    engine::uninstall(&other, &mut s).unwrap();
    assert_eq!(
        s.values, baseline,
        "final uninstall must not resurrect removed A registrations"
    );
    assert_eq!(
        fs::read(other.shortcut.as_ref().unwrap()).unwrap(),
        b"original shortcut"
    );
}

#[test]
fn recovery_of_failed_install_does_not_overwrite_later_install() {
    let f = Fixture::new();
    let mut s = FakeSystem::default();
    let a = f.payload("0.22.0");
    s.fail_after = Some(3);
    assert!(engine::install(&f.options, &Payload::parse(&a).unwrap(), &mut s).is_err());
    assert!(
        f.options
            .root
            .join(".constellation-transaction.json")
            .exists()
    );
    s.fail_after = None;
    let other = Options {
        root: f.dir.join("Newer install"),
        ..f.options.clone()
    };
    engine::install(&other, &Payload::parse(&a).unwrap(), &mut s).unwrap();
    let active_registry = s.values.clone();
    let active_shortcut = fs::read(other.shortcut.as_ref().unwrap()).unwrap();
    // Recovery succeeds; A never committed, so no installed product remains to uninstall.
    assert!(engine::uninstall(&f.options, &mut s).is_err());
    assert!(
        !f.options
            .root
            .join(".constellation-transaction.json")
            .exists()
    );
    assert_eq!(s.values, active_registry);
    assert_eq!(
        fs::read(other.shortcut.as_ref().unwrap()).unwrap(),
        active_shortcut
    );
    assert!(engine::verify(&other).unwrap()["ok"].as_bool().unwrap());
    engine::uninstall(&other, &mut s).unwrap();
    assert!(
        s.values.is_empty(),
        "failed A baseline must not survive final uninstall"
    );
}

#[test]
fn executable_launch_requires_receipt_membership_and_verified_bytes() {
    let f = Fixture::new();
    let mut s = FakeSystem::default();
    let bytes = payload(
        "0.22.0",
        &[
            ("runtime/constellation-monitor.exe", b"monitor"),
            ("browsers/chromium/manifest.json", b"{}"),
            ("browsers/firefox/manifest.json", b"{}"),
        ],
    );
    engine::install(&f.options, &Payload::parse(&bytes).unwrap(), &mut s).unwrap();
    let receipt = engine::read_receipt(&f.options).unwrap().unwrap();
    let owner = f
        .options
        .root
        .join(&receipt.active)
        .join("computer-link/computer-link-owner-proof.exe");
    fs::create_dir_all(owner.parent().unwrap()).unwrap();
    fs::write(&owner, b"untracked executable").unwrap();
    assert!(engine::verify(&f.options).unwrap()["ok"].as_bool().unwrap());
    assert!(
        engine::verified_executable(&f.options, "computer-link/computer-link-owner-proof.exe")
            .is_err()
    );
    let monitor =
        engine::verified_executable(&f.options, "runtime/constellation-monitor.exe").unwrap();
    fs::write(monitor, b"changed monitor").unwrap();
    assert!(engine::verified_executable(&f.options, "runtime/constellation-monitor.exe").is_err());
}

#[test]
fn uninstall_retry_after_first_app_value_or_last_anchor_failure_is_complete() {
    for failure in [5, 14] {
        let f = Fixture::new();
        let mut s = FakeSystem::default();
        let a = f.payload("0.22.0");
        engine::install(&f.options, &Payload::parse(&a).unwrap(), &mut s).unwrap();
        s.fail_at = Some(s.writes + failure);
        assert!(engine::uninstall(&f.options, &mut s).is_err());
        assert!(f.options.root.join(RECEIPT).is_file());
        engine::uninstall(&f.options, &mut s).unwrap();
        assert!(
            s.values.is_empty(),
            "incomplete retry at write {failure}: {:?}",
            s.values.keys()
        );
    }
}

#[test]
fn oversized_recovery_history_fails_before_global_mutation() {
    use constellation_setup::engine::OwnedFile;
    let f = Fixture::new();
    let mut s = FakeSystem::default();
    let a = f.payload("0.22.0");
    engine::install(&f.options, &Payload::parse(&a).unwrap(), &mut s).unwrap();
    let mut receipt = engine::read_receipt(&f.options).unwrap().unwrap();
    let original = receipt.releases[0].clone();
    let files: Vec<_> = (0..20_000)
        .map(|index| OwnedFile {
            path: format!("history/file-{index:05}.dat"),
            sha256: "0".repeat(64),
            bytes: 0,
        })
        .collect();
    for index in 0..3 {
        let mut release = original.clone();
        release.directory = format!("versions/retained-{index}");
        release.files = files.clone();
        receipt.releases.push(release);
    }
    let encoded = serde_json::to_vec_pretty(&receipt).unwrap();
    assert!(encoded.len() > 8 * 1024 * 1024 && encoded.len() < 16 * 1024 * 1024);
    fs::write(f.options.root.join(RECEIPT), &encoded).unwrap();
    let registry = s.values.clone();
    let writes = s.writes;
    let b = f.payload("0.23.0");
    let error = engine::install(&f.options, &Payload::parse(&b).unwrap(), &mut s).unwrap_err();
    assert!(error.to_string().contains("size limit"), "{error}");
    assert_eq!(s.writes, writes);
    assert_eq!(s.values, registry);
    assert_eq!(fs::read(f.options.root.join(RECEIPT)).unwrap(), encoded);
    assert!(
        !f.options
            .root
            .join(".constellation-transaction.json")
            .exists()
    );
    assert!(
        fs::read_to_string(f.options.root.join("browsers/chromium/manifest.json"))
            .unwrap()
            .contains("0.22.0")
    );
}

#[cfg(unix)]
#[test]
fn rejects_symlinked_parent_and_preserves_the_target() {
    use std::os::unix::fs::symlink;
    let f = Fixture::new();
    let mut s = FakeSystem::default();
    let a = f.payload("0.22.0");
    let outside = f.dir.join("outside");
    fs::create_dir(&outside).unwrap();
    symlink(&outside, &f.options.root).unwrap();
    assert!(engine::install(&f.options, &Payload::parse(&a).unwrap(), &mut s).is_err());
    assert!(fs::read_dir(&outside).unwrap().next().is_none());
}
