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

## On failure

Failure includes any of:
- pi not installed / not on PATH (`ENOENT`)
- pi timed out
- a result with `ok: false` (including `stopReason: "error"` from pi itself)

When any of these happen:

- STOP. Surface the failure clearly, including the helper's `errorMessage`.
- Point the user at `/pi-delegate:setup` to diagnose and fix the pi
  installation/configuration.
- **Never silently fall back to doing the coding work in Claude instead.**
  Falling back defeats the entire purpose of delegating to pi — if that
  happens, the user has no way to know the local model never actually ran.
- Do not retry with a different approach, a different model, or by inspecting
  the repo yourself. Report the failure and stop there.
