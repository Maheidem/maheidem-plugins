"""mods_check.py: the subcommands check, score, pick and approve of mods.py (group C).

Each cmd_<name>(ctx, args) returns Done or raises Fail. mods.py prints the two last lines
and writes the RUN.md section. This file is not an entry point: run mods.py.
"""
import sys

sys.dont_write_bytecode = True  # no __pycache__ in the skill folder

import datetime
import json
import os
import re
import shutil

from mods import S, Done, Fail, claude_version, discover_types, kit_state, last_lines, read_runs, run_step, save_cfg, src_dir

import mods_score
from mods_setup import _scenario_members, gen_tsconfig  # generator 4.5 (driver-design.md 4.5): one writer of the tsconfig

TSC = ['npx', '-y', '-p', 'typescript@5.6.3', 'tsc', '--noEmit']
TEMPLATE_NOUN = r'\b(?:item|items)\b'  # the noun of every starter template (new-mod.sh --from-noun default 'item:items')
KIT_COPIES = (os.path.join('hooks', 'kit') + os.sep, os.path.join('tests', 'kit'))  # verbatim copies of the kit: the kit hash covers them
SKIP_DIRS = {'node_modules', '.git', '__pycache__'}
WHATS = ('validate', 'test', 'tsc')
NET_ERR = re.compile(r'npm error|npm ERR|403|ENOTFOUND')  # the output of an npx run that could not fetch typescript
TSC_SKIPPED = 'tsc: skipped (typescript not available offline: npm i -g typescript)'
VALIDATE_OK = '✔ Validation passed'


# ---------------------------------------------------------------- check


def _target(ctx, real):
    """The folder to check: src/<plugin>, or with --real the dev-mods copy."""
    if real:
        dev = ctx.cfg.get('devMods')
        if not dev:
            raise Fail('check --real: devMods is not set in mod.json', 'mods.py build --dev-mods <dir>', 2)
        path = os.path.join(dev, ctx.cfg['mod'])
        if not os.path.isdir(path):
            raise Fail(f'check --real: {path} does not exist', 'mods.py build --dev-mods <dir>', 2)
        return path
    path = src_dir(ctx)
    if not os.path.isdir(path):
        raise Fail(f'check: no plugin source at {path}', 'mods.py new <mod> --kind <kind> --scratch <dir> --trusted <dir>', 2)
    return path


def _authoring(ctx):
    """The types file for tsc. mod.json holds it; when the file is gone, discover it again and save it."""
    au = ctx.cfg.get('authoring') or {}
    if au.get('types') and os.path.isfile(au['types']):
        return au['types']
    path, version = discover_types()
    if not path:
        raise Fail('tsc: no plugin-authoring types file found', 'mods.py doctor', 2)
    au = dict(au)
    au.update({'types': path, 'typesVersion': version, 'binary': claude_version()})
    au.setdefault('base', os.path.dirname(os.path.dirname(path)))
    ctx.cfg['authoring'] = au
    save_cfg(ctx)
    print(f'authoring: types file refreshed to {path} (types {version})')
    return path


def _tsc_unavailable(st):
    """True when a tsc attempt failed because npm or typescript was out of reach, not because the code has type errors."""
    if st.rc == 0 or 'error TS' in st.out:
        return False
    return st.rc in (124, 127) or bool(NET_ERR.search(st.out))


def _run_tsc(run, tail, cwd):
    """Run tsc with `tail` (-p <tsconfig>). First the pinned npx run (120 s). When npm cannot be reached,
    then `tsc` on PATH, then `npx --no-install`. Return (Step, via) of the first attempt that ran, or (None, None)."""
    attempts = [('npx typescript@5.6.3', TSC + tail, 120)]
    if shutil.which('tsc'):
        attempts.append(('tsc on PATH', ['tsc', '--noEmit'] + tail, 600))
    attempts.append(('npx --no-install', ['npx', '--no-install', '-p', 'typescript', 'tsc', '--noEmit'] + tail, 120))
    for via, argv, limit in attempts:
        st = run('tsc', argv, cwd=cwd, timeout=limit)
        if not _tsc_unavailable(st):
            return st, via
        print(f'   tsc: {via} not usable (rc={st.rc})')
    return None, None


