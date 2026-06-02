# Orchestration Patterns — Multi-Session Coordination

Source: `man tmux` § `HOOKS`, `wait-for`, `if-shell`, `FORMATS`, plus live probes against
tmux 3.6a. Covers detecting completion, fanning out parallel terminals, and conditional
flow inside tmux.

## The completion-detection ladder

When a command/job runs inside tmux, you have four ways to know it finished — from
cheapest/dumbest to most reliable.

### 1. Sentinel-string polling

End the command with a unique marker; poll capture-pane until it appears.

```bash
tmux send-keys -t s 'make build && echo "###BUILD_DONE###"' Enter

# Poll
for i in {1..120}; do
  tmux capture-pane -t s -p -S -20 | grep -q '###BUILD_DONE###' && break
  sleep 1
done
```

Pros: zero setup. Cons: no exit code; sentinel may scroll off if scrollback is small.

### 2. Exit-code marker

Capture the exit code in the marker so you can detect failure too.

```bash
tmux send-keys -t s 'make build; echo "###RC=$?###"' Enter

# Poll, then parse
for i in {1..120}; do
  line=$(tmux capture-pane -t s -p -S -50 | grep -oE '###RC=[0-9]+###' | tail -1)
  [[ -n "$line" ]] && break
  sleep 1
done
rc="${line#'###RC='}"; rc="${rc%'###'}"
echo "exit code: $rc"
```

### 3. `wait-for <channel>` — explicit signal

`tmux wait-for` is a blocking IPC primitive. One side runs `tmux wait-for -S CHAN` to
signal; the other runs `tmux wait-for CHAN` to block.

```bash
# Spawn a session whose command signals on completion
tmux new-session -d -s job 'make build; tmux wait-for -S job-done'

# Block until signalled (from your script):
tmux wait-for job-done
echo "build finished"
```

Channel names are arbitrary strings — pick something unique to the job (e.g. PID-suffix
to avoid collisions: `job-done-$$`). The flags:

| Flag | Meaning |
|---|---|
| `-S CHAN` | Signal — wakes any waiter on the channel. |
| (no flag) `CHAN` | Wait — blocks until a signal arrives on the channel. |
| `-L CHAN` | Lock — blocks until lock is available (mutex semantics). |
| `-U CHAN` | Unlock. |

Pros: instant, no polling. Cons: must inject the signal call into the spawned command.

### 4. Hooks — fire a callback on a tmux event

`set-hook` registers a tmux command to run when an event happens. The richest one for
completion detection is `pane-exited`: it fires when a pane's process exits.

```bash
# When the pane in session 'job' exits, write a marker file.
tmux set-hook -t job pane-exited 'run-shell "echo DONE > /tmp/job.done"'

tmux new-session -d -s job 'make build'

# Poll for the marker file, then read the exit status from the pane death status:
until [[ -f /tmp/job.done ]]; do sleep 0.5; done
```

Hooks at a glance (grounded from `man tmux` HOOKS section):

| Hook | Fires when |
|---|---|
| `session-created` | A new session is created. |
| `session-closed` | A session is destroyed. |
| `session-renamed` | A session is renamed. |
| `client-attached` | A client attaches to the server. |
| `client-detached` | A client detaches. |
| `pane-exited` | The process running in a pane exits. |
| `pane-died` | A pane's process died unexpectedly (vs. clean exit). |
| `window-linked` / `window-unlinked` | Window added to / removed from a session. |
| `window-renamed` | Window rename. |
| `alert-bell` | A bell character was received. |
| `alert-activity` | A pane saw output in monitored-activity mode. |
| `alert-silence` | A monitored pane has been silent for the threshold. |

The hook command runs inside tmux's command parser. Use `run-shell '...'` to drop to a
real shell. Use `-g` on `set-hook` for a global hook that applies to all sessions.

```bash
tmux set-hook -g session-created 'run-shell "logger tmux: session #{hook_session_name} started"'
```

Verify a hook fired:
```bash
tmux show-hooks -t my-session
tmux show-hooks -g                # global hooks
```

## `if-shell` — conditional tmux commands

Branch on a shell test, all inside tmux:

```bash
tmux if-shell '[ -f /tmp/flag ]' \
  'display-message "flag present"' \
  'display-message "no flag"'

# More useful: only create a session if it doesn't exist
tmux if-shell 'tmux has-session -t work 2>/dev/null' \
  'select-window -t work:0' \
  'new-session -d -s work'
```

