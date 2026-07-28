---
name: pi-result-handling
description: Internal guidance for presenting pi-companion output back to the user
user-invocable: false
---

# pi Result Handling

When the helper returns pi's result:

- Preserve pi's output verbatim. Do not paraphrase, "clean up", summarize, or
  editorialize what pi did or said — the whole point of delegation is that pi
  did the work, not Claude.
- If pi made edits or ran tool calls, report that as pi reported it. Do not
  independently re-verify the result by reading the touched files "just to
  check" — that defeats the purpose of delegating in the first place.
- `finalText` is pi's actual answer — present that. `summary` and `nextSteps`
  are completion-report metadata about the work; relay `nextSteps` if present,
  but don't substitute `summary` for the answer when `finalText` exists.

## Degraded success

When the result has `ok: true` **and** `degraded: true` (usually with
`markerMissing: true`), pi's completion report was missing or malformed but
the output stream showed a clean run. Present this as a success **with a
caveat**: "completed, but the completion report was missing — verify the work
before relying on it." Do not treat it as a failure, and do not present it as
a clean success either; pass the caveat (and any `warning` field) through to
the user.

When `markerExitMismatch: true` (`ok: false`), pi's completion report claimed
success but the process exited nonzero. Present it as a **failure** and call
out the mismatch explicitly — the exit code wins.

## Conversation results (`conversation start|send|status|end`)

These follow the same overall presentation rules above — relay `finalText`
verbatim, don't re-verify pi's work. Two things are specific to this path:

- **Lock contention is a distinct, expected failure mode, not a pi bug.**
  When a result has `ok: false` and `lockHeldByPid` set, another process is
  already mid-conversation on that same name. Tell the user exactly that —
  "conversation `<name>` is currently in use by another process (pid
  `<lockHeldByPid>`) — try again once it finishes" — rather than implying pi
  itself failed or that something is broken. Don't retry automatically and
  don't fall back to `task`; the caller asked for the stateful conversation
  specifically.
- **No completion-marker fields apply here.** `markerMissing`,
  `markerExitMismatch`, `completionMarker`, and `progressLogPath` are always
  empty/`false`/`null` on `conversation` results — don't mention them or
  treat their absence as a problem.

### `read` / `steer` / `interrupt` results

- **`read`** is a status peek, not a completion — present its rendered
  transcript as-is (file order, not re-sorted), and pass through any
  `warning` about ambiguous session-file matches or unparseable lines
  verbatim rather than silently dropping it. A `(pending)` tool-call entry
  means that turn is still in flight, not an error — don't describe it as
  one.
- **`steer` / `interrupt` returning `ok:true, queued:true`** means the
  message was handed off, not that pi has acted on it yet — say "queued" or
  "sent", not "done". For `steer`, mention that delivery happens at the next
  turn boundary, not instantly. For `interrupt`, the *eventual* `send`
  result's `finalText` — not the `interrupt` call's own result — is where
  the actual outcome shows up; if the caller is watching a backgrounded
  `send`, point them at that result once it lands.
- **`ok:false, errorMessage: "conversation is idle — use send"`** is an
  expected, non-error outcome when nothing is running for that name — tell
  the user there's no live turn to steer/interrupt and that a `send` needs
  to be started (or is still starting up) first, not that something broke.

## Evidence vs. judgment

pi's reports mix two different things: **evidence** (command output, diffs, exit
codes, file paths) and **judgment** (claims like "done", "verified",
"pre-existing", "unrelated", "harmless"). Present the evidence upward verbatim;
present the judgments as *pi's unaudited assessment*, never as established fact.
The orchestrator — not pi, and not this skill — owns attribution, severity, and
scope decisions. If a result contains a judgment the caller is likely to act on
(e.g. "these failures are pre-existing"), flag it explicitly as unverified.

## On failure

Failure includes any of:
- pi not installed / not on PATH (`ENOENT`)
- pi timed out (if the result includes `progressLogPath`, mention it — that
  retained log shows how far pi got before the kill; if a `completionMarker`
  was still captured, relay its summary with the "treat with caution" caveat
  from the error message)
- a result with `ok: false` (including `stopReason: "error"` from pi itself,
  and `markerExitMismatch: true` runs)

When any of these happen:

- STOP. Surface the failure clearly, including the helper's `errorMessage`.
- Point the user at `/pi-delegate:setup` to diagnose and fix the pi
  installation/configuration.
- **Never silently fall back to doing the coding work in Claude instead.**
  Falling back defeats the entire purpose of delegating to pi — if that
  happens, the user has no way to know the local model never actually ran.
- Do not retry with a different approach, a different model, or by inspecting
  the repo yourself. Report the failure and stop there.
