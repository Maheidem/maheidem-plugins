"""Shared state-file helper for orchestrator-mode hooks.

Both enforce-orchestrator.py and inject-reminder.py import this (same
directory, via sys.path) so the tri-state parsing can't drift out of sync
between the two hook scripts.

State lives in a plain-text file at `<project>/.orchestrator-mode.state` (at
the PROJECT ROOT, not under `.claude/`). The file is a single line: a MODE
token optionally followed by whitespace-separated `key=value` options, e.g.:

    wf allowed-models=opus,sonnet,haiku

The MODE is the FIRST whitespace-separated token (trimmed, lowercased) --
options never affect mode detection. Valid modes: "on", "pi", "wf". Anything
else -- missing file, empty, "off", garbage, unreadable -- is OFF.

Recognized options (parsed by get_state()):
  - allowed-models: comma-separated list of model names, normalized to
    lowercase. Empty value or absent key means NO restriction.

Unparseable options fail open (they are ignored, never raised on). Fail-open
everywhere: parsing never raises.
"""
import os


def project_dir(data):
    """Project root. Prefer CLAUDE_PROJECT_DIR; fall back to the payload cwd
    (the env var came through empty under headless `-p` in testing)."""
    return os.environ.get("CLAUDE_PROJECT_DIR") or data.get("cwd") or os.getcwd()


def state_file_path(data):
    return os.path.join(project_dir(data), ".orchestrator-mode.state")


def _parse(raw):
    """Parse raw state-file text -> (mode, options_dict). Never raises.

    Mode is the first whitespace-separated token, lowercased; unrecognized ->
    "off". Remaining tokens of the form key=value become options (keys and
    values lowercased); tokens without "=" or otherwise malformed are ignored
    (fail open). The "allowed-models" value is split on commas into a list of
    non-empty lowercase names; an empty list means no restriction and is
    dropped from the dict entirely so absent-key == no-restriction holds.
    """
    try:
        tokens = raw.strip().split()
        if not tokens:
            return "off", {}
        mode = tokens[0].lower()
        if mode not in ("on", "pi", "wf"):
            return "off", {}
        options = {}
        for token in tokens[1:]:
            if "=" not in token:
                continue  # unparseable option -> ignore (fail open)
            key, _, value = token.partition("=")
            key = key.strip().lower()
            if not key:
                continue
            if key == "allowed-models":
                models = [m.strip().lower() for m in value.split(",")]
                models = [m for m in models if m]
                if models:
                    options[key] = models
                # empty value -> no restriction -> leave key absent
            else:
                options[key] = value.strip().lower()
        return mode, options
    except Exception:
        return "off", {}


def get_state(data):
    """Returns (mode, options_dict).

    mode is "off" | "on" | "pi" | "wf"; options_dict maps option keys to
    parsed values ("allowed-models" -> list of lowercase model names).
    Missing/unreadable/unrecognized -> ("off", {}) (fail open -- a broken or
    corrupted state file must never brick a session by denying tools; it just
    falls back to normal behavior)."""
    try:
        with open(state_file_path(data), "r") as f:
            raw = f.read()
    except Exception:
        return "off", {}
    return _parse(raw)


def get_mode(data):
    """Backward-compatible helper: returns just the mode string
    ("off" | "on" | "pi" | "wf"). See get_state() for options."""
    return get_state(data)[0]
