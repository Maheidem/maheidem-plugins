#!/usr/bin/env python3
"""mods_gen.py: the generators of the mod-forge driver (driver design 6: 4.1, 4.3, 4.6).

  skeleton(mod_dir, out, title)   4.1  a journey.py with TODO stubs, from the source lines of a mod
  markers(wb, cfg)                4.3  tests/journey-markers.ts and tests/<plugin>.journey.test.ts, from journey.json
  extras(journey, cfg)            4.6  the extra screens of a mockups pass, from journey.json
  type_members(path, name)        6.1  the members of a string-union type in types/index.d.ts

mods.py calls these functions through mods_design.py. You can also run them alone:
  python3 -I mods_gen.py skeleton <mod dir> [--out FILE] [--title TEXT] [--picked V]
  python3 -I mods_gen.py markers <workbench dir>
  python3 -I mods_gen.py extras <workbench dir>
Same input gives the same bytes: no clock, no random.
"""
import sys

sys.dont_write_bytecode = True  # no __pycache__ in the skill folder

import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
SKILL = os.path.dirname(HERE)
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import journey_lib as jl  # noqa: E402

MOBILE = "e.surface === 'mobile'"
MOBILE_WHY = 'mobile surface; the storyboard is the terminal only'


def type_members(path, name):
    """The members of `export type <name> = 'a' | 'b'` in a types file. One line or many lines. No match gives []."""
    try:
        with open(path, encoding='utf-8') as fh:
            text = fh.read()
    except OSError:
        return []
    m = re.search(r'export\s+type\s+' + re.escape(name) + r"\s*=\s*((?:\s*\|?\s*'[^']*')+)", text)
    return re.findall(r"'([^']*)'", m.group(1)) if m else []


def q(text):
    """A Python string literal."""
    return repr(text)


# ---------------------------------------------------------------- 4.1 skeleton

JSX_TEXT = re.compile(r">([^<>{}]*[A-Za-z]{2,}[^<>{}]*)<")
JSX_STR = re.compile(r"\{'([^']*[A-Za-z]{2,}[^']*)'\}")
BRANCH_LIT = re.compile(r"[!=]==\s*'([A-Za-z][\w-]*)'")
HOOK = re.compile(r"\bon\(\s*'([\w.]+)'")
HOTKEY = [re.compile(r'hotkey="([^"]*)"'), re.compile(r"hotkey=\{'([^']*)'\}"), re.compile(r'hotkey=\{"([^"]*)"\}')]
CLOCK_WAIT = re.compile(r'\$\.clock\.(sleep|after|every)\(')


def jsx_literals(lines):
    """The text literals of JSX lines, in order, stripped and unique."""
    out = []
    for ln in lines:
        hits = sorted((m.start(), m.group(1).strip()) for rx in (JSX_TEXT, JSX_STR) for m in rx.finditer(ln))
        for _, text in hits:
            if text and text not in out:
                out.append(text)
    return out


def _kinds(row):
    return row['kind'].split('+')


def _slug(text):
    return re.sub(r'[^a-z0-9-]+', '-', text.lower()).strip('-') or 'node'


