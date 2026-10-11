"""mods_design.py: the design-pass subcommands of mods.py (driver design 5.D).

  mockups         capture the design variants of a workbench (capture-matrix.py), then the mechanical score
  journey         build | skeleton | markers: the storyboard journey (journey.py of mods.py domain: it reads the picked variant),
                  a TODO skeleton, or the marker tests
  audit-existing  audit a mod that already exists: 4 captures of its real screen and a score

mods.py imports this file when one of these subcommands runs. Each cmd_<name>(ctx, args) returns
Done or raises Fail. mods.py prints the two last lines and writes RUN.md.
"""
import sys

sys.dont_write_bytecode = True  # no __pycache__ in the skill folder

import json
import os
import re
import shlex
import shutil

import mods
from mods import NO_PANE, S, SC, Done, Fail, last_lines, py, refresh_run, refuse_busy, run_dir, run_step, safe_rm, save_cfg, src_dir

import journey_lib as jl
import mods_gen

BAND_MARKER = 'ctrl+x tab to'  # kit band.tsx bandRow draws it on every band row

DONE_LINE = re.compile(r'^DONE (\d+) captures in (\d+) s · ring (\{.*\}) · failed (.+)$', re.M)
WROTE = re.compile(r'^wrote (.+): (\d+) nodes, (\d+) edges$', re.M)
LINT_COUNTS = re.compile(r'^(.+): (\d+) scenarios, (\d+) nodes, (\d+) edges \((\d+) approximate\)$', re.M)
LINT_END = re.compile(r'^(OK|FAIL): (\d+) errors, (\d+) warnings$', re.M)
AUDIT_END = re.compile(r'^(\d+) lines · (\d+) cited · (\d+) skipped · (\d+) OPEN · (\d+) stale cites · (\d+) warnings$', re.M)
TEST_PASS = re.compile(r'^\s*(\d+) pass$', re.M)
TEST_FAIL = re.compile(r'^\s*(\d+) fail$', re.M)
MOD_NAME = re.compile(r'^[a-z][a-z0-9-]*$')


# ---------------------------------------------------------------- small helpers


def _csv(text):
    return [x.strip() for x in (text or '').split(',') if x.strip()]


def _ints(text, what):
    try:
        out = [int(x) for x in _csv(text)]
    except ValueError:
        raise Fail(f'{what} must be a list of integers like 150,100,60', rc=2)
    if not out:
        raise Fail(f'{what} is empty', rc=2)
    return out


def _next(ctx, cmd):
    return f'mods.py -C {ctx.wb} {cmd}'


def _sweep_pycache():
    """journey_build.py and capture-matrix.py start child Python files without -B. That can leave
    scripts/__pycache__. Remove it when this call made it: the skill folder must stay free of bytecode."""
    pc = os.path.join(SC, '__pycache__')
    if os.path.isdir(pc) and not os.path.islink(pc):
        shutil.rmtree(pc, ignore_errors=True)


def _run_clean(ctx, argv, **kw):
    """run_step, then sweep the bytecode that a child script may have written."""
    had = os.path.isdir(os.path.join(SC, '__pycache__'))
    try:
        return run_step(ctx, argv, **kw)
    finally:
        if not had:
            _sweep_pycache()


def _json_has_todo(item):
    if isinstance(item, str):
        return 'TODO' in item
    if isinstance(item, dict):
        return any(_json_has_todo(v) for v in item.values())
    if isinstance(item, list):
        return any(_json_has_todo(v) for v in item)
    return False


def _journey_paths(ctx):
    return os.path.join(ctx.wb, 'journey.py'), os.path.join(ctx.wb, 'journey.json')


def _journey_stale(ctx):
    """True when journey.py exists and journey.json is missing or older."""
    jpy, jjs = _journey_paths(ctx)
    return os.path.isfile(jpy) and (not os.path.isfile(jjs) or os.path.getmtime(jjs) < os.path.getmtime(jpy))


