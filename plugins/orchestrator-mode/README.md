# orchestrator-mode

Per-project "orchestrator" mode for Claude Code. When it is on, the **main
conversation agent is read-only**: it may use a fixed set of read/meta tools,
the delegation tools its mode permits, and any extra tools you allowlist for
that project. Everything else is denied. **Subagents keep full access.**

| Mode | Main thread may delegate via | Notes |
|---|---|---|
| `off` | (normal behavior) | default |
| `on` | Agent/Task (any subagent), Workflow | |
| `wf` | Workflow; Agent/Task only for the built-in `Explore` scout | setting it is your standing opt-in to the Workflow tool |
| `pi` | nothing: no Agent/Task, no Workflow | code changes go through the pi-delegate MCP tools or `/pi-delegate:delegate` |

A short reminder, generated from the same tables the enforcer uses, is
injected into the main thread on every prompt while a mode is active.

## Commands

```
/orchestrator-mode:mode on | pi | wf          # switch mode (keeps allowlists)
/orchestrator-mode:mode wf --allowed-models opus,sonnet
                                              # + model allowlist for delegated agents
/orchestrator-mode:mode wf --allowed-models none   # clear the model allowlist
/orchestrator-mode:mode allow mcp__okto-neuron__*  # add a main-thread pattern
/orchestrator-mode:mode disallow mcp__okto-neuron__*
/orchestrator-mode:mode off                   # normal behavior (drops the model allowlist)
/orchestrator-mode:mode status                # effective config: core + user-wide + project
```

The command works while the lock is active: its one Write to the project
config goes through the normal permission prompt.

## Configuration

### Project: `<project>/.orchestrator-mode.json`

```json
{
  "mode": "wf",
  "allowed-models": ["opus", "sonnet"],
  "main-allow": ["mcp__okto-neuron__*", "mcp__plugin_slack_slack__slack_read_channel"]
}
```

- `mode`: `off`, `on`, `pi` or `wf` (case-insensitive). Missing means `off`.
- `allowed-models` (optional): see [Model allowlist](#model-allowlist).
- `main-allow` (optional): extra tools the main thread may use here.

**Lookup.** The hooks walk up from `CLAUDE_PROJECT_DIR` (or the session cwd
when that is unset) and use the nearest directory that holds a config. In
one directory `.orchestrator-mode.json` wins over the legacy one-line
`.orchestrator-mode.state` (`wf allowed-models=opus,sonnet`), which is still
read so existing projects keep working. `/mode` only writes the JSON file;
delete a leftover `.state` by hand.

### User-wide: `$CLAUDE_CONFIG_DIR/orchestrator-mode.json`

Default `~/.claude/orchestrator-mode.json`. It follows `CLAUDE_CONFIG_DIR`, so
each profile has its own. Only `main-allow` is read, and it is added to every
project's list:

```json
{ "main-allow": ["mcp__waha-whatsapp__whatsapp_send_text"] }
```

Edit it by hand; no tool (main thread or subagent) may write it while a mode
is active.

### Patterns

A `main-allow` entry is an exact tool name, or a prefix ending in `*`
(`mcp__okto-neuron__*`). There is no substring or regex matching. A pattern
can name any tool, built-in ones included (`"Bash"`), so be deliberate.

Sending tools that reach other people (a WhatsApp or Slack send, for
example) should also sit in `permissions.ask` of your settings. This hook
only stops blocking a tool; it never approves one.

### Invalid config

- A project config that can't be parsed, or breaks the schema (for example
  `main-allow` not being a list of strings), prints a stderr warning and
  counts as **off**. Unknown keys only warn.
- A broken user-wide file is ignored with a warning, which means fewer tools
  allowed, never more.

## What the main thread may use

**Core, every active mode:**

- read/search: Read, Grep, Glob, LS, LSP, ToolSearch, the MCP resource read tools
- task tracking: TodoWrite, TaskCreate/Update/List/Get/Stop/Output
- web research: WebFetch, WebSearch
- meta: AskUserQuestion, Skill, SlashCommand, Enter/ExitPlanMode,
  SendMessage, ReportFindings, PushNotification, ScheduleWakeup, CronList,
  CronCreate (not `durable: true`), CronDelete
- Artifact (not `action: "delete"`)
- the pi-delegate MCP tools (`mcp__plugin_pi-delegate_pi-delegate__*`,
  `mcp__pi-delegate__*`)

**Plus by mode:** `on` adds Agent, Task and Workflow. `wf` adds Workflow, and
Agent/Task only with `subagent_type: "Explore"`. `pi` adds nothing.

**Plus** the user-wide and project `main-allow` patterns.

**Memory writes.** Write/Edit/MultiEdit/NotebookEdit stay allowed under
`<project>/.remember/` and under the auto-memory dir
`$CLAUDE_CONFIG_DIR/projects/<slug>/memory/`, where `<slug>` follows Claude
Code's rule: every non-alphanumeric character of the project path becomes
`-`, and paths past 200 characters get a hash suffix. The exemption is
refused if any path component from the project/config root down to the
target is a symlink, so a symlinked `.remember` can't widen it.

