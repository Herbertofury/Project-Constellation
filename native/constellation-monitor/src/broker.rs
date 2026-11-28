use crate::{
    lifecycle::Lifecycle,
    now_ms, platform,
    state::{self, Store},
    wire::{self, read_frame, write_frame},
};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    fs, io,
    net::{Ipv4Addr, Shutdown, SocketAddr, TcpListener, TcpStream},
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        mpsc::{self, SyncSender},
    },
    thread,
    time::{Duration, Instant},
};

struct Peer {
    connection_id: u64,
    sender: SyncSender<Value>,
    stream: TcpStream,
}
struct Hub {
    store: Store,
    peers: BTreeMap<String, Peer>,
    persistence_error: Option<String>,
    lifecycle: Arc<Lifecycle>,
}

type Connections = Arc<Mutex<BTreeMap<u64, TcpStream>>>;

struct ConnectionGuard {
    id: u64,
    connections: Connections,
}

impl Drop for ConnectionGuard {
    fn drop(&mut self) {
        self.connections.lock().unwrap().remove(&self.id);
    }
}

impl Hub {
    fn owns(&self, id: &str, connection_id: u64) -> bool {
        self.peers
            .get(id)
            .is_some_and(|peer| peer.connection_id == connection_id)
    }

    fn disconnect_owned(&mut self, id: &str, connection_id: u64) -> bool {
        if !self.owns(id, connection_id) {
            return false;
        }
        self.peers.remove(id);
        self.store.disconnect(id, now_ms());
        true
    }

    fn snapshot(&self) -> Value {
        let mut result = self.store.snapshot();
        result["health"] = json!({"persistence":if self.persistence_error.is_some(){"error"}else{"ok"},
            "message":self.persistence_error,"connectedBrowsers":self.peers.len(),
            "lifecycle":self.lifecycle.snapshot(),"processLifetime":platform::process_lifetime()});
        result["capabilities"]["browserBoundLifecycle"] = json!(true);
        result
    }
    fn persist(&mut self, directory: &Path) -> io::Result<()> {
        let bytes = serde_json::to_vec(&self.store.snapshot())?;
        if bytes.len() > wire::MAX_FRAME {
            return Err(io::Error::other("state exceeds storage limit"));
        }
        match platform::atomic_write(&directory.join("state.json"), &bytes) {
            Ok(()) => {
                self.persistence_error = None;
                Ok(())
            }
            Err(error) => {
                self.persistence_error =
                    Some(format!("State could not be saved: {}", error.kind()));
                Err(error)
            }
        }
    }
    fn broadcast(&mut self, directory: &Path) {
        let event = json!({"v":1,"kind":"snapshot","data":self.snapshot()});
        let mut failed = Vec::new();
        for (id, peer) in &self.peers {
            if peer.sender.try_send(event.clone()).is_err() {
                failed.push(id.clone());
            }
        }
        let disconnected = !failed.is_empty();
        for id in failed {
            if let Some(peer) = self.peers.remove(&id) {
                let _ = peer.stream.shutdown(Shutdown::Both);
            }
            self.store.disconnect(&id, now_ms());
        }
        if disconnected {
            // A slow or closed reader is a real disconnection. Persist it now;
            // its reader cleanup might run after a replacement has registered.
            let _ = self.persist(directory);
        }
    }
}

fn error(id: Option<&Value>, code: &str, message: impl AsRef<str>) -> Value {
    let mut result = json!({"v":1,"ok":false,"error":{"code":code,"message":message.as_ref()}});
    if let Some(id) = id.and_then(Value::as_str).filter(|id| id.len() <= 96) {
        result["id"] = json!(id);
    }
    result
}
fn reply(id: &str, kind: &str, data: Value) -> Value {
    json!({"v":1,"id":id,"ok":true,"kind":kind,"data":data})
}

