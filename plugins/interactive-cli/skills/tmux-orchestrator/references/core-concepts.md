# Core Concepts — Sessions, Windows, Panes, Persistence

Source: `man tmux` sections `SESSIONS, WINDOWS AND PANES`, `CLIENTS AND SESSIONS`, plus
live probes against tmux 3.6a on this host.

## The hierarchy

```
tmux server (one per user)
└── session         (named workspace, e.g. "build-01")        id: $0, $1, …
    └── window      (tabbed view inside a session)            id: @0, @1, …
        └── pane    (rectangular region running ONE process)  id: %0, %1, …
```

One tmux **server** runs in the background per user. It hosts one or more **sessions**.
Each session has one or more **windows** (think tabs). Each window has one or more
**panes**, and each pane runs exactly one process (typically a shell). Detaching a client
does not kill the server — sessions persist until killed or until the server exits.

## IDs vs names

| Kind | Auto-id | Human name | Where shown |
|---|---|---|---|
| Session | `$N` (e.g. `$0`) | `-s <name>` on creation | `list-sessions` |
| Window | `@N` (e.g. `@7`) | `-n <name>` on creation; `rename-window` | `list-windows` |
| Pane   | `%N` (e.g. `%13`) | (none — addressed by index) | `list-panes` |

Targets resolve as `session:window.pane`. All parts are optional and default to the
current/active:

```bash
tmux send-keys -t build-01            "echo hi" Enter   # active window+pane in session "build-01"
tmux send-keys -t build-01:0          "echo hi" Enter   # window index 0
tmux send-keys -t build-01:0.1        "echo hi" Enter   # window 0, pane index 1
tmux send-keys -t %13                 "echo hi" Enter   # absolute pane id
```

Prefer the absolute `%N` pane id for automation — names can collide, indexes can shift
when panes close.

## Detached sessions and persistence

```bash
tmux new-session -d -s build-01 "long-running-command"     # -d = detached, do not attach
```

What survives Claude's process death:
- The tmux **server** (independent process).
- All **sessions, windows, panes, scrollback** the server is managing.
- The shell processes inside each pane.

What does NOT survive:
- The TTY of the **client** that attached (each `tmux attach` starts a new client).
- Anything tied to your shell process (env vars set in the parent before launching tmux).

**Claude almost never attaches.** Claude has no real TTY for an interactive client.
Always work via `new-session -d`, then drive via `send-keys` and read via `capture-pane`.

## Listing and inspecting

```bash
# Sessions
tmux list-sessions                                    # human-readable
tmux list-sessions -F '#{session_name} #{session_created} #{session_attached}'

# Windows (across all sessions with -a)
tmux list-windows -a -F '#{session_name}:#{window_index} #{window_name}'

# Panes (across all sessions with -a)
tmux list-panes -a -F '#{session_name}:#{window_index}.#{pane_index} #{pane_id} #{pane_pid} #{pane_current_command}'

# A single value
tmux display-message -p -t build-01 '#{pane_pid}'
```

## Renaming and killing

```bash
tmux rename-session -t old-name new-name
tmux kill-session   -t build-01           # one session
tmux kill-session   -a -t keep-me         # kill all OTHER sessions (cascade)
tmux kill-server                          # nuke everything
```

Kill cascade rules:
- `kill-session` removes the session and all its windows/panes.
- Killing the last pane in a window kills the window.
- Killing the last window in a session kills the session.
- Killing the last session does NOT kill the server (it stays idle).

## Recovering a session Claude started earlier

The session name from a previous turn is durable — reuse it.

```bash
# Defensive: only attach/drive if it actually exists.
if tmux has-session -t build-01 2>/dev/null; then
  # Already running — drive it.
  tmux send-keys -t build-01 'status-check' Enter
else
  # Recreate.
  tmux new-session -d -s build-01 'long-running-command'
fi
```

Or recover by listing and filtering:

```bash
tmux list-sessions -F '#{session_name}' | grep -E '^build-' | head -1
```

## Attach/detach mechanics (rarely useful for Claude)

```bash
tmux attach -t build-01       # join an existing session (needs a TTY)
# Inside: Ctrl-b d           # detach (default key binding when ~/.tmux.conf is empty)
```

A session can have **zero clients attached** — that's the normal state for sessions Claude
manages. `list-sessions` shows `(attached)` when a human is currently watching.

## Quick recipes for the common Claude flows

```bash
# Spawn detached, drive, capture, kill.
tmux new-session -d -s work "$LONG_CMD"
tmux send-keys   -t work "extra-input" Enter
tmux capture-pane -t work -p
tmux kill-session -t work

# Inventory before doing anything destructive.
tmux list-sessions 2>/dev/null || echo "no server running"

# Get the pane id of the first pane of a session you just created.
PANE=$(tmux list-panes -t work -F '#{pane_id}' | head -1)
```

See `send-keys-cookbook.md` for input details and `capture-and-stream.md` for output.
