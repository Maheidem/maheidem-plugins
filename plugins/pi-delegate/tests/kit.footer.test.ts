// Tests of kit/footer.tsx (KA 6.4).
// The pure tests call the functions with a fake context. The mount tests draw the
// footer through a test hook, as the engine does, and read the drawing back.
//
// The mount tests draw the footer through a test hook (keys n: new and d: delete, hints
// select, view, close), so no mod code is needed.
import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { HINTS, SEP, WAIT_HINT } from '../hooks/kit/defaults'
import { ctx } from '../hooks/kit/ctx'
import { fitHints, footer, footerRows, hintsFor } from '../hooks/kit/footer'
import type { Ctx, KeySpec, Notice, Ui, UiState, World } from '../hooks/kit/types'
import { fakeHandles } from './kit/fake'
import { flat } from './kit/flat'

const NOW = new Date(2026, 9, 10, 9, 0).getTime()
// The docked pane: bodyColumns 63 (the same props as the storyboard test).
const PROPS = { title: 'Rows', isFocused: true, bodyColumns: 63, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as const
const THREE = [HINTS.select, HINTS.view, HINTS.close]

type V = 'list' | 'detail'
type Row = { id: string }
type Scn = 'normal'

const UI0: UiState<V> = { view: 'list', cameFrom: 'list', sel: '', confirm: null, notice: null, focusKey: '', inputFocused: false, editing: false, picking: '', expandedKey: '' }
const WORLD0: World<Row, Scn> = { variant: 'C', scenario: 'normal', run: 0, loaded: true, rows: [], error: '', banner: '', busy: null, lastAction: null, epoch: 0, failsLeft: 0 }
const KEYS: readonly KeySpec[] = [
  { hotkey: 'n', label: 'new', onPress: () => undefined },
  { hotkey: 'd', label: 'delete', onPress: () => undefined },
]
const ERR: Notice = { id: 1, tone: 'err', text: '✕ Could not save' }
const WARN: Notice = { id: 2, tone: 'warn', text: '! Check the value' }
const CLEAR: Notice = { id: 3, tone: 'ok', text: '✓ Saved', clear: true }
const BUSY = { kind: 'save', id: 'a', text: 'Saving' }

// The six engine stubs and the clock, as every kit test sets them (decisions A1).
function stubs(on: Parameters<TestBody>[1]) {
  const clock = mock.clock(on, { now: NOW })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  return clock
}

// A context for the pure tests: `footerRows` and `hintsFor` read only `u`, `w` and `cols`.
function ctxOf(clock: ReturnType<typeof stubs>, cols: number, ui: Partial<UiState<V>> = {}, world: Partial<World<Row, Scn>> = {}): Ctx<V, Row, Scn> {
  const u = { ...UI0, ...ui }
  const w = { ...WORLD0, ...world }
  return { E: {} as Ui, k: fakeHandles<V, Row, Scn>(clock, u, w).k, title: 'Rows', now: NOW, cols, rows: 20, u, w, drafts: {} }
}

// Draw the footer through a test hook. The returned function sets the cells, then mounts the Pane.
// Register the hook before the first $ call.
function sandbox(on: Parameters<TestBody>[1], clock: ReturnType<typeof stubs>) {
  const f = fakeHandles<V, Row, Scn>(clock, UI0, WORLD0)
  on('ui.render', { component: 'Pane', requestId: 'kit-test' }, async (h, e) => {
    if (e.surface === 'mobile' || e.surface === 'vscode') throw new Error('kit test draws on the terminal only')
    return footer(await ctx(f.k, h.ui.resolve(e), e.props), KEYS, THREE)
  })
  return async ($: Parameters<TestBody>[0], patch: { ui?: Partial<UiState<V>>; world?: Partial<World<Row, Scn>> }) => {
    await f.k.ui.set(() => ({ ...UI0, ...patch.ui }))
    await f.k.world.set(() => ({ ...WORLD0, ...patch.world }))
    return $.ui.mount({ plugin: 'kit-test', surface: 'terminal', component: 'Pane', requestId: 'kit-test', props: PROPS })
  }
}
async function actKeys(ui: { findAll: (q: { type: string }) => Promise<{ key: string | undefined }[]> }): Promise<string[]> {
  return (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '').filter(key => key.startsWith('act:'))
}
const lines = (drawn: unknown): string[] => flat(drawn).split('\n')

test('fitHints drops hints from the front and keeps the last', async ($, on) => {
  stubs(on)
  expect(fitHints(THREE, 40)).toEqual([HINTS.view, HINTS.close])
  expect(fitHints(THREE, 150)).toEqual(THREE)
  expect(fitHints(THREE, 10)).toEqual([HINTS.close])
  expect(fitHints(THREE, 0)).toEqual([HINTS.close])
  expect(fitHints([], 40)).toEqual([])
  // The input is not changed.
  expect(THREE).toHaveLength(3)
})

test('hintsFor: busy, a dismissable notice and a notice that stays', async ($, on) => {
  const clock = stubs(on)
  expect(hintsFor(ctxOf(clock, 80), THREE)).toEqual(THREE)
  expect(hintsFor(ctxOf(clock, 80, {}, { busy: BUSY }), THREE)).toEqual([WAIT_HINT])
  expect(hintsFor(ctxOf(clock, 80, { notice: ERR }), THREE)).toEqual([HINTS.select, HINTS.view])
  expect(hintsFor(ctxOf(clock, 80, { notice: WARN }), THREE)).toEqual(THREE)
  expect(hintsFor(ctxOf(clock, 80, { notice: CLEAR }), THREE)).toEqual(THREE)
  // Busy wins over a notice.
  expect(hintsFor(ctxOf(clock, 80, { notice: ERR }, { busy: BUSY }), THREE)).toEqual([WAIT_HINT])
})

test('footerRows counts the rows that footer draws', async ($, on) => {
  const clock = stubs(on)
  expect(footerRows(ctxOf(clock, 80), KEYS, THREE)).toBe(2)
  expect(footerRows(ctxOf(clock, 80, {}, { busy: BUSY }), KEYS, THREE)).toBe(1)
  expect(footerRows(ctxOf(clock, 80, { inputFocused: true }), KEYS, THREE)).toBe(1)
  expect(footerRows(ctxOf(clock, 80), [], THREE)).toBe(1)
  expect(footerRows(ctxOf(clock, 80), KEYS, [])).toBe(1)
  expect(footerRows(ctxOf(clock, 80), [], [])).toBe(0)
  // A dismissable notice and a lone Esc hint: the hints row is empty.
  expect(footerRows(ctxOf(clock, 80, { notice: ERR }), KEYS, [HINTS.close])).toBe(1)
})

test('the hints row fits the pane at 40, 60 and 150 columns', async ($, on) => {
  const mountWith = sandbox(on, stubs(on))
  const ui = await mountWith($, {})
  // ctx gives cols = bodyColumns - 1. The full row is 45 cells: it fits at 60 and 150, not at 40.
  const WANT: [number, string[]][] = [[41, [HINTS.view, HINTS.close]], [61, THREE], [151, THREE]]
  for (const [bodyColumns, hints] of WANT) {
    await ui.redraw({ ...PROPS, bodyColumns })
    const rows = lines(await ui.drawn())
    expect(rows.at(-1)).toBe(hints.join(SEP))
    expect(rows.at(-1)).toBe(fitHints(THREE, bodyColumns - 1).join(SEP))
    expect(rows.at(-2)).toBe(`n: new${SEP}d: delete`)
  }
  await ui.unmount()
})

test('footer draws the keys as act: Buttons and the hints as one dim Text', async ($, on) => {
  const mountWith = sandbox(on, stubs(on))
  const ui = await mountWith($, {})
  expect(await actKeys(ui)).toEqual(['act:n', 'act:d'])
  const dim = (await ui.findAll({ type: 'Text' })).filter(t => t.props.dimColor === true && t.text.includes('Esc to close'))
  expect(dim).toHaveLength(1)
  expect(dim[0]?.props.wrap).toBe('truncate-end')
  await ui.unmount()
})

test('busy: the wait line replaces the hints and no act: Button shows', async ($, on) => {
  const mountWith = sandbox(on, stubs(on))
  const ui = await mountWith($, { world: { busy: BUSY } })
  const rows = lines(await ui.drawn())
  expect(rows.at(-1)).toBe(WAIT_HINT)
  expect(flat(await ui.drawn())).not.toContain('Esc to')
  expect(await actKeys(ui)).toEqual([])
  await ui.unmount()
})

test('a field with focus hides the act: Buttons and keeps the hints', async ($, on) => {
  const mountWith = sandbox(on, stubs(on))
  const ui = await mountWith($, { ui: { inputFocused: true } })
  expect(await actKeys(ui)).toEqual([])
  expect(lines(await ui.drawn()).at(-1)).toBe(THREE.join(SEP))
  await ui.unmount()
})

test('a dismissable notice takes the Esc hint; a warn notice does not', async ($, on) => {
  const mountWith = sandbox(on, stubs(on))
  let ui = await mountWith($, { ui: { notice: ERR } })
  expect(flat(await ui.drawn())).not.toContain('Esc to ')
  expect(lines(await ui.drawn()).at(-1)).toBe(`${HINTS.select}${SEP}${HINTS.view}`)
  expect(await actKeys(ui)).toEqual(['act:n', 'act:d'])
  await ui.unmount()

  ui = await mountWith($, { ui: { notice: WARN } })
  expect(lines(await ui.drawn()).at(-1)).toBe(THREE.join(SEP))
  await ui.unmount()
})