def skeleton(mod_dir, out, title=None, picked='C'):
    """Write a journey.py with TODO stubs to `out`. Return a dict: out, scenarios, nodes, edges, skips, todo, summary.

    Rules (driver design 4.1): a draw row is a node stub; a hotkey, an onSubmit, an onPress,
    a ui.close, a ui.focus and a clock wait are edge stubs; a mobile branch and its draw, and the
    session.start hook, are skips. Every node marker and edge label starts with TODO: and the edge
    targets are 'TODO', so journey-lint.py fails until a person fills them in."""
    rows, files = jl.rows_of(mod_dir)
    rows.sort(key=lambda r: (r['file'], r['line']))
    lines_of = {}
    for rel in files:
        with open(os.path.join(mod_dir, rel), encoding='utf-8') as fh:
            lines_of[rel] = fh.read().split('\n')
    types = os.path.join(mod_dir, 'types', 'index.d.ts')
    scenarios, views = type_members(types, 'Scenario'), type_members(types, 'View')
    first = scenarios[0] if scenarios else 'TODO'
    plugin = os.path.basename(os.path.abspath(mod_dir))
    title = title or f'{plugin} · design {picked} storyboard'

    def src(r, what):
        return f"{r['file']}:{r['line']} ({what})"

    def hook_of(r):
        m = HOOK.search(r['code']) if 'hook' in _kinds(r) else None
        return m.group(1) if m else None

    skips = {}  # text -> why, in order
    for r in rows:
        if hook_of(r) == 'session.start':
            skips.setdefault("on('session.start'", 'registers the command; draws nothing')
    mobile_rows = [r for r in rows if 'branch' in _kinds(r) and MOBILE in r['code']]
    for r in mobile_rows:
        skips.setdefault(MOBILE, MOBILE_WHY)

    stubs = []  # node stubs: dicts with id, row, marker
    taken = set()
    for r in rows:
        if 'draw' not in _kinds(r):
            continue
        if any(m['file'] == r['file'] and 0 <= r['line'] - m['line'] <= 3 for m in mobile_rows):
            lits = jsx_literals([r['code']])
            skips.setdefault(lits[0] if lits and lits[0] in r['code'] else r['code'], MOBILE_WHY)
            continue
        above = [m for m in rows if m['file'] == r['file'] and 'branch' in _kinds(m) and r['line'] - 15 <= m['line'] < r['line']]
        lits = [x for m in above for x in BRANCH_LIT.findall(m['code'])]
        pick = next((x for x in lits if x in views), lits[0] if lits else None)
        base = _slug(pick) if pick else f"node-{r['line']}"
        nid, n = base, 1
        while nid in taken:
            n += 1
            nid = f'{base}-{n}'
        taken.add(nid)
        body = lines_of[r['file']][r['line'] - 1:r['line'] + 13]
        found = jsx_literals(body)[:3]
        marker = 'TODO: ' + (' && '.join(found) if found else '(no text literal)')
        stubs.append({'id': nid, 'row': r, 'marker': marker})

    closer = next((r for r in rows if hook_of(r) == 'ui.close'), None)
    focuser = next((r for r in rows if hook_of(r) == 'ui.focus'), None)

    def stub_for(r):
        same = [s for s in stubs if s['row']['file'] == r['file'] and s['row']['line'] <= r['line']]
        if same:
            return max(same, key=lambda s: s['row']['line'])['id']
        return stubs[0]['id'] if stubs else 'TODO'

    edges = []  # (from, to, key, label, source)
    for r in rows:
        kinds, code = _kinds(r), r['code']
        if 'hotkey' in kinds:
            key = next((m.group(1) for rx in HOTKEY for m in [rx.search(code)] if m and m.group(1)), 'TODO')
            edges.append((stub_for(r), 'TODO', key, 'TODO: what this hotkey does', src(r, 'hotkey')))
        if 'handler' in kinds and 'onSubmit=' in code:
            edges.append((stub_for(r), 'TODO', 'text:"TODO" Enter', 'TODO: what saving the text does', src(r, 'onSubmit')))
        if 'handler' in kinds and 'onPress=' in code and 'hotkey' not in kinds:
            edges.append((stub_for(r), 'TODO', 'Enter', 'TODO: what pressing this row does', src(r, 'onPress')))
        if CLOCK_WAIT.search(code):
            edges.append((stub_for(r), 'TODO', 'wait', 'TODO: what the timer changes', src(r, 'timer')))
    if closer:
        for s in stubs:
            edges.append((s['id'], 'pane-closed', 'Escape', 'TODO: close the pane or step back', src(closer, 'ui.close')))
    if focuser and stubs:
        press_lines = [r for r in rows if 'handler' in _kinds(r) and 'onPress=' in r['code']]
        start = next((s for s in stubs if any(p['file'] == s['row']['file'] and s['row']['line'] <= p['line'] <= s['row']['line'] + 12
                                              for p in press_lines)), stubs[0])
        for key in ('Down', 'Up'):
            edges.append((start['id'], 'TODO', key, 'TODO: move the focus', src(focuser, 'ui.focus')))

    crawl = {'command': f'/{{mod}} {picked} {{scenario}}', 'clearScenarios': scenarios}
    out_lines = [
        '# journey skeleton: generated by mods.py journey skeleton (mods_gen.py 4.1). It is NOT a journey yet.',
        '# Replace every TODO: the node marker, the edge target and key, the scenario start and text.',
        '# Then save the file as journey.py and run: mods.py journey',
        'import os',
        'import sys',
        '',
        'sys.dont_write_bytecode = True  # no __pycache__ in the skill folder',
        f'SKILL = sys.argv[2] if len(sys.argv) > 2 else {q(SKILL)}',
        "sys.path.insert(0, os.path.join(SKILL, 'scripts'))",
        'from journey_build import Journey  # noqa: E402',
        '',
        f'j = Journey({q(title)}, notes={q("TODO")},',
        f'            crawl={crawl!r})',
        '',
        '# ---- scenarios',
    ]
    for s in scenarios:
        out_lines.append(f"j.scenario({q(s)}, 'TODO: describe the fixture world', 'TODO')")
    out_lines += ['', '# ---- nodes: one per draw line']
    for s in stubs:
        out_lines.append(f"j.node({q(s['id'])}, 'TODO', 'TODO', 'TODO', {q(first)}, {q(s['marker'])}, {q(src(s['row'], 'draw'))})")
    if closer:
        out_lines.append(f"j.node('pane-closed', 'TODO', 'TODO', 'TODO', {q(first)}, 'TODO: the command reply', "
                         f"{q(src(closer, 'ui.close'))}, region='screen')")
    out_lines += ['', '# ---- edges: one per key handler']
    for frm, to, key, label, source in edges:
        out_lines.append(f'j.edge({q(frm)}, {q(to)}, {q(key)}, {q(label)}, {q(source)})')
    out_lines += ['', '# ---- source lines with no screen of their own (scripts/audit-handlers.py)']
    for text, why in skips.items():
        out_lines.append(f'j.skip({q(text)}, {q(why)})')
    out_lines += ['', "sys.exit(j.write(sys.argv[1] if len(sys.argv) > 1 else 'journey.json'))", '']
    text = '\n'.join(out_lines)
    compile(text, out, 'exec')  # the stub must be valid Python
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    with open(out, 'w', encoding='utf-8') as fh:
        fh.write(text)
    nodes = len(stubs) + (1 if closer else 0)
    todo = len(stubs) + (1 if closer else 0)
    res = {'out': out, 'scenarios': len(scenarios), 'nodes': nodes, 'edges': len(edges), 'skips': len(skips), 'todo': todo}
    res['summary'] = (f"{out}: {len(scenarios)} scenarios, {nodes} node stubs, {len(edges)} edge stubs, "
                      f"{len(skips)} skips, {todo} TODO markers")
    return res