def _score(folder, variants, pointers, sizes):
    """Score one captures folder with mods_score (group C). Return the summary lines, or None when it is not available."""
    try:
        import mods_score
    except ModuleNotFoundError as e:
        if e.name != 'mods_score':
            raise
        print('score: skipped (mods_score.py is not in scripts/)')
        return None, None
    try:
        res = mods_score.score_dir(folder, variants=variants, pointers=pointers, sizes=sizes)
        mods_score.write(res)
    except (ValueError, OSError) as e:
        print(f'score: skipped ({e})')
        return None, None
    return res, mods_score.summary_lines(res)


# ---------------------------------------------------------------- mockups


def _modes(cfg, j, given):
    """The base modes of a mockups pass: --modes, else every scenario that has its own start node."""
    scenarios = cfg.get('scenarios') or []
    if given:
        bad = [m for m in given if scenarios and m not in scenarios]
        if bad:
            raise Fail(f'--modes names unknown scenarios: {bad}; mod.json scenarios: {scenarios}', rc=2)
        return given
    if not scenarios:
        raise Fail('mod.json holds no scenarios; give --modes', rc=2)
    if not j:
        return list(scenarios)
    start = {s['id']: s['start'] for s in j['scenarios']}
    seen, out = set(), []
    for s in scenarios:
        node = start.get(s)
        if node is not None and node in seen:
            continue  # the same start screen as an earlier scenario: a second capture adds nothing
        if node is not None:
            seen.add(node)
        out.append(s)
    return out


def cmd_mockups(ctx, args):
    cfg, wb = ctx.cfg, ctx.wb
    kind = cfg['kind']
    if kind in NO_PANE:
        # A guard has no journey, crawl or storyboard: live is next. The other kinds still need pick, journey,
        # crawl, storyboard and approve before build; the live runs at 150, 100 and 60 columns stand in for the mockups.
        print('draws no pane: mockups skipped (live --cols 150, 100 and 60 show the texts)')
        nxt = _next(ctx, 'live') if kind == 'guard' else _next(ctx, f"pick {cfg['variants'][0]} --by person|headless")
        return Done(True, f'skipped (kind {kind})', nxt, {'skipped': True, 'kind': kind})
    if kind == 'audit':
        raise Fail('an audit workbench has no prototype to capture; run mods.py new to start a mod', rc=2)
    sizes = _ints(args.sizes, '--sizes') if args.sizes else list(cfg['sizes'])
    variants = _csv(args.variants) or list(cfg['variants'])
    bad = [v for v in variants if v not in cfg['variants']]
    if bad:
        raise Fail(f"--variants names {bad}; mod.json variants: {cfg['variants']}", rc=2)
    refuse_busy(cfg, 'mockups')
    run = refresh_run(ctx)

    jpy, jjs = _journey_paths(ctx)  # mods.py domain writes journey.json; the modes of a pass come from its scenario starts
    j = jl.load(jjs) if os.path.isfile(jjs) and not _journey_stale(ctx) else None
    modes = _modes(cfg, j, _csv(args.modes))

    extras, focus = [], []  # extras: (name, scenario, keys). They come from mod.json screens, which mods.py domain writes (design 1.5.5).
    if not args.no_extras:
        if isinstance(cfg.get('screens'), list):
            for item in cfg['screens']:
                name, _, spec = item.partition('=')
                scn, _, rest = spec.partition(':')
                keys, _, want = rest.partition('|focus=')
                if not name or not scn or not keys:
                    raise Fail(f'mod.json screens: "{item}" is not name=mode:keys[|focus=TEXT]', rc=2)
                extras.append((name, scn, keys))
                if want:
                    focus.append(f'{name}={want}')
        else:
            print('extras: none (run mods.py domain)')

    root = os.path.join(wb, 'mockups')
    nums = [int(d) for d in os.listdir(root) if d.isdigit()] if os.path.isdir(root) else []
    n = 1 + max(nums, default=0)
    out = os.path.join(root, str(n))
    mx = cfg['prefixes']['mockups']
    argv = py('capture-matrix.py') + [out, '--mod-dir', run, '--ready', cfg['ready'], '--trusted', cfg['trusted'],
                                      '--prefix', mx, '--rows', str(cfg['rows']), '--variants', ','.join(variants),
                                      '--modes', ','.join(modes), '--sizes', ','.join(str(s) for s in sizes),
                                      '--title', f"{cfg['mod']}: pass {n}"]
    for name, scn, keys in extras:
        argv += ['--extra', f'{name}={scn}:{keys}']
    for v, g in sorted(cfg['pointer'].items()):
        argv += ['--pointer', f'{v}={g}']
    for f in focus:
        argv += ['--focus', f]
    if kind == 'band':  # the band hides while the pane is open: capture each mode with the pane closed too
        argv += ['--band', f'closed={BAND_MARKER}']
    if args.kill:
        argv.append('--kill')
    print(f'pass {n}: {len(variants)} variants x {len(modes)} modes ({", ".join(modes)}) x {len(sizes)} sizes '
          f'+ {len(extras)} extras per variant' + (' + the same modes with the band only (closed)' if kind == 'band' else ''))
    if extras:
        print('extras: ' + ', '.join(f'{a}={b}:{c}' for a, b, c in extras))
    step = _run_clean(ctx, argv)
    m = DONE_LINE.search(step.out)
    if not m:
        raise Fail(f'capture-matrix gave no DONE line (rc {step.rc}); see the log', f'mods.py -C {wb} clean, then mods.py -C {wb} mockups',
                   facts={'pass': n})
    captures, secs, ring_text, failed_text = int(m.group(1)), int(m.group(2)), m.group(3), m.group(4)
    try:
        ring = eval_literal(ring_text)
    except ValueError:
        ring = {}
    failed = [] if failed_text == 'none' else re.findall(r"'([^']+)'", failed_text)
    facts = {'pass': n, 'captures': captures, 'failed': failed, 'sizes': sizes, 'modes': modes, 'variants': variants,
             'extras': [e[0] for e in extras], 'ring': ring}
    print(f'index: {out}/index.html')
    v0 = 'C' if 'C' in variants else variants[0]
    small = min(sizes)
    shots = [f'{v0}-{modes[0]}-{sizes[0]}', f"{v0}-{'overflow' if 'overflow' in modes else modes[0]}-{small}"]
    if extras:
        shots.append(f'{v0}-{extras[0][0]}-{sizes[0]}')
    for s in shots:
        p = os.path.join(out, s + '.png')
        if os.path.isfile(p):
            print(f'open with Read: {p}')
    if not args.kill:
        for v in variants:
            print(f'live session: tmux attach -t {mx}{v}')
    summary = f'DONE {captures} captures in {secs} s · ring {ring_text} · failed {failed_text}'
    if step.rc != 0 or failed:
        return Done(False, summary, f'mods.py -C {wb} clean, fix the failed captures, then mods.py -C {wb} mockups', facts)
    if not args.no_score:
        res, lines = _score(out, variants, cfg['pointer'], sizes)
        if lines:
            print('\n'.join(lines))
            facts['ranking'] = res['ranking']
    return Done(True, summary, f'present the mockups, then mods.py -C {wb} pick <V>', facts)


