#!/usr/bin/env python3
"""Measure complete native ACK workloads; unsafe old ACKs are not equivalent durability."""
import argparse
import hashlib
import json
import os
import platform
import queue
import statistics
import struct
import subprocess
import tempfile
import threading
import time
from pathlib import Path


class Sensor:
    def __init__(self, binary, directory):
        self.directory = directory
        self.started = time.perf_counter_ns()
        self.process = subprocess.Popen(
            [str(binary), "native", "--data-dir", str(directory)],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            env={**os.environ, "CONSTELLATION_IDLE_GRACE_MS": "100"})
        self.responses = queue.Queue()
        self.changed = threading.Condition()
        self.broadcasts = 0
        self.broadcast_revision = -1
        self.sequence = 0
        self.reader = threading.Thread(target=self.read, daemon=True)
        self.reader.start()

    def read(self):
        try:
            while header := self.process.stdout.read(4):
                if len(header) != 4:
                    raise RuntimeError("truncated native header")
                length, = struct.unpack("=I", header)
                if not 0 < length <= 1_000_000:
                    raise RuntimeError("invalid native frame length")
                raw = self.process.stdout.read(length)
                if len(raw) != length:
                    raise RuntimeError("truncated native body")
                message = json.loads(raw)
                received = time.perf_counter_ns()
                if message.get("kind") == "snapshot" and "id" not in message:
                    with self.changed:
                        self.broadcasts += 1
                        self.broadcast_revision = message["data"]["revision"]
                        self.changed.notify_all()
                else:
                    self.responses.put((message, received))
        except Exception as error:
            self.responses.put(error)

    def request(self, operation, **fields):
        self.sequence += 1
        identity = str(self.sequence)
        raw = json.dumps({"v": 1, "id": identity, "op": operation, **fields},
                         separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        start = time.perf_counter_ns()
        self.process.stdin.write(struct.pack("=I", len(raw)) + raw)
        self.process.stdin.flush()
        result = self.responses.get(timeout=8)
        if isinstance(result, Exception):
            raise result
        message, received = result
        assert message.get("id") == identity and message.get("ok") is True, message
        return message["data"], (received - start) / 1_000_000

    def settled(self, revision):
        with self.changed:
            assert self.changed.wait_for(lambda: self.broadcast_revision >= revision, timeout=3)

    def close(self):
        self.process.stdin.close()
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait()
            raise
        self.reader.join(timeout=2)
        assert self.process.returncode == 0, self.process.stderr.read().decode("utf-8", "replace")
        deadline = time.monotonic() + 5
        while (self.directory / "endpoint.json").exists():
            if time.monotonic() >= deadline:
                raise RuntimeError("broker did not stop after its final sensor")
            time.sleep(0.01)


def percentiles(samples):
    ordered = sorted(samples)
    return {"count": len(samples), "p50Ms": statistics.median(samples),
            "p95Ms": ordered[int((len(ordered) - 1) * .95)],
            "p99Ms": ordered[int((len(ordered) - 1) * .99)], "maxMs": max(samples)}


def measure(binary):
    with tempfile.TemporaryDirectory(prefix="constellation-ack-") as temporary:
        directory = Path(temporary)
        sensor = Sensor(binary, directory)
        try:
            sensor.request("hello", client={"browser": "chrome", "profileId": "benchmark",
                                            "instanceId": "session", "label": "Benchmark"})
            startup = (time.perf_counter_ns() - sensor.started) / 1_000_000
            clock = int(time.time() * 1000) - 100_000
            events = [{"tabId": tab, "documentId": f"document-{tab}", "runId": f"run-{tab}",
                       "url": f"https://chatgpt.com/c/complete-{tab}", "title": f"Complete session {tab}",
                       "status": "error", "reason": "Initial issue", "observedAt": clock}
                      for tab in range(96)]
            for status in ("error", "permission_required"):
                for event in events:
                    clock += 1
                    event.update(status=status, reason="Unchanged evidence", observedAt=clock)
                    sensor.request("observe", event=event)
            initial, _ = sensor.request("snapshot")
            assert len(initial["sessions"]) == 96 and len(initial["incidents"]) == 192
            sensor.settled(initial["revision"])
            broadcast_count = sensor.broadcasts
            samples = []
            started = time.perf_counter_ns()
            for _ in range(4):
                for event in events:
                    clock += 1
                    event["observedAt"] = clock
                    result, elapsed = sensor.request("observe", event=event)
                    assert result["changed"] is False and result["revision"] == initial["revision"]
                    samples.append(elapsed)
            complete = (time.perf_counter_ns() - started) / 1_000_000
            state_path = directory / "state.json"
            saved = json.loads(state_path.read_bytes())
            saved_times = {row["tabId"]: row["observedAt"] for row in saved["sessions"]}
            durable = all(saved_times.get(event["tabId"]) == event["observedAt"] for event in events)
            before_retry = state_path.stat()
            retries = []
            for _ in range(4):
                for event in events:
                    result, elapsed = sensor.request("observe", event=event)
                    assert result["changed"] is False
                    retries.append(elapsed)
            after_retry = state_path.stat()
            final, _ = sensor.request("snapshot")
            assert len(final["sessions"]) == 96 and len(final["incidents"]) == 192
            assert final["revision"] == initial["revision"]
            assert sum(row["resolvedAt"] is None for row in final["incidents"]) == 96
            assert sensor.broadcasts == broadcast_count, "duplicate evidence caused a broadcast"
            assert (before_retry.st_ino, before_retry.st_mtime_ns) == (after_retry.st_ino, after_retry.st_mtime_ns)
            return {"startupToHelloMs": startup, "advancingDuplicateAck": percentiles(samples),
                    "advancingDuplicateCompletionMs": complete, "exactRetryAck": percentiles(retries),
                    "acknowledgedWatermarksDurable": durable, "duplicateBroadcasts": 0,
                    "exactRetriesRewroteState": False, "sessions": 96, "incidents": 192,
                    "unresolvedIncidents": 96, "stateBytes": state_path.stat().st_size}
        finally:
            sensor.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--iterations", type=int, default=5)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.iterations < 1:
        parser.error("iterations must be positive")
    binaries = {name: getattr(args, name).resolve() for name in ("baseline", "candidate")}
    result = {"schema": "constellation-native-ack-measurement-v1", "platform": platform.system(),
              "architecture": platform.machine(), "python": platform.python_version(),
              "workload": {"sessions": 96, "incidents": 192, "advancingDuplicates": 384, "exactRetries": 384},
              "note": "The baseline's unsafe duplicate ACKs do not provide equivalent durability. This measures the explicit cost of the repair, not a no-loss speedup. Startup is a fresh process with normal OS caches.",
              "binaries": {name: {"sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
                           for name, path in binaries.items()}, "runs": []}
    for iteration in range(args.iterations):
        order = ("baseline", "candidate") if iteration % 2 == 0 else ("candidate", "baseline")
        for name in order:
            measured = measure(binaries[name])
            if name == "candidate":
                assert measured["acknowledgedWatermarksDurable"], "candidate ACK was not durable"
            result["runs"].append({"implementation": name, "iteration": iteration + 1, **measured})
    result["passed"] = True
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"passed": True, "runs": len(result["runs"]), "output": str(args.output)}))


if __name__ == "__main__":
    main()
