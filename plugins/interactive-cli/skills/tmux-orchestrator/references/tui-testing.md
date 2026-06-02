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

## Race conditions to watch

- **Hook ordering between extensions** (pi): registration order matters. If your check
  depends on a flag another extension sets, poll for the flag (2-3s max) rather than
  asserting immediately after the triggering event.
- **Tail panes lag** (`tail -F` buffers): never assert on tail-pane content; assert on
  the underlying file.
- **Session-name reuse**: failed teardown leaves orphan sessions. Always `find-session`
  before `create-session`, or always use `$$`-suffixed names.

For driving pi specifically, see the pi-session-monitor skill.
