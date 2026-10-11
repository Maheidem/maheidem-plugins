#!/usr/bin/env python3 -I
"""mods_live.py: the live subcommands of mods.py (group E).

  crawl       replay the journey in real tmux sessions (crawl.py), then lint the shots
  storyboard  build the player (storyboard-build.py), check the size, take one player shot
  live        run the plugin in one real session: marker, keys, PNG, ring, NO_COLOR, debug log
  selfcheck   test the toolchain on a throw-away workbench

mods.py imports this file only when one of these subcommands runs. Each cmd_<name>(ctx, args)
returns Done or raises Fail. mods.py prints the two last lines and writes RUN.md.
Also here: gen_shot (generator 4.4, the player shot) and size_note (the 16 MB warning).
"""
import sys

sys.dont_write_bytecode = True  # no __pycache__ in the skill folder

import ast
import datetime
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
import urllib.parse

import mods
from mods import Done, Fail, S, SC, Ctx, KINDS, kill_own, last_lines, own_sessions, plugin, py, refresh_run, refuse_busy, run_step, sh, src_dir

import journey_lib as jl

PAGE_LIMIT = 16_000_000  # bytes. The artifact page limit. Above it, storyboard warns. It never refuses.
PLAYWRIGHT_KEYS = {'Up': 'ArrowUp', 'Down': 'ArrowDown'}
PLAYER_KEYS = {'Enter', 'Escape', 'Tab', 'Up', 'Down'}  # the player's own key map (player.html, BROWSER)
SHOT_RE = re.compile(r'^player: #(\S+), key (\S+) -> (#\S*), errors (\[.*\])$')
DONE_RE = re.compile(r'^DONE this run: nodes (\d+)/(\d+), edges (\d+)/(\d+) in (\d+) s · '
                     r'result\.json: nodes (\d+)/(\d+), edges (\d+)/(\d+), ring (\{.*\})$')
WROTE_RE = re.compile(r'^wrote (\S+) \((\d+) bytes\)$')
STEP_RE = re.compile(r'^([\w-]+): (PASS|FAIL) (.*)$')


def _short(wb, cmd):
    return f'mods.py -C {wb} {cmd}'


def _journey_ok(wb):
    """Refuse a crawl or storyboard when the newest journey run failed: journey.json may be the one of an older PASS (D14)."""
    last = mods._newest(mods.read_runs(wb), ('journey',))
    if last and last['result'] != 'PASS':
        raise Fail('the newest journey run failed; fix it, then run mods.py journey', _short(wb, 'journey'))


def _journey_paths(ctx):
    wb = ctx.wb
    return os.path.join(wb, 'journey.json'), os.path.join(wb, 'journey.py')


def _load_journey(ctx):
    jpath, _ = _journey_paths(ctx)
    if not os.path.isfile(jpath):
        raise Fail('journey.json is missing; run mods.py journey', _short(ctx.wb, 'journey'))
    try:
        return jl.load(jpath)
    except (OSError, ValueError) as e:
        raise Fail(f'journey.json cannot be read: {e}', _short(ctx.wb, 'journey'))


def _csv(text):
    return [x.strip() for x in (text or '').split(',') if x.strip()]


# ================================================================ crawl


def _markers_precheck(ctx):
    """Generator 4.3 and 'claude plugin test' on src/. A failure is only a warning: the crawl is the proof."""
    try:
        import mods_gen
        note = mods_gen.markers(ctx.wb, ctx.cfg)
    except ModuleNotFoundError as e:
        if e.name != 'mods_gen':
            print(f'WARN markers test: {type(e).__name__}: {e}')
        else:
            print('WARN markers test: mods_gen.py is not in scripts/ (skipped)')
        return
    except Exception as e:  # the generator is group D's code: any failure is a warning here
        print(f'WARN markers test: {type(e).__name__}: {e}')
        return
    if isinstance(note, str) and note.strip():
        print(note.strip().split('\n')[-1])
    st = run_step(ctx, ['claude', 'plugin', 'test', src_dir(ctx)], timeout=600, echo=False)
    tail = [ln for ln in st.out.split('\n') if ln.strip()]
    counts = [ln.strip() for ln in st.out.split('\n') if re.fullmatch(r'\s*\d+ (pass|fail)', ln)]
    text = ', '.join(counts) if counts else (tail[-1].strip() if tail else f'claude plugin test rc {st.rc}')
    print(('WARN markers test: ' if st.rc != 0 else 'markers test: ') + text + (f' (rc {st.rc})' if st.rc != 0 else ''))


def _failure_table(ctx, res):
    """Print at most 20 rows of failed nodes, failed edges and ring mismatches. Return the ids for --only."""
    rows, ids = [], []

    def add(i):
        if i and i not in ids:
            ids.append(i)

    for c in res.get('captures', []):
        if not c.get('ok'):
            rows.append(f"node {c['node']}: {c.get('error')}")
            add(c['node'])
        elif c.get('ring') == 'MISMATCH':
            rows.append(f"node {c['node']}: ring MISMATCH (the focus ring and the pointer are on different rows)")
            add(c['node'])
    for e in res.get('edges', []):
        if not e.get('ok'):
            rows.append(f"edge {e['from']} -[{e['key']}]-> {e['to']}: {e.get('error')}")
            add(e['from'])
            add(e['to'])
    if rows:
        print('failed rows (at most 20):')
        for r in rows[:20]:
            print('  ' + one(r))
        if len(rows) > 20:
            print(f'  ... and {len(rows) - 20} more (see crawl/result.json)')
    return ids


def one(text):
    return ' '.join(str(text).split())[:300]


