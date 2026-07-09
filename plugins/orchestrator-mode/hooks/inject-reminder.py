#!/usr/bin/env python3
"""orchestrator-mode UserPromptSubmit reminder.

Tri-state, read from `.orchestrator-mode.state` at the project root via
`_state.get_mode()`: "off" | "on" | "pi".

- OFF: inject nothing.
- ON: inject REMINDER_ON, telling the agent it is read-only and must delegate
  all writes / execution to subagents.
- PI: inject REMINDER_PI, telling the agent it cannot delegate to ANY
  subagent except pi-delegate, and naming /pi-delegate:delegate as the only
  way to get code changes made.

On any parse error, inject nothing (fail open).

The reminder MUST be wrapped in hookSpecificOutput.additionalContext -- a flat
"additionalContext" key silently no-ops.

Debug: set ORCHESTRATOR_DEBUG=true for stderr tracing.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _state import get_mode  # noqa: E402


def log_debug(msg):
    if os.environ.get("ORCHESTRATOR_DEBUG", "false") == "true":
        sys.stderr.write("[orchestrator-mode] %s\n" % msg)


REMINDER_ON = (
    "ORCHESTRATION MODE is ACTIVE for this project. You are READ-ONLY on the "
    "main thread: only read/search/delegation tools are allowed here (Read, "
    "Grep, Glob, Task/Agent, todos). Everything else -- Write, Edit, "
    "NotebookEdit, Bash, and ALL MCP tools -- is blocked on the main thread. "
    "Delegate ALL file edits, file creation, command execution, and MCP calls "
    "to a subagent via the Agent/Task tool -- subagents have full write/execute "
    "access. Use the main thread only to read, plan, and orchestrate. "
    "(Run /orchestrator-mode:mode off to exit this mode.)")

REMINDER_PI = (
    "ORCHESTRATION MODE is set to PI for this project. You are READ-ONLY on "
    "the main thread AND you cannot delegate to any subagent except "
    "pi-delegate: Write, Edit, NotebookEdit, Bash, all MCP tools, and "
    "Task/Agent to any subagent_type other than exactly "
    "'pi-delegate:delegate' are all blocked. Read, Grep, Glob, LS, WebFetch, "
    "WebSearch, and the task-tracking tools (TodoWrite, TaskCreate, etc.) are "
    "still available. The ONLY way to get code changes made is "
    "/pi-delegate:delegate <task>, which forwards the task to the local pi "
    "CLI. pi is often a smaller/local model -- for substantial work, do the "
    "planning yourself (you're read-only, not blind), then break it into "
    "small, independently-verifiable steps and issue "
    "/pi-delegate:delegate once per step, checking each step's result before "
    "dispatching the next, instead of one large multi-step task. "
    "(Run /orchestrator-mode:mode off to exit this mode.)")


def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        log_debug("could not parse stdin -> inject nothing")
        sys.exit(0)

    mode = get_mode(data)

    if mode == "off":
        log_debug("mode OFF -> inject nothing")
        sys.exit(0)

    reminder = REMINDER_ON if mode == "on" else REMINDER_PI

    out = {"hookSpecificOutput": {
        "hookEventName": "UserPromptSubmit",
        "additionalContext": reminder}}
    print(json.dumps(out))
    log_debug("mode=%s -> injected reminder" % mode)
    sys.exit(0)


if __name__ == "__main__":
    main()
