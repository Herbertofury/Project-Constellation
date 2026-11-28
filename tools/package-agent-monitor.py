"""Package verified monitor artifacts without modifying historical release assets."""
from pathlib import Path
import hashlib
import json
import os
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
version = json.loads((ROOT / "package.json").read_text())["version"]
output = ROOT / "build" / "monitor-artifacts"
output.mkdir(parents=True, exist_ok=True)
build_info = json.loads((ROOT / "build" / "build-info.json").read_text())
if build_info.get("version") != version or build_info.get("mode") != "production":
    raise SystemExit("Build the matching production extension before packaging the monitor.")
source_commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
source_dirty = bool(subprocess.check_output([
    "git", "status", "--porcelain", "--untracked-files=normal", "--",
    "extension", "native/constellation-monitor", "docs", "package.json",
    "tools/build.mjs", "tools/build-browser-sensors.mjs", "tools/package-agent-monitor.py",
], cwd=ROOT, text=True).strip())


def archive(source, name):
    files = sorted(p for p in source.rglob("*") if p.is_file())
    if not files:
        raise SystemExit(f"No built files found: {source}")
    target = output / name
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for item in files:
            info = zipfile.ZipInfo(item.relative_to(source).as_posix(), (2026, 11, 27, 0, 0, 0))
            info.external_attr = (0o755 if os.access(item, os.X_OK) else 0o644) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, item.read_bytes())
    return target


artifacts = [
    archive(ROOT / "build" / "unpacked", f"Constellation-{version}-Chromium.zip"),
    archive(ROOT / "build" / "firefox-sensor", f"Constellation-{version}-Firefox-Sensor.zip"),
]
native = ROOT / "native" / "constellation-monitor"
# A Linux workspace may contain a verified Windows cross-build alongside its
# native release. Package each target separately; never mix stale binaries.
candidates = [
    ("Linux", native / "target" / "release" / "constellation-monitor"),
    ("Windows", native / "target" / "release" / "constellation-monitor.exe"),
]
cross_windows = native / "target" / "x86_64-pc-windows-gnu" / "release" / "constellation-monitor.exe"
if not candidates[1][1].is_file() and cross_windows.is_file():
    candidates[1] = ("Windows", cross_windows)
built_targets = []
for platform, binary in candidates:
    if not binary.is_file():
        continue
    import shutil
    portable = ROOT / "build" / "monitor-portable" / platform.lower()
    if portable.exists():
        shutil.rmtree(portable)
    portable.mkdir(parents=True)
    shutil.copy2(binary, portable / binary.name)
    for name in ["README.md", "PROTOCOL.md"]:
        shutil.copy2(native / name, portable / name)
    shutil.copy2(ROOT / "docs" / "AGENT-MONITOR.md", portable / "AGENT-MONITOR.md")
    shutil.copy2(ROOT / "docs" / "MONITOR-VERIFICATION.md", portable / "MONITOR-VERIFICATION.md")
    (portable / "START-HERE.txt").write_text(
        f"Project Constellation Agent Monitor {version} — {platform} x64 candidate\n\n"
        "Run constellation-monitor install --help for per-user browser registration.\n"
        "Run constellation-monitor doctor to inspect registration and connected-browser prerequisites.\n"
        "The binary starts on demand through the browser's native messaging bridge.\n"
        "Read AGENT-MONITOR.md for exact setup and coverage limitations.\n"
        "Read MONITOR-VERIFICATION.md for actual checks and outstanding acceptance.\n"
        "Browser extensions are distributed separately. No consent prompt is approved automatically.\n",
        encoding="utf-8",
    )
    if platform == "Windows":
        (portable / "Install-browser-hub.cmd").write_bytes(b'@echo off\r\n"%~dp0constellation-monitor.exe" install --browser all\r\npause\r\n')
        (portable / "Check-browser-hub.cmd").write_bytes(b'@echo off\r\n"%~dp0constellation-monitor.exe" doctor\r\npause\r\n')
    artifacts.append(archive(portable, f"Constellation-{version}-{platform}-Browser-Hub.zip"))
    built_targets.append({"platform": platform, "binary": binary.name,
                          "sha256": hashlib.sha256(binary.read_bytes()).hexdigest()})
if "--require-native" in sys.argv and not built_targets:
    raise SystemExit("No native release binary found. Build the Rust companion first.")