fn authenticate(stream: &mut TcpStream, token: &str) -> io::Result<bool> {
    stream.set_read_timeout(Some(Duration::from_secs(3)))?;
    stream.set_write_timeout(Some(Duration::from_secs(3)))?;
    let value = read_frame(stream)?.ok_or_else(|| io::Error::other("authentication missing"))?;
    if value["v"] != 1
        || value["op"] != "authenticate"
        || !value["token"]
            .as_str()
            .is_some_and(|candidate| platform::constant_time_equal(candidate, token))
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "authentication failed",
        ));
    }
    let admin = match value["mode"].as_str() {
        Some("sensor") => false,
        Some("admin") => true,
        _ => return Err(io::Error::other("invalid connection mode")),
    };
    stream.set_read_timeout(None)?;
    Ok(admin)
}

pub fn daemon(directory: &Path) -> io::Result<()> {
    let lifecycle = Lifecycle::from_environment()?;
    platform::secure_directory(directory)?;
    let lock = platform::open_private(&directory.join("broker.lock"), false)?;
    lock.try_lock()
        .map_err(|_| io::Error::new(io::ErrorKind::AlreadyExists, "broker already running"))?;
    let store = match platform::read_private(&directory.join("state.json"), wire::MAX_FRAME) {
        Ok(bytes) => {
            let value: Value = serde_json::from_slice(&bytes)
                .map_err(|_| io::Error::other("saved state is invalid; run doctor"))?;
            Store::restore(&value, now_ms())
                .map_err(|message| io::Error::new(io::ErrorKind::InvalidData, message))?
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => Store::default(),
        Err(error) => return Err(error),
    };
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
    let address = listener.local_addr()?;
    let token = platform::random_hex(32)?;
    let endpoint = json!({"v":1,"port":address.port(),"token":token,"pid":std::process::id()});
    platform::atomic_write(
        &directory.join("endpoint.json"),
        &serde_json::to_vec(&endpoint)?,
    )?;
    let shared = Arc::new(Mutex::new(Hub {
        store,
        peers: BTreeMap::new(),
        persistence_error: None,
        lifecycle: lifecycle.clone(),
    }));
    let stop_signal = lifecycle.clone();
    let stop_thread = thread::spawn(move || {
        stop_signal.wait_for_stop();
        // One local connection wakes blocking accept after the stop decision.
        // It is never authenticated or counted as a browser lease.
        let _ = TcpStream::connect_timeout(&address, Duration::from_secs(1));
    });
    let connections: Connections = Arc::new(Mutex::new(BTreeMap::new()));
    let mut workers = Vec::<thread::JoinHandle<()>>::new();
    let mut next_connection = 0u64;
    let outcome = loop {
        let stream = match listener.accept() {
            Ok((stream, _)) => stream,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(error) => break Err(error),
        };
        if lifecycle.is_stopping() {
            let _ = stream.shutdown(Shutdown::Both);
            break Ok(());
        }
        // Reap only on a connection event; retained join handles and sockets
        // stay bounded even after many browser open/close cycles.
        for index in (0..workers.len()).rev() {
            if workers[index].is_finished() {
                let _ = workers.swap_remove(index).join();
            }
        }
        let mut active = connections.lock().unwrap();
        if active.len() >= 40 {
            let _ = stream.shutdown(Shutdown::Both);
            continue;
        }
        let held_stream = match stream.try_clone() {
            Ok(stream) => stream,
            Err(error) => break Err(error),
        };
        next_connection += 1;
        let connection_id = next_connection;
        active.insert(connection_id, held_stream);
        drop(active);
        let guard = ConnectionGuard {
            id: connection_id,
            connections: connections.clone(),
        };
        let shared = shared.clone();
        let lifecycle = lifecycle.clone();
        let token = token.clone();
        let directory = directory.to_owned();
        workers.push(thread::spawn(move || {
            let _guard = guard;
            let _ = connection(
                stream,
                &token,
                &directory,
                shared,
                &lifecycle,
                connection_id,
            );
        }));
    };
    lifecycle.request_stop();
    drop(listener);
    let _ = stop_thread.join();
    for stream in connections.lock().unwrap().values() {
        let _ = stream.shutdown(Shutdown::Both);
    }
    // Finish old readers before releasing the process lock. None can write
    // stale state over a newly started broker's state after this point.
    for worker in workers {
        let _ = worker.join();
    }
    let mut hub = shared.lock().unwrap();
    let clients: Vec<String> = hub.store.clients.keys().cloned().collect();
    for id in clients {
        hub.store.disconnect(&id, now_ms());
    }
    let saved = hub.persist(directory);
    drop(hub);
    let _ = fs::remove_file(directory.join("endpoint.json"));
    drop(lock);
    outcome.and(saved)
}

fn connection(
    mut stream: TcpStream,
    token: &str,
    directory: &Path,
    shared: Arc<Mutex<Hub>>,
    lifecycle: &Arc<Lifecycle>,
    connection_id: u64,
) -> io::Result<()> {
    stream.set_nodelay(true)?;
    let admin = authenticate(&mut stream, token)?;
    // Admission is committed before returning authentication success. An idle
    // timeout cannot race a successful native connect into a stopping broker.
    let _lease = if admin {
        if lifecycle.is_stopping() {
            return Err(io::Error::new(
                io::ErrorKind::ConnectionAborted,
                "broker is stopping",
            ));
        }
        None
    } else {
        Some(lifecycle.acquire()?)
    };
    write_frame(
        &mut stream,
        &json!({"v":1,"ok":true,"kind":"authenticated"}),
    )?;
    if admin {
        stream.set_read_timeout(Some(Duration::from_secs(3)))?;
        let request =
            read_frame(&mut stream)?.ok_or_else(|| io::Error::other("admin request missing"))?;
        match request["op"].as_str() {
            Some("snapshot") => write_frame(
                &mut stream,
                &json!({"v":1,"ok":true,"kind":"snapshot","data":shared.lock().unwrap().snapshot()}),
            )?,
            Some("shutdown") => {
                let mut hub = shared.lock().unwrap();
                let clients: Vec<String> = hub.store.clients.keys().cloned().collect();
                for id in clients {
                    hub.store.disconnect(&id, now_ms());
                }
                hub.persist(directory)?;
                lifecycle.stop_with(|| {
                    write_frame(&mut stream, &json!({"v":1,"ok":true,"kind":"stopped"}))
                })?;
            }
            _ => write_frame(
                &mut stream,
                &error(None, "unsupported_operation", "unsupported admin operation"),
            )?,
        }
        return Ok(());
    }
    let mut writer = stream.try_clone()?;
    let (sender, receiver) = mpsc::sync_channel::<Value>(4);
    let writer_thread = thread::spawn(move || {
        while let Ok(message) = receiver.recv() {
            if write_frame(&mut writer, &message).is_err() {
                break;
            }
        }
        let _ = writer.shutdown(Shutdown::Both);
    });
    let mut client_id: Option<String> = None;
    while let Ok(Some(request)) = read_frame(&mut stream) {
        let result = process_request(
            &request,
            &mut client_id,
            &stream,
            &sender,
            directory,
            &shared,
            connection_id,
        );
        match result {
            Ok(close) => {
                if close {
                    break;
                }
            }
            Err(message) => {
                if sender
                    .try_send(error(request.get("id"), "invalid_request", message))
                    .is_err()
                {
                    break;
                }
            }
        }
    }
    if let Some(id) = client_id {
        let mut hub = shared.lock().unwrap();
        if hub.disconnect_owned(&id, connection_id) {
            let _ = hub.persist(directory);
        }
        // A prior backpressure eviction already removed this reader. Still
        // publish the latest state, without touching a replacement's identity.
        hub.broadcast(directory);
    }
    drop(sender);
    let _ = stream.shutdown(Shutdown::Both);
    let _ = writer_thread.join();
    Ok(())
}

fn process_request(
    request: &Value,
    client_id: &mut Option<String>,
    stream: &TcpStream,
    sender: &SyncSender<Value>,
    directory: &Path,
    shared: &Arc<Mutex<Hub>>,
    connection_id: u64,
) -> Result<bool, String> {
    if request["v"] != 1 {
        return Err("unsupported protocol version".into());
    }
    let id = state::text(request, "id", 96, false)?;
    let operation = state::text(request, "op", 24, false)?;
    let now = now_ms();
    let mut hub = shared.lock().map_err(|_| "hub unavailable")?;
    // Keep a rollback point until the durable write succeeds. A failed ack or
    // observation must not silently survive only in this process's memory.
    let before = matches!(
        operation.as_str(),
        "hello" | "observe" | "remove" | "ack" | "snooze" | "alert_settings"
    )
    .then(|| hub.store.clone());
    let mut changed = false;
    let response = if operation == "hello" {
        if client_id.is_some() {
            return Err("hello is already complete".into());
        }
        let identity = hub.store.hello_with_alert_settings(
            &request["client"],
            request.get("alertSettings"),
            now,
        )?;
        hub.peers.insert(
            identity.clone(),
            Peer {
                connection_id,
                sender: sender.clone(),
                stream: stream
                    .try_clone()
                    .map_err(|_| "could not register sensor")?,
            },
        );
        *client_id = Some(identity.clone());
        changed = true;
        let mut snapshot = hub.snapshot();
        snapshot["clientId"] = json!(identity);
        reply(&id, "snapshot", snapshot)
    } else {
        let client = client_id.as_deref().ok_or("hello required first")?;
        if !hub.owns(client, connection_id) {
            return Ok(true);
        }
        match operation.as_str() {
            "observe" => {
                changed = hub.store.observe(client, &request["event"], now)?;
                reply(
                    &id,
                    "ack",
                    json!({"revision":hub.store.revision,"changed":changed}),
                )
            }
            "remove" => {
                changed = hub.store.remove(client, state::tab_id(request)?, now);
                reply(
                    &id,
                    "ack",
                    json!({"revision":hub.store.revision,"changed":changed}),
                )
            }
            "snapshot" => reply(&id, "snapshot", hub.snapshot()),
            "alert_settings" => {
                let initialize_only = match request.get("initializeOnly") {
                    None => false,
                    Some(value) => value.as_bool().ok_or("initializeOnly must be a boolean")?,
                };
                changed =
                    hub.store
                        .set_alert_settings(&request["settings"], initialize_only, now)?;
                reply(&id, "snapshot", hub.snapshot())
            }
            "ack" => {
                hub.store
                    .acknowledge(&state::identifier(request, "incidentId")?, now)?;
                changed = true;
                reply(&id, "ack", json!({"revision":hub.store.revision}))
            }
            "snooze" => {
                hub.store.snooze(
                    &state::identifier(request, "incidentId")?,
                    request["durationMs"]
                        .as_u64()
                        .ok_or("durationMs is required")?,
                    now,
                )?;
                changed = true;
                reply(&id, "ack", json!({"revision":hub.store.revision}))
            }
            "focus" => {
                let (target, event) =
                    hub.store
                        .focus(&state::text(request, "sessionId", 220, false)?)?;
                let peer = hub
                    .peers
                    .get(&target)
                    .ok_or("owning browser is disconnected")?;
                peer.sender
                    .try_send(event)
                    .map_err(|_| "owning browser is busy or disconnected")?;
                reply(&id, "ack", json!({"routed":true}))
            }
            "bye" => {
                let _ = sender.try_send(reply(&id, "ack", json!({"disconnected":true})));
                return Ok(true);
            }
            _ => {
                return Err(
                    "unsupported operation; consent and command automation are unavailable".into(),
                );
            }
        }
    };
    if changed && hub.persist(directory).is_err() {
        if let Some(before) = before {
            hub.store = before;
        }
        if operation == "hello"
            && let Some(identity) = client_id.take()
        {
            hub.peers.remove(&identity);
        }
        sender
            .try_send(error(
                Some(&json!(id)),
                "persistence_failed",
                "Change was not applied because it could not be saved; check companion doctor",
            ))
            .map_err(|_| "sensor output closed")?;
        hub.broadcast(directory);
        return Ok(false);
    }
    sender
        .try_send(response)
        .map_err(|_| "sensor output closed")?;
    if changed {
        hub.broadcast(directory);
    }
    Ok(false)
}

fn read_endpoint(directory: &Path) -> io::Result<Value> {
    let bytes = platform::read_private(&directory.join("endpoint.json"), 4096)?;
    serde_json::from_slice(&bytes).map_err(|_| io::Error::other("invalid broker endpoint"))
}

pub fn connect(directory: &Path, admin: bool) -> io::Result<TcpStream> {
    let endpoint = read_endpoint(directory)?;
    if endpoint["v"] != 1 {
        return Err(io::Error::other("unsupported broker endpoint"));
    }
    let port = endpoint["port"]
        .as_u64()
        .filter(|p| *p > 0 && *p <= u16::MAX as u64)
        .ok_or_else(|| io::Error::other("invalid local port"))?;
    let token = endpoint["token"]
        .as_str()
        .filter(|t| t.len() == 64 && t.bytes().all(|b| b.is_ascii_hexdigit()))
        .ok_or_else(|| io::Error::other("invalid broker credential"))?;
    let address = SocketAddr::from((Ipv4Addr::LOCALHOST, port as u16));
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_millis(400))?;
    stream.set_read_timeout(Some(Duration::from_secs(3)))?;
    stream.set_write_timeout(Some(Duration::from_secs(3)))?;
    stream.set_nodelay(true)?;
    write_frame(
        &mut stream,
        &json!({"v":1,"op":"authenticate","token":token,"mode":if admin{"admin"}else{"sensor"}}),
    )?;
    let response =
        read_frame(&mut stream)?.ok_or_else(|| io::Error::other("broker handshake closed"))?;
    if response["ok"] != true || response["kind"] != "authenticated" {
        return Err(io::Error::other("broker handshake rejected"));
    }
    stream.set_read_timeout(None)?;
    Ok(stream)
}

