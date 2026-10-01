#!/usr/bin/env python3
"""orchestrator-mode UserPromptSubmit reminder.

Injects one short paragraph built from the same tables and config the
enforcer uses (_state.py), so it can't claim a tool is blocked when it isn't.
Mode off, or unparseable stdin -> nothing. The text must go in
hookSpecificOutput.additionalContext; a flat key silently no-ops.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _state import CORE_PATTERNS, TOOL_GROUPS, get_config, pin_label, read_pin  # noqa: E402

DELEGATION = {
    "on": ("Agent/Task, Workflow",
           "Delegate edits, commands and other blocked work to subagents via "
           "Agent/Task (full access) or the Workflow tool."),
    "wf": ("Workflow, Agent/Task for the Explore scout only",
           "Orchestrate substantive work through the Workflow tool (setting "
           "this mode is the user's standing opt-in to it). The Explore scout "
           "is for quick directed look-ups."),
    "pi": ("",
           "You cannot spawn subagents. Code changes go through the "
           "pi-delegate MCP tools (pi_agent starts a pi child, pi_send_message "
           "talks to it, pi_answer answers its questions, pi_stop stops it) or "
           "/pi-delegate:delegate <task>."),
}


def build(cfg, data):
    mode = cfg["mode"]
    tools, how = DELEGATION[mode]
    allowed = ", ".join(list(TOOL_GROUPS) + ([tools] if tools else []))
    mcp = ", ".join(CORE_PATTERNS + tuple(cfg["global_allow"]) + tuple(cfg["main_allow"]))
    text = (
        "ORCHESTRATION MODE %s is active: the main thread is READ-ONLY. "
        "Allowed here: %s. Also allowed by pattern: %s. Writes are allowed "
        "only under .remember/ and this project's auto-memory dir. Everything "
        "else (Bash, Monitor, Write/Edit, any other MCP tool) is blocked here. "
        "%s" % (mode.upper(), allowed, mcp, how))
    if mode == "pi":
        pin = read_pin(data)
        text += (" pi_agent runs on this project's pinned model %s: don't pass "
                 "provider/model (a different one is denied)." % pin_label(pin)
                 if pin else
                 " No pi model is pinned: pi_agent uses pi's default and may not "
                 "set provider/model (/orchestrator-mode:mode pi pins one).")
    elif cfg["allowed_models"]:
        text += (" Model allowlist: %s. Every Agent/Task call and workflow "
                 "agent() call must declare one (omitting it is denied), fork "
                 "subagents are denied, and an explicit pi_agent model must be "
                 "on the list." % ", ".join(cfg["allowed_models"]))
    return text + " (Exit: /orchestrator-mode:mode off.)"


def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        sys.exit(0)
    data = data if isinstance(data, dict) else {}
    cfg = get_config(data)
    if cfg["mode"] == "off":
        sys.exit(0)
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "UserPromptSubmit",
        "additionalContext": build(cfg, data)}}))


if __name__ == "__main__":
    main()
