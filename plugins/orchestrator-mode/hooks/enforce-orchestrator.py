#!/usr/bin/env python3
"""orchestrator-mode PreToolUse gate. The full contract is in README.md.

With mode on/pi/wf active (see _state.py for where the config comes from):
  1. orchestrator-mode config files are protected from everyone: shell/MCP
     input mentioning them and Write/Edit/MultiEdit/NotebookEdit to them are
     denied. The one exception is the main thread's Write to the project or
     user-wide config, which falls through to the normal permission prompt
     (/mode).
     pi-delegate's model pin (.claude/pi-delegate.local.md) is protected the
     same way.
  2. with "allowed-models" set, every delegation call (Task/Agent, Workflow
     agent() calls, a pi spawn: pi_agent or the legacy pi_task) from ANY
     caller must name an allowed model. In pi mode a pi spawn is instead
     locked to the pin (explicit provider/model must equal it; with no pin,
     none may be given).
  3. subagents (payload has agent_id) otherwise keep full access.
  4. the main thread may write only to .remember/ and its auto-memory dir;
     everything else must be in the mode's tool set or match a core/user-wide/
     project "main-allow" pattern, or it is denied.

Only ever prints a "deny" decision or nothing: "allow" would suppress the
user's permission prompts. An internal error while a mode is active denies
(fail closed); unparseable stdin or config is a no-op (fail open, warned).
Debug: ORCHESTRATOR_DEBUG=true.
"""
import json
import os
import re
import stat
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _state import (CONFIG_NAME, CORE_PATTERNS, MODE_TOOLS, config_dir,  # noqa: E402
                    find_config, get_config, global_config_path, matches,
                    model_allowed, pin_label, pin_path, project_dir,
                    project_slug, read_pin)

GUIDANCE = (" If you are a delegated agent, do not touch orchestrator-mode "
            "config to unblock yourself -- report the blocker to your caller.")
EXIT_HINT = " Run /orchestrator-mode:mode off to exit this mode."
MODE_DENY = {
    "on": "The main agent is read-only: delegate this to a subagent via "
          "Agent/Task (subagents have full access) or the Workflow tool.",
    "wf": "The main agent is read-only and orchestrates via the Workflow tool; "
          "Agent/Task may only spawn the Explore scout.",
    "pi": "The main agent is read-only and cannot spawn subagents: code changes "
          "go through the pi-delegate MCP tools (pi_agent, pi_send_message, "
          "pi_answer, pi_list_agents) or /pi-delegate:delegate <task>.",
}
COMMAND_TOOLS = ("Bash", "Monitor", "PowerShell")
PATH_KEYS = {"Write": "file_path", "Edit": "file_path",
             "MultiEdit": "file_path", "NotebookEdit": "notebook_path"}
# Shell text (Bash/Monitor/PowerShell): any non-space after the dot, so globs,
# brace expansion, quote splitting and $vars can't reach the config or pin.
COMMAND_PROTECTED_RE = re.compile(r"orchestrator-mode\.(?=\S)|pi-delegate\.(?=\S)"
                                  r"|pi-companion\.mjs\W+(write|remove)-config", re.I)
# mcp__ JSON text (prompts, answers): a path-ish start (j/s, l for the pin) or a
# glob/brace/$ char after the dot, so a sentence ending in "orchestrator-mode."
# (followed by a space, a JSON quote or an escaped newline) is not a config file.
MCP_PROTECTED_RE = re.compile(r"orchestrator-mode\.(?:j|s|[*?\[{$])"
                              r"|pi-delegate\.(?:l|[*?\[{$])"
                              r"|pi-companion\.mjs\W+(write|remove)-config", re.I)
PARAPHRASE = (" If you only need to mention one of these files in a prompt or "
              "answer, paraphrase it, e.g. \"the pin file\".")
