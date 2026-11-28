//! Windows integration uses fixed per-user registry slots and direct APIs.
//! No PowerShell, browser profile editing, policy keys, services or tasks.
use crate::{
    engine::{self, Options},
    system::{RegistryEntry, RegistryValue, System, valid_registry_slot},
};
use constellation_monitor::platform;
use std::{
    ffi::OsStr,
    fs,
    io::{self, Read},
    os::windows::{ffi::OsStrExt, process::CommandExt},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};
use windows::{
    Win32::{
        Foundation::{
            CloseHandle, ERROR_FILE_NOT_FOUND, ERROR_SUCCESS, GlobalFree, HANDLE, HWND, LPARAM,
            WIN32_ERROR,
        },
        System::{
            Com::{
                CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, CoCreateInstance, CoInitializeEx,
                CoUninitialize, IPersistFile,
            },
            DataExchange::{CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData},
            Memory::{GMEM_MOVEABLE, GlobalAlloc, GlobalLock, GlobalUnlock},
            Registry::*,
            Threading::{CreateMutexW, ReleaseMutex, WaitForSingleObject},
        },
        UI::{
            Shell::{IShellLinkW, ShellExecuteW, ShellLink},
            WindowsAndMessaging::{
                EnumWindows, GetClassNameW, GetWindowThreadProcessId, IsWindowVisible,
                SW_SHOWNORMAL,
            },
        },
    },
    core::{BOOL, Interface, PCWSTR, w},
};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub fn wide(value: impl AsRef<OsStr>) -> Vec<u16> {
    value.as_ref().encode_wide().chain(Some(0)).collect()
}
pub fn error(value: windows::core::Error) -> io::Error {
    io::Error::other(value.to_string())
}
fn status(value: WIN32_ERROR) -> io::Result<()> {
    if value == ERROR_SUCCESS {
        Ok(())
    } else {
        Err(io::Error::from_raw_os_error(value.0 as i32))
    }
}

struct Key(HKEY);
impl Drop for Key {
    fn drop(&mut self) {
        unsafe {
            let _ = RegCloseKey(self.0);
        }
    }
}

fn read_value(hive: HKEY, path: &str, name: &str) -> io::Result<Option<RegistryValue>> {
    let path = wide(path);
    let name = wide(name);
    let mut handle = HKEY::default();
    let result = unsafe {
        RegOpenKeyExW(
            hive,
            PCWSTR(path.as_ptr()),
            None,
            KEY_QUERY_VALUE,
            &mut handle,
        )
    };
    if result == ERROR_FILE_NOT_FOUND {
        return Ok(None);
    }
    status(result)?;
    let key = Key(handle);
    let mut kind = REG_VALUE_TYPE::default();
    let mut length = 0;
    let result = unsafe {
        RegQueryValueExW(
            key.0,
            PCWSTR(name.as_ptr()),
            None,
            Some(&mut kind),
            None,
            Some(&mut length),
        )
    };
    if result == ERROR_FILE_NOT_FOUND {
        return Ok(None);
    }
    status(result)?;
    if length > 1024 * 1024 {
        return Err(io::Error::other(
            "Registry value exceeds the installation limit.",
        ));
    }
    let mut bytes = vec![0; length as usize];
    status(unsafe {
        RegQueryValueExW(
            key.0,
            PCWSTR(name.as_ptr()),
            None,
            Some(&mut kind),
            Some(bytes.as_mut_ptr()),
            Some(&mut length),
        )
    })?;
    bytes.truncate(length as usize);
    Ok(Some(RegistryValue {
        kind: kind.0,
        bytes,
    }))
}