def eval_literal(text):
    """The ring dict that capture-matrix prints, as a dict. No eval: ast.literal_eval only."""
    import ast
    try:
        v = ast.literal_eval(text)
    except (ValueError, SyntaxError):
        raise ValueError(f'not a literal: {text}')
    if not isinstance(v, dict):
        raise ValueError('not a dict')
    return v


# ---------------------------------------------------------------- journey


def _build_json(ctx):
    """Step 1 of journey build: run journey.py. It writes journey.json and runs journey-lint.py. Return the Step."""
    jpy, jjs = _journey_paths(ctx)
    return _run_clean(ctx, [sys.executable, '-I', '-B', jpy, jjs, S])


def _journey_build(ctx, args):
    wb = ctx.wb
    if ctx.cfg['kind'] == 'guard':
        return Done(True, 'skipped (kind guard has no journey)', 'none', {'skipped': True, 'kind': 'guard'})
    jpy, jjs = _journey_paths(ctx)
    if not os.path.isfile(jpy):
        raise Fail('journey.py is missing; run mods.py journey skeleton', _next(ctx, 'journey skeleton'))
    s1 = _build_json(ctx)
    wrote = WROTE.search(s1.out)
    if not wrote:
        raise Fail(f'journey.py wrote no journey.json (rc {s1.rc}); read the lines above', f'fix journey.py, then mods.py -C {wb} journey')
    counts, end = LINT_COUNTS.search(s1.out), LINT_END.search(s1.out)
    lint = end.group(1) if end else 'FAIL'
    j = jl.load(jjs)
    approx = sum(1 for e in j['edges'] if 'approx' in e)
    scn, nodes, edges = len(j['scenarios']), len(j['nodes']), len(j['edges'])
    todo = sum(1 for k in ('scenarios', 'nodes', 'edges') for it in j[k] if _json_has_todo(it))
    s2 = _run_clean(ctx, py('audit-handlers.py') + [src_dir(ctx), jjs], echo=False)
    for ln in s2.out.split('\n'):
        if ln.startswith(('OPEN', 'STALE', 'WARN')):
            print(ln)
    a = AUDIT_END.search(s2.out)
    if not a:
        raise Fail('audit-handlers.py gave no summary line; see the log', f'fix the source, then mods.py -C {wb} journey')
    lines, opn, stale = int(a.group(1)), int(a.group(4)), int(a.group(5))
    print(last_lines(s2.out, 1))
    facts = {'scenarios': scn, 'nodes': nodes, 'edges': edges, 'approx': approx, 'lint': lint, 'lines': lines,
             'open': opn, 'stale': stale, 'todo': todo}
    summary = (f'{scn} scenarios, {nodes} nodes, {edges} edges ({approx} approximate) · lint {lint} · audit {lines} lines · '
               f'{opn} OPEN · {stale} stale · TODO {todo}')
    ok = lint == 'OK' and opn == 0 and stale == 0 and todo == 0
    if lint == 'OK':  # the marker tests follow journey.json (and the picked variant): write them again now
        res = mods_gen.markers(wb, ctx.cfg)
        for p in res['files']:
            print(f'wrote {os.path.relpath(p, wb)}')
        facts['markers'] = res['summary']
        summary += f" · markers {res['starts']} starts, {res['presses']} presses"
    if ok:
        return Done(True, summary, _next(ctx, 'crawl'), facts)
    return Done(False, summary, f'fix journey.py (lint errors, OPEN lines, TODO), then mods.py -C {wb} journey', facts)