pub fn ensure_connected(directory: &Path) -> io::Result<TcpStream> {
    platform::secure_directory(directory).map_err(|error| {
        io::Error::new(
            error.kind(),
            format!("Cannot prepare the private hub data directory: {error}"),
        )
    })?;
    if let Ok(stream) = connect(directory, false) {
        return Ok(stream);
    }
    let startup_lock =
        platform::open_private(&directory.join("startup.lock"), false).map_err(|error| {
            io::Error::new(
                error.kind(),
                format!("Cannot open the private hub startup lock: {error}"),
            )
        })?;
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut elected = false;
    let mut launched = false;
    // This bounded retry exists only during startup. The separate election
    // lock prevents a process storm when many profiles reopen together. Wait
    // for a stopping broker to release its lock before launching its successor;
    // spawning once against that old lock would otherwise strand the caller.
    while Instant::now() < deadline {
        if let Ok(stream) = connect(directory, false) {
            return Ok(stream);
        }
        if !elected {
            elected = match startup_lock.try_lock() {
                Ok(()) => true,
                Err(std::fs::TryLockError::WouldBlock) => false,
                Err(std::fs::TryLockError::Error(error)) => return Err(error),
            };
        }
        if elected && !launched {
            let broker_lock = platform::open_private(&directory.join("broker.lock"), false)?;
            match broker_lock.try_lock() {
                Ok(()) => {
                    drop(broker_lock);
                    platform::spawn_daemon(directory)?;
                    launched = true;
                }
                Err(std::fs::TryLockError::WouldBlock) => {}
                Err(std::fs::TryLockError::Error(error)) => return Err(error),
            }
        }
        thread::sleep(Duration::from_millis(50));
    }
    Err(io::Error::other(
        "companion could not start; run constellation-monitor doctor, or daemon in a terminal for the exact error",
    ))
}

