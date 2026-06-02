# Capture and Stream — Reading Pane Output

Source: `man tmux` § `capture-pane`, `pipe-pane`, `save-buffer`, `load-buffer` and the
`history-limit` option, plus live probes against tmux 3.6a.

## Two read modes: point-in-time vs live stream

| Need | Use |
|---|---|
| One-shot snapshot of what's on screen | `capture-pane -p` |
| Continuous log of everything the pane prints | `pipe-pane -o '<cmd>'` |
| Save current scrollback for later inspection | `capture-pane -b NAME` → `save-buffer -b NAME FILE` |

## `capture-pane` — snapshot

Flags worth knowing (from `tmux list-commands | grep capture-pane`):

```
capture-pane [-aCeJMNpPqT] [-b buffer-name] [-E end-line] [-S start-line] [-t target-pane]
```

| Flag | Effect |
|---|---|
| `-p` | Print to stdout (the most common form for scripting). |
| `-S <line>` | Start line. `0` = top of visible pane. `-N` = N lines above visible (use `-S -` for *all* history). |
| `-E <line>` | End line. Defaults to bottom of visible pane. |
| `-J` | Join wrapped lines (lines longer than the pane width stay on one line). |
| `-e` | Preserve escape sequences (colors, cursor positioning). Default strips them. |
| `-N` | Preserve trailing newlines (default trims them). |
| `-b <name>` | Save into a tmux paste buffer instead of stdout. |

```bash
# Just what's visible right now
tmux capture-pane -t my-session -p

# Full scrollback
tmux capture-pane -t my-session -p -S -

# Last 50 lines including off-screen scrollback
tmux capture-pane -t my-session -p -S -50

# Snapshot with colors preserved (for verifying terminal rendering)
tmux capture-pane -t my-session -p -e
```

**Default is visible pane only.** This catches most people once — output that scrolled
off the top is silently absent unless you pass `-S`.

## `pipe-pane` — live stream to a file or command

```
pipe-pane [-IOo] [-t target-pane] [shell-command]
```

| Flag | Effect |
|---|---|
| (no command) | Close any existing pipe on the pane. |
| `-o` | "Only open if not already open." Idempotent — safe to call repeatedly. |
| `-O` | Pipe stdout from the command back into the pane (rare). |
| `-I` | Pipe stdin from the command (also rare). |

Common: stream the pane to an append-only log file.

```bash
# Open the pipe
tmux pipe-pane -t my-session -o 'cat >> /tmp/my-session.log'

# ... do work ...

# Close the pipe (no command)
tmux pipe-pane -t my-session
```

Notes:
- The pipe captures the raw byte stream including escape sequences. To strip ANSI:
  `tmux pipe-pane -t s -o 'sed -uE "s/\x1B\[[0-9;]*[a-zA-Z]//g" >> /tmp/s.log'` (note `-u`
  on sed for unbuffered output).
- One pipe per pane. A second `pipe-pane -o '...'` is a no-op while the first is open.
- The `scripts/stream-pane-to-file.sh` helper wraps open + cleanup in a single command.

## Persisting a capture for later — buffers

`capture-pane -b NAME` writes into a tmux paste buffer (in-server memory). `save-buffer`
writes that buffer to disk.

```bash
tmux capture-pane -t my-session -S - -b snap-1   # full scrollback → buffer "snap-1"
tmux save-buffer -b snap-1 /tmp/snap-1.txt        # buffer → disk
tmux delete-buffer -b snap-1                      # cleanup
```

Buffers survive client detach but not server restart. For long-term retention, save to
disk immediately.

## Scrollback limit — `history-limit`

Default scrollback per pane is **2000 lines** (tmux 3.6a default). Long-running
processes (build logs, training runs) easily exceed this. Bump globally before spawning
the session:

```bash
tmux set-option -g history-limit 50000   # 50k lines for new panes
```

`set-option -g` affects panes created *afterwards*. Existing panes keep their original
limit. Verify with `tmux show-options -g | grep history-limit`.

## Multi-pane observability

For long jobs, split the window so observability streams sit alongside the work:

```bash
# Pane 0 (already created) — the work
tmux split-window -t my-session -v -l 30%        # split horizontal, new pane below, 30% height
tmux send-keys -t my-session.1 'tail -F /tmp/build.log' Enter

tmux split-window -t my-session.1 -h             # split vertical inside pane.1
tmux send-keys -t my-session.2 'watch -n 1 df -h /var' Enter
```

Capture each pane by id:

```bash
tmux list-panes -t my-session -F '#{pane_index} #{pane_id} #{pane_current_command}'
tmux capture-pane -t my-session.0 -p
tmux capture-pane -t my-session.1 -p
```

**Tail panes lag.** `tail -F` may buffer up to 1-2 seconds. For tests, assert on the
underlying file, not the tail pane's screen content.

## Assertion pattern

```bash
# Pass / fail with exit code
tmux capture-pane -t my-session -p -S -100 | grep -qE 'BUILD SUCCESS' || {
  echo "FAIL: BUILD SUCCESS not found in pane" >&2
  tmux capture-pane -t my-session -p -S -100 >&2
  exit 1
}
```

The bundled `scripts/assert-pane-contains.sh` is this pattern with a clean CLI and a
diagnostic dump on miss.

## Token cost for Claude (don't over-capture)

Each `capture-pane -p` call returns the visible pane (defaults to 24-50 lines depending
on terminal). With `-S -` it can return thousands of lines. Costs are linear in tokens.

- For state checks: capture a narrow tail (`-S -50` or even `-S -10`).
- For postmortem only: dump full scrollback to a file with `save-buffer`, then read
  selectively with `Read` (offset/limit).
- For loops polling readiness: re-capture only the last 3-5 lines.

## Quick recipes

```bash
# What's on screen right now
tmux capture-pane -t s -p

# Last 20 lines including any that scrolled off
tmux capture-pane -t s -p -S -20

# Tail a session's full output to disk for the whole job
tmux pipe-pane -t s -o 'cat >> /tmp/s.full.log'
# ... work ...
tmux pipe-pane -t s

# Save snapshot for postmortem
tmux capture-pane -t s -S - -b post && tmux save-buffer -b post /tmp/post.txt && tmux delete-buffer -b post

# Bump scrollback before spawning a long job
tmux set-option -g history-limit 50000
tmux new-session -d -s longjob 'make all 2>&1'
```
