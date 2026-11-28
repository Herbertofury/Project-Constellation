#!/usr/bin/env python3
"""Run the real Windows setup/owner/hub against a disposable runner account.

This deliberately exercises the same fixed current-user registrations as the
product. It refuses non-Windows and non-hosted CI by default, snapshots those
slots and the Start Menu shortcut, and verifies their restoration. It never
loads a browser extension, grants a Computer Tools permission, clicks a browser
prompt, or uses the user's mouse/keyboard. GUI assertions address only windows
belonging to the executable processes started by this test.
"""
from __future__ import annotations

import argparse
import ctypes
from ctypes import wintypes as w
import hashlib
import json
import os
from pathlib import Path
import queue
import shutil
import struct
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import zlib

ROOT = Path(__file__).resolve().parents[1]
HOST = "com.project_constellation.monitor"
HOST_KEYS = [rf"Software\{browser}\NativeMessagingHosts\{HOST}" for browser in (
    "Google\\Chrome", "Microsoft\\Edge", "Mozilla", "Chromium")]
APPS_KEY = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\ProjectConstellation"
APPS_VALUES = ["DisplayName", "DisplayVersion", "Publisher", "InstallLocation", "DisplayIcon",
               "UninstallString", "QuietUninstallString", "NoModify", "NoRepair", "EstimatedSize"]
SLOTS = [(key, "") for key in HOST_KEYS] + [(APPS_KEY, name) for name in APPS_VALUES]
CREATE_NO_WINDOW = 0x08000000


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def wait_for(description, predicate, timeout=15):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        result = predicate()
        if result:
            return result
        time.sleep(0.05)
    raise TimeoutError(f"Timed out waiting for {description}")


