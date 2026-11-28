import importlib.util
import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path


SPEC = importlib.util.spec_from_file_location(
    "external_scheduler_rescue", Path(__file__).resolve().parents[1] / "watchdog/external_scheduler_rescue.py"
)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class HeartbeatTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "heartbeat.json"
        self.now = datetime(2026, 11, 28, 12, 0, tzinfo=timezone.utc)

    def evaluate(self, value, **kwargs):
        self.path.write_text(json.dumps(value), encoding="utf-8")
        return MODULE.evaluate_heartbeat(self.path, now=self.now, **kwargs)

    def test_threshold_boundary_and_timezone_conversion(self):
        state = self.evaluate({"last_ok_utc": "2026-11-28T03:45:00-07:00"}, stale_minutes=75)
        self.assertEqual(state["scheduler_state"], "healthy")
        self.assertFalse(state["recovery_required"])
        self.assertEqual(state["last_ok_utc"], "2026-11-28T10:45:00Z")
        self.assertEqual(state["service_health"], "not-measured")

    def test_stale_episode_is_stable_as_time_passes(self):
        first = self.evaluate({"last_ok_utc": "2026-09-23T03:53:35Z"}, stale_minutes=75)
        later = MODULE.evaluate_heartbeat(self.path, now=self.now + timedelta(minutes=10), stale_minutes=75)
        self.assertEqual(first["scheduler_state"], "stale")
        self.assertEqual(first["episode_key"], later["episode_key"])
        self.assertNotEqual(first["heartbeat_age_minutes"], later["heartbeat_age_minutes"])

    def test_new_audit_changes_episode(self):
        first = self.evaluate({"last_ok_utc": "2026-11-28T08:00:00Z"})
        later = self.evaluate({"last_ok_utc": "2026-11-28T09:00:00Z"})
        self.assertNotEqual(first["episode_key"], later["episode_key"])

    def test_future_evidence_is_not_healthy(self):
        state = self.evaluate({"last_ok_utc": "2026-12-28T12:00:00Z"})
        self.assertEqual(state["scheduler_state"], "future")
        self.assertTrue(state["recovery_required"])

    def test_small_clock_skew_is_explicit(self):
        state = self.evaluate({"last_ok_utc": "2026-11-28T12:04:00Z"})
        self.assertEqual(state["scheduler_state"], "healthy")
        self.assertEqual(state["heartbeat_age_minutes"], -4)

    def test_naive_and_non_timestamp_evidence_is_rejected(self):
        for value in ("2026-11-28T12:00:00", "2026-11-28", 7, None, [], "2026-11-28T12:00:00Z\nrecovery_required=false"):
            with self.subTest(value=value):
                state = self.evaluate({"last_ok_utc": value})
                self.assertEqual(state["scheduler_state"], "broken")
                self.assertTrue(state["recovery_required"])
                self.assertNotIn("\n", state["reason"])

    def test_invalid_thresholds_fail_closed(self):
        for value in (0, -1, True, "NaN", "Infinity", [], None):
            with self.subTest(value=value):
                state = self.evaluate({"last_ok_utc": "2026-11-28T12:00:00Z", "external_stale_after_minutes": value})
                self.assertEqual(state["scheduler_state"], "broken")
                self.assertTrue(state["recovery_required"])
                json.dumps(state, allow_nan=False)

    def test_invalid_environment_threshold_is_a_recorded_failure(self):
        state = self.evaluate({"last_ok_utc": "2026-11-28T12:00:00Z"}, stale_minutes="invalid")
        self.assertEqual(state["scheduler_state"], "broken")
        self.assertTrue(state["recovery_required"])

    def test_hourly_monitor_preserves_its_independent_hours_threshold(self):
        data = {"last_ok_utc": "2026-11-28T09:00:00Z", "stale_after_hours": 4,
                "external_stale_after_minutes": 75}
        external = self.evaluate(data, stale_minutes=75)
        hourly = self.evaluate(data, stale_minutes=240, threshold_source="hours")
        self.assertEqual(external["scheduler_state"], "stale")
        self.assertEqual(hourly["scheduler_state"], "healthy")
        self.assertEqual(hourly["stale_threshold_minutes"], 240)
        invalid = self.evaluate({**data, "stale_after_hours": 1e308}, threshold_source="hours")
        self.assertEqual(invalid["scheduler_state"], "broken")
        json.dumps(invalid, allow_nan=False)

    def test_missing_and_malformed_files_are_recoverable(self):
        missing = MODULE.evaluate_heartbeat(self.path, now=self.now)
        self.assertEqual(missing["scheduler_state"], "broken")
        for raw in (b"not json", b"\xff", b"[]", b"null", b"{}"):
            with self.subTest(raw=raw):
                self.path.write_bytes(raw)
                state = MODULE.evaluate_heartbeat(self.path, now=self.now)
                self.assertEqual(state["scheduler_state"], "broken")
                self.assertTrue(state["recovery_required"])

    def test_output_cannot_inject_an_action_output(self):
        out = Path(self.temp.name) / "outputs"
        MODULE.write_outputs({"reason": "bad\nrecovery_required=false\rNEXT=value", "recovery_required": True}, out)
        lines = out.read_text().splitlines()
        self.assertEqual(sum(line.startswith("recovery_required=") for line in lines), 1)
        self.assertIn("recovery_required=true", lines)
        self.assertFalse(any(line.startswith("NEXT=") for line in lines))


if __name__ == "__main__":
    unittest.main()
