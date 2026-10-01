# Changelog

Earlier versions have no changelog; see `git log -- plugins/pi-delegate`.

## 0.11.0 (2026-10-01)

pi children now behave like Claude's own background agents. Design and
decisions: `docs/adr-006-native-surface.md`. Version not bumped yet.

### Changed (breaking)
- **New tool surface, clean break.** Seven tools mirror Claude's primitives:
  `pi_agent` (Agent), `pi_send_message` (SendMessage), `pi_answer` (reply to a
  question), `pi_stop` (TaskStop), `pi_list_agents` (ListAgents), `pi_read`
  (TaskOutput) and `pi_wait` (recovery re-arm only). The 0.10 names
  (`pi_task`, `pi_conversation_*`, `pi_respond`, `pi_setup`,
  `pi_wait_event`) are no longer listed and return
  `renamed, use <new call>`. Mapping in the README.
- **Stop keeps the session.** `pi_stop` pre-answers, clears the queue,
  aborts and kills the process group; `pi_send_message` resumes on the same
  session and recorded model. `pi_stop {forget:true}` deletes the sessions.
- **Reusing a name takes it over** as a new generation (session
  `<name>-g<gen>-<store id>`). The old generation stays readable with
  `pi_read {name, gen}`. A running or waiting name is refused.
- **Every child has a session and `ask_parent`** unless `ask:false`. With
  `tools` given, `ask_parent` is added to `-t`.
- **A message to a child blocked on a question is refused** and shows the
  full question; `interrupt:true` pre-answers it, sends `clear_queue`
  (dropped steers are listed in `dropped_queue`), aborts and prompts.
- **The child env is scrubbed**: Claude's messaging, session, plugin, OAuth
  and other secret-shaped `CLAUDE_CODE_*` variables are removed;
  `ANTHROPIC_*` too unless the child may run on the anthropic provider.
- **The ask budget is per turn and the server owns expiry.**
  `PI_MCP_ASK_MAX_PER_TURN` (default 5) replaces `PI_MCP_ASK_MAX`. The
  child's own limit is 4h; the server's `PI_MCP_ASK_TIMEOUT_MS` timer
  (default 10 min) starts once Claude has seen the question.
- **The lock is held for the child's process lifetime**, taken before
  launch. Another Claude session sees the child read-only and gets an owner
  error from mutating tools.
- **pi >= 0.99.0 is required** (the lean flags only drop built-in extensions
  from 0.99.0). Older pi fails the launch with a clear error.

### Added
- **Wake without polling.** With a confirmed channel, events (`question`,
  `done`, `failed`) arrive as `notifications/claude/channel` pushes and
  `pi_agent` returns at once. Confirmation is a data-only probe that Claude
  answers with `pi_list_agents {confirm_push}`, or implicitly. While the
  flag names the channel but the probe isn't confirmed yet, `pi_agent` also
  returns at once (`wake: channel?`), since a blocked call holds the probe and
  any `confirm_push` back. Without a
  channel, the call that handed the child control stays open until its next
  event and Claude Code backgrounds it, so each child carries its own wake.
  `PI_DELEGATE_WAKE=channel|fallback` overrides detection.
- **Durable events.** Per-child `events.jsonl` with a per-child seq,
  `meta.json` (read back after every write) and `results/<gen>-<turn>.md`
  under the plugin data dir. An event counts as handled only once a push or
  a tool response carrying it has been written.
- `pi_list_agents` header (pi version, pin, wake mode, live count,
  `wait armed`), per-child detail with `{name}`, readiness checks with
  `{doctor:true}` (including the effective
  `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS`).
- `pi_answer` reports `picked up` only once the child confirms, lists
  sibling questions still pending, folds in the old `pi_respond` dialog path
  (`d_*` ids), and supports `relay_user:true` (`answeredBy: "model (relaying
  user)"`; the server never writes `"user"`). `relay_user` is only for the
  user's reply to an AskUserQuestion about that question; an answer the user
  dictated up front is recorded as `model`.
- Model handshake: `get_state` before the first prompt fails the spawn when
  pi loaded a different model than requested.
- Server `instructions`: pi children are not native agents, the push-check
  protocol, the question routing policy, and "call `pi_list_agents` after
  compaction".
- The tool schemas hide `provider`/`model` when a project pin exists, and a
  mismatching value is rejected.
- **Lean children.** Every child starts with `--no-extensions --no-skills
  --no-prompt-templates --no-context-files` plus `-e` for the extension that
  supplies its provider (auto-probed), the pin's `extensions:` opt-in list,
  and the pi-side package. Measured on the local default model: 86,973 ->
  1,940 context tokens for a one-word task.
  `PI_DELEGATE_PROVIDER_EXTENSIONS` overrides the probe.
- Results report `usage` (tokens from `get_session_stats`).
- **pi asks, Claude answers.** Children load the pi-side
  `@maheidem/pi-delegate` package in child mode and get its `ask_parent`
  tool; Claude answers with `pi_answer` in the same pi session. Any pi
  toolCallId routes (nested ids such as `<id>/1` get nested dirs); an id that
  would escape the ask dir becomes a visible `failed{question_unroutable}`
  event.
- **Restart recovery.** On start the server only touches children whose
  owning server is dead: it kills orphans, closes their open questions as
  `question_expired{orphaned}` and reports `failed{orphaned}`. A toolCall
  left without a toolResult (server `kill -9`, child killed) is paired in the
  session file before pi reloads it, and the child resumes by name.

### Fixed
- A missing `pi` (spawn `ENOENT`) crashed the MCP server; it now returns an
  error.
- The idle reaper no longer kills turns in flight or children waiting on a
  question; cap eviction parks the least recently used idle child.
- The live child's stderr is drained (last 10 KB kept for errors), so a
  chatty child can't block on a full pipe.
- Session files are resolved through pi's agent dir (`PI_CODING_AGENT_DIR`)
  everywhere.

### Removed
- `pi_task`'s stateless `--no-session` mode; a blocking one-shot is
  `pi_agent {run_in_background:false}` and keeps a session.
