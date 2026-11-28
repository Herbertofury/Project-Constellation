import io
import json
import subprocess
import sys
import unittest


class TransportTests(unittest.TestCase):
    def test_line_reads_are_bounded_and_boundary_is_preserved(self):
        from computer_link.__main__ import MAX_REQUEST_CHARS, bounded_lines
        class CheckedStream(io.StringIO):
            def readline(self, size=-1):
                if size != MAX_REQUEST_CHARS + 1:
                    raise AssertionError("unbounded read")
                return super().readline(size)
        exact = "x" * (MAX_REQUEST_CHARS - 1) + "\n"
        stream = CheckedStream(exact + "y" * (MAX_REQUEST_CHARS * 4) + "\nvalid\n")
        self.assertEqual(list(bounded_lines(stream)), [exact, None, "valid\n"])
        self.assertEqual(list(bounded_lines(CheckedStream("x" * MAX_REQUEST_CHARS))),
                         ["x" * MAX_REQUEST_CHARS])

    def test_oversized_request_is_rejected_and_next_line_recovers(self):
        # The current diagnostics protocol has no bulk-payload methods.
        oversized = json.dumps({"id": "x" * 70000, "method": "system.summary"})
        p = subprocess.run([sys.executable, "-m", "computer_link"],
                           input=oversized + "\n" + '{"id":2,"method":"system.summary"}\n',
                           text=True, capture_output=True, check=True)
        results = [json.loads(line) for line in p.stdout.splitlines()]
        self.assertEqual(results[0], {"error": "request too large"})
        self.assertEqual(results[1]["id"], 2)
        self.assertIn("result", results[1])

    def test_oversized_eof_is_one_error(self):
        p = subprocess.run([sys.executable, "-m", "computer_link"],
                           input="x" * 200000, text=True, capture_output=True, check=True)
        self.assertEqual(p.stdout, '{"error": "request too large"}\n')


    def test_duplicate_members_never_dispatch_and_next_request_recovers(self):
        script = """
from unittest.mock import patch
from computer_link import Capability, Registry
from computer_link.__main__ import main
r = Registry()
calls = []
r.register(Capability('probe', 'read', lambda: calls.append(1)))
with patch('computer_link.__main__.diagnostics_registry', return_value=r):
    main()
assert calls == [1], calls
"""
        requests = [
            '{"id":1,"method":"unsupported","method":"probe"}',
            '{"id":1,"id":2,"method":"probe"}',
            '{"method":"probe","params":{"unsafe":true},"params":{}}',
            '{"method":"probe","params":{"x":1,"x":2}}',
        ]
        p = subprocess.run([sys.executable, '-c', script],
                           input='\n'.join(requests + ['{"id":3,"method":"probe"}']) + '\n',
                           text=True, capture_output=True)
        self.assertEqual(p.returncode, 0, p.stderr)
        results = [json.loads(line) for line in p.stdout.splitlines()]
        self.assertEqual(results[:-1], [{'error': 'invalid JSON'}] * len(requests))
        self.assertEqual(results[-1], {'id': 3, 'result': None})
        self.assertEqual(p.stderr, '')

    def test_invalid_utf8_line_recovers_under_strict_process_encoding(self):
        import os
        env = dict(os.environ, PYTHONIOENCODING="utf-8:strict")
        requests = [b'{"id":"\xff","method":"system.summary"}',
                    b'{"id":"\xc3","method":"system.summary"}',
                    b'{"id":"\xed\xa0\x80","method":"system.summary"}']
        valid = json.dumps({"id": "音楽 🎵", "method": "system.summary"},
                           ensure_ascii=False).encode("utf-8")
        p = subprocess.run([sys.executable, "-m", "computer_link"],
                           input=b"\n".join(requests + [valid]) + b"\n",
                           capture_output=True, env=env)
        self.assertEqual(p.returncode, 0, p.stderr)
        results = [json.loads(line) for line in p.stdout.splitlines()]
        self.assertEqual(results[:-1], [{"error": "invalid JSON"}] * 3)
        self.assertEqual(results[-1]["id"], "音楽 🎵")
        self.assertIn("result", results[-1])
        self.assertEqual(p.stderr, b"")

    def test_oversized_invalid_utf8_drains_before_next_unicode_request(self):
        import os
        from computer_link.__main__ import MAX_REQUEST_CHARS
        valid = b'{"id":"\\udcff","method":"capabilities.list"}\n'
        p = subprocess.run([sys.executable, "-m", "computer_link"],
                           input=b"\xff" * (MAX_REQUEST_CHARS * 2) + b"\n" + valid,
                           capture_output=True,
                           env=dict(os.environ, PYTHONIOENCODING="ascii:strict"))
        self.assertEqual(p.returncode, 0, p.stderr)
        results = [json.loads(line) for line in p.stdout.splitlines()]
        self.assertEqual(results[0], {"error": "request too large"})
        self.assertEqual(results[1]["id"], "\udcff")
        self.assertIn("result", results[1])
        self.assertEqual(p.stderr, b"")

    def test_invalid_adapter_output_recovers_without_partial_response(self):
        script = '''
from unittest.mock import patch
from computer_link import Capability, diagnostics_registry
from computer_link.__main__ import main
r = diagnostics_registry()
cycle = []
cycle.append(cycle)
outputs = [object(), cycle, float("nan"), float("inf"), -float("inf")]
for index, value in enumerate(outputs):
    r.register(Capability(str(index), "read", lambda value=value: value))
with patch("computer_link.__main__.diagnostics_registry", return_value=r):
    main()
'''
        requests = [{"id": i, "method": str(i)} for i in range(5)]
        requests.append({"id": 5, "method": "system.summary"})
        p = subprocess.run([sys.executable, "-c", script],
                           input="".join(json.dumps(r) + "\n" for r in requests),
                           text=True, capture_output=True, check=True)
        results = [json.loads(line) for line in p.stdout.splitlines()]
        self.assertEqual(len(results), 6)
        for i in range(5):
            self.assertEqual(results[i], {"id": i, "error": "invalid capability response"})
        self.assertIn("result", results[5])
        self.assertEqual(p.stderr, "")


if __name__ == "__main__":
    unittest.main()
