#!/usr/bin/env python3 -I
"""mods_score.py: the mechanical pre-score of one mockups pass.

It reads matrix.json and the <file>.txt / <file>.ansi captures of capture-matrix.py.
It ticks 11 boxes for each variant. It never judges taste: wording, hierarchy,
glyph choice and grouping stay with the person.

Use as a module:  score_dir(folder, variants=None, pointers=None, glyphs=None, sizes=None) -> dict
                  render_md(result) -> str
                  write(result) -> (score.md path, score.json path)
Use as a command: python3 -I mods_score.py <folder> [--pointer V=G]... [--json]
It writes score.md and score.json into the folder. Exit 0 when a variant ticks every
applicable box, exit 1 when none does, exit 2 on a usage error.

Row numbers in the output are 0-based screen rows (the same as 'ringLine' in matrix.json).
"""
import sys

sys.dont_write_bytecode = True  # no __pycache__ in the skill folder

import argparse
import json
import os
import re
import unicodedata

SC = os.path.dirname(os.path.realpath(__file__))
S = os.path.dirname(SC)
if SC not in sys.path:
    sys.path.insert(0, SC)
import journey_lib as jl  # noqa: E402

BOXES = ('pane', 'ring', 'footer', 'footer-dim', 'separator', 'pointer', 'edges', 'fits60',
         'one-bold', 'colour-not-alone', 'no-raw')
TASTE = 'wording, hierarchy, glyph choice, grouping'
DIM_FG = '38;5;246'  # tmux draws dim text as colour 246
EDGE_ROW = re.compile(r'^\s*[↑↓] \d+ more\s*$')
RULE_ROW = re.compile(r'^\s*─{3,}\s*$')  # the dim rule of kit header.tsx rule(): it ends a list block
NOTICE_KEYS = 'Esc to dismiss'  # the kit notice row ends with it (kit notice.tsx)
WAIT_HINT = 'Waiting for the result…'  # the kit footer while an action runs (kit defaults.ts)
# The fallback glyph set: the table of references/ux-design.md section 6 (used when the kit has no defaults.ts).
FALLBACK_GLYPHS = '⏺●⎿❯·…─↑↓←→↳✓✕✘⚠ℹ○◐◉◎◌•!◦×∙▸◇◆※✦✻█░⏸⏵╭╮╰╯├└│'
RAW = [re.compile(p) for p in (
    r'\{"', r'\|---\|', r'\bnull\b', r'\bundefined\b', r'\[object Object\]', r'\bNaN\b',
    r'\bat \S+\.(?:ts|tsx|js|mjs):\d+')]


# ---------------------------------------------------------------- text and SGR helpers


def cells(s):
    """The width of a string in terminal cells: wide and fullwidth 2, combining 0, else 1."""
    n = 0
    for ch in s:
        if unicodedata.combining(ch):
            continue
        n += 2 if unicodedata.east_asian_width(ch) in ('W', 'F') else 1
    return n


def sgr_cells(row):
    """[(char, (bold, dim, colour))] for each visible character of one ANSI row.
    colour is the fg code text when the fg is a colour (not dim, not default), else None."""
    out = []
    bold = dim = False
    fg = None
    pos = 0

    def put(text):
        state = (bold, dim or fg == DIM_FG, fg if fg not in (None, DIM_FG) else None)
        out.extend((ch, state) for ch in text)

    for m in jl.SGR.finditer(row):
        put(row[pos:m.start()])
        pos = m.end()
        codes = m.group()[2:-1].replace(':', ';').split(';')
        i = 0
        while i < len(codes):
            c = codes[i] or '0'
            if c == '0':
                bold = dim = False
                fg = None
            elif c == '1':
                bold = True
            elif c == '2':
                dim = True
            elif c == '22':
                bold = dim = False
            elif c == '39':
                fg = None
            elif re.fullmatch(r'3[0-7]|9[0-7]', c):
                fg = c
            elif c in ('38', '48', '58'):
                kind = codes[i + 1] if i + 1 < len(codes) else ''
                width = 3 if kind == '5' else 5 if kind == '2' else 1
                if c == '38' and kind in ('5', '2'):
                    fg = ';'.join(codes[i:i + width])
                i += width
                continue
            i += 1
    put(row[pos:])
    return out


