#!/usr/bin/env python3
"""Build an actual self-contained current-user Windows setup executable.

The payload is data embedded in a Rust PE executable. No archive utility,
PowerShell, Python, Rust, network download or administrator account is needed
on the destination PC. Browser extension confirmation remains a user action.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile
import tomllib

ROOT = Path(__file__).resolve().parents[1]
CRATE = ROOT / "native" / "constellation-setup"
MAGIC = b"CONSTELLATION-SETUP-PAYLOAD-1\0"
REQUIRED_COMPUTER_TOOLS = {
    "computer-link-owner-proof.exe", "local-client.exe", "local-window-focus.exe",
    "computer-link-mcp-session.exe", "computer-link-workspace-candidate.exe", "owned-worker.exe",
}
SOURCE_SCOPE = [
    "package.json", "package-lock.json", "extension", "native/constellation-setup",
    "native/constellation-monitor", "computer-link", "tools/build-windows-setup.py",
    "tools/build.mjs", "tools/build-browser-sensors.mjs", "tools/computer-link/build.mjs",
    "tools/windows-setup-acceptance.py", "docs/AGENT-MONITOR.md", "docs/MONITOR-VERIFICATION.md",
    "desktop/LICENSE", ".github/workflows/windows-setup.yml",
]
WINDOWS_SYSTEM_DLLS = {
    "advapi32.dll", "bcrypt.dll", "comctl32.dll", "comdlg32.dll", "crypt32.dll",
    "dwmapi.dll", "gdi32.dll", "imm32.dll", "iphlpapi.dll", "kernel32.dll", "msvcrt.dll",
    "netapi32.dll", "normaliz.dll", "ntdll.dll", "ole32.dll", "oleaut32.dll", "powrprof.dll",
    "propsys.dll", "psapi.dll", "rpcrt4.dll", "secur32.dll", "setupapi.dll", "shell32.dll",
    "shlwapi.dll", "user32.dll", "userenv.dll", "ucrtbase.dll", "uxtheme.dll", "version.dll",
    "winhttp.dll", "winmm.dll", "winspool.drv", "wintrust.dll", "ws2_32.dll", "wtsapi32.dll",
}


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def pe_info(data: bytes) -> dict:
    """Read the actual PE import table/resources without rewriting the EXE."""
    def unpack(pattern: str, offset: int):
        if offset < 0 or offset + struct.calcsize(pattern) > len(data):
            raise ValueError("Truncated Windows executable")
        return struct.unpack_from(pattern, data, offset)
    if data[:2] != b"MZ":
        raise ValueError("Expected a Windows executable")
    pe, = unpack("<I", 0x3C)
    if data[pe:pe + 4] != b"PE\0\0":
        raise ValueError("Invalid PE signature")
    machine, count = unpack("<HH", pe + 4)
    optional_size, = unpack("<H", pe + 20)
    optional = pe + 24
    magic, = unpack("<H", optional)
    if machine != 0x8664 or magic != 0x20B or not 1 <= count <= 96:
        raise ValueError("Setup requires genuine x64 PE32+ executables")
    sections = []
    resource = b""
    for index in range(count):
        header = optional + optional_size + index * 40
        name = data[header:header + 8].rstrip(b"\0")
        virtual_size, rva, raw_size, raw_offset = unpack("<IIII", header + 8)
        if raw_offset + raw_size > len(data):
            raise ValueError("Invalid PE section bounds")
        sections.append((rva, max(virtual_size, raw_size), raw_offset, raw_size))
        if name == b".rsrc":
            resource = data[raw_offset:raw_offset + raw_size]
    def offset_for(rva: int, size: int = 1) -> int:
        for base, extent, raw, raw_size in sections:
            delta = rva - base
            if 0 <= delta and delta + size <= extent and delta + size <= raw_size:
                return raw + delta
        raise ValueError("PE data points outside a stored section")
    imports_rva, imports_size = unpack("<II", optional + 112 + 8)
    imports = []
    if imports_rva:
        for index in range(256):
            descriptor = unpack("<IIIII", offset_for(imports_rva + index * 20, 20))
            if not any(descriptor):
                break
            name_offset = offset_for(descriptor[3])
            end = data.find(b"\0", name_offset, min(name_offset + 1024, len(data)))
            if end < 0:
                raise ValueError("Unterminated PE import name")
            imports.append(data[name_offset:end].decode("ascii").lower())
        else:
            raise ValueError("PE import table exceeds limit")
    elif imports_size:
        raise ValueError("Invalid PE import directory")
    subsystem, = unpack("<H", optional + 68)
    security_offset, security_size = unpack("<II", optional + 112 + 4 * 8)
    return {"imports": sorted(set(imports)), "subsystem": subsystem, "resources": resource,
            "hasSignature": bool(security_offset and security_size)}


def verify_portable_pe(data: bytes) -> dict:
    info = pe_info(data)
    external = [name for name in info["imports"] if name not in WINDOWS_SYSTEM_DLLS
                and not name.startswith(("api-ms-win-", "ext-ms-win-"))]
    if external:
        raise ValueError("Executable needs non-system DLLs; build with static CRT or include reviewed dependencies: " + ", ".join(external))
    return info


def compiler_environment(environment: dict[str, str], target: str) -> dict[str, str]:
    result = environment.copy()
    if target.endswith("windows-msvc"):
        existing = (result["CARGO_ENCODED_RUSTFLAGS"].split("\x1f") if "CARGO_ENCODED_RUSTFLAGS" in result
                    else result.get("RUSTFLAGS", "").split())
        result["CARGO_ENCODED_RUSTFLAGS"] = "\x1f".join([*existing, "-C", "target-feature=+crt-static"])
        result.pop("RUSTFLAGS", None)
    return result


def safe_path(path: str) -> None:
    if not path or len(path) > 220 or not path.isascii() or any(c in path for c in "\\:\0"):
        raise ValueError(f"Unsafe payload path: {path!r}")
    for part in path.split("/"):
        stem = part.split(".")[0].upper()
        if (not part or part in (".", "..") or part.endswith((" ", "."))
                or any(ord(c) < 32 or c in '<>"|?*' for c in part)
                or stem in {"CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$"}
                or stem in {f"{p}{n}" for p in ("COM", "LPT") for n in range(1, 10)}):
            raise ValueError(f"Unsafe Windows payload component: {part!r}")


def add_tree(files: dict[str, bytes], source: Path, prefix: str) -> None:
    if not source.is_dir() or source.is_symlink():
        raise ValueError(f"Build the required payload first: {source}")
    for path in sorted(source.rglob("*")):
        if path.is_symlink():
            raise ValueError(f"Payload must not contain symlinks: {path}")
        if path.is_file():
            name = f"{prefix}/{path.relative_to(source).as_posix()}"
            safe_path(name)
            if name.lower() in {existing.lower() for existing in files}:
                raise ValueError(f"Duplicate payload filename: {name}")
            files[name] = path.read_bytes()


def pack(files: dict[str, bytes], metadata: dict) -> tuple[bytes, dict]:
    offset = 0
    records = []
    folded = set()
    for path, content in sorted(files.items()):
        safe_path(path)
        if path.lower() in folded:
            raise ValueError(f"Duplicate case-insensitive payload filename: {path}")
        folded.add(path.lower())
        records.append({"path": path, "sha256": digest(content), "bytes": len(content), "offset": offset})
        offset += len(content)
    if offset > 500 * 1024 * 1024:
        raise ValueError("Payload exceeds the self-contained installer limit")
    manifest = {"schema": 1, **metadata, "files": records}
    encoded = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
    if len(records) > 20_000 or len(encoded) > 4 * 1024 * 1024:
        raise ValueError("Payload manifest exceeds the native installer's validation limit")
    return MAGIC + struct.pack("<I", len(encoded)) + encoded + b"".join(files[p] for p in sorted(files)), manifest


def dependency_licenses(files: dict[str, bytes], cargo: str, environment: dict[str, str]) -> None:
    """Ship actual license files for every locked Rust setup dependency."""
    result = subprocess.run([cargo, "metadata", "--locked", "--format-version=1", "--manifest-path", str(CRATE / "Cargo.toml")], check=True, capture_output=True, text=True, env=environment)
    metadata = json.loads(result.stdout)
    inventory = []
    for package in metadata["packages"]:
        root = Path(package["manifest_path"]).parent
        destination = f"docs/setup-dependency-licenses/{package['name']}-{package['version']}"
        copied = []
        for path in sorted(root.iterdir()):
            if path.is_file() and path.name.lower().startswith(("license", "licence", "copying", "notice")):
                files[f"{destination}/{path.name}"] = path.read_bytes()
                copied.append(path.name)
        inventory.append({"name": package["name"], "version": package["version"], "license": package.get("license"), "repository": package.get("repository"), "licenseFiles": copied, "local": package.get("source") is None})
    files["docs/setup-dependency-licenses/INDEX.json"] = (json.dumps(inventory, indent=2) + "\n").encode()


def source_fingerprint() -> tuple[str, list[dict]]:
    names = subprocess.check_output(["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", *SOURCE_SCOPE], cwd=ROOT).decode().split("\0")
    records = []
    for name in sorted(set(filter(None, names))):
        content = (ROOT / name).read_bytes()
        records.append({"path": name, "bytes": len(content), "sha256": digest(content)})
    return digest(json.dumps(records, sort_keys=True, separators=(",", ":")).encode()), records


def build_resources(output: Path, version: str, environment: dict[str, str], compiler: str | None, target: str) -> Path:
    msvc = target.endswith("windows-msvc")
    tool = compiler or environment.get("RC")
    if not tool and msvc:
        tool = shutil.which("rc.exe")
        kits = Path(environment.get("ProgramFiles(x86)", r"C:\Program Files (x86)")) / "Windows Kits/10/bin"
        if not tool and kits.is_dir():
            candidates = [path for path in kits.glob("*/x64/rc.exe") if path.is_file()]
            candidates.sort(key=lambda path: tuple(int(part) for part in path.parents[1].name.split(".") if part.isdecimal()), reverse=True)
            if candidates:
                tool = str(candidates[0])
    if not tool and not msvc:
        tool = shutil.which("x86_64-w64-mingw32-windres") or shutil.which("windres")
    if not tool:
        raise ValueError("Set --resource-compiler or RC to Windows SDK rc.exe (MSVC) or MinGW windres (GNU).")
    manifest = output / "setup.manifest"
    manifest.write_text('''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
 <assemblyIdentity version="1.0.0.0" processorArchitecture="amd64" name="ProjectConstellation.Setup" type="win32"/>
 <description>Project Constellation Setup</description>
 <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3"><security><requestedPrivileges>
  <requestedExecutionLevel level="asInvoker" uiAccess="false"/>
 </requestedPrivileges></security></trustInfo>
 <compatibility xmlns="urn:schemas-microsoft-com:compatibility.v1"><application>
  <supportedOS Id="{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}"/>
 </application></compatibility>
</assembly>
''', encoding="utf-8")
    # Wrap the existing product PNG as a standard PNG-backed ICO. This is a
    # lossless container conversion, not a new or externally fetched artwork.
    png = (ROOT / "extension/assets/attention-icon.png").read_bytes()
    if png[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("Expected the repository's PNG product icon")
    width, height = struct.unpack(">II", png[16:24])
    if width > 256 or height > 256:
        raise ValueError("Setup icon must be at most 256 pixels")
    icon = output / "constellation.ico"
    icon.write_bytes(struct.pack("<HHH", 0, 1, 1) + struct.pack("<BBBBHHII", width % 256, height % 256, 0, 0, 1, 32, len(png), 22) + png)
    numbers = version.split(".")
    if len(numbers) != 3 or not all(n.isdecimal() for n in numbers):
        raise ValueError("Windows setup requires a three-component numeric product version")
    numeric = ",".join(numbers + ["0"])
    quote = lambda path: str(path).replace("\\", "\\\\").replace('"', '\\"')
    rc = output / "setup.rc"
    rc.write_text(f'''1 ICON "{quote(icon)}"
1 24 "{quote(manifest)}"
1 VERSIONINFO
FILEVERSION {numeric}
PRODUCTVERSION {numeric}
FILEOS 0x40004L
FILETYPE 0x1L
BEGIN
 BLOCK "StringFileInfo" BEGIN
  BLOCK "040904b0" BEGIN
   VALUE "CompanyName", "Project Constellation\\0"
   VALUE "FileDescription", "Project Constellation Setup\\0"
   VALUE "FileVersion", "{version}\\0"
   VALUE "InternalName", "constellation-setup\\0"
   VALUE "OriginalFilename", "Constellation-Setup.exe\\0"
   VALUE "ProductName", "Project Constellation\\0"
   VALUE "ProductVersion", "{version}\\0"
  END
 END
 BLOCK "VarFileInfo" BEGIN VALUE "Translation", 0x409, 1200 END
END
''', encoding="utf-8")
    obj = output / ("setup-resources.res" if msvc else "setup-resources.o")
    command = [tool, "/nologo", "/fo", str(obj), str(rc)] if msvc else [tool, "--input", str(rc), "--output-format=coff", "--output", str(obj)]
    subprocess.run(command, check=True, env=environment)
    return obj


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cargo", default=os.environ.get("CARGO", "cargo"))
    parser.add_argument("--target", default="x86_64-pc-windows-msvc" if os.name == "nt" else "x86_64-pc-windows-gnu", choices=("x86_64-pc-windows-gnu", "x86_64-pc-windows-msvc"))
    parser.add_argument("--windres")
    parser.add_argument("--resource-compiler")
    parser.add_argument("--monitor-exe", type=Path)
    parser.add_argument("--computer-link", type=Path, default=ROOT / "build/computer-link/windows-x64")
    parser.add_argument("--monitor-only", action="store_true", help="Explicitly build a reduced package without Computer Tools")
    parser.add_argument("--require-computer-link", action="store_true", help="Compatibility alias: full Computer Tools payload is required by default")
    parser.add_argument("--prepare-only", action="store_true", help="Create and verify the embedded payload without linking the EXE")
    parser.add_argument("--require-clean-source", action="store_true", help="Refuse dirty release inputs or binaries without current source provenance")
    parser.add_argument("--acceptance-fixture", action="store_true", help="Build a labeled, non-publishable second payload for actual rollback acceptance")
    parser.add_argument("--output", type=Path, default=ROOT / "build/monitor-artifacts")
    args = parser.parse_args()
    environment = compiler_environment(os.environ.copy(), args.target)
    version = json.loads((ROOT / "package.json").read_text())["version"]
    crate = tomllib.loads((CRATE / "Cargo.toml").read_text())
    if crate["package"]["version"] != version:
        raise ValueError("Installer and product versions differ")
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    tree = subprocess.check_output(["git", "rev-parse", "HEAD^{tree}"], cwd=ROOT, text=True).strip()
    dirty_paths = subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=normal", "--", *SOURCE_SCOPE], cwd=ROOT, text=True).splitlines()
    dirty = bool(dirty_paths)
    if args.require_clean_source and dirty:
        raise ValueError("Release input source is dirty. Commit the reviewed source before building release assets. Unrelated rescue PS1 changes are outside this scope.")
    if args.require_clean_source and args.monitor_exe:
        raise ValueError("Release builds compile their monitor from current source; omit --monitor-exe")
    source_hash, source_files = source_fingerprint()
    browser_command = ["node", "tools/build.mjs", "--mode=production"]
    if not all(environment.get(name, "").strip() for name in (
        "PROJECT_CONSTELLATION_GOOGLE_CLIENT_ID", "PROJECT_CONSTELLATION_GITHUB_CLIENT_ID")):
        browser_command.append("--allow-unprovisioned-oauth")
    subprocess.run(browser_command, cwd=ROOT, check=True, env=environment)
    subprocess.run(["node", "tools/build-browser-sensors.mjs"], cwd=ROOT, check=True, env=environment)
    build_info = json.loads((ROOT / "build/build-info.json").read_text())
    if build_info.get("version") != version or build_info.get("mode") != "production":
        raise ValueError("Build a matching production Chromium extension before creating setup")
    files: dict[str, bytes] = {}
    add_tree(files, ROOT / "build/unpacked", "browsers/chromium")
    add_tree(files, ROOT / "build/firefox-sensor", "browsers/firefox")
    for browser in ("chromium", "firefox"):
        if json.loads(files[f"browsers/{browser}/manifest.json"])["version"] != version:
            raise ValueError(f"The {browser} sensor is stale; rebuild it")
    if args.monitor_exe is None:
        subprocess.run([args.cargo, "build", "--release", "--locked", "--target", args.target, "--manifest-path", str(ROOT / "native/constellation-monitor/Cargo.toml")], cwd=ROOT, check=True, env=environment)
    monitor_target = Path(environment.get("CARGO_TARGET_DIR", ROOT / "native/constellation-monitor/target"))
    if not monitor_target.is_absolute():
        monitor_target = ROOT / monitor_target
    binary = args.monitor_exe or monitor_target / args.target / "release/constellation-monitor.exe"
    monitor_bytes = binary.read_bytes()
    executable_imports = {"runtime/constellation-monitor.exe": verify_portable_pe(monitor_bytes)["imports"]}
    files["runtime/constellation-monitor.exe"] = monitor_bytes
    native_manifest = None
    if not args.monitor_only:
        missing = sorted(name for name in REQUIRED_COMPUTER_TOOLS if not (args.computer_link / name).is_file())
        if missing:
            raise ValueError("Build the Computer Tools payload first; missing: " + ", ".join(missing))
        native_manifest = json.loads((args.computer_link / "BUILD-MANIFEST.json").read_text())
        if args.require_clean_source and (native_manifest.get("constellationCommit") != commit or native_manifest.get("sourceDirty") is not False or not native_manifest.get("sourceFingerprint")):
            raise ValueError("Computer Tools must be rebuilt from this clean Constellation commit before release")
        entries = native_manifest.get("binaries", native_manifest.get("artifacts", []))
        for name in REQUIRED_COMPUTER_TOOLS:
            entry = next((entry for entry in entries if entry.get("name", entry.get("file")) == name), None)
            content = (args.computer_link / name).read_bytes()
            if entry is None or entry.get("sha256") != digest(content) or entry.get("bytes") != len(content) or not content.startswith(b"MZ"):
                raise ValueError(f"Computer Tools receipt mismatch: {name}")
            executable_imports[f"computer-link/{name}"] = verify_portable_pe(content)["imports"]
        add_tree(files, args.computer_link, "computer-link")
    for source, destination in [
        (CRATE / "README.md", "docs/WINDOWS-SETUP.md"),
        (ROOT / "docs/AGENT-MONITOR.md", "docs/AGENT-MONITOR.md"),
        (ROOT / "docs/MONITOR-VERIFICATION.md", "docs/MONITOR-VERIFICATION.md"),
        (ROOT / "desktop/LICENSE", "docs/PROJECT-LICENSE.txt"),
    ]:
        if source.is_file():
            files[destination] = source.read_bytes()
    dependency_licenses(files, args.cargo, environment)
    rust_version = subprocess.check_output([environment.get("RUSTC", "rustc"), "--version"], text=True, env=environment).strip()
    build_provenance = {"version": version, "sourceCommit": commit, "sourceTree": tree, "sourceDirty": dirty, "sourceScope": SOURCE_SCOPE, "sourceFingerprint": source_hash, "compiledSources": source_files, "rustc": rust_version, "target": args.target, "monitorBuiltFromSource": args.monitor_exe is None, "computerToolsBuild": native_manifest, "executableImports": executable_imports, "acceptanceFixture": args.acceptance_fixture, "extensionBuild": build_info, "windowsRuntimeExecuted": False, "signed": False, "browserConfirmationRequired": True, "firefoxSigned": False}
    files["docs/BUILD-RECEIPT.json"] = (json.dumps(build_provenance, indent=2) + "\n").encode()
    if args.acceptance_fixture:
        files["docs/ACCEPTANCE-FIXTURE.txt"] = b"Non-publishable rollback acceptance fixture built from current source. This marker changes the payload revision without claiming to be an older software release.\n"
    files["docs/FILE-SHA256SUMS.txt"] = "".join(f"{digest(data)}  {path}\n" for path, data in sorted(files.items())).encode()
    archive, manifest = pack(files, {"version": version, "sourceCommit": commit, "sourceDirty": dirty, "firefoxSigned": False, "computerLinkIncluded": not args.monitor_only})
    staging = ROOT / ("build/windows-setup-fixture" if args.acceptance_fixture else "build/windows-setup")
    staging.mkdir(parents=True, exist_ok=True)
    payload = staging / "payload.bin"
    payload.write_bytes(archive)
    (staging / "payload-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    receipt = {**build_provenance, "payloadSha256": digest(archive), "payloadBytes": len(archive), "payloadFiles": len(files), "computerLinkIncluded": not args.monitor_only}
    if not args.prepare_only:
        environment["CONSTELLATION_SETUP_PAYLOAD"] = str(payload)
        environment["CONSTELLATION_SETUP_RESOURCES"] = str(build_resources(staging, version, environment, args.resource_compiler or args.windres, args.target))
        subprocess.run([args.cargo, "build", "--release", "--locked", "--target", args.target, "--manifest-path", str(CRATE / "Cargo.toml")], cwd=ROOT, check=True, env=environment)
        setup_target = Path(environment.get("CARGO_TARGET_DIR", CRATE / "target"))
        if not setup_target.is_absolute():
            setup_target = ROOT / setup_target
        built = setup_target / args.target / "release/constellation-setup.exe"
        output = args.output.resolve()
        output.mkdir(parents=True, exist_ok=True)
        target = output / f"Constellation-{version}-Windows-Setup{'-Acceptance-Fixture' if args.acceptance_fixture else ''}.exe"
        content = built.read_bytes()
        if source_fingerprint()[0] != source_hash:
            raise ValueError("Installer source changed while compiling; rebuild the finished source before packaging")
        if subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip() != commit:
            raise ValueError("Source commit changed during the build; rebuild before packaging")
        if archive not in content:
            raise ValueError("Linked EXE does not contain the exact verified payload; refusing to label it a complete installer")
        info = verify_portable_pe(content)
        if info["subsystem"] != 2 or (staging / "setup.manifest").read_bytes() not in info["resources"]:
            raise ValueError("Linked EXE is missing its non-elevating Windows application manifest")
        receipt["setupImports"] = info["imports"]
        receipt["signed"] = info["hasSignature"]
        with tempfile.NamedTemporaryFile(prefix=".constellation-setup-", suffix=".tmp", dir=output, delete=False) as staged:
            staged.write(content)
            staged.flush()
            os.fsync(staged.fileno())
            pending = Path(staged.name)
        os.replace(pending, target)
        receipt["embeddedPayloadVerified"] = True
        receipt["artifact"] = {"file": target.name, "bytes": len(content), "sha256": digest(content)}
        (output / f"{target.name}.sha256").write_text(f"{digest(content)}  {target.name}\n")
        (output / "windows-setup-receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    (staging / "build-receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps({name: receipt.get(name) for name in (
        "version", "sourceCommit", "sourceDirty", "sourceFingerprint", "target", "acceptanceFixture",
        "artifact", "payloadSha256", "payloadFiles", "computerLinkIncluded", "embeddedPayloadVerified",
        "windowsRuntimeExecuted", "signed")}, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print(f"Windows setup build failed: {error}", file=sys.stderr)
        sys.exit(1)
