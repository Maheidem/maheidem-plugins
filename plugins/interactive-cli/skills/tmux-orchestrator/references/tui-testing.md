# TUI Testing — Driving Interactive Terminal Apps for End-to-End Tests

Absorbs content from the deprecated `terminal-testing` skill — broadened to "any TUI /
REPL", not just pi. Re-validated against tmux 3.6a on this host.

Use this reference when you need to programmatically drive `vim`, `htop`, `pi`, `claude`,
`python` REPL, `node` REPL, `ssh` to a remote prompt, or any app that has no headless
mode.

## Core test loop

```
1. Create isolated tmux session (unique name; mktemp -d cwd if write tests)
2. Launch the TUI in pane.0
3. Wait for prompt-readiness (poll capture-pane, don't sleep blindly)
4. Drive: send keystrokes (Bash `tmux send-keys`)
5. Capture and assert:
     a) pane content via capture-pane    — for UI verification
     b) on-disk files via Bash           — for state verification (more reliable)
6. Tear down: kill-session (always, via EXIT trap if scripting)
```

## Prompt-readiness polling

TUI apps don't announce readiness. Naive `sleep 2` is flaky and wasteful. Poll for a
specific glyph plus a quiet period.

```bash
# Pseudocode
prev=""; quiet=0
for _ in {1..60}; do
  cur=$(tmux capture-pane -p -t %0 | tail -3)
  if [[ "$cur" == "$prev" ]] && echo "$cur" | grep -qE '<prompt-regex>'; then
    (( ++quiet >= 2 )) && break
  else
    quiet=0
  fi
  prev="$cur"
  sleep 0.5
done
```

The `scripts/wait-for-pane-text.sh` helper is the canonical version of this loop. App
glyphs to use:

| TUI | Readiness regex |
|---|---|
| zsh / bash | `[%$#] *$` |
| python REPL | `^>>> $` |
| node REPL | `^> $` |
| pi.dev | `^─+$` (two divider lines around the input field) |
| claude code | `^> *$` after banner |

