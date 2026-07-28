#!/usr/bin/env python3
"""orchestrator-mode PreToolUse gate (ALLOWLIST / deny-by-default).

Four-state, read from `.orchestrator-mode.state` at the project root via
`_state.get_state()`: "off" | "on" | "pi" | "wf", plus optional key=value
options after the mode token (e.g. "wf allowed-models=opus,sonnet,haiku").

- OFF: silent no-op, normal behavior.
- ON: the MAIN conversation agent is restricted to a small ALLOWLIST of
  read-only / meta / delegation / research tools (see MAIN_ALLOWLIST, incl.
  Workflow, WebFetch, WebSearch, ReportFindings, Artifact as of 0.2.3). Every
  other tool -- Write, Edit, MultiEdit, NotebookEdit, Bash, ALL `mcp__*`, and
  any unknown/future tool -- is DENIED on the main thread, and the model is
  told to delegate the work to a subagent via the Agent/Task tool. Subagents
  (payload carries `agent_id`) keep FULL access.
- PI: like ON, but there is no general delegation escape hatch -- Task/Agent
  is allowed ONLY when it targets the exact pi-delegate subagent (see
  PI_DELEGATE_SUBAGENT_TYPE below). Workflow is NOT allowlisted under PI (it
  can itself spawn arbitrary subagents, which would bypass the pi-delegate-
  only restriction). Everything else that would be denied under ON is denied
  under PI too, with a pi-specific reason.
- WF: like ON, but the general Task/Agent delegation escape hatch is closed
  down to just the built-in read-only `Explore` scout (see
  WF_EXPLORE_SUBAGENT_TYPE below) -- all other substantive delegation must go
  through the `Workflow` tool (dynamic multi-agent workflows), which stays
  allowlisted (see WF_MODE_ALLOWLIST). Setting mode to `wf` is the user's
  standing opt-in to the Workflow tool for this project. Everything else that
  would be denied under ON is denied under WF too, with a wf-specific reason.

The matcher in hooks.json is `.*` (regex match-all) so MCP and future write
tools actually reach this hook.

This hook only ever emits non-empty stdout for explicit "deny" decisions:
  - an explicit "deny" when ANY Bash/mcp__* call's tool_input mentions the
    state-file path, regardless of agent_id (D2, see step 3 below);
  - an explicit "deny" when a SUBAGENT targets the state file with any
    path-addressable mutation tool (Write/Edit/MultiEdit/NotebookEdit --
    subagents may not toggle the mode; see step 4 below); and
  - an explicit "deny" on the main thread when the mode is ON/PI/WF and the
    tool is not allowlisted for that mode.
Every other path exits silently (no stdout), which is a true no-op: the normal
permission flow proceeds untouched -- INCLUDING the main-thread toggle Write to
the state file itself (D1: it now falls through to the normal permission
prompt instead of being auto-allowed). Emitting "allow" would AUTO-APPROVE and
SUPPRESS the user's normal permission prompts, so this hook never does that
anywhere.

Decision order (fail-OPEN everywhere EXCEPT the two fail-closed spots noted
below -- a broken hook must never brick a session, so the safe default is "do
nothing / let normal flow proceed"):
  1. parse stdin                  -> on any error: silent no-op (fail open)
  2. state OFF / missing          -> silent no-op (OFF by default)
  3. [D2] ANY Bash call, or ANY mcp__* tool, whose tool_input mentions the
                                      state-file token -> DENY, unconditionally
                                      (regardless of agent_id or mode). Runs
                                      BEFORE the subagent bypass so it applies
                                      to main thread AND subagents alike.
                                      Best-effort substring lint (same standard
                                      as MODEL_OPTION_RE) -- can be evaded by
                                      obfuscating the path string, but raises
                                      the bar.
  4. subagent Write/Edit/MultiEdit/NotebookEdit
     targeting the state file      -> DENY (subagents may not toggle the mode;
                                      a blocked delegated agent once silently
                                      flipped the state to "off" through the
                                      old toggle exemption, so this is checked
                                      BEFORE the subagent bypass in step 5)
  5. agent_id present (subagent)  -> silent no-op (subagents keep full access)
  6. [D1] Write to the state file path (main thread) -> silent no-op (falls
                                      through to the NORMAL permission prompt;
                                      no longer auto-allowed -- the user
                                      approves the toggle like any other Write)
  7. mode == "on"  -> tool in MAIN_ALLOWLIST -> silent no-op; else deny.
  8. mode == "wf"  -> Task/Agent -> allow ONLY subagent_type ==
                       WF_EXPLORE_SUBAGENT_TYPE, else DENY (fail-CLOSED, same
                       rationale as the pi branch below).
                    -> tool in WF_MODE_ALLOWLIST -> silent no-op; else deny.
  9. mode == "pi"  -> Task/Agent -> allow ONLY subagent_type ==
                       PI_DELEGATE_SUBAGENT_TYPE, else DENY (fail-CLOSED --
                       see the comment on that branch for why this is the one
                       intentional exception to fail-open).
                    -> tool in PI_MODE_ALLOWLIST -> silent no-op; else deny.

MODEL ALLOWLIST (composes with steps 7/8/9): when the active mode carries an
`allowed-models=<m1,m2,...>` option, matching is case-insensitive substring/
family match (D3: allowlist entry "sonnet" permits any requested model id
containing "sonnet", e.g. "claude-sonnet-5" -- see _model_allowed()), and an
extra check runs on delegation calls that the mode gating would otherwise
ALLOW:
  - Task/Agent (any subagent_type under `on`; Explore under `wf`; pi-delegate
    under `pi`): (D4) an OMITTED `tool_input.model` is now DENIED, not
    allowed -- the allowlist being active means every delegated call MUST
    declare a model from the list. An explicit model not matching any
    allowlist entry -> DENY.
  - Workflow (under `on` and `wf`; denied outright under `pi` anyway): (D4)
    if the script contains any `agent(` calls, the number of `model:` option
    occurrences must be >= the number of `agent(` calls, else DENY (best-
    effort presence lint -- comments containing "model:" can cause false
    negatives, never false positives on scripts with zero `agent(` calls).
    The script text (`tool_input.script`, or the file at
    `tool_input.scriptPath`, unreadable -> fail open) is then also
    regex-linted for quoted `model: "..."` option values; any value NOT
    matching the allowlist (family match) -> DENY. Best-effort lint,
    consistent with the cooperative-guardrail security model.
A malformed `allowed-models` option in the state file (e.g. a stray bare
token from "opus, haiku" with a space) discards the ENTIRE option (no
restriction applies) and prints a stderr warning -- see _state.py's _parse().
No allowed-models option -> behavior identical to a plain mode token (omitted
model is allowed, as before).

DECISION NOTE (D4a x wf/Explore): under `wf` mode with an allowlist active,
the built-in `Explore` scout spawn is ALSO subject to check_task_model (D4) --
i.e. it must declare an allowlisted model too, or it is denied. This was a
deliberate choice (option (a), face-value spec) over exempting Explore
(option (b)); flagged here as a decision point, not a silent side effect.

Toggle write (D1) is intentionally NARROW: it matches ONLY the Write tool
(the /orchestrator-mode:mode command flips state via Write) whose resolved
`tool_input.file_path` equals this project's `.orchestrator-mode.state` (at
the PROJECT ROOT), and only lets it fall through to the *normal* permission
prompt -- it is not auto-approved. It never path-matches Bash (a shell could
defeat that; also now separately denied outright by D2's state-file scan), so
it cannot be used to smuggle arbitrary writes. It is also MAIN-THREAD-ONLY:
subagents hit the deny in step 4 (which covers Write/Edit/MultiEdit/
NotebookEdit, broader than this Write-only fallthrough) before step 6 is ever
reached.

Every deny reason ends with explicit guidance telling a delegated agent NOT
to modify .orchestrator-mode.state to unblock itself (see DELEGATE_GUIDANCE
below) -- the belt to step 3's suspenders.

Debug: set ORCHESTRATOR_DEBUG=true for stderr tracing.
"""
import json
import os
import re
import sys
from typing import NoReturn

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _state import get_state, project_dir, state_file_path  # noqa: E402


