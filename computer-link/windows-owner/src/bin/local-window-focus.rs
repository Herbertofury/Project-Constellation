//! Experimental owner-invoked console, intentionally excluded from installer/MCP.
#[cfg(windows)] fn main(){
 use std::io::{self,Write,IsTerminal};
 if std::env::args().len()!=1||!io::stdin().is_terminal()||!io::stdout().is_terminal(){eprintln!("Interactive owner console required; no arguments or piped commands accepted.");std::process::exit(2)}
 println!("LOCAL WINDOW FOREGROUND REQUEST. No remote access. Ctrl+C or close stops this process.\nPress Enter to list visible window titles locally, or type anything to cancel.");
 let mut line=String::new();if io::stdin().read_line(&mut line).unwrap_or(0)==0||!line.trim().is_empty(){return}
 let mut candidates=match computer_link_owner_proof::window_focus::choose_candidates(){Ok(c)=>c,Err(e)=>{eprintln!("{e}");return}};
 for (i,t) in candidates.iter().enumerate(){println!("\n[{}] {}",i+1,t.description());}
 print!("\nChoose one number; Enter cancels: ");let _=io::stdout().flush();line.clear();if io::stdin().read_line(&mut line).unwrap_or(0)==0{return}
 let Ok(n)=line.trim().parse::<usize>()else{return};if n==0||n>candidates.len(){return}
 let target=candidates.swap_remove(n-1);drop(candidates);
 match target.ask_and_focus(){Ok(true)=>println!("Foreground request verified at completion. No further actions."),Ok(false)=>println!("Cancelled; no foreground request."),Err(e)=>eprintln!("{e}. Not retried.")}
}
#[cfg(not(windows))]fn main(){eprintln!("Windows-only experimental local foreground tool.");std::process::exit(2)}