pub fn native(directory: &Path) -> io::Result<()> {
    let mut upstream = ensure_connected(directory)?;
    let mut downstream = upstream.try_clone()?;
    thread::spawn(move || {
        let stdin = io::stdin();
        let mut stdin = stdin.lock();
        loop {
            match read_frame(&mut stdin) {
                Ok(Some(value)) => {
                    if write_frame(&mut upstream, &value).is_err() {
                        break;
                    }
                }
                Ok(None) => break,
                Err(error) => {
                    eprintln!("Native input rejected: {}", error.kind());
                    break;
                }
            }
        }
        let _ = upstream.shutdown(Shutdown::Both);
    });
    let stdout = io::stdout();
    let mut stdout = stdout.lock();
    while let Ok(Some(value)) = read_frame(&mut downstream) {
        if write_frame(&mut stdout, &value).is_err() {
            break;
        }
    }
    let _ = downstream.shutdown(Shutdown::Both);
    // The stdin reader may be blocked in an OS pipe read. Returning from main
    // ends the native host promptly and lets the browser report disconnection.
    Ok(())
}

pub fn admin_request(directory: &Path, operation: &str) -> io::Result<Value> {
    let mut stream = connect(directory, true)?;
    stream.set_read_timeout(Some(Duration::from_secs(3)))?;
    write_frame(&mut stream, &json!({"v":1,"op":operation}))?;
    read_frame(&mut stream)?.ok_or_else(|| io::Error::other("broker closed before reply"))
}