pub struct WindowsSystem {
    operation_mutex: HANDLE,
}
impl WindowsSystem {
    pub fn new() -> io::Result<Self> {
        // Native-host registrations are shared across installation folders.
        // Serialize those mutations for this user/session as well as locking
        // each installation folder in the platform-neutral transaction engine.
        let identity = std::env::var("USERPROFILE")
            .unwrap_or_default()
            .to_lowercase();
        let name = format!(
            r"Local\ProjectConstellation.Setup.{}",
            &crate::payload::hash(identity.as_bytes())[..24]
        );
        let operation_mutex =
            unsafe { CreateMutexW(None, false, PCWSTR(wide(name).as_ptr())) }.map_err(error)?;
        let result = unsafe { WaitForSingleObject(operation_mutex, 0) };
        if result.0 != 0 && result.0 != 0x80 {
            unsafe {
                let _ = CloseHandle(operation_mutex);
            }
            return Err(io::Error::other(
                "Another Constellation setup is changing this user's browser registrations. Finish that operation first.",
            ));
        }
        Ok(Self { operation_mutex })
    }
}
impl Drop for WindowsSystem {
    fn drop(&mut self) {
        unsafe {
            let _ = ReleaseMutex(self.operation_mutex);
            let _ = CloseHandle(self.operation_mutex);
        }
    }
}
impl System for WindowsSystem {
    fn read_registry(&mut self, key: &str, name: &str) -> io::Result<Option<RegistryValue>> {
        if !valid_registry_slot(key, name) {
            return Err(io::Error::other("Unmanaged registry slot."));
        }
        read_value(HKEY_CURRENT_USER, key, name)
    }
    fn write_registry(&mut self, entry: &RegistryEntry) -> io::Result<()> {
        if !valid_registry_slot(&entry.key, &entry.name) {
            return Err(io::Error::other("Unmanaged registry slot."));
        }
        let path = wide(&entry.key);
        let name = wide(&entry.name);
        let mut handle = HKEY::default();
        if let Some(value) = &entry.value {
            status(unsafe {
                RegCreateKeyExW(
                    HKEY_CURRENT_USER,
                    PCWSTR(path.as_ptr()),
                    None,
                    PCWSTR::null(),
                    REG_OPTION_NON_VOLATILE,
                    KEY_SET_VALUE,
                    None,
                    &mut handle,
                    None,
                )
            })?;
            let key = Key(handle);
            status(unsafe {
                RegSetValueExW(
                    key.0,
                    PCWSTR(name.as_ptr()),
                    None,
                    REG_VALUE_TYPE(value.kind),
                    Some(&value.bytes),
                )
            })
        } else {
            let result = unsafe {
                RegOpenKeyExW(
                    HKEY_CURRENT_USER,
                    PCWSTR(path.as_ptr()),
                    None,
                    KEY_SET_VALUE,
                    &mut handle,
                )
            };
            if result == ERROR_FILE_NOT_FOUND {
                return Ok(());
            }
            status(result)?;
            let key = Key(handle);
            let result = unsafe { RegDeleteValueW(key.0, PCWSTR(name.as_ptr())) };
            if result == ERROR_FILE_NOT_FOUND {
                Ok(())
            } else {
                status(result)
            }
        }
    }
    fn shortcut_bytes(&mut self, executable: &Path, root: &Path) -> io::Result<Vec<u8>> {
        let folder =
            std::env::temp_dir().join(format!("Constellation-Link-{}", platform::random_hex(8)?));
        platform::secure_directory(&folder)?;
        let file = folder.join("Constellation.lnk");
        let initialized = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }.is_ok();
        let result = (|| -> io::Result<Vec<u8>> {
            let link: IShellLinkW =
                unsafe { CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER) }
                    .map_err(error)?;
            unsafe {
                link.SetPath(PCWSTR(wide(executable).as_ptr()))
                    .map_err(error)?;
                link.SetArguments(PCWSTR(
                    wide(format!("manage --dir \"{}\"", root.display())).as_ptr(),
                ))
                .map_err(error)?;
                link.SetWorkingDirectory(PCWSTR(wide(root).as_ptr()))
                    .map_err(error)?;
                link.SetDescription(w!(
                    "Set up browsers, check Constellation, or open Computer Tools"
                ))
                .map_err(error)?;
                let persist: IPersistFile = link.cast().map_err(error)?;
                persist
                    .Save(PCWSTR(wide(&file).as_ptr()), true)
                    .map_err(error)?;
            }
            fs::read(&file)
        })();
        if initialized {
            unsafe { CoUninitialize() };
        }
        let _ = fs::remove_file(file);
        let _ = fs::remove_dir(folder);
        result
    }
    fn stop_monitor(&mut self, executable: &Path, data: &Path) -> io::Result<()> {
        if !data.join("endpoint.json").exists() {
            return Ok(());
        }
        let output = run_monitor(executable, "stop", data)?;
        if output.0 {
            let deadline = Instant::now() + Duration::from_secs(5);
            while data.join("endpoint.json").exists() && Instant::now() < deadline {
                thread::sleep(Duration::from_millis(40));
            }
            if data.join("endpoint.json").exists() {
                Err(io::Error::other(
                    "A browser hub is still connected. Its versioned files will be retained while it finishes.",
                ))
            } else {
                Ok(())
            }
        } else {
            Err(io::Error::other(output.1))
        }
    }
}

