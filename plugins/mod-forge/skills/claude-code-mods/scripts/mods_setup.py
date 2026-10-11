#!/usr/bin/env python3 -I
"""mods_setup.py: the subcommands new, upgrade-check and build, and two generators.

Run it through mods.py. Do not run it by hand.

  new            make a workbench from a template (driver-design.md 5.B.1); with the domain flags it writes the domain block
                 and runs mods_domain.write (round 2 design 1)
  upgrade-check  compare the binary and the types file (5.B.2)
  build          copy the approved prototype to dev-mods (5.B.4)
  gen_fixtures   generator 4.2 of round 1: write hooks/fixtures.ts from mod.json "fixtures" (kept for the lint of the skill; mods.py domain replaces it)
  gen_tsconfig   generator 4.5: write the tsconfig that tsc uses (group C imports it)

Each cmd_<name>(ctx, args) returns Done or raises Fail. mods.py prints the two last lines.
"""
import sys

sys.dont_write_bytecode = True

import json
import os
import re
import shlex
import shutil

import mods_domain
from mods import (Done, Fail, KNOWN_VERSIONS, MOD_NAME, S, UPGRADE_NAMES, claude_version, discover_types, kit_state,
                  load_cfg, plugin, run_step, save_cfg, sh, src_dir)
from mods_domain import _noun_pair, _ts, _ts_list, _write_text

TEMPLATES = os.path.join(S, 'templates')
RESERVED_NAMES = {'claude', 'anthropic', 'anthropics', 'claude-code', 'claude-mods'}  # api.md "Reserved names"
RESERVED_PREFIXES = ('claude-', 'anthropic-', 'anthropics-', 'cc-plugin-')
OK_LINE = re.compile(r'^ok: (.+) \(from (\S+), author ([^,)]+)(?:, noun (\S+))?\)$', re.M)  # new-mod.sh prints this
NOUN = re.compile(r'^[a-z]+(:[a-z]+)?$')
FIELD_NAME = re.compile(r'^[A-Za-z_][A-Za-z0-9_]*$')
KIT_TEST_HELPERS = ('flat.ts', 'fake.ts')  # these go to tests/kit/. The other *.test.ts files go to tests/.

# ---------------------------------------------------------------- small helpers


def _scenario_members(types_file):
    """The members of the Scenario union (driver-design.md 6.1). mods_gen owns the real function."""
    try:
        from mods_gen import type_members
        return type_members(types_file, 'Scenario')
    except (ImportError, AttributeError):  # mods_gen.py is not built yet: use the same rule here
        pass
    try:
        with open(types_file, encoding='utf-8') as fh:
            text = fh.read()
    except OSError:
        return []
    m = re.search(r"export\s+type\s+Scenario\s*=\s*((?:\s*\|?\s*'[^']*')+)", text)
    return re.findall(r"'([^']*)'", m.group(1)) if m else []


def _name_problem(mod):
    if not MOD_NAME.match(mod):
        return 'the name must be lowercase letters, digits and -, and start with a letter'
    if mod in RESERVED_NAMES or mod.startswith(RESERVED_PREFIXES) or ('official' in mod and ('claude' in mod or 'anthropic' in mod)):
        return f'"{mod}" is a reserved plugin name (Claude Code refuses it): name the mod for what it does'
    return None


def _pick_template(kind):
    if os.path.isfile(os.path.join(TEMPLATES, kind, '.claude-plugin', 'plugin.json')):
        return kind
    raise Fail(f'template {kind} is not in this skill yet', 'none', 2)


def _kind_defaults(kind):
    path = os.path.join(TEMPLATES, 'mod.json.tpl')
    try:
        with open(path, encoding='utf-8') as fh:
            d = json.load(fh)['kinds'][kind]
        return d['variants'], d['ready'], d['pointer'], d['fixtures']
    except (OSError, ValueError, KeyError, TypeError) as e:
        raise Fail(f'{path} has no usable entry for kind {kind} ({type(e).__name__}: {e})', 'none', 2)



# ---------------------------------------------------------------- generator 4.5: tsconfig