if any(target["platform"] == "Windows" for target in built_targets):
    kit = ROOT / "build" / "monitor-windows-kit"
    if kit.exists():
        shutil.rmtree(kit)
    kit.mkdir(parents=True)
    shutil.copytree(ROOT / "build" / "unpacked", kit / "chromium-extension")
    shutil.copytree(ROOT / "build" / "firefox-sensor", kit / "firefox-sensor")
    shutil.copytree(ROOT / "build" / "monitor-portable" / "windows", kit / "browser-hub")
    (kit / "Install-browser-hub.cmd").write_bytes(b'@echo off\r\n"%~dp0browser-hub\\constellation-monitor.exe" install --browser all\r\npause\r\n')
    (kit / "Check-browser-hub.cmd").write_bytes(b'@echo off\r\n"%~dp0browser-hub\\constellation-monitor.exe" doctor\r\npause\r\n')
    (kit / "START-HERE.txt").write_text(
        f"PROJECT CONSTELLATION {version} — WINDOWS AGENT MONITOR CANDIDATE\n\n"
        "1. Extract this entire ZIP to a writable folder you intend to keep.\n"
        "2. Run Install-browser-hub.cmd. Registration is for your Windows user.\n"
        "3. In Chrome / Edge / Opera GX extension settings, enable Developer mode\n"
        "   and Load unpacked: select this kit's chromium-extension folder.\n"
        "4. Open Agent Monitor from the extension and click Connect browser hub.\n"
        "   Choose the browser permission yourself and name this profile.\n"
        "5. Repeat step 3–4 in every browser/profile you want to monitor.\n"
        "   Firefox: about:debugging > This Firefox > Load Temporary Add-on >\n"
        "   select firefox-sensor/manifest.json. Connect its Agent Monitor.\n"
        "   The Firefox sensor is unsigned and must be reloaded after restart.\n"
        "6. Open a supported chat, click Refresh, and verify browser coverage.\n"
        "   Use Test alert and confirm that you personally hear the sound.\n\n"
        "Run Check-browser-hub.cmd for registration/connection diagnostics.\n"
        "The hub starts on demand. Keep this folder; re-run registration if moved.\n"
        "Each monitored browser needs a sensor. Permission prompts require your click.\n"
        "Account backup integrations need your existing public OAuth client IDs;\n"
        "this monitoring kit does not embed those IDs. See the setup guide before\n"
        "replacing a build with working configured Google/GitHub backup.\n"
        "Read browser-hub/AGENT-MONITOR.md for details and\n"
        "browser-hub/MONITOR-VERIFICATION.md for executed checks and known gaps.\n",
        encoding="utf-8",
    )
    (kit / "BUILD-RECEIPT.json").write_text(json.dumps({
        "version": version, "source_commit": source_commit, "source_dirty": source_dirty,
        "build": build_info, "native_targets": [target for target in built_targets if target["platform"] == "Windows"], "firefox_signed": False,
        "acceptance": "Read browser-hub/MONITOR-VERIFICATION.md; build success does not certify installation on your PC.",
    }, indent=2) + "\n")
    hashes = [f"{hashlib.sha256(item.read_bytes()).hexdigest()}  {item.relative_to(kit).as_posix()}\n"
              for item in sorted(kit.rglob("*")) if item.is_file()]
    (kit / "FILE-SHA256SUMS.txt").write_text("".join(hashes))
    artifacts.append(archive(kit, f"Constellation-{version}-Windows-Monitor-Kit.zip"))
receipt = []
for item in artifacts:
    receipt.append({"file": item.name, "bytes": item.stat().st_size, "sha256": hashlib.sha256(item.read_bytes()).hexdigest()})
(output / "SHA256SUMS.txt").write_text("".join(f"{row['sha256']}  {row['file']}\n" for row in receipt))
(output / "artifact-receipt.json").write_text(json.dumps({
    "version": version, "source_commit": source_commit, "source_dirty": source_dirty, "artifacts": receipt,
    "build": build_info, "firefox_signed": False, "native_targets": built_targets,
    "acceptance_evidence": "MONITOR-VERIFICATION.md inside each native package; packaging does not certify target-environment acceptance",
}, indent=2) + "\n")
print(json.dumps(receipt, indent=2))