# ---------------------------------------------------------------- 4.3 markers and tests

STEP_TYPES = '''export type Step = { tap: string } | { text: string; submit: boolean } | { wait: number }
export type Check = { parts: string[]; absent: string[] }
export type Start = Check & { scenario: string; node: string }
export type Press = Check & { edge: string; scenario: string; steps: Step[]; timeout: number }
'''

LOCAL_FLAT = '''type Node = { type?: string; props?: { [k: string]: unknown }; children?: unknown[] }

// The drawing as text: a column Box breaks lines, a row Box joins its children,
// a hotkey Button draws `k: label` as the terminal does.
function flat(node: unknown, inRow = false): string {
  if (node === null || node === undefined || node === false || node === true) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(n => flat(n, inRow)).join(inRow ? '' : '\\n')
  const n = node as Node
  const p = n.props ?? {}
  const kids = n.children ?? []
  switch (n.type) {
    case 'Button': {
      const body = kids.length ? kids.map(k => flat(k, true)).join('') : String(p.label ?? '')
      return p.hotkey ? `${String(p.hotkey)}: ${body}` : body
    }
    case 'Text': return kids.map(k => flat(k, true)).join('')
    case 'Markdown': return String(p.text ?? '')
    case 'Code': return String(p.source ?? '')
    case 'Input': return String(p.value || p.placeholder || '')
    case 'Select': {
      const opts = (p.options ?? []) as { value: string; label: string }[]
      const shown = opts.find(o => o.value === p.value)?.label ?? ''
      return p.autoFocus ? [shown, ...opts.map(o => o.label)].join('\\n') : shown
    }
    case 'Box': {
      const row = p.flexDirection === 'row'
      return kids.map(k => flat(k, row)).filter(s => s !== '').join(row ? '' : '\\n')
    }
    default: return kids.map(k => flat(k, inRow)).join('')
  }
}
'''

