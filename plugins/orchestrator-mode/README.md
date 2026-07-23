# orchestrator-mode

Per-project "orchestrator" mode for Claude Code, with four states: `off`,
`on`, `pi`, and `wf`.

- **`on`**: the **main conversation agent is read-only via an allowlist**:
  only a small set of read/meta/delegation tools are permitted on the main
  thread, and **everything else is denied** (deny-by-default). **Subagents
  keep full access**, reached via the Agent/Task tool.
- **`pi`**: the same read-only restriction, PLUS the general delegation escape
  hatch is closed. Task/Agent is only allowed when it targets the exact
  `pi-delegate:delegate` subagent (shipped by the separate `pi-delegate`
  plugin) — any other subagent_type is denied. The only way to get code
  changes made is `/pi-delegate:delegate <task>`, which forwards the task to
  the local `pi` CLI. WebFetch/WebSearch stay allowlisted, same as under `on`
  (both modes have included them since 0.2.3).
- **`wf`** (workflow): the same read-only restriction, PLUS the general
  delegation escape hatch is closed down to just the built-in read-only
  `Explore` scout — Task/Agent is only allowed when it targets `Explore`; any
  other subagent_type is denied. All other substantive delegation must go
  through the `Workflow` tool (dynamic multi-agent workflows), which stays
  allowlisted under `wf` (unlike under `pi`). Setting mode to `wf` is the
  user's **standing opt-in to the Workflow tool** for this project.
- **`off`**: normal behavior.

A short reminder matching the active state is injected into the main thread
on every prompt.

It is **OFF by default** and opt-in **per project**.

## Enable / disable

```
/orchestrator-mode:mode on       # main agent read-only for this project
/orchestrator-mode:mode pi       # read-only + only pi-delegate can make code changes
/orchestrator-mode:mode wf       # read-only + orchestrate via the Workflow tool (Explore scout allowed)
/orchestrator-mode:mode off      # back to normal (also clears any model allowlist)
/orchestrator-mode:mode status   # show current state (reports the model allowlist if set)

/orchestrator-mode:mode wf --allowed-models opus,sonnet,haiku
                                 # any of on/pi/wf + a per-project MODEL ALLOWLIST
                                 # for delegated agents (see below)
```

The command works even while the lock is active (see "Toggle exemption" below).

## State

State is a plain-text file at `<project>/.orchestrator-mode.state` (at the
**project root**, NOT under `.claude/`):

The file is a single line: a **mode token** optionally followed by
whitespace-separated `key=value` **options**, e.g.
`wf allowed-models=opus,sonnet,haiku`. The mode is the **first
whitespace-separated token** (trimmed, case-insensitive) — options never
affect mode detection:

- File absent, empty, or mode token `off` -> **OFF** (hooks no-op; normal behavior).
- Mode token `on` -> **ON**.
- Mode token `pi` -> **PI**.
- Mode token `wf` -> **WF**.

Anything unexpected is treated as OFF; unparseable options are ignored (fail
open). The file is local to the project; it is not shipped with the plugin.
Both hook scripts parse the state through a shared helper, `hooks/_state.py`
(`get_state()` returning `(mode, options)`; `get_mode()` remains as a
mode-only wrapper), so the two hooks can't drift out of sync on what counts
as a valid state.

> The state file lives at the project root, not inside `.claude/`, on purpose.
> Claude Code specially guards writes to `.claude/`, which blocked the toggle
> even with the hook exemption. At the root, the toggle write goes through
> cleanly.

## Behavior when ON (allowlist)

The PreToolUse hook matches **all tools** (`matcher: "*"`) so MCP and future
write tools actually reach the gate.

**Allowed on the main thread** (read-only / meta / delegation only):

```
Read, Grep, Glob, LS,
Task, Agent, SendMessage,
Workflow,
TodoWrite,
TaskCreate, TaskUpdate, TaskList, TaskGet, TaskStop, TaskOutput,
AskUserQuestion,
Skill, SlashCommand,
ExitPlanMode, EnterPlanMode,
ToolSearch,
WebFetch, WebSearch,
ReportFindings,
Artifact,
Monitor, CronList, LSP,
ListMcpResourcesTool, ReadMcpResourceTool, ReadMcpResourceDirTool,
PushNotification, ScheduleWakeup
```

