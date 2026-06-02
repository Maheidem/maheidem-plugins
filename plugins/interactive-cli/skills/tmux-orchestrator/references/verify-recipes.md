# Verify Recipes — Ground Any Claim Against Installed tmux

**Hard rule:** before writing code that depends on a tmux command, flag, hook, or format
variable, verify it exists *on this host* via one of the recipes below. The skill is pinned
to **tmux 3.6a**; option/hook/format names change across major versions.

## tmux version

```bash
tmux -V          # must print "tmux 3.6a" for this skill's examples to apply verbatim
```

If `tmux -V` differs from 3.6a, re-run the recipes against the actual manpage before
trusting any example — option names and hook names DO change across major versions.

## Does a command or flag exist?

```bash
# Quick: command name + flag summary (one line per command)
tmux list-commands | grep -E '^<name>( |$)'

# Full: command's manpage entry
man tmux | sed -n '/^<COMMAND-NAME-IN-CAPS>$/,/^[A-Z]/p' | head -80
# Or just search:
man tmux | grep -nE '\b<flag-or-keyword>\b' | head
```

There are 90 commands in tmux 3.6a. `tmux list-commands | wc -l` confirms count locally.

## Does a format variable exist?

```bash
tmux display-message -p '#{<var>}'    # prints empty (or errors) if unknown
# Example: 'tmux display-message -p "#{pane_pid}"' prints a PID; '#{not_a_var}' prints empty.
```

For a full dump of format variables a pane is currently exposing:

```bash
tmux display-message -p -F '#{?session_name,#{session_name},}' -t <target>
# Or browse the FORMATS section of the manpage:
man tmux | sed -n '/^FORMATS$/,/^[A-Z][A-Z]/p' | less
```

## Does a hook name exist?

```bash
man tmux | sed -n '/^HOOKS$/,/^[A-Z][A-Z]/p' | grep -E '^\s+<hook-name>'
```

The HOOKS section enumerates every supported hook; if your candidate name is absent,
`set-hook` will accept it silently but it will never fire.

## End-to-end smoke probe (spawn → drive → capture → kill)

```bash
SESS=_probe_$$
tmux new-session -d -s "$SESS" "sleep 30"
tmux send-keys -t "$SESS" 'echo hello' Enter
sleep 0.3
tmux capture-pane -t "$SESS" -p
tmux display-message -t "$SESS" -p '#{session_name} #{pane_id} #{pane_pid}'
tmux kill-session -t "$SESS"
```

Use `_probe_$$` (PID-suffixed) names so probes never collide with real sessions.

## When to re-verify

- After `brew upgrade tmux`.
- When a script that previously worked starts failing on a flag or hook.
- Before adding a new flag/hook/format reference to this skill.
- When the answer to "does tmux support X?" is non-obvious.

If a recipe above does not surface the feature, treat the feature as absent — do not
write code against it.