def _journey_skeleton(ctx, args):
    out = os.path.abspath(args.out) if args.out else os.path.join(ctx.wb, 'skeleton.py')
    jpy = os.path.join(ctx.wb, 'journey.py')
    if os.path.exists(jpy) and os.path.realpath(out) == os.path.realpath(jpy):
        raise Fail('refused to overwrite journey.py; pass another --out', rc=2)
    src = src_dir(ctx)
    if not os.path.isdir(src):
        raise Fail(f'no plugin source at {src}')
    res = mods_gen.skeleton(src, out, f"{ctx.cfg['mod']} · design {ctx.cfg.get('picked') or 'C'} storyboard", ctx.cfg.get('picked') or 'C')
    if not os.path.isfile(out) or os.path.getsize(out) == 0:
        raise Fail(f'{out} is missing or empty after the write')
    print(res['summary'])
    facts = {k: res[k] for k in ('scenarios', 'nodes', 'edges', 'skips', 'todo')}
    facts['out'] = out
    return Done(True, f'skeleton {res["summary"]}', f'edit {out}, save it as journey.py, then mods.py -C {ctx.wb} journey', facts)


def _journey_markers(ctx, args):
    wb = ctx.wb
    jpy, jjs = _journey_paths(ctx)
    if not os.path.isfile(jjs):
        raise Fail('journey.json is missing; run mods.py journey', _next(ctx, 'journey'))
    if _journey_stale(ctx):
        raise Fail('journey.json is older than journey.py; run mods.py journey', _next(ctx, 'journey'))
    res = mods_gen.markers(wb, ctx.cfg)
    for p in res['files']:
        print(f'wrote {os.path.relpath(p, wb)}')
    step = run_step(ctx, ['claude', 'plugin', 'test', src_dir(ctx)], timeout=600)
    mp, mf = TEST_PASS.search(step.out), TEST_FAIL.search(step.out)
    npass, nfail = int(mp.group(1)) if mp else 0, int(mf.group(1)) if mf else -1
    facts = {'starts': res['starts'], 'presses': res['presses'], 'skipped': res['skipped'], 'testPass': npass, 'testFail': nfail}
    summary = f"markers {res['summary']} · test {npass} pass {max(nfail, 0)} fail"
    if step.rc != 0 or nfail != 0 or npass < 1:
        if nfail < 0:
            summary += ' (no result lines)'
        return Done(False, summary, f'read the failing test above, fix the source or journey.py, then mods.py -C {wb} journey markers', facts)
    return Done(True, summary, _next(ctx, 'crawl'), facts)


