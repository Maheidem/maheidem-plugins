# ring-check.py <capture.ansi | -> [--pointer GLYPH] [--focus TEXT]
# Check that the focus ring and the selection pointer are on the same row.
# Input: `tmux capture-pane -p -e` output (a file, or - for stdin).
# Only the part of a row right of its first "│" counts: the dock divider or the left
# frame of an inline pane. So the prompt's own ❯ does not count.
# The ring is the inverse SGR run (\x1b[7m ... \x1b[27m or \x1b[0m). A label that wraps
# shows the ring on two rows; the block counts once, by its first row.
#   --pointer GLYPH  the pointer your variant draws (default ❯). It counts as a word:
#                    "❯ name", "  2m ❯ name", "> 1. name".
#   --focus TEXT     also check that the ring holds this text (for example "n: cancel"
#                    on a confirm, where no pointer shows).
# Prints the pointer rows, the ring rows and the text under the ring.
# Exit 0 = OK, 1 = MISMATCH (or --focus text not under the ring), 2 = n/a (no pointer row
# and no --focus: nothing to compare). Run with `python3 -I`.
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.dont_write_bytecode = True  # no __pycache__ in the skill folder (journey_lib is imported below)
import journey_lib as jl  # noqa: E402


def main(argv) -> int:
    args = argv[1:]
    pointer, focus = '❯', None
    if '--pointer' in args:
        i = args.index('--pointer'); pointer = args[i + 1]; del args[i:i + 2]
    if '--focus' in args:
        i = args.index('--focus'); focus = args[i + 1]; del args[i:i + 2]
    src = sys.stdin if not args or args[0] == '-' else open(args[0], encoding='utf-8')
    text = src.read()
    ptr = jl.pointer_rows(text, pointer)
    ring = jl.focus_rows(text)
    rows = sorted({r for r, _ in ring})
    # A label that wraps keeps the ring on its next row too: count each block once, by its first row.
    inv = [r for r in rows if r - 1 not in rows]
    for r, t in ring:
        print(f'ring row {r}: {t[:70]}')
    rc = 0
    if focus is not None:
        hit = any(focus in t for _, t in ring)
        print(f'focus {focus!r}: {"under the ring" if hit else "NOT under the ring"}')
        rc = 0 if hit else 1
    if not ptr:
        print(f'pointer {pointer!r} rows [] · inverse rows {inv} · n/a')
        return rc if focus is not None else 2
    ok = ptr == inv
    print(f'pointer {pointer!r} rows {ptr} · inverse rows {inv} · {"OK" if ok else "MISMATCH"}')
    return max(rc, 0 if ok else 1)


if __name__ == '__main__':
    sys.exit(main(sys.argv))