def gen_tsconfig(wb, target, types, out=None):
    """Write the tsconfig for tsc (driver-design.md 6, 4.5). Return its path.

    wb: the workbench. target: the plugin folder to check. types: the types file.
    out: where to write, absolute or relative to wb (default tscheck/tsconfig.json).
    The file stays outside the plugin (SKILL.md: a tsconfig inside the mod would be shipped).
    """
    src = os.path.join(TEMPLATES, 'tsconfig.check.json')
    try:
        with open(src, encoding='utf-8') as fh:
            text = fh.read()
    except OSError as e:
        raise Fail(f'cannot read {src}: {e}', 'none', 2)
    if not types or not os.path.isfile(types):
        raise Fail('no types file for the tsconfig (run mods.py doctor, or pass --types)', 'none', 2)
    esc = lambda p: json.dumps(os.path.abspath(p))[1:-1]  # a path inside a JSON string
    text = text.replace('__TYPES__', esc(types)).replace('__MOD__', esc(target))
    try:
        json.loads(text)
    except ValueError as e:
        raise Fail(f'the generated tsconfig is not valid JSON: {e}')
    out = os.path.join(wb, out) if out and not os.path.isabs(out) else (out or os.path.join(wb, 'tscheck', 'tsconfig.json'))
    _write_text(out, text)
    return out


# ---------------------------------------------------------------- generator 4.2: fixtures


def _fixture_spec(cfg):
    """Check cfg['fixtures']. Return (count, overflow, fields) or raise Fail rc 2."""
    f = cfg.get('fixtures')
    if not isinstance(f, dict):
        raise Fail('config: fixtures must be an object', 'none', 2)
    count, overflow, fields = f.get('count'), f.get('overflow'), f.get('fields')
    ok_int = lambda v: isinstance(v, int) and not isinstance(v, bool) and v >= 1
    if not ok_int(count) or not ok_int(overflow):
        raise Fail('config: fixtures.count and fixtures.overflow must be integers of 1 or more', 'none', 2)
    if not isinstance(fields, dict) or not fields:
        raise Fail('config: fixtures.fields must be a non-empty object {name: kind}', 'none', 2)
    for name, kind in fields.items():
        if not FIELD_NAME.match(name) or name == 'id':
            raise Fail(f'config: fixtures.fields."{name}" is not a usable field name', 'none', 2)
        if not (isinstance(kind, str) and (kind in ('sentence', 'age', 'word', 'number') or re.fullmatch(r'oneOf:[^|]+(\|[^|]+)*', kind))):
            raise Fail(f'config: fixtures.fields.{name} = {kind!r}: use sentence, age, word, number or oneOf:a|b|c', 'none', 2)
    return count, overflow, fields


TEMPLATE_NOUN = ('item', 'items')  # the noun of the starter templates; new-mod.sh --noun renames it
# The scenario cases of generator 4.2, in template order (templates/pane-list/hooks/fixtures.ts).
# A case is written only when the Scenario union has the name. Any other scenario takes `default`.
FIXTURE_CASES = (
    ('empty', 'loaded: true'),
    ('loading', ''),
    ('error', 'loaded: true, error: {error}'),
    ('overflow', 'loaded: true, rows: fixture(OVERFLOW)'),
    ('save-fails', 'loaded: true, rows: fixture(COUNT), failsLeft: 1'),
)