def cmd_journey(ctx, args):
    action = getattr(args, 'action', None) or 'build'
    if action != 'skeleton' and getattr(args, 'out', None):
        raise Fail('--out is only for journey skeleton', rc=2)
    if action == 'build':
        return _journey_build(ctx, args)
    if action == 'skeleton':
        return _journey_skeleton(ctx, args)
    return _journey_markers(ctx, args)


# ---------------------------------------------------------------- audit-existing

COMMAND_NAME = re.compile(r"\$\.command\.register\(\s*\{.*?\bname:\s*'([^']+)'", re.S)


def _command_of(folder):
    """The slash command name of the first $.command.register in the mod, or None."""
    hooks = os.path.join(folder, 'hooks')
    for root, dirs, files in os.walk(hooks):
        dirs[:] = sorted(d for d in dirs if d not in ('node_modules', 'tests', 'kit'))
        for f in sorted(files):
            if f.endswith(('.ts', '.tsx')) and '.test.' not in f:
                with open(os.path.join(root, f), encoding='utf-8') as fh:
                    m = COMMAND_NAME.search(fh.read())
                if m:
                    return m.group(1)
    return None


def _ignore_copy(d, names):
    skip = {'node_modules'}
    if os.path.basename(d) == '.claude-plugin':
        skip.add('types')
    return [n for n in names if n in skip]


SESSION_START_RE = re.compile(r"on\(\s*['\"]session\.start['\"]")


def _rule11(folder):
    """Rule 11 findings (D16): "hooks/<file>:<line>" of each $.ui.open( inside the session.start hook of the mod."""
    hooks, out = os.path.join(folder, 'hooks'), []
    for d, dirs, files in os.walk(hooks):
        dirs[:] = sorted(x for x in dirs if x not in ('kit', 'node_modules'))
        for f in sorted(files):
            if not f.endswith(('.ts', '.tsx')):
                continue
            try:
                with open(os.path.join(d, f), encoding='utf-8') as fh:
                    text = fh.read()
            except OSError:
                continue
            for m in SESSION_START_RE.finditer(text):
                end = text.find('\n  on(', m.end())
                body_end = len(text) if end < 0 else end
                for h in re.finditer(r'\$\.ui\.open\(', text[m.start():body_end]):
                    line = text.count('\n', 0, m.start() + h.start()) + 1
                    out.append(f'{os.path.relpath(os.path.join(d, f), folder)}:{line}')
    return out


def _make_writable(root):
    """chmod u+w on the run copy (chmod -R u+w): a read-only source keeps its modes in copytree. Symlinks stay as they are."""
    for base, dirs, files in os.walk(root):
        for n in [''] + dirs + files:
            path = os.path.join(base, n) if n else base
            if not os.path.islink(path):
                os.chmod(path, os.stat(path).st_mode | 0o200)