def glyph_set(glyphs=None):
    """The glyphs a colour may stand for: the argument, else GLYPHS of the kit defaults.ts, else the fallback table."""
    if glyphs is not None:
        return set(glyphs)
    try:
        with open(os.path.join(S, 'templates', 'kit', 'defaults.ts'), encoding='utf-8') as fh:
            text = fh.read()
        m = re.search(r'export const GLYPHS\s*=\s*\{(.*?)\}', text, re.S)
        found = set(''.join(re.findall(r"'([^']+)'", m.group(1)))) if m else set()
        if found:
            return found
    except OSError:
        pass
    return set(FALLBACK_GLYPHS)


# ---------------------------------------------------------------- the pane region


def pane_region(txt, ansi):
    """Return {'kind', 'rows', 'top'} or None. rows = [{'n': screen row, 'text': plain part, 'cells': [(ch, state)] or None}].
    The status line holds '│' too, so a row counts only inside the dock column or the inline frame."""
    lines = txt.split('\n')
    alines = ansi.split('\n') if ansi is not None else None

    def acells(n):
        return sgr_cells(alines[n]) if alines is not None and n < len(alines) else None

    rows = []
    d = jl.divider_column(txt)
    if d is not None:  # dock
        for n, line in enumerate(lines):
            if len(line) > d and line[d] == '│':
                ac = acells(n)
                if ac is not None and not (len(ac) > d and ac[d][0] == '│'):
                    ac = None  # the ANSI row does not line up with the text row
                rows.append({'n': n, 'text': line[d + 1:].rstrip(), 'cells': ac[d + 1:] if ac is not None else None})
        return {'kind': 'dock', 'rows': rows, 'top': None} if rows else None
    top = next((n for n, line in enumerate(lines) if jl.INLINE_TOP.match(line)), None)
    if top is None:
        return None
    for n in range(top + 1, len(lines)):
        line = lines[n]
        if line.lstrip().startswith('╰'):
            break
        if '│' not in line:
            continue
        inner = line.split('│', 1)[1]
        if '│' in inner:
            inner = inner.rsplit('│', 1)[0]
        ac = acells(n)
        if ac is not None:
            chars = ''.join(ch for ch, _ in ac)
            first = chars.find('│')
            last = chars.rfind('│')
            ac = ac[first + 1:last] if first >= 0 and last > first else ac[first + 1:] if first >= 0 else None
        if inner.startswith(' '):  # the frame padding
            inner = inner[1:]
            ac = ac[1:] if ac else ac
        rows.append({'n': n, 'text': inner.rstrip(), 'cells': ac})
    return {'kind': 'inline', 'rows': rows, 'top': lines[top]} if rows else None


def header_footer(rows):
    """Return (header index, footer index) in rows, or (None, None)."""
    head = next((i for i, r in enumerate(rows) if re.sub(r'\s*✕\s*$', '', r['text']).strip()), None)
    foot = next((i for i in range(len(rows) - 1, -1, -1) if rows[i]['text'].strip()), None)
    if head is None or foot is None or foot < head:
        return None, None
    return head, foot


def list_block(rows, pointer):
    """The rows of the list around the first pointer row: up and down to a blank row, an edge row or a rule row.
    The kit draws the rule directly under a list that is not windowed (no blank row between them)."""
    rx = re.compile(r'(?:^|\s)' + re.escape(pointer) + r'(?=\s)')
    at = next((i for i, r in enumerate(rows) if rx.search(r['text'])), None)
    if at is None:
        return None, []
    ok = lambda r: r['text'].strip() and not EDGE_ROW.match(r['text']) and not RULE_ROW.match(r['text'])  # noqa: E731
    lo = at
    while lo > 0 and ok(rows[lo - 1]):
        lo -= 1
    hi = at
    while hi + 1 < len(rows) and ok(rows[hi + 1]):
        hi += 1
    return at, rows[lo:hi + 1]


# ---------------------------------------------------------------- the boxes of one capture


def clip(text, n=10):
    t = text.strip('\n')
    return t if len(t) <= n else t[:n] + '…'


