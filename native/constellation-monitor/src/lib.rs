pub mod broker;
pub mod install;
mod lifecycle;
pub mod platform;
pub mod state;
pub mod wire;

pub const HOST_NAME: &str = "com.project_constellation.monitor";
pub const CHROMIUM_ID: &str = "geljambmkfjkhodgkpjhnmfojkpcamig";
pub const FIREFOX_ID: &str = "constellation-monitor@project-constellation.local";

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}
