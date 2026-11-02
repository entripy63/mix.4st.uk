#!/usr/bin/python3
"""Report persistent Certbot faults to the LAN syslog server, not normal renewals."""

import fcntl
import json
import os
from pathlib import Path
import subprocess
import sys
import time


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in ("record", "check"):
        raise SystemExit("Usage: certbot-health record|check")

    directory = Path(os.environ["STATE_DIRECTORY"])
    state_file = directory / "state.json"
    with (directory / "lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        now = time.time()
        if state_file.exists():
            state = json.loads(state_file.read_text())
        else:
            # Allow the scheduler 48 hours to produce its first observed run.
            state = {"last_run": now, "failure_since": None, "alerts": []}

        if sys.argv[1] == "record":
            result = os.environ["SERVICE_RESULT"]
            state["last_run"] = now
            state["last_result"] = result
            if result == "success":
                state["failure_since"] = None
            elif state["failure_since"] is None:
                state["failure_since"] = now
        else:
            faults = {}
            if state["failure_since"] is not None and now - state["failure_since"] >= 24 * 3600:
                faults["renewal-failure"] = (
                    "ALERT: scheduled Certbot renewals have failed without recovery for at least 24 hours; "
                    f"last result={state.get('last_result', 'unknown')}; inspect journalctl -u certbot.service"
                )
            if now - state["last_run"] >= 48 * 3600:
                faults["scheduler-stale"] = (
                    "ALERT: no scheduled Certbot run has completed for at least 48 hours; "
                    "inspect certbot.timer and certbot.service"
                )

            previous = set(state["alerts"])
            # The receiver's /var/log/messages includes user.warning/notice,
            # but excludes daemon messages and general error-severity messages.
            for fault in sorted(set(faults) - previous):
                send("user.warning", faults[fault])
            for fault in sorted(previous - set(faults)):
                send("user.notice", f"RECOVERED: {fault}; scheduled Certbot monitoring is healthy for this condition")
            state["alerts"] = sorted(faults)

        # Both services share the lock; replacement avoids partial JSON on interruption.
        temporary = directory / "state.json.tmp"
        temporary.write_text(json.dumps(state) + "\n")
        temporary.replace(state_file)


def send(priority, message):
    subprocess.run([
        "/usr/bin/logger", "--udp", "--server", "192.168.8.9", "--port", "514",
        "--rfc3164", "--tag", "certbot-health", "--priority", priority, "--", message
    ], check=True, timeout=10)


if __name__ == "__main__":
    main()