`Monitor` through `ScheduleWakeup` were added in a 2026-07-09 audit of every
built-in tool in the environment: each is read-only or a non-mutating side
effect (streaming/listing/querying/notifying/scheduling), none writes files,
executes commands, or spawns subagents. The MCP resource tools are generic
read infra (not any one server) so this isn't a server-specific carve-out.
`Workflow`, `WebFetch`, `WebSearch`, `ReportFindings`, and `Artifact` were
added in 0.2.3: `Workflow` is pure delegation (same category as Task/Agent),
research isn't a mutation, `ReportFindings` is typed non-mutating review
output, and `Artifact` publishes default-private deliverables.

**Denied on the main thread** — everything else, including:

- `Write`, `Edit`, `MultiEdit`, `NotebookEdit` (file mutation)
- `Bash` (command execution)
- **ALL `mcp__*` tools** (every MCP server tool is blocked on main)
- `CronCreate`, `CronDelete`, `EnterWorktree`, `ExitWorktree`,
  `RemoteTrigger` (external side effects or state mutation)
- any unknown / future tool not on the allowlist

Every deny message ends with explicit guidance for delegated agents: do NOT
modify `.orchestrator-mode.state` to unblock yourself — report the blocker to
your caller instead. (A blocked delegated agent once silently flipped the
state file to `off` via the toggle exemption; see "Toggle exemption" below
for the hard block that now backs this up.)

`Skill` and `SlashCommand` are allowlisted because any tool calls they spawn are
themselves re-checked by this PreToolUse hook, so they cannot be used to smuggle
a denied tool.

The **UserPromptSubmit hook** injects a concise read-only / delegate reminder on
each prompt while ON.

Subagents are detected by the `agent_id` field in the hook payload (present only
inside a subagent call) and are allowed to use every tool — with one exception:
a subagent `Write`, `Edit`, `MultiEdit`, or `NotebookEdit` targeting
`.orchestrator-mode.state` is denied (see "Toggle exemption" below).

### Extending the allowlist

Add the exact tool name to the `MAIN_ALLOWLIST` set (mode `on`),
`PI_MODE_ALLOWLIST` set (mode `pi`), or `WF_MODE_ALLOWLIST` set (mode `wf`) in
`hooks/enforce-orchestrator.py` — one line, e.g.:

```python
MAIN_ALLOWLIST = {
    "Read", "Grep", "Glob", "LS",
    ...
    "ToolSearch",
    "MyExtraTool",   # <- add here
}
```

## Behavior when `pi` (forced delegation via pi-delegate)

Same allowlist as `on`, minus Task/Agent (handled specially, see below) and
minus `Workflow`/`ReportFindings`/`Artifact` (`WebFetch`/`WebSearch` are in
both lists since 0.2.3, so they are no longer a pi-only carve-out):

```
Read, Grep, Glob, LS,
WebFetch, WebSearch, SendMessage,
TodoWrite,
TaskCreate, TaskUpdate, TaskList, TaskGet, TaskStop, TaskOutput,
AskUserQuestion,
Skill, SlashCommand,
ExitPlanMode, EnterPlanMode,
ToolSearch,
Monitor, CronList, LSP,
ListMcpResourcesTool, ReadMcpResourceTool, ReadMcpResourceDirTool,
PushNotification, ScheduleWakeup
```

`SendMessage` is safe here because Task/Agent is already gated to allow
spawning only the `pi-delegate:delegate` subagent (see below) — no other
subagent type can exist in a pi-mode session, so any `SendMessage` target is
necessarily a pi-delegate teammate. Without it, a backgrounded pi-delegate
dispatch is unreachable once launched.

**Task/Agent** gets special handling instead of a flat allow/deny: it is
allowed **only** when `tool_input.subagent_type` exactly equals
`"pi-delegate:delegate"` (the `PI_DELEGATE_SUBAGENT_TYPE` constant in
`hooks/enforce-orchestrator.py`, sourced from the `name:` frontmatter of
`plugins/pi-delegate/agents/delegate.md`). Any other subagent_type — including
missing/empty — is **denied**. This is the one place in the hook that is
**fail-closed** rather than fail-open: an unrecognized or missing
subagent_type does not pass through, it is blocked. That's intentional — the
whole point of `pi` mode is that there is no general delegation escape hatch,
so ambiguity must resolve to deny, not allow.

This is the **only coupling** between `orchestrator-mode` and `pi-delegate`:
one string constant, checked one-directionally. `orchestrator-mode` knows the
name of `pi-delegate`'s subagent; `pi-delegate` has zero knowledge of
`orchestrator-mode` and works completely standalone.

