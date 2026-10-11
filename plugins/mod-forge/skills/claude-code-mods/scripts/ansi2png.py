# ansi2png.py <in.ansi> <cols> <out.png|out.svg> [title]
# Turn a `tmux capture-pane -p -e` capture into a PNG, the way the terminal drew it.
# Steps: rich Console (record, truecolor, `cols` wide) -> SVG -> PNG.
# PNG: rsvg-convert when it is on PATH, else `qlmanage -t` plus a trim of its white padding.
# RENDER_WITH=qlmanage forces the second path (to test it).
# Run with `python3 -I` (needs the `rich` and `Pillow` packages).
import html
import os
import re
import shutil
import subprocess
import sys
import tempfile

from rich.cells import cell_len
from rich.console import Console
from rich.text import Text

# rich writes `font-family: Fira Code, monospace`. Fira Code is not installed here, so
# the fallback font drew U+273B (✻, the "working" glyph) as `*`. Name fonts that have
# the glyphs Claude Code draws: Menlo for the text, then fonts with dingbats and symbols.
FONTS = 'Menlo, "SF Mono", "DejaVu Sans Mono", "Apple Symbols", "Zapf Dingbats", "Arial Unicode MS", monospace'


TEXT = re.compile(r'(<text\b[^>]*?\bx=")([0-9.]+)("[^>]*?\btextLength=")([0-9.]+)("[^>]*>)([^<]*)(</text>)')


def per_cell(m: re.Match) -> str:
    # One <text> per character, on the cell grid. rsvg-convert ignores textLength and
    # uses only the first value of an x list, so a glyph from a fallback font (wider or
    # narrower) pushed the rest of the run: the right border of a pane drew jagged.
    chars = html.unescape(m.group(6))
    cells = cell_len(chars)
    if cells == 0:
        return m.group(0)
    x0, step = float(m.group(2)), float(m.group(4)) / cells
    out, at = [], 0
    for ch in chars:
        w = cell_len(ch)
        if ch not in ' \u00a0':  # rich draws backgrounds as rects; a blank needs no glyph
            out.append(f'{m.group(1)}{x0 + at * step:.1f}{m.group(3)}{w * step:.1f}{m.group(5)}'
                       f'{html.escape(ch, quote=False)}{m.group(7)}')
        at += w
    return ''.join(out)


def main() -> int:
    if len(sys.argv) < 4:
        print(__doc__ or 'usage: ansi2png.py <in.ansi> <cols> <out.png> [title]', file=sys.stderr)
        return 2
    src, cols, out = sys.argv[1], int(sys.argv[2]), os.path.abspath(sys.argv[3])
    title = sys.argv[4] if len(sys.argv) > 4 else os.path.basename(out)
    ansi = open(src, encoding='utf-8').read().rstrip('\n')

    with open(os.devnull, 'w') as null:
        con = Console(record=True, width=cols, force_terminal=True, color_system='truecolor', file=null)
        text = Text.from_ansi(ansi)
        text.no_wrap = True
        text.overflow = 'crop'
        con.print(text, no_wrap=True, crop=True)
        svg = con.export_svg(title=title)
    svg = re.sub(r'font-family:\s*"?Fira Code"?\s*,\s*monospace', 'font-family: ' + FONTS, svg)
    svg = TEXT.sub(per_cell, svg)
    if out.endswith('.svg'):  # SVG only, to inspect it
        with open(out, 'w', encoding='utf-8') as f:
            f.write(svg)
        print(f'ok {out} ({cols} cols, svg)')
        return 0

    work = tempfile.mkdtemp(prefix='ansi2png-')
    try:
        svg_path = os.path.join(work, 'shot.svg')
        with open(svg_path, 'w', encoding='utf-8') as f:
            f.write(svg)
        if shutil.which('rsvg-convert') and os.environ.get('RENDER_WITH') != 'qlmanage':
            subprocess.run(['rsvg-convert', '--zoom', '2', '-o', out, svg_path], check=True)
            how = 'rsvg-convert'
        else:
            subprocess.run(['qlmanage', '-t', '-s', '1800', '-o', work, svg_path],
                           check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            from PIL import Image, ImageChops
            im = Image.open(svg_path + '.png').convert('RGB')
            box = ImageChops.difference(im, Image.new('RGB', im.size, (255, 255, 255))).getbbox()
            (im.crop(box) if box else im).save(out)
            how = 'qlmanage + trim'
    finally:
        shutil.rmtree(work, ignore_errors=True)
    print(f'ok {out} ({cols} cols, {how})')
    return 0


if __name__ == '__main__':
    sys.exit(main())