def gen_fixtures(cfg, src):
    """Write src/hooks/fixtures.ts from cfg['fixtures'] (driver-design.md 6, 4.2). Return the path.

    The template file templates/pane-list/hooks/fixtures.ts is the one source of the shape and the texts
    (decision F1 in decisions.md): a switch over the scenario (the audit does not list `case` lines),
    the error 'The <plural> could not be read.', a 'sentence' field 'Older <one> <i+1>' after the list ends,
    an 'age' field that keeps the last age, and a BASE world with variant 'C' and loaded false.
    The same input gives the same bytes. No clock text and no random.
    worldFor returns a full World (decisions.md A2): startScenario then sets scenario, variant and run.
    """
    count, overflow, fields = _fixture_spec(cfg)
    words_path = os.path.join(TEMPLATES, 'fixtures', 'words.json')
    try:
        with open(words_path, encoding='utf-8') as fh:
            words = json.load(fh)
        lists = {'sentence': words['sentences'], 'age': words['ages'], 'word': words['words']}
        if not all(isinstance(v, list) and v and all(isinstance(x, str) for x in v) for v in lists.values()):
            raise ValueError('each list must hold at least one string')
    except (OSError, ValueError, KeyError, TypeError) as e:
        raise Fail(f'cannot use {words_path}: {e}', 'none', 2)

    one, plural = _noun_pair(cfg.get('noun')) or TEMPLATE_NOUN
    consts, props = {}, []  # consts: the TypeScript constant name -> its strings
    for name, kind in fields.items():
        if kind == 'sentence':
            consts.setdefault('TEXTS', lists['sentence'])
            props.append(f'{name}: TEXTS[i] ?? `Older {one} ${{i + 1}}`')
        elif kind == 'age':
            consts.setdefault('AGES', lists['age'])
            props.append(f'{name}: AGES[i] ?? {_ts(lists["age"][-1])}')
        elif kind == 'word':
            consts.setdefault('WORDS', lists['word'])
            props.append(f"{name}: WORDS[i % WORDS.length] ?? ''")
        elif kind == 'number':
            props.append(f'{name}: i * 3 + 1')
        else:
            const = 'OPTIONS_' + name.upper()
            consts[const] = kind[len('oneOf:'):].split('|')
            props.append(f"{name}: {const}[i % {const}.length] ?? ''")
    error = f'The {plural} could not be read.'
    scenarios = [s for s in (cfg.get('scenarios') or []) if isinstance(s, str)]
    have = (lambda s: s in scenarios) if scenarios else (lambda s: True)  # an unknown union: write every case
    base_scenario = 'loading' if have('loading') else (scenarios[0] if scenarios else 'loading')

    out = [
        '// mods.py new wrote this file (generator 4.2 of mods_setup.py) from mod.json "fixtures". No command writes it again:',
        '// change the rows, add fields and fix the texts here by hand. The same input gives the same bytes.',
        '// No clock text and no random: a screen shot is the same on every run (storyboard.md 4).',
        '// The kit starts a scenario with worldFor(scenario, now) and keeps the full World it returns.',
        "import type { Row, Scenario, World } from '../types'",
        '',
    ]
    for const, items in consts.items():
        out.append(_ts_list(const, items).rstrip('\n'))
    out += [
        '',
        f'// The overflow scenario has more rows than a {cfg.get("rows", 45)}-row dock shows, so the list window scrolls there too.',
        f'export const OVERFLOW = {overflow}',
        f'const COUNT = {count}',
        '',
        'export function fixture(n: number): Row[] {',
        '  return Array.from({ length: n }, (_, i) => ({ id: `r${i}`, ' + ', '.join(props) + ' }))',
        '}',
        '',
        '// The world before any scenario: nothing is loaded and no scenario ran (run 0).',
        'const BASE: World = {',
        f"  variant: 'C', scenario: {_ts(base_scenario)}, run: 0, loaded: false, rows: [], error: '',",
        '  banner: \'\', busy: null, lastAction: null, epoch: 0, failsLeft: 0,',
        '}',
        '',
        '// The kit sets scenario, variant and run itself after this call.',
        'export function worldFor(s: Scenario, _now: number): World {',
        '  switch (s) {',
    ]
    for name, rest in FIXTURE_CASES:
        if have(name):
            rest = rest.format(error=_ts(error))
            out.append(f"    case {_ts(name)}: return {{ ...BASE, scenario: s{', ' + rest if rest else ''} }}")
    out += [
        '    default: return { ...BASE, scenario: s, loaded: true, rows: fixture(COUNT) }',
        '  }',
        '}',
        '',
    ]
    path = os.path.join(src, 'hooks', 'fixtures.ts')
    _write_text(path, '\n'.join(out))
    return path


# ---------------------------------------------------------------- new


