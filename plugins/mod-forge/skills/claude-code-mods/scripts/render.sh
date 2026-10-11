#!/usr/bin/env bash
# render.sh: turn a tmux pane, or a saved capture, into a PNG of the screen.
#
# Usage: render.sh <tmux-session | file.ansi> <out.png> [title] [columns]
#   tmux-session  capture it now with `capture-pane -p -e`. The script also keeps
#                 <out>.ansi (with SGR) and <out>.txt (plain) next to the PNG.
#   file.ansi     a saved `capture-pane -p -e` file.
#   columns       default: #{window_width} of the session; for a file, the number
#                 before .ansi in its name (A-normal-150.ansi -> 150), else the
#                 widest line.
# Needs python3 with rich and Pillow. Uses rsvg-convert when it is on PATH,
# else qlmanage (macOS) and a trim of the white padding.
set -u
SRC=${1:?tmux session or .ansi file}; OUT=${2:?out.png}
TITLE=${3:-$(basename "$OUT" .png)}; COLS=${4:-}
HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$(dirname "$OUT")" || exit 1

if [ -f "$SRC" ]; then
  ANSI=$SRC
  if [ -z "$COLS" ]; then
    COLS=$(basename "$SRC" .ansi | grep -oE '[0-9]+$' || true)
  fi
  if [ -z "$COLS" ]; then
    COLS=$(python3 -I -c 'import re,sys; print(max(len(re.sub(r"\x1b\[[0-9;:]*m","",l.rstrip("\n"))) for l in open(sys.argv[1],encoding="utf-8")))' "$SRC")
  fi
else
  tmux has-session -t "=$SRC" 2>/dev/null || { echo "FAIL: no tmux session or file: $SRC"; exit 1; }
  ANSI=${OUT%.png}.ansi
  tmux capture-pane -p -e -t "$SRC" > "$ANSI" || exit 1
  tmux capture-pane -p -t "$SRC" > "${OUT%.png}.txt" || exit 1
  [ -n "$COLS" ] || COLS=$(tmux display-message -p -t "$SRC" '#{window_width}')
fi

python3 -I "$HERE/ansi2png.py" "$ANSI" "$COLS" "$OUT" "$TITLE"
