pub mod engine;
pub mod payload;
pub mod system;

#[cfg(windows)]
pub mod ui;
#[cfg(windows)]
pub mod windows;

include!(concat!(env!("OUT_DIR"), "/embedded.rs"));