def _copy_kit(src):
    """Copy templates/kit/ over hooks/kit/, and templates/kit-tests/ over tests/ and tests/kit/. Return (kit files, test files) or None.

    The copy always overwrites. The template's own copies of the kit and the kit tests exist only for its own tests.
    templates/kit/ and templates/kit-tests/ are the one source."""
    kit = os.path.join(TEMPLATES, 'kit')
    dest = os.path.join(src, 'hooks', 'kit')
    if not os.path.isdir(kit):
        return None
    if os.path.exists(dest):
        shutil.rmtree(dest)  # no stale file: the folder hash must equal the template kit hash
    shutil.copytree(kit, dest, ignore=shutil.ignore_patterns('__pycache__', '.DS_Store'))
    n_kit = sum(len(files) for _, _, files in os.walk(dest))
    n_tests = 0
    tests = os.path.join(TEMPLATES, 'kit-tests')
    if os.path.isdir(tests):
        for f in sorted(os.listdir(tests)):
            if f in KIT_TEST_HELPERS:
                target = os.path.join(src, 'tests', 'kit', f)
            elif f.endswith('.test.ts'):
                target = os.path.join(src, 'tests', f)
            else:
                continue
            os.makedirs(os.path.dirname(target), exist_ok=True)
            shutil.copyfile(os.path.join(tests, f), target)
            n_tests += 1
    return n_kit, n_tests