def check_band(rec, txt, ansi, glyphs):
    """The boxes of a band capture (capture-matrix.py --band): the band row above the prompt, not a pane.
    The row is the screen row that holds rec['band'] (the band marker). A scenario with no band gives n/a.
    Boxes: pane (the screen settled), separator, one-bold, colour-not-alone, no-raw, fits60 (the marker is
    whole on one row). The others are n/a: a band has no footer, pointer, edges or ring."""
    res = {b: ('n/a', None, '') for b in BOXES}
    info = {'height': None, 'edge': False, 'region': None}
    res['pane'] = ('pass', None, '') if rec.get('pane') and txt is not None else ('fail', None, 'the screen did not settle')
    lines = (txt or '').split('\n')
    alines = ansi.split('\n') if ansi is not None else []
    n = next((i for i, ln in enumerate(lines) if rec['band'] in ln), None)
    if n is None:
        return res, info  # no band in this scenario (it yields): nothing more to score
    row = {'n': n, 'text': lines[n].rstrip(), 'cells': sgr_cells(alines[n]) if n < len(alines) else None}

    def fail(box, why):
        if res[box][0] != 'fail':
            res[box] = ('fail', n, why)
    res['separator'] = ('pass', None, '')
    if '|' in row['text']:
        fail('separator', f'ASCII "|" in {clip(row["text"].strip(), 20)!r}')
    elif re.search(r'(?<!\s)·|·(?!\s)', row['text']):
        fail('separator', f'"·" without a space on both sides in {clip(row["text"].strip(), 20)!r}')
    res['no-raw'] = ('pass', None, '')
    for rx_raw in RAW:
        m = rx_raw.search(row['text'])
        if m:
            fail('no-raw', f'raw text {m.group()!r} in {clip(row["text"].strip(), 20)!r}')
            break
    if rec.get('cols') == 60:
        res['fits60'] = ('pass', None, '')
        if cells(row['text']) > 60:
            fail('fits60', f'the band row is {cells(row["text"])} cells wide')
    if row['cells'] is None:
        for box in ('one-bold', 'colour-not-alone'):
            res[box] = ('fail', n, 'the .ansi file is missing or does not line up')
        return res, info
    res['one-bold'] = ('pass', None, '')
    runs, inside = 0, False
    for ch, st in row['cells']:
        if st[0] and not inside and ch.strip():
            runs += 1
        if ch.strip() or not st[0]:
            inside = st[0]
    if runs > 1:
        fail('one-bold', f'the band row turns bold on {runs} times')
    res['colour-not-alone'] = ('pass', None, '')
    plain = ''.join(ch for ch, _ in row['cells'])
    i = 0
    while i < len(row['cells']):
        col = row['cells'][i][1][2]
        if col is None:
            i += 1
            continue
        j = i
        while j < len(row['cells']) and row['cells'][j][1][2] == col:
            j += 1
        run = plain[i:j]
        text = run.strip()
        end = i + len(run.rstrip())
        # One letter before ': ' is the engine's own hotkey hint (Button: hotkey in the accent colour, a colon, the label): same rule as the pane.
        if text and not (set(text) & glyphs or sum(c.isalpha() for c in text) >= 2
                         or (len(text) == 1 and plain[end:end + 2] == ': ')):
            fail('colour-not-alone', f'colour {col} alone on {clip(text, 12)!r}')
        i = j
    return res, info