**Denied under `pi`** — same as `on` (Write, Edit, MultiEdit, NotebookEdit,
Bash, all `mcp__*`), plus Task/Agent to any subagent other than
`pi-delegate:delegate`. The `Workflow` question is resolved (see the
`# RESOLVED (was an open question as of 0.2.2)` comment in
`hooks/enforce-orchestrator.py`): `Workflow` was added to `MAIN_ALLOWLIST` in
0.2.3 but deliberately NOT to `PI_MODE_ALLOWLIST` — it can spawn arbitrary
subagents, which would bypass the pi-delegate-only restriction — so under
`pi` it falls through to deny by default.

## Behavior when `wf` (orchestrate via the Workflow tool)

Same allowlist as `on`, minus Task/Agent (handled specially, see below), plus
`Workflow` stays allowlisted (unlike under `pi`, where it is deliberately
excluded — see above):

```
Read, Grep, Glob, LS,
SendMessage,
Workflow,
TodoWrite,
TaskCreate, TaskUpdate, TaskList, TaskGet, TaskStop, TaskOutput,
AskUserQuestion,
Skill, SlashCommand,
ExitPlanMode, EnterPlanMode,
ToolSearch,
WebFetch, WebSearch,
ReportFindings,
Artifact,
Monitor, CronList, LSP,
ListMcpResourcesTool, ReadMcpResourceTool, ReadMcpResourceDirTool,
PushNotification, ScheduleWakeup
```

**Task/Agent** gets special handling instead of a flat allow/deny: it is
allowed **only** when `tool_input.subagent_type` exactly equals `"Explore"`
(the `WF_EXPLORE_SUBAGENT_TYPE` constant in `hooks/enforce-orchestrator.py`)
— the built-in, read-only "scout" agent type shipped with Claude Code itself,
not a plugin. It's safe to spawn directly under `wf` because it can't
write/edit any more than the main thread already can't. Any other
subagent_type — including missing/empty — is **denied**. This is the same
**fail-closed** exception used under `pi`: an unrecognized or missing
subagent_type does not pass through, it is blocked. That's intentional — the
whole point of `wf` mode is that there is no general Task/Agent delegation
escape hatch, so ambiguity must resolve to deny, not allow.

