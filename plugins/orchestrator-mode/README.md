# orchestrator-mode

Per-project "orchestrator" mode for Claude Code. When ON, the **main
conversation agent is read-only via an allowlist**: only a small set of
read/meta/delegation tools are permitted on the main thread, and **everything
else is denied** (deny-by-default). **Subagents keep full access**. A short
reminder is injected into the main thread telling the agent to delegate all
writes and command execution to subagents via the Agent/Task tool.

It is **OFF by default** and opt-in **per project**.

## Enable / disable

```
/orchestrator-mode:mode on       # main agent read-only for this project
/orchestrator-mode:mode off      # back to normal
/orchestrator-mode:mode status   # show current state
```

The command works even while the lock is active (see "Toggle exemption" below).

## State

State is a plain-text file at `<project>/.orchestrator-mode.state` (at the
**project root**, NOT under `.claude/`):

- File absent, empty, or content `off` -> **OFF** (hooks no-op; normal behavior).
- Content `on` (trimmed, case-insensitive) -> **ON**.

Nothing else is read. Anything unexpected is treated as OFF. The file is local
to the project; it is not shipped with the plugin.

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
Task, Agent,
TodoWrite,
TaskCreate, TaskUpdate, TaskList, TaskGet, TaskStop, TaskOutput,
AskUserQuestion,
Skill, SlashCommand,
ExitPlanMode, EnterPlanMode,
ToolSearch
```

**Denied on the main thread** — everything else, including:

- `Write`, `Edit`, `MultiEdit`, `NotebookEdit` (file mutation)
- `Bash` (command execution)
- **ALL `mcp__*` tools** (every MCP server tool is blocked on main)
- `WebFetch`, `WebSearch`
- any unknown / future tool not on the allowlist

`Skill` and `SlashCommand` are allowlisted because any tool calls they spawn are
themselves re-checked by this PreToolUse hook, so they cannot be used to smuggle
a denied tool.

The **UserPromptSubmit hook** injects a concise read-only / delegate reminder on
each prompt while ON.

Subagents are detected by the `agent_id` field in the hook payload (present only
inside a subagent call) and are allowed to use every tool.

### Extending the allowlist

Add the exact tool name to the `MAIN_ALLOWLIST` set in
`hooks/enforce-orchestrator.py` — one line, e.g.:

```python
MAIN_ALLOWLIST = {
    "Read", "Grep", "Glob", "LS",
    ...
    "ToolSearch",
    "MyExtraTool",   # <- add here
}
```

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