def check_capture(rec, txt, ansi, pointer, glyphs):
    """Return ({box: (state, row, why)}, info). state is 'pass', 'fail' or 'n/a'. row is a screen row or None."""
    if rec.get('band'):
        return check_band(rec, txt, ansi, glyphs)
    res = {b: ('n/a', None, '') for b in BOXES}
    reg = pane_region(txt, ansi) if txt is not None else None
    if not rec.get('pane') or reg is None:
        res['pane'] = ('fail', None, 'no pane drawn' if not rec.get('pane') else 'no pane region in the capture')
    else:
        res['pane'] = ('pass', None, '')
    if rec.get('ring') == 'MISMATCH':
        res['ring'] = ('fail', None, rec.get('ringLine', 'ring MISMATCH'))
    else:
        res['ring'] = ('pass', None, '')
    info = {'height': None, 'edge': False, 'region': reg}
    if reg is None:
        return res, info
    rows = reg['rows']
    head, foot = header_footer(rows)
    if head is None:
        res['pane'] = ('fail', None, 'the pane region holds no text')
        return res, info
    info['height'] = foot - head + 1
    info['edge'] = any(EDGE_ROW.match(r['text']) for r in rows)

    def fail(box, row, why):
        if res[box][0] != 'fail':
            res[box] = ('fail', row['n'] if row else None, why)

    # footer: every part is one hint, the last starts with 'Esc to '. A notice row or a busy footer takes the Esc hint away.
    frow = rows[foot]
    notice = any(NOTICE_KEYS in r['text'] for i, r in enumerate(rows) if i != foot) or frow['text'].strip() == WAIT_HINT
    if not notice:
        parts = frow['text'].strip().split(' · ')
        res['footer'] = ('pass', None, '')
        for part in parts:
            full = any(c0 == 0 and c1 == len(part) for _, _, c0, c1 in jl.hints_in([part], {}))
            if not full:
                fail('footer', frow, f'footer part {clip(part, 20)!r} is not one hint')
                break
        else:
            if not parts[-1].startswith('Esc to '):
                fail('footer', frow, f'the last footer part {clip(parts[-1], 20)!r} does not start with "Esc to "')
    # SGR boxes need the ANSI file.
    no_ansi = any(r['cells'] is None for r in rows)
    if no_ansi:
        for box in ('footer-dim', 'one-bold', 'colour-not-alone'):
            res[box] = ('fail', None, 'the .ansi file is missing or does not line up')
    else:
        res['footer-dim'] = ('pass', None, '')
        if not any(st[1] for ch, st in frow['cells'] if ch.strip()):
            fail('footer-dim', frow, 'the footer row holds no dim text')
        res['one-bold'] = ('pass', None, '')
        runs, inside = 0, False
        for ch, st in rows[head]['cells']:
            if st[0] and not inside and ch.strip():
                runs += 1
            if ch.strip() or not st[0]:
                inside = st[0]
        if runs > 1:
            fail('one-bold', rows[head], f'the header turns bold on {runs} times')
        res['colour-not-alone'] = ('pass', None, '')
        for r in rows:
            plain = ''.join(ch for ch, _ in r['cells'])
            i = 0
            while i < len(r['cells']):
                col = r['cells'][i][1][2]
                if col is None:
                    i += 1
                    continue
                j = i
                while j < len(r['cells']) and r['cells'][j][1][2] == col:
                    j += 1
                run = plain[i:j]
                text = run.strip()
                end = i + len(run.rstrip())
                if text and not (set(text) & glyphs or sum(c.isalpha() for c in text) >= 2
                                 or (len(text) == 1 and plain[end:end + 2] == ': ')):
                    fail('colour-not-alone', r, f'colour {r["cells"][i][1][2]} alone on {clip(text, 12)!r}')
                i = j
    # separator
    res['separator'] = ('pass', None, '')
    for r in rows:
        if '|' in r['text']:
            fail('separator', r, f'ASCII "|" in {clip(r["text"].strip(), 20)!r}')
        elif re.search(r'(?<!\s)·|·(?!\s)', r['text']):
            fail('separator', r, f'"·" without a space on both sides in {clip(r["text"].strip(), 20)!r}')
    # pointer
    rx = re.compile(r'(?:^|\s)' + re.escape(pointer) + r'(?=\s)')
    if any(rx.search(r['text']) for r in rows):
        res['pointer'] = ('pass', None, '')
        starts = [r for r in rows if r['text'].startswith(pointer + ' ')]
        at, block = list_block(rows, pointer)
        if len(starts) != 1:
            fail('pointer', rows[at], f'{len(starts)} rows start with the pointer {pointer!r}: {clip(rows[at]["text"])!r}')
        else:
            for r in block:
                if r is not starts[0] and not re.match(r'^  \S', r['text']):
                    fail('pointer', r, f'a list row does not start with two spaces: {clip(r["text"])!r}')
                    break
    # fits60
    if rec.get('cols') == 60:
        res['fits60'] = ('pass', None, '')
        _, block = list_block(rows, pointer)
        for r in block:
            if re.match(r'^ {3,}', r['text']):
                fail('fits60', r, f'a list row starts with 3 or more spaces (a wrap): {clip(r["text"].strip())!r}')
        if reg['kind'] == 'inline':
            want = cells(reg['top'].rstrip())
            lines = txt.split('\n')
            for r in rows:
                line = lines[r['n']].rstrip()
                if not line.endswith('│') or cells(line) != want:
                    fail('fits60', r, f'the frame edge is at column {cells(line)}, not {want}: {clip(r["text"].strip())!r}')
    # no-raw
    res['no-raw'] = ('pass', None, '')
    for r in rows:
        for rx_raw in RAW:
            m = rx_raw.search(r['text'])
            if m:
                fail('no-raw', r, f'raw text {m.group()!r} in {clip(r["text"].strip(), 20)!r}')
                break
    return res, info