def _grep_left(ctx, target):
    """Lines that still hold the template plugin name, 'your-name' or (with a noun) the template noun.
    Returns {kind: [(path, line no, text)]}. The engine-written types and node_modules are skipped."""
    tpl = ctx.cfg.get('template') or ''
    name = tpl
    try:
        with open(os.path.join(S, 'templates', tpl, '.claude-plugin', 'plugin.json'), encoding='utf-8') as fh:
            name = json.load(fh).get('name') or tpl
    except (OSError, ValueError):
        pass
    # The template name as a whole token (new-mod.sh renames it so), so 'mixed' is not found in 'smokemixed-proto'.
    rules = [('template-name', re.compile(r'(?<![a-z0-9-])' + re.escape(name) + r'(?![a-z0-9])')),
             ('your-name', re.compile(r'your-name'))] if name else [('your-name', re.compile(r'your-name'))]
    own = ''  # the plugin name of the target: a line part that is the own name is not a left-over ('mixed-proto')
    try:
        with open(os.path.join(target, '.claude-plugin', 'plugin.json'), encoding='utf-8') as fh:
            own = json.load(fh).get('name') or ''
    except (OSError, ValueError):
        pass
    if ctx.cfg.get('noun'):
        rules.append(('template-noun', re.compile(TEMPLATE_NOUN, re.I)))
    files = []
    for root, dirs, names in os.walk(target):
        rel = os.path.relpath(root, target)
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not (rel == '.claude-plugin' and d == 'types')]
        files += [os.path.join(root, n) for n in names
                  if not os.path.relpath(os.path.join(root, n), target).startswith(KIT_COPIES)]
    journey = os.path.join(ctx.wb, 'journey.py')
    if os.path.isfile(journey):
        files.append(journey)
    hits = {k: [] for k, _ in rules}
    for path in sorted(files):
        try:
            with open(path, encoding='utf-8') as fh:
                lines = fh.read().split('\n')
        except (OSError, UnicodeDecodeError):
            continue
        for n, line in enumerate(lines, 1):
            rest = line.replace(own, '') if own else line
            for kind, rx in rules:
                if rx.search(rest):
                    hits[kind].append((path, n, line.strip()))
    return hits


def _kit(target):
    """Return (state, version): 'in sync', 'drift' or 'n/a' (no kit in the skill or in the mod)."""
    tver, thash = kit_state(os.path.join(S, 'templates', 'kit'))
    mver, mhash = kit_state(os.path.join(target, 'hooks', 'kit'))
    if thash is None or mhash is None:
        return 'n/a', None
    return ('in sync' if thash == mhash and tver == mver else 'drift'), tver


def _plural(n, word):
    return f'{n} {word} line' + ('' if n == 1 else 's')


