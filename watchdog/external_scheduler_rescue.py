#!/usr/bin/env python3
"""Evaluate the committed scheduler audit; never infer live service health."""

import argparse
import hashlib
import json
import math
import os
from datetime import datetime, timezone
from pathlib import Path


def positive_minutes(value):
    if isinstance(value, bool):
        raise ValueError("stale threshold must be a positive finite number")
    result = float(value)
    if not math.isfinite(result) or result <= 0:
        raise ValueError("stale threshold must be a positive finite number")
    return result


def utc_timestamp(value):
    if not isinstance(value, str) or any(ord(char) < 32 for char in value):
        raise ValueError("last_ok_utc must be an ISO timestamp with a timezone")
    result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if result.tzinfo is None or result.utcoffset() is None:
        raise ValueError("last_ok_utc requires an explicit timezone")
    return result.astimezone(timezone.utc)


def evaluate_heartbeat(path, *, now=None, stale_minutes=90, threshold_source="external"):
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None or now.utcoffset() is None:
        raise ValueError("evaluation time requires an explicit timezone")
    now = now.astimezone(timezone.utc)
    state = {
        "schema_version": 2,
        "checked_at_utc": now.isoformat().replace("+00:00", "Z"),
        "stale_threshold_minutes": None,
        "heartbeat_path": str(path),
        "evidence_scope": "committed-scheduler-audit",
        "service_health": "not-measured",
        "scheduler_state": "broken",
        "heartbeat_age_minutes": None,
        "last_ok_utc": None,
        "reason": None,
        "recovery_required": True,
    }
    evidence_digest = "unreadable"
    try:
        threshold = positive_minutes(stale_minutes)
        state["stale_threshold_minutes"] = threshold
        raw = Path(path).read_bytes()
        evidence_digest = hashlib.sha256(raw).hexdigest()
        data = json.loads(raw.decode("utf-8"))
        if not isinstance(data, dict):
            raise ValueError("heartbeat must be an object")
        if threshold_source == "hours":
            threshold = positive_minutes(positive_minutes(data.get("stale_after_hours", threshold / 60)) * 60)
        elif threshold_source == "external":
            threshold = positive_minutes(data.get("external_stale_after_minutes", threshold))
        else:
            raise ValueError("unknown threshold source")
        state["stale_threshold_minutes"] = threshold
        last = utc_timestamp(data["last_ok_utc"])
        age = (now - last).total_seconds() / 60
        state["last_ok_utc"] = last.isoformat().replace("+00:00", "Z")
        state["heartbeat_age_minutes"] = round(age, 2)
        if age < -5:
            state["scheduler_state"] = "future"
            state["reason"] = "Committed audit timestamp is more than five minutes in the future."
        elif age <= threshold:
            state["scheduler_state"] = "healthy"
            state["recovery_required"] = False
            state["reason"] = f"Committed audit age {age:.2f}m <= {threshold:g}m."
        else:
            state["scheduler_state"] = "stale"
            state["reason"] = f"Committed audit age {age:.2f}m > {threshold:g}m."
    except (OSError, UnicodeError, ValueError, TypeError, KeyError, OverflowError) as exc:
        # Never copy malformed file contents into a shell or public issue.
        state["reason"] = f"Committed audit validation failed ({type(exc).__name__})."

    # Time passing does not create a new incident every ten minutes. Invalid
    # evidence is distinguished by its digest rather than exposing its text.
    episode = {
        "state": state["scheduler_state"],
        "last_ok_utc": state["last_ok_utc"],
        "threshold": state["stale_threshold_minutes"],
        "invalid_evidence": evidence_digest if state["scheduler_state"] == "broken" else None,
    }
    state["episode_key"] = hashlib.sha256(
        json.dumps(episode, sort_keys=True, allow_nan=False).encode("utf-8")
    ).hexdigest()
    return state


def write_outputs(state, destination):
    with open(destination, "a", encoding="utf-8") as output:
        for key in ("scheduler_state", "recovery_required", "reason", "last_ok_utc", "heartbeat_age_minutes"):
            value = state.get(key)
            if isinstance(value, bool):
                value = str(value).lower()
            if value is None:
                value = ""
            value = str(value).replace("\r", " ").replace("\n", " ")
            output.write(f"{key}={value}\n")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--heartbeat", type=Path, default=Path("watchdog/heartbeat.json"))
    parser.add_argument("--out", type=Path, default=Path("watchdog/external-rescue-status.json"))
    parser.add_argument("--threshold-source", choices=("external", "hours"), default="external")
    args = parser.parse_args(argv)
    state = evaluate_heartbeat(args.heartbeat, stale_minutes=os.environ.get("CHATGPT_STALE_MINUTES", "90"),
                               threshold_source=args.threshold_source)
    rendered = json.dumps(state, indent=2, allow_nan=False) + "\n"
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(rendered, encoding="utf-8")
    print(rendered, end="")
    if os.environ.get("GITHUB_OUTPUT"):
        write_outputs(state, os.environ["GITHUB_OUTPUT"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
