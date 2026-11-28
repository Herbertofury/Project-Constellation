//! Draft actual Windows Job Object worker backend, NOT yet Windows-qualified.
//! No networking, elevation, installer or browser admission.
#[cfg(windows)] pub mod windows;