# ---------------------------------------------------------------- one folder


def read(path):
    try:
        with open(path, encoding='utf-8') as fh:
            return fh.read()
    except OSError:
        return None


def capture_name(rec):
    f, v = rec['file'], rec['variant']
    return f[len(v) + 1:f.rindex('-')] if f.startswith(v + '-') and '-' in f[len(v) + 1:] else rec.get('mode', '')


def score_dir(folder, variants=None, pointers=None, glyphs=None, sizes=None):
    """Score one mockups pass. `pointers` maps a variant to its pointer glyph (default ❯).
    `sizes` (optional) lists the columns each variant must have a capture for: a missing size fails the `pane` box."""
    folder = os.path.abspath(folder)
    mpath = os.path.join(folder, 'matrix.json')
    try:
        with open(mpath, encoding='utf-8') as fh:
            caps = json.load(fh)['captures']
    except (OSError, ValueError, KeyError) as e:
        raise ValueError(f'cannot read {mpath}: {e}')
    if variants is None:
        variants = list(dict.fromkeys(c['variant'] for c in caps))
    pointers = pointers or {}
    gset = glyph_set(glyphs)
    result = {'folder': folder, 'variants': {}, 'ranking': [], 'decidedBy': None, 'taste': TASTE}
    for v in variants:
        mine = [c for c in caps if c['variant'] == v]
        pointer = pointers.get(v, '❯')
        per_box = {b: [] for b in BOXES}  # box -> [(state, file, row, why)]
        infos = []
        for rec in mine:
            txt = read(os.path.join(folder, rec['file'] + '.txt'))
            ansi = read(os.path.join(folder, rec['file'] + '.ansi'))
            res, info = check_capture(rec, txt, ansi, pointer, gset)
            if txt is None:
                res['pane'] = ('fail', None, 'the .txt file is missing')
            for b in BOXES:
                per_box[b].append((*res[b][:1], rec['file'], *res[b][1:]))
            infos.append((rec, info))
        if not mine:
            per_box['pane'].append(('fail', f'{v}-*', None, 'no captures of this variant'))
        for size in sizes or []:
            if mine and not any(r.get('cols') == size for r in mine):
                per_box['pane'].append(('fail', f'{v}-*-{size}', None, f'no capture at {size} columns'))
        # edges: the base overflow capture holds an edge row; each overflow extra keeps its height.
        base = [(r, i) for r, i in infos if r.get('mode') == 'overflow' and not r.get('keys') and not r.get('band')]
        extras = [(r, i) for r, i in infos if r.get('mode') == 'overflow' and r.get('keys') and not r.get('band')]
        for r, i in base:
            if i['region'] is None:
                continue
            ok = i['edge']
            per_box['edges'].append(('pass' if ok else 'fail', r['file'], None, '' if ok else 'the overflow capture holds no "↑/↓ N more" row'))
        for r, i in extras:
            ref = next((bi for br, bi in base if br.get('cols') == r.get('cols')), None)
            if i['height'] is None or ref is None or ref['height'] is None:
                continue
            ok = i['height'] == ref['height']
            per_box['edges'].append(('pass' if ok else 'fail', r['file'], None,
                                     '' if ok else f"the height is {i['height']} rows, the overflow capture has {ref['height']}"))
        boxes, fails = {}, []
        for b in BOXES:
            got = per_box[b]
            bad = [g for g in got if g[0] == 'fail']
            boxes[b] = 'fail' if bad else 'pass' if any(g[0] == 'pass' for g in got) else 'n/a'
            if bad:
                st, f, row, why = bad[0]
                fails.append({'box': b, 'file': f, 'row': row, 'why': why})
        ticked = sum(1 for s in boxes.values() if s == 'pass')
        applicable = sum(1 for s in boxes.values() if s != 'n/a')
        smallest = min((r['cols'] for r, _ in infos if r.get('cols')), default=None)
        pick = [(r, i) for r, i in infos if r.get('cols') == smallest and i['height'] is not None]
        first = next(((r, i) for r, i in pick if capture_name(r) == 'normal'), pick[0] if pick else None)
        result['variants'][v] = {'boxes': boxes, 'ticked': ticked, 'applicable': applicable,
                                 'rows60': first[1]['height'] if first else None, 'rank': 0, 'fails': fails}
    big = 10 ** 6
    keyed = lambda v: (-result['variants'][v]['ticked'], result['variants'][v]['rows60'] if result['variants'][v]['rows60'] is not None else big,  # noqa: E731
                       0 if v == 'C' else 1, v)
    order = sorted(variants, key=keyed)
    for n, v in enumerate(order, 1):
        result['variants'][v]['rank'] = n
    result['ranking'] = order
    if len(order) > 1:
        a, b = (result['variants'][order[0]], result['variants'][order[1]])
        result['decidedBy'] = ('boxes ticked' if a['ticked'] != b['ticked'] else
                               'rows@60' if keyed(order[0])[1] != keyed(order[1])[1] else
                               'C first' if keyed(order[0])[2] != keyed(order[1])[2] else 'name')
    return result


