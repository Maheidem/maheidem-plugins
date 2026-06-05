#!/usr/bin/env python3
"""orchestrator-mode UserPromptSubmit reminder.

When this project's orchestrator-mode is ON, inject a concise reminder into the
main thread telling the agent it is read-only and must delegate all writes /
execution to subagents. When OFF (or on any error), inject nothing.

The reminder MUST be wrapped in hookSpecificOutput.additionalContext -- a flat
"additionalContext" key silently no-ops.

Debug: set ORCHESTRATOR_DEBUG=true for stderr tracing.
"""
import json
import os
import sys


def log_debug(msg):
    if os.environ.get("ORCHESTRATOR_DEBUG", "false") == "true":
        sys.stderr.write("[orchestrator-mode] %s\n" % msg)


def project_dir(data):
    return os.environ.get("CLAUDE_PROJECT_DIR") or data.get("cwd") or os.getcwd()


def is_enabled(data):
    try:
        path = os.path.join(project_dir(data), ".orchestrator-mode.state")
        with open(path, "r") as f:
            return f.read().strip().lower() == "on"
    except Exception:
        return False


REMINDER = (
    "ORCHESTRATION MODE is ACTIVE for this project. You are READ-ONLY on the "
    "main thread: only read/search/delegation tools are allowed here (Read, "
    "Grep, Glob, Task/Agent, todos). Everything else -- Write, Edit, "
    "NotebookEdit, Bash, and ALL MCP tools -- is blocked on the main thread. "
    "Delegate ALL file edits, file creation, command execution, and MCP calls "
    "to a subagent via the Agent/Task tool -- subagents have full write/execute "
    "access. Use the main thread only to read, plan, and orchestrate. "
    "(Run /orchestrator-mode:mode off to exit this mode.)")


def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        log_debug("could not parse stdin -> inject nothing")
        sys.exit(0)

    if not is_enabled(data):
        log_debug("mode OFF -> inject nothing")
        sys.exit(0)

    out = {"hookSpecificOutput": {
        "hookEventName": "UserPromptSubmit",
        "additionalContext": REMINDER}}
    print(json.dumps(out))
    log_debug("mode ON -> injected reminder")
    sys.exit(0)


if __name__ == "__main__":
    main()