TEST_TS = '''// Generated by mods.py journey markers from journey.json. Do not edit it: run mods.py journey markers again.
// Each scenario mounts at its start node and shows that node's marker (STARTS).
// Each exact edge whose keys are letters, typed text or a wait replays on the mounted pane
// and shows the marker of its target (PRESSES). An arrow key, Esc, Tab and a bare Enter
// cannot be pressed by a mount test: the live crawl (mods.py crawl) proves them.
import { expect, mock, test } from 'claude-code/testing'
import type { MockClock, TestBody } from 'claude-code/testing'

import { PRESSES, STARTS } from './journey-markers'
import type { Check, Step } from './journey-markers'
__FLAT__
const PLUGIN = __PLUGIN__
const PICKED = __PICKED__
const NOW = 1_700_000_000_000
const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 150 } } as const
// The docked pane at 150 x 45: the divider is at column 83, so 66 body columns and 34 body rows.
const PROPS = { title: __TITLE__, isFocused: true, bodyColumns: 66, placement: 'dock', scroll: { offset: 0, bodyRows: 34 }, view: {} } as const
// Markers that the engine draws, not the mod.
const ENGINE_ONLY = ['shift+tab to cycle']

type Env = Parameters<TestBody>
const mount = ($: Env[0]) => $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: __PANE__, props: PROPS })
type Ui = Awaited<ReturnType<typeof mount>>

const norm = (s: string) => s.replace(/\\s+/g, ' ')
// The parts of a marker that fail on the text. A positive part may wrap over two lines.
function misses(text: string, c: Check): string[] {
  const t = norm(text)
  const gone = c.parts.filter(p => !ENGINE_ONLY.includes(p) && !t.includes(norm(p)))
  const shown = c.absent.filter(p => t.includes(norm(p))).map(p => `!${p}`)
  return [...gone, ...shown]
}

// The mock clock moves only when the test moves it. The engine stubs below are the same for every test.
function setup(on: Env[1]): MockClock {
  const clock = mock.clock(on, { now: NOW })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }) as never)
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  return clock
}

async function begin($: Env[0], clock: MockClock, scenario: string): Promise<void> {
  await $.command.run({ ...RUN, command: PLUGIN, args: `${PICKED} ${scenario}` })
  await clock.advance(300)
}

// Press the Button that answers a letter: the one with that hotkey, else a key named for it.
async function tap(ui: Ui, letter: string): Promise<void> {
  const buttons = await ui.findAll({ type: 'Button' })
  const names = [`act:${letter}`, ...(letter === 'y' ? ['confirm:yes'] : []), ...(letter === 'n' ? ['confirm:no'] : [])]
  const hit = buttons.find(b => b.props['hotkey'] === letter) ?? buttons.find(b => b.key !== undefined && names.includes(b.key))
  if (hit?.key === undefined) throw new Error(`no Button answers the key ${letter}`)
  await ui.press({ key: hit.key })
}

async function act(clock: MockClock, ui: Ui, step: Step): Promise<void> {
  if ('tap' in step) {
    await tap(ui, step.tap)
  } else if ('text' in step) {
    const key = (await ui.findAll({ type: 'Input' }))[0]?.key
    if (key === undefined) throw new Error(`no Input is drawn for the text ${step.text}`)
    await ui.input({ key, text: step.text, kind: step.submit ? 'submit' : 'change' })
  } else {
    await clock.advance(step.wait * 1000)
  }
  await clock.advance(200)
}

// Wait for the marker as the live crawl does: step the mock clock until it holds, or the time is up.
async function until(clock: MockClock, ui: Ui, c: Check, seconds: number): Promise<string[]> {
  let bad = misses(flat(await ui.drawn()), c)
  for (let ms = 0; bad.length > 0 && ms < seconds * 1000; ms += 100) {
    await clock.advance(100)
    bad = misses(flat(await ui.drawn()), c)
  }
  return bad
}

for (const s of STARTS) {
  test(`start ${s.scenario}: ${s.node}`, async ($, on) => {
    const clock = setup(on)
    await begin($, clock, s.scenario)
    const ui = await mount($)
    expect({ node: s.node, missing: misses(flat(await ui.drawn()), s) }).toEqual({ node: s.node, missing: [] })
    await ui.unmount()
  })
}

for (const p of PRESSES) {
  test(`press ${p.edge} (${p.scenario})`, async ($, on) => {
    const clock = setup(on)
    await begin($, clock, p.scenario)
    const ui = await mount($)
    for (const step of p.steps) await act(clock, ui, step)
    expect({ edge: p.edge, missing: await until(clock, ui, p, p.timeout) }).toEqual({ edge: p.edge, missing: [] })
    await ui.unmount()
  })
}
'''


