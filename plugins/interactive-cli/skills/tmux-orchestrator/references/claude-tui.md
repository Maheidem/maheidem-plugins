# Driving the Claude Code TUI

App-specific recipe for `claude` (the interactive Claude Code TUI), adapted from a live
trial (2026-08-21, ~09:05-09:10 -03): a tmux-driven session completed a two-turn bug-fix
conversation end-to-end — read → delegated edits+tests → verified → follow-up → second
fix applied. Both fixes verified on disk.

For `pi` (orchestrator-mode delegation), use the pi-delegate plugin's MCP tools
(`mcp__plugin_pi-delegate_pi-delegate__*`), not tmux.

## Verified spawn / submit / detect / measure recipe

```bash
# 1. Spawn (fixed size avoids wrap breaking regexes; strip stale API key)
tmux new-session -d -s SES -x 200 -y 50 "cd '$RUN_DIR' && env -u ANTHROPIC_API_KEY claude"
tmux pipe-pane -t SES -o "cat >> $RUN_DIR/pane.log"     # full transcript stream

# 2. WAIT for startup before any input (~8s to the ❯ prompt). Input sent during
#    init is partially eaten — the first Enter after the banner reliably vanishes.

# 3. Send a prompt — the reliable submit pattern:
tmux send-keys -t SES C-u                    # clear input (kills ghost-text too)
tmux send-keys -t SES -l 'the prompt text'    # -l = literal, no key-name interpretation
sleep 1                                       # let the TUI ingest the paste
tmux send-keys -t SES Enter

# 4. Detect end-of-turn: regex on the completion line, not idle-detection:
wait-for-pane-text.sh SES 'Cooked for' 300 3
#    (wait-for-idle.sh false-positives when unsubmitted text sits in the input box)

# 5. Read usage: /cost via the same submit pattern, then capture-pane and parse
#    the "Usage by model" block.
```

## The five field lessons (each hit for real in the trial)

1. **Enter is treacherous.** The first Enter during startup is swallowed; Enter on
   ghost-text (the TUI's suggested reply shown at the `❯` prompt) submits nothing.
   Always `C-u` → `send-keys -l` → pause → `Enter`. Never trust a bare trailing
   `'text' Enter` on a busy TUI.
2. **End-of-turn sentinel.** The signal is `✻ Cooked for <time>` plus an empty prompt —
   not idle-detection alone. `wait-for-idle` false-positives on a pane holding
   unsubmitted input text (it looks "stable" but isn't done).
3. **Usage measurement.** `/cost` is the authoritative per-model meter (capture-pane +
   parse). The session transcript JSONL (`~/.claude/projects/<dir-slug>/*.jsonl`)
   parses but over-counts (trial: 1.61M cache-read summed vs 856k per `/cost` —
   streaming records duplicate usage; would need dedup by requestId). Use `/cost`.
4. **Permission-mode inheritance.** The TUI inherits the invoking user's permission
   mode — the trial ran with bypass-permissions on, so zero permission dialogs. For
   prompt-answering realism a driver must cycle shift+tab and answer dialogs
   (detectable via capture-pane).
5. **Interactive-vs-headless cost gap.** The same class of work cost ~$2.08 interactive
   vs ~$0.93 headless (`claude -p`). Interactive sessions carry init overhead, a
   haiku-4.5 sidecar (~1.8k tokens, invisible in headless runs), suggestion/ghost-text
   machinery, and multi-turn conversation framing. Headless numbers UNDERSTATE real
   human-usage cost — plan for the gap when estimating from headless benchmarks alone.

## zsh gotcha

zsh eats `===MARKER===` echoes (`=word` expansion) — use plain markers, not
`=`-prefixed ones, in driver scripts and sentinels.

## Homelab specifics

Orchestrator-mode `pi` delegation, model routing, and the A/B protocol behind the
trial live outside this skill: see `harnesses/pi-delegate-local-offload.md` and
`use-cases/ab-test/protocol.md` in the oss-local-hosting-material repo.