def cmd_new(ctx, args):
    mod, kind = args.mod, args.kind
    problem = _name_problem(mod)
    if problem:
        raise Fail(problem, 'mods.py new --help', 2)
    noun = args.noun
    if noun is not None and not NOUN.match(noun):
        raise Fail(f'--noun must be lowercase letters, as one or one:many (got "{noun}")', 'mods.py new --help', 2)
    try:
        sizes = [int(x) for x in args.sizes.split(',') if x.strip()]
        if not sizes or any(s < 20 for s in sizes):
            raise ValueError
    except ValueError:
        raise Fail(f'--sizes must be a list of column counts like 150,100,60 (got "{args.sizes}")', 'mods.py new --help', 2)
    trusted = os.path.abspath(os.path.expanduser(args.trusted))
    if not os.path.isdir(trusted):
        raise Fail(f'--trusted {trusted} is not a folder', 'mods.py new --help', 2)
    tpl = _pick_template(kind)
    variants, ready, pointer, fixtures = _kind_defaults(kind)
    with_domain = kind in mods_domain.DOMAIN_KINDS  # kind mixed keeps the round 1 path: no domain block
    domain = None
    if with_domain:  # the flags are checked before any file is written
        domain = mods_domain.validate(mods_domain.merge(mods_domain.defaults(kind), mods_domain.parse_flags(args, kind)), kind)
        noun_text = mods_domain.noun_text(domain)
        pair = _noun_pair(noun_text) or (tuple(domain['noun']) if domain['noun'] else None)
        fixtures = None
    else:
        if getattr(args, 'fields', None) or getattr(args, 'actions', None):
            raise Fail(f'kind {kind} has no domain block: the domain flags are for pane-list, pane-simple, band, status-toast, command and guard',
                       'mods.py new --help', 2)
        pair = _noun_pair(noun)
        noun_text = f'{pair[0]}:{pair[1]}' if pair else None
    wb = os.path.join(os.path.abspath(os.path.expanduser(args.scratch)), mod)
    if os.path.exists(wb):
        raise Fail(f'{wb} exists', 'none', 1)
    plugin_name = f'{mod}-proto'
    pa = os.path.abspath(os.path.expanduser(args.pa)) if getattr(args, 'pa', None) else None
    types_path, types_version = discover_types(pa)  # --pa: the types file of this session wins over the discovery

    # Step 1: copy and rename the template. With a domain no noun is renamed: the templates hold no domain word (the domain files are generated).
    argv = sh('new-mod.sh') + [os.path.join(TEMPLATES, tpl), plugin_name, os.path.join(wb, 'src')]
    if args.author:
        argv.append(args.author)
    if noun and not with_domain:
        argv += ['--noun', noun_text]  # the full one:many pair, so new-mod.sh and mod.json use the same plural
    step = run_step(ctx, argv, echo=not with_domain)  # with a domain its list of left-over nouns is noise: the generator writes those files
    m = OK_LINE.search(step.out)
    if step.rc != 0 or not m:
        fails = [ln[len('FAIL:'):].strip() for ln in step.out.split('\n') if ln.startswith('FAIL:')]
        half = f'; {wb} may hold a half copy: you decide' if os.path.exists(wb) else ''
        raise Fail('new-mod.sh: ' + (fails[0] if fails else f'no ok line (rc {step.rc})') + half, 'none', 1)
    if with_domain:
        print(m.group(0))
    author = m.group(3)
    ctx.argv_text = 'mods.py ' + shlex.join(sys.argv[1:])  # before ctx.wb is set, so the line has no -C
    ctx.wb, ctx.cfg = wb, {'mod': mod, 'kind': kind}  # from here, a failure still leaves a RUN.md section
    src = os.path.join(wb, 'src', plugin_name)

    # Step 2: the journey scaffold. A domain writes its own journey.py (mods.py domain), so the template scaffold is not kept.
    jsrc = os.path.join(wb, 'src', f'{plugin_name}.journey.py')
    if with_domain:
        if os.path.isfile(jsrc):
            os.remove(jsrc)
        print('journey: journey.py comes from the domain (mods.py domain writes it)')
    elif os.path.isfile(jsrc):
        os.replace(jsrc, os.path.join(wb, 'journey.py'))
        print('journey: wrote journey.py (from the template scaffold)')
    else:
        print('journey: none (the template has no journey scaffold)')

    # Step 3: the kit. It is copied after the rename, so the kit hash stays equal to the template kit.
    copied = _copy_kit(src)
    if copied:
        print(f'kit: copied hooks/kit ({copied[0]} files) and {copied[1]} test files')
    else:
        print('kit: skipped (no templates/kit/ in this skill)')
    kit_version, kit_hash = kit_state(os.path.join(src, 'hooks', 'kit'))

    # Step 4: mod.json (written through a temp file and read back by save_cfg).
    scenarios = list(mods_domain.Model(domain, kind, mod).names) if with_domain else _scenario_members(os.path.join(src, 'types', 'index.d.ts'))
    binary = claude_version()
    authoring = {'base': pa or (os.path.dirname(os.path.dirname(types_path)) if types_path else None), 'types': types_path,
                 'typesVersion': types_version, 'binary': binary}
    ctx.cfg = {
        'mod': mod, 'kind': kind, 'template': tpl, 'noun': noun_text, 'author': author, 'trusted': trusted,
        'devMods': os.path.abspath(os.path.expanduser(args.dev_mods)) if args.dev_mods else None,
        'sizes': sizes, 'rows': args.rows, 'variants': variants, 'picked': None, 'pickedBy': None, 'approved': None,
        'scenarios': scenarios, 'ready': ready, 'pointer': pointer, 'screens': None, 'crawlSessions': 6,
        'prefixes': {'mockups': f'mx-{mod}-', 'crawl': f'sb-{mod}-', 'live': f'lv-{mod}-'},
        'authoring': authoring, 'kit': {'version': kit_version, 'hash': kit_hash}, 'fixtures': fixtures, 'domain': domain, 'workarounds': [],
    }
    save_cfg(ctx)
    load_cfg(os.path.join(wb, 'mod.json'))  # a wrong type is Fail rc 2 here, not later
    print(f'mod.json: wrote {os.path.join(wb, "mod.json")} (scenarios: {", ".join(scenarios) or "none"})')

    # Step 5: generator 4.5 (tsconfig).
    if types_path:
        print('tsconfig: wrote ' + gen_tsconfig(wb, src, types_path))
    else:
        print('tsconfig: skipped (no plugin-authoring types file found; run mods.py doctor)')

    # Step 6: the domain. Cut the sections that it does not hold, then write the generated files (design 1.4, 1.6).
    if with_domain:
        cut = mods_domain.cut_sections(wb, ctx.cfg)
        print(f'sections: cut the actions and parts that the domain does not hold ({len(cut)} files changed)')
        written = mods_domain.write(ctx.cfg, wb, ctx)
        save_cfg(ctx)
        print(f'domain: wrote {len(written)} files (fixtures.ts, domain.ts, types/index.d.ts, journey.py, the marker tests) and the scenarios and screens of mod.json')
        probs = mods_domain.check_sections(ctx.cfg, wb)
        if probs:
            raise Fail('domain: ' + probs[0], 'none', 1)
        for note in mods_domain.domain_notes(domain, kind):
            print(note)
    elif fixtures and os.path.isfile(os.path.join(src, 'hooks', 'fixtures.ts')):
        gen_fixtures(ctx.cfg, src)
        print('fixtures: wrote hooks/fixtures.ts')
    elif not fixtures:
        print('fixtures: skipped (mod.json fixtures is null' + ('; hooks/fixtures.ts is hand-written)' if os.path.isfile(os.path.join(src, 'hooks', 'fixtures.ts')) else ')'))
    else:
        print('fixtures: skipped (template has no hooks/fixtures.ts)')

    summary = (f'{wb} (kind {kind}, template {tpl}, noun {pair[0] if pair else "none"}, '
               f'kit {"v" + str(kit_version) if kit_version is not None else "n/a"}'
               + (f', domain {len(domain["fields"])} fields)' if with_domain else ')'))
    facts = {'template': tpl, 'noun': noun_text, 'kit': kit_version, 'scenarios': ctx.cfg['scenarios'], 'types': types_version}
    return Done(True, summary, f'mods.py -C {wb} check', facts)


