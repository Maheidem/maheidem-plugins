# journey_build.py: helpers to write a storyboard journey.json from Python, so a big graph
# stays short and every node and edge keeps its source. Example: templates/pane-list.journey.py.
#
#   import sys; sys.path.insert(0, '<this skill>/scripts')
#   from journey_build import Journey
#   j = Journey('my-mod · design C storyboard', notes='...', crawl={'command': '/{mod} C {scenario}'})
#   j.scenario('normal', '4 items, saves work.', start='list-normal')
#   j.node('list-normal', 'list', 'List', '...', 'normal', '4 items && ❯ Call', 'register.tsx:200')
#   j.edge('list-normal', 'detail', 'Enter', 'Open the item', 'register.tsx:230')
#   j.fan(['list-b', 'list-c'], 'a', 'add', 'Add an item', 'register.tsx:150', check='New item')
#   j.skip("on('session.start'", 'registers the command; draws nothing')  # audit-handlers.py waiver
#   j.write('journey.json')          # writes, then runs journey-lint.py and prints its result
#
# With mod_dir (the plugin folder) the source of a node or an edge can name the code by symbol:
#   j.cite('openDetail', "on('ui.close'")  ->  'hooks/views.tsx:85-88 (openDetail), hooks/register.tsx:52-60 (ui.close)'
# The line numbers are read from the file as it is now, so a taste edit never makes a stale cite.
# j.auto_skips() waives every source line that ends in an `@skip: <why>` comment (the audit waiver above).
#
# Rules it applies for you (references/storyboard.md 2):
# - fan(): an approximate edge from each node, replayed in that node's own scenario.
# - twin(): the same screen in another scenario is its own node; it may share the marker,
#   because the marker rule is per scenario. Use it when an edge out of that screen leads to
#   a different place in that scenario (Esc back to an empty list, for example).
import copy
import json
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.dont_write_bytecode = True  # no __pycache__ in the skill scripts folder
import journey_lib as jl  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
SKIP_TAG = '@skip:'


def _brackets(line, st):
    """The change of the bracket depth over one source line. st is the scanner state: it holds the open
    template literals, so a template literal that spans lines is read right. Brackets inside a string, a template
    literal or a comment do not count. A quote that is not closed on its line ends at the end of the line."""
    delta, i, n = 0, 0, len(line)
    quote = None
    while i < n:
        c = line[i]
        if st['block']:
            if line.startswith('*/', i):
                st['block'], i = False, i + 2
            else:
                i += 1
            continue
        if quote:
            if c == '\\':
                i += 2
                continue
            if c == quote:
                quote = None
            i += 1
            continue
        top = st['tpl'][-1] if st['tpl'] else None  # None: code; a number: inside ${ } with that brace depth; -1: template text
        if top == -1:
            if c == '\\':
                i += 2
                continue
            if c == '`':
                st['tpl'].pop()
            elif c == '$' and line.startswith('${', i):
                st['tpl'].append(0)
                i += 1
            i += 1
            continue
        if c == '/' and line.startswith('//', i):
            break
        if c == '/' and line.startswith('/*', i):
            st['block'], i = True, i + 2
            continue
        if c in '\'"':
            quote = c
        elif c == '`':
            st['tpl'].append(-1)
        elif top is not None and c == '{':
            st['tpl'][-1] = top + 1
        elif top is not None and c == '}':
            if top == 0:
                st['tpl'].pop()
            else:
                st['tpl'][-1] = top - 1
        elif top is None and c in '([{':
            delta += 1
        elif top is None and c in ')]}':
            delta -= 1
        i += 1
    return delta