# Appended to EVERY mode-branch deny reason. Background: a blocked delegated
# agent once silently flipped the state file to "off" via the toggle exemption
# to unblock itself. This guidance is the soft half of the fix; the hard half
# is the subagent state-file Write deny in main() (step 3 in the docstring).
DELEGATE_GUIDANCE = (
    " If you are a delegated agent seeing this message, do NOT modify "
    ".orchestrator-mode.state to unblock yourself -- report the blocker to "
    "your caller instead.")


# Tools the MAIN agent may still use while orchestrator-mode is ON. Everything
# else (Write, Edit, MultiEdit, NotebookEdit, Bash, all mcp__*, and any
# unknown/future tool) is DENIED on the main thread.
# Skill / SlashCommand are safe because any tool calls they spawn are
# themselves re-checked by this PreToolUse hook.
MAIN_ALLOWLIST = {
    "Read", "Grep", "Glob", "LS",
    "Task", "Agent", "SendMessage",
    # Workflow: deterministic multi-agent orchestration -- pure delegation,
    # same category as Task/Agent. NOT added to PI_MODE_ALLOWLIST: it can
    # itself spawn arbitrary subagents, which would bypass the pi-delegate-
    # only restriction mode=pi exists to enforce.
    "Workflow",
    "TodoWrite",
    "TaskCreate", "TaskUpdate", "TaskList", "TaskGet", "TaskStop", "TaskOutput",
    "AskUserQuestion",
    "Skill", "SlashCommand",
    "ExitPlanMode", "EnterPlanMode",
    "ToolSearch",
    # Research isn't a mutation -- parity with the WebFetch/WebSearch carve-out
    # already granted under mode=pi (see PI_MODE_ALLOWLIST below).
    "WebFetch", "WebSearch",
    # ReportFindings: typed code-review output, non-mutating.
    "ReportFindings",
    # Artifact: publishes deliverables; default-private (the user opts in to
    # sharing afterward), so it's not a repo/state mutation in the sense the
    # allowlist otherwise guards against.
    "Artifact",
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

# The ONLY subagent_type Task/Agent may target while mode == "wf". This is the
# built-in, read-only "scout" agent type shipped with Claude Code itself (not
# a plugin) -- safe to spawn directly under WF because it cannot write/edit
# any more than the main thread already can't.
WF_EXPLORE_SUBAGENT_TYPE = "Explore"

# Tools allowed on the main thread while mode == "pi": MAIN_ALLOWLIST minus
# Task/Agent (handled separately below, restricted to the pi-delegate
# subagent only) and minus Workflow/ReportFindings/Artifact (Workflow is
# deliberately excluded -- see the RESOLVED note below; the other two simply
# predate this list). WebFetch/WebSearch appear in BOTH lists: they were once
# a pi-only carve-out, but MAIN_ALLOWLIST gained them in 0.2.3 for parity, so
# no deviation between the modes remains on research tools.
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

# RESOLVED (was an open question as of 0.2.2): `Workflow` was added to
# MAIN_ALLOWLIST in 0.2.3 (pure delegation, same category as Task/Agent) but
# deliberately NOT added to PI_MODE_ALLOWLIST. Workflow can itself spawn
# arbitrary subagents (potentially bypassing the pi-delegate-only
# restriction), so under mode == "pi" it still falls through to the final
# `else: deny` branch below -- denied by default, not specially allowed.

# Tools allowed on the main thread while mode == "wf": today's MAIN_ALLOWLIST
# minus Task/Agent (handled separately below, restricted to the built-in
# Explore scout only). Unlike PI_MODE_ALLOWLIST, `Workflow` IS included here
# -- setting mode to "wf" is the user's standing opt-in to the Workflow tool
# for this project, and Workflow is how all substantive delegation is meant
# to happen under this mode. `ReportFindings` and `Artifact` are also kept
# (both are already in MAIN_ALLOWLIST and neither is a delegation escape
# hatch), unlike PI_MODE_ALLOWLIST which predates them.
WF_MODE_ALLOWLIST = {
    "Read", "Grep", "Glob", "LS",
    "SendMessage",
    "Workflow",
    "TodoWrite",
    "TaskCreate", "TaskUpdate", "TaskList", "TaskGet", "TaskStop", "TaskOutput",
    "AskUserQuestion",
    "Skill", "SlashCommand",
    "ExitPlanMode", "EnterPlanMode",
    "ToolSearch",
    "WebFetch", "WebSearch",
    "ReportFindings",
    "Artifact",
    "Monitor", "CronList", "LSP",
    "ListMcpResourcesTool", "ReadMcpResourceTool", "ReadMcpResourceDirTool",
    "PushNotification", "ScheduleWakeup",
}


def log_debug(msg):
    if os.environ.get("ORCHESTRATOR_DEBUG", "false") == "true":
        sys.stderr.write("[orchestrator-mode] %s\n" % msg)


def noop(reason="") -> "NoReturn":
    """True no-op: no stdout, so the normal permission flow proceeds untouched.
    Used for OFF / subagent / allowlisted / parse-failure -- never auto-approve."""
    log_debug("no-op: %s" % reason)
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


# Matches quoted model option values in Workflow script text, e.g.
# `model: "opus"` / `model:'sonnet'` / `"model": "haiku"`. Best-effort by
# design: this is a text lint, not a parser -- a computed/obfuscated model
# value (string concat, variable, etc.) will slip through. That is consistent
# with the plugin's cooperative-guardrail security model (see README): the
# goal is to catch a well-behaved agent's accidental off-list model choice,
# not to contain an adversarial one.
MODEL_OPTION_RE = re.compile(r"""\bmodel\b['"]?\s*:\s*(?:"([^"]*)"|'([^']*)')""")

# Presence-only check for D4b: does a `model:` option appear at all (not
# necessarily quoted) -- used to count agent() calls that declare SOME model
# vs. omit it entirely. Best-effort, unquoted-tolerant; comments containing
# "model:" can cause false negatives (under-denial), never false positives on
# scripts with zero agent( calls (guarded separately).
MODEL_PRESENT_RE = re.compile(r"""\bmodel\b['"]?\s*:""")

# Token identifying the orchestrator-mode state file, used by D2's Bash/mcp__*
# scan below.
STATE_FILE_TOKEN = ".orchestrator-mode.state"


def _model_allowed(model, allowed_models):
    """Case-insensitive substring/family match (D3): allowlist entry 'sonnet'
    permits any requested model id containing 'sonnet'. Asymmetric by design
    (allowlist entry 'claude-sonnet-5' would NOT match a request of
    'sonnet')."""
    m = str(model).strip().lower()
    return any(entry in m for entry in allowed_models)


def _tool_input_mentions_state_file(tool_input):
    """Best-effort substring lint (D2): does the serialized tool_input mention
    the state-file token anywhere? Used for mcp__* tools where the path may
    live under any key."""
    try:
        return STATE_FILE_TOKEN in json.dumps(tool_input, default=str)
    except Exception:
        return False


def check_task_model(tool_input, allowed_models):
    """Model-allowlist check for a Task/Agent call the mode gating would
    otherwise allow. (D4) When an allowlist is active, an OMITTED model is now
    DENIED, not allowed -- every delegated call must declare a model from the
    list. An explicit model not matching the allowlist (family match, D3) ->
    DENY."""
    if not allowed_models:
        return
    model = (tool_input or {}).get("model")
    if not model:
        deny(
            "orchestrator-mode: this project has a model allowlist (%s) "
            "active. Declare model: one of %s -- omitting the model field is "
            "not allowed while an allowlist is set."
            % (", ".join(allowed_models), ", ".join(allowed_models))
            + DELEGATE_GUIDANCE)
    if not _model_allowed(model, allowed_models):
        deny(
            "orchestrator-mode: model %r is not in this project's model "
            "allowlist (%s). Pick a model from the allowlist."
            % (model, ", ".join(allowed_models)) + DELEGATE_GUIDANCE)


def check_workflow_models(tool_input, allowed_models, data):
    """Model-allowlist lint for a Workflow call the mode gating would
    otherwise allow. (D4b) First, a presence-counting pass: if the script
    contains any `agent(` calls, the count of `model:` option occurrences must
    be >= the count of `agent(` calls, else DENY (an agent() call omitted its
    model while an allowlist is active). Zero agent( calls -> never denied
    here. Then scans the script text (inline `script`, or the file at
    `scriptPath` -- unreadable file fails open silently) for quoted model
    option values; any value outside the allowlist (family match, D3) ->
    DENY. Best-effort, see MODEL_OPTION_RE/MODEL_PRESENT_RE above."""
    if not allowed_models:
        return
    script = (tool_input or {}).get("script")
    if not script:
        script_path = (tool_input or {}).get("scriptPath")
        if not script_path:
            return
        try:
            if not os.path.isabs(script_path):
                script_path = os.path.join(project_dir(data), script_path)
            with open(script_path, "r") as f:
                script = f.read()
        except Exception:
            return  # unreadable scriptPath -> fail open silently
    try:
        agent_count = str(script).count("agent(")
        if agent_count > 0:
            model_present_count = len(MODEL_PRESENT_RE.findall(str(script)))
            if model_present_count < agent_count:
                deny(
                    "orchestrator-mode: this project has a model allowlist "
                    "(%s) active. This workflow script has %d agent() call(s) "
                    "but only %d declare a model: option -- declare model: "
                    "one of %s on every agent() call while an allowlist is "
                    "set (best-effort script lint; comments containing "
                    "'model:' can cause false negatives)."
                    % (", ".join(allowed_models), agent_count,
                       model_present_count, ", ".join(allowed_models))
                    + DELEGATE_GUIDANCE)
        matches = MODEL_OPTION_RE.finditer(str(script))
    except Exception:
        return  # never let the lint itself brick a session
    offending = []
    for m in matches:
        value = (m.group(1) if m.group(1) is not None else m.group(2))
        value = value.strip().lower()
        if value and not _model_allowed(value, allowed_models) and value not in offending:
            offending.append(value)
    if offending:
        deny(
            "orchestrator-mode: this Workflow script requests model(s) not in "
            "this project's model allowlist: %s. Allowed models: %s. Change "
            "the script to use allowed models."
            % (", ".join(repr(v) for v in offending),
               ", ".join(allowed_models)) + DELEGATE_GUIDANCE)


def handle_on_mode(tool, tool_input, allowed_models, data):
    if tool in MAIN_ALLOWLIST:
        # Model allowlist composes with the mode gating: these delegation
        # calls are otherwise allowed under ON, so run the model check first.
        if tool in ("Task", "Agent"):
            check_task_model(tool_input, allowed_models)
        elif tool == "Workflow":
            check_workflow_models(tool_input, allowed_models, data)
        noop("allowlisted tool %s -> silent no-op (mode=on)" % tool)
    reason = (
        "orchestrator-mode is ON for this project: the main agent is read-only "
        "(allowlist of read/meta/delegation tools only). '%s' is blocked on the "
        "main thread. Delegate this work to a subagent via the Agent/Task tool "
        "(subagents have full write/execute access). To exit this mode, run "
        "/orchestrator-mode:mode off." % tool) + DELEGATE_GUIDANCE
    log_debug("main thread, mode=on, not allowlisted -> DENY %s" % tool)
    deny(reason)


def handle_wf_mode(tool, tool_input, allowed_models, data):
    # Task/Agent: allow ONLY the built-in read-only Explore scout. Same
    # deliberate FAIL-CLOSED exception to the fail-open policy elsewhere in
    # this file as handle_pi_mode below -- missing/empty/wrong subagent_type
    # is DENIED, not passed through. Do not "fix" this back to permissive:
    # fail-open here would reopen the general delegation escape hatch that
    # mode=wf exists to close in favor of the Workflow tool.
    if tool in ("Task", "Agent"):
        subagent_type = (tool_input or {}).get("subagent_type")
        if subagent_type == WF_EXPLORE_SUBAGENT_TYPE:
            # Otherwise allowed -> compose the model-allowlist check.
            check_task_model(tool_input, allowed_models)
            noop("mode=wf: %s -> Explore scout -> silent no-op" % tool)
        reason = (
            "orchestrator-mode is set to WF for this project: all substantive "
            "delegation must go through the Workflow tool (dynamic multi-agent "
            "workflows). '%s' with subagent_type=%r is blocked; only the "
            "read-only 'Explore' scout may be spawned directly. Use the "
            "Workflow tool to orchestrate work, or /orchestrator-mode:mode off "
            "to exit. (Setting this mode is the user's standing opt-in to the "
            "Workflow tool.)" % (tool, subagent_type)) + DELEGATE_GUIDANCE
        log_debug(
            "mode=wf: %s subagent_type=%r not Explore -> DENY (fail-closed)"
            % (tool, subagent_type))
        deny(reason)

    if tool in WF_MODE_ALLOWLIST:
        if tool == "Workflow":
            # Otherwise allowed -> compose the model-allowlist script lint.
            check_workflow_models(tool_input, allowed_models, data)
        noop("allowlisted tool %s -> silent no-op (mode=wf)" % tool)

    reason = (
        "orchestrator-mode is set to WF for this project: the main agent is "
        "read-only and must orchestrate via the Workflow tool ('%s' is "
        "blocked). Only the read-only 'Explore' scout may be spawned directly "
        "via Task/Agent; all other delegation must go through the Workflow "
        "tool (dynamic multi-agent workflows) -- setting this mode is the "
        "user's standing opt-in to it. To exit this mode, run "
        "/orchestrator-mode:mode off." % tool) + DELEGATE_GUIDANCE
    log_debug("mode=wf, not allowlisted -> DENY %s" % tool)
    deny(reason)


def handle_pi_mode(tool, tool_input, allowed_models):
    # Task/Agent: allow ONLY the exact pi-delegate subagent. This is a
    # deliberate FAIL-CLOSED exception to the fail-open policy elsewhere in
    # this file -- missing/empty/wrong subagent_type is DENIED, not passed
    # through. Do not "fix" this back to permissive: fail-open here would
    # reopen the general delegation escape hatch that mode=pi exists to close.
    if tool in ("Task", "Agent"):
        subagent_type = (tool_input or {}).get("subagent_type")
        if subagent_type == PI_DELEGATE_SUBAGENT_TYPE:
            # Otherwise allowed -> compose the model-allowlist check.
            # (Workflow needs no equivalent under pi: it is denied outright.)
            check_task_model(tool_input, allowed_models)
            noop("mode=pi: %s -> pi-delegate subagent -> silent no-op" % tool)
        reason = (
            "orchestrator-mode is set to PI for this project: the main agent "
            "cannot delegate to any subagent except pi-delegate. '%s' with "
            "subagent_type=%r is blocked. Use /pi-delegate:delegate <task> to "
            "get code changes made. To exit this mode, run "
            "/orchestrator-mode:mode off." % (tool, subagent_type)) + DELEGATE_GUIDANCE
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
        "To exit this mode, run /orchestrator-mode:mode off." % tool) + DELEGATE_GUIDANCE
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

    mode, options = get_state(data)
    allowed_models = options.get("allowed-models")

    # 2. state OFF / missing -> true no-op (normal permission flow proceeds)
    if mode == "off":
        noop("mode OFF -> silent no-op")

    # 3. [D2] state-file scan: ANY Bash command, or ANY mcp__* tool, whose
    #    (command / serialized tool_input) contains the state-file token ->
    #    DENY, regardless of agent_id or mode. Runs BEFORE the subagent bypass
    #    (step 5) and BEFORE the toggle fallthrough (step 6) -- applies to
    #    main thread AND subagents alike. Best-effort substring lint; a
    #    subagent doing a read-only `cat .orchestrator-mode.state` is also
    #    denied here -- accepted per spec (ANY Bash call mentioning the path).
    if tool == "Bash":
        command = (tool_input or {}).get("command", "")
        if STATE_FILE_TOKEN in str(command):
            log_debug("Bash command mentions state file -> DENY (D2)")
            deny(
                "orchestrator-mode: state-file changes go through "
                "/orchestrator-mode:mode." + DELEGATE_GUIDANCE)
    elif tool.startswith("mcp__"):
        if _tool_input_mentions_state_file(tool_input):
            log_debug("mcp__* tool_input mentions state file -> DENY (D2)")
            deny(
                "orchestrator-mode: state-file changes go through "
                "/orchestrator-mode:mode." + DELEGATE_GUIDANCE)

    # 4. subagents may NOT toggle the state file. Checked BEFORE the general
    #    subagent bypass in step 5 so a stamped subagent can never reach the
    #    toggle fallthrough in step 6 -- a blocked delegated agent once
    #    silently flipped the state to "off" that way. Covers every
    #    path-addressable mutation tool (Write/Edit/MultiEdit/NotebookEdit).
    #    The main thread (no agent_id) keeps its Write-only fallthrough below.
    if tool in ("Write", "Edit", "MultiEdit", "NotebookEdit") and agent_id:
        base = project_dir(data)
        path_key = "notebook_path" if tool == "NotebookEdit" else "file_path"
        target = norm(tool_input.get(path_key, ""), base)
        if target and target == norm(state_file_path(data), base):
            log_debug(
                "subagent %s %s to state file -> DENY (no toggling)"
                % (agent_id, tool))
            deny(
                "orchestrator-mode: subagents may not toggle "
                ".orchestrator-mode.state. Report the blocker to the main "
                "thread instead.")

    # 5. subagent -> proceeds normally (silent no-op; do NOT auto-approve)
    if agent_id:
        noop("subagent %s -> silent no-op (full access)" % agent_id)

    # 6. [D1] toggle: let a Write to the project's own state file fall
    #    through to the NORMAL permission prompt (silent no-op), instead of
    #    auto-approving. Main-thread-only -- subagents were already denied in
    #    step 4. The user approves the toggle like any other Write.
    if tool == "Write":
        base = project_dir(data)
        target = norm(tool_input.get("file_path", ""), base)
        if target and target == norm(state_file_path(data), base):
            noop("Write to state file -> fall through to normal prompt (toggle, D1)")

    # 7/8/9. branch on mode (the model allowlist, when set, composes inside
    # each handler on delegation calls the mode gating would otherwise allow)
    if mode == "on":
        handle_on_mode(tool, tool_input, allowed_models, data)
    elif mode == "wf":
        handle_wf_mode(tool, tool_input, allowed_models, data)
    else:  # mode == "pi"
        handle_pi_mode(tool, tool_input, allowed_models)


if __name__ == "__main__":
    main()
