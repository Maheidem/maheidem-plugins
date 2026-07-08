"""Shared state-file helper for orchestrator-mode hooks.

Both enforce-orchestrator.py and inject-reminder.py import this (same
directory, via sys.path) so the tri-state parsing can't drift out of sync
between the two hook scripts.

State lives in a plain-text file at `<project>/.orchestrator-mode.state` (at
the PROJECT ROOT, not under `.claude/`). Valid contents (trimmed,
lowercased): "on", "pi". Anything else -- missing file, empty, "off",
garbage, unreadable -- is OFF. Fail-open: parsing never raises.
"""
import os


def project_dir(data):
    """Project root. Prefer CLAUDE_PROJECT_DIR; fall back to the payload cwd
    (the env var came through empty under headless `-p` in testing)."""
    return os.environ.get("CLAUDE_PROJECT_DIR") or data.get("cwd") or os.getcwd()


def state_file_path(data):
    return os.path.join(project_dir(data), ".orchestrator-mode.state")


def get_mode(data):
    """Returns "off" | "on" | "pi". Missing/unreadable/unrecognized -> "off"
    (fail open -- a broken or corrupted state file must never brick a
    session by denying tools; it just falls back to normal behavior)."""
    try:
        with open(state_file_path(data), "r") as f:
            value = f.read().strip().lower()
    except Exception:
        return "off"
    if value in ("on", "pi"):
        return value
    return "off"