def _map_key(key, plugin, timeout):
    """(steps, reason) for an edge key. reason is None when a mount test can press it, else 'arrow' or 'enter'."""
    toks = jl.tokens(key)
    steps, i = [], 0
    while i < len(toks):
        t = toks[i]
        m = re.fullmatch(r'text:"(.*)"', t)
        if m:
            submit = i + 1 < len(toks) and toks[i + 1] == 'Enter'
            steps.append({'text': m.group(1).replace('{mod}', plugin), 'submit': submit})
            i += 2 if submit else 1
        elif t == 'wait':
            steps.append({'wait': timeout or 2})
            i += 1
        elif re.fullmatch(r'[A-Za-z0-9]', t):
            steps.append({'tap': t})
            i += 1
        else:
            return None, 'enter' if t == 'Enter' else 'arrow'
    return steps, None


def _ts_list(items):
    """A TypeScript array literal with one JSON object per line."""
    if not items:
        return '[]'
    return '[\n' + ',\n'.join('  ' + json.dumps(x, ensure_ascii=False) for x in items) + '\n]'


def _check_of(marker):
    parts = jl.marker_parts(marker)
    return [p for p in parts if not p.startswith('!')], [p[1:] for p in parts if p.startswith('!')]


def markers(wb, cfg, picked=None):
    """Write tests/journey-markers.ts and tests/<plugin>.journey.test.ts into src/<plugin>.

    Return a dict: starts, presses, skipped {arrow, enter, screen, nopath}, files, summary."""
    plugin = f"{cfg['mod']}-proto"
    src = os.path.join(wb, 'src', plugin)
    j = jl.load(os.path.join(wb, 'journey.json'))
    g = jl.Graph(j)
    picked = picked or cfg.get('picked') or 'C'
    skipped = {'arrow': 0, 'enter': 0, 'screen': 0, 'nopath': 0}

    starts = []
    for s in j['scenarios']:
        node = g.nodes.get(s['start'])
        if node is None or node.get('region') == 'screen':
            skipped['screen'] += 1
            continue
        parts, absent = _check_of(node['marker'])
        starts.append({'scenario': s['id'], 'node': node['id'], 'parts': parts, 'absent': absent})

    presses = []
    for e in j['edges']:
        if 'approx' in e or e.get('history'):
            continue  # not an exact edge
        scn = g.edge_scenario(e)
        path = g.path(scn, e['from']) if scn else None
        if scn is None or path is None or not g.allowed(e, scn):
            skipped['nopath'] += 1
            continue
        steps, reason = [], None
        for hop in path + [e]:
            part, why = _map_key(hop['key'], plugin, hop.get('timeout'))
            if why:
                reason = reason or why
            else:
                steps += part
        if reason:
            skipped[reason] += 1
            continue
        target = g.nodes[e['to']]
        if target.get('region') == 'screen':
            skipped['screen'] += 1
            continue
        parts, absent = _check_of(e.get('check') or target['marker'])
        presses.append({'edge': jl.edge_id(e), 'scenario': scn, 'steps': steps, 'parts': parts, 'absent': absent,
                        'timeout': e.get('timeout') or 3})

    tests = os.path.join(src, 'tests')
    marker_file = os.path.join(tests, 'journey-markers.ts')
    test_file = os.path.join(tests, f'{plugin}.journey.test.ts')
    if not starts and not presses:
        # Every node is region 'screen' (a toast, a reply, a guard): a mount test has nothing to mount.
        # A test file with no test() fails 'claude plugin test', so write none and remove an old one.
        for p in (marker_file, test_file):
            if os.path.isfile(p):
                os.remove(p)
        return {'starts': 0, 'presses': 0, 'skipped': skipped, 'files': [], 'summary': 'no pane node: no journey test'}
    os.makedirs(tests, exist_ok=True)
    head = ('// Generated by mods.py journey markers from journey.json: every start node and every replayable edge.\n'
            '// Do not edit it. Run mods.py journey markers again after a change of journey.json.\n')
    body = (head + STEP_TYPES
            + 'export const STARTS: Start[] = ' + _ts_list(starts) + '\n'
            + 'export const PRESSES: Press[] = ' + _ts_list(presses) + '\n')
    with open(marker_file, 'w', encoding='utf-8') as fh:
        fh.write(body)

    reg = os.path.join(src, 'hooks', 'register.tsx')
    pane, title = plugin, plugin
    if os.path.isfile(reg):
        with open(reg, encoding='utf-8') as fh:
            text = fh.read()
        m = re.search(r"const PANE = '([^']+)'", text)
        pane = m.group(1) if m else plugin
        m = re.search(r"\btitle:\s*'([^']*)'", text)
        title = m.group(1) if m else plugin
    if os.path.isfile(os.path.join(tests, 'kit', 'flat.ts')):
        flat = "import { flat } from './kit/flat'\n"
    else:
        flat = '\n' + LOCAL_FLAT
    pane_expr = 'PLUGIN' if pane == plugin else q(pane)
    test_text = (TEST_TS.replace('__FLAT__', flat).replace('__PLUGIN__', q(plugin)).replace('__PICKED__', q(picked))
                 .replace('__TITLE__', q(title)).replace('__PANE__', pane_expr))
    with open(test_file, 'w', encoding='utf-8') as fh:
        fh.write(test_text)
    for p in (marker_file, test_file):
        if os.path.getsize(p) == 0:
            raise RuntimeError(f'{p} is empty after the write')
    k = sum(skipped.values())
    extra = ''.join(f', {name} {skipped[name]}' for name in ('screen', 'nopath') if skipped[name])
    summary = (f"{len(starts)} starts, {len(presses)} presses, {k} skipped "
               f"(arrow/Esc {skipped['arrow']}, Enter {skipped['enter']}{extra})")
    return {'starts': len(starts), 'presses': len(presses), 'skipped': skipped, 'files': [marker_file, test_file], 'summary': summary}


