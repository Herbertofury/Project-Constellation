//! Real child-process/native-stdio and loopback-broker tests. These exercise
//! actual framing, shared persistence and routing, not a mocked transport.
use constellation_monitor::{
    broker, now_ms, platform,
    wire::{read_frame, write_frame},
};
use serde_json::{Value, json};
use std::{
    fs,
    io::Write,
    path::PathBuf,
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        Arc, Barrier,
        mpsc::{self, Receiver},
    },
    thread,
    time::{Duration, Instant},
};

struct Runtime {
    directory: PathBuf,
    idle_grace_ms: u64,
}

#[cfg(windows)]
#[test]
fn windows_native_start_honors_a_job_that_forbids_breakaway() {
    // The helper owns its restrictive Job for its entire process lifetime.
    // Do not assign the shared Rust test runner to a Job or relax the CI Job.
    let mut child = Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "windows_restrictive_job_helper",
            "--ignored",
            "--nocapture",
        ])
        .env("CONSTELLATION_WINDOWS_JOB_TEST", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let end = Instant::now() + Duration::from_secs(25);
    while child.try_wait().unwrap().is_none() {
        if Instant::now() >= end {
            let _ = child.kill();
            let output = child.wait_with_output().unwrap();
            panic!(
                "restrictive Job regression timed out: {} {}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
        }
        thread::sleep(Duration::from_millis(20));
    }
    let output = child.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "restrictive Job regression failed: {} {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

#[cfg(windows)]
#[test]
#[ignore = "run in an isolated child by windows_native_start_honors_a_job_that_forbids_breakaway"]
fn windows_restrictive_job_helper() {
    assert_eq!(
        std::env::var("CONSTELLATION_WINDOWS_JOB_TEST").as_deref(),
        Ok("1")
    );
    type Handle = *mut std::ffi::c_void;
    #[repr(C)]
    #[derive(Default)]
    struct BasicLimits {
        process_time: i64,
        job_time: i64,
        flags: u32,
        minimum_working_set: usize,
        maximum_working_set: usize,
        active_processes: u32,
        affinity: usize,
        priority: u32,
        scheduling: u32,
    }
    #[repr(C)]
    #[derive(Default)]
    struct ExtendedLimits {
        basic: BasicLimits,
        io: [u64; 6],
        process_memory: usize,
        job_memory: usize,
        peak_process_memory: usize,
        peak_job_memory: usize,
    }
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn CreateJobObjectW(attributes: Handle, name: *const u16) -> Handle;
        fn SetInformationJobObject(job: Handle, class: u32, info: Handle, size: u32) -> i32;
        fn AssignProcessToJobObject(job: Handle, process: Handle) -> i32;
        fn GetCurrentProcess() -> Handle;
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> Handle;
        fn IsProcessInJob(process: Handle, job: Handle, inside: *mut i32) -> i32;
        fn CloseHandle(handle: Handle) -> i32;
    }
    let job = unsafe { CreateJobObjectW(std::ptr::null_mut(), std::ptr::null()) };
    assert!(!job.is_null(), "{}", std::io::Error::last_os_error());
    let mut limits = ExtendedLimits::default();
    limits.basic.flags = 0x2000; // KILL_ON_JOB_CLOSE, deliberately no breakaway permission.
    assert_ne!(
        unsafe {
            SetInformationJobObject(
                job,
                9,
                (&mut limits as *mut ExtendedLimits).cast(),
                std::mem::size_of::<ExtendedLimits>() as u32,
            )
        },
        0,
        "{}",
        std::io::Error::last_os_error()
    );
    assert_ne!(
        unsafe { AssignProcessToJobObject(job, GetCurrentProcess()) },
        0,
        "{}",
        std::io::Error::last_os_error()
    );
    // Intentionally retain this one handle until the isolated helper exits.
    // Closing it here would terminate this helper too. Windows closes it on
    // helper exit and contains any descendants even if a test assertion fails.
    let runtime = Runtime::new();
    let mut sensor = Sensor::new(&runtime);
    sensor.hello("chrome");
    sensor.observe("error");
    let snapshot = sensor.snapshot();
    assert_eq!(snapshot["health"]["processLifetime"]["jobManaged"], true);
    assert_eq!(
        snapshot["health"]["processLifetime"]["breakawayAllowed"],
        false
    );
    assert_eq!(
        snapshot["health"]["processLifetime"]["killOnJobClose"],
        true
    );
    let broker = unsafe {
        OpenProcess(
            0x1000,
            0,
            runtime.endpoint()["pid"].as_u64().unwrap() as u32,
        )
    };
    assert!(!broker.is_null(), "{}", std::io::Error::last_os_error());
    let mut inside = 0;
    assert_ne!(unsafe { IsProcessInJob(broker, job, &mut inside) }, 0);
    unsafe { CloseHandle(broker) };
    assert_eq!(inside, 1, "broker escaped the owning restrictive Job");
    sensor.close_pipe();
    runtime.wait_stopped();
    let mut reopened = Sensor::new(&runtime);
    reopened.hello("edge");
    assert_eq!(reopened.snapshot()["incidents"][0]["kind"], "error");
    reopened.close_pipe();
    runtime.wait_stopped();
}
impl Runtime {
    fn new() -> Self {
        let directory = std::env::temp_dir().join(format!(
            "constellation-monitor-test-{}",
            platform::random_hex(12).unwrap()
        ));
        Self {
            directory,
            idle_grace_ms: 800,
        }
    }
    fn endpoint(&self) -> Value {
        serde_json::from_slice(
            &platform::read_private(&self.directory.join("endpoint.json"), 4096).unwrap(),
        )
        .unwrap()
    }
    fn start_daemon(&self) -> Child {
        let mut daemon = Command::new(env!("CARGO_BIN_EXE_constellation-monitor"))
            .arg("daemon")
            .arg("--data-dir")
            .arg(&self.directory)
            .env("CONSTELLATION_IDLE_GRACE_MS", "5000")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::inherit())
            .spawn()
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(4);
        while !self.directory.join("endpoint.json").exists() {
            assert!(
                daemon.try_wait().unwrap().is_none(),
                "broker exited during startup"
            );
            assert!(
                Instant::now() < deadline,
                "broker did not publish its endpoint"
            );
            thread::sleep(Duration::from_millis(10));
        }
        daemon
    }
    fn wait_stopped(&self) {
        let end = Instant::now() + Duration::from_secs(5);
        loop {
            if !self.directory.join("endpoint.json").exists() {
                let lock =
                    platform::open_private(&self.directory.join("broker.lock"), false).unwrap();
                if lock.try_lock().is_ok() {
                    assert!(broker::connect(&self.directory, false).is_err());
                    return;
                }
            }
            assert!(Instant::now() < end, "broker outlived its final browser");
            thread::sleep(Duration::from_millis(10));
        }
    }
}
impl Drop for Runtime {
    fn drop(&mut self) {
        let _ = broker::admin_request(&self.directory, "shutdown");
        let _ = fs::remove_dir_all(&self.directory);
    }
}

