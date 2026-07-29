# orchestrator-mode

Per-project "orchestrator" mode for Claude Code, with four states: `off`,
`on`, `pi`, and `wf`.

- **`on`**: the **main conversation agent is read-only via an allowlist**:
  only a small set of read/meta/delegation tools are permitted on the main
  thread, and **everything else is denied** (deny-by-default). **Subagents
  keep full access**, reached via the Agent/Task tool.
- **`pi`**: the same read-only restriction, PLUS the general delegation escape
  hatch is closed. Task/Agent is **denied outright** — no subagent target
  exists for this mode. Code changes go through the pi-delegate MCP tools
  directly (`mcp__pi-delegate__pi_task` etc., shipped by the separate
  `pi-delegate` plugin, allowlisted by tool-name prefix) or via
  `/pi-delegate:delegate <task>`, which forwards the task to the local `pi`
  CLI. WebFetch/WebSearch stay allowlisted, same as under `on`
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
(`get_state()` returning `(mode, options)`), so the two hooks can't drift out
of sync on what counts as a valid state.

If the state file exists but its first token is not one of `on`/`pi`/`wf`/`off`,
`_state.py` prints a one-line warning to stderr and treats it as OFF
(fail-open) — this does not fire for an absent file or an explicit `off`.

A malformed `allowed-models` option (e.g. a stray token from a line like
`on allowed-models=opus, haiku`, where the space breaks tokenization) causes
the entire `allowed-models` restriction to be discarded, with a stderr
warning — the parser never ends up stricter than intended; a malformed
option always fails open to "no restriction," never to a narrower one.

Model matching against `allowed-models` is a case-insensitive **family /
substring match**: an allowlist entry like `sonnet` permits any requested
model id containing `sonnet` (e.g. `claude-sonnet-5`). This is asymmetric by
design — an allowlist entry of the full id `claude-sonnet-5` would not match
a bare request of `sonnet`.

> The state file lives at the project root, not inside `.claude/`, on purpose.
> Claude Code specially guards writes to `.claude/`, which blocked the toggle
> even with the hook exemption. At the root, the toggle write goes through
> cleanly.

## Behavior when ON (allowlist)

The PreToolUse hook matches **all tools** (`matcher: ".*"`) so MCP and future
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
PushNotification, ScheduleWakeup,
CronCreate, CronDelete
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
`CronCreate`/`CronDelete` were added on 2026-07-28, alongside the rest of the
scheduling/loop meta-tools above: they schedule or cancel a cron job, not a
repo/state mutation, same category as the already-allowlisted `ScheduleWakeup`.

**Denied on the main thread** — everything else, including:

- `Write`, `Edit`, `MultiEdit`, `NotebookEdit` (file mutation)
- `Bash` (command execution)
- **ALL `mcp__*` tools** (every MCP server tool is blocked on main)
- `EnterWorktree`, `ExitWorktree`, `RemoteTrigger` (external side effects or
  state mutation)
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
PushNotification, ScheduleWakeup,
CronCreate, CronDelete
```

`SendMessage` is included so a teammate created before mode was switched to
`pi` (or under a different mode) remains reachable for check-in/resume; since
Task/Agent is denied outright under `pi`, no new subagent can be spawned in a
pi-mode session. Without `SendMessage`, a backgrounded teammate would be
unreachable once launched.

**Task/Agent** is **denied outright** under `pi` (ADR-003, pi-delegate
0.9.0): the `pi-delegate:delegate` subagent this used to carve out no longer
exists, so Task/Agent has no valid target and falls through to the mode's
generic deny in `handle_pi_mode` (`hooks/enforce-orchestrator.py`). That's
intentional — the whole point of `pi` mode is that there is no general
delegation escape hatch, and code changes now go through the pi-delegate MCP
tools directly instead of a subagent hop.

This is the **only coupling** between `orchestrator-mode` and `pi-delegate`:
a tool-name prefix (`mcp__pi-delegate__` / `mcp__plugin_pi-delegate_`),
checked one-directionally in `handle_pi_mode`. `orchestrator-mode` knows the
prefix `pi-delegate`'s MCP tools are exposed under; `pi-delegate` has zero
knowledge of `orchestrator-mode` and works completely standalone.

**Denied under `pi`** — same as `on` (Write, Edit, MultiEdit, NotebookEdit,
Bash, all `mcp__*` except the pi-delegate prefix), plus Task/Agent to any
subagent, full stop. The `Workflow` question is resolved (see the
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
PushNotification, ScheduleWakeup,
CronCreate, CronDelete
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
  runs for any subagent_type under `on` and for the `Explore` scout under
  `wf`. Under `pi`, Task/Agent is denied outright so this check never
  applies there.
- **Workflow — best-effort lint.** The workflow script text
  (`tool_input.script`, or the file at `tool_input.scriptPath`; an unreadable
  file fails open silently) is regex-scanned for quoted `model: "..."` option
  values; any captured value outside the list denies the call, listing the
  offending values. This is a **text lint, not a parser**: a computed or
  obfuscated model value (string concatenation, a variable, etc.) can slip
  through. That is consistent with the cooperative-guardrail security model
  below — it catches a well-behaved agent's accidental off-list model choice,
  not an adversarial one.

**An omitted model is allowed only when no `allowed-models` restriction is
active.** No `allowed-models` option in the state file means no restriction
at all: behavior is identical to a plain mode token, and an omitted model
inherits the session default as before.

**When an `allowed-models` restriction IS active, an omitted model is
DENIED, not inherited:**

- **Task/Agent.** A call with no `model` field at all is denied with
  guidance to declare one of the allowed models — omission no longer falls
  through to "inherit the session default." This applies to any
  subagent_type gated in under `on` and to the `Explore` scout under `wf`,
  which is held to the same rule as everything else (no carve-out for
  read-only scouts). Under `pi`, Task/Agent is denied outright so this rule
  never applies there.
- **Workflow — best-effort lint.** If the script contains one or more
  `agent(` calls, and the count of calls containing a `model:` option is
  fewer than the count of `agent(` calls, the whole call is denied, naming
  the mismatch. A script with **zero** `agent(` calls is never denied by
  this check (nothing to lint). This is a text lint, not a parser: a
  computed/obfuscated model value, or a `scriptPath` that can't be read,
  remains fail-open, consistent with the existing lint limitations above.

This closes a real gap: a project with `allowed-models=sonnet` set had a
`Workflow` script whose `agent()` calls all omitted `model:`, so every
delegated agent silently ran on the session default instead of the
allowlisted model — the omission-inherits behavior masked a misconfigured
workflow instead of surfacing it.

> **BACKWARD COMPAT:** the mode-token-first state parsing shipped *together*
> with this feature. An **older installed version of the hooks** reads the
> whole state line as the mode string, so an option-bearing line like
> `wf allowed-models=opus,haiku` does not match `on`/`pi`/`wf` and is treated
> as **OFF** (fail open — no enforcement at all, but nothing breaks). Update
> the installed plugin before relying on an option-bearing state line.

## Toggle exemption (how you can still turn it OFF while locked)

The `/orchestrator-mode:mode` command flips the state by writing the
`.orchestrator-mode.state` file with the normal **Write** tool. Rather than
auto-approving this write, the hook lets a main-thread `Write` whose resolved
`tool_input.file_path` equals this project's `.orchestrator-mode.state` fall
through silently to the **normal Claude Code permission prompt** — it is not
denied and not auto-allowed. Approve that prompt when it appears; that's how
`/orchestrator-mode:mode off` still works even while the main agent is
otherwise read-only. (Earlier versions of this hook auto-approved the write
outright; it now defers to the standard prompt instead, so the toggle stays
visible and user-confirmed rather than silent.)

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
  the exemption. A raw `Bash` write or an `mcp__*` write (e.g.
  `echo off > .orchestrator-mode.state` from a subagent, which otherwise keeps
  full Bash access) is now also **denied**: any `Bash` command or `mcp__*`
  tool call whose serialized `tool_input` contains the literal string
  `.orchestrator-mode.state` is blocked, regardless of `agent_id` — see
  "Security model" and "Limitations" below for the best-effort nature of that
  check. This closes a real incident: a blocked delegated agent once silently
  flipped the state file to `off` to unblock itself. Subagents are told to
  report the blocker to the main thread instead — and every deny message
  carries the same guidance.

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

**Headless / missing `CLAUDE_PROJECT_DIR` fallback:** when the environment
doesn't set `CLAUDE_PROJECT_DIR`, `state_file_path()` walks up from the
current working directory looking for the nearest ancestor directory
containing `.orchestrator-mode.state`, falling back to the starting cwd
itself if none is found anywhere up to the filesystem root. This is separate
from `project_dir()`, which still resolves relative tool-input paths (e.g. in
`norm()`) against the cwd-based project root exactly as before and is
unaffected by this walk-up. The asymmetry is intentional: with
`CLAUDE_PROJECT_DIR` unset and a nested cwd, the *discovered* state file can
resolve to an ancestor directory while relative tool-input paths in the same
request still resolve against the nested cwd. Setting `CLAUDE_PROJECT_DIR`
avoids the ambiguity entirely and is the recommended, unaffected path.

## Security model (read this)

orchestrator-mode is a **cooperative guardrail**, not an adversarial sandbox.
Its job is to prevent *accidental* main-thread writes and command execution — to
keep a well-behaved main agent in an orchestrate-and-delegate posture. It is
**not tamper-proof**:

- A determined main agent can unlock itself by writing `off` to the state file.
  The toggle is **intentionally model-serviceable** (that is how
  `/orchestrator-mode:mode off` works, now via the normal permission prompt
  rather than a silent auto-allow — see "Toggle exemption" above), so the same
  path can be used to disable the lock. Subagents cannot do this through the
  file-mutation tools — `Write`/`Edit`/`MultiEdit`/`NotebookEdit` targeting the
  state file are denied — and a raw `Bash` or `mcp__*` call whose tool_input
  mentions the state-file path is also denied, regardless of `agent_id`. This
  is a **best-effort substring lint, not a parser**: it can be evaded by
  obfuscating the path string (e.g. building it via shell variable
  concatenation or command substitution so the literal string
  `.orchestrator-mode.state` never appears in the scanned `tool_input`), so it
  raises the bar but is not airtight against an adversarial model.
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

A subagent's raw `Bash` write to `.orchestrator-mode.state` (or an `mcp__*`
tool call referencing it) IS now caught, by a best-effort substring lint on
`tool_input` — see "Toggle exemption" and "Security model" above. That lint
is content-based, not a shell parser: an obfuscated command (variable
concatenation, command substitution, base64, etc.) that never contains the
literal string `.orchestrator-mode.state` in its `tool_input` can still slip
through undetected.

**Teammate sessions**: agents spawned as separate teammate CLI sessions (e.g.
via the experimental agent-teams feature) carry no `agent_id` in their hook
payloads, so the gate cannot tell them apart from main agents — it treats them
as main threads and blocks their writes. In locked projects, delegate with
plain in-process subagents (Task/Agent) or the Workflow tool instead.