class Journey:
    def __init__(self, title, notes='', crawl=None, gate=None, mod_dir=None):
        self.j = {'title': title, 'notes': notes, 'scenarios': [], 'nodes': [], 'edges': []}
        if crawl:
            self.j['crawl'] = crawl
        if gate:
            self.j['gate'] = gate
        self._nodes = {}
        self.mod_dir = mod_dir
        self._files = None

    def _hook_files(self):
        """The source files of cite(): hooks/register.tsx first, then the other hooks/*.ts(x) files sorted.
        Never hooks/kit/ (the copied kit) and never a test file. Return [(relative path, [lines])]."""
        if self._files is not None:
            return self._files
        if not self.mod_dir:
            sys.exit('cite: this Journey has no mod_dir (pass mod_dir=<plugin folder> to Journey)')
        base = os.path.join(self.mod_dir, 'hooks')
        names = []
        for root, dirs, fs in os.walk(base):
            dirs[:] = sorted(d for d in dirs if d not in ('node_modules', 'tests') and not (root == base and d == 'kit'))
            for f in sorted(fs):
                if f.endswith(('.ts', '.tsx')) and '.test.' not in f:
                    names.append(os.path.relpath(os.path.join(root, f), self.mod_dir))
        names.sort(key=lambda r: (r != os.path.join('hooks', 'register.tsx'), r))
        out = []
        for rel in names:
            with open(os.path.join(self.mod_dir, rel), encoding='utf-8') as fh:
                out.append((rel, fh.read().split('\n')))
        self._files = out
        return out

    def cite(self, *anchors):
        """The source string of a node or an edge, by symbol. An anchor is a name (`openDetail`: a function or a const)
        or a piece of code (`"on('ui.close'"`: the first line that holds it). The range ends at the line where the
        brackets that the first line opened are closed. Example: 'hooks/views.tsx:85-88 (openDetail), hooks/register.tsx:52-60 (ui.close)'.
        An anchor with no match ends the run: keep the seeded names, or add the screen to journey.local.py."""
        files = self._hook_files()
        out = []
        for anchor in anchors:
            if re.fullmatch(r'[A-Za-z_$][\w$]*', anchor):
                rx = re.compile(r'^\s*(?:export\s+)?(?:(?:async\s+)?function\s+|const\s+)' + re.escape(anchor) + r'\b')
                hit = lambda line: rx.search(line) is not None
            else:
                hit = lambda line, a=anchor: a in line
            found = None
            for rel, lines in files:
                for n, line in enumerate(lines):
                    if hit(line) and not line.lstrip().startswith('//'):
                        found = (rel, lines, n)
                        break
                if found:
                    break
            if not found:
                sys.exit(f"cite: no line for {anchor!r} in hooks/ (keep the seeded names)")
            rel, lines, n = found
            st, depth, opened, end = {'tpl': [], 'block': False}, 0, False, n
            for k in range(n, len(lines)):
                depth += _brackets(lines[k], st)
                opened = opened or depth > 0
                end = k
                if opened and depth <= 0:
                    break
            label = re.sub(r"^on\('([\w.]+)'(?:, \{ component: '(\w+)')?.*$", lambda m: m.group(1) + (' ' + m.group(2) if m.group(2) else ''), anchor)
            ref = f'{rel}:{n + 1}' + (f'-{end + 1}' if end > n else '') + f' ({label})'
            if ref not in out:
                out.append(ref)
        return ', '.join(out)

    def auto_skips(self):
        """Waive each source line that ends in an `// @skip: <why>` comment (the audit waiver of skip()).
        The templates mark the lines that have no screen of their own this way."""
        rows, _ = jl.rows_of(self.mod_dir)
        for r in rows:
            at = r['code'].find(SKIP_TAG)
            if at < 0:
                continue
            before = r['code'][:at]
            before = before[:before.rfind('//')] if '//' in before else before
            if before.strip():
                self.skip(before.strip(), r['code'][at + len(SKIP_TAG):].strip())

    def scenario(self, id, description, start, group=None):
        s = {'id': id, 'description': description, 'start': start}
        if group:
            s['group'] = group
        self.j['scenarios'].append(s)

    def node(self, id, area, title, description, scenario, marker, source, region=None, focus=None):
        """region='screen' for a band, a toast, a closed pane or a transcript line.
        focus = text the focus ring must hold (the safe choice on a confirm)."""
        n = {'id': id, 'area': area, 'title': title, 'description': description,
             'scenario': scenario, 'marker': marker, 'source': source}
        if region:
            n['region'] = region
        if focus:
            n['focus'] = focus
        self.j['nodes'].append(n)
        self._nodes[id] = n
        return id

    def twin(self, of, id, scenario, **change):
        """Copy node `of` into another scenario under a new id (same marker unless changed)."""
        n = copy.deepcopy(self._nodes[of])
        n.update(id=id, scenario=scenario, **change)
        self.j['nodes'].append(n)
        self._nodes[id] = n
        return id

    def edge(self, frm, to, key, label, source, **kw):
        """kw: scn, onlyIn, notIn, history, approx, check, timeout (journey.schema.json)."""
        e = {'from': frm, 'to': to, 'key': key, 'label': label, 'source': source}
        e.update({k: v for k, v in kw.items() if v is not None})
        self.j['edges'].append(e)

    def fan(self, froms, key, to, label, source, check, approx='Same screen for another item or fixture.'):
        """One approximate edge from each node in `froms`, replayed in that node's scenario.
        `check` must hold on the REAL screen after the key."""
        for f in froms:
            if f == to:
                continue
            self.edge(f, to, key, label, source, scn=self._nodes[f]['scenario'], approx=approx, check=check)

    def skip(self, text, why):
        """Waive a source line in scripts/audit-handlers.py: `text` is a piece of that line."""
        self.j.setdefault('audit', {}).setdefault('skip', {})[text] = why

    def write(self, path, lint=True):
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(self.j, f, indent=1, ensure_ascii=False)
        print(f"wrote {path}: {len(self.j['nodes'])} nodes, {len(self.j['edges'])} edges", flush=True)
        if lint:
            return subprocess.run([sys.executable, '-I', '-B', os.path.join(HERE, 'journey-lint.py'), path]).returncode
        return 0