**Everything else is denied** on the main thread, including Bash, Monitor
(it runs a shell command), Write/Edit elsewhere, and any MCP tool not
matched above. Tool names the plugin has never heard of are denied too.

The Explore scout reached from `wf` is a normal subagent with Claude Code's
Explore toolset, which includes Bash. It is "read-only" by its instructions,
not by this hook.

## Model allowlist

With `allowed-models` set, delegation calls **from any caller**, main thread
or subagent, must name an allowed model:

- **Agent/Task:** a `model` field is required and must match. Forks
  (`subagent_type: "fork"`) are denied, because a fork ignores its `model`
  field and runs on the parent's model. The `Explore` scout under `wf` is
  held to the same rule.
- **Workflow:** every `agent(...)` call in the script must have a `model:`
  option whose value is a string literal on the list. A model passed through
  a variable, or a call with no `model:`, is denied. Comments and string
  contents are ignored when finding calls and options, so `subagent(`, an
  `agent(` inside a prompt, or a `// model: sonnet` comment don't count.
  `scriptPath` must be a regular file under 1 MiB; a named/saved workflow
  (no `script` or `scriptPath`) is denied because it can't be checked.
- **pi_task:** an explicit `model` must match. Omitting it is allowed,
  because pi then uses its own project config, not a choice Claude made.

**Matching:** an entry equals the model id, or is a family name (`opus`,
`sonnet`, `haiku`, `fable`) that appears as a whole token of the id
(`sonnet` matches `claude-sonnet-5-5`), or is an id prefix that ends at a
non-alphanumeric boundary (`claude-opus-5` matches `claude-opus-5-5`, not
`claude-opus-50`). Case-insensitive. Never a substring match, so an entry
`o` does not allow `opus`.

## Protecting the config

While a mode is active the hook denies, for main thread and subagents alike:

- Bash, Monitor or PowerShell commands, and MCP tool inputs, whose text
  contains `orchestrator-mode.` (case-insensitive). A read-only `cat` of the
  config is denied too.
- Write/Edit/MultiEdit/NotebookEdit to any file whose name starts with
  `.orchestrator-mode.` (case-insensitive, in any directory, also when
  reached through a symlink), and to the user-wide config.

The one exception is a **main-thread Write to the project config** (the
`<project>/.orchestrator-mode.json`, or the JSON config the lookup found).
It gets no decision from this hook, so Claude Code shows its normal
permission prompt. That is how `/orchestrator-mode:mode` works under the
lock. Nested config files, which would shadow the root one, are never
writable through it.

## Failure behavior

- Unparseable hook stdin: no-op (nothing to act on).
- Invalid config: warning, treated as off (see above).
- Anything else that goes wrong inside the gate while a mode is active,
  including malformed tool input: **deny** with the error text. A bug here
  should block a call, not let it through.
- The hook only ever emits `deny` or nothing. Emitting `allow` would
  suppress your permission prompts, so it never does.

Set `ORCHESTRATOR_DEBUG=true` for stderr tracing.

## Security model and known limitations

This is a **cooperative guardrail** that keeps a well-behaved main agent in
an orchestrate-and-delegate posture. It is not a sandbox.

- **The toggle is model-serviceable.** The main agent can write `off` to
  the project config. You approve that Write in the normal prompt, **unless**
  your permission mode or rules auto-approve Writes (`acceptEdits`, bypass
  permissions, or `Write` in `permissions.allow`). Then it happens silently.
- **Skills that run as subagents.** `Skill` is allowed on the main thread.
  A skill that runs in a forked subagent gets full subagent access, which
  steps around the `pi`/`wf` delegation limits. The model allowlist still
  applies to delegation calls that subagent makes.
- **Subagents have full access** apart from config protection and the model
  allowlist. In `wf`, that includes the Explore scout.
- **Text checks are best-effort.** Config protection in shell/MCP text and
  the Workflow lint look at literal text. An obfuscated path, or an aliased
  `agent` function, slips through.
- **Memory-exemption false denies.** A target path spelled through a
  different route than the project dir (`/private/tmp/...` vs `/tmp/...`) is
  not recognized and is denied. Use the project-relative path.

## Hooks

- `hooks/enforce-orchestrator.py` (PreToolUse, matcher `.*` so MCP and
  future tools reach it).
- `hooks/inject-reminder.py` (UserPromptSubmit, output wrapped in
  `hookSpecificOutput.additionalContext`).
- `hooks/_state.py`: shared config lookup, tool tables, pattern and model
  matching. `python3 hooks/_state.py status` prints the effective config.

## Tests

```
bash tests/run_all.sh
```

Every case pipes a hook payload into the real script inside a throwaway
project, with `CLAUDE_CONFIG_DIR` pointed at a scratch dir. See CHANGELOG.md
for the end-to-end `claude -p --plugin-dir` checks run for each release.
