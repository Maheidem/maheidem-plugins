#!/usr/bin/env python3
"""crawl.py: capture every node and replay every edge of a storyboard journey, live.

Usage:
  python3 -I crawl.py <mod-dir> <journey.json> <out-dir> [options]

  mod-dir       a COPY of the storyboard prototype mod (not the session's dev-mods folder)
  journey.json  the graph (references/journey.schema.json); run journey-lint.py first
  out-dir       gets shots/<node>.{ansi,txt,png}, result.json and crawl.log

Options (a value in the journey's "crawl" object is the default; the option wins):
  --command T   reset command template, default "/{mod} {scenario}"; {mod} = plugin name
  --sessions N  parallel tmux sessions, default 4 (each is a full Claude Code process)
  --cols C --rows R   terminal size, default 150 x 45 (docked pane)
  --trusted DIR a folder Claude Code trusts (an untrusted folder blocks mods); default: cwd
  --prefix P    tmux session name prefix, default "sbcrawl-"; sessions are P0..P<N-1>
  --only IDS    comma-separated node ids: capture these nodes and replay the edges that
                start or end at them; the records are merged into an existing result.json
  --phase P     all (default), nodes or edges
  --no-render   skip the PNG render and the ring check

Each node: reset its scenario after /clear, walk the shortest exact path from the scenario
start, check the marker after every step, capture. A node with 'focus' also needs that text
under the focus ring (the inverse run). Each edge: reset the scenario, walk to the
source, press the key, check the target marker (or the edge's 'check'). When that fails, it
tries once more via the target (for edges that depend on where you came from).
The sessions start through live-test.sh with NODEBUG=1 (no debug banner in the shots) and are
killed at the end, also on Ctrl-C. Exit 0 when every node and edge passed, else 1.
"""
import argparse
import concurrent.futures as cf
import datetime
import json
import os
import subprocess
import sys
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.dont_write_bytecode = True  # no __pycache__ in the skill folder (journey_lib is imported below)
import journey_lib as jl  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
PRINT = threading.Lock()


def log(out, msg):
    with PRINT:
        print(msg, flush=True)
        with open(os.path.join(out, 'crawl.log'), 'a', encoding='utf-8') as f:
            f.write(msg + '\n')


tmux = jl.tmux


class Crawler:
    def __init__(self, a, j, mod_name):
        self.a, self.j, self.mod = a, j, mod_name
        self.g = jl.Graph(j)
        c = j.get('crawl', {})
        self.template = a.command or c.get('command') or '/{mod} {scenario}'
        self.pane_col = c.get('paneColumn')
        self.clear_scn = set(c.get('clearScenarios', []))
        self.open_marker = c.get('openMarker')
        self.key_to = c.get('keyTimeout', 7)
        self.wait_to = c.get('waitTimeout', 14)
        self.pointer = c.get('pointer', '❯')

    # ---- one session ------------------------------------------------------
    def screen(self, s):
        return tmux('capture-pane', '-p', '-t', s)

    def send(self, s, keyspec):
        jl.send_keys(s, keyspec, self.mod)

    def wait_marker(self, s, node_id, timeout, marker=None):
        node = self.g.nodes[node_id]
        marker = marker or node['marker']
        end, bad, scr = time.time() + timeout, None, ''
        while time.time() < end:
            scr = self.screen(s)
            bad = jl.holds(jl.region(scr, node, self.pane_col), marker)
            if not bad:
                return None, scr
            time.sleep(0.3)
        return bad, scr

    def reset(self, s, scn, clear):
        # ONE Esc at a time, only while the pane is open: two Esc at an empty prompt open Rewind.
        jl.close_pane(s, self.open_marker)
        if clear:
            jl.type_command(s, '/clear')
            time.sleep(2.5)
        jl.type_command(s, self.template.format(mod=self.mod, scenario=scn))
        return self.wait_marker(s, self.g.starts[scn], 10)

    def timeout_of(self, e):
        return e.get('timeout') or (self.wait_to if 'wait' in jl.tokens(e['key']) else self.key_to)

    def walk(self, s, scn, steps, last=None, clear=False):
        """Reset, then press each step. Returns None or (error, region text)."""
        bad, scr = self.reset(s, scn, clear)
        start = self.g.starts[scn]
        if bad:
            return f'start {start} missing {bad}', jl.region(scr, self.g.nodes[start], self.pane_col)
        for st in steps:
            self.send(s, st['key'])
            check = st.get('check') if st is last else None
            bad, scr = self.wait_marker(s, st['to'], self.timeout_of(st), check)
            if bad:
                return f'{jl.edge_id(st)} missing {bad}', jl.region(scr, self.g.nodes[st['to']], self.pane_col)
        return None

    # ---- work items ------------------------------------------------------------
    def capture(self, s, nid, shots):
        rec = {'node': nid, 'ok': False}
        scn, path = self.g.node_route(nid)
        if path is None:
            rec['error'] = 'no exact path from any scenario start'
            return rec
        rec['scenario'] = scn
        rec['path'] = [jl.edge_id(e) for e in path]
        err = self.walk(s, scn, path, clear=True)
        time.sleep(0.8)
        ansi = tmux('capture-pane', '-p', '-e', '-t', s)
        txt = tmux('capture-pane', '-p', '-t', s)
        with open(os.path.join(shots, nid + '.ansi'), 'w', encoding='utf-8') as f:
            f.write(ansi)
        with open(os.path.join(shots, nid + '.txt'), 'w', encoding='utf-8') as f:
            f.write(txt)
        node = self.g.nodes[nid]
        bad = jl.holds(jl.region(txt, node, self.pane_col), node['marker'])
        # 'focus': the text the focus ring must hold (the safe choice on a confirm).
        ring = [t for _, t in jl.focus_rows(ansi)]
        unfocused = 'focus' in node and not any(node['focus'] in t for t in ring)
        if err:
            rec['error'] = err[0]
        elif bad:
            rec['error'] = f'final marker missing {bad}'
        elif unfocused:
            rec['error'] = f"focus: the ring holds {ring}, not {node['focus']!r}"
        rec['ok'] = not err and not bad and not unfocused
        return rec

    def edge(self, s, e):
        rec = {'from': e['from'], 'to': e['to'], 'key': e['key'], 'ok': False, 'approx': 'approx' in e}
        scn = self.g.edge_scenario(e)
        if scn is None:
            rec['error'] = f"no scenario has a path to {e['from']}"
            return rec
        rec['scenario'] = scn
        clear = scn in self.clear_scn
        fail = self.walk(s, scn, self.g.path(scn, e['from']) + [e], last=e, clear=clear)
        if fail:
            first = self.g.path(scn, e['to'])
            back = self.g.path(scn, e['from'], e['to']) if first is not None and e['to'] != self.g.starts[scn] else None
            if back is not None:
                rec['route'] = 'via target'
                fail = self.walk(s, scn, first + back + [e], last=e, clear=clear)
        if fail:
            rec['error'], rec['screen'] = fail
        else:
            rec['ok'] = True
        return rec