def cmd_crawl(ctx, args):
    cfg, wb = ctx.cfg, ctx.wb
    if cfg['kind'] == 'guard':
        return Done(True, 'skipped: kind guard draws no screen', 'none', {'skipped': True})
    picked = cfg.get('picked')
    if not picked:
        raise Fail('pick a variant first: mods.py pick <V>', _short(wb, 'pick <V>'))
    _journey_ok(wb)
    jpath, jpy = _journey_paths(ctx)
    if not os.path.isfile(jpath):
        raise Fail('journey.json is missing; run mods.py journey', _short(wb, 'journey'))
    if os.path.isfile(jpy) and os.path.getmtime(jpath) < os.path.getmtime(jpy):
        raise Fail('journey.json is older than journey.py; run mods.py journey', _short(wb, 'journey'))
    j = _load_journey(ctx)
    sessions = args.sessions if args.sessions is not None else cfg['crawlSessions']
    if sessions < 1:
        raise Fail('usage: --sessions must be 1 or more', 'mods.py crawl --help', 2)
    only = _csv(args.only)
    unknown = sorted(set(only) - {n['id'] for n in j['nodes']})
    if unknown:
        raise Fail(f'--only names unknown nodes: {unknown}', 'none')
    refuse_busy(cfg, 'crawl')
    _markers_precheck(ctx)
    run = refresh_run(ctx)
    out = os.path.join(wb, 'crawl')
    argv = py('crawl.py') + [run, jpath, out, '--sessions', str(sessions), '--trusted', cfg['trusted'],
                              '--prefix', cfg['prefixes']['crawl'], '--command', f'/{{mod}} {picked} {{scenario}}']
    if only:
        argv += ['--only', ','.join(only)]
    if args.phase and args.phase != 'all':
        argv += ['--phase', args.phase]
    if args.no_render:
        argv.append('--no-render')
    st = run_step(ctx, argv, cwd=wb)
    left = own_sessions(cfg, 'crawl')  # crawl.py kills its sessions in a finally block; a left one is a bug
    if left:
        kill_own(cfg, left)
        print('WARN sessions left after the crawl, killed: ' + ', '.join(left))
    m = None
    for ln in reversed(st.out.split('\n')):
        m = DONE_RE.match(ln.strip())
        if m:
            break
    if not m:
        why = next((ln.strip()[len('FAIL: '):] for ln in st.out.split('\n') if ln.startswith('FAIL: ')), None)
        raise Fail(why or f'crawl.py gave no DONE line (rc {st.rc})', _short(wb, 'crawl'))
    g = [int(x) for x in m.groups()[:9]]
    ring = ast.literal_eval(m.group(10))
    this_run = {'nodes': [g[0], g[1]], 'edges': [g[2], g[3]], 'seconds': g[4]}
    nodes, edges = [g[5], g[6]], [g[7], g[8]]
    lint = run_step(ctx, py('journey-lint.py') + [jpath, '--shots', os.path.join(out, 'shots')], echo=False)
    ltail = [ln.strip() for ln in lint.out.split('\n') if ln.strip()]
    lint_ok = bool(ltail) and ltail[-1].startswith('OK:') and lint.rc == 0
    print('journey-lint: ' + (ltail[-1] if ltail else f'no output (rc {lint.rc})'))
    facts = {'nodes': nodes, 'edges': edges, 'thisRun': this_run, 'ring': ring, 'lint': 'OK' if lint_ok else 'FAIL'}
    summary = f'nodes {nodes[0]}/{nodes[1]} · edges {edges[0]}/{edges[1]} · ring {ring} · lint {facts["lint"]}'
    ok = st.rc == 0 and lint_ok and ring.get('MISMATCH', 0) == 0
    if ok:
        return Done(True, summary, _short(wb, 'storyboard'), facts)
    ids = []
    try:
        ids = _failure_table(ctx, jl.load(os.path.join(out, 'result.json')))
    except (OSError, ValueError, KeyError) as e:
        print(f'WARN crawl/result.json cannot be read: {e}')
    nxt = _short(wb, 'crawl' + (f' --only {",".join(ids)}' if ids else ''))
    return Done(False, summary, nxt, facts)


# ================================================================ storyboard


def size_note(path):
    """The warning line for a storyboard file above the page limit, else None."""
    n = os.path.getsize(path)
    if n <= PAGE_LIMIT:
        return None
    return (f'WARN {os.path.basename(path)} is {n / 1048576:.1f} MB, above the 16 MB page limit. '  # MB as ls shows it (MiB)
            'Scale down: mods.py storyboard --colors 48, then --colors 32 '
            '(storyboard-build.py:11-12: 96 colours gave 19 MB for 212 shots).')


def playwright_path():
    """The Playwright module of the global npm folder, or None."""
    try:
        p = subprocess.run(['npm', 'root', '-g'], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired):
        return None
    path = os.path.join(p.stdout.strip(), 'playwright', 'index.mjs')
    return path if p.returncode == 0 and os.path.isfile(path) else None


def pick_shot(j, node=None):
    """Return (node id, journey key, target id). The node is --node, else the first node with focus, else the first
    scenario start. The key is the first exact edge out of it that the player maps (one character, Enter,
    Escape, Tab, Up, Down). When that node has none, the next nodes in order are tried. None when no node has one."""
    ids = [n['id'] for n in j['nodes']]
    first = node or next((n['id'] for n in j['nodes'] if n.get('focus')), None) or (j['scenarios'][0]['start'] if j['scenarios'] else None)
    order = [first] + ([] if node else [i for i in ids if i != first])
    for nid in order:
        for e in j['edges']:
            if e['from'] != nid or e.get('approx') or e.get('history'):
                continue
            if len(e['key']) == 1 or e['key'] in PLAYER_KEYS:
                return nid, e['key'], e['to']
    return None


def gen_shot(wb, node, key, target):
    """Generator 4.4. Write wb/shot.mjs from templates/shot.mjs.tpl. Return its path.
    target is the node the key must reach; the caller checks it against the printed hash."""
    pw = playwright_path()
    if not pw:
        raise FileNotFoundError('$(npm root -g)/playwright/index.mjs is missing')
    with open(os.path.join(S, 'templates', 'shot.mjs.tpl'), encoding='utf-8') as fh:
        text = fh.read()
    url = 'file://' + urllib.parse.quote(os.path.join(wb, 'storyboard.html')) + '#' + urllib.parse.quote(node)
    values = {'__PLAYWRIGHT__': pw, '__URL__': url, '__PNG__': os.path.join(wb, 'player.png'),
              '__KEY__': PLAYWRIGHT_KEYS.get(key, key), '__NODE__': node, '__LABEL__': key}
    for name, v in values.items():
        text = text.replace(name, json.dumps(v))
    path = os.path.join(wb, 'shot.mjs')
    with open(path, 'w', encoding='utf-8') as fh:
        fh.write(text)
    return path


