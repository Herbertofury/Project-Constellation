#[cfg(not(windows))] fn main(){eprintln!("Windows capability only; no host fallback");std::process::exit(2)}
#[cfg(windows)] fn main()->std::io::Result<()>{computer_link_workspace_candidate::run()}
