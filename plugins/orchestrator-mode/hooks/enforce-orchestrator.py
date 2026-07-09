#!/usr/bin/env python3
"""orchestrator-mode PreToolUse gate (ALLOWLIST / deny-by-default).

Tri-state, read from `.orchestrator-mode.state` at the project root via
`_state.get_mode()`: "off" | "on" | "pi".

- OFF: silent no-op, normal behavior.
- ON: the MAIN conversation agent is restricted to a small ALLOWLIST of
  read-only / meta / delegation tools. Every other tool -- Write, Edit,
  MultiEdit, NotebookEdit, Bash, ALL `mcp__*`, WebFetch, WebSearch, and any
  unknown/future tool -- is DENIED on the main thread, and the model is told
  to delegate the work to a subagent via the Agent/Task tool. Subagents
  (payload carries `agent_id`) keep FULL access.
- PI: like ON, but there is no general delegation escape hatch -- Task/Agent
  is allowed ONLY when it targets the exact pi-delegate subagent (see
  PI_DELEGATE_SUBAGENT_TYPE below). WebFetch/WebSearch are additionally
  allowlisted (research/browsing isn't a mutation). Everything else that
  would be denied under ON is denied under PI too, with a pi-specific reason.

The matcher in hooks.json is `.*` (regex match-all) so MCP and future write
tools actually reach this hook.

This hook only ever emits non-empty stdout in two cases:
  - an explicit "deny" on the main thread when the mode is ON/PI and the tool
    is not allowlisted for that mode; and
  - an explicit "allow" on the narrow state-file toggle path, so the toggle
    never prompts while locked.
Every other path exits silently (no stdout), which is a true no-op: the normal
permission flow proceeds untouched. Emitting "allow" everywhere would
AUTO-APPROVE and SUPPRESS the user's normal permission prompts -- that is not a
no-op, so we never do it for OFF / subagent / allowlisted / parse-failure.

Decision order (fail-OPEN everywhere EXCEPT the one spot noted below -- a
broken hook must never brick a session, so the safe default is "do nothing /
let normal flow proceed"):
  1. parse stdin                  -> on any error: silent no-op (fail open)
  2. state OFF / missing          -> silent no-op (OFF by default)
  3. agent_id present (subagent)  -> silent no-op (subagents keep full access)
  4. Write to the state file path -> explicit allow (toggle exemption, so the
                                      mode can be turned OFF while locked
                                      without a prompt)
  5. mode == "on"  -> tool in MAIN_ALLOWLIST -> silent no-op; else deny.
  6. mode == "pi"  -> Task/Agent -> allow ONLY subagent_type ==
                       PI_DELEGATE_SUBAGENT_TYPE, else DENY (fail-CLOSED --
                       see the comment on that branch for why this is the one
                       intentional exception to fail-open).
                    -> tool in PI_MODE_ALLOWLIST -> silent no-op; else deny.

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

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _state import get_mode, project_dir, state_file_path  # noqa: E402


# Tools the MAIN agent may still use while orchestrator-mode is ON. Everything
# else (Write, Edit, MultiEdit, NotebookEdit, Bash, all mcp__*, WebFetch,
# WebSearch, and any unknown/future tool) is DENIED on the main thread.
# Skill / SlashCommand are safe because any tool calls they spawn are
# themselves re-checked by this PreToolUse hook.
MAIN_ALLOWLIST = {
    "Read", "Grep", "Glob", "LS",
    "Task", "Agent", "SendMessage",
    "TodoWrite",
    "TaskCreate", "TaskUpdate", "TaskList", "TaskGet", "TaskStop", "TaskOutput",
    "AskUserQuestion",
    "Skill", "SlashCommand",
    "ExitPlanMode", "EnterPlanMode",
    "ToolSearch",
    # Read-only/introspection tools, audited and confirmed non-mutating:
    "Monitor", "CronList", "LSP",
    "ListMcpResourcesTool", "ReadMcpResourceTool", "ReadMcpResourceDirTool",
    "PushNotification", "ScheduleWakeup",
}

# The ONLY subagent_type Task/Agent may target while mode == "pi". Source of
# truth for this string: plugins/pi-delegate/agents/delegate.md (the `name:`
# frontmatter field there, qualified as "<plugin-name>:<agent-name>"). This is
# the sole, one-directional coupling between orchestrator-mode and
# pi-delegate -- no cross-plugin import, just this string constant. If
# pi-delegate's agent is ever renamed, update this constant to match.
PI_DELEGATE_SUBAGENT_TYPE = "pi-delegate:delegate"

# Tools allowed on the main thread while mode == "pi": today's MAIN_ALLOWLIST
# minus Task/Agent (handled separately below, restricted to the pi-delegate
# subagent only), PLUS WebFetch/WebSearch -- the deliberate deviation from
# "on" mode, since research/browsing isn't a mutation and there's no reason to
# force it through pi.
#
# SendMessage is included deliberately: under mode == "pi", Task/Agent is
# already gated (see handle_pi_mode below) to allow spawning ONLY the
# pi-delegate subagent -- no other subagent type can ever be created in a
# pi-mode session. That means any teammate SendMessage could possibly target
# is necessarily a pi-delegate teammate, so allowing SendMessage unconditionally
# here does not reopen the general delegation escape hatch; it only restores
# the ability to check in on / resume the one subagent pi mode already
# sanctions. Without this, a backgrounded pi-delegate dispatch is unreachable
# once launched (TaskOutput/TaskGet fetch results, but SendMessage is what's
# needed to continue/resume a named teammate).
PI_MODE_ALLOWLIST = {
    "Read", "Grep", "Glob", "LS",
    "WebFetch", "WebSearch", "SendMessage",
    "TodoWrite",
    "TaskCreate", "TaskUpdate", "TaskList", "TaskGet", "TaskStop", "TaskOutput",
    "AskUserQuestion",
    "Skill", "SlashCommand",
    "ExitPlanMode", "EnterPlanMode",
    "ToolSearch",
    # Read-only/introspection tools, audited 2026-07-09 and confirmed
    # non-mutating -- none of these write files, execute commands, or spawn
    # subagents, so allowing them doesn't reopen any escape hatch:
    #   Monitor: streams events from a background process (notifications only)
    #   CronList: lists existing scheduled jobs (no create/delete)
    #   LSP: language server queries (hover/definitions/references)
    #   ListMcpResourcesTool/ReadMcpResourceTool/ReadMcpResourceDirTool:
    #     generic MCP resource read infra -- not any one server, so this
    #     isn't a server-specific carve-out (deliberately, per project
    #     preference: no particular MCP server gets special-cased here)
    #   PushNotification: sends a device notification, no repo/state mutation
    #   ScheduleWakeup: schedules a future re-invocation, same category as
    #     the already-allowed TaskCreate/TaskUpdate
    "Monitor", "CronList", "LSP",
    "ListMcpResourcesTool", "ReadMcpResourceTool", "ReadMcpResourceDirTool",
    "PushNotification", "ScheduleWakeup",
}

# TODO(open question): should the `Workflow` tool be deny-listed like Bash /
# mcp__* under mode == "pi"? Workflow can itself spawn subagents (potentially
# including pi-delegate:delegate), so it's a plausible escape hatch around the
# "only pi-delegate:delegate may mutate" guarantee. Left unresolved -- falls
# through to the final `else: deny` branch below for now (i.e. currently
# denied by default, not specially allowed), but flagging here rather than
# silently deciding either way.


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


def norm(path, base):
    """Resolve `path` to an absolute, symlink-free path. Relative paths are
    resolved against `base` (the project dir)."""
    try:
        if not os.path.isabs(path):
            path = os.path.join(base, path)
        return os.path.realpath(path)
    except Exception:
        return path


def handle_on_mode(tool):
    if tool in MAIN_ALLOWLIST:
        noop("allowlisted tool %s -> silent no-op (mode=on)" % tool)
    reason = (
        "orchestrator-mode is ON for this project: the main agent is read-only "
        "(allowlist of read/meta/delegation tools only). '%s' is blocked on the "
        "main thread. Delegate this work to a subagent via the Agent/Task tool "
        "(subagents have full write/execute access). To exit this mode, run "
        "/orchestrator-mode:mode off." % tool)
    log_debug("main thread, mode=on, not allowlisted -> DENY %s" % tool)
    deny(reason)


def handle_pi_mode(tool, tool_input):
    # Task/Agent: allow ONLY the exact pi-delegate subagent. This is a
    # deliberate FAIL-CLOSED exception to the fail-open policy elsewhere in
    # this file -- missing/empty/wrong subagent_type is DENIED, not passed
    # through. Do not "fix" this back to permissive: fail-open here would
    # reopen the general delegation escape hatch that mode=pi exists to close.
    if tool in ("Task", "Agent"):
        subagent_type = (tool_input or {}).get("subagent_type")
        if subagent_type == PI_DELEGATE_SUBAGENT_TYPE:
            noop("mode=pi: %s -> pi-delegate subagent -> silent no-op" % tool)
        reason = (
            "orchestrator-mode is set to PI for this project: the main agent "
            "cannot delegate to any subagent except pi-delegate. '%s' with "
            "subagent_type=%r is blocked. Use /pi-delegate:delegate <task> to "
            "get code changes made. To exit this mode, run "
            "/orchestrator-mode:mode off." % (tool, subagent_type))
        log_debug(
            "mode=pi: %s subagent_type=%r not pi-delegate -> DENY (fail-closed)"
            % (tool, subagent_type))
        deny(reason)

    if tool in PI_MODE_ALLOWLIST:
        noop("allowlisted tool %s -> silent no-op (mode=pi)" % tool)

    reason = (
        "orchestrator-mode is set to PI for this project: the main agent "
        "cannot write, edit, or execute commands directly, and cannot "
        "delegate to any subagent except pi-delegate. '%s' is blocked. The "
        "only way to get code changes made is /pi-delegate:delegate <task>. "
        "To exit this mode, run /orchestrator-mode:mode off." % tool)
    log_debug("mode=pi, not allowlisted -> DENY %s" % tool)
    deny(reason)


def main():
    # 1. parse -- fail OPEN
    try:
        data = json.load(sys.stdin)
    except Exception:
        noop("could not parse stdin -> fail-open (silent)")

    tool = data.get("tool_name", "")
    tool_input = data.get("tool_input", {})
    agent_id = data.get("agent_id")
    log_debug("tool=%s agent_id=%s" % (tool, agent_id))

    mode = get_mode(data)

    # 2. state OFF / missing -> true no-op (normal permission flow proceeds)
    if mode == "off":
        noop("mode OFF -> silent no-op")

    # 3. subagent -> proceeds normally (silent no-op; do NOT auto-approve)
    if agent_id:
        noop("subagent %s -> silent no-op (full access)" % agent_id)

    # 4. toggle exemption: allow Write to the project's own state file so the
    #    /orchestrator-mode:mode command can flip modes while the lock is active.
    if tool == "Write":
        base = project_dir(data)
        target = norm(tool_input.get("file_path", ""), base)
        if target and target == norm(state_file_path(data), base):
            log_debug("Write to state file -> ALLOW (toggle exemption)")
            allow("orchestrator-mode: state-file toggle exempted.")

    # 5/6. branch on mode
    if mode == "on":
        handle_on_mode(tool)
    else:  # mode == "pi"
        handle_pi_mode(tool, tool_input)


if __name__ == "__main__":
    main()
