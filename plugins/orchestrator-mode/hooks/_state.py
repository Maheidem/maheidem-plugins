"""Shared state-file helper for orchestrator-mode hooks.

Both enforce-orchestrator.py and inject-reminder.py import this (same
directory, via sys.path) so the four-state parsing can't drift out of sync
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
import sys


def project_dir(data):
    """Project root. Prefer CLAUDE_PROJECT_DIR; fall back to the payload cwd
    (the env var came through empty under headless `-p` in testing)."""
    return os.environ.get("CLAUDE_PROJECT_DIR") or data.get("cwd") or os.getcwd()


def _discover_state_dir(start):
    """Walk up from `start` looking for a directory containing
    .orchestrator-mode.state. Stops at filesystem root; falls back to `start`
    if never found. Never raises."""
    try:
        cur = os.path.realpath(start)
        while True:
            if os.path.isfile(os.path.join(cur, ".orchestrator-mode.state")):
                return cur
            parent = os.path.dirname(cur)
            if parent == cur:
                return start
            cur = parent
    except Exception:
        return start


def state_file_path(data):
    """Resolve the state-file path. When CLAUDE_PROJECT_DIR is set (the
    normal, non-headless case), this is just `<project_dir>/.orchestrator-mode.state`
    -- unchanged behavior. When it is unset (T6: headless cwd robustness), walk
    up from the payload cwd looking for the nearest ancestor that actually
    contains a state file, falling back to cwd itself if none is found. Note:
    project_dir() (used by norm()'s relative-path base in
    enforce-orchestrator.py) is NOT changed by this -- it still just returns
    cwd verbatim when CLAUDE_PROJECT_DIR is unset. That is an intentional,
    documented asymmetry: in a nested cwd with no env var set, the discovered
    state file may resolve at an ancestor root while relative tool-input paths
    still resolve against cwd."""
    if os.environ.get("CLAUDE_PROJECT_DIR"):
        return os.path.join(project_dir(data), ".orchestrator-mode.state")
    base = data.get("cwd") or os.getcwd()
    return os.path.join(_discover_state_dir(base), ".orchestrator-mode.state")


def _parse(raw):
    """Parse raw state-file text -> (mode, options_dict). Never raises.

    Mode is the first whitespace-separated token, lowercased; unrecognized ->
    "off" (with a stderr warning, unless the file was empty or literally
    "off" -- see below). Remaining tokens of the form key=value become options
    (keys and values lowercased); tokens without "=" or otherwise malformed
    are ignored (fail open). The "allowed-models" value is split on commas
    into a list of non-empty lowercase names; an empty list means no
    restriction and is dropped from the dict entirely so absent-key ==
    no-restriction holds. If a bare (non key=value) token appears AFTER
    allowed-models has been seen (e.g. a stray continuation from
    "allowed-models=opus, haiku" with a space), the entire allowed-models
    option is discarded and a warning is printed -- fail-open, never stricter
    than intended.
    """
    try:
        tokens = raw.strip().split()
        if not tokens:
            return "off", {}
        mode = tokens[0].lower()
        if mode not in ("on", "pi", "wf", "off"):
            sys.stderr.write(
                "[orchestrator-mode] warning: unrecognized state-file mode "
                "token %r -> treating as OFF (state file exists but its "
                "first token is not on/pi/wf/off)\n" % tokens[0])
            return "off", {}
        if mode == "off":
            return "off", {}
        options = {}
        saw_allowed_models = False
        malformed_allowed_models = False
        for token in tokens[1:]:
            if "=" not in token:
                if saw_allowed_models:
                    malformed_allowed_models = True
                continue  # unparseable option -> ignore (fail open)
            key, _, value = token.partition("=")
            key = key.strip().lower()
            if not key:
                continue
            if key == "allowed-models":
                saw_allowed_models = True
                models = [m.strip().lower() for m in value.split(",")]
                models = [m for m in models if m]
                if models:
                    options[key] = models
                # empty value -> no restriction -> leave key absent
            else:
                options[key] = value.strip().lower()
        if malformed_allowed_models and "allowed-models" in options:
            sys.stderr.write(
                "[orchestrator-mode] warning: malformed allowed-models option "
                "(stray token after mode line) -> discarding entire "
                "allowed-models restriction, fail-open\n")
            del options["allowed-models"]
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