class Windows:
    """Narrow native window control and capture, with pointer-width-safe types."""
    def __init__(self):
        self.user = ctypes.WinDLL("user32", use_last_error=True)
        self.gdi = ctypes.WinDLL("gdi32", use_last_error=True)
        self.kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        self.callback = ctypes.WINFUNCTYPE(w.BOOL, w.HWND, w.LPARAM)
        definitions = [
            (self.user, "EnumWindows", [self.callback, w.LPARAM], w.BOOL),
            (self.user, "GetClassNameW", [w.HWND, w.LPWSTR, ctypes.c_int], ctypes.c_int),
            (self.user, "GetWindowThreadProcessId", [w.HWND, ctypes.POINTER(w.DWORD)], w.DWORD),
            (self.user, "IsWindowVisible", [w.HWND], w.BOOL),
            (self.user, "GetWindowTextW", [w.HWND, w.LPWSTR, ctypes.c_int], ctypes.c_int),
            (self.user, "GetDlgItem", [w.HWND, ctypes.c_int], w.HWND),
            (self.user, "IsWindowEnabled", [w.HWND], w.BOOL),
            (self.user, "SendMessageTimeoutW", [w.HWND, w.UINT, w.WPARAM, w.LPARAM,
                w.UINT, w.UINT, ctypes.POINTER(ctypes.c_size_t)], ctypes.c_ssize_t),
            (self.user, "PostMessageW", [w.HWND, w.UINT, w.WPARAM, w.LPARAM], w.BOOL),
            (self.user, "GetWindowRect", [w.HWND, ctypes.POINTER(w.RECT)], w.BOOL),
            (self.user, "GetWindowDC", [w.HWND], w.HDC),
            (self.user, "ReleaseDC", [w.HWND, w.HDC], ctypes.c_int),
            (self.user, "PrintWindow", [w.HWND, w.HDC, w.UINT], w.BOOL),
            (self.gdi, "CreateCompatibleDC", [w.HDC], w.HDC),
            (self.gdi, "CreateCompatibleBitmap", [w.HDC, ctypes.c_int, ctypes.c_int], w.HBITMAP),
            (self.gdi, "SelectObject", [w.HDC, w.HGDIOBJ], w.HGDIOBJ),
            (self.gdi, "DeleteObject", [w.HGDIOBJ], w.BOOL),
            (self.gdi, "DeleteDC", [w.HDC], w.BOOL),
            (self.gdi, "GetDIBits", [w.HDC, w.HBITMAP, w.UINT, w.UINT,
                ctypes.c_void_p, ctypes.c_void_p, w.UINT], ctypes.c_int),
            (self.kernel, "OpenProcess", [w.DWORD, w.BOOL, w.DWORD], w.HANDLE),
            (self.kernel, "CloseHandle", [w.HANDLE], w.BOOL),
            (self.kernel, "WaitForSingleObject", [w.HANDLE, w.DWORD], w.DWORD),
            (self.kernel, "QueryFullProcessImageNameW", [w.HANDLE, w.DWORD,
                w.LPWSTR, ctypes.POINTER(w.DWORD)], w.BOOL),
        ]
        for library, name, arguments, result in definitions:
            method = getattr(library, name)
            method.argtypes, method.restype = arguments, result

    def windows(self, class_name, pid=None):
        found = []
        @self.callback
        def collect(hwnd, _):
            identifier = w.DWORD()
            self.user.GetWindowThreadProcessId(hwnd, ctypes.byref(identifier))
            name = ctypes.create_unicode_buffer(256)
            self.user.GetClassNameW(hwnd, name, len(name))
            if name.value == class_name and self.user.IsWindowVisible(hwnd) and (pid is None or pid == identifier.value):
                found.append((hwnd, identifier.value))
            return True
        require(bool(self.user.EnumWindows(collect, 0)), "Could not enumerate native windows")
        return found

    def title(self, hwnd):
        buffer = ctypes.create_unicode_buffer(32768)
        self.user.GetWindowTextW(hwnd, buffer, len(buffer))
        return buffer.value

    def send(self, hwnd, message, wp=0, lp=0):
        result = ctypes.c_size_t()
        require(bool(self.user.SendMessageTimeoutW(hwnd, message, wp, lp, 2, 4000, ctypes.byref(result))),
                f"Native window did not respond to message {message}")
        return result.value

    def control_text(self, hwnd, identifier):
        child = self.user.GetDlgItem(hwnd, identifier)
        require(bool(child), f"Missing native control {identifier}")
        buffer = ctypes.create_unicode_buffer(65536)
        self.send(child, 0x000D, len(buffer), ctypes.addressof(buffer))  # WM_GETTEXT works across processes.
        return buffer.value

    def command(self, hwnd, identifier):
        child = self.user.GetDlgItem(hwnd, identifier)
        require(bool(child) and bool(self.user.IsWindowEnabled(child)), f"Control {identifier} is unavailable")
        require(bool(self.user.PostMessageW(hwnd, 0x0111, identifier, child)), "Could not address setup control")

    def process_handle(self, pid, expected_executable):
        handle = self.kernel.OpenProcess(0x00100000 | 0x1000, False, pid)
        require(bool(handle), f"Could not open test-owned process {pid}")
        buffer, size = ctypes.create_unicode_buffer(32768), w.DWORD(32768)
        try:
            require(bool(self.kernel.QueryFullProcessImageNameW(handle, 0, buffer, ctypes.byref(size))),
                    "Could not verify native process executable")
            require(Path(buffer.value).resolve() == expected_executable.resolve(), "Refusing an unrelated process/window")
        except BaseException:
            self.kernel.CloseHandle(handle)
            raise
        return handle

    def close_window(self, hwnd, pid, executable):
        handle = self.process_handle(pid, executable)
        try:
            require(bool(self.user.PostMessageW(hwnd, 0x0010, 0, 0)), "Could not close test-owned window")
            require(self.kernel.WaitForSingleObject(handle, 12000) == 0, "Native process stayed alive after its window closed")
        finally:
            self.kernel.CloseHandle(handle)

    def screenshot(self, hwnd, destination):
        rect = w.RECT()
        require(bool(self.user.GetWindowRect(hwnd, ctypes.byref(rect))), "Could not read native window bounds")
        width, height = rect.right - rect.left, rect.bottom - rect.top
        require(100 <= width <= 4096 and 100 <= height <= 4096, "Native window has unusable dimensions")
        source, target, bitmap, previous = self.user.GetWindowDC(hwnd), None, None, None
        try:
            require(bool(source), "Could not obtain native window device context")
            target = self.gdi.CreateCompatibleDC(source)
            bitmap = self.gdi.CreateCompatibleBitmap(source, width, height)
            require(bool(target) and bool(bitmap), "Could not create native capture surface")
            previous = self.gdi.SelectObject(target, bitmap)
            require(bool(self.user.PrintWindow(hwnd, target, 2)), "The real native window could not render into a capture")
            self.gdi.SelectObject(target, previous)
            previous = None
            header = ctypes.create_string_buffer(struct.pack("<IiiHHIIiiII", 40, width, -height, 1, 32, 0, width * height * 4, 0, 0, 0, 0))
            pixels = ctypes.create_string_buffer(width * height * 4)
            require(self.gdi.GetDIBits(target, bitmap, 0, height, pixels, header, 0) == height, "Native capture was incomplete")
            raw = pixels.raw
            require(len(set(raw[0::4])) > 3, "Native capture is blank")
            rgb = bytearray()
            for y in range(height):
                rgb.append(0)
                for x in range(width):
                    at = (y * width + x) * 4
                    rgb.extend((raw[at + 2], raw[at + 1], raw[at]))
            def chunk(kind, content):
                return struct.pack(">I", len(content)) + kind + content + struct.pack(">I", zlib.crc32(kind + content) & 0xFFFFFFFF)
            png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(rgb, 7)) + chunk(b"IEND", b"")
            destination.write_bytes(png)
            return {"file": destination.name, "width": width, "height": height, "sha256": sha(png)}
        finally:
            if previous and target:
                self.gdi.SelectObject(target, previous)
            if bitmap:
                self.gdi.DeleteObject(bitmap)
            if target:
                self.gdi.DeleteDC(target)
            if source:
                self.user.ReleaseDC(hwnd, source)