struct Sensor {
    child: Child,
    input: Option<ChildStdin>,
    output: Receiver<Value>,
}
impl Sensor {
    fn new(runtime: &Runtime) -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_constellation-monitor"))
            .arg("native")
            .arg("--data-dir")
            .arg(&runtime.directory)
            .env(
                "CONSTELLATION_IDLE_GRACE_MS",
                runtime.idle_grace_ms.to_string(),
            )
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .unwrap();
        let input = child.stdin.take().unwrap();
        let mut stdout = child.stdout.take().unwrap();
        let (sender, output) = mpsc::channel();
        thread::spawn(move || {
            while let Ok(Some(value)) = read_frame(&mut stdout) {
                if sender.send(value).is_err() {
                    break;
                }
            }
        });
        Self {
            child,
            input: Some(input),
            output,
        }
    }
    fn send(&mut self, value: Value) {
        write_frame(self.input.as_mut().unwrap(), &value).unwrap();
    }
    fn close_pipe(&mut self) {
        // Browser native ports close stdin on disconnect. Exercise that normal
        // path instead of killing the host or asking the broker to stop.
        drop(self.input.take());
        let end = Instant::now() + Duration::from_secs(3);
        loop {
            if let Some(status) = self.child.try_wait().unwrap() {
                assert!(status.success(), "native host failed on EOF: {status}");
                return;
            }
            assert!(
                Instant::now() < end,
                "native host did not exit on stdin EOF"
            );
            thread::sleep(Duration::from_millis(10));
        }
    }
    fn wait_for(&self, predicate: impl Fn(&Value) -> bool) -> Value {
        let end = Instant::now() + Duration::from_secs(6);
        loop {
            let wait = end.saturating_duration_since(Instant::now());
            let value = self
                .output
                .recv_timeout(wait)
                .expect("expected native response before timeout");
            if predicate(&value) {
                return value;
            }
        }
    }
    fn response(&self, id: &str) -> Value {
        self.wait_for(|v| v["id"] == id)
    }
    fn hello(&mut self, browser: &str) -> Value {
        self.send(json!({"v":1,"id":"hello","op":"hello","client":{"browser":browser,"profileId":"work","instanceId":"session","label":browser}}));
        let response = self.response("hello");
        assert_eq!(response["ok"], true, "{response}");
        response
    }
    fn snapshot(&mut self) -> Value {
        self.send(json!({"v":1,"id":"snapshot","op":"snapshot"}));
        self.response("snapshot")["data"].clone()
    }
    fn observe(&mut self, status: &str) {
        self.send(json!({"v":1,"id":"event","op":"observe","event":{"tabId":42,"documentId":"doc","runId":"run","url":"https://chatgpt.com/c/test?private=never-store","title":"Roundtrip","status":status,"reason":"Test status","observedAt":now_ms()}}));
        let response = self.response("event");
        assert_eq!(response["ok"], true, "{response}");
    }
}
impl Drop for Sensor {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[test]
fn two_native_hosts_share_incidents_route_focus_and_persist_disconnects() {
    let runtime = Runtime::new();
    let mut chrome = Sensor::new(&runtime);
    let hello = chrome.hello("chrome");
    assert_eq!(hello["data"]["clientId"], "chrome:work:session");
    let mut firefox = Sensor::new(&runtime);
    firefox.hello("firefox");
    chrome.observe("permission_required");
    firefox.observe("error");
    let snapshot = chrome.snapshot();
    assert_eq!(snapshot["sessions"].as_array().unwrap().len(), 2);
    assert_eq!(snapshot["incidents"].as_array().unwrap().len(), 2);
    assert!(!snapshot.to_string().contains("private=never-store"));
    let rev = snapshot["revision"].as_u64().unwrap();
    chrome.observe("permission_required");
    assert_eq!(chrome.snapshot()["revision"], rev);
    chrome.send(json!({"v":1,"id":"focus","op":"focus","sessionId":"firefox:work:session:42"}));
    assert_eq!(chrome.response("focus")["data"]["routed"], true);
    let focus = firefox.wait_for(|v| v["kind"] == "focus");
    assert_eq!(focus["data"]["tabId"], 42);
    assert!(focus["data"].get("url").is_none());
    chrome.send(json!({"v":1,"id":"ack","op":"ack","incidentId":"incident-1"}));
    assert_eq!(chrome.response("ack")["ok"], true);
    firefox.send(json!({"v":1,"id":"remove","op":"remove","tabId":42}));
    assert_eq!(firefox.response("remove")["ok"], true);
    assert_eq!(chrome.snapshot()["sessions"].as_array().unwrap().len(), 1);
    chrome.send(json!({"v":1,"id":"forbidden","op":"click_allow"}));
    assert_eq!(chrome.response("forbidden")["ok"], false);
    let saved = platform::read_private(
        &runtime.directory.join("state.json"),
        constellation_monitor::wire::MAX_FRAME,
    )
    .unwrap();
    let state: Value = serde_json::from_slice(&saved).unwrap();
    assert!(state["incidents"][0]["acknowledgedAt"].as_u64().is_some());
    assert!(state["incidents"][1]["resolvedAt"].as_u64().is_some());
    // Stop affects the shared broker and closes native ports without waiting for
    // new stdin traffic. Reconnecting restores history, marked disconnected.
    let stopped = broker::admin_request(&runtime.directory, "shutdown").unwrap();
    assert_eq!(stopped["ok"], true);
    let end = Instant::now() + Duration::from_secs(3);
    loop {
        if chrome.child.try_wait().unwrap().is_some() {
            break;
        }
        assert!(
            Instant::now() < end,
            "native host did not exit on broker shutdown"
        );
        thread::sleep(Duration::from_millis(10));
    }
    let mut reopened = Sensor::new(&runtime);
    reopened.hello("chrome");
    let restored = reopened.snapshot();
    assert_eq!(restored["sessions"][0]["connected"], false);
    assert!(
        restored["incidents"][0]["acknowledgedAt"]
            .as_u64()
            .is_some()
    );
}

#[test]
fn burst_observations_keep_a_paused_sensor_connected_and_preserve_incidents() {
    let runtime = Runtime::new();
    let mut publisher = Sensor::new(&runtime);
    publisher.hello("chrome");
    // Authenticate a real second transport, then briefly pause its reads while
    // the first browser reports many tabs. Bound the pause below the genuine
    // slow-reader deadline, even when durable saves are slow on a Windows host.
    let mut reader = broker::connect(&runtime.directory, false).unwrap();
    reader
        .set_read_timeout(Some(Duration::from_secs(3)))
        .unwrap();
    write_frame(
        &mut reader,
        &json!({"v":1,"id":"reader-hello","op":"hello",
        "client":{"browser":"firefox","profileId":"work","instanceId":"session"}}),
    )
    .unwrap();
    loop {
        let response = read_frame(&mut reader).unwrap().unwrap();
        if response["id"] == "reader-hello" {
            assert_eq!(response["ok"], true);
            break;
        }
    }
    let mut read_stream = reader.try_clone().unwrap();
    let (sender, messages) = mpsc::channel();
    let reading = thread::spawn(move || {
        thread::sleep(Duration::from_millis(100));
        while let Ok(Some(value)) = read_frame(&mut read_stream) {
            if sender.send(value).is_err() {
                break;
            }
        }
    });
    let observed = now_ms();
    for tab in 0..96 {
        publisher.send(json!({"v":1,"id":"burst","op":"observe","event":{
            "tabId":tab,"documentId":format!("doc-{tab}"),"runId":"run",
            "url":format!("https://chatgpt.com/c/burst-{tab}"),"title":"Burst test",
            "status":"error","reason":"A concurrent tab needs attention","observedAt":observed}}));
        assert_eq!(publisher.response("burst")["ok"], true);
    }
    let final_snapshot = publisher.snapshot();
    assert_eq!(final_snapshot["health"]["connectedBrowsers"], 2);
    assert_eq!(final_snapshot["sessions"].as_array().unwrap().len(), 96);
    assert_eq!(final_snapshot["incidents"].as_array().unwrap().len(), 96);
    let revision = final_snapshot["revision"].as_u64().unwrap();
    loop {
        let message = messages
            .recv_timeout(Duration::from_secs(3))
            .expect("paused sensor was disconnected");
        if message["kind"] == "snapshot" && message["data"]["revision"].as_u64() == Some(revision) {
            assert_eq!(message["data"]["incidents"].as_array().unwrap().len(), 96);
            break;
        }
    }
    write_frame(
        &mut reader,
        &json!({"v":1,"id":"reader-ack","op":"ack","incidentId":"incident-96"}),
    )
    .unwrap();
    loop {
        let message = messages.recv_timeout(Duration::from_secs(3)).unwrap();
        if message["id"] == "reader-ack" {
            assert_eq!(message["ok"], true);
            break;
        }
    }
    let current = publisher.snapshot();
    assert!(
        current["incidents"][95]["acknowledgedAt"]
            .as_u64()
            .is_some()
    );
    assert_eq!(current["health"]["connectedBrowsers"], 2);
    reader.shutdown(std::net::Shutdown::Both).unwrap();
    reading.join().unwrap();
}

#[test]
fn unauthenticated_socket_and_malformed_native_input_are_rejected() {
    let runtime = Runtime::new();
    let mut sensor = Sensor::new(&runtime);
    sensor.hello("chrome");
    let endpoint: Value = serde_json::from_slice(
        &platform::read_private(&runtime.directory.join("endpoint.json"), 4096).unwrap(),
    )
    .unwrap();
    let mut socket =
        std::net::TcpStream::connect(("127.0.0.1", endpoint["port"].as_u64().unwrap() as u16))
            .unwrap();
    socket
        .set_read_timeout(Some(Duration::from_secs(4)))
        .unwrap();
    write_frame(
        &mut socket,
        &json!({"v":1,"op":"authenticate","mode":"admin","token":"0".repeat(64)}),
    )
    .unwrap();
    assert!(matches!(read_frame(&mut socket), Ok(None) | Err(_)));
    sensor
        .input
        .as_mut()
        .unwrap()
        .write_all(&u32::MAX.to_ne_bytes())
        .unwrap();
    sensor.input.as_mut().unwrap().flush().unwrap();
    let end = Instant::now() + Duration::from_secs(3);
    loop {
        if sensor.child.try_wait().unwrap().is_some() {
            break;
        }
        assert!(
            Instant::now() < end,
            "malformed native host did not terminate"
        );
        thread::sleep(Duration::from_millis(10));
    }
}

#[test]
fn failed_durable_write_rolls_back_observation_and_incident_sequence() {
    let runtime = Runtime::new();
    let mut sensor = Sensor::new(&runtime);
    sensor.hello("chrome");
    sensor.send(json!({"v":1,"id":"initial-settings","op":"alert_settings","settings":{"muteUntil":now_ms()+300_000},"initializeOnly":true}));
    assert_eq!(sensor.response("initial-settings")["ok"], true);
    let original = sensor.snapshot();
    let state_path = runtime.directory.join("state.json");
    let saved_path = runtime.directory.join("saved-state.json");
    fs::rename(&state_path, &saved_path).unwrap();
    fs::create_dir(&state_path).unwrap(); // Atomic replacement cannot replace a directory.
    sensor.send(json!({"v":1,"id":"failed-settings","op":"alert_settings","settings":{"muteUntil":0,"volume":0.9}}));
    let failure = sensor.response("failed-settings");
    assert_eq!(failure["error"]["code"], "persistence_failed");
    let after_settings = sensor.snapshot();
    assert_eq!(after_settings["revision"], original["revision"]);
    assert_eq!(after_settings["alertSettings"], original["alertSettings"]);
    sensor.send(json!({"v":1,"id":"failed-write","op":"observe","event":{
        "tabId":42,"documentId":"doc","url":"https://chatgpt.com/c/test",
        "status":"error","reason":"Cannot persist","observedAt":now_ms()}}));
    let failure = sensor.response("failed-write");
    assert_eq!(failure["ok"], false);
    assert_eq!(failure["error"]["code"], "persistence_failed");
    let after = sensor.snapshot();
    assert_eq!(after["revision"], original["revision"]);
    assert_eq!(after["sessions"].as_array().unwrap().len(), 0);
    assert_eq!(after["incidents"].as_array().unwrap().len(), 0);
    assert_eq!(after["health"]["persistence"], "error");
    fs::remove_dir(&state_path).unwrap();
    fs::rename(&saved_path, &state_path).unwrap();
    sensor.observe("error");
    assert_eq!(
        sensor.snapshot()["incidents"][0]["incidentId"],
        "incident-1"
    );
}

#[test]
fn acknowledged_duplicate_ordering_survives_an_abrupt_broker_restart() {
    let runtime = Runtime::new();
    let mut daemon = Command::new(env!("CARGO_BIN_EXE_constellation-monitor"))
        .arg("daemon")
        .arg("--data-dir")
        .arg(&runtime.directory)
        .env("CONSTELLATION_IDLE_GRACE_MS", "5000")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::inherit())
        .spawn()
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(4);
    while !runtime.directory.join("endpoint.json").exists() {
        assert!(
            daemon.try_wait().unwrap().is_none(),
            "broker exited during startup"
        );
        assert!(
            Instant::now() < deadline,
            "broker did not publish its endpoint"
        );
        thread::sleep(Duration::from_millis(10));
    }
    let mut sensor = Sensor::new(&runtime);
    sensor.hello("chrome");
    let now = now_ms();
    let mut event = json!({"tabId":42,"documentId":"doc","runId":"run",
        "url":"https://chatgpt.com/c/restart","title":"Durable ordering",
        "status":"error","reason":"Same issue","observedAt":now+60_000});
    sensor.send(json!({"v":1,"id":"initial","op":"observe","event":event}));
    assert_eq!(sensor.response("initial")["ok"], true);
    sensor.send(json!({"v":1,"id":"acknowledge","op":"ack","incidentId":"incident-1"}));
    assert_eq!(sensor.response("acknowledge")["ok"], true);
    let before = sensor.snapshot();
    event["observedAt"] = json!(now + 120_000);
    sensor.send(json!({"v":1,"id":"duplicate","op":"observe","event":event}));
    let response = sensor.response("duplicate");
    assert_eq!(response["ok"], true);
    assert_eq!(response["data"]["changed"], false);
    assert_eq!(response["data"]["revision"], before["revision"]);
    let saved: Value = serde_json::from_slice(
        &platform::read_private(&runtime.directory.join("state.json"), 1_000_000).unwrap(),
    )
    .unwrap();
    assert_eq!(
        saved["sessions"][0]["observedAt"],
        now + 120_000,
        "the successful acknowledgement must cover durable ordering metadata"
    );