pub fn default_root() -> io::Result<PathBuf> {
    std::env::var_os("LOCALAPPDATA")
        .map(|v| PathBuf::from(v).join("Project Constellation"))
        .ok_or_else(|| {
            io::Error::other(
                "LOCALAPPDATA is unavailable; supply --dir with a writable local folder.",
            )
        })
}

pub fn shortcut_path() -> io::Result<PathBuf> {
    std::env::var_os("APPDATA")
        .map(|v| {
            PathBuf::from(v).join("Microsoft/Windows/Start Menu/Programs/Project Constellation.lnk")
        })
        .ok_or_else(|| io::Error::other("Current-user Start Menu location is unavailable."))
}

pub fn options(root: PathBuf) -> io::Result<Options> {
    Ok(Options {
        root,
        setup_exe: std::env::current_exe()?,
        shortcut: Some(shortcut_path()?),
    })
}

pub fn run_monitor(executable: &Path, command: &str, data: &Path) -> io::Result<(bool, String)> {
    if !["doctor", "stop", "snapshot"].contains(&command) {
        return Err(io::Error::other("Unsupported diagnostic command."));
    }
    let mut child = Command::new(executable)
        .args([command, "--data-dir"])
        .arg(data)
        .creation_flags(CREATE_NO_WINDOW)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null())
        .spawn()?;
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let out = thread::spawn(move || {
        let mut result = String::new();
        let _ = stdout.take(1024 * 1024).read_to_string(&mut result);
        result
    });
    let err = thread::spawn(move || {
        let mut result = String::new();
        let _ = stderr.take(1024 * 1024).read_to_string(&mut result);
        result
    });
    let start = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }
        if start.elapsed() > Duration::from_secs(15) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "The native diagnostic did not finish within 15 seconds.",
            ));
        }
        thread::sleep(Duration::from_millis(40));
    };
    Ok((
        status.success(),
        format!(
            "{}{}",
            out.join().unwrap_or_default(),
            err.join().unwrap_or_default()
        ),
    ))
}

pub fn doctor_report(options: &Options) -> io::Result<serde_json::Value> {
    let integrity = engine::verify(options)?;
    let receipt = engine::read_receipt(options)?.ok_or_else(|| {
        io::Error::other("No installation receipt was found. Run Install / Repair first.")
    })?;
    let mut integrations = Vec::new();
    for entry in &receipt.current_registry {
        let actual = read_value(HKEY_CURRENT_USER, &entry.key, &entry.name)?;
        integrations.push(serde_json::json!({
            "key": entry.key, "name": entry.name, "matches": actual == entry.value
        }));
    }
    let shortcut_ok = receipt.shortcut.as_ref().is_none_or(|shortcut| {
        fs::read(&shortcut.path)
            .map(|bytes| crate::payload::hash(&bytes) == shortcut.installed_sha256)
            .unwrap_or(false)
    });
    let integrations_ok = integrations.iter().all(|entry| entry["matches"] == true);
    if integrity["ok"] != true {
        return Ok(serde_json::json!({
            "ok": false, "integrity": integrity, "integrations": integrations,
            "shortcutMatches": shortcut_ok, "native": null,
            "nextStep": "Run Install / Repair before starting the installed native tools."
        }));
    }
    let (native_exit_success, native_output) = run_monitor(
        &engine::verified_executable(options, "runtime/constellation-monitor.exe")?,
        "doctor",
        &options.root.join("data/monitor"),
    )?;
    let native: serde_json::Value = serde_json::from_str(&native_output)
        .unwrap_or_else(|_| serde_json::json!({"diagnosticError": native_output}));
    // An idle hub is healthy: native messaging starts it when a sensor calls.
    // Corrupt persisted state, failed execution, or malformed diagnostics are
    // failures even when the installed file hashes still match.
    let state_ok = matches!(native["state"].as_str(), Some("valid" | "not created yet"));
    let ok = native_exit_success
        && state_ok
        && integrations_ok
        && shortcut_ok
        && integrity["transactionPending"] != true;
    Ok(serde_json::json!({
        "ok": ok, "integrity": integrity, "integrations": integrations,
        "shortcutMatches": shortcut_ok, "nativeExitSuccess": native_exit_success,
        "native": native, "browserConfirmationRequired": true,
        "nextStep": if ok {
            "Enable a sensor in each browser profile, then use Agent Monitor's Test alert. An idle hub starts automatically when called."
        } else {
            "Review the failed checks. Install / Repair restores files and registrations; preserved data is never overwritten to hide an error."
        }
    }))
}

