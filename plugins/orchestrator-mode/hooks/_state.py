"""Shared config + tool tables for the orchestrator-mode hooks.

Both hook scripts import this so they can't disagree on what the config says
or what the main thread may use. `python3 _state.py status` prints the
effective config as JSON (used by /orchestrator-mode:mode status).

Config lookup: walk up from CLAUDE_PROJECT_DIR (else the payload cwd); in
each directory `.orchestrator-mode.json` wins over the legacy one-line
`.orchestrator-mode.state`; the nearest directory holding either wins.

    {"mode": "off|on|pi|wf",
     "allowed-models": ["opus", "sonnet"],       # optional
     "main-allow": ["mcp__okto-neuron__*"]}      # optional, exact or trailing *

The user-wide layer `$CLAUDE_CONFIG_DIR/orchestrator-mode.json` (default
~/.claude) contributes only "main-allow"; it is additive to the project's.

A config file that can't be read or parsed, or breaks the schema, prints a
stderr warning and counts as OFF. A broken user-wide file is ignored (fewer
tools allowed, never more). Nothing here raises.
"""
import fnmatch
import json
import os
import re
import shutil
import subprocess
import sys

MODES = ("on", "pi", "wf")
CONFIG_NAME = ".orchestrator-mode.json"
LEGACY_NAME = ".orchestrator-mode.state"
GLOBAL_NAME = "orchestrator-mode.json"
FAMILIES = ("opus", "sonnet", "haiku", "fable")

# Built-in main-thread tools, grouped so the reminder can describe them.
# Every entry is non-mutating for the repo. Monitor is deliberately absent:
# it runs a shell command. Artifact "delete" and durable CronCreate are
# denied separately in the enforcer.
TOOL_GROUPS = {
    "read/search": ("Read", "Grep", "Glob", "LS", "LSP", "ToolSearch",
                    "ListMcpResourcesTool", "ReadMcpResourceTool",
                    "ReadMcpResourceDirTool"),
    "task tracking": ("TodoWrite", "TaskCreate", "TaskUpdate", "TaskList",
                      "TaskGet", "TaskStop", "TaskOutput"),
    "web research": ("WebFetch", "WebSearch"),
    "meta (AskUserQuestion, Skill, SendMessage, plan mode, cron, notifications)": ("AskUserQuestion", "Skill", "SlashCommand", "EnterPlanMode",
             "ExitPlanMode", "SendMessage", "ReportFindings",
             "PushNotification", "ScheduleWakeup", "CronList", "CronCreate",
             "CronDelete"),
    "Artifact (no delete)": ("Artifact",),
}
BASE_TOOLS = frozenset(t for group in TOOL_GROUPS.values() for t in group)
MODE_TOOLS = {
    "on": BASE_TOOLS | {"Task", "Agent", "Workflow"},
    "wf": BASE_TOOLS | {"Workflow"},  # Task/Agent: Explore only, see enforcer
    "pi": BASE_TOOLS,
}
# pi mode can't work without pi-delegate, so its tools are core everywhere.
CORE_PATTERNS = ("mcp__plugin_pi-delegate_pi-delegate__*", "mcp__pi-delegate__*")
# pi-delegate's per-project provider/model pin; in pi mode pi_agent is locked
# to it. Same value rule as pi-companion.mjs isSafeArgValue.
PIN_REL = os.path.join(".claude", "pi-delegate.local.md")
SAFE_ARG_RE = re.compile(r"^(?!-)[A-Za-z0-9._/:@-]+$")
THINKING = ("off", "minimal", "low", "medium", "high", "xhigh", "max")

_SLUG_MAX = 200
OFF = {"mode": "off", "allowed_models": [], "main_allow": [],
       "global_allow": [], "path": None}


def warn(msg):
    sys.stderr.write("[orchestrator-mode] warning: %s\n" % msg)


def project_dir(data):
    return os.environ.get("CLAUDE_PROJECT_DIR") or data.get("cwd") or os.getcwd()


def config_dir():
    return os.path.expanduser(os.environ.get("CLAUDE_CONFIG_DIR") or "~/.claude")


def global_config_path():
    return os.path.join(config_dir(), GLOBAL_NAME)


def project_slug(path):
    """Claude Code's projects/<slug> rule (CLI 2.1.280): every char outside
    [A-Za-z0-9] becomes '-'; past 200 chars, the first 200 plus '-' and
    base36 of the Java-style 32-bit hash over UTF-16 code units."""
    slug = re.sub(r"[^A-Za-z0-9]", "-", path)
    if len(slug) <= _SLUG_MAX:
        return slug
    units = path.encode("utf-16-le")
    h = 0
    for i in range(0, len(units), 2):
        h = (h * 31 + int.from_bytes(units[i:i + 2], "little")) & 0xFFFFFFFF
    h = abs(h - (1 << 32) if h >= (1 << 31) else h)
    digits = ""
    while True:
        h, r = divmod(h, 36)
        digits = "0123456789abcdefghijklmnopqrstuvwxyz"[r] + digits
        if not h:
            return "%s-%s" % (slug[:_SLUG_MAX], digits)


