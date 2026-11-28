use std::{
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    path::{Path, PathBuf},
};

pub fn data_dir(explicit: Option<&str>) -> io::Result<PathBuf> {
    let path = if let Some(path) = explicit {
        PathBuf::from(path)
    } else if let Some(path) = std::env::var_os("CONSTELLATION_DATA_DIR") {
        PathBuf::from(path)
    } else {
        let executable = std::env::current_exe()?;
        let parent = executable
            .parent()
            .ok_or_else(|| io::Error::other("no executable directory"))?;
        let config = parent.join("constellation-monitor.config.json");
        if config.exists() {
            if fs::metadata(&config)?.len() > 8192 {
                return Err(io::Error::other("companion config too large"));
            }
            let value: serde_json::Value = serde_json::from_slice(&fs::read(config)?)
                .map_err(|_| io::Error::other("invalid companion configuration"))?;
            let configured = PathBuf::from(
                value["dataDir"]
                    .as_str()
                    .ok_or_else(|| io::Error::other("missing configured dataDir"))?,
            );
            if configured.is_absolute() {
                configured
            } else {
                parent.join(configured)
            }
        } else {
            parent.join("constellation-data")
        }
    };
    if path.is_absolute() {
        Ok(path)
    } else {
        Ok(std::env::current_dir()?.join(path))
    }
}

pub fn secure_directory(path: &Path) -> io::Result<()> {
    if fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_symlink()) {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "data directory must not be a symlink",
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::{DirBuilderExt, MetadataExt, PermissionsExt};
        unsafe extern "C" {
            fn geteuid() -> u32;
        }
        fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(path)?;
        if fs::metadata(path)?.uid() != unsafe { geteuid() } {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "data directory belongs to another user",
            ));
        }
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    }
    #[cfg(windows)]
    {
        fs::create_dir_all(path)?;
        restrict_windows_acl(path)?;
    }
    #[cfg(not(any(unix, windows)))]
    return Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "unsupported operating system",
    ));
    Ok(())
}

pub fn open_private(path: &Path, create_new: bool) -> io::Result<File> {
    if fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_symlink()) {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "private file must not be a symlink",
        ));
    }
    let mut options = OpenOptions::new();
    options.read(true).write(true);
    if create_new {
        options.create_new(true);
    } else {
        options.create(true);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options.open(path)?;
    #[cfg(windows)]
    restrict_windows_acl(path)?;
    Ok(file)
}

pub fn read_private(path: &Path, limit: usize) -> io::Result<Vec<u8>> {
    let meta = fs::symlink_metadata(path)?;
    if !meta.file_type().is_file() || meta.len() > limit as u64 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "private file is invalid or oversized",
        ));
    }
    #[cfg(windows)]
    restrict_windows_acl(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        unsafe extern "C" {
            fn geteuid() -> u32;
        }
        if meta.uid() != unsafe { geteuid() } || meta.mode() & 0o077 != 0 {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "private file has unsafe permissions",
            ));
        }
    }
    let mut bytes = Vec::with_capacity(meta.len() as usize);
    File::open(path)?
        .take(limit as u64 + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() > limit {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "private file exceeds limit",
        ));
    }
    Ok(bytes)
}

pub fn atomic_write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::other("no parent directory"))?;
    let temp = parent.join(format!(
        ".write-{}-{}.tmp",
        std::process::id(),
        random_hex(8)?
    ));
    let result = (|| {
        let mut file = open_private(&temp, true)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        atomic_replace(&temp, path)?;
        #[cfg(unix)]
        File::open(parent)?.sync_all()?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

#[cfg(not(windows))]
fn atomic_replace(from: &Path, to: &Path) -> io::Result<()> {
    fs::rename(from, to)
}

#[cfg(windows)]
fn atomic_replace(from: &Path, to: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn MoveFileExW(existing: *const u16, new: *const u16, flags: u32) -> i32;
    }
    let source: Vec<u16> = from.as_os_str().encode_wide().chain(Some(0)).collect();
    let target: Vec<u16> = to.as_os_str().encode_wide().chain(Some(0)).collect();
    if unsafe { MoveFileExW(source.as_ptr(), target.as_ptr(), 1 | 8) } == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

pub fn random_hex(length: usize) -> io::Result<String> {
    let mut bytes = vec![0u8; length];
    #[cfg(unix)]
    File::open("/dev/urandom")?.read_exact(&mut bytes)?;
    #[cfg(windows)]
    {
        #[link(name = "bcrypt")]
        unsafe extern "system" {
            fn BCryptGenRandom(
                algorithm: *mut std::ffi::c_void,
                buffer: *mut u8,
                size: u32,
                flags: u32,
            ) -> i32;
        }
        let status =
            unsafe { BCryptGenRandom(std::ptr::null_mut(), bytes.as_mut_ptr(), length as u32, 2) };
        if status < 0 {
            return Err(io::Error::other("Windows secure random generator failed"));
        }
    }
    #[cfg(not(any(unix, windows)))]
    return Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "secure random not supported",
    ));
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

pub fn constant_time_equal(left: &str, right: &str) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.bytes()
        .zip(right.bytes())
        .fold(0u8, |difference, (a, b)| difference | (a ^ b))
        == 0
}

#[cfg(windows)]
fn restrict_windows_acl(path: &Path) -> io::Result<()> {
    // Protect existing files as well as the directory. An explicit broad ACL
    // on a copied file is not constrained by its parent's directory ACL.
    set_windows_acl(path, "D:P(A;OICI;FA;;;OW)(A;OICI;FA;;;SY)")
}

