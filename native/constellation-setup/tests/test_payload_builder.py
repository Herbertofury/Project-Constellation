"""Exercise payload construction without building or mutating a user profile."""
import importlib.util
import json
from pathlib import Path
import struct
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location("setup_builder", ROOT / "tools/build-windows-setup.py")
BUILDER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILDER)


class PayloadBuilderTests(unittest.TestCase):
    @staticmethod
    def pe(import_name=b"kernel32.dll"):
        data = bytearray(2048)
        data[:2] = b"MZ"
        struct.pack_into("<I", data, 0x3C, 0x80)
        data[0x80:0x84] = b"PE\0\0"
        struct.pack_into("<HH", data, 0x84, 0x8664, 2)
        struct.pack_into("<H", data, 0x94, 240)
        optional = 0x98
        struct.pack_into("<H", data, optional, 0x20B)
        struct.pack_into("<H", data, optional + 68, 2)
        struct.pack_into("<II", data, optional + 120, 0x1000, 40)
        for index, (name, rva, raw) in enumerate([(b".idata", 0x1000, 0x200), (b".rsrc", 0x2000, 0x400)]):
            header = optional + 240 + index * 40
            data[header:header + len(name)] = name
            struct.pack_into("<IIII", data, header + 8, 0x200, rva, 0x200, raw)
        struct.pack_into("<IIIII", data, 0x200, 0x1080, 0, 0, 0x1060, 0x1080)
        data[0x260:0x260 + len(import_name) + 1] = import_name + b"\0"
        data[0x400:0x400 + 14] = b"real resources"
        return bytes(data)

    def test_pe_inspection_is_read_only_and_extracts_actual_imports_and_resources(self):
        content = self.pe()
        before = BUILDER.digest(content)
        info = BUILDER.verify_portable_pe(content)
        self.assertEqual(info["imports"], ["kernel32.dll"])
        self.assertEqual(info["subsystem"], 2)
        self.assertFalse(info["hasSignature"])
        self.assertTrue(info["resources"].startswith(b"real resources"))
        self.assertEqual(BUILDER.digest(content), before)

    def test_pe_gate_rejects_nonportable_runtime_and_invalid_bounds(self):
        for name in (b"vcruntime140.dll", b"libgcc_s_seh-1.dll", b"unshipped.dll"):
            with self.subTest(name=name), self.assertRaises(ValueError):
                BUILDER.verify_portable_pe(self.pe(name))
        broken = bytearray(self.pe())
        struct.pack_into("<I", broken, 0x200 + 12, 0xFFFFFFFF)
        with self.assertRaises(ValueError):
            BUILDER.pe_info(bytes(broken))
        with self.assertRaises(ValueError):
            BUILDER.pe_info(self.pe()[:0x280])

    def test_msvc_static_crt_flags_keep_existing_compiler_settings(self):
        original = {"RUSTFLAGS": "--cfg existing", "UNRELATED": "kept"}
        result = BUILDER.compiler_environment(original, "x86_64-pc-windows-msvc")
        self.assertEqual(result["CARGO_ENCODED_RUSTFLAGS"].split("\x1f"), ["--cfg", "existing", "-C", "target-feature=+crt-static"])
        self.assertNotIn("RUSTFLAGS", result)
        self.assertIn("RUSTFLAGS", original)
        self.assertEqual(BUILDER.compiler_environment(original, "x86_64-pc-windows-gnu"), original)
        encoded = {"CARGO_ENCODED_RUSTFLAGS": "--cfg\x1fvalue with spaces"}
        self.assertEqual(BUILDER.compiler_environment(encoded, "x86_64-pc-windows-msvc")["CARGO_ENCODED_RUSTFLAGS"].split("\x1f")[:2], ["--cfg", "value with spaces"])

    def test_binary_container_has_verified_lengths_offsets_and_hashes(self):
        files = {"b/file.txt": b"second", "a/file.bin": bytes(range(256))}
        result, manifest = BUILDER.pack(files, {"version": "0.22.0"})
        self.assertTrue(result.startswith(BUILDER.MAGIC))
        length = struct.unpack("<I", result[len(BUILDER.MAGIC):len(BUILDER.MAGIC) + 4])[0]
        start = len(BUILDER.MAGIC) + 4
        self.assertEqual(json.loads(result[start:start + length]), manifest)
        data = result[start + length:]
        for item in manifest["files"]:
            actual = data[item["offset"]:item["offset"] + item["bytes"]]
            self.assertEqual(actual, files[item["path"]])
            self.assertEqual(BUILDER.digest(actual), item["sha256"])
        self.assertEqual(len(data), sum(len(value) for value in files.values()))

    def test_reproducible_independent_of_input_dictionary_order(self):
        left = {"b": b"2", "a": b"1"}
        right = dict(reversed(list(left.items())))
        self.assertEqual(BUILDER.pack(left, {"version": "0.22.0"})[0], BUILDER.pack(right, {"version": "0.22.0"})[0])

    def test_rejects_windows_path_aliases_and_case_duplicates(self):
        for path in ("../outside", "/absolute", "C:/outside", "NUL", "dir/COM9.txt", "dir/file.", "dir/file ", "dir/file:stream", "a\\b", "a//b"):
            with self.subTest(path=path), self.assertRaises(ValueError):
                BUILDER.safe_path(path)
        with self.assertRaises(ValueError):
            BUILDER.pack({"a": b"1", "A": b"2"}, {})

    def test_tree_requires_real_directory_and_preserves_relative_payloads(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "nested").mkdir()
            (root / "nested/file.txt").write_bytes(b"full source bytes")
            files = {}
            BUILDER.add_tree(files, root, "computer-link")
            self.assertEqual(files, {"computer-link/nested/file.txt": b"full source bytes"})
            with self.assertRaises(ValueError):
                BUILDER.add_tree({}, root / "missing", "anything")


if __name__ == "__main__":
    unittest.main()