def find_config(data):
    cur = os.path.abspath(project_dir(data))
    while True:
        for name in (CONFIG_NAME, LEGACY_NAME):
            path = os.path.join(cur, name)
            if os.path.isfile(path):
                return path
        parent = os.path.dirname(cur)
        if parent == cur:
            return None
        cur = parent


def matches(name, patterns):
    """Exact name, or prefix when the pattern ends in '*'. Nothing else."""
    return any(name.startswith(p[:-1]) if p.endswith("*") else name == p
               for p in patterns)


def model_allowed(model, allowed):
    """Entry == model, a family name that is a whole token of the model id
    ('sonnet' ~ 'claude-sonnet-5'), or an id prefix ending at a non-alnum
    boundary ('claude-opus-5' ~ 'claude-opus-5-5'). Never a substring."""
    m = str(model).strip().lower()
    tokens = set(re.split(r"[^a-z0-9]+", m))
    for e in allowed:
        if m == e or (e in FAMILIES and e in tokens):
            return True
        if m.startswith(e) and not m[len(e)].isalnum():
            return True
    return False


def _str_list(obj, key, where):
    value = obj.get(key, [])
    if not isinstance(value, list) or not all(isinstance(v, str) and v.strip() for v in value):
        raise ValueError("%s: %r must be a list of non-empty strings" % (where, key))
    return [v.strip() for v in value]


def _parse_json(raw, where):
    obj = json.loads(raw)
    if not isinstance(obj, dict):
        raise ValueError("%s: top level must be an object" % where)
    unknown = set(obj) - {"mode", "allowed-models", "main-allow"}
    if unknown:
        warn("%s: ignoring unknown key(s) %s" % (where, ", ".join(sorted(unknown))))
    mode = obj.get("mode", "off")
    if not isinstance(mode, str) or mode.lower() not in MODES + ("off",):
        raise ValueError("%s: mode %r is not one of on/pi/wf/off" % (where, mode))
    return {"mode": mode.lower(),
            "allowed_models": [m.lower() for m in _str_list(obj, "allowed-models", where)],
            "main_allow": _str_list(obj, "main-allow", where)}


def _parse_legacy(raw, where):
    """`<mode> [allowed-models=a,b ...]`; every token after the '=' is a
    model, split on commas and/or spaces."""
    tokens = raw.split()
    mode = tokens[0].lower() if tokens else "off"
    if mode not in MODES + ("off",):
        raise ValueError("%s: unrecognized mode token %r" % (where, tokens[0]))
    found = re.search(r"allowed-models=(.*)", " ".join(tokens[1:]), re.I | re.S)
    models = re.split(r"[,\s]+", found.group(1).lower()) if found else []
    return {"mode": mode, "allowed_models": [m for m in models if m], "main_allow": []}


def _global_allow():
    path = global_config_path()
    if not os.path.isfile(path):
        return []
    try:
        with open(path) as f:
            obj = json.load(f)
        if not isinstance(obj, dict):
            raise ValueError("top level must be an object")
        return _str_list(obj, "main-allow", path)
    except Exception as e:
        warn("%s ignored: %s" % (path, e))
        return []


def get_config(data):
    try:
        path = find_config(data)
        if not path:
            return dict(OFF)
        with open(path) as f:
            raw = f.read()
        parse = _parse_legacy if path.endswith(LEGACY_NAME) else _parse_json
        cfg = parse(raw, path)
    except Exception as e:
        warn("%s -> treating as OFF" % e)
        return dict(OFF)
    cfg["path"] = path
    cfg["global_allow"] = _global_allow() if cfg["mode"] != "off" else []
    return cfg


def pin_path(data):
    return os.path.join(project_dir(data), PIN_REL)


def read_pin(data):
    """pi-delegate's project pin, parsed the way pi-companion.mjs
    loadProjectConfig does: a '---' block, provider:/model: keys, one pair
    of surrounding quotes stripped, unsafe values dropped. None if unset."""
    try:
        with open(pin_path(data)) as f:
            lines = f.read().split("\n")
    except (OSError, UnicodeDecodeError):
        return None
    if lines[0].strip() != "---":
        return None
    pin = {}
    for line in lines[1:]:
        if line.strip() == "---":
            return pin or None
        key, sep, value = line.partition(":")
        value = re.sub(r"""^(['"])(.*)\1$""", r"\2", value.strip())
        if sep and key.strip() in ("provider", "model") and SAFE_ARG_RE.match(value):
            pin[key.strip()] = value
    return None


def pin_label(pin):
    return "/".join(pin[k] for k in ("provider", "model") if pin.get(k))