    // Kill only the child created above. Unlike graceful shutdown, no final
    // save can hide an acknowledged observation that existed only in memory.
    daemon.kill().unwrap();
    daemon.wait().unwrap();
    sensor.close_pipe();
    let mut reopened = Sensor::new(&runtime);
    reopened.hello("chrome");
    event["status"] = json!("running");
    // Accepted source-clock skew must remain ordered after restore too; do
    // not clamp the saved watermark back to this process's wall clock.
    event["observedAt"] = json!(now + 90_000);
    reopened.send(json!({"v":1,"id":"late-clearance","op":"observe","event":event}));
    let response = reopened.response("late-clearance");
    assert_eq!(response["ok"], true);
    assert_eq!(response["data"]["changed"], false);
    event["status"] = json!("closed");
    reopened.send(json!({"v":1,"id":"late-close","op":"observe","event":event}));
    assert_eq!(reopened.response("late-close")["data"]["changed"], false);
    event["documentId"] = json!("previous-document");
    event["observedAt"] = json!(now + 150_000);
    reopened.send(json!({"v":1,"id":"unrelated-close","op":"observe","event":event}));
    assert_eq!(
        reopened.response("unrelated-close")["data"]["changed"],
        false
    );
    let after = reopened.snapshot();
    assert_eq!(after["sessions"][0]["status"], "error");
    assert_eq!(after["incidents"].as_array().unwrap().len(), 1);
    assert!(after["incidents"][0]["resolvedAt"].is_null());
    assert_eq!(
        after["incidents"][0]["acknowledgedAt"],
        before["incidents"][0]["acknowledgedAt"]
    );
}

