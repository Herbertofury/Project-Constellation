use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::BTreeSet, io, path::Path};

pub const MAGIC: &[u8] = b"CONSTELLATION-SETUP-PAYLOAD-1\0";
pub const MAX_PAYLOAD: usize = 512 * 1024 * 1024;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileRecord {
    pub path: String,
    pub sha256: String,
    pub bytes: u64,
    pub offset: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Manifest {
    pub schema: u32,
    pub version: String,
    pub files: Vec<FileRecord>,
    pub source_commit: String,
    pub source_dirty: bool,
    pub firefox_signed: bool,
    pub computer_link_included: bool,
}

pub struct Payload<'a> {
    pub manifest: Manifest,
    pub sha256: String,
    data: &'a [u8],
}

pub fn hash(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let digest = Sha256::digest(bytes);
    let mut encoded = String::with_capacity(digest.len() * 2);
    for byte in digest {
        encoded.push(char::from(HEX[usize::from(byte >> 4)]));
        encoded.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    encoded
}

/// Use a single portable path grammar for both the Linux build and Windows
/// extraction. Reject Windows aliases, alternate data streams and DOS devices.
pub fn safe_relative(path: &str) -> io::Result<()> {
    if path.is_empty() || path.len() > 220 || !path.is_ascii() || path.contains(['\\', ':', '\0']) {
        return Err(io::Error::other("invalid payload path"));
    }
    for part in path.split('/') {
        if part.is_empty()
            || part == "."
            || part == ".."
            || part.ends_with(['.', ' '])
            || part.chars().any(|c| c < ' ' || "<>\"|?*".contains(c))
        {
            return Err(io::Error::other("unsafe payload path component"));
        }
        let stem = part.split('.').next().unwrap().to_ascii_uppercase();
        if matches!(
            stem.as_str(),
            "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
        ) || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && matches!(stem.as_bytes()[3], b'1'..=b'9'))
        {
            return Err(io::Error::other("reserved Windows payload path"));
        }
    }
    if Path::new(path).is_absolute() {
        return Err(io::Error::other("absolute payload path"));
    }
    Ok(())
}

pub fn safe_version(version: &str) -> bool {
    !version.is_empty()
        && version.len() <= 60
        && version
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b".-_".contains(&b))
        && !version.starts_with('.')
        && !version.ends_with('.')
}

impl<'a> Payload<'a> {
    pub fn parse(bytes: &'a [u8]) -> io::Result<Self> {
        if bytes.is_empty() {
            return Err(io::Error::other(
                "This developer build has no embedded payload. Build the release with tools/build-windows-setup.py.",
            ));
        }
        if bytes.len() > MAX_PAYLOAD || !bytes.starts_with(MAGIC) || bytes.len() < MAGIC.len() + 4 {
            return Err(io::Error::other("invalid setup payload header"));
        }
        let length =
            u32::from_le_bytes(bytes[MAGIC.len()..MAGIC.len() + 4].try_into().unwrap()) as usize;
        if length > 4 * 1024 * 1024 {
            return Err(io::Error::other("payload manifest exceeds limit"));
        }
        let data_start = (MAGIC.len() + 4)
            .checked_add(length)
            .ok_or_else(|| io::Error::other("manifest length overflow"))?;
        let encoded = bytes
            .get(MAGIC.len() + 4..data_start)
            .ok_or_else(|| io::Error::other("truncated manifest"))?;
        let manifest: Manifest = serde_json::from_slice(encoded)?;
        if manifest.schema != 1
            || !safe_version(&manifest.version)
            || manifest.files.is_empty()
            || manifest.files.len() > 20_000
        {
            return Err(io::Error::other("unsupported or invalid payload manifest"));
        }
        let data = &bytes[data_start..];
        let mut names = BTreeSet::new();
        let mut end = 0u64;
        for record in &manifest.files {
            safe_relative(&record.path)?;
            if !names.insert(record.path.to_lowercase()) {
                return Err(io::Error::other("duplicate case-insensitive payload path"));
            }
            if record.offset != end
                || record.sha256.len() != 64
                || !record.sha256.bytes().all(|b| b.is_ascii_hexdigit())
            {
                return Err(io::Error::other("invalid payload file record"));
            }
            end = end
                .checked_add(record.bytes)
                .ok_or_else(|| io::Error::other("payload size overflow"))?;
            let content = data
                .get(
                    record.offset as usize
                        ..usize::try_from(end)
                            .map_err(|_| io::Error::other("payload too large"))?,
                )
                .ok_or_else(|| io::Error::other("truncated payload file"))?;
            if hash(content) != record.sha256 {
                return Err(io::Error::other(format!(
                    "embedded payload checksum failed: {}",
                    record.path
                )));
            }
        }
        if end != data.len() as u64 {
            return Err(io::Error::other("unaccounted payload bytes"));
        }
        // Prevent one file being used as an ancestor of another on extraction.
        for name in &names {
            let mut parent = name.as_str();
            while let Some((prefix, _)) = parent.rsplit_once('/') {
                if names.contains(prefix) {
                    return Err(io::Error::other("payload file/directory collision"));
                }
                parent = prefix;
            }
        }
        for required in [
            "runtime/constellation-monitor.exe",
            "browsers/chromium/manifest.json",
            "browsers/firefox/manifest.json",
        ] {
            if !names.contains(required) {
                return Err(io::Error::other(format!(
                    "required payload is missing: {required}"
                )));
            }
        }
        Ok(Self {
            manifest,
            sha256: hash(bytes),
            data,
        })
    }

    pub fn contents(&self, record: &FileRecord) -> &[u8] {
        &self.data[record.offset as usize..(record.offset + record.bytes) as usize]
    }
}

#[cfg(test)]
mod tests {
    use super::hash;

    #[test]
    fn sha256_vectors_preserve_payload_and_receipt_digest_format() {
        for (bytes, expected) in [
            (
                b"".as_slice(),
                "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            ),
            (
                b"abc".as_slice(),
                "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            ),
            (
                b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq".as_slice(),
                "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
            ),
        ] {
            assert_eq!(hash(bytes), expected);
        }
        let binary: Vec<u8> = (0..=255).collect();
        let encoded = hash(&binary);
        assert_eq!(encoded.len(), 64);
        assert_eq!(
            encoded,
            "40aff2e9d2d8922e47afd4648e6967497158785fbd1da870e7110266bf944880"
        );
    }
}