def _pi_catalog():
    """{provider: [model, ...]} from `pi --list-models` (same parse as
    pi-companion.mjs runListModels: columns split on 2+ spaces, header row
    skipped). Raises on any failure."""
    exe = shutil.which("pi")
    if not exe:
        raise RuntimeError("pi CLI not found on PATH (npm install -g "
                           "@earendil-works/pi-coding-agent)")
    run = subprocess.run([exe, "--list-models"], capture_output=True,
                         text=True, timeout=30, stdin=subprocess.DEVNULL)
    if run.returncode:
        raise RuntimeError("'pi --list-models' exited %d: %s"
                           % (run.returncode, run.stderr.strip()[-300:]))
    catalog = {}
    for i, line in enumerate(run.stdout.strip().split("\n")):
        parts = re.split(r"\s{2,}", line.strip())
        if (i == 0 and re.match(r"provider\s+model", line.strip(), re.I)) or len(parts) < 2:
            continue
        catalog.setdefault(parts[0], []).append(parts[1])
    if not catalog:
        raise RuntimeError("'pi --list-models' listed no models")
    return catalog


def _pi_settings():
    """Only the model keys of pi's settings.json; nothing else is read out."""
    agent_dir = os.environ.get("PI_CODING_AGENT_DIR") or os.path.expanduser("~/.pi/agent")
    try:
        with open(os.path.join(agent_dir, "settings.json")) as f:
            obj = json.load(f)
    except Exception:
        return [], None
    enabled = obj.get("enabledModels")
    enabled = [e for e in enabled if isinstance(e, str)] if isinstance(enabled, list) else []
    default = {"provider": obj.get("defaultProvider"), "model": obj.get("defaultModel")}
    return enabled, default if all(isinstance(v, str) for v in default.values()) else None


def _resolve_scope(pattern, catalog):
    """pi's enabledModels uses the --models format: exact provider/model,
    bare model, case-insensitive globs, optional :<thinking> suffix. Fuzzy
    matching isn't reproduced; such entries come back unmatched."""
    head, _, tail = pattern.rpartition(":")
    if head and tail.lower() in THINKING:
        pattern = head
    prov, _, model = pattern.partition("/") if "/" in pattern else ("", "", pattern)
    pairs = [(p, m) for p, ms in catalog.items() for m in ms]
    if any(c in pattern for c in "*?["):
        return [(p, m) for p, m in pairs
                if fnmatch.fnmatch(("%s/%s" % (p, m)).lower(), pattern.lower())
                or (not prov and fnmatch.fnmatch(m.lower(), pattern.lower()))]
    for fold in (False, True):
        eq = (lambda a, b: a.lower() == b.lower()) if fold else (lambda a, b: a == b)
        hits = [(p, m) for p, m in pairs
                if eq(m, model) and (not prov or eq(p, prov))]
        if hits:
            return hits
    return []


def pi_models(data):
    out = {"pin_file": pin_path(data), "pin": read_pin(data), "pin_valid": False,
           "default": None, "scoped": [], "unmatched": [], "all": {}, "error": None}
    try:
        catalog = _pi_catalog()
    except Exception as e:
        out["error"] = str(e)
        return out
    enabled, default = _pi_settings()
    known = lambda p: bool(p) and p.get("model") in catalog.get(p.get("provider"), ())
    for pattern in enabled:
        hits = _resolve_scope(pattern, catalog)
        if not hits:
            out["unmatched"].append(pattern)
        for p, m in hits:
            if {"provider": p, "model": m} not in out["scoped"]:
                out["scoped"].append({"provider": p, "model": m})
    out["pin_valid"] = known(out["pin"])
    out["default"] = default if known(default) else None
    out["all"] = catalog
    return out


def effective(cfg, data):
    mode = cfg["mode"]
    return {
        "mode": mode,
        "config": cfg["path"],
        "global_config": global_config_path(),
        "allowed-models": cfg["allowed_models"],
        "core-tools": sorted(MODE_TOOLS.get(mode, ())),
        "core-mcp": list(CORE_PATTERNS),
        "global-main-allow": cfg["global_allow"] or _global_allow(),
        "project-main-allow": cfg["main_allow"],
        "pi-pin": read_pin(data),
    }


if __name__ == "__main__" and sys.argv[1:2] == ["status"]:
    # `status <first word of /mode's arguments>`: the pi catalog is fetched
    # (about 1s) only for `pi`, or `models` while already in pi mode.
    data = {"cwd": os.getcwd()}
    cfg = get_config(data)
    result = effective(cfg, data)
    verb = (sys.argv[2:3] or [""])[0].strip().lower()
    if verb == "pi" or (verb == "models" and cfg["mode"] == "pi"):
        result["pi"] = pi_models(data)
        print(json.dumps(result, separators=(",", ":")))  # ~5 KB catalog
    else:
        print(json.dumps(result, indent=2))
