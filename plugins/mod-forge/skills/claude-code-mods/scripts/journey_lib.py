# journey_lib.py: shared code of journey-lint.py, crawl.py and storyboard-build.py.
# A journey file is the storyboard graph of one mod: scenarios, nodes, edges.
# Schema: ../references/journey.schema.json. Procedure: ../references/storyboard.md.
# The scripts run with `python3 -I`, so each one adds this folder to sys.path itself.
import collections
import json
import os
import re
import subprocess
import time

HERE = os.path.dirname(os.path.abspath(__file__))
SCHEMA = os.path.join(HERE, '..', 'references', 'journey.schema.json')
SGR = re.compile(r'\x1b\[[0-9;:]*m')
TOKEN = re.compile(r'text:"[^"]*"|\S+')

# Hint rules: a hint on the screen -> the key it names. Group 1 is the key when 'key' is not set.
# A match has no period and ends at ' · ', two spaces or the end of the line, so a sentence in
# the body ("Press r to try again.", "Watch progress in 2: Activity.") does not count. A journey can replace or extend them (gate.hints).
TAIL = r'(?=\s·|\s{2,}|\s*$)'
DEFAULT_HINTS = [
    {'re': r'(?<![\w/.:-])([a-z0-9]): [^·.]+?' + TAIL},          # "k: verb"   (hotkey Button)
    {'re': r'(?<![\w/.:-])([a-z]) to [a-z][^·.]*?' + TAIL},      # "y to stop" (confirm strip)
    {'re': r'Esc to [^·.]+?' + TAIL, 'key': 'Escape'},
    {'re': r'Enter to [^·.]+?' + TAIL, 'key': 'Enter'},
    {'re': r'(?:↑/↓|↓|↑) to [^·.]+?' + TAIL, 'key': 'Down'},
    {'re': r'(?<![\w+])Tab to [^·.]+?' + TAIL, 'key': 'Tab'},
    {'re': r'ctrl\+x tab to [^·.]+?' + TAIL, 'key': 'C-x'},
]
DEFAULT_SAME = [['Up', 'Down']]


