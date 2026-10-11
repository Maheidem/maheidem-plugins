#!/usr/bin/env python3
"""journey-lint.py: check a storyboard journey file before you crawl it.

Usage: python3 -I journey-lint.py <journey.json> [--shots <dir>] [--quiet]

Errors (exit 1):
  schema      the file matches references/journey.schema.json
  ids         node ids and scenario ids are unique
  links       every edge and every scenario start names an existing node and scenario
  markers     no two nodes of one scenario have the same marker; a marker has a positive part
  reach       every node is reachable from its own scenario start without approximate or
              history edges (crawl.py replays every node and edge from a scenario start)
  way out     every node has at least one outgoing edge (a key, or 'wait' for a timer)
  source      every node and every edge has a source
  keys        every key token is a known tmux key name, 'K*N', 'text:"..."' or 'wait'
  approx      an approximate edge has a note; it is never the only way into its target
  --shots     with a folder of <node>.txt captures: the target's marker of each edge A->B
              does NOT already hold on A's capture (else the edge proves nothing)
Warnings: pane nodes with no Escape edge (fine for busy screens; nodes with region 'screen',
such as a closed pane, a band or a toast, are not counted), nodes reachable only from another
scenario's start.
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.dont_write_bytecode = True  # no __pycache__ in the skill folder (journey_lib is imported below)
import journey_lib as jl  # noqa: E402

TMUX_KEYS = {'Enter', 'Escape', 'Tab', 'BTab', 'BSpace', 'Space', 'Up', 'Down', 'Left', 'Right',
             'Home', 'End', 'PageUp', 'PageDown', 'PPage', 'NPage', 'DC', 'IC', 'wait'}
KEY_RE = re.compile(r'^(?:[CMS]-)*(?:[A-Za-z0-9]|[!-/:-@\[-`{-~]|F[0-9]{1,2}|' + '|'.join(sorted(TMUX_KEYS)) + r')(?:\*\d+)?$')


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    path = argv[1]
    shots = argv[argv.index('--shots') + 1] if '--shots' in argv else None
    quiet = '--quiet' in argv
    j = jl.load(path)
    errors, warns = [], []
    errors += jl.schema_errors(j)
    if errors:  # the rest assumes the shape
        return report(path, errors, warns, j, quiet)

    g = jl.Graph(j)
    for kind, items in (('node', j['nodes']), ('scenario', j['scenarios'])):
        seen = set()
        for it in items:
            if it['id'] in seen:
                errors.append(f"ids: {kind} id '{it['id']}' is used twice")
            seen.add(it['id'])
    scn_ids = set(g.starts)
    for s in j['scenarios']:
        if s['start'] not in g.nodes:
            errors.append(f"links: scenario '{s['id']}' starts at '{s['start']}', which is not a node")
    for n in j['nodes']:
        if n['scenario'] not in scn_ids:
            errors.append(f"links: node '{n['id']}' names scenario '{n['scenario']}', which does not exist")
        if not n['source'].strip():
            errors.append(f"source: node '{n['id']}' has an empty source")
        if not any(not p.startswith('!') for p in jl.marker_parts(n['marker'])):
            errors.append(f"markers: node '{n['id']}' marker has no positive part: {n['marker']!r}")
    for e in j['edges']:
        eid = jl.edge_id(e)
        for end in ('from', 'to'):
            if e[end] not in g.nodes:
                errors.append(f"links: edge {eid}: '{e[end]}' is not a node")
        for f in ('scn',):
            if e.get(f) and e[f] not in scn_ids:
                errors.append(f"links: edge {eid}: {f} '{e[f]}' is not a scenario")
        for f in ('onlyIn', 'notIn'):
            for s in e.get(f, []):
                if s not in scn_ids:
                    errors.append(f"links: edge {eid}: {f} names '{s}', which is not a scenario")
        if not e['source'].strip():
            errors.append(f'source: edge {eid} has an empty source')
        for t in jl.tokens(e['key']):
            if not (t.startswith('text:"') or KEY_RE.match(t)):
                errors.append(f"keys: edge {eid}: '{t}' is not a tmux key name, K*N, text:\"...\" or wait")
        if 'approx' in e and not e['approx'].strip():
            errors.append(f'approx: edge {eid} has an empty approx note')
    if errors:
        return report(path, errors, warns, j, quiet)

    by_scn = {}
    for n in j['nodes']:
        other = by_scn.setdefault((n['scenario'], n['marker']), n['id'])
        if other != n['id']:
            errors.append(f"markers: nodes '{other}' and '{n['id']}' in scenario '{n['scenario']}' have the same marker {n['marker']!r}")

    for n in j['nodes']:
        nid = n['id']
        if g.path(n['scenario'], nid) is None:
            scn, _ = g.node_route(nid)
            if scn is None:
                errors.append(f"reach: node '{nid}' is not reachable from any scenario start without approximate or history edges")
            else:
                warns.append(f"reach: node '{nid}' is reachable from scenario '{scn}', not from its own scenario '{n['scenario']}'")
        if not g.out[nid]:
            errors.append(f"way out: node '{nid}' has no outgoing edge (add the key that leaves it, or 'wait')")
        elif n.get('region') != 'screen' and not any('Escape' in jl.tokens(e['key']) for e in g.out[nid]):
            # a 'screen' node (closed pane, band, toast, transcript line) has no pane to step
            # back from, and Esc at an empty prompt twice opens Rewind: no warning for it
            warns.append(f"no Escape: '{nid}'")

    exact_in = {e['to'] for e in j['edges'] if 'approx' not in e}
    for e in j['edges']:
        if 'approx' in e and e['to'] not in exact_in and e['to'] not in {s['start'] for s in j['scenarios']}:
            errors.append(f"approx: node '{e['to']}' is reached only by approximate edges; add an exact path to it")
    for e in j['edges']:
        if g.edge_scenario(e) is None:
            errors.append(f'reach: edge {jl.edge_id(e)}: no scenario has a path to its source where the edge is allowed')

    if shots:
        for e in j['edges']:
            if e['from'] == e['to']:
                continue
            p = os.path.join(shots, e['from'] + '.txt')
            if not os.path.exists(p):
                continue
            scr = open(p, encoding='utf-8').read()
            target = e.get('check') or g.nodes[e['to']]['marker']
            if not jl.holds(jl.region(scr, g.nodes[e['to']], j.get('crawl', {}).get('paneColumn')), target):
                errors.append(f"markers: edge {jl.edge_id(e)}: the target marker {target!r} already holds on the source capture; make it stricter")
    return report(path, errors, warns, j, quiet)


def report(path, errors, warns, j, quiet):
    n, e = len(j.get('nodes') or []), len(j.get('edges') or [])
    s = len(j.get('scenarios') or [])
    ap = sum(1 for x in j.get('edges') or [] if isinstance(x, dict) and 'approx' in x)
    print(f'{path}: {s} scenarios, {n} nodes, {e} edges ({ap} approximate)')
    if warns and not quiet:
        noesc = [w for w in warns if w.startswith('no Escape')]
        other = [w for w in warns if not w.startswith('no Escape')]
        for w in other:
            print('WARN  ' + w)
        if noesc:
            print(f"WARN  {len(noesc)} nodes have no Escape edge: " + ', '.join(w.split("'")[1] for w in noesc))
    for m in errors:
        print('ERROR ' + m)
    print(f'{"FAIL" if errors else "OK"}: {len(errors)} errors, {len(warns)} warnings')
    return 1 if errors else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
