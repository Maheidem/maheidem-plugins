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
import json
import os
import re
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


def effective(cfg):
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
    }


if __name__ == "__main__" and sys.argv[1:] == ["status"]:
    print(json.dumps(effective(get_config({"cwd": os.getcwd()})), indent=2))
