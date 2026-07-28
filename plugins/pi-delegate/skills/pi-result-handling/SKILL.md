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
