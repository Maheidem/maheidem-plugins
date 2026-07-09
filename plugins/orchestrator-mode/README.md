# orchestrator-mode

Per-project "orchestrator" mode for Claude Code, with three states: `off`,
`on`, and `pi`.

- **`on`**: the **main conversation agent is read-only via an allowlist**:
  only a small set of read/meta/delegation tools are permitted on the main
  thread, and **everything else is denied** (deny-by-default). **Subagents
  keep full access**, reached via the Agent/Task tool.
- **`pi`**: the same read-only restriction, PLUS the general delegation escape
  hatch is closed. Task/Agent is only allowed when it targets the exact
  `pi-delegate:delegate` subagent (shipped by the separate `pi-delegate`
  plugin) — any other subagent_type is denied. The only way to get code
  changes made is `/pi-delegate:delegate <task>`, which forwards the task to
  the local `pi` CLI. WebFetch/WebSearch are additionally allowlisted (unlike
  `on` mode) since research/browsing isn't a mutation.
- **`off`**: normal behavior.

A short reminder matching the active state is injected into the main thread
on every prompt.

It is **OFF by default** and opt-in **per project**.

## Enable / disable

```
/orchestrator-mode:mode on       # main agent read-only for this project
/orchestrator-mode:mode pi       # read-only + only pi-delegate can make code changes
/orchestrator-mode:mode off      # back to normal
/orchestrator-mode:mode status   # show current state
```

The command works even while the lock is active (see "Toggle exemption" below).

## State

State is a plain-text file at `<project>/.orchestrator-mode.state` (at the
**project root**, NOT under `.claude/`):

- File absent, empty, or content `off` -> **OFF** (hooks no-op; normal behavior).
- Content `on` (trimmed, case-insensitive) -> **ON**.
- Content `pi` (trimmed, case-insensitive) -> **PI**.

Nothing else is read. Anything unexpected is treated as OFF. The file is local
to the project; it is not shipped with the plugin. Both hook scripts parse the
state through a shared helper, `hooks/_state.py` (`get_mode()`), so the two
hooks can't drift out of sync on what counts as a valid state.

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

The last eight (`Monitor` through `ScheduleWakeup`) were added in a 2026-07-09
audit of every built-in tool in the environment: each is read-only or a
non-mutating side effect (streaming/listing/querying/notifying/scheduling),
none writes files, executes commands, or spawns subagents. The MCP resource
tools are generic read infra (not any one server) so this isn't a
server-specific carve-out.

**Denied on the main thread** — everything else, including:

- `Write`, `Edit`, `MultiEdit`, `NotebookEdit` (file mutation)
- `Bash` (command execution)
- **ALL `mcp__*` tools** (every MCP server tool is blocked on main)
- `WebFetch`, `WebSearch`
- `Artifact`, `CronCreate`, `CronDelete`, `EnterWorktree`, `ExitWorktree`,
  `RemoteTrigger`, `Workflow` (external side effects, state mutation, or can
  spawn arbitrary subagents — `Workflow` in particular is a known open
  question, see the TODO comment in `enforce-orchestrator.py`)
- any unknown / future tool not on the allowlist

`Skill` and `SlashCommand` are allowlisted because any tool calls they spawn are
themselves re-checked by this PreToolUse hook, so they cannot be used to smuggle
a denied tool.

The **UserPromptSubmit hook** injects a concise read-only / delegate reminder on
each prompt while ON.

Subagents are detected by the `agent_id` field in the hook payload (present only
inside a subagent call) and are allowed to use every tool.

### Extending the allowlist

Add the exact tool name to the `MAIN_ALLOWLIST` set (mode `on`) or
`PI_MODE_ALLOWLIST` set (mode `pi`) in `hooks/enforce-orchestrator.py` — one
line, e.g.:

```python
MAIN_ALLOWLIST = {
    "Read", "Grep", "Glob", "LS",
    ...
    "ToolSearch",
    "MyExtraTool",   # <- add here
}
```

## Behavior when `pi` (forced delegation via pi-delegate)

Same allowlist as `on`, minus Task/Agent (handled specially, see below), plus
`WebFetch`/`WebSearch`:

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
`pi-delegate:delegate`. The `Workflow` tool is an open question — see the
`# TODO(open question)` comment in `hooks/enforce-orchestrator.py`; it is not
specially handled and currently falls through to deny.

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

## Robustness

Both hooks **fail open**: on malformed input, a missing/unreadable state file,
or any unexpected error, they no-op (let normal flow proceed / inject nothing).
A broken hook never bricks a session. The default is always OFF.

The **one deliberate exception** is the Task/Agent subagent_type check under
`pi` mode (see above): that specific check is fail-**closed** (unknown/missing
subagent_type is denied, not passed through), because the entire purpose of
`pi` mode is to remove the general delegation escape hatch. Don't "fix" that
branch back to permissive.

Set `ORCHESTRATOR_DEBUG=true` for stderr tracing from the hook scripts.

## Security model (read this)

orchestrator-mode is a **cooperative guardrail**, not an adversarial sandbox.
Its job is to prevent *accidental* main-thread writes and command execution — to
keep a well-behaved main agent in an orchestrate-and-delegate posture. It is
**not tamper-proof**:

- A determined main agent can unlock itself by writing `off` to the state file.
  The toggle is **intentionally model-serviceable** (that is how
  `/orchestrator-mode:mode off` works), so the same path can be used to disable
  the lock.
- A main agent can route a denied write through a subagent via the Agent/Task
  tool — that is the **intended design**, not a bypass. Subagents have full
  access by design.

Do not rely on this plugin as a security boundary against an adversarial model.
It reduces accidental mutation on the main thread and nudges toward delegation;
it does not contain a model that is actively trying to escape.

## Limitation

Embedded `` !`bash` `` preprocessing inside skills/commands runs before the
PreToolUse gate and is not subject to it; the only lever there is
`disableSkillShellExecution` in settings. Because `Skill` and `SlashCommand` are
allowlisted, command-embedded bash preprocessing still runs before the gate. The
read-only lock constrains the model's **tool calls**, not harness preprocessing.
