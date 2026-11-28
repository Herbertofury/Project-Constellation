use std::{env, fs, path::PathBuf};

fn main() {
    println!("cargo:rerun-if-env-changed=CONSTELLATION_SETUP_PAYLOAD");
    println!("cargo:rerun-if-env-changed=CONSTELLATION_SETUP_RESOURCES");
    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && let Some(resources) = env::var_os("CONSTELLATION_SETUP_RESOURCES")
    {
        let path = PathBuf::from(resources)
            .canonicalize()
            .expect("setup resources exist");
        println!("cargo:rerun-if-changed={}", path.display());
        println!(
            "cargo:rustc-link-arg-bin=constellation-setup={}",
            path.display()
        );
    }
    let output = PathBuf::from(env::var_os("OUT_DIR").unwrap()).join("embedded.rs");
    let source = if let Some(path) = env::var_os("CONSTELLATION_SETUP_PAYLOAD") {
        let path = PathBuf::from(path)
            .canonicalize()
            .expect("setup payload exists");
        println!("cargo:rerun-if-changed={}", path.display());
        format!(
            "pub static EMBEDDED_PAYLOAD: &[u8] = include_bytes!({:?});\n",
            path
        )
    } else {
        // Unit tests and static checks never need a production binary payload.
        // Running this build fails explicitly instead of installing placeholders.
        "pub static EMBEDDED_PAYLOAD: &[u8] = &[];\n".to_owned()
    };
    fs::write(output, source).unwrap();
}