def load(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def schema_errors(j):
    """Errors against journey.schema.json. Uses jsonschema when it is installed, else a small check."""
    schema = load(SCHEMA)
    try:
        import jsonschema
    except ImportError:
        jsonschema = None
    if jsonschema is not None:
        v = jsonschema.Draft202012Validator(schema)
        return [f"schema: {'/'.join(str(p) for p in e.absolute_path) or '<root>'}: {e.message}"
                for e in sorted(v.iter_errors(j), key=lambda e: list(map(str, e.absolute_path)))]
    out = []  # fallback: required keys and types of the three lists only
    for k in schema['required']:
        if not isinstance(j.get(k), list):
            out.append(f'schema: <root>: {k} must be a list')
    for k in ('scenarios', 'nodes', 'edges'):
        req = schema['properties'][k]['items']['required']
        for i, item in enumerate(j.get(k) or []):
            miss = [r for r in req if r not in item]
            if miss:
                out.append(f'schema: {k}/{i}: missing {miss}')
    return out


def tokens(key):
    return TOKEN.findall(key)


def key_names(key, same=DEFAULT_SAME):
    """Plain key names of an edge key: no text, no wait, no *N; 'Up' maps to its group head."""
    canon = {k: g[-1] for g in same for k in g}
    out = set()
    for t in tokens(key):
        if t == 'wait' or t.startswith('text:'):
            continue
        t = re.sub(r'\*\d+$', '', t)
        out.add(canon.get(t, t))
    return out


def marker_parts(marker):
    return [p for p in marker.split(' && ') if p]


def holds(text, marker):
    """Parts of `marker` that fail on `text`. A positive part may wrap over two lines."""
    joined = re.sub(r'\s*\n\s*', ' ', text)
    bad = []
    for part in marker_parts(marker):
        if part.startswith('!'):
            if part[1:] in text or part[1:] in joined:
                bad.append(part)
        elif part not in text and part not in joined:
            bad.append(part)
    return bad


def tmux(*args):
    return subprocess.run(['tmux', *args], capture_output=True, text=True).stdout


def send_keys(session, keyspec, mod=''):
    """Press an edge key spec in a tmux session: 'Down*4', 'text:"..."', 'C-x Tab', 'wait'."""
    for tok in tokens(keyspec):
        if tok == 'wait':
            continue
        m = re.fullmatch(r'text:"(.*)"', tok)
        if m:
            tmux('send-keys', '-t', session, '-l', m.group(1).replace('{mod}', mod))
            time.sleep(0.6)
            continue
        m = re.fullmatch(r'(.+)\*(\d+)', tok)
        if m:
            for _ in range(int(m.group(2))):
                tmux('send-keys', '-t', session, m.group(1))
                time.sleep(0.12)
            time.sleep(0.4)
            continue
        tmux('send-keys', '-t', session, tok)
        time.sleep(0.4)


def type_command(session, text):
    """Clear the prompt line, type the text, pause, Enter (text and Enter in one call is not reliable)."""
    tmux('send-keys', '-t', session, 'C-u')
    tmux('send-keys', '-t', session, '-l', text)
    time.sleep(0.8)
    tmux('send-keys', '-t', session, 'Enter')


INLINE_TOP = re.compile(r'^\s*╭─.*✕─╮\s*$', re.M)


def pane_open(screen, open_marker=None):
    """True while a pane shows: the dock divider, the top of an inline pane frame (╭─…✕─╮),
    or the journey's openMarker."""
    return (divider_column(screen) is not None or bool(INLINE_TOP.search(screen))
            or bool(open_marker and open_marker in screen))


def close_pane(session, open_marker=None, tries=8):
    """Close the pane with ONE Esc at a time, and only while it is open: two Esc at an empty
    prompt open Rewind. A pane that steps back one level per Esc needs several."""
    for _ in range(tries):
        if not pane_open(tmux('capture-pane', '-p', '-t', session), open_marker):
            return True
        tmux('send-keys', '-t', session, 'Escape')
        time.sleep(0.8)
    return not pane_open(tmux('capture-pane', '-p', '-t', session), open_marker)


def inverse_runs(line):
    """Plain text of each inverse run (SGR 7 ... 27 or 0) in one captured line."""
    out, cur, inv, pos = [], [], False, 0
    for m in SGR.finditer(line):
        if inv:
            cur.append(line[pos:m.start()])
        pos = m.end()
        codes = m.group()[2:-1].replace(':', ';').split(';')
        i = 0
        while i < len(codes):
            c = codes[i]
            if c in ('38', '48', '58'):
                i += 3 if i + 1 < len(codes) and codes[i + 1] == '5' else 5
                continue
            if c in ('', '0', '27') and inv:
                inv = False
                if ''.join(cur).strip():
                    out.append(''.join(cur))
                cur = []
            elif c == '7':
                inv = True
            i += 1
    if inv:
        cur.append(line[pos:].rstrip('\n'))
        if ''.join(cur).strip():
            out.append(''.join(cur))
    return out


def pane_part(line):
    """The part of a captured row right of its first '│' (dock divider or inline frame), or None."""
    return line.split('│', 1)[1] if '│' in line else None


def focus_rows(ansi_text):
    """[(row, text)] of the focus ring (inverse runs) inside the pane."""
    out = []
    for n, line in enumerate(ansi_text.split('\n')):
        seg = pane_part(line)
        if seg is not None:
            out += [(n, t.strip()) for t in inverse_runs(seg)]
    return out


def pointer_rows(ansi_text, pointer='❯'):
    """Rows inside the pane whose text holds the pointer glyph as a word ('❯ name', '> 1. name')."""
    rx = re.compile(r'(?:^|\s)' + re.escape(pointer) + r'(?=\s)')
    out = []
    for n, line in enumerate(ansi_text.split('\n')):
        seg = pane_part(line)
        if seg is not None and rx.search(SGR.sub('', seg)):
            out.append(n)
    return out


def divider_column(screen):
    """Column of the dock divider '│' (on at least half the rows), or None."""
    lines = screen.split('\n')
    cnt = collections.Counter(i for line in lines for i, ch in enumerate(line) if ch == '│' and i >= 10)
    if not cnt:
        return None
    col, n = cnt.most_common(1)[0]
    return col if n >= max(5, len(lines) // 2) else None


def region(screen, node, pane_column=None):
    """The text a node's marker is searched in: the pane body, or the whole screen."""
    if node.get('region') == 'screen':
        return screen
    if pane_column is None:
        d = divider_column(screen)
        if d is None:
            return screen
        pane_column = d + 1
    if pane_column <= 0:
        return screen
    return '\n'.join(line[pane_column:] for line in screen.split('\n'))


class Graph:
    """Nodes, edges, scenario starts and path search on a journey."""

    def __init__(self, j):
        self.j = j
        self.nodes = {n['id']: n for n in j['nodes']}
        self.starts = {s['id']: s['start'] for s in j['scenarios']}
        self.scenarios = list(self.starts)
        self.out = collections.defaultdict(list)
        for e in j['edges']:
            self.out[e['from']].append(e)

    def allowed(self, e, scn, exact=True):
        """May a path in scenario `scn` use edge `e`? exact: no approx and no history edges."""
        if exact and ('approx' in e or e.get('history')):
            return False
        if e.get('scn') and e['scn'] != scn:
            return False
        if 'onlyIn' in e and scn not in e['onlyIn']:
            return False
        if scn in e.get('notIn', []):
            return False
        if not e.get('scn'):
            # A sibling edge with the same key that names this scenario wins.
            for o in self.out[e['from']]:
                if o is not e and o['key'] == e['key'] and o.get('scn') == scn:
                    return False
        return True

    def path(self, scn, target, start=None):
        """Shortest list of edges from `start` (default: the scenario start) to `target`, or None."""
        start = start or self.starts[scn]
        if start not in self.nodes:
            return None
        prev = {start: None}
        q = collections.deque([start])
        while q:
            cur = q.popleft()
            if cur == target:
                break
            for e in self.out[cur]:
                if e['to'] not in prev and e['to'] in self.nodes and self.allowed(e, scn):
                    prev[e['to']] = e
                    q.append(e['to'])
        if target not in prev:
            return None
        out, node = [], target
        while prev[node] is not None:
            out.append(prev[node])
            node = prev[node]['from']
        return list(reversed(out))

    def node_route(self, nid):
        """(scenario, path) to capture a node: its own scenario first, then any other."""
        own = self.nodes[nid]['scenario']
        for scn in [own] + [s for s in self.scenarios if s != own]:
            p = self.path(scn, nid)
            if p is not None:
                return scn, p
        return None, None

    def edge_scenario(self, e):
        """The scenario to replay edge `e` in: its 'scn', the target's, the source's, then any."""
        order = [e.get('scn'), self.nodes.get(e['to'], {}).get('scenario'), self.nodes.get(e['from'], {}).get('scenario')]
        order += self.scenarios
        seen = set()
        for scn in order:
            if not scn or scn in seen or scn not in self.starts:
                continue
            seen.add(scn)
            if self.allowed(e, scn, exact=False) and self.path(scn, e['from']) is not None:
                return scn
        return None


def edge_id(e):
    return f"{e['from']} -[{e['key']}]-> {e['to']}"


def hint_rules(j):
    g = j.get('gate', {})
    rules = list(g.get('hints') or DEFAULT_HINTS) + list(g.get('extraHints', []))
    return [(re.compile(r['re']), r.get('key')) for r in rules], [re.compile(x) for x in g.get('ignore', [])]


def hints_in(lines, j):
    """[(key, row, col0, col1)] for each hint on these lines."""
    rules, ignore = hint_rules(j)
    canon = {k: g[-1] for g in j.get('gate', {}).get('same', DEFAULT_SAME) for k in g}
    found = []
    for r, line in enumerate(lines):
        blocked = [(m.start(), m.end()) for ig in ignore for m in ig.finditer(line)]
        taken = []
        for rx, key in rules:
            for m in rx.finditer(line):
                if any(a <= m.start() < b for a, b in blocked + taken):
                    continue
                k = key or (m.group(1) if m.groups() else None)
                if not k:
                    continue
                taken.append((m.start(), m.end()))
                found.append((canon.get(k, k), r, m.start(), m.end()))
    return found


# ---- audit rows: the source lines that can make a screen or a key (used by audit-handlers.py and mods_gen.py)
# Each kind has a regex over one stripped source line. A line can hold several kinds.
KINDS = [
    ('hook', re.compile(r"\bon\(\s*'([\w.]+)'")),
    ('handler', re.compile(r'\bon(Press|Submit|Select|Input|Change)=')),
    ('hotkey', re.compile(r'\bhotkey=')),
    ('close', re.compile(r'\$\.ui\.close\(')),
    ('timer', re.compile(r'\$\.clock\.\w+\(')),
    ('deny', re.compile(r'\bdeny:')),
    ('draw', re.compile(r'\breturn\s*(\(\s*$|<)')),
    ('branch', re.compile(r"\bif\s*\(|[!=]==\s*'[^']*'\s*\?")),
]
# A source cite: '<file>:<line>', '<file>:<a>-<b>' or '<file>:<a>, <b>'.
CITE = re.compile(r'([\w./-]+\.tsx?):\s*(\d+(?:-\d+)?(?:\s*,\s*\d+(?:-\d+)?)*)')


def rows_of(mod):
    """(rows, files) of the .ts/.tsx files under <mod>/hooks/. Tests, node_modules and hooks/kit/ are skipped.
    hooks/kit/ is the copied kit: its lines are not the mod's own screens or keys."""
    rows, files = [], {}
    base = os.path.join(mod, 'hooks')
    for root, dirs, fs in os.walk(base):
        dirs[:] = [d for d in dirs if d not in ('node_modules', 'tests') and not (root == base and d == 'kit')]
        for f in sorted(fs):
            if not f.endswith(('.ts', '.tsx')) or '.test.' in f:
                continue
            p = os.path.join(root, f)
            rel = os.path.relpath(p, mod)
            lines = open(p, encoding='utf-8').read().split('\n')
            files[rel] = len(lines)
            for n, line in enumerate(lines, 1):
                code = line.strip()
                if code.startswith(('//', '*', '/*', '{/*')):
                    continue
                kinds = [k for k, rx in KINDS if rx.search(code)]
                if kinds:
                    rows.append({'file': rel, 'line': n, 'kind': '+'.join(kinds), 'code': code})
    return rows, files