class Integrations:
    def __init__(self):
        import winreg
        self.registry = winreg
        self.before = {slot: self.read(*slot) for slot in SLOTS}
        self.shortcut = Path(os.environ["APPDATA"]) / "Microsoft/Windows/Start Menu/Programs/Project Constellation Setup.lnk"
        self.shortcut_before = self.shortcut.read_bytes() if self.shortcut.is_file() else None
        self.desktop_shortcut = self.shortcut.with_name("Project Constellation.lnk")
        self.desktop_shortcut_before = self.desktop_shortcut.read_bytes() if self.desktop_shortcut.is_file() else None

    def read(self, key, name):
        try:
            with self.registry.OpenKey(self.registry.HKEY_CURRENT_USER, key) as handle:
                return self.registry.QueryValueEx(handle, name)
        except FileNotFoundError:
            return None

    def matches(self):
        return all(self.read(*slot) == value for slot, value in self.before.items()) and all(
            (path.read_bytes() if path.is_file() else None) == before
            for path, before in ((self.shortcut, self.shortcut_before),
                                 (self.desktop_shortcut, self.desktop_shortcut_before)))

    def restore(self):
        # Emergency cleanup is limited to the exact fixed slots captured above.
        # If needed, the acceptance run stays failed even after cleanup succeeds.
        for (key, name), value in self.before.items():
            if value is None:
                try:
                    with self.registry.OpenKey(self.registry.HKEY_CURRENT_USER, key, 0, self.registry.KEY_SET_VALUE) as handle:
                        self.registry.DeleteValue(handle, name)
                except FileNotFoundError:
                    pass
            else:
                with self.registry.CreateKeyEx(self.registry.HKEY_CURRENT_USER, key, 0, self.registry.KEY_SET_VALUE) as handle:
                    self.registry.SetValueEx(handle, name, 0, value[1], value[0])
        for path, before in ((self.shortcut, self.shortcut_before),
                             (self.desktop_shortcut, self.desktop_shortcut_before)):
            if before is None:
                path.unlink(missing_ok=True)
            else:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(before)

    def check_installed(self, root, receipt):
        for key in HOST_KEYS:
            value = self.read(key, "")
            require(value is not None and value[1] == self.registry.REG_SZ, "Native host registration missing")
            path = Path(value[0])
            require(path.is_relative_to(root) and path.is_file(), "Native host registration points outside test install")
            manifest = json.loads(path.read_text(encoding="utf-8"))
            require(manifest["name"] == HOST and Path(manifest["path"]).is_relative_to(root), "Invalid registered native host")
        require(Path(self.read(APPS_KEY, "InstallLocation")[0]) == root, "Apps and Features points at another install")
        require(self.shortcut.is_file(), "Start Menu entry was not created")
        require(sha(self.shortcut.read_bytes()) == receipt["shortcut"]["installedSha256"], "Start Menu shortcut differs from installation receipt")
        require((self.desktop_shortcut.read_bytes() if self.desktop_shortcut.is_file() else None) == self.desktop_shortcut_before,
                "Setup changed the separate desktop dashboard entry")


