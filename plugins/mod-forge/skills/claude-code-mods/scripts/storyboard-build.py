#!/usr/bin/env python3
"""storyboard-build.py: build one self-contained storyboard player (HTML) and run the gate.

Usage:
  python3 -I storyboard-build.py <journey.json> <crawl-out-dir> <out.html> [options]

  crawl-out-dir  the out-dir of crawl.py: result.json and shots/<node>.{png,txt}
  --title T      page title (default: the journey's "title", else "<mod> storyboard")
  --draft        write the player even when the gate fails: failed screens and paths show
                 as red GAPs (never hidden). The exit code is still 1.
  --colors N     quantize each image to N colours before WebP lossless (default 96; 0 = off).
                 Text stays crisp; 96 colours cut a 212-shot player to 19 MB for 212 shots.
  --format F     webp (default when Pillow has WebP) or png
  --no-hotspots  no hotspot rectangles and no hotspot gate (for a host without rsvg-convert, where
                 the hotspot geometry is wrong). The player shows every key as a chip.

GATE (exit 1; without --draft nothing is written):
  graph      every edge names existing nodes; every scenario start exists; every node is
             reachable from a start without approximate or history edges
  shots      every node has shots/<id>.png and .txt; no orphan PNG
  crawl      every node was captured and every edge passed in result.json
  ring       no capture has the focus ring and ❯ on different rows
  hint keys  every key a screen shows (rules: journey "gate", else the defaults in
             journey_lib.py: "k: verb", "y to verb", "Esc to verb", "Enter to verb",
             "↑/↓ to verb", "Tab to verb", "ctrl+x tab to verb") has an outgoing edge
  hotspots   every hotspot is inside the image and its key has an edge (not with --no-hotspots)
Needs Pillow. Hotspot geometry assumes the PNGs came from scripts/render.sh with rsvg-convert.
"""
import argparse
import base64
import collections
import io
import json
import math
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.dont_write_bytecode = True  # no __pycache__ in the skill folder (journey_lib is imported below)
import journey_lib as jl  # noqa: E402