pub fn state_path(directory: &Path) -> PathBuf {
    directory.join("state.json")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_evicted_reader_cannot_disconnect_or_mutate_its_replacement() {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let stream = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
        let (_other_end, _) = listener.accept().unwrap();
        let (sender, _receiver) = mpsc::sync_channel(4);
        let mut hub = Hub {
            store: Store::default(),
            peers: BTreeMap::new(),
            persistence_error: None,
            lifecycle: Lifecycle::from_environment().unwrap(),
        };
        let identity = json!({"browser":"chrome","profileId":"work","instanceId":"session"});
        let id = hub.store.hello(&identity, now_ms()).unwrap();
        hub.peers.insert(
            id.clone(),
            Peer {
                connection_id: 1,
                sender: sender.clone(),
                stream: stream.try_clone().unwrap(),
            },
        );
        // Model a failed writer's eviction, then a replacement hello before
        // the old reader thread has observed its socket shutdown.
        assert!(hub.disconnect_owned(&id, 1));
        hub.store.hello(&identity, now_ms()).unwrap();
        hub.peers.insert(
            id.clone(),
            Peer {
                connection_id: 2,
                sender: sender.clone(),
                stream: stream.try_clone().unwrap(),
            },
        );
        assert!(!hub.disconnect_owned(&id, 1));
        assert!(hub.store.clients[&id].connected);
        let revision = hub.store.revision;
        let shared = Arc::new(Mutex::new(hub));
        let mut old_identity = Some(id.clone());
        assert!(
            process_request(
                &json!({"v":1,"id":"stale-remove","op":"remove","tabId":42}),
                &mut old_identity,
                &stream,
                &sender,
                Path::new("."),
                &shared,
                1,
            )
            .unwrap()
        );
        let mut hub = shared.lock().unwrap();
        assert_eq!(hub.store.revision, revision);
        assert!(hub.owns(&id, 2));
        assert!(hub.disconnect_owned(&id, 2));
        assert!(!hub.store.clients[&id].connected);
    }
}