PIN_NAME = "pi-delegate.local.md"
AGENT_CALL_RE = re.compile(r"(?<![\w$.])agent\s*\(")
MODEL_KEY_RE = re.compile(r"""(?<![\w$])(['"]?)model\1\s*:\s*""")
LITERAL_RE = re.compile(r"""(['"`])([^'"`\\$]*)\1""")
SCRIPT_MAX = 1 << 20


def log_debug(msg):
    if os.environ.get("ORCHESTRATOR_DEBUG") == "true":
        sys.stderr.write("[orchestrator-mode] %s\n" % msg)


def noop(why):
    log_debug("no-op: " + why)
    sys.exit(0)


def deny(reason):
    log_debug("DENY: " + reason)
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse", "permissionDecision": "deny",
        "permissionDecisionReason": reason}}))
    sys.exit(0)


def target_path(tool, tool_input, base):
    path = tool_input.get(PATH_KEYS.get(tool, ""))
    if not isinstance(path, str) or not path:
        return None
    return os.path.normpath(os.path.join(base, path))


def _same(a, b):
    """APFS is case-insensitive, so compare case-folded, raw and resolved."""
    return (a.lower() == b.lower()
            or os.path.realpath(a).lower() == os.path.realpath(b).lower())


def is_protected(path):
    names = [n.lower() for n in (os.path.basename(path),
                                 os.path.basename(os.path.realpath(path)))]
    return (any(n.startswith(".orchestrator-mode.") or n == PIN_NAME for n in names)
            or _same(path, global_config_path()))


def is_toggle_target(path, data):
    found = find_config(data)
    candidates = [os.path.join(project_dir(data), CONFIG_NAME),
                  global_config_path(), pin_path(data)]
    if found and found.endswith(CONFIG_NAME):
        candidates.append(found)
    return any(_same(path, c) for c in candidates)


def _within(target, anchor, sub):
    """target is inside anchor/sub and no path component from anchor down
    to target is a symlink (a symlinked dir would widen the exemption)."""
    root = os.path.normpath(os.path.join(anchor, sub))
    if not target.startswith(root + os.sep):
        return False
    cur = anchor
    for part in os.path.relpath(target, anchor).split(os.sep):
        cur = os.path.join(cur, part)
        if os.path.islink(cur):
            return False
    return True


def is_memory_write(target, data):
    base = project_dir(data)
    slugs = {project_slug(base), project_slug(os.path.realpath(base))}
    return _within(target, base, ".remember") or any(
        _within(target, config_dir(), os.path.join("projects", s, "memory"))
        for s in slugs)


def _mask(script):
    """Two same-length copies of a JS script: comments blanked, and comments
    blanked plus string contents replaced by NUL (so parens, 'agent(' and
    'model:' inside strings don't count). A lexer, not a parser: a model
    passed through a variable or an aliased agent function is denied or
    missed respectively, which is the documented best-effort boundary."""
    clean, masked, quote, i, n = [], [], None, 0, len(script)
    while i < n:
        c = script[i]
        if quote:
            if c == "\\" and i + 1 < n:
                clean.append(script[i:i + 2])
                masked.append("\0\0")
                i += 2
                continue
            clean.append(c)
            masked.append(c if c == quote else "\0")
            quote = None if c == quote else quote
        elif c in "'\"`":
            quote = c
            clean.append(c)
            masked.append(c)
        elif script.startswith("//", i) or script.startswith("/*", i):
            close = "\n" if script[i + 1] == "/" else "*/"
            end = script.find(close, i + 2)
            end = n if end < 0 else end + (len(close) if close == "*/" else 0)
            blank = re.sub(r"[^\n]", " ", script[i:end])
            clean.append(blank)
            masked.append(blank)
            i = end
            continue
        else:
            clean.append(c)
            masked.append(c)
        i += 1
    return "".join(clean), "".join(masked)