#[test]
fn duplicate_ordering_write_failure_rolls_back_and_can_be_retried() {
    let runtime = Runtime::new();
    let mut sensor = Sensor::new(&runtime);
    sensor.hello("chrome");
    let now = now_ms();
    let mut event = json!({"tabId":42,"documentId":"doc","url":"https://chatgpt.com/c/retry",
        "status":"error","reason":"Same issue","observedAt":now-1000});
    sensor.send(json!({"v":1,"id":"initial","op":"observe","event":event}));
    assert_eq!(sensor.response("initial")["ok"], true);
    let before = sensor.snapshot();
    let state_path = runtime.directory.join("state.json");
    let saved_path = runtime.directory.join("saved-state.json");
    fs::rename(&state_path, &saved_path).unwrap();
    fs::create_dir(&state_path).unwrap();
    sensor.send(json!({"v":1,"id":"exact-retry","op":"observe","event":event}));
    let response = sensor.response("exact-retry");
    assert_eq!(
        response["ok"], true,
        "an exact already-durable retry requires no new write"
    );
    assert_eq!(response["data"]["changed"], false);
    event["observedAt"] = json!(now - 500);
    sensor.send(json!({"v":1,"id":"failed-duplicate","op":"observe","event":event}));
    assert_eq!(
        sensor.response("failed-duplicate")["error"]["code"],
        "persistence_failed"
    );
    let after = sensor.snapshot();
    assert_eq!(after["revision"], before["revision"]);
    assert_eq!(after["sessions"], before["sessions"]);
    assert_eq!(after["incidents"], before["incidents"]);
    assert_eq!(after["health"]["persistence"], "error");
    fs::remove_dir(&state_path).unwrap();
    fs::rename(&saved_path, &state_path).unwrap();
    sensor.send(json!({"v":1,"id":"retry-duplicate","op":"observe","event":event}));
    let response = sensor.response("retry-duplicate");
    assert_eq!(response["ok"], true);
    assert_eq!(response["data"]["changed"], false);
    assert_eq!(response["data"]["revision"], before["revision"]);
    let saved: Value =
        serde_json::from_slice(&platform::read_private(&state_path, 1_000_000).unwrap()).unwrap();
    assert_eq!(saved["sessions"][0]["observedAt"], now - 500);
    assert_eq!(sensor.snapshot()["health"]["persistence"], "ok");
}

