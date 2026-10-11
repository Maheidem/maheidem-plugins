# contact-sheet.py <render dir> [page title] [note]
# Write <render dir>/index.html: one grid of the PNGs in that folder, with a label each.
# Files group by the part of the name before the first "-" (A-normal-150.png -> group A).
# The label is the rest of the name: "normal · 150 cols". Paths are relative, so the
# folder can move or be published as it is. Run with `python3 -I`.
import html
import os
import sys

PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<style>
:root {{ --bg:#f6f6f4; --fg:#1d1d1b; --dim:#6b6b66; --card:#fff; --line:#deded8; }}
@media (prefers-color-scheme: dark) {{ :root {{ --bg:#161615; --fg:#ececea; --dim:#9a9a94; --card:#20201f; --line:#33332f; }} }}
body {{ margin:0; padding:24px 16px; background:var(--bg); color:var(--fg); font:15px/1.5 -apple-system, system-ui, sans-serif; }}
header, section {{ max-width:1600px; margin:0 auto 32px; }}
h1 {{ font-size:22px; margin:0 0 4px; }} h2 {{ font-size:17px; margin:0 0 12px; }}
p {{ color:var(--dim); margin:0; }}
.grid {{ display:grid; grid-template-columns:repeat(auto-fill, minmax(min(100%, 460px), 1fr)); gap:16px; }}
figure {{ margin:0; background:var(--card); border:1px solid var(--line); border-radius:8px; padding:8px; }}
img {{ width:100%; height:auto; display:block; border-radius:4px; }}
figcaption {{ font-size:13px; padding:6px 2px 0; }} figcaption span {{ color:var(--dim); float:right; }}
</style></head><body>
<header><h1>{title}</h1><p>{note}</p></header>
{sections}
</body></html>
"""


def label(rest: str) -> str:
    words = rest.split('-')
    if words and words[-1].isdigit():
        words[-1] = words[-1] + ' cols'
    return ' · '.join(words) or 'screen'


def main() -> int:
    if len(sys.argv) < 2:
        print('usage: contact-sheet.py <render dir> [page title] [note]', file=sys.stderr)
        return 2
    folder = sys.argv[1]
    title = sys.argv[2] if len(sys.argv) > 2 else 'Live prototypes'
    note = sys.argv[3] if len(sys.argv) > 3 else 'Each image is a real Claude Code screen, captured with tmux capture-pane -p -e on fixture data.'
    groups: dict[str, list[str]] = {}
    for name in sorted(os.listdir(folder)):
        if name.lower().endswith('.png'):
            groups.setdefault(name.split('-', 1)[0], []).append(name)
    if not groups:
        print(f'FAIL: no .png files in {folder}', file=sys.stderr)
        return 1
    sections = []
    for group, names in groups.items():
        figs = []
        for n in names:
            stem = n[:-4]
            rest = stem.split('-', 1)[1] if '-' in stem else stem
            src = html.escape(n, quote=True)
            figs.append(f'<figure><a href="{src}"><img src="{src}" alt="{html.escape(stem)}" loading="lazy"></a>'
                        f'<figcaption>{html.escape(label(rest))} <span>{html.escape(n)}</span></figcaption></figure>')
        sections.append(f'<section><h2>{html.escape(group)}</h2><div class="grid">{"".join(figs)}</div></section>')
    out = os.path.join(folder, 'index.html')
    with open(out, 'w', encoding='utf-8') as f:
        f.write(PAGE.format(title=html.escape(title), note=html.escape(note), sections='\n'.join(sections)))
    count = sum(len(v) for v in groups.values())
    print(f'ok {out} ({count} images, {len(groups)} groups)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
