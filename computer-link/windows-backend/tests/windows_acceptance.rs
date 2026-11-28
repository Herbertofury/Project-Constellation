#![cfg(windows)]
use athena_owned_windows_workers::windows::Workers;
use std::{path::Path,process::{Child,Command},time::{Duration,Instant},thread};
fn fixture() -> std::path::PathBuf {
 let built = Path::new(env!("CARGO_BIN_EXE_job-fixture"));
 if built.is_file() { return built.to_path_buf(); }
 let staged = std::env::current_exe().expect("test executable path").parent().expect("test directory").join("job-fixture.exe");
 assert!(staged.is_file(), "staged job-fixture.exe must be beside acceptance executable"); staged
}
struct Unrelated(Child);impl Drop for Unrelated{fn drop(&mut self){let _=self.0.kill();let _=self.0.wait();}}
#[test]fn owned_descendants_exit_unrelated_survives_and_restart(){
 let fixture_path=fixture();let exe=fixture_path.as_path();let cwd=std::env::temp_dir();
 let mut unrelated=Unrelated(Command::new(exe).arg("--sleep").spawn().unwrap());
 let mut owner=Workers::new(&std::env::temp_dir()).unwrap();let child=owner.spawn(exe,&["--grandchild".into()],&cwd).unwrap();
 let deadline=Instant::now()+Duration::from_secs(3);while owner.active().unwrap()<2 && Instant::now()<deadline{thread::sleep(Duration::from_millis(10));}
 assert_eq!(owner.active().unwrap(),2,"must observe real owned grandchild, no skip");owner.exit().unwrap();assert!(child.has_exited().unwrap());assert!(unrelated.0.try_wait().unwrap().is_none());assert!(owner.spawn(exe,&["--sleep".into()],&cwd).is_err());
 let mut restarted=Workers::new(&std::env::temp_dir()).unwrap();let second=restarted.spawn(exe,&["--sleep".into()],&cwd).unwrap();restarted.exit().unwrap();assert!(second.has_exited().unwrap());
}
#[test]fn drop_kills_owned_worker(){let fixture_path=fixture();let exe=fixture_path.as_path();let cwd=std::env::temp_dir();let child;{let mut owner=Workers::new(&std::env::temp_dir()).unwrap();child=owner.spawn(exe,&["--sleep".into()],&cwd).unwrap();}let end=Instant::now()+Duration::from_secs(3);while !child.has_exited().unwrap()&&Instant::now()<end{thread::sleep(Duration::from_millis(10));}assert!(child.has_exited().unwrap());}

#[test]fn explicit_environment_no_inherited_path(){let fixture_path=fixture();let exe=fixture_path.as_path();let cwd=std::env::temp_dir();let mut owner=Workers::new(&std::env::temp_dir()).unwrap();assert_ne!(owner.temp_path(),cwd);let child=owner.spawn(exe,&["--check-minimal-environment".into()],&cwd).unwrap();let end=Instant::now()+Duration::from_secs(3);while !child.has_exited().unwrap()&&Instant::now()<end{thread::sleep(Duration::from_millis(10));}assert_eq!(child.exit_code().unwrap(),Some(0));owner.exit().unwrap();}

#[test]fn owner_retains_exit_observation_after_caller_drops_handle(){
 let fixture_path=fixture();let exe=fixture_path.as_path();let cwd=std::env::temp_dir();
 let mut owner=Workers::new(&std::env::temp_dir()).unwrap();
 let child=owner.spawn(exe,&["--sleep".into()],&cwd).unwrap();drop(child);
 owner.exit().unwrap();assert_eq!(owner.active().unwrap(),0);
 assert!(owner.spawn(exe,&["--sleep".into()],&cwd).is_err());
}
