# pi-delegate

Forward coding work from Claude Code to the locally-installed `pi` CLI
(`@earendil-works/pi-coding-agent`), so it runs on a local model instead of
Claude doing it directly. A zero-dependency stdio MCP server
(`scripts/pi-mcp-server.mjs`) is the facade Claude uses. Each pi child is a
**named background agent** owned by the Claude session that started it, with
tools that mirror Claude's own Agent / SendMessage / TaskStop / ListAgents.
A child can ask Claude a question mid-turn (`ask_parent`) and Claude answers
in the same pi session. It runs on one engine, `scripts/pi-companion.mjs`,
which is also a standalone CLI.

The 0.11 design and the decisions behind it are in
[docs/adr-006-native-surface.md](docs/adr-006-native-surface.md).

## Commands

- `/pi-delegate:agents`: opens a native interactive pane (Claude Code >=
  2.1.287, mods enabled, terminal/Desktop). Lists every pi agent in this
  project grouped Needs input / Working / Idle / Ended, one line each, with an
  inline answer card for a waiting agent. Enter opens Result (Markdown),
  Activity (paired tool steps), Log (events as sentences) and Questions tabs;
  `s` opens `/config`-style Settings for all six delegation settings (scope
  select, validated inline edits, confirmed reset, read-back saves). Every key
  shown is a hotkey; inline, Esc steps back before it closes. A band above the
  prompt shows live agents (`ctrl+x tab` then Enter opens the pane), and done/failed/question events add a
  transcript line and a toast. Reads never invoke MCP or consume events; Stop
  (confirmed), messages and answers go through the existing MCP tools with
  normal permission prompts, and the server decides ownership (its refusal is
  shown in plain words). Without plugin hooks modules, the same command
  displays a compact read-only snapshot. See [pane design](docs/agents-viewer.md).