TEMPLATE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'templates', 'storyboard', 'player.html')
# rich export_svg geometry (rich/console.py): char 20 px high, width x0.61, line x1.22,
# text group at (margin 1 + padding 8, margin 1 + padding 40); a row's background starts 1.5 lower.
CW, CH, OX, OY = 20 * 0.61, 20 * 1.22, 9.0, 41.0 + 1.5


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('journey')
    ap.add_argument('crawl')
    ap.add_argument('out')
    ap.add_argument('--title')
    ap.add_argument('--draft', action='store_true')
    ap.add_argument('--colors', type=int, default=96)
    ap.add_argument('--format', choices=['webp', 'png'])
    ap.add_argument('--no-hotspots', action='store_true')
    a = ap.parse_args()
    from PIL import Image, features

    j = jl.load(a.journey)
    g = jl.Graph(j)
    res = jl.load(os.path.join(a.crawl, 'result.json'))
    shots = os.path.join(a.crawl, 'shots')
    cols, rows = res.get('cols', 150), res.get('rows', 45)
    pane_col = j.get('crawl', {}).get('paneColumn')
    caps = {c['node']: c for c in res['captures']}
    eres = {(r['from'], r['key'], r['to']): r for r in res['edges']}
    errors = list(jl.schema_errors(j))

    # ---- gate: graph
    for s in j['scenarios']:
        if s['start'] not in g.nodes:
            errors.append(f"graph: scenario {s['id']}: start {s['start']} is not a node")
    for e in j['edges']:
        if e['from'] not in g.nodes or e['to'] not in g.nodes:
            errors.append(f'graph: edge {jl.edge_id(e)}: unknown node')
    for nid in g.nodes:
        if g.node_route(nid)[0] is None:
            errors.append(f'graph: node {nid}: not reachable from a scenario start without approximate or history edges')

    # ---- gate: shots, crawl, ring
    def has(nid, ext):
        return os.path.exists(os.path.join(shots, f'{nid}.{ext}'))
    pngs = {f[:-4] for f in os.listdir(shots) if f.endswith('.png')} if os.path.isdir(shots) else set()
    for nid in g.nodes:
        if not (has(nid, 'png') and has(nid, 'txt')):
            errors.append(f'shots: node {nid}: no shots/{nid}.png or .txt')
        c = caps.get(nid)
        if not c or not c['ok']:
            errors.append(f"crawl: node {nid}: {'not in the crawl' if not c else 'capture failed: ' + str(c.get('error'))}")
        elif c.get('ring') == 'MISMATCH':
            errors.append(f'ring: node {nid}: the focus ring and ❯ are on different rows')
    for p in sorted(pngs - set(g.nodes)):
        errors.append(f'shots: orphan PNG shots/{p}.png')
    bad_edges = set()
    for i, e in enumerate(j['edges']):
        r = eres.get((e['from'], e['key'], e['to']))
        if not r or not r['ok']:
            bad_edges.add(i)
            errors.append(f"crawl: edge {jl.edge_id(e)}: {'not in the crawl' if not r else 'failed: ' + str(r.get('error'))}")

    # ---- gate: hint keys
    same = j.get('gate', {}).get('same', jl.DEFAULT_SAME)

    def lines_of(nid):
        if not has(nid, 'txt'):
            return [], 0
        scr = open(os.path.join(shots, nid + '.txt'), encoding='utf-8').read()
        node = g.nodes[nid]
        if node.get('region') == 'screen':
            return scr.split('\n'), 0
        base = pane_col if pane_col is not None else ((jl.divider_column(scr) + 1) if jl.divider_column(scr) is not None else 0)
        return scr.split('\n'), base

    out_edges = collections.defaultdict(list)
    for i, e in enumerate(j['edges']):
        out_edges[e['from']].append((i, e))
    hints = {}
    for nid in g.nodes:
        lines, base = lines_of(nid)
        hints[nid] = (jl.hints_in([ln[base:] for ln in lines], j), lines, base)
        shown = {k for k, *_ in hints[nid][0]}
        keys = set().union(*[jl.key_names(e['key'], same) for _, e in out_edges[nid]]) if out_edges[nid] else set()
        miss = shown - keys
        if miss:
            errors.append(f'hint keys: node {nid}: the screen shows {sorted(miss)} but no edge uses them')

    # ---- hotspots: {key: [rect, ...]} in fractions of the image
    sizes = {}

    def geometry(nid):
        if nid not in sizes:
            with Image.open(os.path.join(shots, nid + '.png')) as im:
                sizes[nid] = im.size
        w, h = sizes[nid]
        vbw = math.ceil(cols * CW + 16) + 2
        zoom = w / vbw
        return vbw, h / zoom

    def rect(nid, row, c0, c1):
        vbw, vbh = geometry(nid)
        return [round((OX + CW * c0) / vbw, 5), round((OY + CH * row) / vbh, 5),
                round(CW * (c1 - c0) / vbw, 5), round(CH / vbh, 5)]

    rowre = re.compile(r'^[❯ ] \S')

    def row_block(lines, base):
        sel = next((i for i, ln in enumerate(lines) if len(ln) > base and ln[base] == '❯'), None)
        if sel is None:
            return None, []
        def ok(i):
            return 0 <= i < len(lines) and bool(rowre.match(lines[i][base:]))
        lo = hi = sel
        while ok(lo - 1):
            lo -= 1
        while ok(hi + 1):
            hi += 1
        return sel, list(range(lo, hi + 1))

    def hotspots(nid):
        if a.no_hotspots or not has(nid, 'png'):
            return {}
        found, lines, base = hints[nid]
        sel, block = row_block(lines, base)
        single = {e['key'] for _, e in out_edges[nid]}
        out = {}
        for _, e in out_edges[nid]:
            k = e['key']
            toks = jl.tokens(k)
            if k in out or any(t == 'wait' and len(toks) == 1 or t.startswith('text:') or '*' in t for t in toks):
                continue
            head = toks[0]
            if len(toks) > 1 and not (len(toks) == 2 and toks[1] == 'wait') and head in single:
                continue  # a compound key whose first key has its own edge
            rs = []
            if head in ('Up', 'Down', 'Enter') and sel is not None:
                t = {'Up': sel - 1, 'Down': sel + 1, 'Enter': sel}[head]
                if t in block:
                    rs.append(rect(nid, t, base + 1, max(len(lines[t].rstrip()), base + 2)))
            for hk, r, c0, c1 in found:
                if hk == head:
                    rs.append(rect(nid, r, base + c0, base + c1))
            if rs:
                out[k] = rs
        return out

    N = []
    for n in j['nodes']:
        nid = n['id']
        hs = hotspots(nid)
        for k, rs in hs.items():
            for r in rs:
                if not (0 <= r[0] and 0 <= r[1] and r[0] + r[2] <= 1.0001 and r[1] + r[3] <= 1.0001):
                    errors.append(f'hotspots: node {nid}: hotspot {k} is outside the image')
        img_ok = has(nid, 'png') and caps.get(nid, {}).get('ok', False)
        N.append({'id': nid, 'area': n['area'], 'title': n['title'], 'desc': n['description'], 'scn': n['scenario'],
                  'src': n['source'], 'img': img_ok, 'hs': hs if img_ok else {}})

    if errors:
        print(f'GATE FAILED: {len(errors)} check(s)')
        for m in errors[:120]:
            print('  ' + m)
        if len(errors) > 120:
            print(f'  ... and {len(errors) - 120} more')
        if not a.draft:
            print(f'{a.out} is not written (use --draft to write it with the gaps marked)')
            return 1

    fmt = a.format or ('webp' if features.check('webp') else 'png')

    def data_uri(nid):
        im = Image.open(os.path.join(shots, nid + '.png')).convert('RGB')
        if a.colors:
            im = im.quantize(colors=a.colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
        buf = io.BytesIO()
        if fmt == 'webp':
            im.save(buf, 'WEBP', lossless=True, method=6)
        else:
            im.save(buf, 'PNG', optimize=True)
        return f'data:image/{fmt};base64,' + base64.b64encode(buf.getvalue()).decode()

    imgs = [f'<script type="text/plain" id="img-{n["id"]}">{data_uri(n["id"])}</script>' for n in N if n['img']]
    E = []
    for i, e in enumerate(j['edges']):
        d = {'f': e['from'], 't': e['to'], 'k': e['key'], 'l': e['label'], 's': e['source']}
        for src, dst in (('approx', 'a'), ('scn', 'scn')):
            if e.get(src):
                d[dst] = e[src]
        if e.get('history'):
            d['h'] = 1
        if i in bad_edges:
            d['bad'] = 1
        E.append(d)
    own = collections.Counter(n['scenario'] for n in j['nodes'])
    SC = [{'id': s['id'], 'desc': s['description'], 'start': s['start'], 'group': s.get('group', 'Scenarios'),
           'own': own[s['id']]} for s in j['scenarios']]
    title = a.title or j.get('title') or f"{res.get('mod', 'mod')} storyboard"
    s = res['summary']
    data = {'title': title, 'nodes': N, 'edges': E, 'scenarios': SC, 'cols': cols, 'rows': rows,
            'version': res.get('version', ''), 'gateErrors': len(errors),
            'crawl': {'captured': s['captured'], 'edgesVerified': s['edgesOk'], 'approx': sum('approx' in e for e in j['edges'])}}
    tpl = open(TEMPLATE, encoding='utf-8').read()
    html = (tpl.replace('/*__DATA__*/', 'const DATA=' + json.dumps(data, ensure_ascii=False).replace('</', '<\\/') + ';')
               .replace('<!--__IMAGES__-->', '\n'.join(imgs))
               .replace('__TITLE__', title.replace('&', '&amp;').replace('<', '&lt;')))
    with open(a.out, 'w', encoding='utf-8') as f:
        f.write(html)
    hs_keys = sum(len(n['hs']) for n in N)
    all_keys = sum(len({e['key'] for _, e in out_edges[n['id']] if e['key'] != 'wait'}) for n in N)
    # Keys with no hotspot: text input, K*N repeats, compound keys and keys the screen does
    # not name. The player still shows them as chips under the image.
    no_hs = [(n['id'], k) for n in N for k in sorted({e['key'] for _, e in out_edges[n['id']] if e['key'] != 'wait'}) if k not in n['hs']]
    gate_names = 'graph, shots, crawl, ring, hint keys' + ('' if a.no_hotspots else ', hotspots')
    print((f'gate: {gate_names}: all pass' if not errors else 'DRAFT written with gaps marked'))
    print(f'nodes {len(N)} images {len(imgs)} ({fmt}, colours {a.colors or "all"}) edges {len(E)} '
          f"(approximate {data['crawl']['approx']}) hotspots on {hs_keys} of {all_keys} keys")
    if no_hs:
        print('keys with no hotspot (a chip under the image only): ' + ', '.join(f'{nid} [{k}]' for nid, k in no_hs))
    if a.no_hotspots:
        print('hotspots: off (--no-hotspots)')
    print(f'wrote {a.out} ({os.path.getsize(a.out)} bytes)')
    return 1 if errors else 0


if __name__ == '__main__':
    sys.exit(main())