#[test]
fn accepted_closures_survive_abrupt_restart_and_do_not_block_other_browser_or_new_document() {
    let runtime = Runtime::new();
    let mut daemon = runtime.start_daemon();
    let mut chrome = Sensor::new(&runtime);
    chrome.hello("chrome");
    let mut firefox = Sensor::new(&runtime);
    firefox.hello("firefox");
    let now = now_ms();
    let mut event = json!({"tabId":42,"documentId":"original","runId":"run",
        "url":"https://chatgpt.com/c/closure","status":"error","observedAt":now+60_000});
    chrome.send(json!({"v":1,"id":"initial","op":"observe","event":event}));
    assert_eq!(chrome.response("initial")["ok"], true);
    chrome.send(json!({"v":1,"id":"ack","op":"ack","incidentId":"incident-1"}));
    assert_eq!(chrome.response("ack")["ok"], true);
    chrome.send(json!({"v":1,"id":"remove","op":"remove","tabId":42}));
    assert_eq!(chrome.response("remove")["data"]["changed"], true);
    event["tabId"] = json!(43);
    event["status"] = json!("closed");
    chrome.send(json!({"v":1,"id":"unseen-close","op":"observe","event":event}));
    let response = chrome.response("unseen-close");
    assert_eq!(response["ok"], true);
    assert_eq!(response["data"]["changed"], false);
    let saved: Value = serde_json::from_slice(
        &platform::read_private(&runtime.directory.join("state.json"), 1_000_000).unwrap(),
    )
    .unwrap();
    assert_eq!(saved["closureFences"].as_array().unwrap().len(), 2);
    assert_eq!(saved["closureFences"][0]["observedAt"], now + 60_000);
    assert!(chrome.snapshot().get("closureFences").is_none());
    daemon.kill().unwrap();
    daemon.wait().unwrap();
    chrome.close_pipe();
    firefox.close_pipe();

    let mut reopened = Sensor::new(&runtime);
    reopened.hello("chrome");
    for tab in [42, 43] {
        event["tabId"] = json!(tab);
        event["status"] = json!("error");
        for timestamp in [now + 30_000, now + 60_000] {
            event["observedAt"] = json!(timestamp);
            reopened.send(json!({"v":1,"id":"replay","op":"observe","event":event}));
            let response = reopened.response("replay");
            assert_eq!(response["ok"], true);
            assert_eq!(response["data"]["changed"], false);
        }
    }
    let closed = reopened.snapshot();
    assert!(closed["sessions"].as_array().unwrap().is_empty());
    assert_eq!(closed["incidents"].as_array().unwrap().len(), 1);
    assert_eq!(
        closed["incidents"][0]["acknowledgedAt"],
        saved["incidents"][0]["acknowledgedAt"]
    );
    assert_eq!(
        closed["incidents"][0]["resolvedAt"],
        saved["incidents"][0]["resolvedAt"]
    );
    let mut other = Sensor::new(&runtime);
    other.hello("firefox");
    event["tabId"] = json!(42);
    other.send(json!({"v":1,"id":"other","op":"observe","event":event}));
    assert_eq!(other.response("other")["data"]["changed"], true);
    event["documentId"] = json!("new-document");
    reopened.send(json!({"v":1,"id":"new","op":"observe","event":event}));
    assert_eq!(reopened.response("new")["data"]["changed"], true);
    let final_state = reopened.snapshot();
    assert_eq!(final_state["sessions"].as_array().unwrap().len(), 2);
    assert_eq!(final_state["incidents"].as_array().unwrap().len(), 3);
}