# ---------------------------------------------------------------- upgrade-check


def cmd_upgrade_check(ctx, args):
    """Count the 8 names of UPGRADE_NAMES in the types file. A name with count 0 fails."""
    explicit = args.types or args.pa
    types_path, types_version = discover_types(args.pa, args.types)
    recorded = ctx.cfg.get('authoring') if ctx.wb else None
    if not explicit and recorded and recorded.get('types') and not os.path.isfile(recorded['types']):
        print(f"authoring.types is gone ({recorded['types']}): refreshing it")
    binary = claude_version()
    if not types_path:
        raise Fail('no plugin-authoring types file found (give --types FILE or --pa DIR)', 'mods.py upgrade-check --help', 2)
    if not binary:
        raise Fail('claude --version failed: is claude on the PATH?', 'none', 1)
    print(f'binary {binary}')
    print(f'types {types_version} ({types_path})')
    try:
        with open(types_path, encoding='utf-8', errors='replace') as fh:
            lines = fh.read().split('\n')
    except OSError as e:
        raise Fail(f'cannot read {types_path}: {e}', 'none', 2)
    counts = {name: sum(1 for ln in lines if name in ln) for name in UPGRADE_NAMES}  # grep -cF
    for name, n in counts.items():
        print(f'  {n:>3}  {json.dumps(name, ensure_ascii=False)}')
    missing = [name.strip() for name, n in counts.items() if n == 0]
    found = len(UPGRADE_NAMES) - len(missing)
    if types_version != binary:
        print(f'WARN types {types_version} differ from binary {binary}')
    nxt = 'none'
    unknown = [v for v in (binary, types_version) if v not in KNOWN_VERSIONS]
    if unknown:
        trusted = ctx.cfg.get('trusted') if ctx.wb else None
        nxt = f'mods.py selfcheck --live --trusted {trusted or "<dir>"}'
        print(f'unknown version: run {nxt}')
    if ctx.wb and not explicit and (not recorded or not recorded.get('types') or not os.path.isfile(recorded['types'])):
        ctx.cfg['authoring'] = {'base': os.path.dirname(os.path.dirname(types_path)), 'types': types_path,
                                'typesVersion': types_version, 'binary': binary}
        save_cfg(ctx)
    facts = {'binary': binary, 'types': types_version, 'typesPath': types_path, 'names': {n.strip(): c for n, c in counts.items()}}
    if missing:
        return Done(False, f'{found}/{len(UPGRADE_NAMES)} names found (0: {", ".join(missing)})', nxt, facts)
    return Done(True, f'types {types_version} · binary {binary} · {found}/{len(UPGRADE_NAMES)} names found', nxt, facts)


# ---------------------------------------------------------------- build