def _read_script(tool_input, base):
    if isinstance(tool_input.get("script"), str):
        return tool_input["script"]
    path = tool_input.get("scriptPath")
    if not isinstance(path, str) or not path:
        return None
    path = os.path.join(base, path)
    st = os.stat(path)
    if not stat.S_ISREG(st.st_mode) or st.st_size > SCRIPT_MAX:
        raise ValueError("scriptPath is not a regular file under 1 MiB")
    with open(path) as f:
        return f.read(SCRIPT_MAX)


def check_workflow(tool_input, allowed, base):
    try:
        script = _read_script(tool_input, base)
    except Exception as e:
        deny("orchestrator-mode: can't lint this workflow script against the "
             "model allowlist (%s)." % e + GUIDANCE)
    if script is None:
        deny("orchestrator-mode: a model allowlist is set and a named/saved "
             "workflow can't be checked against it. Pass script or scriptPath."
             + GUIDANCE)
    clean, masked = _mask(script)
    for call in AGENT_CALL_RE.finditer(masked):
        start, depth, i = call.end(), 1, call.end()
        while i < len(masked) and depth:
            depth += {"(": 1, "[": 1, "{": 1, ")": -1, "]": -1, "}": -1}.get(masked[i], 0)
            i += 1
        keys = [k for k in MODEL_KEY_RE.finditer(clean, start, i)
                if masked[k.start()] != "\0"]
        values = [LITERAL_RE.match(clean, k.end()) for k in keys]
        line = script.count("\n", 0, call.start()) + 1
        if not keys or not all(values):
            deny("orchestrator-mode: agent() call on script line %d must set "
                 "model: to a string literal from the allowlist (%s)."
                 % (line, ", ".join(allowed)) + GUIDANCE)
        bad = [v.group(2) for v in values if not model_allowed(v.group(2), allowed)]
        if bad:
            deny("orchestrator-mode: agent() call on script line %d asks for "
                 "model %r, not in the allowlist (%s)."
                 % (line, bad[0], ", ".join(allowed)) + GUIDANCE)


def is_pi_spawn(tool):
    """A pi-delegate call that starts a pi child on a model it may name."""
    return matches(tool, CORE_PATTERNS) and (tool.endswith("__pi_agent")
                                             or tool.endswith("__pi_task"))


def short_name(tool):
    return tool.rsplit("__", 1)[-1]


def check_pi_pin(tool, tool_input, data):
    """pi mode: a pi spawn runs on the project pin. An explicit provider/model
    that differs from it (or any explicit one with no pin) is denied."""
    asked = {k: tool_input[k] for k in ("provider", "model") if tool_input.get(k)}
    if not asked:
        return
    name = short_name(tool)
    pin = read_pin(data)
    if not pin:
        deny("orchestrator-mode (PI): no pi model is pinned for this project, so "
             "%s may not pick one (asked for %s). Omit provider/model to use "
             "pi's default, or run /orchestrator-mode:mode pi to pin one."
             % (name, ", ".join("%s=%s" % kv for kv in sorted(asked.items())))
             + GUIDANCE)
    bad = {k: v for k, v in asked.items() if v != pin.get(k)}
    if bad:
        deny("orchestrator-mode (PI): %s is locked to this project's pinned "
             "model %s; it asked for %s. Omit provider/model (the pin applies), "
             "or change the pin with /orchestrator-mode:mode pi."
             % (name, pin_label(pin), ", ".join("%s=%s" % kv for kv in sorted(bad.items())))
             + GUIDANCE)