def cmd_check(ctx, args):
    what = [w.strip() for w in (args.what or '').split(',') if w.strip()]
    bad = [w for w in what if w not in WHATS]
    if bad or not what:
        raise Fail(f'usage: --what takes {",".join(WHATS)}; got {args.what!r}', 'mods.py check --help', 2)
    real = bool(args.real)
    target = _target(ctx, real)
    facts = {'target': 'real' if real else 'src'}
    if not real:  # mockups and live read mod.json scenarios: keep them equal to the Scenario union of the prototype
        members = _scenario_members(os.path.join(target, 'types', 'index.d.ts'))
        if members and members != ctx.cfg.get('scenarios'):
            print(f"scenarios: mod.json updated from types/index.d.ts: {', '.join(members)} (was {', '.join(ctx.cfg.get('scenarios') or []) or 'none'})")
            ctx.cfg['scenarios'] = members
            save_cfg(ctx)
    pieces, ok, failed = [], True, []

    def run(name, argv, timeout=600, **kw):
        """Run one tool quietly. Print its command and its verdict line. Keep a failed step for the report."""
        print(f"== {name}: {' '.join(argv)}")
        return run_step(ctx, argv, echo=False, timeout=timeout, **kw)

    def verdict(name, st, good, detail=''):
        print(f"   {name}: {'ok' if good else 'FAIL'} rc={st.rc} {st.seconds} s{detail}")
        if not good:
            failed.append((name, st))
        return good

    if 'validate' in what:
        st = run('validate', ['claude', 'plugin', 'validate', target, '--strict'])
        tail = [ln.strip() for ln in st.out.split('\n') if ln.strip()]
        good = verdict('validate', st, st.rc == 0 and bool(tail) and tail[-1] == VALIDATE_OK)
        facts['validate'] = good
        pieces.append('validate ✔' if good else f'validate ✘ rc={st.rc}')
        ok &= good
    if 'test' in what:
        st = run('test', ['claude', 'plugin', 'test', target])
        npass = [int(x) for x in re.findall(r'^\s*(\d+) pass$', st.out, re.M)]
        nfail = [int(x) for x in re.findall(r'^\s*(\d+) fail$', st.out, re.M)]
        facts['testPass'], facts['testFail'] = (npass[-1] if npass else 0), (nfail[-1] if nfail else 0)
        good = verdict('test', st, st.rc == 0 and bool(npass) and bool(nfail) and facts['testFail'] == 0 and facts['testPass'] >= 1,
                       f" {facts['testPass']} pass {facts['testFail']} fail")
        pieces.append(f"test {facts['testPass']} pass {facts['testFail']} fail" + ('' if good or st.rc == 0 else f' rc={st.rc}'))
        ok &= good
    if 'tsc' in what:
        types = _authoring(ctx)
        cfgpath = os.path.normpath(os.path.join(ctx.wb, 'tscheck', 'real' if real else '', 'tsconfig.json'))
        gen_tsconfig(ctx.wb, target, types, cfgpath)
        st, via = _run_tsc(run, ['-p', cfgpath], ctx.wb)
        facts['engineTsc'] = None
        if st is None:  # typescript is out of reach (offline): not a failure, but the gate shows row 2 as MISSING
            print(TSC_SKIPPED)
            facts['tsc'] = 'skipped'
            pieces.append('tsc skipped')
        else:
            facts['tsc'], facts['tscVia'] = st.rc, via
            pieces.append(f'tsc rc={st.rc}')
            ok &= verdict('tsc', st, st.rc == 0, f' via {via}')
            # the types the engine wrote into the mod: check them only when they name this binary
            eng = os.path.join(target, '.claude-plugin', 'types', 'claude-code', 'index.d.ts')
            if os.path.isfile(eng) and os.path.isfile(os.path.join(target, 'tsconfig.json')):
                with open(eng, encoding='utf-8', errors='replace') as fh:
                    first = fh.readline()
                if f'Claude Code {claude_version()}' in first:
                    est, _ = _run_tsc(run, ['-p', target], ctx.wb)
                    if est is None:
                        print(TSC_SKIPPED)
                    else:
                        facts['engineTsc'] = est.rc
                        pieces.append(f'engine tsc rc={est.rc}')
                        ok &= verdict('engine tsc', est, est.rc == 0)
    for name, st in failed:  # the last 30 lines of each failed tool, and each TS error line
        print(f'-- {name}: last 30 lines')
        print(last_lines(st.out, 30))
        errs = [ln for ln in st.out.split('\n') if re.search(r'error TS\d+', ln)]
        if errs and len(st.out.rstrip('\n').split('\n')) > 30:
            print(f'-- {name}: every error line')
            print('\n'.join(errs))
    for i, st in enumerate(ctx.steps):  # printed above: mods.py must not print the last step again
        ctx.steps[i] = st._replace(echoed=True)
    hits = _grep_left(ctx, target)
    left = sum(len(v) for v in hits.values())
    facts['grepLeft'] = left
    if left:
        ok = False
        print('== grep: the template left these lines')
        for kind, rows in hits.items():
            for path, n, text in rows[:10]:
                print(f'{kind}: {os.path.relpath(path, ctx.wb)}:{n}: {text[:100]}')
        pieces.append('grep: ' + ', '.join(_plural(len(v), k) for k, v in hits.items() if v))
    state, kver = _kit(target)
    facts['kit'] = state
    if state == 'in sync':
        pieces.append(f'kit v{kver} in sync')
    elif state == 'drift':
        ok = False
        print('== kit: hooks/kit/ differs from templates/kit/')
        pieces.append(f'kit v{kver} drift')
    else:
        pieces.append('kit n/a')
    nxt = (f'mods.py -C {ctx.wb} live --real --marker <text>' if real else f'mods.py -C {ctx.wb} mockups') if ok else f'fix the failing step, then mods.py -C {ctx.wb} check' + (' --real' if real else '')
    if not ok and state == 'drift':
        nxt = f'mods.py -C {ctx.wb} kit-sync'
    return Done(ok, ' · '.join(pieces), nxt, facts)


# ---------------------------------------------------------------- score


def _latest_pass(wb):
    root = os.path.join(wb, 'mockups')
    nums = [int(d) for d in os.listdir(root) if d.isdigit() and os.path.isdir(os.path.join(root, d))] if os.path.isdir(root) else []
    return max(nums) if nums else None


