---
name: tmux-orchestrator
description: Fully manage, drive, observe, and orchestrate terminals via tmux on this host (tmux 3.6a, macOS, Homebrew). Use when you need to spawn or recover persistent shell sessions, run multiple shell commands in parallel across named sessions, capture or stream output from long-running processes, drive interactive TUIs / REPLs (vim, htop, pi, claude, ssh, python), wait for or detect command completion via hooks or polling, or run end-to-end terminal tests with reliable input and assertions. Drives terminals purely through the Bash tmux CLI.
---

# tmux-orchestrator — Drive Terminals From Claude

Everything you need to spawn, drive, observe, and tear down `tmux` sessions on this
host. Replaces the older `terminal-testing` skill (TUI-test patterns absorbed into
`references/tui-testing.md`).

## What this skill owns

| In scope | Out of scope |
|---|---|
| Spawning detached tmux sessions, sending input, capturing output | Installing or upgrading tmux |
| Driving any interactive TUI or REPL (vim, htop, python, pi, claude, ssh) | Authoring a `~/.tmux.conf` (host has none today; user hasn't asked) |
| Coordinating multiple sessions, completion detection via hooks/`wait-for` | Other multiplexers (screen, zellij) — tmux only |

## Installed surface (verified today)

- `tmux -V` → **3.6a** (Homebrew, `/opt/homebrew/bin/tmux`).
- 90 commands available (`tmux list-commands | wc -l`).
- No `~/.tmux.conf` — defaults apply, no config quirks to dodge.

To re-verify any of this on a fresh host: `references/verify-recipes.md`.

## 30-second cheatsheet

| Intent | Bash |
|---|---|
| Spawn detached session | `tmux new-session -d -s NAME 'CMD'` |
| List sessions | `tmux list-sessions` |
| Send a command + Enter | `tmux send-keys -t NAME 'CMD' Enter` |
| Send special keys (C-u, Esc, Tab, arrows) | `tmux send-keys -t NAME <Key>` |
| Capture screen | `tmux capture-pane -p -t NAME` |
| Capture last 50 lines incl. scrollback | `tmux capture-pane -p -t NAME -S -50` |
| Stream pane to file | `tmux pipe-pane -t NAME -o 'cat >> F.log'` |
| Block until job done | `tmux wait-for CHAN` (job runs `tmux wait-for -S CHAN`) |
| Print format variable | `tmux display-message -p -t NAME '#{pane_pid}'` |
| Fire callback on pane exit | `tmux set-hook -t NAME pane-exited 'run-shell …'` |
| Kill a session | `tmux kill-session -t NAME` |
| Check existence first | `tmux has-session -t NAME` (exit 0/1) |

## Reusable patterns

For common spawn / drive / capture / teardown flows, use the helper scripts in
`scripts/` rather than re-deriving the tmux invocations each time (see the Helper
scripts table below).

## The send-keys trap — READ BEFORE DRIVING ANY TUI

`tmux send-keys` interprets key NAMES (`Enter`, `C-u`, `Escape`, …) — but only when you
let it. Adding `-l` (literal) types the characters verbatim instead: `send-keys -l 'C-u'`
types the three chars `C`, `-`, `u`, NOT a Ctrl-U. Pick the mode deliberately.

**Route special keys through `send-keys` (no `-l`):**
```bash
tmux send-keys -t my-session C-u            # actual Ctrl-U
tmux send-keys -t my-session Escape          # actual Escape
tmux send-keys -t my-session 'cmd' Enter     # text + actual Enter
tmux send-keys -t my-session -l 'Enter'      # types literal 5 chars "Enter"
```

Key names (grounded from `man tmux`): `Enter`, `Escape`, `Tab`, `BTab`, `BSpace`, `DC`,
`IC`, `Up`/`Down`/`Left`/`Right`, `Home`/`End`, `PPage`/`NPage`, `F1`-`F12`, `Space`,
modifiers `C-`/`M-`/`S-`. Full table + recipes: `references/send-keys-cookbook.md`.

## When to read which reference

| If you're about to… | Read first |
|---|---|
| Model sessions/windows/panes, recover after disconnect, choose target syntax | `references/core-concepts.md` |
| Send input (especially anything beyond `cmd + Enter`) | `references/send-keys-cookbook.md` |
| Read output, stream logs, assert on screen state, manage scrollback | `references/capture-and-stream.md` |
| Coordinate multiple sessions, detect completion, hooks, `wait-for`, format strings | `references/orchestration-patterns.md` |
| Drive and assert against a TUI/REPL end-to-end | `references/tui-testing.md` (pi specifics live in the pi-session-monitor skill) |
| Assert that any tmux flag / command / hook / format variable exists | `references/verify-recipes.md` ← always before asserting |

## Helper scripts (`scripts/`)

All four are self-documenting (run with no args for usage). Tested end-to-end against
tmux 3.6a on this host.

| Script | What it does |
|---|---|
| `new-driven-session.sh <name> <cmd…>` | Spawns a detached named session, returns `TMUX_SESSION=…` and `PANE_ID=%N` for `eval`. Errors if name collides. |
| `wait-for-pane-text.sh [--quiet] <target> <regex> [timeout=30] [interval=0.5]` | Polls `capture-pane -S -100` until regex matches. `--quiet` adds prompt-readiness stability check. |
| `assert-pane-contains.sh <target> <regex> [lines=50]` | One-shot capture + grep; exit 1 with diagnostic dump on miss. |
| `stream-pane-to-file.sh <target> <logfile> [--detach]` | Opens `pipe-pane -o "cat >> file"` with EXIT-trap cleanup (foreground) or fire-and-forget (`--detach`). |

For an end-to-end driven-session example, see the pi-session-monitor skill
(`examples/smoke-orchestrate.sh`).

## Verify-before-assert (hard rule)

If a grep against `man tmux` or a live probe doesn't surface the command/flag/hook/format
you want to use, treat it as absent — do not write code against it. Recipes:
`references/verify-recipes.md`. Re-verify after every `brew upgrade tmux` because option
and hook names DO change across major versions.

## Canonical Claude pattern — spawn, wait, collect, teardown

```bash
job=mybuild
tmux new-session -d -s "$job" 'make all && echo "###OK###" || echo "###FAIL###"'
tmux set-hook -t "$job" pane-exited "run-shell 'touch /tmp/$job.done'"

# Poll the marker file (Claude can check between tool calls)
until [[ -f /tmp/$job.done ]]; do sleep 1; done

rc=$(tmux display-message -p -t "$job" '#{pane_dead_status}')
out=$(tmux capture-pane -p -t "$job" -S -200)
tmux kill-session -t "$job"; rm -f /tmp/$job.done

[[ "$rc" == "0" ]] && echo "PASS" || { echo "FAIL rc=$rc"; echo "$out" | tail -30; }
```

This is the load-bearing recipe. Everything else in this skill is variation on it.