#[cfg(windows)]
fn set_windows_acl(path: &Path, sddl: &str) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    type Pointer = *mut std::ffi::c_void;
    #[link(name = "advapi32")]
    unsafe extern "system" {
        fn ConvertStringSecurityDescriptorToSecurityDescriptorW(
            text: *const u16,
            revision: u32,
            descriptor: *mut Pointer,
            size: *mut u32,
        ) -> i32;
        fn GetSecurityDescriptorDacl(
            descriptor: Pointer,
            present: *mut i32,
            dacl: *mut Pointer,
            defaulted: *mut i32,
        ) -> i32;
        fn SetNamedSecurityInfoW(
            path: *mut u16,
            object_type: u32,
            information: u32,
            owner: Pointer,
            group: Pointer,
            dacl: Pointer,
            sacl: Pointer,
        ) -> u32;
    }
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn LocalFree(memory: Pointer) -> Pointer;
    }
    let sddl: Vec<u16> = sddl.encode_utf16().chain(Some(0)).collect();
    let mut filename: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut descriptor: Pointer = std::ptr::null_mut();
    if unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            sddl.as_ptr(),
            1,
            &mut descriptor,
            std::ptr::null_mut(),
        )
    } == 0
    {
        return Err(io::Error::last_os_error());
    }
    let mut present = 0;
    let mut defaulted = 0;
    let mut dacl: Pointer = std::ptr::null_mut();
    let result = if unsafe {
        GetSecurityDescriptorDacl(descriptor, &mut present, &mut dacl, &mut defaulted)
    } == 0
    {
        Err(io::Error::last_os_error())
    } else if present == 0 || dacl.is_null() {
        Err(io::Error::other("private file ACL must not be empty"))
    } else {
        let status = unsafe {
            SetNamedSecurityInfoW(
                filename.as_mut_ptr(),
                1,                       // SE_FILE_OBJECT
                0x00000004 | 0x80000000, // DACL and PROTECTED_DACL
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                dacl,
                std::ptr::null_mut(),
            )
        };
        if status == 0 {
            Ok(())
        } else {
            Err(io::Error::from_raw_os_error(status as i32))
        }
    };
    unsafe {
        LocalFree(descriptor);
    }
    result
}

pub fn spawn_daemon(data_dir: &Path) -> io::Result<()> {
    let mut command = std::process::Command::new(std::env::current_exe()?);
    command
        .arg("daemon")
        .arg("--data-dir")
        .arg(data_dir)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // Break away from the browser's native-host job so another browser can
        // keep the shared broker alive. Fail visibly if OS policy disallows it.
        command.creation_flags(0x00000008 | 0x00000200 | 0x01000000);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    command.spawn()?;
    Ok(())
}

#[cfg(all(test, windows))]
mod windows_tests {
    use super::*;
    use std::os::windows::ffi::OsStrExt;

    fn dacl_text(path: &Path) -> String {
        type Pointer = *mut std::ffi::c_void;
        #[link(name = "advapi32")]
        unsafe extern "system" {
            fn GetNamedSecurityInfoW(
                path: *const u16,
                object_type: u32,
                information: u32,
                owner: *mut Pointer,
                group: *mut Pointer,
                dacl: *mut Pointer,
                sacl: *mut Pointer,
                descriptor: *mut Pointer,
            ) -> u32;
            fn ConvertSecurityDescriptorToStringSecurityDescriptorW(
                descriptor: Pointer,
                revision: u32,
                information: u32,
                text: *mut *mut u16,
                length: *mut u32,
            ) -> i32;
        }
        #[link(name = "kernel32")]
        unsafe extern "system" {
            fn LocalFree(memory: Pointer) -> Pointer;
        }
        let filename: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        let mut descriptor: Pointer = std::ptr::null_mut();
        assert_eq!(
            unsafe {
                GetNamedSecurityInfoW(
                    filename.as_ptr(),
                    1,
                    4,
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    &mut descriptor,
                )
            },
            0
        );
        let mut text: *mut u16 = std::ptr::null_mut();
        let mut length = 0;
        let success = unsafe {
            ConvertSecurityDescriptorToStringSecurityDescriptorW(
                descriptor,
                1,
                4,
                &mut text,
                &mut length,
            )
        };
        unsafe { LocalFree(descriptor) };
        assert_ne!(success, 0);
        let result = String::from_utf16_lossy(unsafe {
            std::slice::from_raw_parts(text, length as usize - 1)
        });
        unsafe { LocalFree(text.cast()) };
        result
    }

    #[test]
    fn copied_private_files_lose_explicit_broad_windows_permissions() {
        let directory = std::env::temp_dir().join(format!(
            "constellation-acl-{}-{}",
            std::process::id(),
            random_hex(8).unwrap()
        ));
        secure_directory(&directory).unwrap();
        let path = directory.join("private.json");
        atomic_write(&path, b"private metadata").unwrap();

        for reopen in [false, true] {
            set_windows_acl(&path, "D:P(A;;FA;;;WD)").unwrap();
            assert!(dacl_text(&path).contains(";;;WD)"));
            if reopen {
                drop(open_private(&path, false).unwrap());
            } else {
                assert_eq!(read_private(&path, 100).unwrap(), b"private metadata");
            }
            let acl = dacl_text(&path);
            assert!(acl.starts_with("D:P"), "unprotected ACL: {acl}");
            assert!(acl.contains(";;;OW)"), "owner missing: {acl}");
            assert!(acl.contains(";;;SY)"), "system missing: {acl}");
            assert!(!acl.contains(";;;WD)"), "everyone still allowed: {acl}");
        }
        fs::remove_dir_all(directory).unwrap();
    }
}