def cmd_storyboard(ctx, args):
    cfg, wb = ctx.cfg, ctx.wb
    if cfg['kind'] == 'guard':
        return Done(True, 'skipped: kind guard draws no screen', 'none', {'skipped': True})
    _journey_ok(wb)
    j = _load_journey(ctx)
    jpath, _ = _journey_paths(ctx)
    crawl = os.path.join(wb, 'crawl')
    if not os.path.isfile(os.path.join(crawl, 'result.json')):
        raise Fail('crawl/result.json is missing; run mods.py crawl', _short(wb, 'crawl'))
    if os.path.getmtime(os.path.join(crawl, 'result.json')) < os.path.getmtime(jpath):
        raise Fail('crawl/result.json is older than journey.json; run mods.py crawl', _short(wb, 'crawl'))
    if args.node and args.node not in {n['id'] for n in j['nodes']}:
        raise Fail(f'--node names an unknown node: {args.node}', 'none')
    if args.colors is not None and args.colors < 0:
        raise Fail('usage: --colors must be 0 or more', 'mods.py storyboard --help', 2)
    out = os.path.join(wb, 'storyboard.html')
    argv = py('storyboard-build.py') + [jpath, crawl, out]
    if args.draft:
        argv.append('--draft')
    if args.colors is not None:
        argv += ['--colors', str(args.colors)]
    if not shutil.which('rsvg-convert'):
        print('WARN rsvg-convert is missing: the hotspot geometry would be wrong, so hotspots are off')
        argv.append('--no-hotspots')
    st = run_step(ctx, argv, cwd=wb)
    lines = [ln.strip() for ln in st.out.split('\n')]
    failed = next((ln for ln in lines if ln.startswith('GATE FAILED')), None)
    wrote = next((WROTE_RE.match(ln) for ln in lines if WROTE_RE.match(ln)), None)
    if failed:
        facts = {'gate': 'draft' if wrote else 'fail', 'bytes': int(wrote.group(2)) if wrote else None, 'player': None}
        ids = []  # the nodes the gate names: 'shots: node X: ...', 'crawl: node X: ...', 'ring: node X: ...'
        for ln in lines:
            m = re.match(r'^(?:shots|crawl|ring|hint keys): node (\S+?):', ln)
            if m and m.group(1) not in ids:
                ids.append(m.group(1))
        return Done(False, failed + (' · draft written with gaps marked' if wrote else ' · nothing written'),
                    _short(wb, 'crawl' + (f' --only {",".join(ids)}' if ids else '')), facts)
    if st.rc != 0 or not wrote or not any(ln.startswith('gate: ') and ln.endswith('all pass') for ln in lines):
        why = next((ln for ln in reversed(lines) if ln), f'storyboard-build.py rc {st.rc}')
        raise Fail(why, _short(wb, 'storyboard'))
    size = int(wrote.group(2))
    facts = {'gate': 'pass', 'bytes': size, 'player': None}
    note = size_note(out)
    if note:
        print(note)
        facts['warn'] = 'size'
    parts = ['gate all pass', f'wrote {os.path.basename(out)} ({size} bytes)']
    shot = pick_shot(j, args.node)
    if not shutil.which('node'):
        print('player shot skipped: node is missing')
    elif not playwright_path():
        print('player shot skipped: playwright is missing ($(npm root -g)/playwright/index.mjs)')
    elif not shot:
        print('player shot skipped: no node has an exact edge with a key the player maps')
    else:
        node, key, target = shot
        script = gen_shot(wb, node, key, target)
        sst = run_step(ctx, ['node', script], cwd=wb, timeout=120)
        sm = next((SHOT_RE.match(ln.strip()) for ln in reversed(sst.out.split('\n')) if SHOT_RE.match(ln.strip())), None)
        if sst.rc != 0 or not sm:
            raise Fail('the player shot failed: ' + (last_lines(sst.out, 1).strip() or f'node rc {sst.rc}'), _short(wb, 'storyboard'), 1, facts)
        errs = json.loads(sm.group(4))
        facts['player'] = {'node': sm.group(1), 'key': sm.group(2), 'hash': sm.group(3), 'target': target, 'errors': errs}
        line = f'player: #{sm.group(1)}, key {sm.group(2)} -> {sm.group(3)}, errors {sm.group(4)}'
        parts.append(line)
        print('open with Read: ' + os.path.join(wb, 'player.png'))
        if sm.group(3) != '#' + target or errs:
            return Done(False, ' · '.join(parts) + f' · expected #{target}', _short(wb, 'storyboard'), facts)
    return Done(True, ' · '.join(parts), 'the person walks the player; then ' + _short(wb, 'approve --by person'), facts)


# ================================================================ live


def _next_live_n(logs):
    top = 0
    if os.path.isdir(logs):
        for f in os.listdir(logs):
            m = re.match(r'^live-(\d+)[.-]', f)
            if m:
                top = max(top, int(m.group(1)))
    return top + 1


def _default_marker(ctx, cmd):
    """The first positive part of the start-node marker of the scenario that cmd names. Else cfg ready."""
    jpath, _ = _journey_paths(ctx)
    if os.path.isfile(jpath):
        try:
            j = jl.load(jpath)
            g = jl.Graph(j)
            named = [t for t in cmd.split() if t in g.starts]
            if named:
                for part in jl.marker_parts(g.nodes[g.starts[named[-1]]]['marker']):
                    if not part.startswith('!') and not re.search(r'[\'"`$\\]', part):
                        return part
        except (OSError, ValueError, KeyError):
            pass
    return ctx.cfg['ready']


def _ansi_after(row, col):
    """The part of an ANSI row after visible column col (SGR sequences are not counted)."""
    pos, out, i = 0, [], 0
    while i < len(row):
        m = jl.SGR.match(row, i)
        if m:
            if pos >= col:
                out.append(m.group())
            i = m.end()
            continue
        if pos >= col:
            out.append(row[i])
        pos += 1
        i += 1
    return ''.join(out)


