#!/usr/bin/env python3
import json
import os
from datetime import datetime, timezone
from pathlib import Path

HEARTBEAT = Path("watchdog/heartbeat.json")
OUT = Path("watchdog/external-rescue-status.json")
DEFAULT_STALE_MINUTES = int(os.environ.get("CHATGPT_STALE_MINUTES", "90"))

now = datetime.now(timezone.utc)
state = {
    "checked_at_utc": now.isoformat().replace("+00:00", "Z"),
    "stale_threshold_minutes": DEFAULT_STALE_MINUTES,
    "heartbeat_path": str(HEARTBEAT),
    "scheduler_state": "unknown",
    "heartbeat_age_minutes": None,
    "last_ok_utc": None,
    "reason": None,
    "recovery_required": True,
}

try:
    data = json.loads(HEARTBEAT.read_text(encoding="utf-8"))
    stamp = data["last_ok_utc"]
    last = datetime.fromisoformat(stamp.replace("Z", "+00:00")).astimezone(timezone.utc)
    age = (now - last).total_seconds() / 60.0
    threshold = int(data.get("external_stale_after_minutes", DEFAULT_STALE_MINUTES))
    state["stale_threshold_minutes"] = threshold
    state["last_ok_utc"] = stamp
    state["heartbeat_age_minutes"] = round(age, 2)
    if age <= threshold:
        state["scheduler_state"] = "healthy"
        state["recovery_required"] = False
        state["reason"] = f"heartbeat age {age:.2f}m <= {threshold}m"
    else:
        state["scheduler_state"] = "stale"
        state["reason"] = f"heartbeat age {age:.2f}m > {threshold}m"
except Exception as exc:
    state["scheduler_state"] = "broken"
    state["reason"] = f"{type(exc).__name__}: {exc}"

OUT.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
print(json.dumps(state, indent=2))

gh_out = os.environ.get("GITHUB_OUTPUT")
if gh_out:
    with open(gh_out, "a", encoding="utf-8") as f:
        for key in ("scheduler_state", "recovery_required", "reason", "last_ok_utc", "heartbeat_age_minutes"):
            value = state.get(key)
            if isinstance(value, bool):
                value = str(value).lower()
            if value is None:
                value = ""
            f.write(f"{key}={value}\n")