# ---------------------------------------------------------------- 4.6 extra screens


def extras(j, cfg=None):
    """The extra screens of a mockups pass, from a journey dict. Return a list of
    {name, scenario, key, focus}: one per node that one exact key from a scenario start reaches."""
    g = jl.Graph(j)
    start_nodes = {s['start'] for s in j['scenarios']}
    out, taken = [], set()
    for e in j['edges']:
        if 'approx' in e or e.get('history') or e['from'] not in start_nodes or e['from'] == e['to']:
            continue
        target = g.nodes.get(e['to'])
        if target is None or target.get('region') == 'screen' or 'wait' in jl.tokens(e['key']) or e['to'] in taken:
            continue
        scn = next((s['id'] for s in j['scenarios'] if s['start'] == e['from'] and g.allowed(e, s['id'])), None)
        if scn is None:
            continue
        taken.add(e['to'])
        out.append({'name': e['to'], 'scenario': scn, 'key': e['key'], 'focus': target.get('focus')})
    return out


# ---------------------------------------------------------------- command line


def main(argv):
    import argparse
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='what', required=True)
    s = sub.add_parser('skeleton')
    s.add_argument('mod_dir')
    s.add_argument('--out', default='skeleton.py')
    s.add_argument('--title')
    s.add_argument('--picked', default='C')
    s = sub.add_parser('markers')
    s.add_argument('workbench')
    s = sub.add_parser('extras')
    s.add_argument('workbench')
    a = ap.parse_args(argv)
    if a.what == 'skeleton':
        print(skeleton(a.mod_dir, a.out, a.title, a.picked)['summary'])
        return 0
    wb = os.path.abspath(a.workbench)
    with open(os.path.join(wb, 'mod.json'), encoding='utf-8') as fh:
        cfg = json.load(fh)
    if a.what == 'markers':
        print(markers(wb, cfg)['summary'])
        return 0
    for x in extras(jl.load(os.path.join(wb, 'journey.json')), cfg):
        print(f"--extra '{x['name']}={x['scenario']}:{x['key']}'" + (f" --focus '{x['name']}={x['focus']}'" if x['focus'] else ''))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