def cmd_score(ctx, args):
    n = getattr(args, 'pass_n', None)
    if n is None:
        n = getattr(args, 'pass', None)
    if n is None:
        n = _latest_pass(ctx.wb)
    if n is None:
        raise Fail('no mockups pass under mockups/', f'mods.py -C {ctx.wb} mockups')
    folder = os.path.join(ctx.wb, 'mockups', str(n))
    if not os.path.isfile(os.path.join(folder, 'matrix.json')):
        raise Fail(f'no matrix.json in {folder}', f'mods.py -C {ctx.wb} mockups')
    try:
        result = mods_score.score_dir(folder, variants=ctx.cfg.get('variants'), pointers=ctx.cfg.get('pointer'),
                                      sizes=ctx.cfg.get('sizes'))
        mods_score.write(result)
    except (ValueError, OSError) as e:
        raise Fail(f'score: {e}')
    if getattr(args, 'json', False):
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print('\n'.join(mods_score.summary_lines(result)))
    vs = result['variants']
    rows = {v: f"{d['ticked']}/{d['applicable']}" for v, d in vs.items()}
    facts = {'pass': n, 'rows': rows, 'ranking': result['ranking'], 'decidedBy': result['decidedBy']}
    top = result['ranking'][0] if result['ranking'] else None
    why = f" ({result['decidedBy']})" if result['decidedBy'] else ''
    tail = f"ranking {' > '.join(result['ranking'])}{why}"
    if top and mods_score.passes_all(vs[top]):
        return Done(True, f'{top} {rows[top]} · {tail}', f'present, then mods.py -C {ctx.wb} pick <V>', facts)
    best = f'best {top} {rows[top]}' if top else 'no variants'
    return Done(False, f'no variant ticks every box: {best} · {tail}', f'fix the failing boxes, then mods.py -C {ctx.wb} mockups', facts)


# ---------------------------------------------------------------- pick and approve


def cmd_pick(ctx, args):
    v = args.variant
    variants = ctx.cfg.get('variants') or []
    if v not in variants:
        raise Fail(f'usage: {v!r} is not a variant of this mod ({", ".join(variants)})', f'mods.py -C {ctx.wb} pick <V>', 2)
    ctx.cfg['picked'], ctx.cfg['pickedBy'] = v, args.by
    save_cfg(ctx)
    return Done(True, f'{v} by {args.by}', f'mods.py -C {ctx.wb} journey', {'picked': v, 'by': args.by})


def auto_pick(ctx):
    """A kind with one variant has nothing to choose (design 4.1): record it as picked, by 'single'. Return the next: line."""
    only = ctx.cfg['variants'][0]
    ctx.cfg['picked'], ctx.cfg['pickedBy'] = only, 'single'
    save_cfg(ctx)
    print(f'pick: {only} by single (the only variant)')
    if ctx.cfg.get('kind') == 'guard':
        return f'mods.py -C {ctx.wb} approve --by person|headless'  # a guard has no journey and no storyboard
    return f'mods.py -C {ctx.wb} journey'


def cmd_approve(ctx, args):
    at = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    secs = read_runs(ctx.wb)
    if ctx.cfg.get('kind') == 'guard':
        # A guard draws nothing: no storyboard. The approval rests on the checklist of references/ux-design.md section 12
        # and a passing check (tests, tsc and the validator of the prototype).
        chk = [s for s in secs if s['cmd'] == 'check']
        if not chk or chk[-1]['result'] != 'PASS':
            raise Fail('no passing check in RUN.md (a guard is approved on the checklist and a passing check); run mods.py check',
                       f'mods.py -C {ctx.wb} check')
        basis = 'checklist'
    else:
        if not ctx.cfg.get('picked'):
            raise Fail('no variant is picked', f'mods.py -C {ctx.wb} pick <V>')
        sb = [s for s in secs if s['cmd'] == 'storyboard']
        if not sb or sb[-1]['facts'].get('gate') != 'pass':
            raise Fail('no passing storyboard in RUN.md; run mods.py storyboard', f'mods.py -C {ctx.wb} storyboard')
        basis = 'storyboard'
    ctx.cfg['approved'] = {'by': args.by, 'at': at, 'basis': basis}
    save_cfg(ctx)
    dev = ctx.cfg.get('devMods') or '<path>'
    return Done(True, f'by {args.by} on the {basis}', f'mods.py -C {ctx.wb} build --dev-mods {dev}', {'by': args.by, 'at': at, 'basis': basis})