def start_session(a, mod_dir, name, cmd, marker):
    env = dict(os.environ, SESSION=name, ROWS=str(a.rows), KEEP='1', NODEBUG='1')
    p = subprocess.run([os.path.join(HERE, 'live-test.sh'), mod_dir, cmd, marker, str(a.cols), a.trusted],
                       env=env, capture_output=True, text=True)
    return p.returncode, p.stdout + p.stderr


def render(out, nid, cols):
    shots = os.path.join(out, 'shots')
    p = subprocess.run([os.path.join(HERE, 'render.sh'), os.path.join(shots, nid + '.ansi'),
                        os.path.join(shots, nid + '.png'), nid, str(cols)], capture_output=True, text=True)
    return p.returncode == 0


def ring(out, nid, node, ring_areas, pointer='❯'):
    """'OK', 'MISMATCH' or 'n/a' (no pointer in the pane, or an area without the check)."""
    path = os.path.join(out, 'shots', nid + '.ansi')
    if ring_areas is not None and node['area'] not in ring_areas:
        return 'n/a'
    p = subprocess.run(['python3', '-I', '-B', os.path.join(HERE, 'ring-check.py'), path, '--pointer', pointer],
                       capture_output=True, text=True)
    return {0: 'OK', 1: 'MISMATCH'}.get(p.returncode, 'n/a')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('mod_dir')
    ap.add_argument('journey')
    ap.add_argument('out')
    ap.add_argument('--command')
    ap.add_argument('--sessions', type=int, default=4)
    ap.add_argument('--cols', type=int)
    ap.add_argument('--rows', type=int)
    ap.add_argument('--trusted', default=os.getcwd())
    ap.add_argument('--prefix', default='sbcrawl-')
    ap.add_argument('--only')
    ap.add_argument('--phase', choices=['all', 'nodes', 'edges'], default='all')
    ap.add_argument('--no-render', action='store_true')
    a = ap.parse_args()

    mod_dir, out = os.path.abspath(a.mod_dir), os.path.abspath(a.out)
    j = jl.load(a.journey)
    errs = jl.schema_errors(j)
    if errs:
        print('FAIL: the journey does not match the schema; run journey-lint.py\n  ' + '\n  '.join(errs[:10]))
        return 1
    c = j.get('crawl', {})
    a.cols, a.rows = a.cols or c.get('cols', 150), a.rows or c.get('rows', 45)
    mod_name = jl.load(os.path.join(mod_dir, '.claude-plugin', 'plugin.json'))['name']
    cr = Crawler(a, j, mod_name)
    shots = os.path.join(out, 'shots')
    os.makedirs(shots, exist_ok=True)

    only = set(a.only.split(',')) if a.only else None
    if only and only - set(cr.g.nodes):
        print(f'FAIL: --only names unknown nodes: {sorted(only - set(cr.g.nodes))}')
        return 1
    nodes = [n['id'] for n in j['nodes'] if only is None or n['id'] in only] if a.phase in ('all', 'nodes') else []
    edges = [e for e in j['edges'] if only is None or e['from'] in only or e['to'] in only] if a.phase in ('all', 'edges') else []
    version = subprocess.run(['claude', '--version'], capture_output=True, text=True).stdout.strip()
    n_sess = max(1, min(a.sessions, len(nodes) + len(edges)))
    names = [f'{a.prefix}{i}' for i in range(n_sess)]
    log(out, f'== {datetime.datetime.now():%Y-%m-%d %H:%M:%S} {version} · mod {mod_name} · {len(nodes)} nodes, '
             f'{len(edges)} edges · {n_sess} sessions {a.cols}x{a.rows} · command "{cr.template}"')

    first = j['scenarios'][0]
    ready = next(p for p in jl.marker_parts(cr.g.nodes[first['start']]['marker']) if not p.startswith('!'))
    t0 = time.time()
    try:
        with cf.ThreadPoolExecutor(n_sess) as ex:
            started = list(ex.map(lambda nm: start_session(a, mod_dir, nm, cr.template.format(mod=mod_name, scenario=first['id']), ready), names))
        for nm, (rc, text) in zip(names, started):
            if rc != 0:
                log(out, f'FAIL: session {nm} live-test.sh failed:\n{text}')
                return 1
            log(out, f'started {nm}')

        def worker(i):
            s, caps, eds = names[i], [], []
            for nid in nodes[i::n_sess]:
                r = cr.capture(s, nid, shots)
                caps.append(r)
                log(out, ('PASS ' if r['ok'] else 'FAIL ') + f"node {nid} ({r.get('scenario')})" + ('' if r['ok'] else f"  {r.get('error')}"))
            for e in edges[i::n_sess]:
                r = cr.edge(s, e)
                eds.append(r)
                log(out, ('PASS ' if r['ok'] else 'FAIL ') + f"edge {jl.edge_id(e)} ({r.get('scenario')})" + ('' if r['ok'] else f"  {r.get('error')}"))
            return caps, eds

        with cf.ThreadPoolExecutor(n_sess) as ex:
            parts = list(ex.map(worker, range(n_sess)))
    finally:
        for nm in names:
            tmux('kill-session', '-t', f'={nm}')
    caps = [r for p in parts for r in p[0]]
    eds = [r for p in parts for r in p[1]]
    crawl_s = time.time() - t0

    if not a.no_render and caps:
        ring_areas = set(c['ringAreas']) if 'ringAreas' in c else None
        with cf.ThreadPoolExecutor(4) as ex:
            done = dict(zip([r['node'] for r in caps], ex.map(lambda r: render(out, r['node'], a.cols), caps)))
        for r in caps:
            r['png'] = done[r['node']]
            r['ring'] = ring(out, r['node'], cr.g.nodes[r['node']], ring_areas, cr.pointer)

    res_path = os.path.join(out, 'result.json')
    old = jl.load(res_path) if os.path.exists(res_path) and only else {'captures': [], 'edges': []}
    new_n = {r['node'] for r in caps}
    new_e = {(r['from'], r['key'], r['to']) for r in eds}
    all_caps = [r for r in old['captures'] if r['node'] not in new_n] + caps
    all_eds = [r for r in old['edges'] if (r['from'], r['key'], r['to']) not in new_e] + eds
    order_n = {n['id']: i for i, n in enumerate(j['nodes'])}
    order_e = {(e['from'], e['key'], e['to']): i for i, e in enumerate(j['edges'])}
    all_caps.sort(key=lambda r: order_n.get(r['node'], 1e9))
    all_eds.sort(key=lambda r: order_e.get((r['from'], r['key'], r['to']), 1e9))
    summary = {
        'nodes': len(j['nodes']), 'captured': sum(r['ok'] for r in all_caps),
        'failedNodes': [r['node'] for r in all_caps if not r['ok']],
        'edges': len(j['edges']), 'edgesOk': sum(r['ok'] for r in all_eds),
        'failedEdges': [f"{r['from']} -[{r['key']}]-> {r['to']}" for r in all_eds if not r['ok']],
        'ring': {k: sum(r.get('ring') == k for r in all_caps) for k in ('OK', 'MISMATCH', 'n/a')},
    }
    result = {'version': version, 'mod': mod_name, 'journey': os.path.abspath(a.journey), 'command': cr.template,
              'cols': a.cols, 'rows': a.rows, 'summary': summary, 'captures': all_caps, 'edges': all_eds}
    with open(res_path, 'w', encoding='utf-8') as f:
        json.dump(result, f, indent=1, ensure_ascii=False)
    this_ok = sum(r['ok'] for r in caps) == len(caps) and sum(r['ok'] for r in eds) == len(eds)
    log(out, f"DONE this run: nodes {sum(r['ok'] for r in caps)}/{len(caps)}, edges {sum(r['ok'] for r in eds)}/{len(eds)} "
             f"in {crawl_s:.0f} s · result.json: nodes {summary['captured']}/{summary['nodes']}, "
             f"edges {summary['edgesOk']}/{summary['edges']}, ring {summary['ring']}")
    return 0 if this_ok and summary['ring']['MISMATCH'] == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
