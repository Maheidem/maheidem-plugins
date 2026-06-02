# Send-Keys Cookbook — Driving Terminals Reliably

Source: `man tmux` § `send-keys` subsection, the `KEY BINDINGS` key-name table, plus
live probes against tmux 3.6a on this host.

## The input vector — `tmux send-keys`

| Vector | Use for | Special-key handling |
|---|---|---|
| **Bash:** `tmux send-keys -t <target> '...' Enter` | Anything that needs special keys or that you want to script | ✅ Correct — tmux interprets `Enter`, `C-c`, `Escape`, etc. |

`send-keys` is the only input path. It handles plain text, special keys, and modifiers.
The one trap is literal vs interpreted mode — see below.

## Literal vs interpreted keys

Without `-l`, `send-keys` interprets key NAMES: `tmux send-keys -t s C-u` sends an actual
Ctrl-U. With `-l`, the same string types the literal characters `C`, `-`, `u` instead.
Choose the mode that matches your intent:

```bash
tmux send-keys -t my-session C-u           # actual Ctrl-U
tmux send-keys -t my-session Escape         # actual Escape
tmux send-keys -t my-session 'partial' Tab  # text plus Tab
tmux send-keys -t my-session -l 'C-u'       # literal chars C - u (no Ctrl)
```

## Special-key reference (grounded in `man tmux`)

| Intent | `tmux send-keys` argument |
|---|---|
| Submit input (newline) | `Enter` |
| Cancel / kill-line | `C-u` |
| Interrupt running TUI task | `Escape` |
| Exit shell / REPL (EOF) | `C-d` |
| Force-quit / clear | `C-c` |
| Tab completion | `Tab` |
| Reverse-tab | `BTab` |
| Backspace | `BSpace` |
| Delete forward | `DC` |
| Insert | `IC` |
| Arrow keys | `Up`, `Down`, `Left`, `Right` |
| Home / End | `Home`, `End` |
| Page up/down | `PPage`, `NPage` (also accepted: `PageUp`, `PageDown`) |
| Function keys | `F1` … `F12` |
| Space | `Space` (or just `' '` in a quoted string) |
| Any single key | `Any` (rarely needed — used in bindings) |

**Modifiers:**
- `C-X` → Ctrl-X (e.g. `C-a`, `C-Space`)
- `M-X` → Meta/Alt-X
- `S-X` → Shift-X (mostly meaningful for non-printable keys)

Chains compose: `C-M-Up` = Ctrl+Meta+UpArrow.

## Quoting — single vs double quotes vs `-l`

`send-keys` parses each argument: if it matches a key name, it's interpreted; otherwise,
the characters are typed literally.

```bash
tmux send-keys -t s 'echo hi' Enter        # types "echo hi", presses Enter
tmux send-keys -t s "echo $USER" Enter      # double quotes — shell expands $USER first
tmux send-keys -t s 'Enter'                 # interpreted as the Enter key
tmux send-keys -t s -l 'Enter'              # -l = literal: types the 5 chars "Enter"
```

The `-l` (literal) flag is critical when you want to send text that *happens* to look
like a key name. Without `-l`, `tmux send-keys -t s 'Tab'` presses Tab; with `-l`, it
types the three characters `T`, `a`, `b`.

Shell quoting trap: if your text contains single quotes, use double quotes and escape
shell metas:

```bash
tmux send-keys -t s "it's me" Enter
tmux send-keys -t s 'echo "$PATH"' Enter   # single-quote the outer to keep $PATH literal
```

## Pasting large text — `load-buffer` + `paste-buffer`

`send-keys` works for short input. For multi-line text or anything over a few hundred
chars, use a paste buffer — it's one IPC call and avoids the per-keystroke overhead:

```bash
echo "$LONG_TEXT" | tmux load-buffer -
tmux paste-buffer -t my-session              # pastes into active pane of target
tmux paste-buffer -t my-session -d           # -d = delete buffer after paste
```

Or stream literal text with `send-keys -l` (no key-name interpretation, no Enter at the
end unless you add one):

```bash
tmux send-keys -t my-session -l "$(cat large-file.txt)"
tmux send-keys -t my-session Enter
```

## Sending a chord prefix to tmux-inside-tmux

When the pane runs *another* tmux session (e.g. you ssh'd into a host and started a
nested tmux), the outer tmux's prefix is `C-b` by default. To send a key to the inner
tmux, send the prefix first:

```bash
tmux send-keys -t outer-session C-b n        # next-window in inner tmux
tmux send-keys -t outer-session C-b d        # detach inner tmux
```

## Verify what you sent

After `send-keys`, the input is in the pane's buffer but may not have visibly rendered
yet (the TUI's redraw loop is asynchronous). Always pair sends with a short readback:

```bash
tmux send-keys -t my-session 'do-thing' Enter
sleep 0.3
tmux capture-pane -t my-session -p | tail -10
```

For deterministic readback, use `scripts/wait-for-pane-text.sh` instead of a fixed sleep
— see `capture-and-stream.md` for the polling pattern.

## Common send recipes

```bash
# Submit a command line
tmux send-keys -t s 'git status' Enter

# Clear the current input then type a new line
tmux send-keys -t s C-u
tmux send-keys -t s 'corrected' Enter

# Interrupt a hung TUI command
tmux send-keys -t s C-c                 # or Escape, depending on the app

# Quit pi / claude / similar REPL
tmux send-keys -t s C-d

# Navigate a menu
tmux send-keys -t s Down Down Enter

# Type without submitting (e.g. into a chat input)
tmux send-keys -t s -l 'draft message body without newline'

# Paste a large blob
pbpaste | tmux load-buffer - && tmux paste-buffer -t s -d
```
