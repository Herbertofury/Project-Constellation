//! Transactional installer shared by the Windows frontend and isolated tests.
//! The registry backend is explicit so non-Windows tests never touch a profile.
use crate::{
    payload::{Payload, hash, safe_relative, safe_version},
    system::{RegistryEntry, RegistryValue, System, UNINSTALL_KEY, valid_registry_slot},
};
use constellation_monitor::{CHROMIUM_ID, FIREFOX_ID, install::host_manifest, platform};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    collections::BTreeSet,
    fs::{self, File},
    io::{self, Write},
    path::{Path, PathBuf},
};

pub const RECEIPT: &str = "constellation-install.json";
pub const SHORTCUT_NAME: &str = "Project Constellation Setup.lnk";
const LEGACY_SHORTCUT_NAME: &str = "Project Constellation.lnk";
const JOURNAL: &str = ".constellation-transaction.json";
const MARKER: &str = ".constellation-owned";
const PRODUCT: &str = "project-constellation";
const MAX_RECEIPT: usize = 16 * 1024 * 1024;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OwnedFile {
    pub path: String,
    pub sha256: String,
    pub bytes: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Release {
    pub directory: String,
    pub version: String,
    pub payload_sha256: String,
    pub files: Vec<OwnedFile>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Shortcut {
    pub path: PathBuf,
    pub original: Option<Vec<u8>>,
    pub installed_sha256: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Receipt {
    pub schema: u32,
    pub product: String,
    pub root: PathBuf,
    pub active: String,
    pub version: String,
    pub payload_sha256: String,
    pub transaction_id: String,
    pub releases: Vec<Release>,
    pub initial_registry: Vec<RegistryEntry>,
    pub current_registry: Vec<RegistryEntry>,
    pub shortcut: Option<Shortcut>,
    pub browser_files: Vec<OwnedFile>,
}

#[derive(Clone)]
pub struct Options {
    pub root: PathBuf,
    pub setup_exe: PathBuf,
    pub shortcut: Option<PathBuf>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Outcome {
    pub ok: bool,
    pub action: String,
    pub root: PathBuf,
    pub version: Option<String>,
    pub browser_confirmation_required: bool,
    pub notes: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Journal {
    schema: u32,
    id: String,
    before: Option<Receipt>,
    next: Receipt,
    registry_before: Vec<RegistryEntry>,
    shortcut_before: Option<Vec<u8>>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    retired_shortcuts: Vec<Shortcut>,
    browser_backup: String,
    browser_stage: String,
    had_browsers: bool,
    introduced_release: Option<Release>,
}

fn invalid(message: impl Into<String>) -> io::Error {
    io::Error::other(message.into())
}

fn linked_entry(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_type().is_symlink() || metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

pub fn reject_links(path: &Path) -> io::Result<()> {
    // Check every existing ancestor; Windows junctions are reparse points but
    // are not necessarily reported by is_symlink().
    for ancestor in path.ancestors() {
        match fs::symlink_metadata(ancestor) {
            Ok(meta) => {
                if linked_entry(&meta) {
                    return Err(invalid(format!(
                        "Setup does not follow symbolic links or junctions: {}",
                        ancestor.display()
                    )));
                }
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
    }
    Ok(())
}

fn canonical_root(path: &Path) -> io::Result<PathBuf> {
    if !path.is_absolute()
        || path
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
        || path.parent().is_none()
    {
        return Err(invalid(
            "Choose an absolute installation folder, not a drive root or a parent traversal.",
        ));
    }
    reject_links(path)?;
    let resolved = if path.exists() {
        path.canonicalize()?
    } else {
        path.to_path_buf()
    };
    #[cfg(windows)]
    {
        // Keep ordinary drive paths in browser manifests, Explorer and the
        // cross-language discovery receipt (Rust adds a verbatim prefix).
        let text = resolved.to_string_lossy();
        if let Some(local) = text.strip_prefix(r"\\?\") {
            if local.starts_with("UNC\\") {
                return Err(invalid("Choose a local drive for the native browser hub."));
            }
            return Ok(PathBuf::from(local));
        }
        if text.starts_with(r"\\") {
            return Err(invalid("Choose a local drive for the native browser hub."));
        }
    }
    Ok(resolved)
}

fn read_optional(path: &Path, max: usize) -> io::Result<Option<Vec<u8>>> {
    reject_links(path)?;
    match fs::metadata(path) {
        Ok(meta) => {
            if !meta.is_file() || meta.len() > max as u64 {
                return Err(invalid("Invalid or oversized installer state file."));
            }
            Ok(Some(fs::read(path)?))
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

fn validate_release(release: &Release) -> io::Result<()> {
    safe_relative(&release.directory)?;
    if !release.directory.starts_with("versions/")
        || release.directory.split('/').count() != 2
        || !safe_version(&release.version)
        || release.files.len() > 25_000
    {
        return Err(invalid("Invalid release ownership receipt."));
    }
    validate_files(&release.files)
}

fn validate_files(files: &[OwnedFile]) -> io::Result<()> {
    let mut paths = BTreeSet::new();
    for file in files {
        safe_relative(&file.path)?;
        if !paths.insert(file.path.to_lowercase())
            || file.sha256.len() != 64
            || !file.sha256.bytes().all(|b| b.is_ascii_hexdigit())
            || file.bytes > 512 * 1024 * 1024
        {
            return Err(invalid("Invalid owned file receipt."));
        }
    }
    Ok(())
}

fn validate_registry(entries: &[RegistryEntry]) -> io::Result<()> {
    let mut slots = BTreeSet::new();
    if entries.len() > 30 {
        return Err(invalid("Invalid registry receipt."));
    }
    for entry in entries {
        if !valid_registry_slot(&entry.key, &entry.name)
            || !slots.insert((&entry.key, &entry.name))
            || entry
                .value
                .as_ref()
                .is_some_and(|v| v.bytes.len() > 1024 * 1024)
        {
            return Err(invalid("Registry receipt contains an unmanaged entry."));
        }
    }
    Ok(())
}

fn legacy_shortcut_path(options: &Options) -> Option<PathBuf> {
    options.shortcut.as_ref().and_then(|path| {
        (path.file_name().is_some_and(|name| name == SHORTCUT_NAME))
            .then(|| path.with_file_name(LEGACY_SHORTCUT_NAME))
    })
}

fn validate_shortcut(shortcut: &Shortcut, options: &Options) -> io::Result<()> {
    if (options.shortcut.as_ref() != Some(&shortcut.path)
        && legacy_shortcut_path(options).as_ref() != Some(&shortcut.path))
        || shortcut
            .original
            .as_ref()
            .is_some_and(|v| v.len() > 1024 * 1024)
        || shortcut.installed_sha256.len() != 64
        || !shortcut
            .installed_sha256
            .bytes()
            .all(|b| b.is_ascii_hexdigit())
    {
        return Err(invalid(
            "Shortcut receipt is outside the expected current-user Start Menu location.",
        ));
    }
    Ok(())
}

fn validate_receipt(receipt: &Receipt, options: &Options) -> io::Result<()> {
    if receipt.schema != 1
        || receipt.product != PRODUCT
        || receipt.root != options.root
        || receipt.releases.len() > 256
    {
        return Err(invalid(
            "This folder's installation receipt does not match Project Constellation.",
        ));
    }
    for release in &receipt.releases {
        validate_release(release)?;
    }
    if !receipt.releases.iter().any(|r| {
        r.directory == receipt.active
            && r.version == receipt.version
            && r.payload_sha256 == receipt.payload_sha256
    }) {
        return Err(invalid(
            "Active release is missing from the ownership receipt.",
        ));
    }
    validate_registry(&receipt.initial_registry)?;
    validate_registry(&receipt.current_registry)?;
    validate_files(&receipt.browser_files)?;
    if receipt
        .browser_files
        .iter()
        .any(|f| !f.path.starts_with("browsers/"))
    {
        return Err(invalid("Invalid browser ownership record."));
    }
    if let Some(shortcut) = &receipt.shortcut {
        validate_shortcut(shortcut, options)?;
    }
    Ok(())
}

pub fn read_receipt(options: &Options) -> io::Result<Option<Receipt>> {
    let Some(bytes) = read_optional(&options.root.join(RECEIPT), MAX_RECEIPT)? else {
        return Ok(None);
    };
    let receipt: Receipt = serde_json::from_slice(&bytes)?;
    let mut normalized = options.clone();
    normalized.root = canonical_root(&options.root)?;
    validate_receipt(&receipt, &normalized)?;
    Ok(Some(receipt))
}

fn prepare(options: &Options) -> io::Result<(Options, File)> {
    let mut options = options.clone();
    options.root = canonical_root(&options.root)?;
    if options.root.exists()
        && !options.root.join(MARKER).is_file()
        && fs::read_dir(&options.root)?.next().is_some()
    {
        return Err(invalid(
            "The selected folder already contains files from another installation. Choose an empty folder; Setup will preserve the existing files.",
        ));
    }
    platform::secure_directory(&options.root)?;
    // Canonicalization after creation avoids unstable aliases in host manifests.
    options.root = canonical_root(&options.root)?;
    if let Some(marker) = read_optional(&options.root.join(MARKER), 256)? {
        if marker != PRODUCT.as_bytes() {
            return Err(invalid(
                "This installation folder has a different owner marker.",
            ));
        }
    } else {
        platform::atomic_write(&options.root.join(MARKER), PRODUCT.as_bytes())?;
    }
    let lock = platform::open_private(&options.root.join(".setup.lock"), false)?;
    lock.try_lock().map_err(|_| {
        invalid("Another Constellation setup operation is already using this folder.")
    })?;
    if let Some(shortcut) = &options.shortcut {
        reject_links(shortcut)?;
    }
    Ok((options, lock))
}

fn new_file(base: &Path, path: &str, contents: &[u8]) -> io::Result<OwnedFile> {
    safe_relative(path)?;
    let target = base.join(path);
    reject_links(&target)?;
    platform::secure_directory(target.parent().unwrap())?;
    let mut file = platform::open_private(&target, true)?;
    let result = file.write_all(contents).and_then(|()| file.sync_all());
    drop(file);
    if let Err(error) = result {
        let _ = fs::remove_file(&target);
        return Err(error);
    }
    Ok(OwnedFile {
        path: path.to_owned(),
        sha256: hash(contents),
        bytes: contents.len() as u64,
    })
}

struct StageGuard {
    directory: PathBuf,
    files: Vec<OwnedFile>,
}
impl Drop for StageGuard {
    fn drop(&mut self) {
        let _ = remove_owned(&self.directory, &self.files, &mut Vec::new());
    }
}

fn verified_bytes(base: &Path, file: &OwnedFile) -> io::Result<Vec<u8>> {
    let target = base.join(&file.path);
    reject_links(&target)?;
    let meta = fs::metadata(&target)?;
    if !meta.is_file() || meta.len() != file.bytes {
        return Err(invalid(format!(
            "Installed file has changed: {}",
            target.display()
        )));
    }
    let bytes = fs::read(&target)?;
    if hash(&bytes) != file.sha256 {
        return Err(invalid(format!(
            "Installed file checksum failed: {}",
            target.display()
        )));
    }
    Ok(bytes)
}

fn remove_owned(base: &Path, files: &[OwnedFile], notes: &mut Vec<String>) -> io::Result<()> {
    reject_links(base)?;
    let mut dirs = BTreeSet::new();
    for record in files {
        let file = base.join(&record.path);
        if !file.exists() {
            continue;
        }
        if verified_bytes(base, record).is_err() {
            notes.push(format!(
                "Preserved changed or linked file: {}",
                file.display()
            ));
            continue;
        }
        match fs::remove_file(&file) {
            Ok(()) => {}
            Err(error) => {
                notes.push(format!(
                    "Preserved file still in use: {} ({error})",
                    file.display()
                ));
                continue;
            }
        }
        let mut parent = file.parent();
        while let Some(dir) = parent {
            if dir == base || !dir.starts_with(base) {
                break;
            }
            dirs.insert(dir.to_path_buf());
            parent = dir.parent();
        }
    }
    for directory in dirs.iter().rev() {
        let _ = fs::remove_dir(directory);
    }
    let _ = fs::remove_dir(base);
    Ok(())
}

fn registry_for(options: &Options, release: &Release, setup: &Path) -> Vec<RegistryEntry> {
    let folder = options.root.join(&release.directory);
    let mut entries = Vec::new();
    for (vendor, browser) in [
        (r"Google\Chrome", "chrome"),
        (r"Microsoft\Edge", "edge"),
        ("Mozilla", "firefox"),
        ("Chromium", "chromium"),
    ] {
        entries.push(RegistryEntry {
            key: format!(
                r"Software\{vendor}\NativeMessagingHosts\com.project_constellation.monitor"
            ),
            name: String::new(),
            value: Some(RegistryValue::string(
                &folder
                    .join(format!("hosts/{browser}.json"))
                    .to_string_lossy(),
            )),
        });
    }
    let command = format!(
        "\"{}\" uninstall --dir \"{}\"",
        setup.display(),
        options.root.display()
    );
    for (name, value) in [
        (
            "DisplayName",
            RegistryValue::string("Project Constellation"),
        ),
        ("DisplayVersion", RegistryValue::string(&release.version)),
        ("Publisher", RegistryValue::string("Project Constellation")),
        (
            "InstallLocation",
            RegistryValue::string(&options.root.to_string_lossy()),
        ),
        (
            "DisplayIcon",
            RegistryValue::string(&setup.to_string_lossy()),
        ),
        ("UninstallString", RegistryValue::string(&command)),
        (
            "QuietUninstallString",
            RegistryValue::string(&format!("{command} --quiet")),
        ),
        ("NoModify", RegistryValue::dword(1)),
        ("NoRepair", RegistryValue::dword(1)),
        (
            "EstimatedSize",
            RegistryValue::dword(
                (release.files.iter().map(|f| f.bytes).sum::<u64>() / 1024).min(u32::MAX as u64)
                    as u32,
            ),
        ),
    ] {
        entries.push(RegistryEntry {
            key: UNINSTALL_KEY.to_owned(),
            name: name.to_owned(),
            value: Some(value),
        });
    }
    entries
}

fn stop_owned_monitor(
    options: &Options,
    receipt: &Receipt,
    system: &mut dyn System,
) -> io::Result<()> {
    let executable =
        verified_release_executable(options, receipt, "runtime/constellation-monitor.exe")?;
    system.stop_monitor(&executable, &options.root.join("data/monitor"))
}

fn verified_release_executable(
    options: &Options,
    receipt: &Receipt,
    relative: &str,
) -> io::Result<PathBuf> {
    safe_relative(relative)?;
    if !relative.ends_with(".exe") {
        return Err(invalid(
            "The requested installed file is not an executable.",
        ));
    }
    let release = receipt
        .releases
        .iter()
        .find(|r| r.directory == receipt.active)
        .ok_or_else(|| invalid("Missing active release."))?;
    let record = release
        .files
        .iter()
        .find(|f| f.path == relative)
        .ok_or_else(|| {
            invalid(format!(
                "This installation does not own the requested executable: {relative}"
            ))
        })?;
    let folder = options.root.join(&release.directory);
    // Repair and uninstall must never execute a modified old binary.
    verified_bytes(&folder, record)?;
    Ok(folder.join(&record.path))
}

pub fn verified_executable(options: &Options, relative: &str) -> io::Result<PathBuf> {
    let receipt = read_receipt(options)?.ok_or_else(|| invalid("Install Constellation first."))?;
    verified_release_executable(options, &receipt, relative)
}

fn management_file(receipt: &Receipt) -> io::Result<(&Release, &OwnedFile)> {
    // Payload rollback intentionally keeps the newest installed manager. Its
    // bytes remain part of a working installation even when its runtime is idle.
    let release = receipt
        .releases
        .last()
        .ok_or_else(|| invalid("No installed management release was recorded."))?;
    let file = release
        .files
        .iter()
        .find(|file| file.path == "Constellation-Setup.exe")
        .ok_or_else(|| invalid("The latest installed release has no management executable."))?;
    Ok((release, file))
}

fn verify_management_file(options: &Options, receipt: &Receipt) -> io::Result<()> {
    let (release, file) = management_file(receipt)?;
    verified_bytes(&options.root.join(&release.directory), file).map(|_| ())
}

fn slot<'a>(entries: &'a [RegistryEntry], key: &str, name: &str) -> Option<&'a RegistryEntry> {
    entries
        .iter()
        .find(|entry| entry.key == key && entry.name == name)
}

fn owns_apps_group(expected: &[RegistryEntry], system: &mut dyn System) -> io::Result<bool> {
    // Anchors are restored last. Either surviving unique anchor establishes
    // ownership during a partial uninstall, whereas another install has neither.
    for name in ["InstallLocation", "UninstallString"] {
        if let Some(entry) = slot(expected, UNINSTALL_KEY, name)
            && entry.value.is_some()
            && system.read_registry(UNINSTALL_KEY, name)? == entry.value
        {
            return Ok(true);
        }
    }
    Ok(false)
}

fn rollback_apps_compatible(
    before: &[RegistryEntry],
    next: &[RegistryEntry],
    system: &mut dyn System,
) -> io::Result<bool> {
    // A partially applied transaction can have an old/new mixture. A newer
    // installation's distinct anchors must not be overwritten by recovery.
    for name in ["InstallLocation", "UninstallString"] {
        let actual = system.read_registry(UNINSTALL_KEY, name)?;
        let old = slot(before, UNINSTALL_KEY, name).and_then(|e| e.value.clone());
        let new = slot(next, UNINSTALL_KEY, name).and_then(|e| e.value.clone());
        if actual != old && actual != new {
            return Ok(false);
        }
    }
    Ok(true)
}

fn managed_predecessors(options: &Options, observed: &[RegistryEntry]) -> Vec<(Options, Receipt)> {
    let mut roots = BTreeSet::new();
    if let Some(root) = slot(observed, UNINSTALL_KEY, "InstallLocation")
        .and_then(|e| e.value.as_ref())
        .and_then(RegistryValue::as_string)
    {
        roots.insert(PathBuf::from(root));
    }
    // Native registrations are written before Apps values. Recognize even a
    // crashed first install from its owned versions/<id>/hosts manifest path.
    for entry in observed.iter().filter(|entry| entry.key != UNINSTALL_KEY) {
        if let Some(path) = entry.value.as_ref().and_then(RegistryValue::as_string) {
            let manifest = PathBuf::from(path);
            if let Some(hosts) = manifest.parent()
                && hosts.file_name().is_some_and(|n| n == "hosts")
                && let Some(versions) = hosts.parent().and_then(Path::parent)
                && versions.file_name().is_some_and(|n| n == "versions")
                && let Some(root) = versions.parent()
            {
                roots.insert(root.to_path_buf());
            }
        }
    }
    let mut result = Vec::new();
    for root in roots {
        let Ok(root) = canonical_root(&root) else {
            continue;
        };
        if root == options.root
            || read_optional(&root.join(MARKER), 256)
                .ok()
                .flatten()
                .as_deref()
                != Some(PRODUCT.as_bytes())
        {
            continue;
        }
        let previous_options = Options {
            root,
            ..options.clone()
        };
        let committed = read_receipt(&previous_options).ok().flatten();
        let pending = (|| {
            let bytes = read_optional(&previous_options.root.join(JOURNAL), MAX_RECEIPT)
                .ok()
                .flatten()?;
            let journal: Journal = serde_json::from_slice(&bytes).ok()?;
            if journal.schema != 1 || validate_receipt(&journal.next, &previous_options).is_err() {
                return None;
            }
            Some(journal.next)
        })();
        for receipt in [committed, pending].into_iter().flatten() {
            if !result
                .iter()
                .any(|(other_options, other): &(Options, Receipt)| {
                    other_options.root == previous_options.root && other.active == receipt.active
                })
            {
                result.push((previous_options.clone(), receipt));
            }
        }
    }
    result
}

fn encode_state<T: Serialize>(value: &T) -> io::Result<Vec<u8>> {
    let encoded = serde_json::to_vec_pretty(value)?;
    if encoded.len() > MAX_RECEIPT {
        return Err(invalid(
            "This installation has reached its recovery-history size limit. No registrations were changed. Keep it intact and use a new installation folder.",
        ));
    }
    Ok(encoded)
}

fn restore_shortcut(path: &Path, bytes: Option<&[u8]>) -> io::Result<()> {
    reject_links(path)?;
    if let Some(bytes) = bytes {
        fs::create_dir_all(path.parent().unwrap())?;
        platform::atomic_write(path, bytes)
    } else {
        match fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e),
        }
    }
}

fn clean_backup(options: &Options, journal: &Journal, notes: &mut Vec<String>) -> io::Result<()> {
    // Retire the old shared desktop name only after the new receipt commits.
    // A desktop installation that replaced it owns its bytes and stays intact.
    for shortcut in &journal.retired_shortcuts {
        if let Some(bytes) = read_optional(&shortcut.path, 1024 * 1024)? {
            if hash(&bytes) == shortcut.installed_sha256 {
                restore_shortcut(&shortcut.path, shortcut.original.as_deref())?;
                notes.push("Moved Setup to its separate Start Menu entry; restored the previous desktop entry.".to_owned());
            } else {
                notes.push(
                    "Preserved the desktop Start Menu entry changed outside Setup.".to_owned(),
                );
            }
        }
    }
    let backup = options.root.join(&journal.browser_backup);
    let backup_metadata = match fs::symlink_metadata(&backup) {
        Ok(metadata) => Some(metadata),
        Err(error) if error.kind() == io::ErrorKind::NotFound => None,
        Err(error) => return Err(error),
    };
    if let Some(metadata) = backup_metadata {
        if linked_entry(&metadata) {
            // Older setup versions could commit after moving a linked browser
            // root here. Preserve the link entry itself, including dangling
            // links; never inspect or remove anything inside its target.
            let preserved = options.root.join(format!(
                "preserved-browsers-link-{}-{}",
                journal.id,
                platform::random_hex(8)?
            ));
            reject_links(&preserved)?;
            match fs::symlink_metadata(&preserved) {
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                Err(error) => return Err(error),
                Ok(_) => {
                    return Err(invalid(
                        "The browser-link preservation path already exists.",
                    ));
                }
            }
            fs::rename(&backup, &preserved)?;
            notes.push(format!(
                "Preserved browser link without following its target: {}",
                preserved.display()
            ));
            return Ok(());
        }
        if let Some(before) = &journal.before {
            let files: Vec<_> = before
                .browser_files
                .iter()
                .map(|file| OwnedFile {
                    path: file.path.strip_prefix("browsers/").unwrap().to_owned(),
                    ..file.clone()
                })
                .collect();
            remove_owned(&backup, &files, notes)?;
        }
        if backup.exists() {
            let preserved = options
                .root
                .join(format!("preserved-browsers-{}", journal.id));
            fs::rename(&backup, &preserved)?;
            notes.push(format!(
                "Preserved browser files changed outside Setup: {}",
                preserved.display()
            ));
        }
    }
    Ok(())
}

fn undo(options: &Options, journal: &Journal, system: &mut dyn System) -> io::Result<Vec<String>> {
    let mut failures = Vec::new();
    let mut notes = Vec::new();
    let apps_compatible = rollback_apps_compatible(
        &journal.registry_before,
        &journal.next.current_registry,
        system,
    )?;
    for old in &journal.registry_before {
        let actual = system.read_registry(&old.key, &old.name)?;
        if actual == old.value {
            continue;
        }
        let next =
            slot(&journal.next.current_registry, &old.key, &old.name).and_then(|e| e.value.clone());
        if actual == next && (old.key != UNINSTALL_KEY || apps_compatible) {
            if let Err(error) = system.write_registry(old) {
                failures.push(format!("Registry rollback: {error}"));
            }
        } else {
            notes.push(format!(
                "Preserved a later registry change during recovery: {} / {}",
                old.key, old.name
            ));
        }
    }
    if let Some(shortcut) = journal.next.shortcut.as_ref().map(|s| &s.path) {
        let actual = read_optional(shortcut, 1024 * 1024)?;
        if actual != journal.shortcut_before {
            let next_hash = journal
                .next
                .shortcut
                .as_ref()
                .map(|s| s.installed_sha256.as_str());
            if actual
                .as_ref()
                .is_some_and(|bytes| Some(hash(bytes).as_str()) == next_hash)
            {
                if let Err(error) = restore_shortcut(shortcut, journal.shortcut_before.as_deref()) {
                    failures.push(format!("Shortcut rollback: {error}"));
                }
            } else {
                notes.push("Preserved a later Start Menu shortcut during recovery.".to_owned());
            }
        }
    }
    let browser = options.root.join("browsers");
    let backup = options.root.join(&journal.browser_backup);
    if backup.exists() || !journal.had_browsers {
        let files: Vec<_> = journal
            .next
            .browser_files
            .iter()
            .map(|file| OwnedFile {
                path: file.path.strip_prefix("browsers/").unwrap().to_owned(),
                ..file.clone()
            })
            .collect();
        if let Err(error) = remove_owned(&browser, &files, &mut notes) {
            failures.push(format!("Browser rollback cleanup: {error}"));
        }
        // A browser or user can write into the new sensor tree before a later
        // installation step fails. Keep those exact bytes outside the active
        // path so they do not block restoration of the previous directory.
        // Never overwrite a preservation folder left by an interrupted retry.
        if backup.exists() && browser.exists() {
            let preserved = options.root.join(format!(
                "preserved-browsers-recovery-{}-{}",
                journal.id,
                platform::random_hex(4)?
            ));
            if let Err(error) = reject_links(&browser)
                .and_then(|()| reject_links(&preserved))
                .and_then(|()| fs::rename(&browser, &preserved))
            {
                failures.push(format!("Browser recovery preservation: {error}"));
            } else {
                notes.push(format!(
                    "Preserved browser files changed during the failed installation: {}",
                    preserved.display()
                ));
            }
        }
        if backup.exists()
            && let Err(error) = fs::rename(&backup, &browser)
        {
            failures.push(format!("Browser rollback: {error}"));
        }
    }
    if let Some(before) = &journal.before {
        if let Err(error) = platform::atomic_write(
            &options.root.join(RECEIPT),
            &serde_json::to_vec_pretty(before)?,
        ) {
            failures.push(format!("Receipt rollback: {error}"));
        }
    } else if options.root.join(RECEIPT).exists()
        && let Err(error) = fs::remove_file(options.root.join(RECEIPT))
    {
        failures.push(format!("Receipt rollback: {error}"));
    }
    if failures.is_empty() {
        if let Some(release) = &journal.introduced_release {
            remove_owned(
                &options.root.join(&release.directory),
                &release.files,
                &mut notes,
            )?;
        }
        let stage = options.root.join(&journal.browser_stage);
        let files: Vec<_> = journal
            .next
            .browser_files
            .iter()
            .map(|file| OwnedFile {
                path: file.path.strip_prefix("browsers/").unwrap().to_owned(),
                ..file.clone()
            })
            .collect();
        remove_owned(&stage, &files, &mut notes)?;
        fs::remove_file(options.root.join(JOURNAL))?;
        Ok(notes)
    } else {
        // Successful preservation still matters when a different rollback step
        // needs a retry; that retry may no longer encounter the preserved tree.
        failures.extend(notes);
        Err(invalid(format!(
            "{}\nRecovery journal retained. Run Install / Repair again to retry recovery.",
            failures.join("\n")
        )))
    }
}

fn recover(options: &Options, system: &mut dyn System) -> io::Result<Vec<String>> {
    let Some(bytes) = read_optional(&options.root.join(JOURNAL), MAX_RECEIPT)? else {
        return Ok(Vec::new());
    };
    let journal: Journal = serde_json::from_slice(&bytes)?;
    if journal.schema != 1
        || journal.id.is_empty()
        || !journal.id.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err(invalid("Invalid recovery journal."));
    }
    validate_receipt(&journal.next, options)?;
    if let Some(before) = &journal.before {
        validate_receipt(before, options)?;
    }
    validate_registry(&journal.registry_before)?;
    if journal.retired_shortcuts.len() > 32 {
        return Err(invalid("Invalid retired shortcut receipt."));
    }
    for shortcut in &journal.retired_shortcuts {
        validate_shortcut(shortcut, options)?;
        if legacy_shortcut_path(options).as_ref() != Some(&shortcut.path)
            || journal
                .next
                .shortcut
                .as_ref()
                .is_some_and(|s| s.path == shortcut.path)
        {
            return Err(invalid("Invalid retired shortcut location."));
        }
    }
    if journal.browser_backup != format!(".browser-backup-{}", journal.id)
        || journal.browser_stage != format!(".browser-stage-{}", journal.id)
    {
        return Err(invalid("Invalid recovery paths."));
    }
    if let Some(release) = &journal.introduced_release {
        validate_release(release)?;
    }
    if read_receipt(options)?.is_some_and(|current| current.transaction_id == journal.id) {
        let mut notes =
            vec!["Completed cleanup of the previous successful installation.".to_owned()];
        clean_backup(options, &journal, &mut notes)?;
        fs::remove_file(options.root.join(JOURNAL))?;
        Ok(notes)
    } else {
        let mut notes = undo(options, &journal, system)?;
        notes.push(
            "Recovered an interrupted installation and restored its previous registrations."
                .to_owned(),
        );
        Ok(notes)
    }
}

fn activate(
    options: &Options,
    before: Option<Receipt>,
    release: Release,
    introduced: bool,
    system: &mut dyn System,
    mut notes: Vec<String>,
) -> io::Result<Outcome> {
    // Reject a relocated sensor root before a journal or global mutation. A
    // committed backup containing that link would otherwise block cleanup.
    reject_links(&options.root.join("browsers"))?;
    let id = platform::random_hex(8)?;
    let stage_name = format!(".browser-stage-{id}");
    let stage = options.root.join(&stage_name);
    platform::secure_directory(&stage)?;
    let mut stage_guard = StageGuard {
        directory: stage.clone(),
        files: Vec::new(),
    };
    let release_root = options.root.join(&release.directory);
    let mut browser_files = Vec::new();
    for file in &release.files {
        if let Some(relative) = file.path.strip_prefix("browsers/") {
            let bytes = verified_bytes(&release_root, file)?;
            stage_guard.files.push(new_file(&stage, relative, &bytes)?);
            browser_files.push(file.clone());
        }
    }
    // Verify the executable and all host manifests before changing any pointers.
    for file in &release.files {
        verified_bytes(&release_root, file)?;
    }
    // Keep management on the latest installed manager during a payload
    // rollback. An older candidate manager cannot interpret a migrated entry.
    let manager_release = if introduced {
        &release
    } else {
        before
            .as_ref()
            .and_then(|r| r.releases.last())
            .unwrap_or(&release)
    };
    let manager_root = options.root.join(&manager_release.directory);
    let manager_record = manager_release
        .files
        .iter()
        .find(|file| file.path == "Constellation-Setup.exe")
        .ok_or_else(|| invalid("The latest installed release has no management executable."))?;
    verified_bytes(&manager_root, manager_record)?;
    let manager = manager_root.join("Constellation-Setup.exe");
    let current_registry = registry_for(options, &release, &manager);
    let mut registry_before = Vec::new();
    for entry in &current_registry {
        registry_before.push(RegistryEntry {
            value: system.read_registry(&entry.key, &entry.name)?,
            ..entry.clone()
        });
    }
    let shortcut_before = options
        .shortcut
        .as_ref()
        .map(|p| read_optional(p, 1024 * 1024))
        .transpose()?
        .flatten();
    let predecessors = managed_predecessors(options, &registry_before);
    let mut initial_registry = before
        .as_ref()
        .map(|r| r.initial_registry.clone())
        .unwrap_or_else(|| registry_before.clone());
    let mut original_shortcut = before
        .as_ref()
        .and_then(|r| r.shortcut.as_ref())
        .filter(|s| options.shortcut.as_ref() == Some(&s.path))
        .map(|s| s.original.clone())
        .unwrap_or_else(|| shortcut_before.clone());
    if before.is_none() {
        // A second managed root inherits the original pre-Constellation
        // baseline; uninstall never resurrects paths from a deleted predecessor.
        for (_, predecessor) in &predecessors {
            let owns_apps = ["InstallLocation", "UninstallString"].iter().any(|name| {
                let owned = slot(&predecessor.current_registry, UNINSTALL_KEY, name)
                    .and_then(|e| e.value.clone());
                owned.is_some()
                    && slot(&registry_before, UNINSTALL_KEY, name).and_then(|e| e.value.clone())
                        == owned
            });
            for entry in &mut initial_registry {
                if entry.key == UNINSTALL_KEY && !owns_apps {
                    continue;
                }
                let actual =
                    slot(&registry_before, &entry.key, &entry.name).and_then(|e| e.value.clone());
                let owned = slot(&predecessor.current_registry, &entry.key, &entry.name)
                    .and_then(|e| e.value.clone());
                if actual == owned
                    && owned.is_some()
                    && let Some(original) =
                        slot(&predecessor.initial_registry, &entry.key, &entry.name)
                {
                    entry.value = original.value.clone();
                }
            }
            if let Some(shortcut) = &predecessor.shortcut
                && options.shortcut.as_ref() == Some(&shortcut.path)
                && shortcut_before
                    .as_ref()
                    .is_some_and(|bytes| hash(bytes) == shortcut.installed_sha256)
            {
                original_shortcut = shortcut.original.clone();
            }
        }
    }
    let shortcut_bytes = if options.shortcut.is_some() {
        Some(system.shortcut_bytes(&manager, &options.root)?)
    } else {
        None
    };
    let mut releases = before
        .as_ref()
        .map(|r| r.releases.clone())
        .unwrap_or_default();
    if introduced {
        releases.push(release.clone());
    }
    let next = Receipt {
        schema: 1,
        product: PRODUCT.to_owned(),
        root: options.root.clone(),
        active: release.directory.clone(),
        version: release.version.clone(),
        payload_sha256: release.payload_sha256.clone(),
        transaction_id: id.clone(),
        releases,
        initial_registry,
        current_registry,
        shortcut: options.shortcut.as_ref().map(|path| Shortcut {
            path: path.clone(),
            original: original_shortcut,
            installed_sha256: hash(shortcut_bytes.as_ref().unwrap()),
        }),
        browser_files,
    };
    let retired_shortcuts = before
        .iter()
        .chain(predecessors.iter().map(|(_, receipt)| receipt))
        .filter_map(|receipt| receipt.shortcut.as_ref())
        .filter(|shortcut| legacy_shortcut_path(options).as_ref() == Some(&shortcut.path))
        .cloned()
        .collect();
    let journal = Journal {
        schema: 1,
        id,
        before: before.clone(),
        next: next.clone(),
        registry_before,
        shortcut_before,
        retired_shortcuts,
        browser_backup: format!(".browser-backup-{}", next.transaction_id),
        browser_stage: stage_name,
        had_browsers: options.root.join("browsers").exists(),
        introduced_release: introduced.then_some(release.clone()),
    };
    validate_receipt(&next, options)?;
    let next_bytes = encode_state(&next)?;
    let journal_bytes = encode_state(&journal)?;
    platform::atomic_write(&options.root.join(JOURNAL), &journal_bytes)?;
    let result = (|| -> io::Result<()> {
        if journal.had_browsers {
            fs::rename(
                options.root.join("browsers"),
                options.root.join(&journal.browser_backup),
            )?;
        }
        fs::rename(&stage, options.root.join("browsers"))?;
        for entry in &next.current_registry {
            system.write_registry(entry)?;
        }
        if let Some(path) = &options.shortcut {
            restore_shortcut(path, shortcut_bytes.as_deref())?;
        }
        platform::atomic_write(&options.root.join(RECEIPT), &next_bytes)?;
        Ok(())
    })();
    if let Err(error) = result {
        return match undo(options, &journal, system) {
            Ok(notes) => {
                let detail = if notes.is_empty() {
                    String::new()
                } else {
                    format!("\n{}", notes.join("\n"))
                };
                Err(invalid(format!(
                    "Setup failed and restored the previous installation: {error}{detail}"
                )))
            }
            Err(rollback) => Err(invalid(format!("Setup failed: {error}\n{rollback}"))),
        };
    }
    // Retire old hubs only after the new host registration and receipt commit.
    // Existing ports then reconnect through the new executable/data location.
    if let Some(before) = &before
        && let Err(error) = stop_owned_monitor(options, before, system)
    {
        notes.push(format!("Previous hub shutdown: {error}. Its versioned files remain available while existing hosts finish."));
    }
    for (old_options, predecessor) in &predecessors {
        if let Err(error) = stop_owned_monitor(old_options, predecessor, system) {
            notes.push(format!("Previous installation hub shutdown: {error}"));
        }
    }
    // The receipt is the commit marker. A cleanup error never undoes a committed
    // install; the next run finishes the retained journal before any new work.
    if let Err(error) = clean_backup(options, &journal, &mut notes)
        .and_then(|()| fs::remove_file(options.root.join(JOURNAL)))
    {
        notes.push(format!(
            "Installed successfully; cleanup will retry next run: {error}"
        ));
    }
    notes.push("Native hosts are registered for this Windows user. Enable the sensor in each browser/profile to connect it.".to_owned());
    notes.push("The hub starts when a sensor connects, exits after the last sensor disconnects, and starts again on demand.".to_owned());
    if before.is_some() {
        notes.push("Reload the unpacked extension in each browser to activate the updated files at the stable browsers folder.".to_owned());
    }
    Ok(Outcome {
        ok: true,
        action: if introduced {
            "installed"
        } else {
            "rolled_back"
        }
        .to_owned(),
        root: options.root.clone(),
        version: Some(release.version),
        browser_confirmation_required: true,
        notes,
    })
}

pub fn install(
    options: &Options,
    payload: &Payload<'_>,
    system: &mut dyn System,
) -> io::Result<Outcome> {
    let (options, _lock) = prepare(options)?;
    let notes = recover(&options, system)?;
    let before = read_receipt(&options)?;
    if let Some(previous) = &before {
        let current = previous
            .releases
            .iter()
            .find(|r| r.directory == previous.active)
            .unwrap();
        if current.payload_sha256 == payload.sha256
            && current.version == payload.manifest.version
            && current
                .files
                .iter()
                .find(|f| f.path == "Constellation-Setup.exe")
                .is_some_and(|f| {
                    fs::read(&options.setup_exe).is_ok_and(|bytes| hash(&bytes) == f.sha256)
                })
            && current
                .files
                .iter()
                .all(|f| verified_bytes(&options.root.join(&current.directory), f).is_ok())
            && (previous
                .releases
                .last()
                .is_some_and(|manager| manager.directory == current.directory)
                || verify_management_file(&options, previous).is_ok())
        {
            let mut outcome = activate(
                &options,
                before.clone(),
                current.clone(),
                false,
                system,
                notes,
            )?;
            outcome.action = "repaired".to_owned();
            return Ok(outcome);
        }
    }
    let id = format!(
        "{}-{}-{}",
        payload.manifest.version,
        &payload.sha256[..16],
        platform::random_hex(4)?
    );
    let directory = format!("versions/{id}");
    let stage = options.root.join(format!(".release-stage-{id}"));
    platform::secure_directory(&stage)?;
    platform::secure_directory(&options.root.join("data/monitor"))?;
    let mut files = Vec::new();
    let result = (|| -> io::Result<()> {
        for record in &payload.manifest.files {
            files.push(new_file(&stage, &record.path, payload.contents(record))?);
        }
        let config =
            serde_json::to_vec_pretty(&json!({"dataDir":options.root.join("data/monitor")}))?;
        files.push(new_file(
            &stage,
            "runtime/constellation-monitor.config.json",
            &config,
        )?);
        let monitor = options
            .root
            .join(&directory)
            .join("runtime/constellation-monitor.exe");
        for browser in ["chrome", "edge", "firefox", "chromium"] {
            let manifest = host_manifest(browser, &monitor, CHROMIUM_ID, FIREFOX_ID)?;
            files.push(new_file(
                &stage,
                &format!("hosts/{browser}.json"),
                &serde_json::to_vec_pretty(&manifest)?,
            )?);
        }
        reject_links(&options.setup_exe)?;
        let setup = fs::read(&options.setup_exe)?;
        files.push(new_file(&stage, "Constellation-Setup.exe", &setup)?);
        files.push(new_file(
            &stage,
            "PAYLOAD-MANIFEST.json",
            &serde_json::to_vec_pretty(&payload.manifest)?,
        )?);
        Ok(())
    })();
    if let Err(error) = result {
        let _ = remove_owned(&stage, &files, &mut Vec::new());
        return Err(error);
    }
    platform::secure_directory(&options.root.join("versions"))?;
    let release_root = options.root.join(&directory);
    fs::rename(&stage, &release_root)?;
    let release = Release {
        directory,
        version: payload.manifest.version.clone(),
        payload_sha256: payload.sha256.clone(),
        files,
    };
    let result = activate(&options, before, release.clone(), true, system, notes);
    // Failures before the journal exists have made no global changes.
    if result.is_err() && !options.root.join(JOURNAL).exists() {
        let active = read_receipt(&options)?.is_some_and(|r| r.active == release.directory);
        if !active {
            let _ = remove_owned(&release_root, &release.files, &mut Vec::new());
        }
    }
    result
}

pub fn rollback(options: &Options, system: &mut dyn System) -> io::Result<Outcome> {
    let (options, _lock) = prepare(options)?;
    let notes = recover(&options, system)?;
    let before = read_receipt(&options)?
        .ok_or_else(|| invalid("There is no installed release to roll back."))?;
    let position = before
        .releases
        .iter()
        .position(|r| r.directory == before.active)
        .unwrap();
    let release = position
        .checked_sub(1)
        .and_then(|index| before.releases.get(index))
        .cloned()
        .ok_or_else(|| invalid("No earlier installed release is available."))?;
    activate(&options, Some(before), release, false, system, notes)
}

pub fn uninstall(options: &Options, system: &mut dyn System) -> io::Result<Outcome> {
    let (options, _lock) = prepare(options)?;
    let mut notes = recover(&options, system)?;
    let before = read_receipt(&options)?
        .ok_or_else(|| invalid("There is no managed installation in this folder."))?;
    // Compare before restoring so another installation's registrations survive.
    // On a partial failure the intact receipt lets Uninstall safely retry.
    let owns_apps = owns_apps_group(&before.current_registry, system)?;
    let mut entries = before.current_registry.clone();
    entries.sort_by_key(|entry| {
        if entry.key == UNINSTALL_KEY && entry.name == "InstallLocation" {
            2
        } else if entry.key == UNINSTALL_KEY && entry.name == "UninstallString" {
            1
        } else {
            0
        }
    });
    for installed in &entries {
        if installed.key == UNINSTALL_KEY && !owns_apps {
            continue;
        }
        let current = system.read_registry(&installed.key, &installed.name)?;
        if current == installed.value {
            let original = before
                .initial_registry
                .iter()
                .find(|r| r.key == installed.key && r.name == installed.name)
                .ok_or_else(|| invalid("Missing original registry value."))?;
            if let Err(error) = system.write_registry(original) {
                return Err(invalid(format!(
                    "A registration could not be restored: {error}. Files and receipt remain intact; retry Uninstall. Ownership anchors are restored last."
                )));
            }
        } else {
            notes.push(format!(
                "Preserved registry value changed outside Setup: {} / {}",
                installed.key, installed.name
            ));
        }
    }
    if !owns_apps {
        notes.push(
            "Preserved the Apps & Features entry owned by a different installation.".to_owned(),
        );
    }
    // Remove this install's discovery pointers before stopping it, so a live
    // browser cannot immediately relaunch the same runtime during cleanup.
    if let Err(error) = stop_owned_monitor(&options, &before, system) {
        notes.push(format!("Hub stop: {error}"));
    }
    if let Some(shortcut) = &before.shortcut
        && let Some(bytes) = read_optional(&shortcut.path, 1024 * 1024)?
    {
        if hash(&bytes) == shortcut.installed_sha256 {
            restore_shortcut(&shortcut.path, shortcut.original.as_deref())?;
        } else {
            notes.push("Preserved a Start Menu shortcut changed outside Setup.".to_owned());
        }
    }
    remove_owned(&options.root, &before.browser_files, &mut notes)?;
    for release in &before.releases {
        remove_owned(
            &options.root.join(&release.directory),
            &release.files,
            &mut notes,
        )?;
    }
    platform::atomic_write(
        &options.root.join("constellation-uninstalled.json"),
        &serde_json::to_vec_pretty(&before)?,
    )?;
    fs::remove_file(options.root.join(RECEIPT))?;
    notes.push(format!(
        "Preserved your monitor settings and incident history in {}. Computer Tools exports and sessions outside this installation are untouched.",
        options.root.join("data").display()
    ));
    notes.push("Remove the browser sensors from each browser's extension settings. Browser profiles and permissions are never rewritten by Setup.".to_owned());
    Ok(Outcome {
        ok: true,
        action: "uninstalled".to_owned(),
        root: options.root,
        version: Some(before.version),
        browser_confirmation_required: false,
        notes,
    })
}

pub fn verify(options: &Options) -> io::Result<serde_json::Value> {
    let receipt =
        read_receipt(options)?.ok_or_else(|| invalid("No installation receipt was found."))?;
    let release = receipt
        .releases
        .iter()
        .find(|r| r.directory == receipt.active)
        .unwrap();
    let mut changed = Vec::new();
    let mut checked_files = release.files.len() + receipt.browser_files.len();
    for file in &release.files {
        if let Err(error) = verified_bytes(&options.root.join(&release.directory), file) {
            changed.push(error.to_string());
        }
    }
    for file in &receipt.browser_files {
        if let Err(error) = verified_bytes(&options.root, file) {
            changed.push(error.to_string());
        }
    }
    let management_release = match management_file(&receipt) {
        Ok((manager, file)) => {
            if manager.directory != release.directory {
                checked_files += 1;
                if let Err(error) = verified_bytes(&options.root.join(&manager.directory), file) {
                    changed.push(format!(
                        "Installed management executable needs repair: {error}"
                    ));
                }
            }
            Some(&manager.directory)
        }
        Err(error) => {
            changed.push(error.to_string());
            None
        }
    };
    let transaction_pending = options.root.join(JOURNAL).exists();
    Ok(
        json!({"ok":changed.is_empty() && !transaction_pending,"version":receipt.version,"active":receipt.active,"managementRelease":management_release,"root":options.root,"checkedFiles":checked_files,"changed":changed,"transactionPending":transaction_pending,"browserConfirmationRequired":true}),
    )
}
