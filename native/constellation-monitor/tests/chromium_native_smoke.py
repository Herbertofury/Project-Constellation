"""Exercise Chromium's actual native-messaging transport in two isolated profiles.

Requires a full Chromium executable, Python Playwright, and a built Linux native
companion. A minimal test extension declares nativeMessaging permission; no real
profile, chat, permission prompt, or system browser registration is touched.
"""

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

from playwright.sync_api import sync_playwright


HOST = "com.project_constellation.monitor"
WORKER = r"""
let port, sequence = 0;
const pending = new Map(), waiters = new Set();
globalThis.snapshots = [];
globalThis.focusMessages = [];
globalThis.disconnected = '';
function notify() { for (const check of [...waiters]) check(); }
globalThis.until = predicate => new Promise((resolve, reject) => {
  let timer;
  const check = () => {
    if (globalThis.disconnected) {
      clearTimeout(timer); waiters.delete(check);
      reject(new Error(globalThis.disconnected));
    } else if (predicate()) {
      clearTimeout(timer); waiters.delete(check); resolve(true);
    }
  };
  timer = setTimeout(() => { waiters.delete(check); reject(new Error('Native event timeout')); }, 8000);
  waiters.add(check); check();
});
globalThis.rpc = (op, fields = {}) => new Promise((resolve, reject) => {
  const id = String(++sequence);
  const timer = setTimeout(() => { pending.delete(id); reject(new Error('Native reply timeout: ' + op)); }, 8000);
  pending.set(id, {resolve, reject, timer});
  port.postMessage({v:1, id, op, ...fields});
});
globalThis.connect = client => {
  port = chrome.runtime.connectNative('com.project_constellation.monitor');
  port.onMessage.addListener(message => {
    if (message.kind === 'snapshot') globalThis.snapshots.push(message);
    if (message.kind === 'focus') globalThis.focusMessages.push(message.data);
    const entry = pending.get(message.id);
    if (entry) {
      clearTimeout(entry.timer); pending.delete(message.id);
      message.ok === false ? entry.reject(new Error(message.error.message)) : entry.resolve(message.data);
    }
    notify();
  });
  port.onDisconnect.addListener(() => {
    globalThis.disconnected = chrome.runtime.lastError?.message || 'Native port disconnected';
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error(globalThis.disconnected)); }
    pending.clear(); notify();
  });
  return globalThis.rpc('hello', {client});
};
"""