#[test]
fn source_timed_removal_allows_a_new_document_observed_before_delayed_broker_delivery() {
    let runtime = Runtime::new();
    let mut sensor = Sensor::new(&runtime);
    sensor.hello("chrome");
    let source = now_ms() - 1000;
    let mut event = json!({"tabId":42,"documentId":"before","runId":"run",
        "url":"https://chatgpt.com/c/source-time","status":"error","observedAt":source});
    sensor.send(json!({"v":1,"id":"initial","op":"observe","event":event}));
    assert_eq!(sensor.response("initial")["ok"], true);
    sensor.send(json!({"v":1,"id":"remove","op":"remove","tabId":42,"observedAt":source+100}));
    assert_eq!(sensor.response("remove")["data"]["changed"], true);
    event["documentId"] = json!("new-document");
    event["observedAt"] = json!(source + 101);
    sensor.send(json!({"v":1,"id":"new-document","op":"observe","event":event}));
    assert_eq!(
        sensor.response("new-document")["data"]["changed"],
        true,
        "broker receive time must not turn a later source document into stale evidence"
    );
    let before = sensor.snapshot();
    for timestamp in [
        json!(source + 100),
        json!("invalid"),
        json!(now_ms() + 600_000),
    ] {
        sensor
            .send(json!({"v":1,"id":"bad-remove","op":"remove","tabId":42,"observedAt":timestamp}));
        let response = sensor.response("bad-remove");
        if timestamp.is_string() || timestamp.as_u64().unwrap() > now_ms() + 300_000 {
            assert_eq!(response["error"]["code"], "invalid_request");
        } else {
            assert_eq!(response["data"]["changed"], false);
        }
    }
    let after = sensor.snapshot();
    assert_eq!(after["revision"], before["revision"]);
    assert_eq!(after["sessions"], before["sessions"]);
    assert_eq!(after["incidents"], before["incidents"]);
}

#[test]
fn closure_write_failure_rolls_back_visible_and_private_state_and_exact_retry_needs_no_write() {
    let runtime = Runtime::new();
    let mut sensor = Sensor::new(&runtime);
    sensor.hello("chrome");
    sensor.observe("error");
    let before = sensor.snapshot();
    let state_path = runtime.directory.join("state.json");
    let saved_path = runtime.directory.join("saved-state.json");
    fs::rename(&state_path, &saved_path).unwrap();
    fs::create_dir(&state_path).unwrap();
    sensor.send(json!({"v":1,"id":"failed-remove","op":"remove","tabId":42}));
    assert_eq!(
        sensor.response("failed-remove")["error"]["code"],
        "persistence_failed"
    );
    let event = json!({"tabId":43,"documentId":"unseen","status":"closed","observedAt":now_ms()});
    sensor.send(json!({"v":1,"id":"failed-unseen","op":"observe","event":event}));
    assert_eq!(
        sensor.response("failed-unseen")["error"]["code"],
        "persistence_failed"
    );
    let after = sensor.snapshot();
    assert_eq!(after["revision"], before["revision"]);
    assert_eq!(after["sessions"], before["sessions"]);
    assert_eq!(after["incidents"], before["incidents"]);
    fs::remove_dir(&state_path).unwrap();
    fs::rename(&saved_path, &state_path).unwrap();
    sensor.send(json!({"v":1,"id":"retry-unseen","op":"observe","event":event}));
    assert_eq!(sensor.response("retry-unseen")["ok"], true);
    let saved: Value =
        serde_json::from_slice(&platform::read_private(&state_path, 1_000_000).unwrap()).unwrap();
    assert_eq!(saved["closureFences"].as_array().unwrap().len(), 1);
    assert_eq!(
        saved["closureFences"][0]["tabId"], 43,
        "failed removal left no private fence"
    );
    fs::rename(&state_path, &saved_path).unwrap();
    fs::create_dir(&state_path).unwrap();
    sensor.send(json!({"v":1,"id":"exact-close","op":"observe","event":event}));
    let response = sensor.response("exact-close");
    assert_eq!(
        response["ok"], true,
        "an exact durable closure retry must be read-only"
    );
    assert_eq!(response["data"]["changed"], false);
    fs::remove_dir(&state_path).unwrap();
    fs::rename(&saved_path, &state_path).unwrap();
}

#[test]
fn closure_growth_obeys_existing_storage_limit_without_evicting_history_or_forgetting_fences() {
    let runtime = Runtime::new();
    platform::secure_directory(&runtime.directory).unwrap();
    let now = now_ms();
    let mut store = constellation_monitor::state::Store::default();
    let client = store
        .hello(
            &json!({"browser":"chrome","profileId":"work","instanceId":"session"}),
            now,
        )
        .unwrap();
    let mut seed = store.snapshot();
    seed["closureFences"] = json!([]);
    let mut bytes = serde_json::to_vec(&seed).unwrap().len();
    let mut fences = Vec::new();
    for tab in 0..10_000 {
        let fence = json!({"clientId":client,"tabId":tab,"observedAt":now,
            "contexts":[{"documentId":null,"runId":null,"url":null}]});
        let additional =
            serde_json::to_vec(&fence).unwrap().len() + usize::from(!fences.is_empty());
        if bytes + additional > constellation_monitor::wire::MAX_FRAME - 300 {
            break;
        }
        bytes += additional;
        fences.push(fence);
    }
    let retained = fences.len();
    seed["closureFences"] = json!(fences);
    let seed = serde_json::to_vec(&seed).unwrap();
    assert_eq!(seed.len(), bytes);
    assert!(
        retained > 1000,
        "exercise private metadata beyond the public history capacity"
    );
    let state_path = runtime.directory.join("state.json");
    platform::atomic_write(&state_path, &seed).unwrap();
    let mut sensor = Sensor::new(&runtime);
    sensor.hello("chrome");
    let before = sensor.snapshot();
    let before_bytes = platform::read_private(&state_path, 1_000_000).unwrap();
    let event = json!({"tabId":20_000,"status":"closed","documentId":"d".repeat(80),
        "runId":"r".repeat(80),"url":format!("https://chatgpt.com/{}", "x".repeat(384 - "https://chatgpt.com/".len())),"observedAt":now});
    sensor.send(json!({"v":1,"id":"full","op":"observe","event":event}));
    let response = sensor.response("full");
    assert_eq!(
        response["error"]["code"], "persistence_failed",
        "{response}"
    );
    let after = sensor.snapshot();
    assert_eq!(after["revision"], before["revision"]);
    assert_eq!(after["sessions"], before["sessions"]);
    assert_eq!(after["incidents"], before["incidents"]);
    assert_eq!(after["limits"], before["limits"]);
    assert_eq!(after["health"]["persistence"], "error");
    assert_eq!(
        platform::read_private(&state_path, 1_000_000).unwrap(),
        before_bytes
    );
    // A smaller legitimate record still fits. If failed growth survived in
    // memory, this retry would either keep its context or fail the same bound.
    sensor.send(json!({"v":1,"id":"small","op":"observe","event":{
        "tabId":20_000,"status":"closed","observedAt":now}}));
    assert_eq!(sensor.response("small")["ok"], true);
    let saved: Value =
        serde_json::from_slice(&platform::read_private(&state_path, 1_000_000).unwrap()).unwrap();
    assert_eq!(
        saved["closureFences"].as_array().unwrap().len(),
        retained + 1
    );
    let newest = saved["closureFences"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["tabId"] == 20_000)
        .unwrap();
    assert_eq!(
        newest["contexts"],
        json!([{"documentId":null,"runId":null,"url":null}])
    );
    assert_eq!(sensor.snapshot()["health"]["persistence"], "ok");
}