def pane_ansi_rows(txt, ansi):
    """The ANSI text of the pane rows of one capture. Dock: right of the divider. Inline: inside the frame."""
    trows, arows = txt.split('\n'), ansi.split('\n')
    d = jl.divider_column(txt)
    if d is not None:
        return [_ansi_after(arows[i], d + 1) for i, t in enumerate(trows) if i < len(arows) and len(t) > d and t[d] == '│']
    out, inside = [], False
    for i, t in enumerate(trows):
        if i >= len(arows):
            break
        if not inside and jl.INLINE_TOP.match(t):
            inside = True
        if inside:
            if t.lstrip().startswith('╰'):
                break
            if '│' in t:
                out.append(_ansi_after(arows[i], t.index('│') + 1))
    return out


_RULE_RE = re.compile(r'^\s*─{20,}\s*$')
_BAND_STOP_RE = re.compile(r'^\s*(?:[❯⏺●⎿▎]|\S\s.*…\s*\()')  # a transcript row (prompt echo, tool, notice) or the spinner row


def band_rows(txt, limit=8):
    """The plain rows of a band: the rows right above the top rule of the prompt box, up to a blank row, a transcript row or the spinner row."""
    lines = txt.split('\n')
    top = next((i for i in range(len(lines) - 2, -1, -1) if _RULE_RE.match(lines[i]) and lines[i + 1].lstrip().startswith('❯')), None)
    out = []
    for i in range(top - 1 if top else -1, -1, -1):
        if not lines[i].strip() or _BAND_STOP_RE.match(lines[i]) or len(out) >= limit:
            break
        out.append(lines[i])
    return out[::-1]


def after_region(txt, ansi):
    """The text that --after is searched in: the pane rows (right of the dock divider or inside the inline frame) and the band rows.
    Never the transcript: a prompt or a tool row can hold the same text and prove nothing (round 3, N1)."""
    return '\n'.join([jl.SGR.sub('', r) for r in pane_ansi_rows(txt, ansi)] + band_rows(txt))


def sgr_flags(rows):
    """(sgr7, c256) of the pane rows: an SGR with code 7, and any 38;5; colour."""
    sgr7 = c256 = False
    for row in rows:
        for m in jl.SGR.finditer(row):
            body = m.group()[2:-1]
            if '38;5;' in body or '38:5:' in body:
                c256 = True
            codes, k = body.replace(':', ';').split(';'), 0
            while k < len(codes):
                if codes[k] in ('38', '48', '58'):
                    k += 3 if k + 1 < len(codes) and codes[k + 1] == '5' else 5
                    continue
                if codes[k] == '7':
                    sgr7 = True
                k += 1
    return sgr7, c256


def _tmux_capture(session, ansi):
    mods.tmux_prepare()  # TMUX_TMPDIR when tmux has no socket path (a sandbox); no change in a normal session
    argv = ['tmux', 'capture-pane', '-p'] + (['-e'] if ansi else []) + ['-t', session]
    p = subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, errors='replace')
    if p.returncode != 0:
        raise Fail(f'tmux capture-pane failed for {session}: {p.stderr.strip()}')
    return p.stdout


TURN_PROMPT = 'Reply with the word ok and stop.'  # decision Q3: the default prompt of --turn
BAND_PROMPT = ('Use the Bash tool to run exactly: for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do sleep 1; done . '
               'Then reply with the word done.')  # a band that yields when idle shows only while a turn runs: the turn must last (GB.p5)
TOOL_PROMPT = 'Use the Bash tool to run: ls . Then reply with the word done.'  # a toast on tool.call needs a tool call
PROBE_DEFAULT = 'rm -rf {dir}'
DIALOG_RE = re.compile(r"Do you want to|don't ask again|Esc to cancel")  # a permission dialog: live never answers it
TURN_WAIT = 90  # seconds to wait for the marker of a model turn (live-test.sh MARK_WAIT)
GONE_WAIT = 60  # seconds to wait for a yielding band to leave after the turn
GIT_BRANCHES = 40
GIT_MERGED = 'merged-demo'  # the one branch that is merged into main; the first of the 40 (feat/login-1) is not merged


def _slug(text, limit=40):
    return re.sub(r'[^a-z0-9]+', '-', text.lower()).strip('-')[:limit].strip('-') or 'run'


def _rows_scenario(cfg):
    """The scenario that the default prototype command runs: the first with rows (role normal or overflow), else the first."""
    for s in ((cfg.get('domain') or {}).get('scenarios') or []):
        if isinstance(s, dict) and s.get('role') in ('normal', 'overflow') and s.get('name') in (cfg.get('scenarios') or []):
            return s['name']
    return cfg['scenarios'][0]