def hand_steps(dest):
    """The hand steps after build, for what the copy at dest holds (a template without fixtures.ts or STYLE skips them)."""
    hooks = os.path.join(dest, 'hooks')
    text = ''
    for root, dirs, files in os.walk(hooks):
        dirs[:] = [d for d in dirs if d != 'kit']
        for f in files:
            if f.endswith(('.ts', '.tsx')):
                with open(os.path.join(root, f), encoding='utf-8', errors='replace') as fh:
                    text += fh.read()
    tests = os.path.join(dest, 'tests')
    journey_tests = sorted(f for f in os.listdir(tests) if f.endswith('.journey.test.ts')) if os.path.isdir(tests) else []
    steps = ['Remove the variant word from the command and from its usage text.']
    if 'STYLE' in text:
        steps.append('Remove the STYLE rows that are not the picked variant.')
    steps.append('Remove hooks/fixtures.ts and the scenario switch.' if os.path.isfile(os.path.join(hooks, 'fixtures.ts'))
                 else 'Remove the scenario switch and the fixture calls.')
    steps.append('Put in the real data source (for example $.process.run in $.session.root(), or a tool.call observer). '
                 'Keep the mod data in an atom of its own: the kit World has a fixed shape. Draw each state of the approved storyboard.')
    if journey_tests:
        steps.append('Rewrite or remove ' + ', '.join('tests/' + f for f in journey_tests) + '.')
    steps.append('Prove each state of the real data with live --real (the crawl proved the prototype).')
    steps.append('Quote the hot-reload notice at the start of the next turn. A --dev-mods folder outside the config folder has no hot reload: say so.')
    return steps


def _seeded(dest):
    """The .ts/.tsx files of hooks/ and tests/ that are not kit files (the kit has no prototype parts)."""
    for sub in ('hooks', 'tests'):
        for root, dirs, files in os.walk(os.path.join(dest, sub)):
            dirs[:] = sorted(x for x in dirs if x not in ('kit', 'node_modules'))
            for f in sorted(files):
                if f.endswith(('.ts', '.tsx')) and not f.startswith('kit.') and f not in ('flat.ts', 'fake.ts'):
                    yield os.path.join(root, f)


def real_transform(cfg, dest):
    """Design 1.9 steps 1-4: strip the proto parts, turn each @real line into code, put in the picked variant,
    remove the fixtures and the journey tests, write the real description. Fail rc 1 when a marker is left."""
    changed = []
    event = (cfg.get('domain') or {}).get('on')
    for p in _seeded(dest):
        with open(p, encoding='utf-8') as fh:
            old = fh.read()
        new = mods_domain.strip(old, drop=('proto',), real=True, picked=cfg.get('picked') or 'C')
        if event:  # the engine wants the event name as a literal in on(...): the domain holds it (flag --on)
            new = new.replace('{{event}}', event)
        if new != old:
            _write_text(p, new)
            changed.append(p)
    tests = os.path.join(dest, 'tests')
    gone = [os.path.join(dest, 'hooks', 'fixtures.ts'), os.path.join(tests, 'journey-markers.ts')]
    if os.path.isdir(tests):
        gone += [os.path.join(tests, f) for f in os.listdir(tests) if f.endswith('.journey.test.ts')]
    for p in gone:
        if os.path.isfile(p):
            os.remove(p)
            changed.append(p)
    pj = os.path.join(dest, '.claude-plugin', 'plugin.json')
    if os.path.isfile(pj):
        about = mods_domain.model_of(cfg).texts()['about']
        with open(pj, encoding='utf-8') as fh:
            old = fh.read()
        new = re.sub(r'("description"\s*:\s*)"(?:[^"\\]|\\.)*"', lambda mt: mt.group(1) + json.dumps(about, ensure_ascii=False), old, count=1)
        if new != old:
            _write_text(pj, new)
    for p in _seeded(dest):
        with open(p, encoding='utf-8') as fh:
            for n, line in enumerate(fh, 1):
                if re.search(r'@proto\b|//\s*@real:', line):
                    raise Fail(f'build left a prototype marker at {os.path.relpath(p, dest)}:{n}: {line.strip()[:80]}', 'none', 1)
    for root, dirs, files in os.walk(dest):  # a placeholder that nothing filled ({{picked}}, {{event}}) is a build error in any text file
        dirs[:] = sorted(x for x in dirs if x != 'node_modules')
        for f in sorted(files):
            p = os.path.join(root, f)
            try:
                with open(p, encoding='utf-8') as fh:
                    for n, line in enumerate(fh, 1):
                        if '{{' in line:
                            raise Fail(f'build left a placeholder at {os.path.relpath(p, dest)}:{n}: {line.strip()[:80]}', 'none', 1)
            except (UnicodeDecodeError, OSError):
                continue  # not a text file
    return changed