#[test]
fn follower_alert_settings_merge_broadcast_and_survive_broker_restart() {
    let runtime = Runtime::new();
    let mut chrome = Sensor::new(&runtime);
    let mute_until = now_ms() + 300_000;
    chrome.send(json!({"v":1,"id":"first-hello","op":"hello",
        "client":{"browser":"chrome","profileId":"work","instanceId":"session"},
        "alertSettings":{"muteUntil":mute_until,"volume":0.25,"audioEnabled":false}}));
    let initialized = chrome.response("first-hello");
    assert_eq!(initialized["ok"], true);
    assert_eq!(
        initialized["data"]["alertSettings"]["muteUntil"],
        mute_until
    );
    let mut firefox = Sensor::new(&runtime);
    firefox.send(json!({"v":1,"id":"follower-hello","op":"hello",
        "client":{"browser":"firefox","profileId":"work","instanceId":"session"},
        "alertSettings":{"muteUntil":0,"audioEnabled":true}}));
    assert_eq!(
        firefox.response("follower-hello")["data"]["alertSettings"]["muteUntil"],
        mute_until
    );
    firefox.send(
        json!({"v":1,"id":"follower-policy","op":"alert_settings","settings":{"volume":0.8}}),
    );
    let updated = firefox.response("follower-policy");
    assert_eq!(updated["ok"], true);
    let pushed = chrome.wait_for(|message| {
        message.get("id").is_none() && message["data"]["alertSettings"]["volume"] == 0.8
    });
    let policy = pushed["data"]["alertSettings"].clone();
    assert_eq!(policy["muteUntil"], mute_until);
    assert_eq!(policy["audioEnabled"], false);
    firefox.send(
        json!({"v":1,"id":"bad-policy","op":"alert_settings","settings":{"arbitraryField":true}}),
    );
    assert_eq!(firefox.response("bad-policy")["ok"], false);
    assert_eq!(chrome.snapshot()["alertSettings"], policy);
    broker::admin_request(&runtime.directory, "shutdown").unwrap();
    let mut restarted = Sensor::new(&runtime);
    assert_eq!(restarted.hello("chrome")["data"]["alertSettings"], policy);
}

#[test]
fn simultaneous_policy_initializers_keep_one_complete_winner() {
    let runtime = Runtime::new();
    let mut chrome = Sensor::new(&runtime);
    let mut firefox = Sensor::new(&runtime);
    chrome.hello("chrome");
    firefox.hello("firefox");
    // Send both requests before waiting, through separate live host processes.
    chrome.send(json!({"v":1,"id":"initialize-a","op":"alert_settings","initializeOnly":true,"settings":{"enabled":false,"volume":0.2}}));
    firefox.send(json!({"v":1,"id":"initialize-b","op":"alert_settings","initializeOnly":true,"settings":{"enabled":true,"volume":0.8}}));
    let a = chrome.response("initialize-a");
    let b = firefox.response("initialize-b");
    assert_eq!(a["ok"], true);
    assert_eq!(b["ok"], true);
    assert_eq!(a["data"]["alertSettings"], b["data"]["alertSettings"]);
    let policy = &a["data"]["alertSettings"];
    assert!(
        (policy["enabled"] == false && policy["volume"] == 0.2)
            || (policy["enabled"] == true && policy["volume"] == 0.8),
        "initializers produced a mixed policy: {policy}"
    );
    assert_eq!(chrome.snapshot()["alertSettings"], *policy);
}

#[test]
fn final_browser_pipe_close_stops_hub_but_other_browsers_keep_it_alive() {
    let runtime = Runtime::new();
    let mut chrome = Sensor::new(&runtime);
    chrome.hello("chrome");
    let mut firefox = Sensor::new(&runtime);
    firefox.hello("firefox");
    chrome.observe("permission_required");
    let pid = runtime.endpoint()["pid"].clone();
    assert_eq!(
        firefox.snapshot()["health"]["lifecycle"]["connectedNativeHosts"],
        2
    );
    chrome.close_pipe();
    thread::sleep(Duration::from_millis(runtime.idle_grace_ms + 100));
    assert_eq!(runtime.endpoint()["pid"], pid);
    let remaining = firefox.snapshot();
    assert_eq!(remaining["health"]["connectedBrowsers"], 1);
    assert_eq!(remaining["health"]["lifecycle"]["connectedNativeHosts"], 1);
    assert_eq!(remaining["sessions"][0]["connected"], false);
    assert!(remaining["incidents"][0]["resolvedAt"].is_null());
    firefox.close_pipe();
    runtime.wait_stopped();
    let saved: Value = serde_json::from_slice(
        &platform::read_private(&runtime.directory.join("state.json"), 1_000_000).unwrap(),
    )
    .unwrap();
    assert!(
        saved["clients"]
            .as_array()
            .unwrap()
            .iter()
            .all(|client| client["connected"] == false)
    );
}