def check_models(tool, tool_input, allowed, base):
    if not allowed:
        return
    listed = ", ".join(allowed)
    if tool in ("Task", "Agent"):
        if tool_input.get("subagent_type") == "fork":
            deny("orchestrator-mode: a model allowlist (%s) is set and a fork "
                 "ignores its model field (it always runs on the parent's "
                 "model). Use a non-fork subagent_type with an allowed model."
                 % listed + GUIDANCE)
        model = tool_input.get("model")
        if not model:
            deny("orchestrator-mode: a model allowlist (%s) is set; declare "
                 "model: one of them (omitting it is not allowed)." % listed + GUIDANCE)
        if not model_allowed(model, allowed):
            deny("orchestrator-mode: model %r is not in the allowlist (%s)."
                 % (model, listed) + GUIDANCE)
    elif tool == "Workflow":
        check_workflow(tool_input, allowed, base)
    elif (is_pi_spawn(tool) and tool_input.get("model")
          and not model_allowed(tool_input["model"], allowed)):
        deny("orchestrator-mode: %s model %r is not in the allowlist (%s)."
             % (short_name(tool), tool_input["model"], listed) + GUIDANCE)


def gate(data, cfg):
    tool = data.get("tool_name") or ""
    tool_input = data.get("tool_input")
    tool_input = tool_input if isinstance(tool_input, dict) else {}
    agent_id = data.get("agent_id")
    base = project_dir(data)
    mode = cfg["mode"]

    if tool in COMMAND_TOOLS or tool.startswith("mcp__"):
        if tool in COMMAND_TOOLS:
            text, rx = tool_input.get("command"), COMMAND_PROTECTED_RE
        else:
            text, rx = json.dumps(tool_input, default=str), MCP_PROTECTED_RE
        if rx.search(str(text)):
            deny("orchestrator-mode: its config files and the pi-delegate model "
                 "pin change only through /orchestrator-mode:mode." + PARAPHRASE
                 + GUIDANCE)
    target = target_path(tool, tool_input, base)
    if target and is_protected(target):
        if not agent_id and tool == "Write" and is_toggle_target(target, data):
            noop("main-thread Write to orchestrator-mode config or pi pin -> normal permission prompt")
        deny("orchestrator-mode: its config files and the pi-delegate model pin "
             "change only through /orchestrator-mode:mode on the main thread."
             + GUIDANCE)

    if mode == "pi" and is_pi_spawn(tool):
        check_pi_pin(tool, tool_input, data)  # the pin, not a family list, governs pi
    else:
        check_models(tool, tool_input, cfg["allowed_models"], base)
    if agent_id:
        noop("subagent %s -> full access" % agent_id)

    if target and is_memory_write(target, data):
        noop("write under .remember/ or the auto-memory dir")
    if tool in ("Task", "Agent") and mode == "wf":
        if tool_input.get("subagent_type") == "Explore":
            noop("wf: Explore scout")
        deny("orchestrator-mode (WF): %s with subagent_type=%r is blocked. "
             % (tool, tool_input.get("subagent_type")) + MODE_DENY["wf"]
             + EXIT_HINT + GUIDANCE)
    if tool == "Artifact" and tool_input.get("action") == "delete":
        deny("orchestrator-mode: deleting an artifact is irreversible and is "
             "blocked on the main thread." + EXIT_HINT)
    if tool == "CronCreate" and tool_input.get("durable"):
        deny("orchestrator-mode: durable CronCreate persists beyond this "
             "session and is blocked on the main thread; use durable: false."
             + EXIT_HINT)
    if tool in MODE_TOOLS[mode] or matches(
            tool, CORE_PATTERNS + tuple(cfg["global_allow"]) + tuple(cfg["main_allow"])):
        noop("%s allowed in mode %s" % (tool, mode))
    deny("orchestrator-mode (%s): '%s' is blocked on the main thread. "
         % (mode.upper(), tool) + MODE_DENY[mode] + EXIT_HINT + GUIDANCE)


def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        noop("unparseable stdin -> fail open")
    data = data if isinstance(data, dict) else {}
    cfg = get_config(data)
    if cfg["mode"] == "off":
        noop("mode off")
    try:
        gate(data, cfg)
    except Exception as e:
        deny("orchestrator-mode: internal error (%s: %s), failing closed. "
             "Report this; /orchestrator-mode:mode off disables the lock."
             % (type(e).__name__, e))


if __name__ == "__main__":
    main()
