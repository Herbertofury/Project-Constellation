#![cfg_attr(windows,windows_subsystem="windows")]
#[cfg(not(windows))]fn main(){eprintln!("Windows only");}
#[cfg(windows)]mod gui{
use std::{ffi::c_void,ptr,mem,cell::RefCell,path::PathBuf,os::windows::ffi::OsStringExt,sync::mpsc,time::{Instant,Duration}};
use computer_link_owner_proof::{Owner,snapshot};
type H=*mut c_void;
#[repr(C)]struct Point{x:i32,y:i32}
#[repr(C)]struct Msg{hwnd:H,msg:u32,w:usize,l:isize,time:u32,point:Point,private:u32}
#[repr(C)]struct Class{size:u32,style:u32,proc:Option<unsafe extern "system" fn(H,u32,usize,isize)->isize>,cls:i32,win:i32,instance:H,icon:H,cursor:H,brush:H,menu:*const u16,name:*const u16,small:H}
#[repr(C)]struct Nid{size:u32,hwnd:H,id:u32,flags:u32,callback:u32,icon:H,tip:[u16;128],state:u32,mask:u32,info:[u16;256],version:u32,title:[u16;64],infoflags:u32,guid:[u8;16],balloon:H}
#[repr(C)]struct Ofn{size:u32,owner:H,instance:H,filter:*const u16,custom:*mut u16,max_custom:u32,index:u32,file:*mut u16,max_file:u32,file_title:*mut u16,max_title:u32,initial:*const u16,title:*const u16,flags:u32,offset:u16,extension:u16,defext:*const u16,data:isize,hook:H,template:*const u16,reserved:H,reserved2:u32,flags_ex:u32}
#[link(name="user32")]unsafe extern "system"{
fn IsDialogMessageW(h:H,msg:*const Msg)->i32;fn RegisterClassExW(c:*const Class)->u16;fn CreateWindowExW(ex:u32,class:*const u16,title:*const u16,style:u32,x:i32,y:i32,w:i32,h:i32,parent:H,menu:H,instance:H,param:H)->H;
fn DefWindowProcW(h:H,m:u32,w:usize,l:isize)->isize;fn GetMessageW(m:*mut Msg,h:H,min:u32,max:u32)->i32;fn TranslateMessage(m:*const Msg)->i32;fn DispatchMessageW(m:*const Msg)->isize;fn PostQuitMessage(code:i32);fn DestroyWindow(h:H)->i32;fn ShowWindow(h:H,n:i32)->i32;fn SetForegroundWindow(h:H)->i32;
fn PostMessageW(h:H,m:u32,w:usize,l:isize)->i32;fn MessageBoxW(h:H,text:*const u16,title:*const u16,flags:u32)->i32;fn CreateMenu()->H;fn AppendMenuW(menu:H,flags:u32,id:usize,text:*const u16)->i32;fn SetMenu(h:H,menu:H)->i32;fn SetWindowTextW(h:H,text:*const u16)->i32;fn LoadIconW(i:H,name:*const u16)->H;
}
#[link(name="kernel32")]unsafe extern "system"{fn GetModuleHandleW(n:*const u16)->H;fn ExitProcess(code:u32)->!;fn GetCurrentProcess()->H;fn TerminateProcess(process:H,code:u32)->i32;}
#[link(name="shell32")]unsafe extern "system"{fn Shell_NotifyIconW(m:u32,n:*const Nid)->i32;}
#[link(name="comdlg32")]unsafe extern "system"{fn GetOpenFileNameW(o:*mut Ofn)->i32;}
struct Prompt{peer:computer_link_local_transport::PeerInfo,generation:u64,end:Instant,reply:mpsc::Sender<bool>}
type LiveClient=computer_link_owner_proof::status_protocol::StatusClient<std::io::BufReader<std::fs::File>,std::fs::File>;
struct State{export_preview:Option<computer_link_owner_proof::local_export_preview::Window>,export_answer:Option<mpsc::Receiver<(u64,bool)>>,export:Option<computer_link_owner_proof::local_export_ui::Task>,checks:u32,live:Option<LiveClient>,live_reply:Option<mpsc::Receiver<(u64,std::io::Result<LiveClient>)>>,live_exit:Option<mpsc::Receiver<u64>>,owner:Owner,selected:Option<(PathBuf,Vec<u8>)>,tray:Option<Nid>,generation:u64,scope:String,prompts:Option<mpsc::Receiver<Prompt>>,completion:Option<mpsc::Receiver<(u64,bool)>>}
thread_local!{static STATE:RefCell<State>=RefCell::new(State{export_preview:None,export_answer:None,export:None,checks:0,live:None,live_reply:None,live_exit:None,owner:Owner::default(),selected:None,tray:None,generation:0,scope:String::new(),prompts:None,completion:None});}
fn wide(s:&str)->Vec<u16>{s.encode_utf16().chain(Some(0)).collect()}
fn notice(h:H,s:&str){unsafe{MessageBoxW(h,wide(s).as_ptr(),wide("Constellation Computer Tools local proof").as_ptr(),0x40);}}
fn choose(h:H)->Option<PathBuf>{let mut b=vec![0u16;32768];let mut o:Ofn=unsafe{mem::zeroed()};o.size=mem::size_of::<Ofn>() as u32;o.owner=h;o.file=b.as_mut_ptr();o.max_file=b.len() as u32;o.flags=0x80000|0x1000|0x800|0x8|0x100000; // Explorer, file/path must exist, no cwd change, no link dereference.
if unsafe{GetOpenFileNameW(&mut o)}==0{return None}let n=b.iter().position(|v|*v==0)?;Some(PathBuf::from(std::ffi::OsString::from_wide(&b[..n])))}
fn stop(h:H)->bool{
 if STATE.with(|s|{let mut s=s.borrow_mut();if s.export.is_some(){s.generation=s.generation.wrapping_add(1);s.export.as_mut().unwrap().cancel();true}else{false}}){
  let preview=STATE.with(|s|{let mut s=s.borrow_mut();s.export_answer=None;s.export_preview.take()});drop(preview);
  unsafe{SetWindowTextW(h,wide("Constellation Computer Tools — export stop requested; waiting for outcome; cancel open folder picker").as_ptr());}return false
 }
 let result=STATE.with(|s|{let mut s=s.borrow_mut();s.generation=s.generation.wrapping_add(1);s.prompts=None;s.completion=None;s.checks=0;s.live=None;s.live_reply=None;s.live_exit=None;s.owner.disconnect()});match result{Ok(())=>{unsafe{SetWindowTextW(h,wide("Constellation Computer Tools — disconnected (local proof)").as_ptr());}true},Err(e)=>{notice(h,&format!("Disconnect could not confirm cleanup: {e}. Exit ends this process; do not start another session."));false}}}