- `/pi-delegate:delegate <task>`: helps decompose `<task>` into
  independently-verifiable steps and dispatches each through the MCP tools.
  `pi` is often a smaller/local model: narrow, well-scoped steps succeed far
  more reliably than one open-ended ask (see `commands/delegate.md`, "Task
  sizing"). You can also call the tools directly.
- `/pi-delegate:setup`: checks that `pi` is on PATH, reports its version and
  `defaultProvider`/`defaultModel` from `~/.pi/agent/settings.json`, offers to
  install it after confirmation, and views/sets/clears the per-project
  provider/model pin.

## MCP tools

| Tool | Mirrors | Purpose |
|---|---|---|
| `pi_agent` | Agent | Start a named child (`prompt`, `name?`, `description?`, `run_in_background?` default true, `tools?`, `exclude_tools?`, `ask?` default true, `thinking?`, `turn_timeout_ms?`; `provider?`/`model?` only when no pin exists). A running or waiting name is refused; an idle or finished one is taken over as a new generation. |
| `pi_send_message` | SendMessage | `{to, message, interrupt?, mode?}`. Running: steer (or `follow_up`). Idle: new turn. Parked/stopped/failed: respawn on the recorded launch, same session and model. Blocked on a question: refused with the full question. `interrupt:true` pre-answers pending questions, drops queued steers (`dropped_queue`), aborts and prompts. |
| `pi_answer` | reply to a question | `{to, answer, question_id?, relay_user?}` for an `ask_parent` question, or `value`/`confirmed`/`cancelled` for a `d_*` extension dialog. Reports `picked up` once the child confirms, and lists sibling questions still pending. |
| `pi_stop` | TaskStop | `{name, forget?}`. Pre-answers, clears the queue, aborts, kills the process group. The session is kept; `pi_send_message` resumes it. `forget:true` deletes every generation's session files and frees the name. |
| `pi_list_agents` | ListAgents | Header (pi version, pin, wake mode, live count, `wait armed`) plus one row per child. Inlines your children's unhandled events. `{name}` for one child in detail, `{doctor:true}` for readiness checks, `{confirm_push}` for the push check. |
| `pi_read` | TaskOutput | `{name, what?, gen?, turn?, last?}`: `result` (default), `transcript` or `events`. Never starts pi. |
| `pi_wait` | (recovery) | Re-arms the wake after compaction, a restart or a cancelled call. Only needed when a result or the header says `wait armed: no`. |

Every by-name tool accepts `name`, `to` or `task_id`, strips a leading `pi:`
and lowercases, so `pi:auth-fix` copied from a push resolves. Names match
`^[a-z][a-z0-9_-]{0,31}$`.

The server's `instructions` tell Claude that pi children are not native agents
(native SendMessage, TaskStop and ListAgents can't see them), how to answer the
push check, and to call `pi_list_agents` after compaction.

### Renamed in 0.11

The 0.10 names are not listed anymore. Calling one returns
`renamed, use <new call>`.

| 0.10 | 0.11 |
|---|---|
| `pi_task` | `pi_agent {run_in_background:false}` |
| `pi_conversation_send[_async]` | `pi_agent` (new child) / `pi_send_message` (existing) |
| `pi_conversation_steer` | `pi_send_message` |
| `pi_conversation_interrupt` | `pi_send_message {interrupt:true}` |
| `pi_respond` | `pi_answer {question_id:"d_..."}` |
| `pi_conversation_read` | `pi_read` |
| `pi_conversation_status`, `pi_setup` | `pi_list_agents {name}` / `{doctor:true}` |
| `pi_conversation_end` | `pi_stop {forget:true}` |
| `pi_wait_event` | `pi_wait` |

## Waking Claude

Two modes, picked per server lifetime:

1. **Channel push (confirmed).** The server declares the `claude/channel`
   capability and pushes `notifications/claude/channel` events (`question`,
   `done`, `failed`). Line 1 is a terminal echo like
   `[pi:auth-fix] DONE turn 3 ok · 41s`; the `<pi-agent-event>` block below it
   has the result (up to 4000 chars), notes and the controls to use. Claude
   Code only delivers these when the session enabled the channel; during the
   research preview that's
   `claude --dangerously-load-development-channels plugin:pi-delegate@<marketplace>`
   (`plugin:pi-delegate@inline` with `--plugin-dir`). On the first `pi_agent`
   the server pushes a data-only probe; Claude answers with
   `pi_list_agents {confirm_push:<nonce>}`, and from then on `pi_agent`
   returns at once and says `Do not poll.` While the flag is there but the
   probe isn't confirmed yet (`wake: channel?`), `pi_agent` also returns at
   once: a blocked call would hold the probe back, and Claude Code queues a
   `confirm_push` behind it. If no probe shows up with that result, call
   `pi_wait {name}`; the events stay unconsumed until confirmed.
2. **Fallback (no channel, `-p`, or not confirmed yet).** The call that hands
   a child control (`pi_agent`, a turn-starting `pi_send_message`,
   `pi_answer`) stays open until that child finishes or asks, sending
   progress every 20s. Claude Code moves it to the background after
   `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS` (about 2 min by default) and wakes
   Claude with a task-notification when it returns. Each child holds its own
   wait, so nothing needs re-arming. Stopping that background task only drops
   the wake; the child keeps running (use `pi_stop`).

`PI_DELEGATE_WAKE=channel|fallback` overrides detection.
`pi_list_agents {doctor:true}` shows the wake mode, what the parent's argv
suggested, the push-check state and the effective auto-background threshold.

Events are written to the child's `events.jsonl` before any push. An event
counts as handled once a confirmed push or a tool response carrying it has
been written, so a cancelled call loses nothing. Before confirmation a
fallback return may repeat a push and marks it `(also pushed HH:MM:SS)`.

## pi asks, Claude answers (`ask_parent`)

Children run the pi-side `@maheidem/pi-delegate` package
(`~/.pi/agent/npm/node_modules/@maheidem/pi-delegate`, loaded with `-e`) in
child mode (`PI_DELEGATE_CHILD=1`, `PI_DELEGATE_ASK_DIR`), unless `ask:false`.
That gives the child an `ask_parent` tool: `kind: "question"` blocks it until
an answer file `<askDir>/<toolCallId>.json` appears; `kind: "note"` is a
non-blocking FYI that rides along on the next event. When `tools` is given,
`ask_parent` is added to the `-t` list; `exclude_tools: ["ask_parent"]` turns
asking off. The package's `handoff` tool is always excluded.

- `pi_answer` writes `{answeredBy, answeredAt, answer}` atomically (tmp +
  rename, 0600) and reads it back. `answeredBy` is `model`, or
  `model (relaying user)` with `relay_user:true`. Use that only for the
  user's reply to an AskUserQuestion about that question (an approval or
  opinion that changes scope). An answer the user dictated in advance, e.g.
  in the prompt that started the child, is the model's: `relay_user` false.
- **Expiry is the server's.** The child's own cap is 4h. The server's timer
  (`question_wait_minutes`, default 10 min) starts once the question has been
  shown to Claude; on expiry it answers with the fallback text as
  `model (timeout)` and a later `pi_answer` is refused.
- **Budget per turn:** `questions_per_turn`, default 5. The next
  question in that turn gets an immediate "budget exhausted" answer. A new
  turn starts the count over.
- Several questions can be pending at once; then `pi_answer` needs
  `question_id`. Any toolCallId routes (nested ids get nested dirs); an id
  that would escape the ask dir becomes a visible `failed{question_unroutable}`
  event.

## Lifecycle and storage

`spawning -> running <-> waiting -> idle`. An idle child is parked after
`idle_park_minutes` (default 5) or when the live cap
(`max_live_children`, default 4) needs room; a crash, error or
`turn_timeout_ms` gives `failed`; `pi_stop` gives `stopped`. A child is never
reaped mid-turn or while waiting, and its turn clock pauses while a question
is pending. `pi_send_message` brings any of those back on the same session.

Per child, under
`${CLAUDE_PLUGIN_DATA}/projects/<cwd-slug>/children/<name>/`:
`meta.json` (state, launch record, `consumed_seq`; written tmp+rename and read
back), `events.jsonl` (append-only, per-child seq) and
`results/<gen>-<turn>.md` (full final text). The pi session id is
`<name>-g<gen>-<store id>`; the store id keeps two plugin data stores in one
project (installed copy and `--plugin-dir`, or two profiles) from touching
each other's sessions. Old generations and stopped sessions stay on disk until
`pi_stop {forget:true}`.

**Ownership.** The child's lock is taken before launch and held for the
process lifetime. Another Claude session in the same project sees the child
read-only and gets an owner error from every tool that would change it.

**Restarts.** On start the server skips children whose owning server is still
alive. Orphans of a dead server are killed, their open questions close as
`question_expired{orphaned}`, and running/waiting records become
`failed{orphaned}`; that event is pushed or shown on the next listing. A
server `kill -9` takes the child with it (pi exits on stdin EOF); any toolCall
left without a toolResult is paired in the session file before resume, and
the child resumes by name.

## Lean children

Every pi child starts with `--no-extensions --no-skills
--no-prompt-templates --no-context-files`, then `-e` for exactly:

- the extension(s) that supply the provider it runs on, found by probing
  `pi --list-models` with and without each configured package, once per
  server process (e.g. `mac-m3` needs `@maheidem/model-discovery`);
- the project pin's opt-in `extensions:` list;
- the pi-side delegate package, for `ask_parent`.

This needs pi >= 0.99.0 (the lean flags only drop built-in extensions from
then on); the server refuses to launch on an older pi.

Measured 2026-09-30 on pi 0.99.1, `mac-m3/qwen3.8-flash@adaptive`, prompt
"reply with the word PONG": full load 86,973 context tokens / 8.7s; lean
1,940 tokens / 5.0s cold, 0.8s warm.
`PI_DELEGATE_PROVIDER_EXTENSIONS=none|<spec,...>` overrides the probe.

Before the spawn, a `get_state` handshake checks the model pi actually loaded;
a silent fallback to another model fails the call at once.

**Env scrub.** Claude's messaging, session, plugin and OAuth variables, plus
secret-shaped and remote/bridge/host `CLAUDE_CODE_*` names, never reach the
child. `ANTHROPIC_*` is dropped too unless the child may run on the anthropic
provider.

## Per-project pin

`.claude/pi-delegate.local.md` (YAML frontmatter):

```markdown
---
provider: mac-m3
model: qwen3.8-flash@adaptive
extensions: pi-rtk-optimizer, @maheidem/pi-thinking-saver
---
```

With a pin, `pi_agent` doesn't offer `provider`/`model` at all and rejects a
value that differs from the pin. Without one, an explicit value wins, then
pi's global default. A resume always uses the model recorded at launch;
`pi_list_agents` flags drift from the current pin. `extensions` takes package
names (resolved under `~/.pi/agent/npm/node_modules`), absolute paths, or
`builtin:<name>`; unresolvable entries are skipped and reported in
`warnings`. `/pi-delegate:setup` writes provider/model from the real
`pi --list-models` list so a typo can't be pinned.

## Env tunables

| Variable | Default | Effect |
|---|---|---|
| `PI_MCP_REAP_INTERVAL_MS` | 60000 | reaper tick |
| `PI_DELEGATE_WAKE` | (detected) | force `channel` or `fallback` |
| `PI_DELEGATE_PROVIDER_EXTENSIONS` | (probed) | `none` or a list of provider packages |

## CLI (`pi-companion.mjs`)

`task`, `setup`, `list-models`, `write-config`, `remove-config`, and
`conversation start|send|status|end|read|steer|interrupt`. The CLI
conversation path spawns one `pi --mode rpc --session-id <name>` per `send`
(continuity via pi's session file; steering through a turn-scoped FIFO). The
MCP server doesn't use these verbs; it keeps its children alive itself. Both
share the RPC completion path (`agent_settled` + `get_last_assistant_text`),
the lean launch, the env scrub and group-kill on timeout.

## Relationship to orchestrator-mode

This plugin doesn't know about orchestrator-mode. orchestrator-mode allowlists
the prefixes `mcp__plugin_pi-delegate_pi-delegate__*` and `mcp__pi-delegate__*`
on the main thread in every active mode, so a locked main agent can still
delegate here. Its `pi` mode additionally denies Task/Agent, making these
tools the only way to get code changed, and locks `pi_agent` to the project
pin.

## Tests

```bash
bash plugins/pi-delegate/tests/run_all.sh
```

Native viewer tests (no sign-in, model, or network):

```bash
claude plugin test plugins/pi-delegate
```

Bash-driven suites run the real server/CLI against stub `pi` executables
(`tests/stubs/`), plus real-pi suites that skip only when `pi` (or the pi-side
package) is absent: `test_task_e2e_real.sh`, `test_conversation_e2e_real.sh`
(CLI path), `test_mcp_send_e2e_real.sh` and `test_mcp_ask_e2e_real.sh` (MCP
server: a real child asks for a secret word and must reply with the answer).

## Docs

`docs/adr-006-native-surface.md` (the 0.11 tool surface, wake and decisions),
`docs/architecture.md` (ADR-001, the RPC engine and its history),
`docs/adr-002-mcp-facade.md`, `docs/adr-003-mcp-only.md`,
`docs/adr-005-async-dispatch.md`, and `CHANGELOG.md`.

## Profile and project delegation settings

Settings use `.claude/pi-delegate.local.md` frontmatter (project), then
`$CLAUDE_CONFIG_DIR/pi-delegate.json` (profile; defaults to
`~/.claude/pi-delegate.json`), then the built-in default. Invalid values warn
and fall through. No dependencies or pi-global settings changes.

| Key / CLI flag (replace underscores with hyphens) | Values | Default |
|---|---|---|
| `questions_per_turn` | integer 0..100 or `unlimited` | 5 |
| `turn_timeout_minutes` | integer 1..1440 or `unlimited` | 60 |
| `question_wait_minutes` | integer 1..1440 | 10 |
| `max_live_children` | integer 1..16 | 4 |
| `idle_park_minutes` | integer 1..1440 or `never` | 5 |
| `default_thinking` | off, minimal, low, medium, high, xhigh, max, pi-default | pi-default |

`0` questions auto-answers every question as exhausted; notes are unaffected.
`unlimited` removes the server turn/question cap, not the child's existing
hard ask cap. Turn clocks still pause while questions are pending. Explicit
`pi_agent.turn_timeout_ms` / `thinking` override their configured defaults.
Question budget is captured each turn; server values refresh at spawn/turn.
Existing children retain their launch thinking level on resume.

```bash
node scripts/pi-companion.mjs write-config --scope project --questions-per-turn 2 --turn-timeout-minutes unlimited --json
node scripts/pi-companion.mjs write-config --scope user --idle-park-minutes never --json
node scripts/pi-companion.mjs write-config --scope project --questions-per-turn inherit --json
node scripts/pi-companion.mjs setup --json
```

`inherit` removes only that key. Writes preserve other keys and project body.
Write provider/model separately; pin writes/removal preserve settings.
Shared API: `scripts/question-settings.mjs` exports `resolveSettings`,
`writeSettings` and `SETTINGS`. Setup JSON's `delegateSettings` and MCP
header/doctor expose values, sources, paths and warnings. `/pi-delegate:setup`
offers these settings independently of the provider/model picker.

**Test-only:** `PI_MCP_TEST=1` enables legacy `PI_MCP_TTL_MS`,
`PI_MCP_REGISTRY_CAP` and `PI_MCP_ASK_TIMEOUT_MS` overrides for fast timing tests.
The header/doctor visibly reports test mode. These variables are otherwise
ignored; `PI_MCP_ASK_MAX_PER_TURN` is always ignored.