def real_hand_steps(cfg, wb):
    """Design 1.9 step 5: only the data source and its test remain, named by kind and part."""
    kind, parts = cfg['kind'], (cfg.get('domain') or {}).get('parts') or []
    where = {'status-toast': 'hooks/watch.ts rowFrom() (the event hook that makes a row)',
             'guard': 'hooks/rules.ts judge(command, root)'}.get(kind, 'hooks/source.ts (readRows, act)')
    if kind != 'guard' and 'guard' in parts:
        where += ', and hooks/rules.ts judge(command, root)'
    marker = {'status-toast': 'is not written yet', 'guard': cfg['mod'] + ':'}.get(kind, 'is not written yet')
    handle = ('$.process.run runs in $.session.root() through the run handle.' if kind in ('status-toast', 'guard') else
              'It gets io: io.run runs a program in $.session.root(), io.store keeps JSON data in the plugin store, io.root() gives the session folder.')
    observer = []
    if kind == 'pane-simple':  # the old mod may keep a tool.call observer: it is data-source code, so it goes in source.ts (round 3, W4)
        observer = ['A tool.call observer (data that a hook writes) is data-source code. Write it as observe(io, e) in hooks/source.ts and keep rows with io.store.set. '
                    "In hooks/register.tsx remove the two // of the one line that ends in '@source' (the observer slot). "
                    'mods.py evidence --lines does not count hooks/source.ts or that line as framework lines.']
    return [f'Write the real data source in {where}. {handle}', *observer,
            'Test it in tests/source.test.ts. A stub hook takes ($, e): '
            "on('process.run', ($, e) => ({ value: { exitCode: 0, stdout: '...', stderr: '' } })).",
            f'mods.py -C {wb} check --real, then mods.py -C {wb} live --real --debug --nocolor --marker <text>. '
            f"Before the source is written the marker '{marker}' must show; after it, use a text of a real row, never the pane title alone."]


def cmd_build(ctx, args):
    cfg = ctx.cfg
    if not cfg.get('approved'):
        raise Fail('the storyboard is not approved; run mods.py approve', f'mods.py -C {ctx.wb} approve --by person', 1)
    dev = args.dev_mods or cfg.get('devMods')
    if not dev:
        raise Fail('no dev-mods folder: give --dev-mods <dir> (or set devMods in mod.json)', 'mods.py build --help', 2)
    dev = os.path.abspath(os.path.expanduser(dev))
    src = src_dir(ctx)
    if not os.path.isdir(src):
        raise Fail(f'no plugin source at {src}', 'none', 1)
    mod = cfg['mod']
    step = run_step(ctx, sh('new-mod.sh') + [src, mod, dev, cfg['author']])
    m = OK_LINE.search(step.out)
    if step.rc != 0 or not m:
        fails = [ln[len('FAIL:'):].strip() for ln in step.out.split('\n') if ln.startswith('FAIL:')]
        raise Fail('new-mod.sh: ' + (fails[0] if fails else f'no ok line (rc {step.rc})'), 'none', 1)
    dest = os.path.join(dev, mod)
    try:  # read it back: the copy must hold a plugin named <mod>
        with open(os.path.join(dest, '.claude-plugin', 'plugin.json'), encoding='utf-8') as fh:
            name = json.load(fh).get('name')
    except (OSError, ValueError) as e:
        raise Fail(f'read-back of {dest}/.claude-plugin/plugin.json failed: {e}')
    if name != mod:
        raise Fail(f'{dest} holds plugin "{name}", not "{mod}"')
    cfg['devMods'] = dev
    save_cfg(ctx)
    if cfg.get('domain'):  # design 1.9: build removes the prototype parts itself
        changed = real_transform(cfg, dest)
        print(f'transform: removed the prototype parts ({len(changed)} files changed or removed)')
        steps = real_hand_steps(cfg, ctx.wb)
    else:
        steps = hand_steps(dest)
    print('hand steps that remain:')
    for i, text in enumerate(steps, 1):
        print(f'  {i}. {text}')
    return Done(True, dest, f'edit, then mods.py -C {ctx.wb} check --real, mods.py -C {ctx.wb} live --real --marker <text>',
               {'dest': dest, 'devMods': dev})