def run(chromium: Path, native_binary: Path) -> dict:
    if sys.platform != "linux":
        raise RuntimeError("This isolated registration fixture currently supports Linux only.")
    for path in (chromium, native_binary):
        if not path.is_file():
            raise RuntimeError(f"Required executable not found: {path}")

    version = subprocess.check_output([str(chromium), "--version"], text=True).strip()
    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix="constellation-native-browser-") as temporary:
        root = Path(temporary)
        executable = root / "app" / "constellation-monitor"
        executable.parent.mkdir()
        shutil.copy2(native_binary, executable)
        executable.chmod(0o700)
        state = root / "state"
        extension = root / "extension"
        extension.mkdir()
        (extension / "manifest.json").write_text(json.dumps({
            "manifest_version": 3,
            "name": "Constellation native transport test fixture",
            "version": "0.0.1",
            "permissions": ["nativeMessaging"],
            "background": {"service_worker": "worker.js"},
        }))
        (extension / "worker.js").write_text(WORKER)
        contexts = []

        def environment(name: str) -> dict:
            # These child-only paths isolate native-host lookup and browser data.
            # HOME remains untouched. The Rust portable data path is shared.
            env = dict(os.environ)
            env["XDG_CONFIG_HOME"] = str(root / name)
            env["CHROME_CONFIG_HOME"] = str(root / name)
            env["XDG_CACHE_HOME"] = str(root / name / "cache")
            env.pop("CHROME_USER_DATA_DIR", None)
            env.pop("CONSTELLATION_DATA_DIR", None)
            return env

        def register(name: str, extension_id: str) -> None:
            completed = subprocess.run([
                str(executable), "install", "--browser", "chromium",
                "--chromium-id", extension_id, "--data-dir", str(state),
            ], env=environment(name), text=True, capture_output=True, timeout=15, check=True)
            registered = json.loads(completed.stdout)
            paths = registered["registrations"][0]["manifestPaths"]
            assert all(Path(path).is_relative_to(root) for path in paths)
            assert all(Path(path).is_file() for path in paths)

        with sync_playwright() as playwright:
            def launch(name: str, extension_path: Path = extension):
                context = playwright.chromium.launch_persistent_context(
                    str(root / name / "chromium"), executable_path=str(chromium),
                    headless=True, env=environment(name),
                    ignore_default_args=["--disable-extensions"],
                    args=[
                        "--no-sandbox", "--disable-background-networking",
                        "--disable-component-update", "--no-first-run",
                        f"--disable-extensions-except={extension_path}",
                        f"--load-extension={extension_path}",
                    ],
                )
                contexts.append(context)
                worker = context.service_workers[0] if context.service_workers else context.wait_for_event("serviceworker", timeout=8000)
                assert worker.url.startswith("chrome-extension://"), worker.url
                return context, worker

            def request(worker, op: str, fields: dict | None = None):
                return worker.evaluate("args => globalThis.rpc(args[0], args[1])", [op, fields or {}])

            try:
                context_a, worker_a = launch("profile-a")
                extension_id = worker_a.url.split("/")[2]
                register("profile-a", extension_id)
                hello_a = worker_a.evaluate("client => globalThis.connect(client)", {
                    "browser": "chromium", "profileId": "fixture-a",
                    "instanceId": "run-a", "label": "Test profile A",
                })
                client_a = hello_a["clientId"]

                register("profile-b", extension_id)
                _, worker_b = launch("profile-b")
                assert worker_b.url.split("/")[2] == extension_id
                hello_b = worker_b.evaluate("client => globalThis.connect(client)", {
                    "browser": "chromium", "profileId": "fixture-b",
                    "instanceId": "run-b", "label": "Test profile B",
                })
                client_b = hello_b["clientId"]
                assert client_a != client_b
                assert len([client for client in hello_b["clients"] if client["connected"]]) == 2

                for worker, label, status in ((worker_a, "a", "permission_required"), (worker_b, "b", "error")):
                    request(worker, "observe", {"event": {
                        "tabId": 7, "documentId": "document-" + label, "runId": "run-" + label,
                        "url": "https://chatgpt.com/c/native-fixture-" + label,
                        "title": "Native fixture " + label, "status": status,
                        "reason": "Synthetic transport test", "observedAt": int(time.time() * 1000),
                    }})
                worker_a.evaluate("() => globalThis.until(() => globalThis.snapshots.some(message => !message.id && message.data.sessions.length === 2))")
                snapshot = request(worker_b, "snapshot")
                assert len(snapshot["sessions"]) == 2
                assert len(snapshot["incidents"]) == 2
                assert {row["tabId"] for row in snapshot["sessions"]} == {7}
                assert len({row["sessionId"] for row in snapshot["sessions"]}) == 2
                incident_a = next(row for row in snapshot["incidents"] if row["clientId"] == client_a)
                session_a = next(row for row in snapshot["sessions"] if row["clientId"] == client_a)

                request(worker_b, "ack", {"incidentId": incident_a["incidentId"]})
                worker_a.evaluate("id => globalThis.until(() => globalThis.snapshots.at(-1).data.incidents.some(row => row.incidentId === id && row.acknowledgedAt))", incident_a["incidentId"])
                request(worker_b, "snooze", {"incidentId": incident_a["incidentId"], "durationMs": 60000})
                worker_a.evaluate("id => globalThis.until(() => globalThis.snapshots.at(-1).data.incidents.some(row => row.incidentId === id && !row.acknowledgedAt && row.snoozedUntil > Date.now()))", incident_a["incidentId"])
                saved_snooze = next(row for row in json.loads((state / "state.json").read_text())["incidents"] if row["incidentId"] == incident_a["incidentId"])
                assert not saved_snooze["acknowledgedAt"] and saved_snooze["snoozedUntil"] > time.time() * 1000
                request(worker_b, "focus", {"sessionId": session_a["sessionId"]})
                worker_a.evaluate("id => globalThis.until(() => globalThis.focusMessages.some(row => row.sessionId === id))", session_a["sessionId"])
                focus = worker_a.evaluate("globalThis.focusMessages.at(-1)")
                assert focus["documentId"] == "document-a" and focus["tabId"] == 7
                assert worker_b.evaluate("globalThis.focusMessages.length") == 0

                request(worker_a, "remove", {"tabId": 7})
                worker_b.evaluate("id => globalThis.until(() => !globalThis.snapshots.at(-1).data.sessions.some(row => row.clientId === id))", client_a)
                context_a.close()
                contexts.remove(context_a)
                worker_b.evaluate("id => globalThis.until(() => globalThis.snapshots.at(-1).data.clients.some(row => row.clientId === id && !row.connected))", client_a)
                remaining = request(worker_b, "snapshot")
                assert next(row for row in remaining["clients"] if row["clientId"] == client_b)["connected"]
                assert len(remaining["sessions"]) == 1

                # A different fixture extension has no entry in the native host's
                # allowlist. Chromium must reject it before the Rust handshake.
                denied_extension = root / "denied-extension"
                shutil.copytree(extension, denied_extension)
                register("profile-denied", extension_id)
                _, denied_worker = launch("profile-denied", denied_extension)
                assert denied_worker.url.split("/")[2] != extension_id
                denied = denied_worker.evaluate("async () => { try { await globalThis.connect({browser:'chromium',profileId:'denied',instanceId:'denied'}); return ''; } catch (error) { return error.message; } }")
                assert "forbidden" in denied.lower(), denied
                persisted = json.loads((state / "state.json").read_text())
                assert any(row["incidentId"] == incident_a["incidentId"] and row["resolvedAt"] for row in persisted["incidents"])

                report = {
                    "passed": True, "browser": version, "extensionRuntime": "installed MV3 service worker",
                    "transport": "real chrome.runtime.connectNative", "profilesConnected": 2,
                    "sameTabIdsIsolated": True, "unsolicitedCrossProfileSnapshots": True,
                    "acknowledgementAndSnoozePersisted": True, "focusRoutedOnlyToOwner": True,
                    "removedTabReconciled": True, "browserDisconnectObserved": True,
                    "unlistedExtensionRejectedByBrowser": True,
                    "permissionClicks": 0, "realUserProfilesTouched": 0,
                    "elapsedSeconds": round(time.monotonic() - started, 3),
                    "limits": "Linux Chromium test fixture; does not prove Windows, Firefox, Edge, Opera GX, production permission prompts, or audible playback.",
                }
            finally:
                for context in reversed(contexts):
                    context.close()
                subprocess.run([str(executable), "stop", "--data-dir", str(state)], capture_output=True, timeout=10)
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--chromium", default=os.environ.get("PROJECT_CONSTELLATION_CHROMIUM"), required=not os.environ.get("PROJECT_CONSTELLATION_CHROMIUM"))
    parser.add_argument("--native-binary", default=str(Path(__file__).resolve().parents[1] / "target/release/constellation-monitor"))
    parser.add_argument("--report", type=Path)
    arguments = parser.parse_args()
    exit_code = 0
    try:
        result = run(Path(arguments.chromium).resolve(), Path(arguments.native_binary).resolve())
    except Exception as error:
        detail = str(error)
        blocked = "process_singleton_posix.cc" in detail and "socket() failed: Operation not permitted" in detail
        result = {
            "passed": False, "status": "blocked" if blocked else "failed",
            "nativeMessagingTestExecuted": False if blocked else None,
            "reason": "The execution environment denies Chromium's required process-singleton socket before extension startup." if blocked else type(error).__name__,
            "evidence": next((line.strip() for line in detail.splitlines() if "socket() failed" in line), detail[:1600]),
        }
        exit_code = 2 if blocked else 1
    rendered = json.dumps(result, indent=2) + "\n"
    if arguments.report:
        arguments.report.parent.mkdir(parents=True, exist_ok=True)
        arguments.report.write_text(rendered)
    print(rendered, end="")
    raise SystemExit(exit_code)