fn exit(h:H){
 if STATE.with(|s|s.borrow().export.is_some()){
  let yes=unsafe{MessageBoxW(h,wide("A local export is pending or writing. Exit requests termination of this process and its worker. Windows may take time to finish pending I/O. A file or partial .pending stage may already exist; inspect the selected folder before retrying. Exit now?").as_ptr(),wide("Exit during local export").as_ptr(),0x104)}==6;
  if !yes{return}STATE.with(|s|{let mut s=s.borrow_mut();if let Some(task)=s.export.as_mut(){task.cancel();}if let Some(n)=s.tray.take(){unsafe{Shell_NotifyIconW(2,&n);}}});if unsafe{TerminateProcess(GetCurrentProcess(),0)}==0{notice(h,"Could not request process termination. Cleanup is not confirmed while the export remains active; wait for its result or retry Exit.");}return
 }
 let clean=stop(h);STATE.with(|s|{if let Some(n)=s.borrow_mut().tray.take(){unsafe{Shell_NotifyIconW(2,&n);}}});if !clean{unsafe{ExitProcess(2)}}unsafe{DestroyWindow(h);}}
fn status_work<F>(h:H,generation:u64,work:F) where F:FnOnce()->std::io::Result<LiveClient>+Send+'static{
 let(tx,rx)=mpsc::channel();STATE.with(|s|s.borrow_mut().live_reply=Some(rx));let hwnd=h as usize;
 unsafe{SetWindowTextW(h,wide("Constellation Computer Tools — checking local status; Disconnect cancels").as_ptr());}
 if std::thread::Builder::new().name("local-status-request".into()).spawn(move||{let _=tx.send((generation,work()));unsafe{PostMessageW(hwnd as H,0x8005,0,0);}}).is_err(){stop(h);notice(h,"Could not start local status worker.");}
}
unsafe extern "system" fn procedure(h:H,m:u32,w:usize,l:isize)->isize{
match m{
0x111=>{if !matches!(w&0xffff,4|5)&&STATE.with(|s|s.borrow().export.is_some()){notice(h,"Finish or cancel the current local export first. No additional operation was started.");return 0}match w&0xffff{
13=>{
 if !stop(h){return 0}
 let generation=STATE.with(|s|s.borrow().generation);
 let consent="Open a LOCAL window selector in a tray-owned process? Window titles remain on this computer. Choose one observed window, then confirm once to bring it forward. No typing, clicking, browser-tab access, remote control or AI connection. Only use on a trusted, quiescent desktop. Disconnect or Exit kills the selector and its pending prompts; it cannot undo an already completed foreground change. The installed executable/folder must be trusted.";
 if unsafe{MessageBoxW(h,wide(consent).as_ptr(),wide("Local foreground selector permission").as_ptr(),0x104)}!=6||!STATE.with(|s|s.borrow().generation==generation){return 0}
 let result=std::env::current_exe().and_then(|exe|STATE.with(|s|s.borrow_mut().owner.launch_owned_worker(&exe,&["--local-focus-selector".into()])));
 match result{Ok(())=>{unsafe{SetWindowTextW(h,wide(&format!("Constellation Computer Tools — local foreground selector active | PID {} | Disconnect stops selector",STATE.with(|s|s.borrow().owner.local_worker_pid().unwrap_or(0)))).as_ptr());}let(tx,rx)=mpsc::channel();STATE.with(|s|s.borrow_mut().live_exit=Some(rx));let hwnd=h as usize;
 let result=STATE.with(|s|s.borrow().owner.notify_local_session_exit(move|_|{let _=tx.send(generation);unsafe{PostMessageW(hwnd as H,0x8006,0,0);}}));
 if result.is_err(){stop(h);notice(h,"Could not observe selector lifetime; disconnected.");}
 },Err(e)=>notice(h,&format!("Selector launch refused: {e}"))}},
1=>{if stop(h){let selection_generation=STATE.with(|s|{let mut s=s.borrow_mut();s.selected=None;s.generation});if let Some(path)=choose(h){if !STATE.with(|s|s.borrow().generation==selection_generation){return 0}match snapshot(&path){Ok(bytes)=>{let count=bytes.len();STATE.with(|s|s.borrow_mut().selected=Some((path.clone(),bytes)));notice(h,&format!("Selected {} bytes from {}. Nothing shared yet. Allow once grants this captured text only, not future file changes.",count,path.display()));},Err(e)=>notice(h,&format!("Selection refused: {e}"))}}}},
2|3=>{if STATE.with(|s|s.borrow().live_exit.is_some()){notice(h,"Disconnect the local status session before preparing another grant.");return 0}let consent_generation=STATE.with(|s|s.borrow().generation);let selected=STATE.with(|s|s.borrow().selected.clone());if w&0xffff==3&&selected.is_none(){notice(h,"Choose a bounded UTF-8 file first.");return 0}
let detail=if w&0xffff==3{format!("Allow ONE local paired read of the captured {} bytes from {}?",selected.as_ref().unwrap().1.len(),selected.as_ref().unwrap().0.display())}else{"Allow ONE local paired status request?".to_owned()};
let text=format!("{detail}\nExpires after 60 seconds. No write, delete, browser, network or administrator authority. Disconnect or Exit revokes this session. A connecting local process requires a second explicit approval. This proof does NOT connect ChatGPT.");
if unsafe{MessageBoxW(h,wide(&text).as_ptr(),wide("Explicit local permission").as_ptr(),0x104)}==6&&STATE.with(|s|s.borrow().generation==consent_generation){
let bytes=if w&0xffff==3{selected.map(|s|s.1)}else{None};let (tx,rx)=mpsc::channel();let generation=STATE.with(|s|{let mut s=s.borrow_mut();s.generation=s.generation.wrapping_add(1);s.prompts=Some(rx);s.scope=match &bytes{Some(b)=>format!("Read only the captured {} UTF-8 bytes",b.len()),None=>"Status only; no file bytes".to_owned()};s.generation});let hwnd=h as usize;
let result=STATE.with(|s|s.borrow_mut().owner.allow_paired_notified(bytes,move|peer,end,stop|{let(reply,answer)=mpsc::channel();tx.send(Prompt{peer,generation,end,reply}).map_err(|_|std::io::Error::other("owner unavailable"))?;if unsafe{PostMessageW(hwnd as H,0x8002,0,0)}==0{return Err(std::io::Error::other("owner dispatch failed"))}loop{if Instant::now()>=end||stop.stopped(){return Err(std::io::Error::other("approval expired or revoked"))}match answer.recv_timeout(Duration::from_millis(20)){Ok(v)=>return Ok(v),Err(mpsc::RecvTimeoutError::Disconnected)=>return Ok(false),Err(mpsc::RecvTimeoutError::Timeout)=>{}}}},move||{unsafe{PostMessageW(hwnd as H,0x8003,generation as usize,0);}}));
match result{Ok(name)=>{unsafe{SetWindowTextW(h,wide(&format!("Constellation Computer Tools — one local grant | {name}")).as_ptr());}},Err(e)=>notice(h,&e.to_string())}
}},
6=>{if stop(h){let capture_generation=STATE.with(|s|{let mut s=s.borrow_mut();s.selected=None;s.generation});let consent="Capture visible top-level window titles, process IDs and window handles locally? Titles may contain private document or chat names. No child text, screenshots or input control. Nothing is shared until a separate Allow selected read and connected-client approval.";if unsafe{MessageBoxW(h,wide(consent).as_ptr(),wide("Capture window inventory locally").as_ptr(),0x104)}==6&&STATE.with(|s|computer_link_owner_proof::window_inventory::consent_current(capture_generation,s.borrow().generation)){match computer_link_owner_proof::window_inventory::capture_if_current(capture_generation,STATE.with(|s|s.borrow().generation),computer_link_owner_proof::window_inventory::capture_visible){Some(Ok(bytes))=>{let count=bytes.len();let preview=String::from_utf8_lossy(&bytes).into_owned();let keep=unsafe{MessageBoxW(h,wide(&format!("Keep this {count}-byte snapshot for a later explicit one-use read grant? No discards it. Nothing shared yet. Identifiers are unverified, not control authority.\n\n{preview}")).as_ptr(),wide("Review captured window inventory").as_ptr(),0x104)}==6;if keep{STATE.with(|s|{let mut s=s.borrow_mut();if computer_link_owner_proof::window_inventory::consent_current(capture_generation,s.generation){s.selected=Some((PathBuf::from("[captured window inventory; not a file]"),bytes));}});}},Some(Err(e))=>notice(h,&format!("Capture refused: {e}")),None=>{}}}}},
7=>{if stop(h){let selected=STATE.with(|s|s.borrow().selected.clone());let Some((_,bytes))=selected else{notice(h,"Choose a UTF-8 file containing one HTTPS link first.");return 0};match computer_link_owner_proof::browser_handoff::HttpsLink::parse(&bytes){Err(e)=>notice(h,&e.to_string()),Ok(link)=>{let generation=STATE.with(|s|s.borrow().generation);let text=format!("Open this exact link in your Windows default browser?\nHost: {}\n\n{}\n\nThe browser may send cookies and contact redirected or private-network destinations. This is not a safety verdict about the site. No browser control or sign-in is granted. The browser remains open after Constellation Computer Tools exits.",link.host(),link.url());let yes=unsafe{MessageBoxW(h,wide(&text).as_ptr(),wide("Open HTTPS link locally").as_ptr(),0x104)}==6;let current=STATE.with(|s|s.borrow().generation);let result=link.open_if_current(yes,generation,current,|_|computer_link_owner_proof::browser_handoff::open_default_browser(h as isize, &link));if let Err(e)=result{notice(h,&e.to_string());}}}}},
8=>{if stop(h){
 let generation=STATE.with(|s|{let mut s=s.borrow_mut();s.selected=None;s.generation});
 match computer_link_owner_proof::folder_inventory::choose(h as isize){
  Ok(Some(path)) if STATE.with(|s|s.borrow().generation==generation)=>{
   let text=format!("Capture a one-level names/types inventory from this exact folder?\n{path:?}\n\nFilenames may be private. Maximum 64 entries and 4096 bytes; larger folders are refused, not silently truncated. No file contents, recursion, link following, writes or deletion. Nothing is shared yet.");
   let yes=unsafe{MessageBoxW(h,wide(&text).as_ptr(),wide("Capture folder inventory locally").as_ptr(),0x104)}==6;
   let result=computer_link_owner_proof::folder_inventory::capture_if_current(yes,generation,STATE.with(|s|s.borrow().generation),||computer_link_owner_proof::folder_inventory::capture(&path));
   match result{Some(Ok(bytes))=>{
    let preview=String::from_utf8_lossy(&bytes);
    let text=format!("Keep this {}-byte folder inventory for a later explicit one-use read? No discards it. Nothing shared yet. Names/types are observations, not read or write authority.\nFolder: {path:?}\n\n{preview}",bytes.len());
    let keep=unsafe{MessageBoxW(h,wide(&text).as_ptr(),wide("Review captured folder inventory").as_ptr(),0x104)}==6;
    if keep{STATE.with(|s|{let mut s=s.borrow_mut();if s.generation==generation{s.selected=Some((PathBuf::from("[captured folder inventory; not file contents]"),bytes));}});}
   },Some(Err(e))=>notice(h,&format!("Folder capture refused: {e}")),None=>{}}
  },Ok(_)=>{},Err(e)=>notice(h,&e.to_string())
 }
}},
9=>{if stop(h){
 let Some((source,bytes))=STATE.with(|s|s.borrow().selected.clone()) else{notice(h,"Choose or capture a bounded snapshot first. Nothing launched.");return 0};
 let bridge=match std::env::current_exe().ok().and_then(|p|p.parent().map(|d|d.join("computer-link-mcp-session.exe"))){Some(p) if p.is_file()=>p,_=>{notice(h,"The sibling computer-link-mcp-session.exe is missing. Nothing launched. This diagnostic does not download or install a bridge.");return 0}};
 let consent_generation=STATE.with(|s|s.borrow().generation);
 let text=format!("Run one local snapshot diagnostic?\nSource: {}\nCaptured bytes: {}\nRecipient executable: {}\nDestination: this computer only, inside the owner-launched diagnostic process. No ChatGPT, AI provider, browser or remote host receives this snapshot.\n\nThe child consumes this snapshot once in memory; no snapshot is forwarded or written to stdout/stderr. This is not a full connection. No signer verification or executable isolation: only continue if you trust this installed sibling executable and its folder. It runs with your existing OS permissions. A second prompt binds the actual child PID. Disconnect or Exit terminates the owned process tree; it cannot recall already read bytes.",source.display(),bytes.len(),bridge.display());
 if unsafe{MessageBoxW(h,wide(&text).as_ptr(),wide("Run local snapshot diagnostic").as_ptr(),0x104)}!=6||!STATE.with(|s|s.borrow().generation==consent_generation){return 0}
 let (tx,rx)=mpsc::channel();let generation=STATE.with(|s|{let mut s=s.borrow_mut();s.generation=s.generation.wrapping_add(1);s.prompts=Some(rx);s.scope=format!("LOCAL DIAGNOSTIC ONLY: {} captured bytes to {}; no forwarding, provider or remote host",bytes.len(),bridge.display());s.generation});let hwnd=h as usize;
 let result=STATE.with(|s|s.borrow_mut().owner.launch_local_snapshot_probe(&bridge,bytes,move|peer,end,stop|{
  let(reply,answer)=mpsc::channel();tx.send(Prompt{peer,generation,end,reply}).map_err(|_|std::io::Error::other("owner unavailable"))?;
  if unsafe{PostMessageW(hwnd as H,0x8002,0,0)}==0{return Err(std::io::Error::other("owner dispatch failed"))}
  loop{if Instant::now()>=end||stop.stopped(){return Ok(false)}match answer.recv_timeout(Duration::from_millis(20)){Ok(v)=>return Ok(v),Err(mpsc::RecvTimeoutError::Disconnected)=>return Ok(false),Err(mpsc::RecvTimeoutError::Timeout)=>{}}}
 }));
 if let Err(e)=result{stop(h);notice(h,&format!("Diagnostic launch refused: {e}"));return 0}
 let (completion_tx,completion_rx)=mpsc::channel();STATE.with(|s|s.borrow_mut().completion=Some(completion_rx));
 let result=STATE.with(|s|s.borrow().owner.notify_local_worker_exit(move|result|{let _=completion_tx.send((generation,matches!(result,Ok(0))));unsafe{PostMessageW(hwnd as H,0x8004,0,0);}}));
 if let Err(e)=result{stop(h);notice(h,&format!("Diagnostic completion tracking failed: {e}"));return 0}
 unsafe{SetWindowTextW(h,wide("Constellation Computer Tools — local diagnostic awaiting approval").as_ptr());}
}},
10=>{if stop(h){
 let bridge=match std::env::current_exe().ok().and_then(|p|p.parent().map(|d|d.join("computer-link-mcp-session.exe"))){Some(p) if p.is_file()=>p,_=>{notice(h,"The sibling computer-link-mcp-session.exe is missing. Nothing launched.");return 0}};
 let generation=STATE.with(|s|s.borrow().generation);
 let text=format!("Start an interactive LOCAL STATUS-ONLY session?\nRecipient executable: {}\nDestination: this Constellation Computer Tools owner only. No ChatGPT, AI provider, browser or remote host. No snapshot or file bytes are shared.\n\nThe sibling runs with your existing OS permissions; this is not executable isolation or signer verification. Continue only if you trust its folder and executable. Disconnect or Exit kills its owned process tree. Nothing restarts automatically. Check local status sends a request only when clicked; there is no polling.",bridge.display());
 if unsafe{MessageBoxW(h,wide(&text).as_ptr(),wide("Start local status session").as_ptr(),0x104)}!=6||!STATE.with(|s|s.borrow().generation==generation){return 0}
 let io=match STATE.with(|s|s.borrow_mut().owner.launch_local_status_session(&bridge)){Ok(io)=>io,Err(e)=>{stop(h);notice(h,&format!("Local status launch refused: {e}"));return 0}};
 let (tx,rx)=mpsc::channel();STATE.with(|s|s.borrow_mut().live_exit=Some(rx));let hwnd=h as usize;
 if STATE.with(|s|s.borrow().owner.notify_local_session_exit(move|_|{let _=tx.send(generation);unsafe{PostMessageW(hwnd as H,0x8006,0,0);}})).is_err(){stop(h);notice(h,"Could not track local process exit.");return 0}
 status_work(h,generation,move||{let mut client=LiveClient::initialize(std::io::BufReader::new(io.output),io.input)?;client.check()?;Ok(client)});
}},
11=>{let current=STATE.with(|s|{let mut s=s.borrow_mut();s.live.take().map(|client|(s.generation,client))});
 if let Some((generation,mut client))=current{status_work(h,generation,move||{client.check()?;Ok(client)});}
},
12=>{if stop(h){
 let Some((_,bytes))=STATE.with(|s|s.borrow().selected.clone()) else{notice(h,"Choose or capture a bounded text snapshot first. Export creates a new copy only.");return 0};
 let hwnd=h as usize;
 match computer_link_owner_proof::local_export_ui::Task::start(bytes,move||{unsafe{PostMessageW(hwnd as H,0x8007,0,0);}}){
  Ok(task)=>{STATE.with(|s|s.borrow_mut().export=Some(task));unsafe{SetWindowTextW(h,wide("Constellation Computer Tools — choose export folder; no file written yet").as_ptr());}},Err(e)=>notice(h,&format!("Export worker refused: {e}"))
 }
}},
4=>{stop(h);},5=>exit(h),_=>{}}0},
0x8007=>{
 let event=STATE.with(|s|s.borrow_mut().export.as_mut().and_then(|t|t.poll()));
 match event{
  Some(computer_link_owner_proof::local_export_ui::Event::Preview{display,approval})=>{
   let admitted=STATE.with(|s|{let mut s=s.borrow_mut();let generation=s.generation;s.export.as_mut().and_then(|t|t.set_approval(approval).then_some(generation))});
   if let Some(generation)=admitted{
    let(tx,rx)=mpsc::channel();let hwnd=h as usize;
    match computer_link_owner_proof::local_export_preview::show(h as isize,&display,move|yes|{let _=tx.send((generation,yes));unsafe{PostMessageW(hwnd as H,0x8008,0,0);}}){
     Ok(window)=>STATE.with(|s|{let mut s=s.borrow_mut();s.export_preview=Some(window);s.export_answer=Some(rx);}),
     Err(e)=>{STATE.with(|s|{if let Some(t)=s.borrow_mut().export.as_mut(){t.cancel();}});notice(h,&format!("Preview refused; no write approved: {e}"));}
    }
   }
  },
  Some(computer_link_owner_proof::local_export_ui::Event::Finished(result))=>{
   let preview=STATE.with(|s|{let mut s=s.borrow_mut();s.export=None;s.export_answer=None;s.export_preview.take()});drop(preview);
   unsafe{SetWindowTextW(h,wide(if result.is_ok(){"Constellation Computer Tools — local export finished; disconnected"}else{"Constellation Computer Tools — local export outcome unconfirmed; disconnected"}).as_ptr());}
   match result{Ok(message)=>notice(h,&message),Err(message)=>notice(h,&message)}
  },None=>{}
 }0},
0x8008=>{
 let answer=STATE.with(|s|s.borrow().export_answer.as_ref().and_then(|rx|rx.try_recv().ok()));
 if let Some((generation,yes))=answer{
  let preview=STATE.with(|s|{let mut s=s.borrow_mut();let current=s.generation==generation;s.export_answer=None;if let Some(t)=s.export.as_mut(){t.approve(yes&&current);}s.export_preview.take()});drop(preview);
 }0},
0x8002=>{let prompt=STATE.with(|s|s.borrow().prompts.as_ref().and_then(|rx|rx.try_recv().ok()));if let Some(p)=prompt{let current=STATE.with(|s|s.borrow().generation);if current==p.generation&&Instant::now()<p.end{let path:String=p.peer.image.chars().map(|c|if c.is_control(){'�'}else{c}).collect();let scope=STATE.with(|s|s.borrow().scope.clone());let text=format!("Authorize this connected local process for the prepared one-use grant?\nScope: {scope}\nPID: {}\nUnverified executable path: {}\nCreation identity: {}\nNo signer verification. No write/delete/admin/browser access. No reconnect reuse.",p.peer.pid,path,p.peer.created);let yes=unsafe{MessageBoxW(h,wide(&text).as_ptr(),wide("Authorize connected client").as_ptr(),0x104)}==6;let valid=STATE.with(|s|s.borrow().generation==p.generation)&&Instant::now()<p.end;let _=p.reply.send(yes&&valid);}else{let _=p.reply.send(false);}}0},
0x8004=>{let completed=STATE.with(|s|s.borrow().completion.as_ref().and_then(|rx|rx.try_recv().ok()));if let Some((generation,passed))=completed{if STATE.with(|s|s.borrow().generation)==generation&&stop(h){unsafe{SetWindowTextW(h,wide(if passed{"Constellation Computer Tools — local diagnostic passed; disconnected"}else{"Constellation Computer Tools — local diagnostic refused or failed; disconnected"}).as_ptr());}}}0},
0x8005=>{let completed=STATE.with(|s|s.borrow().live_reply.as_ref().and_then(|rx|rx.try_recv().ok()));if let Some((generation,result))=completed{if STATE.with(|s|s.borrow().generation)==generation{match result{Ok(client)=>{STATE.with(|s|{let mut s=s.borrow_mut();s.live=Some(client);s.live_reply=None;s.checks+=1;});unsafe{SetWindowTextW(h,wide(&format!("Constellation Computer Tools — local status verified; dot NOT connected; check {} | PID {}",STATE.with(|s|s.borrow().checks),STATE.with(|s|s.borrow().owner.local_worker_pid().unwrap_or(0)))).as_ptr());}},Err(_)=>{if stop(h){unsafe{SetWindowTextW(h,wide("Constellation Computer Tools — local status failed; disconnected").as_ptr());}}}}}}0},
0x8006=>{let ended=STATE.with(|s|s.borrow().live_exit.as_ref().and_then(|rx|rx.try_recv().ok()));if let Some(generation)=ended{if STATE.with(|s|s.borrow().generation)==generation{stop(h);}}0},
0x8003=>{if STATE.with(|s|s.borrow().generation)==w as u64{stop(h);}0},
0x8001=>{if l as u32==0x202||l as u32==0x205{unsafe{ShowWindow(h,9);SetForegroundWindow(h);}}0},
0x10=>{exit(h);0},0x2=>{unsafe{PostQuitMessage(0);}0},_=>unsafe{DefWindowProcW(h,m,w,l)}}}
pub fn run(){unsafe{let instance=GetModuleHandleW(ptr::null());let name=wide("ComputerLinkOwnerProof");let icon=LoadIconW(ptr::null_mut(),32512usize as *const u16);let mut c:Class=mem::zeroed();c.size=mem::size_of::<Class>() as u32;c.proc=Some(procedure);c.instance=instance;c.name=name.as_ptr();c.icon=icon;c.brush=6usize as H;if RegisterClassExW(&c)==0{return}
let h=CreateWindowExW(0,name.as_ptr(),wide("Constellation Computer Tools — disconnected (local proof)").as_ptr(),0x10cf0000,100,100,760,220,ptr::null_mut(),ptr::null_mut(),instance,ptr::null_mut());if h.is_null(){return}
let menu=CreateMenu();for(id,label)in[(1,"Choose text file"),(2,"Allow status once"),(3,"Allow selected read once"),(6,"Capture window inventory locally"),(8,"Capture folder inventory locally"),(7,"Open selected HTTPS link locally"),(9,"Run local snapshot diagnostic"),(10,"Start local status session"),(11,"Check local status"),(12,"Export selected text as new local file"),(13,"Bring a window forward locally"),(4,"Disconnect"),(5,"Exit")]{AppendMenuW(menu,0,id,wide(label).as_ptr());}SetMenu(h,menu);
let mut n:Nid=mem::zeroed();n.size=mem::size_of::<Nid>() as u32;n.hwnd=h;n.id=1;n.flags=7;n.callback=0x8001;n.icon=icon;let tip=wide("Constellation Computer Tools local proof: click to open, Exit disconnects");n.tip[..tip.len()].copy_from_slice(&tip);if Shell_NotifyIconW(0,&n)!=0{STATE.with(|s|s.borrow_mut().tray=Some(n));}
let mut msg:Msg=mem::zeroed();while GetMessageW(&mut msg,ptr::null_mut(),0,0)>0{let preview=STATE.with(|s|s.borrow().export_preview.as_ref().map(|p|p.handle()));if let Some(preview)=preview{if IsDialogMessageW(preview as H,&msg)!=0{continue}}TranslateMessage(&msg);DispatchMessageW(&msg);} }}
}
#[cfg(windows)]fn main(){
 let args:Vec<_>=std::env::args_os().skip(1).collect();
 if args.len()==1&&args[0]=="--local-focus-selector"{computer_link_owner_proof::window_focus_ui::run();}
 else if args.is_empty(){gui::run();}
 else{std::process::exit(2)}
}
