#!/usr/bin/env python3
"""orchestrator-mode UserPromptSubmit reminder.

Four-state, read from `.orchestrator-mode.state` at the project root via
`_state.get_state()`: "off" | "on" | "pi" | "wf", plus optional options
(e.g. "wf allowed-models=opus,sonnet,haiku").

- OFF: inject nothing.
- ON: inject REMINDER_ON, telling the agent it is read-only and must delegate
  all writes / execution to subagents.
- PI: inject REMINDER_PI, telling the agent it cannot delegate to ANY
  subagent except pi-delegate, and naming /pi-delegate:delegate as the only
  way to get code changes made.
- WF: inject REMINDER_WF, telling the agent it is read-only and must
  orchestrate via the Workflow tool, with Task/Agent restricted to the
  built-in Explore scout.

When the state carries an `allowed-models` option, one extra sentence naming
the model allowlist is appended to whichever mode reminder is active.

On any parse error, inject nothing (fail open).

The reminder MUST be wrapped in hookSpecificOutput.additionalContext -- a flat
"additionalContext" key silently no-ops.

Debug: set ORCHESTRATOR_DEBUG=true for stderr tracing.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _state import get_state  # noqa: E402


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

REMINDER_WF = (
    "ORCHESTRATION MODE is set to WF (workflow) for this project. You are "
    "READ-ONLY on the main thread: only read/search/delegation tools are "
    "allowed here (Read, Grep, Glob, todos, etc). Everything else -- Write, "
    "Edit, NotebookEdit, Bash, and ALL MCP tools -- is blocked on the main "
    "thread. All substantive delegation must go through the Workflow tool "
    "(dynamic multi-agent workflows); Task/Agent is allowed ONLY for the "
    "built-in read-only 'Explore' scout, not for spawning arbitrary "
    "subagents. Setting this mode is your standing opt-in to the Workflow "
    "tool for this project -- use it to orchestrate work. "
    "(Run /orchestrator-mode:mode off to exit this mode.)")


def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        log_debug("could not parse stdin -> inject nothing")
        sys.exit(0)

    mode, options = get_state(data)

    if mode == "off":
        log_debug("mode OFF -> inject nothing")
        sys.exit(0)

    if mode == "on":
        reminder = REMINDER_ON
    elif mode == "wf":
        reminder = REMINDER_WF
    else:  # mode == "pi"
        reminder = REMINDER_PI

    allowed_models = options.get("allowed-models")
    if allowed_models:
        reminder += (
            " Model allowlist for delegated agents: %s. Explicit model "
            "choices in agent()/Task/Agent calls must come from this list; "
            "omitting the model (inheriting the session default) is allowed."
            % ", ".join(allowed_models))

    out = {"hookSpecificOutput": {
        "hookEventName": "UserPromptSubmit",
        "additionalContext": reminder}}
    print(json.dumps(out))
    log_debug("mode=%s -> injected reminder" % mode)
    sys.exit(0)


if __name__ == "__main__":
    main()