class NativeSensor:
    def __init__(self, executable, browser):
        # Match Chrome's actual native launch shape and exercise the installed
        # sidecar config; do not bypass it with an explicit --data-dir override.
        self.process = subprocess.Popen([str(executable), "chrome-extension://geljambmkfjkhodgkpjhnmfojkpcamig/"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=CREATE_NO_WINDOW)
        self.frames = queue.Queue()
        self.stderr = bytearray()
        def reader():
            try:
                while True:
                    header = self.process.stdout.read(4)
                    if not header:
                        return
                    require(len(header) == 4, "Truncated native frame header")
                    length, = struct.unpack("<I", header)
                    require(0 < length <= 1024 * 1024, "Invalid native frame length")
                    data = self.process.stdout.read(length)
                    require(len(data) == length, "Truncated native frame")
                    self.frames.put(json.loads(data))
            except BaseException as error:
                self.frames.put(error)
        def errors():
            while block := self.process.stderr.read(4096):
                if len(self.stderr) < 65536:
                    self.stderr.extend(block)
        threading.Thread(target=reader, daemon=True).start()
        threading.Thread(target=errors, daemon=True).start()
        self.request("hello", client={"browser": browser, "profileId": "setup-acceptance",
            "instanceId": browser, "label": "Synthetic setup acceptance"})

    def request(self, operation, **arguments):
        data = json.dumps({"v": 1, "id": operation, "op": operation, **arguments}).encode()
        self.process.stdin.write(struct.pack("<I", len(data)) + data)
        self.process.stdin.flush()
        deadline = time.monotonic() + 12
        while time.monotonic() < deadline:
            frame = self.frames.get(timeout=max(0.01, deadline - time.monotonic()))
            if isinstance(frame, BaseException):
                raise frame
            if frame.get("id") == operation:
                require(frame.get("ok") is True, f"Native {operation} failed: {frame.get('error')}")
                return frame["data"]
        raise TimeoutError(f"Native {operation} did not reply")

    def close(self):
        if self.process.stdin and not self.process.stdin.closed:
            self.process.stdin.close()
        code = self.process.wait(timeout=8)
        require(code == 0, f"Native port failed on browser disconnect: {code}")

    def cleanup(self):
        if self.process.poll() is None:
            try:
                self.close()
            except BaseException:
                self.process.kill()
                self.process.wait(timeout=5)


class Acceptance:
    def __init__(self, args):
        self.args, self.checks, self.processes, self.sensors = args, [], [], []
        self.windows, self.integrations = Windows(), Integrations()
        self.directory = Path(tempfile.mkdtemp(prefix="Constellation setup acceptance ", dir=os.environ["RUNNER_TEMP"]))
        self.root = self.directory / "Install with spaces Ω"
        self.native = None
        self.owner_windows = []
        self.log = []

    def check(self, name, **details):
        self.checks.append({"name": name, "passed": True, **details})
        print(f"PASS {name}", flush=True)

    def cli(self, executable, command, expected_success=True):
        result = subprocess.run([str(executable), command, "--dir", str(self.root), "--quiet"],
            capture_output=True, text=True, encoding="utf-8", timeout=120, creationflags=CREATE_NO_WINDOW)
        self.log.append({"command": command, "executable": executable.name, "returnCode": result.returncode,
                         "stdout": result.stdout, "stderr": result.stderr})
        require((result.returncode == 0) == expected_success, f"{command} exit {result.returncode}: {result.stderr}")
        return json.loads(result.stdout)

    def receipt(self):
        value = json.loads((self.root / "constellation-install.json").read_text(encoding="utf-8"))
        require(value["schema"] == 1 and value["product"] == "project-constellation", "Invalid install receipt")
        require(Path(value["root"]) == self.root, "Install root changed")
        return value

    def run(self, final_receipt, fixture_receipt):
        require(self.cli(self.args.fixture, "install")["action"] == "installed", "Fixture initial install failed")
        fixture = self.receipt()
        require(fixture["payloadSha256"] == fixture_receipt["payloadSha256"], "Wrong rollback fixture installed")
        require(self.cli(self.args.setup, "install")["ok"] is True, "Final upgrade failed")
        final = self.receipt()
        require(final["payloadSha256"] == final_receipt["payloadSha256"] and len(final["releases"]) == 2,
                "Final upgrade did not retain its prior payload")
        require(self.cli(self.args.setup, "verify")["ok"] is True, "Installed bytes differ from embedded payload")
        self.integrations.check_installed(self.root, final)
        self.check("install", retainedReleases=len(final["releases"]), nativeRegistrations=4)
        preserved = self.root / "data/acceptance-preserve.txt"
        preserved.write_bytes(b"Synthetic user data must survive repair, rollback and uninstall.\n")
        manifest = self.root / "browsers/chromium/manifest.json"
        original_manifest = manifest.read_bytes()
        manifest.write_bytes(original_manifest + b"\nDeliberate acceptance corruption\n")
        require(self.cli(self.args.setup, "verify", False)["ok"] is False, "Corruption was hidden")
        require(self.cli(self.args.setup, "doctor", False)["ok"] is False, "Doctor concealed damaged browser files")
        require(self.cli(self.args.setup, "install")["action"] == "repaired", "Repair was not recognized")
        repaired = self.receipt()
        require(repaired["active"] == final["active"] and len(repaired["releases"]) == 2, "Repair duplicated release history")
        require(manifest.read_bytes() == original_manifest, "Repair did not restore browser bytes")
        self.check("repair", detectedCorruption=True, preservedReleaseHistory=True)
        registry = self.integrations.registry
        with registry.OpenKey(registry.HKEY_CURRENT_USER, HOST_KEYS[0], 0, registry.KEY_SET_VALUE) as handle:
            registry.DeleteValue(handle, "")
        require(self.cli(self.args.setup, "doctor", False)["ok"] is False, "Doctor concealed missing native registration")
        self.cli(self.args.setup, "install")
        require(self.cli(self.args.setup, "doctor")["ok"] is True, "Repair did not restore diagnostics")
        self.check("diagnostics", missingRegistrationDetected=True, damagedBytesDetected=True)
        require(self.cli(self.args.setup, "rollback")["action"] == "rolled_back", "Rollback did not complete")
        rolled_back = self.receipt()
        require(rolled_back["payloadSha256"] == fixture_receipt["payloadSha256"], "Rollback selected the wrong payload")
        require((self.root / rolled_back["active"] / "docs/ACCEPTANCE-FIXTURE.txt").is_file(), "Rollback fixture marker missing")
        require(self.cli(self.args.setup, "verify")["ok"] is True, "Rolled-back bytes failed verification")
        self.check("rollback", fixtureFromSameSource=True, earlierPayloadRestored=True)
        self.cli(self.args.setup, "install")
        final = self.receipt()
        require(final["payloadSha256"] == final_receipt["payloadSha256"], "Final payload was not restored after rollback")
        self.gui(final)
        self.native = self.root / final["active"] / "runtime/constellation-monitor.exe"
        self.hub()
        state = self.root / "data/monitor/state.json"
        good_state = state.read_bytes()
        try:
            state.write_bytes(b"invalid saved state acceptance probe")
            require(self.cli(self.args.setup, "doctor", False)["ok"] is False, "Doctor concealed invalid saved hub state")
        finally:
            state.write_bytes(good_state)
        require(self.cli(self.args.setup, "doctor")["ok"] is True, "Healthy stopped hub was misreported as broken")
        self.check("idle-and-corrupt-state-diagnostics", idleIsHealthy=True, invalidStateIsFailure=True)
        installed_setup = self.root / final["active"] / "Constellation-Setup.exe"
        # Exercise the real installed-manager self-uninstall helper, so Windows
        # executable locks cannot be hidden by running only an external copy.
        result = subprocess.run([str(installed_setup), "uninstall", "--dir", str(self.root), "--quiet"],
            capture_output=True, text=True, encoding="utf-8", timeout=120, creationflags=CREATE_NO_WINDOW)
        self.log.append({"command": "installed-self-uninstall", "returnCode": result.returncode,
                         "stdout": result.stdout, "stderr": result.stderr})
        require(result.returncode == 0, "Installed manager could not start its uninstall helper")
        wait_for("installed-manager uninstall completion", lambda: not (self.root / "constellation-install.json").exists(), 40)
        require(not installed_setup.exists(), "Uninstall retained the locked installed manager")
        require(not self.native.exists(), "Uninstall retained its owned runtime")
        require(not (self.root / "browsers").exists(), "Uninstall retained active managed browser files")
        require(preserved.read_bytes().startswith(b"Synthetic user data"), "Uninstall destroyed preserved data")
        require(state.read_bytes() == good_state, "Uninstall changed preserved monitor state")
        self.check("uninstall", installedManagerHelper=True, dataPreserved=True)
        require(self.integrations.matches(), "Uninstall did not restore all registry and shortcut baselines")
        self.check("integrations-restored", registrySlots=len(SLOTS), shortcutRestored=True, desktopShortcutPreserved=True)

    def gui(self, receipt):
        process = subprocess.Popen([str(self.args.setup), "manage", "--dir", str(self.root), "--quiet"],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.processes.append(process)
        hwnd, _ = wait_for("setup window", lambda: next(iter(self.windows.windows("ProjectConstellationSetup", process.pid)), None))
        labels = {101: "Install / Repair", 102: "Open installed folder", 103: "Google Chrome", 104: "Microsoft Edge",
            105: "Opera GX", 106: "Firefox", 107: "Copy Chromium folder", 108: "Copy Firefox manifest",
            109: "Computer Tools", 110: "Check installation", 111: "Roll back", 112: "Uninstall"}
        for identifier, label in labels.items():
            require(self.windows.control_text(hwnd, identifier) == label, f"Setup control {identifier} is missing its user-facing label")
        require(Path(self.windows.control_text(hwnd, 200)) == self.root, "Setup GUI chose the wrong installation")
        self.windows.command(hwnd, 101)
        wait_for("Install / Repair button completing its transaction", lambda:
            "REPAIRED — browser files and registrations restored" in self.windows.control_text(hwnd, 201), 60)
        repaired = self.receipt()
        require(repaired["active"] == receipt["active"] and len(repaired["releases"]) == len(receipt["releases"]),
                "GUI repair did not preserve the active release and history")
        require(self.cli(self.args.setup, "verify")["ok"] is True, "GUI repair left mismatched installed files")
        self.integrations.check_installed(self.root, repaired)
        self.windows.command(hwnd, 110)
        wait_for("setup diagnostics", lambda: self.windows.control_text(hwnd, 201) if
            "INSTALLATION CHECKS PASSED" in self.windows.control_text(hwnd, 201) else None, 25)
        capture = self.windows.screenshot(hwnd, self.args.output / "setup-window.png")
        self.check("setup-gui", controls=len(labels), installRepairControlWorked=True,
                   diagnosticsControlWorked=True, screenshot=capture)
        owner = self.root / receipt["active"] / "computer-link/computer-link-owner-proof.exe"
        captures = []
        for attempt in range(2):
            self.windows.command(hwnd, 109)
            owner_hwnd, owner_pid = wait_for("Computer Tools owner window", lambda: next(iter(self.windows.windows("ComputerLinkOwnerProof")), None), 20)
            self.owner_windows.append((owner_hwnd, owner_pid, owner))
            handle = self.windows.process_handle(owner_pid, owner)
            self.windows.kernel.CloseHandle(handle)
            require("disconnected" in self.windows.title(owner_hwnd).lower(), "Owner launched with an unexpected session")
            wait_for("verified owner readiness in setup", lambda: "COMPUTER TOOLS OPENED" in self.windows.control_text(hwnd, 201), 20)
            captures.append(self.windows.screenshot(owner_hwnd, self.args.output / f"computer-tools-window-{attempt + 1}.png"))
            self.windows.close_window(owner_hwnd, owner_pid, owner)
            self.owner_windows.pop()
            wait_for("owner window disappearance", lambda: not self.windows.windows("ComputerLinkOwnerProof", owner_pid))
        self.check("owner-gui", cleanCloseAndRelaunch=True, grantsCreated=False, screenshots=captures)
        self.windows.close_window(hwnd, process.pid, self.args.setup)
        require(process.wait(timeout=5) == 0, "Setup GUI failed on close")

    def hub(self):
        endpoint = self.root / "data/monitor/endpoint.json"
        require(not endpoint.exists(), "Diagnostics unexpectedly started a persistent hub")
        first = NativeSensor(self.native, "chrome")
        self.sensors.append(first)
        second = NativeSensor(self.native, "firefox")
        self.sensors.append(second)
        pid = json.loads(endpoint.read_text(encoding="utf-8"))["pid"]
        handle = self.windows.process_handle(pid, self.native)
        try:
            first.request("observe", event={"tabId": 42, "documentId": "setup-ci", "runId": "setup-ci",
                "url": "https://chatgpt.com/c/setup-acceptance", "title": "Synthetic setup acceptance",
                "status": "error", "reason": "Synthetic acceptance incident", "observedAt": int(time.time() * 1000)})
            snapshot = second.request("snapshot")
            require(snapshot["health"]["lifecycle"]["connectedNativeHosts"] == 2, "Browsers did not share one hub")
            require(any(event["kind"] == "error" for event in snapshot["incidents"]), "Cross-browser incident was lost")
            first.close()
            wait_for("other browser retaining the shared hub", lambda:
                second.request("snapshot")["health"]["lifecycle"]["connectedNativeHosts"] == 1, 4)
            second.close()
            wait_for("hub exit after last native disconnect", lambda: not endpoint.exists(), 15)
            require(self.windows.kernel.WaitForSingleObject(handle, 5000) == 0, "Hub left a background process after its endpoint closed")
        finally:
            self.windows.kernel.CloseHandle(handle)
        restarted = NativeSensor(self.native, "edge")
        self.sensors.append(restarted)
        new_pid = json.loads(endpoint.read_text(encoding="utf-8"))["pid"]
        handle = self.windows.process_handle(new_pid, self.native)
        try:
            require(restarted.request("snapshot")["incidents"], "Native relaunch lost durable incident history")
            restarted.close()
            wait_for("restarted hub idle exit", lambda: not endpoint.exists(), 15)
            require(self.windows.kernel.WaitForSingleObject(handle, 5000) == 0, "Restarted hub did not exit")
        finally:
            self.windows.kernel.CloseHandle(handle)
        self.check("native-hub-lifecycle", sourceBuiltBinary=True, installedConfigUsed=True,
                   sharedBrowserPorts=2, lastPortExit=True, demandRelaunch=True, incidentPreserved=True)

    def cleanup(self):
        errors = []
        for sensor in self.sensors:
            try:
                sensor.cleanup()
            except BaseException as error:
                errors.append(str(error))
        for hwnd, pid, owner in self.owner_windows:
            try:
                self.windows.close_window(hwnd, pid, owner)
            except BaseException as error:
                errors.append(str(error))
        for process in self.processes:
            if process.poll() is None:
                for hwnd, pid in self.windows.windows("ProjectConstellationSetup", process.pid):
                    try:
                        self.windows.close_window(hwnd, pid, self.args.setup)
                    except BaseException as error:
                        errors.append(str(error))
                if process.poll() is None:
                    process.kill()
                    process.wait(timeout=5)
        if (self.root / "constellation-install.json").exists():
            try:
                self.cli(self.args.setup, "uninstall")
            except BaseException as error:
                errors.append(str(error))
        if not self.integrations.matches():
            errors.append("Emergency restoration of captured integration slots was required")
            try:
                self.integrations.restore()
            except BaseException as error:
                errors.append(str(error))
        require(self.integrations.matches(), "Emergency cleanup could not restore disposable account integrations")
        (self.args.output / "windows-setup-acceptance-commands.json").write_text(json.dumps(self.log, indent=2) + "\n", encoding="utf-8")
        shutil.rmtree(self.directory, ignore_errors=True)
        return errors

    def capture_failure(self):
        evidence = []
        for process in self.processes:
            for hwnd, pid in self.windows.windows("ProjectConstellationSetup", process.pid):
                try:
                    item = {"pid": pid, "status": self.windows.control_text(hwnd, 201),
                            "screenshot": self.windows.screenshot(hwnd, self.args.output / "setup-window-failure.png")}
                except BaseException as error:
                    item = {"pid": pid, "captureError": str(error)}
                evidence.append(item)
        return evidence


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--setup", type=Path, required=True)
    parser.add_argument("--fixture", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=ROOT / "build/monitor-artifacts")
    parser.add_argument("--allow-disposable-user-integration", action="store_true")
    args = parser.parse_args()
    require(sys.platform == "win32", "Real Windows runtime is required; a non-Windows skip is not acceptance")
    require(args.allow_disposable_user_integration and os.environ.get("GITHUB_ACTIONS") == "true"
            and os.environ.get("RUNNER_ENVIRONMENT") == "github-hosted" and os.environ.get("RUNNER_TEMP"),
            "This writes current-user registrations. Run only on a disposable GitHub-hosted Windows account with the explicit test flag.")
    args.setup, args.fixture, args.output = args.setup.resolve(), args.fixture.resolve(), args.output.resolve()
    args.output.mkdir(parents=True, exist_ok=True)
    final = json.loads((args.setup.parent / "windows-setup-receipt.json").read_text(encoding="utf-8"))
    fixture = json.loads((args.fixture.parent / "windows-setup-receipt.json").read_text(encoding="utf-8"))
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    version = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
    for path, receipt, is_fixture in [(args.setup, final, False), (args.fixture, fixture, True)]:
        data = path.read_bytes()
        require(receipt.get("acceptanceFixture") is is_fixture, "Wrong fixture/final artifact classification")
        require(receipt["version"] == version and receipt["sourceCommit"] == commit and receipt["sourceDirty"] is False,
                "Windows acceptance requires binaries built from this exact clean source commit")
        require(receipt.get("computerLinkIncluded") is True and receipt.get("embeddedPayloadVerified") is True,
                "Acceptance requires the full verified self-contained setup payload")
        require(receipt["artifact"] == {"file": path.name, "bytes": len(data), "sha256": sha(data)}, "Executable differs from its build receipt")
    require(final["payloadSha256"] != fixture["payloadSha256"], "Rollback fixture must be a distinct payload")
    report = {"schema": 1, "version": version, "sourceCommit": commit, "platform": "win32", "passed": False,
              "acceptanceFixture": False, "artifact": final["artifact"], "checks": [],
              "limitations": ["Browser extension enabling remains a user-confirmed step.",
                  "No OAuth sign-in or real-provider round trip is performed.",
                  "The rollback fixture uses this source revision and a labeled payload marker, not an older release."]}
    acceptance = Acceptance(args)
    try:
        acceptance.run(final, fixture)
        report["passed"] = True
    except BaseException as error:
        report["error"] = f"{type(error).__name__}: {error}"
        traceback.print_exc()
        try:
            report["failureEvidence"] = acceptance.capture_failure()
        except BaseException as capture_error:
            report["failureEvidenceError"] = str(capture_error)
    finally:
        try:
            cleanup_errors = acceptance.cleanup()
            if cleanup_errors:
                report["passed"] = False
                report["cleanupErrors"] = cleanup_errors
        except BaseException as error:
            report["passed"] = False
            report["cleanupError"] = str(error)
        report["checks"] = acceptance.checks
        (args.output / "windows-setup-acceptance.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
