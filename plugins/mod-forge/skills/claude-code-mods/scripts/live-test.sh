#!/usr/bin/env bash
# live-test.sh: start Claude Code in tmux with a mod, run one slash command,
# and wait for a marker that only the mod draws.
#
# Usage: live-test.sh <mod-dir> <slash-command> <marker> [columns] [trusted-dir]
#   mod-dir      absolute path to a COPY of the mod (not the hot-reload dev-mods folder)
#   slash-command  for example /notes-proto
#   marker       text that your drawing prints and that always shows, for example the pane title
#   columns      terminal width, default 150
#   trusted-dir  a folder Claude Code already trusts, default: the current folder
#
# Environment (all optional):
#   SESSION  tmux session name, default modtest-<pid>
#   LOGDIR   folder for the debug log <LOGDIR>/<SESSION>.log, default $TMPDIR or /tmp
#   ROWS     terminal height, default 40
#   CC_ENV   env assignments for claude, for example "NO_COLOR=1 FOO=bar".
#            tmux starts claude with the tmux SERVER's environment, so a variable
#            set before this script does NOT reach claude. Put it in CC_ENV.
#   KEEP=1   leave the tmux session open for more keys; the script prints its name.
#   KEEP_QUIET=1  with KEEP=1: print "session open for the driver: <name>" and not "session kept".
#            mods.py live sets it: it captures the session and removes it itself.
#   MARK_WAIT=<seconds>  how long to wait for the marker, default 15. A model turn (mods.py live --turn) needs 90.
#   NODEBUG=1  start claude WITHOUT --debug-file and skip the load-line wait. Use it for
#            EVERY session whose screen you capture (mockups and storyboard): debug mode
#            prints a "Debug mode enabled / logging to <path>" banner into the transcript,
#            and /clear does not remove it. The marker is then the only proof that the
#            mod loaded. Use debug (no NODEBUG) for a first load check or when it fails.
#
# Exit 0: the load line and the marker appeared. Exit 1: a step timed out;
# the script prints the last screen and the mod's lines from the debug log.
set -u

MOD=${1:?mod-dir}; CMD=${2:?slash-command}; MARK=${3:?marker}
COLS=${4:-150}; TRUSTED=${5:-$PWD}
NAME=$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["name"])' "$MOD/.claude-plugin/plugin.json") || exit 1
S="${SESSION:-modtest-$$}"
LOGDIR="${LOGDIR:-${TMPDIR:-/tmp}}"
LOG="${LOGDIR%/}/$S.log"
mkdir -p "$LOGDIR" || exit 1
# A sandbox can have no usable socket folder: tmux then says "no suitable socket path". Use a folder of our own.
# A normal session is not changed: TMUX_TMPDIR stays unset when the default works.
if tmux ls 2>&1 >/dev/null | grep -q 'no suitable socket path'; then
  export TMUX_TMPDIR="${LOGDIR%/}/tmux"
  mkdir -p "$TMUX_TMPDIR" || exit 1
  echo "tmux: using socket dir $TMUX_TMPDIR"
fi
if tmux has-session -t "=$S" 2>/dev/null; then echo "FAIL: tmux session $S already exists"; exit 1; fi

fail() {
  echo "FAIL: $1"
  echo "--- last screen ---"
  tmux capture-pane -p -t "$S" 2>/dev/null | tail -30
  echo "--- debug log lines for $NAME ---"
  grep -E "$NAME|\[ERROR\]|hooks worker" "$LOG" 2>/dev/null | tail -20
  [ "${KEEP:-0}" = 1 ] || tmux kill-session -t "$S" 2>/dev/null
  exit 1
}

wait_for() { # <seconds> <command...>
  local n=$1; shift
  for _ in $(seq 1 "$n"); do "$@" && return 0; sleep 1; done
  return 1
}

DEBUG_ARG="--debug-file '$LOG'"
[ "${NODEBUG:-0}" = 1 ] && DEBUG_ARG=""
tmux new-session -d -s "$S" -x "$COLS" -y "${ROWS:-40}" -c "$TRUSTED" \
  "env -u ANTHROPIC_API_KEY ${CC_ENV:-} claude $DEBUG_ARG --plugin-dir '$MOD'" || exit 1
if [ -n "$DEBUG_ARG" ]; then LOGNOTE=$LOG; else LOGNOTE="none (NODEBUG=1)"; fi
echo "session: $S  log: $LOGNOTE"

# The trust dialog also shows a "❯" (on its "1. Yes, I trust" row), so look for the dialog first.
trust_dialog() { tmux capture-pane -p -t "$S" 2>/dev/null | grep -qE 'Yes, I trust|trust this folder'; }
prompt_or_dialog() { trust_dialog || tmux capture-pane -p -t "$S" 2>/dev/null | grep -q '❯'; }
wait_for 60 prompt_or_dialog || fail "no prompt after 60 s (login?)"
trust_dialog && fail "trust dialog: $TRUSTED is not trusted; pass --trusted <a trusted dir>"
if [ "${NODEBUG:-0}" = 1 ]; then
  sleep 3  # no log to wait on: give the hooks module time to load
else
  wait_for 20 grep -q "hooks module $NAME@inline loaded" "$LOG" || fail "no load line for $NAME after 20 s"
  echo "loaded: $(grep -o "hooks module $NAME@inline loaded[^;]*" "$LOG" | head -1)"
fi
echo "fullscreen (alternate_on): $(tmux display-message -p -t "$S" '#{alternate_on}')"

tmux send-keys -t "$S" C-u
tmux send-keys -t "$S" -l "$CMD"
sleep 1
tmux send-keys -t "$S" Enter

wait_for "${MARK_WAIT:-15}" sh -c "tmux capture-pane -p -t '$S' | grep -qF -- '$MARK'" || fail "marker '$MARK' not on screen after ${MARK_WAIT:-15} s
hint: pick text that always shows on this pane, for example its title (a row of live data may be missing)"
echo "PASS: marker '$MARK' drawn"
# A hot reload logs "[<name>] $.ui.log: reloaded (...)": not a failure, so leave it out.
[ -f "$LOG" ] && grep -E "$NAME: .*(refused|skipped|dropped)|\[$NAME\]" "$LOG" | grep -v '\$\.ui\.log: reloaded' | tail -5

if [ "${KEEP:-0}" = 1 ]; then
  if [ "${KEEP_QUIET:-0}" = 1 ]; then
    echo "session open for the driver: $S (log: $LOGNOTE)"
  else
    echo "session kept: $S (log: $LOGNOTE). Remove it with: ${TMUX_TMPDIR:+TMUX_TMPDIR=$TMUX_TMPDIR }tmux kill-session -t $S"
  fi
else
  tmux capture-pane -p -t "$S" | tail -30
  tmux kill-session -t "$S"
fi