#[test]
fn reconnect_in_grace_cancels_the_old_deadline_without_a_new_broker() {
    let runtime = Runtime::new();
    let mut first = Sensor::new(&runtime);
    first.hello("chrome");
    let pid = runtime.endpoint()["pid"].clone();
    first.close_pipe();
    let idle = broker::admin_request(&runtime.directory, "snapshot").unwrap();
    assert_eq!(idle["data"]["health"]["lifecycle"]["state"], "idle_grace");
    let mut reconnected = Sensor::new(&runtime);
    reconnected.hello("chrome");
    thread::sleep(Duration::from_millis(runtime.idle_grace_ms + 100));
    assert_eq!(runtime.endpoint()["pid"], pid);
    let alive = reconnected.snapshot();
    assert_eq!(alive["health"]["connectedBrowsers"], 1);
    assert_eq!(alive["health"]["lifecycle"]["state"], "connected");
    assert_eq!(alive["clients"][0]["connected"], true);
    reconnected.close_pipe();
    runtime.wait_stopped();
}

#[test]
fn native_call_after_idle_exit_restarts_with_durable_incidents_and_policy() {
    let runtime = Runtime::new();
    let mut sensor = Sensor::new(&runtime);
    sensor.hello("edge");
    sensor.observe("error");
    sensor.send(json!({"v":1,"id":"mute","op":"alert_settings","settings":{"muteUntil":now_ms()+300000,"volume":0.2}}));
    let policy = sensor.response("mute")["data"]["alertSettings"].clone();
    let old_pid = runtime.endpoint()["pid"].clone();
    sensor.close_pipe();
    runtime.wait_stopped();
    let mut reopened = Sensor::new(&runtime);
    let hello = reopened.hello("edge");
    assert_ne!(runtime.endpoint()["pid"], old_pid);
    assert_eq!(hello["data"]["alertSettings"], policy);
    let restored = reopened.snapshot();
    assert_eq!(restored["sessions"][0]["connected"], false);
    assert_eq!(restored["incidents"][0]["kind"], "error");
    assert!(restored["incidents"][0]["resolvedAt"].is_null());
    reopened.observe("error");
    assert_eq!(
        reopened.snapshot()["incidents"].as_array().unwrap().len(),
        1
    );
}

#[test]
fn simultaneous_native_starts_elect_one_hub_and_reference_count_all_browsers() {
    let runtime = Runtime::new();
    let barrier = Arc::new(Barrier::new(4));
    let mut sensors = thread::scope(|scope| {
        let tasks: Vec<_> = ["chrome", "firefox", "edge", "opera_gx"]
            .into_iter()
            .map(|browser| {
                let barrier = barrier.clone();
                let runtime = &runtime;
                scope.spawn(move || {
                    barrier.wait();
                    let mut sensor = Sensor::new(runtime);
                    sensor.hello(browser);
                    sensor
                })
            })
            .collect();
        tasks
            .into_iter()
            .map(|task| task.join().unwrap())
            .collect::<Vec<_>>()
    });
    let pid = runtime.endpoint()["pid"].clone();
    let snapshot = sensors[0].snapshot();
    assert_eq!(snapshot["health"]["connectedBrowsers"], 4);
    assert_eq!(snapshot["health"]["lifecycle"]["connectedNativeHosts"], 4);
    for sensor in sensors.iter_mut().take(3) {
        sensor.close_pipe();
    }
    assert_eq!(sensors[3].snapshot()["health"]["connectedBrowsers"], 1);
    assert_eq!(runtime.endpoint()["pid"], pid);
    sensors[3].close_pipe();
    runtime.wait_stopped();
}

#[test]
fn restart_waits_for_a_previous_broker_lock_instead_of_losing_its_spawn() {
    let runtime = Runtime::new();
    platform::secure_directory(&runtime.directory).unwrap();
    let retiring_lock =
        platform::open_private(&runtime.directory.join("broker.lock"), false).unwrap();
    retiring_lock.try_lock().unwrap();
    // Model the exact shutdown boundary: endpoint is gone, but the previous
    // process still owns its lock while flushing and joining old readers.
    let mut sensor = Sensor::new(&runtime);
    sensor.send(json!({"v":1,"id":"hello","op":"hello","client":{"browser":"chrome","profileId":"work","instanceId":"session"}}));
    assert!(
        sensor
            .output
            .recv_timeout(Duration::from_millis(200))
            .is_err()
    );
    drop(retiring_lock);
    assert_eq!(sensor.response("hello")["ok"], true);
    assert_eq!(
        sensor.snapshot()["health"]["lifecycle"]["connectedNativeHosts"],
        1
    );
}

#[test]
fn diagnostics_and_unauthenticated_sockets_do_not_extend_idle_grace() {
    let runtime = Runtime::new();
    let mut sensor = Sensor::new(&runtime);
    sensor.hello("chrome");
    let port = runtime.endpoint()["port"].as_u64().unwrap() as u16;
    let mut stalled_authentication = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
    stalled_authentication
        .set_read_timeout(Some(Duration::from_secs(3)))
        .unwrap();
    let mut diagnostic = broker::connect(&runtime.directory, true).unwrap();
    diagnostic
        .set_read_timeout(Some(Duration::from_secs(3)))
        .unwrap();
    sensor.close_pipe();
    runtime.wait_stopped();
    assert!(matches!(
        read_frame(&mut stalled_authentication),
        Ok(None) | Err(_)
    ));
    assert!(matches!(read_frame(&mut diagnostic), Ok(None) | Err(_)));
}
