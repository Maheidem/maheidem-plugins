# ADR-003: MCP-Only Delegation -- Remove the Subagent, Relocate the Phrasing Contract

**Status:** Implemented, 2026-07-29.
**Owner:** maheidem
**Depends on:** ADR-002 (`adr-002-mcp-facade.md`) -- the MCP facade shipped in 0.8.0.

## 1. Context

Once the MCP facade (ADR-002) shipped, the `pi-delegate:delegate` subagent
and its two attached skills (`pi-cli-runtime`, `pi-result-handling`) kept
existing alongside it as a second delegation path. In practice, once MCP
tools became available mid-session, every subsequent delegation went
straight through `mcp__plugin_pi-delegate_pi-delegate__pi_task` -- the
subagent was never invoked again. Its two skills only ever load when the
subagent itself runs, so from that point on they were dead weight: prose
nobody was reading.

Separately, this session observed Claude drifting into handing pi
fully-formed literal bash commands instead of goals -- effectively using pi
as "glorified bash." Root cause: `commands/delegate.md`'s "Delegation
Contract" point 1 ("give pi exact content, exact anchor lines, exact
commands... do the design yourself, delegate the transcription"). That
phrasing was written for `orchestrator-mode`'s adversarial `pi` state
(Claude can't verify pi's work there, so it must be treated as an untrusted
executor), but it had become the universal default for all delegation,
including ordinary MCP calls where Claude reads pi's diff directly and can
verify it.

Three independent reviews (Fable 5, Codex, and `pi` itself, asked directly)
converged on a replacement phrasing contract, and on stepping back further,
converged on the conclusion that the subagent no longer earns its keep: it
adds a model hop (`agents/delegate.md` pinned `model: sonnet`) for a benefit
(keeping pi's raw output out of the main thread) that `pi_task`'s 10KB-capped
result already provides.

## 2. Decision

- **D3-A Remove the subagent and its two skills entirely.** `agents/delegate.md`,
  `skills/pi-cli-runtime/SKILL.md`, `skills/pi-result-handling/SKILL.md` are
  deleted. All 22 existing test suites exercise `pi-companion.mjs`/
  `pi-mcp-server.mjs` directly via stubbed `pi` processes, none reference the
  subagent's prompt text, so removal is test-safe.
- **D3-B Relocate the per-call phrasing contract into the MCP tool
  descriptions themselves** (`pi_task`, `pi_conversation_send` in
  `scripts/pi-mcp-server.mjs`). This is where it actually governs behavior --
  most real usage is ad-hoc MCP calls, not the command path.
- **D3-C Narrow `/pi-delegate:delegate` to task-sizing/decomposition only.**
  It still helps break large asks into small, independently-verifiable
  steps and dispatches them via the MCP tools, but no longer duplicates the
  phrasing contract or routes through a subagent.
- **D3-D Defer the async/fire-and-forget conversation redesign.**
  `pi_conversation_send` still blocks on `waitSettle` before the MCP
  `tools/call` response returns. That's real "waiting battle" friction, but
  changing the concurrency model is a separate design decision deserving its
  own ADR, not bundled into this removal. Tracked here so it isn't lost.

## 3. New phrasing contract (replaces the old five-point Delegation Contract)

Encoded directly in the `pi_task`/`pi_conversation_send` tool descriptions:

- Keep for yourself: architecture decisions, irreversible or
  externally-consequential choices, and anything a not-yet-dispatched step
  depends on.
- Otherwise delegate the GOAL, not the diff: name the files/surface pi may
  touch and what's off-limits, state invariants, give an acceptance check,
  say whether the approach is pi's call or a specific pattern.
- State scope explicitly (bug-fix vs feature-design vs refactor) whenever
  it isn't obvious -- ambiguity about decision ownership was the actual
  root cause of the bash-command drift this ADR responds to.
- Go fully literal only when nothing is left to decide (applying an
  already-written diff, a version bump, an evidence-gathering command).

The old five-point "Delegation Contract" (spec to near-determinism, one
atomic step, ask for evidence not conclusions, audit every claim, bound
everything) remains the right model for `orchestrator-mode`'s `pi` state,
where Claude genuinely cannot verify pi's work directly. It is not
appropriate as the universal default, which is what this ADR corrects.

## 4. Consequential changes

`orchestrator-mode`'s `handle_pi_mode` special-cased Task/Agent to allow only
`subagent_type == "pi-delegate:delegate"`. With the subagent gone, that
branch has no valid target; Task/Agent now falls through to a generic deny
that points at the MCP tools as the primary path. See that plugin's own
changelog/tests for the corresponding update -- functionally the same deny
boundary, simplified code, corrected message.

## 5. Deferred, not dropped

`pi_conversation_send` blocking on `waitSettle` inside a single `tools/call`
means a long-running conversational turn ties up that call for its full
duration. Splitting dispatch from settle-detection (e.g. an async send that
returns immediately plus a poll/notify path) is real future scope. Not
addressed here -- needs its own ADR once the concurrency model is designed
deliberately rather than as a side effect of a cleanup pass.