def passes_all(v):
    return v['applicable'] > 0 and v['ticked'] == v['applicable']


def fail_text(f):
    where = f['file'] + (f" row {f['row']}" if f['row'] is not None else '')
    return f"{f['box']} ({where}: {f['why']})" if f['why'] else f"{f['box']} ({where})"


def row_text(v, d):
    rows60 = d['rows60'] if d['rows60'] is not None else '-'
    line = f"{v} {d['ticked']}/{d['applicable']} · rows@60 {rows60} · tie-break {d['rank']}"
    if d['fails']:
        line += ' · fail: ' + ', '.join(fail_text(f) for f in d['fails'])
    return line


def render_md(result):
    """The score.md text: the rows, the ranking, the box table and the taste line."""
    out = [f"# Score of {os.path.basename(result['folder'].rstrip('/')) or result['folder']}", '']
    for v in result['ranking']:
        out.append(f'- {row_text(v, result["variants"][v])}')
    why = f" (decided by {result['decidedBy']})" if result['decidedBy'] else ''
    out += ['', f"ranking: {' > '.join(result['ranking'])}{why}", '',
            '| box | ' + ' | '.join(result['ranking']) + ' |', '|---|' + '---|' * len(result['ranking'])]
    for b in BOXES:
        out.append(f'| {b} | ' + ' | '.join(result['variants'][v]['boxes'][b] for v in result['ranking']) + ' |')
    out += ['', f"taste left for you: {result['taste']}", '']
    return '\n'.join(out)


def summary_lines(result):
    lines = [row_text(v, result['variants'][v]) for v in result['ranking']]
    why = f" (decided by {result['decidedBy']})" if result['decidedBy'] else ''
    lines.append(f"ranking: {' > '.join(result['ranking'])}{why}")
    lines.append(f"taste left for you: {result['taste']}")
    return lines


def write(result):
    """Write score.md and score.json into the folder. Read both back. Return their paths."""
    md = os.path.join(result['folder'], 'score.md')
    js = os.path.join(result['folder'], 'score.json')
    text = render_md(result)
    with open(md, 'w', encoding='utf-8') as fh:
        fh.write(text)
    with open(js, 'w', encoding='utf-8') as fh:
        json.dump(result, fh, indent=2, ensure_ascii=False)
        fh.write('\n')
    with open(md, encoding='utf-8') as fh, open(js, encoding='utf-8') as fj:
        if fh.read() != text or json.load(fj) != json.loads(json.dumps(result)):
            raise OSError('score.md or score.json differs from what was written')
    return md, js


def main(argv=None):
    ap = argparse.ArgumentParser(description='Mechanical pre-score of one mockups pass.')
    ap.add_argument('folder')
    ap.add_argument('--pointer', action='append', default=[], metavar='V=G', help='the pointer glyph of variant V (default ❯)')
    ap.add_argument('--json', action='store_true', help='print the JSON document instead of the rows')
    a = ap.parse_args(argv)
    pointers = {}
    for item in a.pointer:
        v, eq, g = item.partition('=')
        if not eq or not v or not g:
            print(f'mods_score.py: FAIL usage: --pointer wants V=G, got {item!r}', file=sys.stderr)
            return 2
        pointers[v] = g
    try:
        result = score_dir(a.folder, pointers=pointers)
        write(result)
    except (ValueError, OSError) as e:
        print(f'mods_score.py: FAIL {e}', file=sys.stderr)
        return 2
    if a.json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print('\n'.join(summary_lines(result)))
    return 0 if any(passes_all(v) for v in result['variants'].values()) else 1


if __name__ == '__main__':
    sys.exit(main())
