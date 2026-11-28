import json
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from collections import namedtuple
from computer_link import Capability, Registry, diagnostics_registry
from computer_link.__main__ import respond


class CoreTests(unittest.TestCase):
    def test_independent_removal(self):
        r = diagnostics_registry()
        r.register(Capability("optional", "read", lambda: 1))
        r.remove("optional")
        self.assertTrue(r.call("system.summary")["os"])

    def test_no_mutation_in_read_only(self):
        r = Registry()
        called = []
        r.register(Capability("mutate", "write", lambda: called.append(1)))
        with self.assertRaises(PermissionError): r.call("mutate")
        self.assertEqual(called, [])

    def test_duplicate_and_effect(self):
        r = diagnostics_registry()
        with self.assertRaises(ValueError): r.register(Capability("system.summary", "read", lambda: 0))
        with self.assertRaises(ValueError): r.register(Capability("bad", "unknown", lambda: 0))

    def test_invalid_registration_never_poison_existing_capabilities(self):
        invalid = [Capability(name, "read", lambda: 0)
                   for name in (None, 7, [], {}, "")]
        invalid += [Capability("bad", effect, lambda: 0)
                    for effect in (None, [], {}, 7)]
        invalid += [Capability("bad", "read", handler)
                    for handler in (None, 7, {}, "not callable")]
        for capability in invalid:
            with self.subTest(capability=capability):
                registry = diagnostics_registry()
                before = registry.describe()
                with self.assertRaises(ValueError):
                    registry.register(capability)
                self.assertEqual(registry.describe(), before)
                self.assertIn("result", respond(registry, {"method": "capabilities.list"}))
                self.assertIn("os", registry.call("system.summary"))
                registry.register(Capability("bad", "read", lambda: "repaired"))
                self.assertEqual(registry.call("bad"), "repaired")

    def test_process_discovery_survives_rejected_optional_registration(self):
        script = """
from unittest.mock import patch
from computer_link import Capability, diagnostics_registry
from computer_link.__main__ import main
registry = diagnostics_registry()
for candidate in [Capability(None, 'read', lambda: 0),
                  Capability('bad', 'read', None)]:
    try:
        registry.register(candidate)
    except ValueError:
        pass
    else:
        raise AssertionError('invalid registration accepted')
with patch('computer_link.__main__.diagnostics_registry', return_value=registry):
    main()
"""
        p = subprocess.run([sys.executable, "-c", script],
                           input='{"id":1,"method":"capabilities.list"}\n'
                                 '{"id":2,"method":"system.summary"}\n',
                           text=True, capture_output=True, check=True)
        results = [json.loads(line) for line in p.stdout.splitlines()]
        self.assertEqual(results[0]["result"], [{"name": "system.summary", "effect": "read"}])
        self.assertIn("os", results[1]["result"])
        self.assertEqual(p.stderr, "")

    def test_disk_no_path_disclosure(self):
        with tempfile.TemporaryDirectory() as d:
            r = diagnostics_registry(d)
            out = r.call("workspace.disk")
            self.assertGreater(out["total_bytes"], 0)
            self.assertNotIn(d, json.dumps(out))
            self.assertGreaterEqual(out["total_bytes"], out["used_bytes"])
            self.assertGreaterEqual(out["available_bytes"], 0)

    def test_reserved_blocks_preserved(self):
        usage = namedtuple("usage", "total used free")(100, 30, 60)
        with tempfile.TemporaryDirectory() as d, patch("computer_link.shutil.disk_usage", return_value=usage):
            self.assertEqual(diagnostics_registry(d).call("workspace.disk"), {"total_bytes":100,"used_bytes":30,"available_bytes":60})

    def test_no_implicit_workspace(self):
        self.assertEqual(len(diagnostics_registry().describe()), 1)

    def test_bad_requests(self):
        r = diagnostics_registry()
        for req in [[], {}, {"method": []}, {"method": "x"}, {"method": "system.summary", "params": {"shell": "whoami"}}, {"method": "capabilities.list", "params": {"x": 1}}, {"method": "system.summary", "id": []}]:
            self.assertIn("error", respond(r, req))

    def test_process_recovery(self):
        p = subprocess.run([sys.executable, "-m", "computer_link"], input='bad json\n{"id":2,"method":"system.summary"}\n', text=True, capture_output=True, check=True)
        results = [json.loads(x) for x in p.stdout.splitlines()]
        self.assertIn("error", results[0])
        self.assertEqual(results[1]["id"], 2)
        self.assertFalse(results[1]["result"]["network_listener"])

    def test_adapter_failure_isolated_and_private(self):
        r = diagnostics_registry()
        def broken():
            raise RuntimeError("private adapter path or credential")
        r.register(Capability("optional.broken", "read", broken))
        self.assertEqual(respond(r, {"id": 7, "method": "optional.broken"}),
                         {"id": 7, "error": "capability failed"})
        self.assertIn("result", respond(r, {"id": 8, "method": "system.summary"}))

    def test_adapter_validation_exceptions_are_not_public_request_errors(self):
        for kind in (ValueError, PermissionError):
            with self.subTest(kind=kind):
                r = diagnostics_registry()
                def broken():
                    raise kind('private machine path and credential')
                r.register(Capability('optional.broken', 'read', broken))
                self.assertEqual(respond(r, {'id': 1, 'method': 'optional.broken'}),
                                 {'id': 1, 'error': 'capability failed'})
                self.assertIn('result', respond(r, {'id': 2, 'method': 'system.summary'}))

    def test_known_request_errors_remain_useful(self):
        r = diagnostics_registry()
        r.register(Capability('write', 'write', lambda: self.fail('must not execute')))
        for request, expected in [({'method': 'missing'}, 'unsupported capability'),
                                  ({'method': 'system.summary', 'params': {'x': 1}}, 'unexpected parameters'),
                                  ({'method': 'write'}, 'read-only session')]:
            self.assertEqual(respond(r, request)['error'], expected)

    def test_shutdown_signals_propagate(self):
        for signal in (KeyboardInterrupt, SystemExit):
            r = Registry()
            def stop():
                raise signal()
            r.register(Capability("stop", "read", stop))
            with self.assertRaises(signal):
                respond(r, {"method": "stop"})

    def test_process_survives_optional_adapter_failure(self):
        script = """
from unittest.mock import patch
from computer_link import Capability, diagnostics_registry
from computer_link.__main__ import main
registry = diagnostics_registry()
def broken():
    raise RuntimeError("private adapter failure")
registry.register(Capability("optional.broken", "read", broken))
with patch("computer_link.__main__.diagnostics_registry", return_value=registry):
    main()
"""
        requests = [{"id": 1, "method": "optional.broken"},
                    {"id": 2, "method": "system.summary"},
                    {"id": 3, "method": "capabilities.list"}]
        p = subprocess.run([sys.executable, "-c", script],
                           input="".join(json.dumps(r) + "\n" for r in requests),
                           text=True, capture_output=True, check=True)
        results = [json.loads(line) for line in p.stdout.splitlines()]
        self.assertEqual(len(results), 3)
        self.assertEqual(results[0], {"id": 1, "error": "capability failed"})
        self.assertIn("result", results[1])
        self.assertIn("result", results[2])
        self.assertNotIn("private", p.stdout + p.stderr)

    def test_unknown_does_not_execute(self):
        out = respond(diagnostics_registry(), {"method":"shell.execute"})
        self.assertEqual(out["error"], "unsupported capability")

if __name__ == "__main__": unittest.main()
