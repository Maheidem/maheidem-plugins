#!/usr/bin/env python3
"""audit-handlers.py: the handler-by-handler checklist of a mod against its storyboard journey.

Usage: python3 -I audit-handlers.py <mod dir> [<journey.json>]

It reads every .ts/.tsx file under <mod dir>/hooks/ (not tests, not hooks/kit/, the copied kit) and lists each line that can
make a screen or a key (references/storyboard.md 3):
  hook     on('<event>', ...)                    a registration: command.run, ui.close, ui.focus, ...
  handler  onPress= onSubmit= onSelect= onInput= onChange=
  hotkey   hotkey=
  close    $.ui.close(...)
  timer    $.clock.<fn>(...)                     a 'wait' edge
  deny     deny:                                 a refusal: one outcome
  draw     return ( / return <                   a branch of a render hook: a node
  branch   if (...) / === '<lit>' ?              a view, an action or an outcome
With a journey it ticks each line against the `source` cites of the nodes and edges
(`<file>:<line>`, `<file>:<a>-<b>`, `<file>:<a>, <b>`; the file may be a path suffix).
A line no cite covers is OPEN. Waive a line on purpose in the journey:
  "audit": {"skip": {"<text of that line>": "<why it has no node or edge>"}}
A cite past the end of its file, or of a file that does not exist, is STALE (the lines
drifted after an edit). A source whose cites hold no listed line at all is a warning (often a drift).
Exit 1 when a line is OPEN or a cite is STALE. Without a journey it only lists the lines.
"""
import json
import os
import re
import sys

sys.dont_write_bytecode = True  # no __pycache__ in the skill folder (journey_lib is imported below)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from journey_lib import CITE, KINDS, rows_of  # noqa: E402,F401  (the audit rows live in journey_lib.py)


def cites_of(j):
    out = []
    for what, items in (('node', j.get('nodes', [])), ('edge', j.get('edges', []))):
        for it in items:
            name = it['id'] if what == 'node' else f"{it['from']} -[{it['key']}]-> {it['to']}"
            for m in CITE.finditer(it.get('source', '')):
                for part in re.split(r'\s*,\s*', m.group(2)):
                    a, _, b = part.partition('-')
                    out.append({'what': what, 'name': name, 'file': m.group(1), 'a': int(a), 'b': int(b or a), 'src': it.get('source', '')})
    return out


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    mod = argv[1]
    rows, files = rows_of(mod)
    if len(argv) < 3:
        for r in rows:
            print(f"{r['file']}:{r['line']:<5} {r['kind']:<14} {r['code'][:90]}")
        print(f'{len(rows)} lines to cover with nodes and edges')
        return 0
    j = json.load(open(argv[2], encoding='utf-8'))
    skip = (j.get('audit') or {}).get('skip') or {}
    cites = cites_of(j)
    stale, empty = [], []
    for c in cites:
        hit = [f for f in files if f == c['file'] or f.endswith('/' + c['file'].lstrip('./'))]
        if not hit:
            stale.append(f"STALE {c['what']} {c['name']}: {c['file']} is not a file of the mod")
            continue
        c['hit'] = hit[0]
        if c['b'] > files[hit[0]]:
            stale.append(f"STALE {c['what']} {c['name']}: {c['file']}:{c['b']} is past the end ({files[hit[0]]} lines)")
    for c in cites:
        if 'hit' not in c or c['b'] > files[c['hit']]:
            continue
        same = [d for d in cites if d['src'] == c['src'] and d['name'] == c['name'] and 'hit' in d]
        if not any(r['file'] == d['hit'] and d['a'] <= r['line'] <= d['b'] for d in same for r in rows):
            empty.append(f"WARN  {c['what']} {c['name']}: source {c['src']!r} holds no listed line (drifted?)")
    empty = sorted(set(empty), key=empty.index)
    n_open = n_skip = 0
    for r in rows:
        by = {c['what'] for c in cites if c.get('hit') == r['file'] and c['a'] <= r['line'] <= c['b']}
        why = next((v for k, v in skip.items() if k in r['code']), None)
        if by:
            status = '+'.join(sorted(by))
        elif why is not None:
            status, n_skip = 'skip', n_skip + 1
        else:
            status, n_open = 'OPEN', n_open + 1
        note = f'  ({why})' if status == 'skip' else ''
        print(f"{status:<10} {r['file']}:{r['line']:<5} {r['kind']:<14} {r['code'][:80]}{note}")
    for m in stale + empty:
        print(m)
    unused = [k for k in skip if not any(k in r['code'] for r in rows)]
    for k in unused:
        print(f'WARN  audit.skip {k!r} matches no listed line')
    print(f'{len(rows)} lines · {len(rows) - n_open - n_skip} cited · {n_skip} skipped · {n_open} OPEN · '
          f'{len(stale)} stale cites · {len(empty) + len(unused)} warnings')
    return 1 if n_open or stale else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
