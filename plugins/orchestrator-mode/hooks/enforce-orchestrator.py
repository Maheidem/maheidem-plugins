#!/usr/bin/env python3
"""orchestrator-mode PreToolUse gate (ALLOWLIST / deny-by-default).

When this project's orchestrator-mode is ON, the MAIN conversation agent is
restricted to a small ALLOWLIST of read-only / meta / delegation tools. Every
other tool -- Write, Edit, MultiEdit, NotebookEdit, Bash, ALL `mcp__*`,
WebFetch, WebSearch, and any unknown/future tool -- is DENIED on the main
thread, and the model is told to delegate the work to a subagent via the
Agent/Task tool. Subagents (payload carries `agent_id`) keep FULL access.

The matcher in hooks.json is `.*` (regex match-all) so MCP and future write
tools actually reach this hook.

This hook only ever emits non-empty stdout in two cases:
  - an explicit "deny" on the main thread when the mode is ON and the tool is
    not allowlisted; and
  - an explicit "allow" on the narrow state-file toggle path, so the toggle
    never prompts while locked.
Every other path exits silently (no stdout), which is a true no-op: the normal
permission flow proceeds untouched. Emitting "allow" everywhere would
AUTO-APPROVE and SUPPRESS the user's normal permission prompts -- that is not a
no-op, so we never do it for OFF / subagent / allowlisted / parse-failure.

Decision order (fail-OPEN everywhere -- a broken hook must never brick a
session, so the safe default is "do nothing / let normal flow proceed"):
  1. parse stdin                  -> on any error: silent no-op (fail open)
  2. state OFF / missing          -> silent no-op (OFF by default)
  3. agent_id present (subagent)  -> silent no-op (subagents keep full access)
  4. Write to the state file path -> explicit allow (toggle exemption, so the
                                      mode can be turned OFF while locked
                                      without a prompt)
  5. tool in MAIN_ALLOWLIST       -> silent no-op (permitted read-only/meta tool)
  6. else (main thread, ON)       -> deny with a delegation reason

Toggle exemption is intentionally NARROW: it matches the Write tool whose
resolved `tool_input.file_path` equals this project's
`.orchestrator-mode.state` (at the PROJECT ROOT). It never path-matches Bash
(a shell could defeat that), so it cannot be used to smuggle arbitrary writes.

Debug: set ORCHESTRATOR_DEBUG=true for stderr tracing.
"""
import json
import os
import sys
from typing import NoReturn


# Tools the MAIN agent may still use while orchestrator-mode is ON. Everything
# else (Write, Edit, MultiEdit, NotebookEdit, Bash, all mcp__*, WebFetch,
# WebSearch, and any unknown/future tool) is DENIED on the main thread.
# Skill / SlashCommand are safe because any tool calls they spawn are
# themselves re-checked by this PreToolUse hook.
MAIN_ALLOWLIST = {
    "Read", "Grep", "Glob", "LS",
    "Task", "Agent",
    "TodoWrite",
    "TaskCreate", "TaskUpdate", "TaskList", "TaskGet", "TaskStop", "TaskOutput",
    "AskUserQuestion",
    "Skill", "SlashCommand",
    "ExitPlanMode", "EnterPlanMode",
    "ToolSearch",
}


def log_debug(msg):
    if os.environ.get("ORCHESTRATOR_DEBUG", "false") == "true":
        sys.stderr.write("[orchestrator-mode] %s\n" % msg)


def noop(reason="") -> "NoReturn":
    """True no-op: no stdout, so the normal permission flow proceeds untouched.
    Used for OFF / subagent / allowlisted / parse-failure -- never auto-approve."""
    log_debug("no-op: %s" % reason)
    sys.exit(0)


def allow(reason="") -> "NoReturn":
    """Explicit allow -- auto-approves and suppresses the prompt. Used ONLY for
    the narrow state-file toggle so it never prompts while the lock is active."""
    out = {"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "allow",
        "permissionDecisionReason": reason or "orchestrator-mode: allowed."}}
    print(json.dumps(out))
    sys.exit(0)


def deny(reason) -> "NoReturn":
    out = {"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": reason}}
    print(json.dumps(out))
    sys.exit(0)


def project_dir(data):
    """Project root. Prefer CLAUDE_PROJECT_DIR; fall back to the payload cwd
    (the env var came through empty under headless `-p` in testing)."""
    d = os.environ.get("CLAUDE_PROJECT_DIR") or data.get("cwd") or os.getcwd()
    return d


def state_file_path(data):
    return os.path.join(project_dir(data), ".orchestrator-mode.state")


def norm(path, base):
    """Resolve `path` to an absolute, symlink-free path. Relative paths are
    resolved against `base` (the project dir)."""
    try:
        if not os.path.isabs(path):
            path = os.path.join(base, path)
        return os.path.realpath(path)
    except Exception:
        return path


def is_enabled(data):
    """ON iff the state file exists and its trimmed/lowercased content == 'on'.
    Missing / 'off' / empty / garbage / unreadable -> OFF."""
    try:
        with open(state_file_path(data), "r") as f:
            return f.read().strip().lower() == "on"
    except Exception:
        return False


def main():
    # 1. parse -- fail OPEN
    try:
        data = json.load(sys.stdin)
    except Exception:
        noop("could not parse stdin -> fail-open (silent)")

    tool = data.get("tool_name", "")
    agent_id = data.get("agent_id")
    log_debug("tool=%s agent_id=%s" % (tool, agent_id))

    # 2. state OFF / missing -> true no-op (normal permission flow proceeds)
    if not is_enabled(data):
        noop("mode OFF -> silent no-op")

    # 3. subagent -> proceeds normally (silent no-op; do NOT auto-approve)
    if agent_id:
        noop("subagent %s -> silent no-op (full access)" % agent_id)

    # 4. toggle exemption: allow Write to the project's own state file so the
    #    /orchestrator-mode:mode command can flip OFF while the lock is active.
    if tool == "Write":
        base = project_dir(data)
        target = norm(data.get("tool_input", {}).get("file_path", ""), base)
        if target and target == norm(state_file_path(data), base):
            log_debug("Write to state file -> ALLOW (toggle exemption)")
            allow("orchestrator-mode: state-file toggle exempted.")

    # 5. allowlisted read-only / meta / delegation tool -> silent no-op
    if tool in MAIN_ALLOWLIST:
        noop("allowlisted tool %s -> silent no-op" % tool)

    # 6. main thread, mode ON, not allowlisted -> deny
    reason = (
        "orchestrator-mode is ON for this project: the main agent is read-only "
        "(allowlist of read/meta/delegation tools only). '%s' is blocked on the "
        "main thread. Delegate this work to a subagent via the Agent/Task tool "
        "(subagents have full write/execute access). To exit this mode, run "
        "/orchestrator-mode:mode off." % tool)
    log_debug("main thread, ON, not allowlisted -> DENY %s" % tool)
    deny(reason)


if __name__ == "__main__":
    main()