def _make_git_repo(wb):
    """The fixed scratch repo of --git-repo under <wb>/logs/git-repo: 3 commits on main, 40 branches with one commit each
    (dated 5 days apart, not merged) and the branch merged-demo (merged into main), 2 modified tracked files and 1 untracked file. Return the CC_ENV items GIT_DIR and GIT_WORK_TREE.

    A scratch folder inside the trusted folder is not trusted (SB.p7), so the session keeps its own folder and git reads this
    repo through the two variables. No clock and no random: the same call gives the same repo."""
    root = os.path.join(wb, 'logs', 'git-repo')
    gitdir = os.path.join(root, '.git')
    if re.search(r'[\'"`$\\\s]', root):
        raise Fail(f'usage: --git-repo needs a workbench path with no space, quote, backtick, $ or backslash (got {root})', 'mods.py live --help', 2)
    if os.path.lexists(root):
        shutil.rmtree(root)  # inside <wb>/logs: the folder of this flag only
    os.makedirs(os.path.join(root, 'src'))
    base = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}
    base.update({'GIT_DIR': gitdir, 'GIT_WORK_TREE': root, 'GIT_CONFIG_GLOBAL': os.devnull, 'GIT_CONFIG_SYSTEM': os.devnull,
                 'GIT_AUTHOR_NAME': 'Scratch Dev', 'GIT_AUTHOR_EMAIL': 'scratch@example.com',
                 'GIT_COMMITTER_NAME': 'Scratch Dev', 'GIT_COMMITTER_EMAIL': 'scratch@example.com'})

    def git(*a, date=None):
        env = dict(base)
        if date:
            env['GIT_AUTHOR_DATE'] = env['GIT_COMMITTER_DATE'] = date
        p = subprocess.run(['git', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=' + os.devnull] + list(a), env=env, cwd=root,
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=60)
        if p.returncode != 0:
            raise Fail(f'--git-repo: git {" ".join(a[:2])} failed: {p.stdout.strip()[-200:]}')
        return p.stdout

    def write(rel, text):
        with open(os.path.join(root, rel), 'w', encoding='utf-8') as fh:
            fh.write(text)

    git('init', '-q', '--initial-branch=main')
    for i, (when, msg) in enumerate([('2026-01-05T10:00:00+0000', 'Start the project'), ('2026-01-12T10:00:00+0000', 'Add the parser'),
                                     ('2026-01-19T10:00:00+0000', 'Fix the parser edge case')], 1):
        write('README.md', f'# scratch\nrevision {i}\n')
        write('src/app.ts', f'export const app = {i}\n')
        write('src/util.ts', f'export const util = {i}\n')
        git('add', '-A')
        git('commit', '-q', '-m', msg, date=when)
    words = ['login', 'cache', 'parser', 'theme', 'export', 'search', 'retry', 'queue', 'audit', 'sync']
    for i in range(GIT_BRANCHES):
        name = f"{['feat', 'fix', 'chore', 'docs'][i % 4]}/{words[i % len(words)]}-{i + 1}"
        git('checkout', '-q', '-b', name, 'main')
        write('src/app.ts', f'export const app = "{name}"\n')
        day = 20 + 5 * i  # day of the year 20, 25, ... 215: spaced dates
        stamp = (datetime.date(2026, 1, 1) + datetime.timedelta(days=day)).isoformat()
        git('commit', '-q', '-am', f'Work on {name}', date=f'{stamp}T10:00:00+0000')
    git('checkout', '-q', 'main')
    git('branch', GIT_MERGED, 'main')  # at the tip of main: merged, so git branch -d works. The 40 branches above are not merged.
    write('README.md', '# scratch\nrevision 3\nlocal edit\n')
    write('src/util.ts', 'export const util = 3\nexport const local = true\n')
    write('notes.txt', 'not tracked\n')
    out = git('status', '--porcelain')
    want = [' M README.md', ' M src/util.ts', '?? notes.txt']
    if sorted(out.rstrip('\n').split('\n')) != sorted(want) or git('rev-list', '--count', 'main').strip() != '3':
        raise Fail(f'--git-repo: the scratch repo is not as planned: {out.rstrip()!r}')
    n_br = len([b for b in git('branch', '--format=%(refname:short)').split('\n') if b.strip()])
    print(f'git-repo: {root} (3 commits on main, {n_br - 1} branches, 2 modified, 1 untracked; merged into main: {GIT_MERGED}; not merged: feat/login-1)')
    return [f'GIT_DIR={gitdir}', f'GIT_WORK_TREE={root}']


def _capture_pair(session):
    return _tmux_capture(session, True), _tmux_capture(session, False)


def _live_once(ctx, args, run, width, cmd, marker, extra_env, probe_dir, many):
    """One live session at one width. Return {'ok', 'parts', 'facts', 'why'}. The session is removed here."""
    cfg, wb, mod = ctx.cfg, ctx.wb, ctx.cfg['mod']
    name = mod if args.real else plugin(ctx)
    logs = os.path.join(wb, 'logs')
    n = _next_live_n(logs)
    session = f"{cfg['prefixes']['live']}{n}"
    picked = cfg.get('picked')
    env = {'SESSION': session, 'LOGDIR': logs, 'ROWS': str(args.rows), 'KEEP': '1', 'KEEP_QUIET': '1',
           'NODEBUG': '0' if args.debug else '1', 'MARK_WAIT': str(TURN_WAIT if args.turn else 15),
           'CC_ENV': ' '.join((['NO_COLOR=1'] if args.nocolor else []) + extra_env)}
    st = run_step(ctx, sh('live-test.sh') + [run, cmd, marker, str(width), cfg['trusted']],
                  env=env, timeout=180 + (TURN_WAIT if args.turn else 0))
    facts = {'n': n, 'real': bool(args.real), 'debug': bool(args.debug), 'loaded': None, 'refusals': None, 'cols': width,
             'nocolor': bool(args.nocolor), 'sgr7': None, 'c256': None, 'ring': None, 'png': None, 'env': [e.split('=')[0] for e in extra_env],
             'turn': bool(args.turn), 'probe': bool(args.probe), 'cmd': cmd, 'keys': args.keys or ''}
    passed = False
    try:
        lines = [ln.rstrip() for ln in st.out.split('\n')]
        loaded = next((ln for ln in lines if ln.startswith('loaded: ')), None)
        if args.debug:
            facts['loaded'] = loaded is not None
        failed = next((ln for ln in lines if ln.startswith('FAIL: ')), None)
        if st.rc != 0 or not any(ln.startswith('PASS: marker') for ln in lines):
            why = failed[len('FAIL: '):] if failed else ('live-test.sh timed out' if st.rc == 124 else f'live-test.sh rc {st.rc}')
            if args.turn and DIALOG_RE.search(st.out):
                why = ('a permission dialog is open: the turn needs a tool call that asks for permission and live never answers it. '
                       'Use a trusted folder where the call runs without a dialog, or give --prompt a text reply. ') + why
            if args.probe:
                facts['probeKept'] = os.path.isfile(os.path.join(probe_dir, 'keep.txt'))
            if ctx.log_path:
                why += f' · last screen in {os.path.relpath(ctx.log_path, wb)}'
            return {'ok': False, 'parts': [], 'facts': facts, 'why': why}
        if args.keys:
            jl.send_keys(session, args.keys, name)
        time.sleep(1.5)
        ansi_text, plain_text = _capture_pair(session)
        glyph = (cfg['pointer'] or {}).get(picked or 'C', '❯')
        rows = pane_ansi_rows(plain_text, ansi_text)
        selected = any(glyph in jl.SGR.sub('', r) for r in rows)
        if args.nocolor and selected and not sgr_flags(rows)[0]:
            # A pointer row with no inverse ring: the pane has no focus yet. Tab gives it (RD.p2). Tab only when a pane row shows:
            # a Tab at the prompt is not a pane key.
            jl.send_keys(session, 'Tab', name)
            time.sleep(1.5)
            ansi_text, plain_text = _capture_pair(session)
            rows = pane_ansi_rows(plain_text, ansi_text)
            facts['tab'] = True
        if getattr(args, 'after', None):
            # --marker is the screen BEFORE the keys; --after is the screen the keys lead to (FN.p1).
            end = time.time() + (TURN_WAIT if args.turn else 10)  # a command that the keys queue during a turn runs when the turn ends
            while args.after not in after_region(plain_text, ansi_text) and time.time() < end:
                time.sleep(1)
                ansi_text, plain_text = _capture_pair(session)
                rows = pane_ansi_rows(plain_text, ansi_text)
            facts['after'] = args.after in after_region(plain_text, ansi_text)
        slug = _slug(cmd if not args.turn else ('turn-probe' if args.probe else 'turn'))
        base = os.path.join(logs, f'live-{n}-{slug}' + (f'-{width}' if many else ''))
        with open(base + '.ansi', 'w', encoding='utf-8') as fh:
            fh.write(ansi_text)
        with open(base + '.txt', 'w', encoding='utf-8') as fh:
            fh.write(plain_text)
        title = f'live-{n} {cmd}'[:90]
        rst = run_step(ctx, sh('render.sh') + [base + '.ansi', base + '.png', title, str(width)], echo=False)
        if rst.rc != 0 or not os.path.isfile(base + '.png'):
            return {'ok': False, 'parts': [], 'facts': facts, 'why': 'render.sh failed: ' + (last_lines(rst.out, 1).strip() or f'rc {rst.rc}')}
        facts['png'] = os.path.relpath(base + '.png', wb)
        # The PNG name holds the command; the screen must show it (RD.p8). A slash command or a prompt is echoed in the transcript.
        shown = cmd if not args.turn else cmd[:20]
        facts['cmdShown'] = ' '.join(shown.split()) in ' '.join(plain_text.split())
        if not facts['cmdShown']:
            print(f"WARN {facts['png']}: the screen does not show the command {shown!r} (a key or a long reply moved it away)")
        ring = run_step(ctx, py('ring-check.py') + [base + '.ansi', '--pointer', glyph], echo=False)
        facts['ring'] = {0: 'OK', 1: 'MISMATCH'}.get(ring.rc, 'n/a')
        parts, ok = ['marker drawn', f"ring {facts['ring']}"], facts['ring'] != 'MISMATCH'
        if facts.get('tab'):
            parts.append('tab pressed')
        if 'after' in facts:
            parts.append(f"after {'drawn' if facts['after'] else 'MISSING'}")
            ok = ok and facts['after']
        if args.nocolor:
            # 38;5; on the whole screen: under NO_COLOR the screen of 2.1.296 has no SGR code at all, so any colour is the mod's.
            # SGR 7 only where the pane shows a focus: a selected row (the pointer) or an inverse ring. An empty,
            # error or no-pane screen has no focus to show: sgr7 is None there (n/a), and only the 38;5; check counts.
            sgr7 = sgr_flags(rows)[0]
            facts['c256'] = sgr_flags(ansi_text.split('\n'))[1]
            selected = any(glyph in jl.SGR.sub('', r) for r in rows)
            facts['sgr7'] = True if sgr7 else (False if selected else None)
            word = {True: 'yes', False: 'no', None: 'n/a'}[facts['sgr7']]
            why = '' if facts['sgr7'] is not None else (' (no pane rows found)' if not rows else ' (no selected row and no ring)')
            parts.append(f"nocolor: SGR 7 {word}{why}, 38;5; {'found' if facts['c256'] else 'none'}")
            ok = ok and facts['sgr7'] is not False and not facts['c256']
        if args.debug:
            log = os.path.join(logs, session + '.log')
            # Only a line of the engine about the mod counts: after the optional time stamp and level, the line starts with the plugin name
            # ('<name>: ... skipped', '[ERROR] hook failed: <name>: ... skipped') or '[<name>]'. A line of a user hook ('Hooks: ...') can quote the deny text of a guard: it is no refusal.
            # A '[<name>] $.ui.log: <text>' line is the mod's own transcript line (a toast mod writes one for each event): not a refusal either.
            n_ = re.escape(name)
            rx = re.compile(rf'^(?:\d{{4}}-\S+\s+)?(?:\[[A-Z]+\]\s+)?(?:(?:hook failed: )?{n_}: .*(?:refused|skipped|dropped)|\[{n_}\](?! \$\.ui\.log:))')
            hits = []
            if os.path.isfile(log):
                with open(log, encoding='utf-8', errors='replace') as fh:
                    hits = [ln.rstrip() for ln in fh if rx.search(ln) and '$.ui.log: reloaded' not in ln
                            and 'resolved by a hooks module (deny:' not in ln]  # a guard's own deny is its job, not a refusal of the mod
            facts['refusals'] = len(hits)
            for ln in hits[:5]:
                print('debug log: ' + ln[:200])
            parts += [f"loaded {'yes' if facts['loaded'] else 'no'}", f"refusals {len(hits)}"]
            ok = ok and facts['loaded'] and not hits
        if args.turn:
            parts.append('turn yes')
        if args.probe:
            time.sleep(2.5)  # a guard that fails to deny lets rm run now: give it time before the folder is read
            facts['probeKept'] = os.path.isfile(os.path.join(probe_dir, 'keep.txt'))
            parts.append(f"probeKept {'yes' if facts['probeKept'] else 'no'}")
            ok = ok and facts['probeKept']
        if args.turn and mods._band_yields(cfg):
            # A band with idle yield draws nothing while no turn runs: after the turn the marker must leave.
            end, gone = time.time() + GONE_WAIT, False
            while time.time() < end:
                if marker not in _tmux_capture(session, False):
                    gone = True
                    break
                time.sleep(1)
            facts['idleGone'] = gone
            parts.append(f"idleGone {'yes' if gone else 'no'}")
            ok = ok and gone
        parts.append('png ' + facts['png'])
        passed = ok
        return {'ok': ok, 'parts': parts, 'facts': facts, 'why': None}
    finally:
        if args.keep and passed:
            print(f'session kept: tmux attach -t {session}')
        else:
            kill_own(cfg, [session])  # kill_own uses the exact target =<session>
            print(f'session removed: {session}' + ('' if passed or not args.keep else ' (--keep keeps a session only after a PASS)'))


def _probe_dir(wb, trusted, mod):
    """The folder of the guard probe (D8). The default is <wb>/logs/guard-probe. The default scratch lies inside the trusted folder,
    and a guard that allows a recursive rm inside the session folder would then delete the probe: so use a temp folder instead."""
    default = os.path.join(wb, 'logs', 'guard-probe')
    root = os.path.realpath(trusted)
    try:
        inside = os.path.commonpath([os.path.realpath(default), root]) == root
    except ValueError:  # another drive: cannot be inside
        inside = False
    return os.path.join(tempfile.gettempdir(), f'mod-probe-{mod}') if inside else default


def cmd_live(ctx, args):
    probe_dir = _probe_dir(ctx.wb, ctx.cfg['trusted'], ctx.cfg['mod'])
    try:
        return _cmd_live(ctx, args, probe_dir)
    finally:
        if args.probe and probe_dir != os.path.join(ctx.wb, 'logs', 'guard-probe'):
            shutil.rmtree(probe_dir, ignore_errors=True)


def _cmd_live(ctx, args, probe_dir):
    cfg, wb, mod = ctx.cfg, ctx.wb, ctx.cfg['mod']
    picked = cfg.get('picked')
    name = mod if args.real else plugin(ctx)
    cols = list(args.cols) if isinstance(args.cols, (list, tuple)) else [int(args.cols)]
    # mods.py must give the --cmd option of live the dest 'live_cmd': the dest 'cmd' is the subcommand name
    # A guard, or a mod with no scenario, has a proof command with no arguments (templates/guard: '/<plugin>').
    bare = args.real or cfg.get('kind') == 'guard' or not cfg.get('scenarios')
    cmd = getattr(args, 'live_cmd', None) or (f'/{name}' if bare else f"/{name} {picked or 'C'} {_rows_scenario(cfg)}")
    if args.turn and not args.real:
        raise Fail('usage: --turn needs --real (a model turn proves the built mod)', 'mods.py live --help', 2)
    if args.probe and not args.turn:
        raise Fail('usage: --probe needs --turn (the guard proof sends a prompt)', 'mods.py live --help', 2)
    if args.prompt and not args.turn:
        raise Fail('usage: --prompt needs --turn', 'mods.py live --help', 2)
    if args.real and not args.marker:
        raise Fail('usage: --marker is required with --real', 'mods.py live --help', 2)
    marker = args.marker or _default_marker(ctx, cmd)
    if re.search(r'[\'"`$\\]', marker):
        raise Fail('usage: --marker must not hold a quote, a backtick, $ or a backslash (live-test.sh cannot pass them)', 'mods.py live --help', 2)
    if not cols or min(cols) < 20 or args.rows < 10:
        raise Fail('usage: --cols must be 20 or more and --rows 10 or more', 'mods.py live --help', 2)
    # --env K=V reaches claude and every process that the mod runs (for example GIT_DIR for a git mod in a
    # trusted folder that is not a repository). live-test.sh puts CC_ENV inside a double-quoted shell string.
    extra_env = []
    for item in getattr(args, 'env', None) or []:
        key, eq, value = item.partition('=')
        if not eq or not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', key) or re.search(r'[\'"`$\\\s]', value):
            raise Fail(f'usage: --env {item!r} must be NAME=VALUE with no quote, backtick, $, backslash or space in VALUE',
                       'mods.py live --help', 2)
        extra_env.append(f'{key}={value}')
    refuse_busy(cfg, 'live')
    if args.turn:
        if args.probe:
            probe = ((cfg.get('domain') or {}).get('probe')) or PROBE_DEFAULT
            if re.search(r'[\'"`$\\]', probe.replace('{dir}', '')) or re.search(r'[\'"`$\\\s]', probe_dir):
                raise Fail('usage: the probe command and the workbench path must hold no quote, backtick, $ or backslash', 'mods.py live --help', 2)
            shutil.rmtree(probe_dir, ignore_errors=True)
            os.makedirs(probe_dir)
            print(f'probe folder: {probe_dir}')
            with open(os.path.join(probe_dir, 'keep.txt'), 'w', encoding='utf-8') as fh:
                fh.write('the guard must keep this folder\n')
            prompt = args.prompt or f"Use the Bash tool to run exactly: {probe.replace('{dir}', probe_dir)} . Then say ok."
        elif args.prompt:
            prompt = args.prompt
        elif mods._band_yields(cfg):
            prompt = BAND_PROMPT
        elif ((cfg.get('domain') or {}).get('on')) == 'tool.call':
            prompt = TOOL_PROMPT
        else:
            prompt = TURN_PROMPT
        cmd = prompt  # live-test.sh types its second argument and presses Enter: a prompt is typed the same way as a slash command
        print(f'turn: one real model prompt in {cfg["trusted"]} (one turn of tokens; metrics.json does not count it)')
    if args.git_repo:
        extra_env += _make_git_repo(wb)
    run = refresh_run(ctx, args.real)
    results = []
    for w in cols:
        r = _live_once(ctx, args, run, w, cmd, marker, extra_env, probe_dir, len(cols) > 1)
        results.append((w, r))
        if not r['ok']:
            break
    facts = dict(results[-1][1]['facts'])
    done_cols = [w for w, r in results if r['ok']]
    facts['cols'] = done_cols if len(cols) > 1 else cols[0]
    if len(cols) > 1:
        facts['runs'] = [{'cols': w, 'n': r['facts']['n'], 'png': r['facts']['png'], 'ring': r['facts']['ring']} for w, r in results]
        for k in ('loaded', 'sgr7'):
            vals = [r['facts'].get(k) for _, r in results]
            facts[k] = False if False in vals else (True if True in vals else None)
        facts['refusals'] = sum((r['facts'].get('refusals') or 0) for _, r in results) if args.debug else None
        facts['c256'] = any(r['facts'].get('c256') for _, r in results) if args.nocolor else None
    if args.turn:
        facts['cost'] = 'one real model turn in the trusted folder; its tokens are not in metrics.json'
    if args.git_repo:
        facts['gitRepo'] = os.path.relpath(os.path.join(wb, 'logs', 'git-repo'), wb)
    last_w, last = results[-1]
    if not last['ok']:
        why = last['why'] or ' · '.join(last['parts'])
        return Done(False, (f'cols {last_w}: ' if len(cols) > 1 else '') + why, 'none', facts)
    if len(results) == 1:
        summary = ' · '.join(last['parts'])
    else:
        first = [p for p in results[0][1]['parts'] if not p.startswith('png ') and not p.startswith('marker ')]
        summary = ' · '.join(['marker drawn at every width'] + first + [f"cols {','.join(str(w) for w in done_cols)}",
                                                                          'png ' + ', '.join(r['facts']['png'] for _, r in results)])
    nxt = 'none'
    if args.real:
        secs = mods.read_runs(wb) + [{'cmd': 'live', 'ts': '', 'result': 'PASS', 'summary': '', 'facts': json.loads(json.dumps(facts)),
                                      'idx': 10 ** 9}]
        nxt = mods.proof_next(wb, cfg, secs)
    return Done(True, summary, nxt, facts)


# ================================================================ selfcheck


def _mods(ctx, wb, *rest, timeout=900):
    """Run one mods.py subcommand as a child process. Return (rc, summary line, full text)."""
    argv = py('mods.py') + (['-C', wb] if wb else []) + list(rest)
    st = run_step(ctx, argv, timeout=timeout, echo=False)
    lines = [ln.strip() for ln in st.out.split('\n') if ln.strip()]
    summary = ''
    for ln in reversed(lines):
        m = STEP_RE.match(ln)
        if m:
            summary = f'{m.group(2)} {m.group(3)}'
            break
    return st.rc, summary or (lines[-1] if lines else f'no output (rc {st.rc})'), st.out


def _newest_facts(wb, cmd):
    try:
        secs = [s for s in mods.read_runs(wb) if s['cmd'] == cmd]
        return secs[-1]['facts'] if secs else {}
    except Exception:
        return {}


def _rm_scratch(path, cwd):
    """Delete the throw-away folder of this selfcheck. Refuse anything else."""
    real, root = os.path.realpath(path), os.path.realpath(cwd)
    if os.path.islink(path) or not os.path.basename(path).startswith('.mods-selfcheck-') or os.path.dirname(real) != root:
        raise Fail(f'refused to delete {path}: it is not the selfcheck scratch folder of this folder')
    shutil.rmtree(real)


def _kit_smoke(ctx, wb):
    """The smoke run of the design pass: 12 captures, a journey, a pick, a crawl. Return (ok, row text)."""
    cfg = mods.load_cfg(os.path.join(wb, 'mod.json'))
    c = Ctx('selfcheck', None, wb, cfg)
    cfg['screens'] = ['list-normal-last=normal:Down*3', 'detail-normal=normal:Enter']  # two extras, so 2x2x2 + 2x2 = 12 captures
    mods.save_cfg(c)
    steps = [('mockups', ['mockups', '--variants', 'C,D', '--modes', 'normal,overflow', '--sizes', '150,100', '--kill']),
             ('journey', ['journey']), ('pick', ['pick', 'C', '--by', 'headless']), ('crawl', ['crawl'])]
    for label, rest in steps:
        rc, summary, text = _mods(ctx, wb, *rest, timeout=1200)
        if rc != 0:
            print(last_lines(text, 12))
            return False, f'kit-smoke: FAIL {label}: {summary}'
    mf, cf = _newest_facts(wb, 'mockups'), _newest_facts(wb, 'crawl')
    failed = mf.get('failed')
    nodes, edges = cf.get('nodes') or ['?', '?'], cf.get('edges') or ['?', '?']
    return True, (f"kit-smoke: mockups {mf.get('captures', '?')} captures failed {'none' if not failed else failed} · "
                  f'crawl {nodes[0]}/{nodes[1]} {edges[0]}/{edges[1]}')


def cmd_selfcheck(ctx, args):
    trusted = os.path.abspath(os.path.expanduser(args.trusted))
    if not os.path.isdir(trusted):
        raise Fail(f'usage: --trusted is not a folder: {trusted}', 'mods.py selfcheck --help', 2)
    cwd = os.getcwd()
    scratch = os.path.join(cwd, '.mods-selfcheck-' + time.strftime('%Y%m%dT%H%M%S'))
    os.makedirs(scratch)
    t0 = time.time()
    kinds = ['pane-list'] if args.quick else list(KINDS)
    ok_n = skip_n = fail_n = 0
    made = []
    try:
        for kind in kinds:
            name = f'sc-{kind}'
            rest = ['new', name, '--kind', kind, '--scratch', scratch, '--trusted', trusted] + (['--noun', 'note'] if kind == 'pane-list' else [])
            rc, summary, text = _mods(ctx, None, *rest)
            if rc != 0 and 'is not in this skill yet' in text:
                print(f'{kind:<11} SKIP template not in this skill yet')
                skip_n += 1
                continue
            if rc != 0:
                print(f'{kind:<11} FAIL new: {summary}')
                print(last_lines(text, 8))
                fail_n += 1
                continue
            wb = os.path.join(scratch, name)
            made.append(wb)
            rc, summary, text = _mods(ctx, wb, 'check')
            if rc != 0:
                print(f'{kind:<11} new ok · check FAIL: {summary}')
                print(last_lines(text, 12))
                fail_n += 1
                continue
            print(f'{kind:<11} new ok · check ok')
            if args.live and kind == 'pane-list':
                good, row = _kit_smoke(ctx, wb)
                print(row)
                if not good:
                    fail_n += 1
                    continue
            ok_n += 1
        if args.live and 'pane-list' not in [os.path.basename(w)[3:] for w in made]:
            print('kit-smoke: SKIP no pane-list workbench')
    finally:
        for wb in made:
            rc, summary, _ = _mods(ctx, wb, 'clean')
            if rc != 0:
                print(f'WARN clean of {os.path.basename(wb)}: {summary}')
        if args.keep:
            print('scratch kept: ' + scratch)
        else:
            _rm_scratch(scratch, cwd)
    secs = round(time.time() - t0)
    summary = f'{ok_n} kinds ok, {skip_n} skipped, {fail_n} failed ({secs} s)'
    if fail_n:
        return Done(False, summary, f'fix the failing row, then run mods.py selfcheck --trusted {trusted}', {'ok': ok_n, 'skipped': skip_n, 'failed': fail_n})
    return Done(True, summary, 'none', {'ok': ok_n, 'skipped': skip_n, 'failed': 0})
