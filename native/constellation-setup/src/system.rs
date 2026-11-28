use serde::{Deserialize, Serialize};
use std::{io, path::Path};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RegistryValue {
    pub kind: u32,
    pub bytes: Vec<u8>,
}

impl RegistryValue {
    pub fn string(value: &str) -> Self {
        Self {
            kind: 1,
            bytes: value
                .encode_utf16()
                .chain(Some(0))
                .flat_map(u16::to_le_bytes)
                .collect(),
        }
    }
    pub fn dword(value: u32) -> Self {
        Self {
            kind: 4,
            bytes: value.to_le_bytes().to_vec(),
        }
    }
    pub fn as_string(&self) -> Option<String> {
        if self.kind != 1 || !self.bytes.len().is_multiple_of(2) {
            return None;
        }
        let mut units: Vec<_> = self
            .bytes
            .as_chunks::<2>()
            .0
            .iter()
            .copied()
            .map(u16::from_le_bytes)
            .collect();
        if units.last() == Some(&0) {
            units.pop();
        }
        if units.contains(&0) {
            return None;
        }
        String::from_utf16(&units).ok()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RegistryEntry {
    pub key: String,
    pub name: String,
    pub value: Option<RegistryValue>,
}

pub trait System {
    fn read_registry(&mut self, key: &str, name: &str) -> io::Result<Option<RegistryValue>>;
    fn write_registry(&mut self, entry: &RegistryEntry) -> io::Result<()>;
    fn shortcut_bytes(&mut self, executable: &Path, root: &Path) -> io::Result<Vec<u8>>;
    fn stop_monitor(&mut self, executable: &Path, data: &Path) -> io::Result<()>;
}

pub const UNINSTALL_KEY: &str =
    r"Software\Microsoft\Windows\CurrentVersion\Uninstall\ProjectConstellation";

pub fn valid_registry_slot(key: &str, name: &str) -> bool {
    if key == UNINSTALL_KEY {
        return [
            "DisplayName",
            "DisplayVersion",
            "Publisher",
            "InstallLocation",
            "DisplayIcon",
            "UninstallString",
            "QuietUninstallString",
            "NoModify",
            "NoRepair",
            "EstimatedSize",
        ]
        .contains(&name);
    }
    name.is_empty()
        && [
            r"Software\Google\Chrome\NativeMessagingHosts\com.project_constellation.monitor",
            r"Software\Microsoft\Edge\NativeMessagingHosts\com.project_constellation.monitor",
            r"Software\Mozilla\NativeMessagingHosts\com.project_constellation.monitor",
            r"Software\Chromium\NativeMessagingHosts\com.project_constellation.monitor",
        ]
        .contains(&key)
}