All other substantive delegation must go through the **`Workflow`** tool
(dynamic multi-agent workflows) instead. **Setting mode to `wf` is the user's
standing opt-in to the Workflow tool for this project** — that's why it stays
allowlisted here even though it is deliberately excluded under `pi` (Workflow
can spawn arbitrary subagents, which is exactly what `wf` mode intends to
route through, unlike `pi`'s pi-delegate-only restriction).

**Denied under `wf`** — same as `on` (Write, Edit, MultiEdit, NotebookEdit,
Bash, all `mcp__*`), plus Task/Agent to any subagent other than `Explore`.

## Model allowlist (`--allowed-models`)

Any of the three active modes can carry a per-project **model allowlist** that
constrains which models delegated agents and workflow scripts may *explicitly*
request:

```
/orchestrator-mode:mode wf --allowed-models opus,sonnet,haiku
/orchestrator-mode:mode on --allowed-models opus,haiku
/orchestrator-mode:mode pi --allowed-models haiku
```

The command writes the option into the state file after the mode token
(e.g. `wf allowed-models=opus,sonnet,haiku` — single line, lowercased list).
`/orchestrator-mode:mode off` clears it along with the mode;
`/orchestrator-mode:mode status` reports it when set. The per-prompt reminder
also names the allowlist while it is active.

When set, the enforcement hook adds a check on delegation calls that the mode
gating would otherwise allow:

- **Task/Agent — deterministic.** If the call's `tool_input.model` field is
  present and not in the list, the call is denied, naming the offending model
  and the allowed set. This composes with the per-mode Task/Agent gating: it
  runs for any subagent_type under `on`, for the `Explore` scout under `wf`,
  and for `pi-delegate:delegate` under `pi`.
- **Workflow — best-effort lint.** The workflow script text
  (`tool_input.script`, or the file at `tool_input.scriptPath`; an unreadable
  file fails open silently) is regex-scanned for quoted `model: "..."` option
  values; any captured value outside the list denies the call, listing the
  offending values. This is a **text lint, not a parser**: a computed or
  obfuscated model value (string concatenation, a variable, etc.) can slip
  through. That is consistent with the cooperative-guardrail security model
  below — it catches a well-behaved agent's accidental off-list model choice,
  not an adversarial one.

**An omitted model is always allowed.** Absence of a `model` field (or of a
model option in a workflow script) means the agent inherits the session
default — that is never denied, anywhere. No `allowed-models` option in the
state file means no restriction at all: behavior is identical to a plain mode
token.

> **BACKWARD COMPAT:** the mode-token-first state parsing shipped *together*
> with this feature. An **older installed version of the hooks** reads the
> whole state line as the mode string, so an option-bearing line like
> `wf allowed-models=opus,haiku` does not match `on`/`pi`/`wf` and is treated
> as **OFF** (fail open — no enforcement at all, but nothing breaks). Update
> the installed plugin before relying on an option-bearing state line.

## Toggle exemption (how you can still turn it OFF while locked)

The `/orchestrator-mode:mode` command flips the state by writing the
`.orchestrator-mode.state` file with the normal **Write** tool. `Write` is
denied when the mode is ON — except the PreToolUse hook makes one narrow
exception: it allows a `Write` whose resolved `tool_input.file_path` equals this
project's `.orchestrator-mode.state`. So you can always run
`/orchestrator-mode:mode off` even while the main agent is otherwise read-only.

The exemption is deliberately narrow:

- It matches the **Write tool only**, by the **resolved absolute file path**
  (relative paths are resolved against the project dir before comparison). It
  never path-matches `Bash` — a shell command like `echo ... > file` could be
  abused to write anywhere, so Bash is never exempted (and Bash is denied
  outright on main anyway).
- It targets exactly one fixed path. No other file can be written through it.
- It is **main-thread-only**: a subagent (payload carries `agent_id`) that
  targets `.orchestrator-mode.state` with `Write`, `Edit`, `MultiEdit`, or
  `NotebookEdit` is **denied**, and that check runs *before* the general
  "subagents have full access" bypass, so a stamped subagent can never reach
  the exemption. A raw `Bash` write (e.g. `echo off > .orchestrator-mode.state`
  from a subagent, which keeps full Bash access) remains possible — Bash
  commands cannot be path-matched, the same limitation noted for embedded bash
  under "Limitations" below. This check closes a real incident: a blocked
  delegated agent once silently flipped the state file to `off` to unblock
  itself. Subagents are told to report the blocker to the main thread instead
  — and every deny message carries the same guidance.

## Robustness

Both hooks **fail open**: on malformed input, a missing/unreadable state file,
or any unexpected error, they no-op (let normal flow proceed / inject nothing).
A broken hook never bricks a session. The default is always OFF.

The **deliberate exceptions** are the Task/Agent subagent_type checks under
`pi` mode and `wf` mode (see above): those specific checks are
fail-**closed** (unknown/missing subagent_type is denied, not passed
through), because the entire purpose of `pi`/`wf` mode is to remove the
general delegation escape hatch. Don't "fix" those branches back to
permissive.

Set `ORCHESTRATOR_DEBUG=true` for stderr tracing from the hook scripts.

## Security model (read this)

orchestrator-mode is a **cooperative guardrail**, not an adversarial sandbox.
Its job is to prevent *accidental* main-thread writes and command execution — to
keep a well-behaved main agent in an orchestrate-and-delegate posture. It is
**not tamper-proof**:

- A determined main agent can unlock itself by writing `off` to the state file.
  The toggle is **intentionally model-serviceable** (that is how
  `/orchestrator-mode:mode off` works), so the same path can be used to disable
  the lock. (Subagents, by contrast, cannot do this through the file-mutation
  tools — `Write`/`Edit`/`MultiEdit`/`NotebookEdit` targeting the state file
  are denied; a raw `Bash` write remains possible since shell commands cannot
  be path-matched. See "Toggle exemption" above.)
- A main agent can route a denied write through a subagent via the Agent/Task
  tool — that is the **intended design**, not a bypass. Subagents have full
  access by design.

Do not rely on this plugin as a security boundary against an adversarial model.
It reduces accidental mutation on the main thread and nudges toward delegation;
it does not contain a model that is actively trying to escape.

## Limitations

Embedded `` !`bash` `` preprocessing inside skills/commands runs before the
PreToolUse gate and is not subject to it; the only lever there is
`disableSkillShellExecution` in settings. Because `Skill` and `SlashCommand` are
allowlisted, command-embedded bash preprocessing still runs before the gate. The
read-only lock constrains the model's **tool calls**, not harness preprocessing.
The same root cause (shell commands can't be path-matched) means a subagent's
raw `Bash` write to `.orchestrator-mode.state` is not caught by the
state-file deny either — see "Toggle exemption" above.

**Teammate sessions**: agents spawned as separate teammate CLI sessions (e.g.
via the experimental agent-teams feature) carry no `agent_id` in their hook
payloads, so the gate cannot tell them apart from main agents — it treats them
as main threads and blocks their writes. In locked projects, delegate with
plain in-process subagents (Task/Agent) or the Workflow tool instead.