def cmd_audit_existing(ctx, args):
    folder = os.path.abspath(args.folder)
    manifest = os.path.join(folder, '.claude-plugin', 'plugin.json')
    try:
        with open(manifest, encoding='utf-8') as fh:
            name = json.load(fh)['name']
    except (OSError, ValueError, KeyError):
        raise Fail(f'{folder} is not a plugin folder: no readable name in .claude-plugin/plugin.json', rc=2)
    if not MOD_NAME.match(name):
        raise Fail(f'the plugin name "{name}" must match ^[a-z][a-z0-9-]*$', rc=2)
    # mods.py names the --cmd option dest 'cmd_text'. An older parser let --cmd overwrite the subcommand name (dest 'cmd').
    given = getattr(args, 'cmd_text', None) or (args.cmd if str(getattr(args, 'cmd', '')).startswith('/') else None)
    found = _command_of(folder)
    cmd = given or (('/' + found) if found else None)
    if not cmd:
        raise Fail('no $.command.register({ name: ... }) found in hooks/; pass --cmd /<name>', rc=2)
    marker = args.marker
    wb = os.path.join(os.path.abspath(args.scratch), f'audit-{name}')
    pre = f'au-{name}-'
    os.makedirs(wb, exist_ok=True)
    cfg_path = os.path.join(wb, 'mod.json')
    if os.path.isfile(cfg_path):  # a second audit of the same mod: the folder must be an audit workbench
        try:
            with open(cfg_path, encoding='utf-8') as fh:
                if json.load(fh).get('kind') != 'audit':
                    raise ValueError('kind')
        except ValueError:
            raise Fail(f'{wb} holds a mod.json that is not an audit workbench; pick another --scratch', rc=2)
    ctx.wb = wb
    ctx.argv_text = 'mods.py ' + shlex.join(sys.argv[1:])
    ctx.log_path = os.path.join(wb, 'logs', f'audit-existing-{mods.now_stamp()}.log')
    mods._WB = wb
    ctx.cfg = {'mod': name, 'kind': 'audit', 'trusted': os.path.abspath(args.trusted), 'variants': ['X'], 'sizes': [150, 100, 60],
               'rows': 45, 'ready': marker, 'scenarios': [], 'pointer': {},
               'prefixes': {'mockups': pre, 'crawl': pre, 'live': pre, 'audit': pre}}
    save_cfg(ctx)
    ctx.cfg = mods.load_cfg(cfg_path)
    cfg = ctx.cfg
    refuse_busy(cfg, 'audit')
    dest = os.path.join(wb, 'run', name)
    safe_rm(ctx, f'run/{name}')
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    shutil.copytree(folder, dest, symlinks=True, ignore=_ignore_copy)
    _make_writable(dest)  # a read-only source (555/444) must not block the next safe_rm
    safe_rm(ctx, 'audit')  # a new pass: the old captures must not mix with the new ones
    out = os.path.join(wb, 'audit')
    argv = py('capture-matrix.py') + [out, '--mod-dir', dest, '--ready', marker, '--trusted', cfg['trusted'], '--prefix', pre,
                                      '--command', cmd.replace('{', '{{').replace('}', '}}'), '--variants', 'X', '--modes', 'open',
                                      '--sizes', '150,100,60', '--extra', 'down=open:Down*3', '--title', f'{name}: audit', '--kill']
    step = _run_clean(ctx, argv)
    m = DONE_LINE.search(step.out)
    if not m:
        raise Fail(f'capture-matrix gave no DONE line (rc {step.rc}); see the log', _next(ctx, 'clean'), facts={'folder': folder})
    captures, ring_text, failed_text = int(m.group(1)), m.group(3), m.group(4)
    failed = [] if failed_text == 'none' else re.findall(r"'([^']+)'", failed_text)
    try:
        ring = eval_literal(ring_text)
    except ValueError:
        ring = {}
    res, lines = _score(out, ['X'], {}, [150, 100, 60])
    facts = {'folder': folder, 'cmd': cmd, 'marker': marker, 'captures': captures, 'failed': failed, 'sizes': [150, 100, 60],
             'ring': ring, 'workbench': wb}
    score = 'n/a'
    if res:
        x = res['variants']['X']
        score = f"{x['ticked']}/{x['applicable']}"
        facts['score'] = score
        print('\n'.join(lines))
    print(f'workbench: {wb}')
    print(f'index: {out}/index.html')
    rule11 = _rule11(folder)  # a finding is advice, never a FAIL
    facts['rule11'] = rule11
    for hit in rule11:
        print(f'rule 11: {hit} opens a pane in session.start (an unasked open waits undrawn below 144 columns)')
    r11 = f' · rule 11: {len(rule11)} finding(s)' if rule11 else ''
    nxt = f'mods.py new {name}-v2 --kind <kind> --scratch <dir> --trusted <dir>'
    if step.rc != 0 or failed:
        return Done(False, f'{captures} captures · failed {failed_text} · score {score}{r11}', f'mods.py -C {wb} clean, then fix the marker or the command', facts)
    return Done(True, f'{captures} captures · score {score}{r11}', nxt, facts)