pub fn doctor(options: &Options) -> io::Result<String> {
    let report = doctor_report(options)?;
    Ok(format!(
        "{}\r\n\r\n{}\r\n\r\n{}",
        if report["ok"] == true {
            "INSTALLATION CHECKS PASSED"
        } else {
            "INSTALLATION NEEDS ATTENTION"
        },
        report["nextStep"].as_str().unwrap_or_default(),
        serde_json::to_string_pretty(&report)?
    ))
}

pub fn open_folder(path: &Path) -> io::Result<()> {
    if !path.is_dir() {
        return Err(io::Error::other(
            "The folder does not exist yet. Install Constellation first.",
        ));
    }
    let result = unsafe {
        ShellExecuteW(
            None,
            w!("open"),
            PCWSTR(wide(path).as_ptr()),
            PCWSTR::null(),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };
    if result.0 as usize <= 32 {
        Err(io::Error::other("Windows could not open this folder."))
    } else {
        Ok(())
    }
}

fn reg_app_path(name: &str) -> Option<PathBuf> {
    for hive in [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE] {
        if let Ok(Some(value)) = read_value(
            hive,
            &format!(r"Software\Microsoft\Windows\CurrentVersion\App Paths\{name}"),
            "",
        ) {
            if value.kind != 1 {
                continue;
            }
            let utf: Vec<_> = value
                .bytes
                .as_chunks::<2>()
                .0
                .iter()
                .map(|b| u16::from_le_bytes([b[0], b[1]]))
                .take_while(|n| *n != 0)
                .collect();
            let path = PathBuf::from(String::from_utf16_lossy(&utf).trim_matches('"'));
            if path.is_file() {
                return Some(path);
            }
        }
    }
    None
}

pub fn browser_path(browser: &str) -> Option<PathBuf> {
    let (name, relative) = match browser {
        "chrome" => ("chrome.exe", vec!["Google/Chrome/Application/chrome.exe"]),
        "edge" => ("msedge.exe", vec!["Microsoft/Edge/Application/msedge.exe"]),
        "firefox" => ("firefox.exe", vec!["Mozilla Firefox/firefox.exe"]),
        "opera_gx" => (
            "opera.exe",
            vec![
                "Programs/Opera GX/launcher.exe",
                "Opera GX/launcher.exe",
                "Opera GX/opera.exe",
            ],
        ),
        _ => return None,
    };
    // Opera's shared App Paths entry can point at standard Opera. Prefer the GX
    // installation paths first, then an App Paths entry explicitly named GX.
    if browser != "opera_gx"
        && let Some(path) = reg_app_path(name)
    {
        return Some(path);
    }
    for variable in ["LOCALAPPDATA", "PROGRAMFILES", "PROGRAMFILES(X86)"] {
        if let Some(root) = std::env::var_os(variable) {
            for suffix in &relative {
                let path = PathBuf::from(&root).join(suffix);
                if path.is_file() {
                    return Some(path);
                }
            }
        }
    }
    if browser == "opera_gx" {
        return reg_app_path(name)
            .filter(|p| p.to_string_lossy().to_lowercase().contains("opera gx"));
    }
    None
}

pub fn open_browser_setup(browser: &str) -> io::Result<()> {
    let page = match browser {
        "chrome" => "chrome://extensions",
        "edge" => "edge://extensions",
        "opera_gx" => "opera://extensions",
        "firefox" => "about:debugging#/runtime/this-firefox",
        _ => return Err(io::Error::other("Unknown browser.")),
    };
    let exe=browser_path(browser).ok_or_else(||io::Error::other("This browser was not found. Open its extension settings manually; custom portable browser locations are supported through the same setup steps."))?;
    Command::new(exe).arg(page).spawn()?;
    Ok(())
}

pub fn copy_path(path: &Path) -> io::Result<()> {
    let text = wide(path);
    unsafe {
        OpenClipboard(None).map_err(error)?;
        let result = (|| -> io::Result<()> {
            EmptyClipboard().map_err(error)?;
            let memory = GlobalAlloc(GMEM_MOVEABLE, text.len() * 2).map_err(error)?;
            let pointer = GlobalLock(memory);
            if pointer.is_null() {
                let _ = GlobalFree(Some(memory));
                return Err(io::Error::last_os_error());
            }
            std::ptr::copy_nonoverlapping(text.as_ptr(), pointer.cast::<u16>(), text.len());
            let _ = GlobalUnlock(memory);
            if let Err(problem) = SetClipboardData(13, Some(HANDLE(memory.0))) {
                let _ = GlobalFree(Some(memory));
                return Err(error(problem));
            }
            Ok(())
        })();
        let _ = CloseClipboard();
        result
    }
}

pub fn launch_owner(options: &Options) -> io::Result<()> {
    let integrity = engine::verify(options)?;
    if integrity["ok"] != true {
        return Err(io::Error::other(
            "Installed file verification failed. Run Install / Repair before opening Computer Tools.",
        ));
    }
    let executable =
        engine::verified_executable(options, "computer-link/computer-link-owner-proof.exe")?;
    let directory = executable.parent().unwrap();
    // The owner window presents its own local consent controls. Opening it never
    // creates a session, lease, token, grant, or auto-approved computer action.
    let mut child = Command::new(&executable).current_dir(directory).spawn()?;
    let end = Instant::now() + Duration::from_secs(12);
    loop {
        if let Some(status) = child.try_wait()? {
            return Err(io::Error::other(format!(
                "Computer Tools exited before opening its window ({status}). Run Check installation; Install / Repair restores missing or changed files."
            )));
        }
        if owner_window_ready(child.id()) {
            return Ok(());
        }
        if Instant::now() >= end {
            // Do not kill a slow process or claim that its window opened.
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "Computer Tools started but its window did not become ready within 12 seconds. Check the taskbar before retrying; use Check installation for diagnostics.",
            ));
        }
        thread::sleep(Duration::from_millis(40));
    }
}