**Startup gates precede the prompt.** Many TUIs show a one-time dialog before the input
field: `claude` asks "Allow external CLAUDE.md imports?" and other trust prompts, `ssh`
asks for host-key confirmation. These are *also* idle states, so a readiness poll can fire
on the dialog and you'll send your task into a gate. After readiness, capture with `tmux
capture-pane -p -e -t %0 -S -200` (the `-e` keeps color/escape so box-drawing dialogs are
legible — plain capture can render a full-screen dialog as blank lines) and confirm you're
at the real prompt. Answer any gate first (usually `Enter` for the default), then re-poll.

**Don't know the ready glyph?** Use `scripts/wait-for-idle.sh <target>` — it declares
ready on content *stabilization* (no change for N polls) instead of a regex. Robust for
unfamiliar apps, but it cannot tell an idle prompt from an idle dialog (see the gate note
above), so still verify with an `-e` capture.

**Inside Claude Code's Bash tool, foreground `sleep` is blocked.** The poll loops in this
doc assume a plain shell. When driving from a Claude session, run the wait loop as a
`run_in_background` Bash command (it re-invokes you on exit) or via the Monitor tool — not
a blocking foreground `sleep`.

## Two assertion channels (and which to trust)

| Channel | Reliable for | Pitfalls |
|---|---|---|
| Pane content (`capture-pane`) | UI presence (banner, error message, status bar) | Long output scrolls off; redraws may swallow transient messages; ANSI codes add grep noise |
| On-disk files (`ls`, `cat`, `jq`, `grep`) | State changes (config written, log appended, side-effect produced) | Race with async writes; use `wait-for` or poll until present |

**Channel 2 is more reliable for state.** Channel 1 is for "did the TUI render the right
thing?"; channel 2 is for "did the TUI actually do the thing?".

## Multi-pane observability

For real-LLM or long-running tests, split the window so logs are visible alongside the
app:

```
pane.0 : app under test (pi, REPL, etc.)
pane.1 : tail -F .scratchpad/orchestration-ledger.jsonl
pane.2 : tail -F .memory/_changelog.jsonl
pane.3 : tail -F ~/.pi/agent/sessions/<sanitized-cwd>/*.jsonl   # pi only
```

```bash
tmux split-window -t my-test -v -l 30%
tmux send-keys -t my-test.1 'tail -F /tmp/build.log' Enter
tmux split-window -t my-test.1 -h
tmux send-keys -t my-test.2 'watch -n 1 ls /tmp/done-markers/' Enter
```

Drive only pane.0; capture all panes after each step for postmortem on failure.

## Token-cost discipline

`capture-pane -p` of a wide terminal with full scrollback can be 5-10k tokens.

- Bound captures: `tmux capture-pane -p -S -50` (last 50 lines).
- For loops: re-capture only `tail -5`.
- Postmortem only: dump full scrollback to a file with `capture-pane -S - -b X &&
  save-buffer -b X /tmp/snap.txt`, then `Read` the file with `offset`/`limit`.

## Cleanup-on-failure pattern (bash)

```bash
session="t-${id}-$$"
test_dir="/tmp/t-${id}-$$"
mkdir -p "$test_dir"

cleanup() {
  tmux kill-session -t "$session" 2>/dev/null || true
  # Keep $test_dir for postmortem if test failed; uncomment to clean:
  # rm -rf "$test_dir"
}
trap cleanup EXIT

tmux new-session -d -s "$session" -c "$test_dir"
# ... test body ...
```

For Claude-driven (interactive) tests, manually `kill-session` when investigation
completes. Run `tmux list-sessions` between runs to detect orphans.

## Completion detection — the sentinel-in-scrollback trap

A reliable way to know a long agent turn finished: tell the driven app to print a unique
sentinel when done (`...when complete print on its own line: DONE_7f3`), then poll the pane
for it. The trap: **your instruction text contains the sentinel, and it stays in
scrollback**, so a naive `capture-pane -S -<big> | grep SENTINEL` matches the echoed
*prompt* immediately — a false positive (observed live: a rename driver reported "done" on
poll #1 because the prompt itself said "print exactly: DONE_7f3").

Mitigations (pick one):
- **Match real output only** — exclude the instruction line: `grep SENTINEL | grep -vE
  'print|exactly|when complete'`, or require the sentinel alone on its own line.
- **Scan below the input box**, not full scrollback — the echoed prompt sits above it.
- **Use a transformed token** — have the app print the sentinel reversed or with a suffix
  it must compute, so the literal never appears in your instruction.
- **Pair it with a BLOCKED sentinel** (`...if blocked print BLOCKED_7f3 <reason>`) and a
  question-stall check (numbered choices / "Enter to confirm" in the live tail), so the
  poll can't hang forever when the app stops to ask something.

## Driving another `claude` (or any agent CLI)

- **Prefer the lightest mode.** Interactive `claude` costs ~60-90s of boot (MCP servers +
  hooks) before it accepts input. For a scriptable task, drive `claude -p "<task>"
  --debug-file PATH` and skip the TUI entirely — only drive the full TUI when the
  interaction genuinely needs it.
- **Demand autonomy in the prompt.** A driven agent that inherits "ask before acting"
  habits will stop and wait for input you can't easily supply. Say explicitly: "work fully
  autonomously, do NOT ask questions, make reasonable choices and proceed."
- **Put it in a non-blocking permission mode.** If the driven session prompts on each tool
  call it deadlocks — and your readiness poll reads the permission dialog as "idle". Ensure
  bypass/accept permissions.
- **Spawn with a fixed pane size** (`new-session -d -s NAME -x 200 -y 50 'claude'`) so wide
  output doesn't wrap and break your sentinel/assertion regexes.

## Race conditions to watch

- **Hook ordering between extensions** (pi): registration order matters. If your check
  depends on a flag another extension sets, poll for the flag (2-3s max) rather than
  asserting immediately after the triggering event.
- **Tail panes lag** (`tail -F` buffers): never assert on tail-pane content; assert on
  the underlying file.
- **Session-name reuse**: failed teardown leaves orphan sessions. Always `find-session`
  before `create-session`, or always use `$$`-suffixed names.

For driving pi specifically, see the pi-session-monitor skill.