Flags: `-b` runs the test in the background (non-blocking); `-F` does a tmux-format
expansion instead of executing a shell.

## Format strings useful to Claude

`display-message -p '#{...}'` prints any format variable. The ones most useful for
orchestration:

| Variable | Meaning |
|---|---|
| `#{pane_id}` | `%N` absolute id. |
| `#{pane_pid}` | OS pid of the process in the pane (kill it, wait4 it, ps it). |
| `#{pane_dead}` | `1` if the pane's process has exited, `0` otherwise. |
| `#{pane_dead_status}` | Numeric exit status of a dead pane (when `pane_dead == 1`). |
| `#{pane_current_command}` | The command currently running (e.g. `bash`, `vim`, `make`). |
| `#{pane_in_mode}` | `1` if the pane is in copy/scroll mode (input won't reach the process). |
| `#{session_name}` | Session human name. |
| `#{session_created}` | Unix timestamp of creation. |
| `#{session_attached}` | Count of clients attached. |
| `#{history_size}` | Lines currently in scrollback. |
| `#{cursor_y}` | Current cursor row (0-indexed from the top of the visible pane). |
| `#{window_active}` / `#{pane_active}` | `1` if this is the active window/pane. |

```bash
# Has the pane process exited? If yes, what was the exit code?
dead=$(tmux display-message -p -t my-session '#{pane_dead}')
rc=$(tmux display-message -p -t my-session '#{pane_dead_status}')
echo "dead=$dead rc=$rc"
```

Full enumeration: `man tmux | sed -n '/^FORMATS$/,/^[A-Z][A-Z]/p'`.

## Fan-out pattern — controller × N workers

One controller session that spawns multiple worker sessions, polls their state, and
collects results.

```bash
ids=()
for task in build test lint typecheck; do
  name="work-$task-$$"
  tmux new-session -d -s "$name" "make $task; tmux wait-for -S $name-done"
  ids+=("$name")
done

# Wait for each (signal arrives once per worker)
for n in "${ids[@]}"; do tmux wait-for "$n-done"; done

# Collect status from each
for n in "${ids[@]}"; do
  rc=$(tmux display-message -p -t "$n" '#{pane_dead_status}')
  out=$(tmux capture-pane -p -t "$n" -S -100 | tail -20)
  echo "=== $n rc=$rc ==="
  echo "$out"
  tmux kill-session -t "$n"
done
```

Or — if the workers don't terminate — poll their session list with a format filter:

```bash
tmux list-sessions -F '#{session_name} #{session_created}' | grep '^work-'
```

## Notification when long work finishes

When you want to know about a long-running task in another tmux session, attach a
pane-exited hook that writes a marker file (portable) or fires a macOS notification.

```bash
# Marker file pattern (works anywhere)
tmux set-hook -t longjob pane-exited 'run-shell "touch /tmp/longjob.done"'

# macOS audible notification
tmux set-hook -t longjob pane-exited 'run-shell "say \"job done\""'

# macOS Notification Center
tmux set-hook -t longjob pane-exited \
  'run-shell "osascript -e \"display notification \\\"build done\\\" with title \\\"tmux\\\"\""'
```

The marker-file pattern is the most reliable because Claude can poll the file's existence
between tool calls without depending on a notification daemon being present.

## Putting it together — a robust spawn-wait-collect

```bash
job=mybuild
tmux new-session -d -s "$job" 'make all && echo "###OK###" || echo "###FAIL###"'
tmux set-hook -t "$job" pane-exited "run-shell 'touch /tmp/$job.done'"

# Block until done (cheap)
until [[ -f /tmp/$job.done ]]; do sleep 1; done

# Collect
rc=$(tmux display-message -p -t "$job" '#{pane_dead_status}')
out=$(tmux capture-pane -p -t "$job" -S -200)
tmux kill-session -t "$job"
rm -f /tmp/$job.done

case "$rc" in
  0) echo "PASS"; echo "$out" | tail -5 ;;
  *) echo "FAIL rc=$rc"; echo "$out" | tail -30 ;;
esac
```

This is the canonical Claude pattern: spawn detached, hook the exit, poll a marker file,
read exit code from the dead pane, capture for postmortem, tear down.