fn owner_window_ready(pid: u32) -> bool {
    struct Search {
        pid: u32,
        found: bool,
    }
    unsafe extern "system" fn inspect(hwnd: HWND, parameter: LPARAM) -> BOOL {
        unsafe {
            let search = &mut *(parameter.0 as *mut Search);
            let mut pid = 0;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            if pid == search.pid && IsWindowVisible(hwnd).as_bool() {
                let mut class = [0u16; 128];
                let count = GetClassNameW(hwnd, &mut class);
                if String::from_utf16_lossy(&class[..count.max(0) as usize])
                    == "ComputerLinkOwnerProof"
                {
                    search.found = true;
                }
            }
            BOOL(1)
        }
    }
    let mut search = Search { pid, found: false };
    unsafe {
        let _ = EnumWindows(Some(inspect), LPARAM((&mut search as *mut Search) as isize));
    }
    search.found
}

/// Run uninstall from a private temporary copy so the installed management EXE
/// is not locked by Windows. The temporary copy has no persistence or autorun.
pub fn detached_uninstall(options: &Options, quiet: bool) -> io::Result<bool> {
    let current = std::env::current_exe()?.canonicalize()?;
    let root = options.root.canonicalize()?;
    if !current.starts_with(&root) {
        return Ok(false);
    }
    let temporary = std::env::temp_dir().join(format!(
        "Constellation-Uninstall-{}",
        platform::random_hex(8)?
    ));
    platform::secure_directory(&temporary)?;
    let helper = temporary.join("Constellation-Setup.exe");
    fs::copy(&current, &helper)?;
    let mut command = Command::new(&helper);
    command
        .arg("uninstall")
        .arg("--dir")
        .arg(&options.root)
        .arg("--wait-parent")
        .arg(std::process::id().to_string());
    if quiet {
        command.arg("--quiet");
    }
    command.spawn()?;
    Ok(true)
}

pub fn wait_for_parent(pid: u32) -> io::Result<()> {
    use windows::Win32::{
        Foundation::CloseHandle,
        System::Threading::{OpenProcess, PROCESS_SYNCHRONIZE, WaitForSingleObject},
    };
    if pid == std::process::id() {
        return Err(io::Error::other("Invalid uninstall parent."));
    }
    // Only wait for process termination. Never signal or terminate the parent.
    if let Ok(process) = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, false, pid) } {
        let result = unsafe { WaitForSingleObject(process, 15_000) };
        unsafe {
            let _ = CloseHandle(process);
        }
        if result.0 != 0 {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "Close the previous Setup window, then retry Uninstall.",
            ));
        }
    }
    Ok(())
}
