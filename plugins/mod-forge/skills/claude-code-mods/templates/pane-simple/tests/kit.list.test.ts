// Tests for kit/list.tsx. The pure parts and the window run on fake handles.
// The drawing runs on a mount: a test hook draws listRows, so no mod code is needed.
import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { ctx } from '../hooks/kit/ctx'
import { listRows, listWindow, roomSeen, rowKeys, topOf } from '../hooks/kit/list'
import type { Ctx, Ui, UiState, World } from '../hooks/kit/types'
import { fakeHandles } from './kit/fake'
import { flat } from './kit/flat'

type Row = { id: string; text: string; age: string }
type Cx = Ctx<'list', Row, 'normal'>

const NOW = new Date(2026, 9, 9, 18, 47).getTime()
// The pane at 80 x 40: 63 body columns, 40 body rows (kit API section 7).
const PROPS = { title: 'Rows', isFocused: true, bodyColumns: 63, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as const
const MOUNT = { plugin: 'kit-test', surface: 'terminal', component: 'Pane', requestId: 'kit-test', props: PROPS } as const
const UI0: UiState<'list'> = { view: 'list', cameFrom: 'list', sel: '', confirm: null, notice: null, focusKey: '', inputFocused: false, editing: false, picking: '', expandedKey: '' }
const WORLD0: World<Row, 'normal'> = { variant: 'C', scenario: 'normal', run: 0, loaded: true, rows: [], error: '', banner: '', busy: null, lastAction: null, epoch: 0, failsLeft: 0 }

// The clock and the six ui.* stubs that every test needs (decisions A1).
function setup($: Parameters<TestBody>[0], on: Parameters<TestBody>[1]) {
  const clock = mock.clock(on, { now: NOW })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  return clock
}

async function ctxFor($: Parameters<TestBody>[0], on: Parameters<TestBody>[1], bodyRows: number, ui: Partial<UiState<'list'>> = {}): Promise<Cx> {
  const clock = setup($, on)
  const f = fakeHandles<'list', Row, 'normal'>(clock, { ...UI0, ...ui }, WORLD0)
  return ctx(f.k, {} as Ui, { title: 'Rows', bodyColumns: 63, scroll: { bodyRows } })
}

// Mount a list of n rows ("Row number i", id r<i>) with the row at index sel selected.
// The test hook draws the list. Register it before the first $ call.
async function mountList($: Parameters<TestBody>[0], on: Parameters<TestBody>[1], n: number, sel: number) {
  const clock = setup($, on)
  const f = fakeHandles<'list', Row, 'normal'>(clock, UI0, WORLD0)
  const rows: Row[] = Array.from({ length: n }, (_, i) => ({ id: `r${i}`, text: `Row number ${i}`, age: '1m' }))
  on('ui.render', { component: 'Pane', requestId: 'kit-test' }, async (h, e) => {
    if (e.surface === 'mobile' || e.surface === 'vscode') throw new Error('kit test draws on the terminal only')
    const c = await ctx(f.k, h.ui.resolve(e), e.props)
    return listRows(c, rows, { idOf: r => r.id, isSel: r => r.id === `r${sel}`, fixedRows: 5, row: r => ({ body: r.text, onPress: () => undefined }) })
  })
  return $.ui.mount(MOUNT)
}

test('topOf keeps one row of context above the selection', async ($, on) => {
  setup($, on)
  expect(topOf(0, 60, 10)).toBe(0)
  expect(topOf(1, 60, 10)).toBe(0)
  expect(topOf(5, 60, 10)).toBe(4)
  expect(topOf(59, 60, 10)).toBe(50)
  expect(topOf(3, 5, 10)).toBe(0)
  // A window of one row shows the selection itself: no context row.
  expect(topOf(5, 60, 1)).toBe(5)
  expect(topOf(5, 60, 2)).toBe(4)
})

test('listWindow measures the room and the edges', async ($, on) => {
  const c = await ctxFor($, on, 40)
  expect(listWindow(c, 60, 0, 5)).toEqual({ room: 32, windowed: true, top: 0, count: 32, below: 28, gap: 1, edges: true })
  expect(roomSeen()).toBe(32)
  expect(listWindow(c, 60, 59, 5)).toEqual({ room: 32, windowed: true, top: 28, count: 32, below: 0, gap: 1, edges: true })
  expect(listWindow(c, 60, -1, 5)).toEqual({ room: 32, windowed: true, top: 0, count: 32, below: 28, gap: 1, edges: true })
  expect(listWindow(c, 10, 0, 5)).toEqual({ room: 32, windowed: false, top: 0, count: 10, below: 0, gap: 1, edges: false })
  // 40 rows - 5 fixed - 1 gap = 34 free rows. A list of 34 rows fits without edges.
  expect(listWindow(c, 34, 0, 5).windowed).toBe(false)
  expect(roomSeen()).toBe(34)
  expect(listWindow(c, 35, 0, 5).windowed).toBe(true)
  expect(roomSeen()).toBe(32)
})

test('listWindow keeps the footer in a short pane: the first layout that fits wins', async ($, on) => {
  // A 30-row terminal gives 8 body rows. The pane-list list view has 4 fixed rows (header, rule, keys, hints).
  const c = await ctxFor($, on, 8)
  // 3 rows fit with the gap row (layout 1).
  expect(listWindow(c, 3, 0, 4)).toMatchObject({ windowed: false, count: 3, gap: 1, edges: false })
  // 4 rows fit when the gap row goes (layout 3): no window.
  expect(listWindow(c, 4, 0, 4)).toEqual({ room: 2, windowed: false, top: 0, count: 4, below: 0, gap: 0, edges: false })
  // 60 rows: a window of 3 rows with the gap and no edge rows (layout 4). The arrows need 3 drawn rows.
  expect(listWindow(c, 60, 0, 4)).toEqual({ room: 3, windowed: true, top: 0, count: 3, below: 57, gap: 1, edges: false })
  expect(listWindow(c, 60, 30, 4)).toEqual({ room: 3, windowed: true, top: 29, count: 3, below: 28, gap: 1, edges: false })
  expect(roomSeen()).toBe(3)
  // Even less room (layout 5): what is left, never a floor that pushes the footer out.
  expect(listWindow(c, 20, 0, 30)).toMatchObject({ room: 1, windowed: true, gap: 0, edges: false })
  expect(roomSeen()).toBe(1)
})

test('rowKeys gives the keys in ring order and the selected index', async ($, on) => {
  setup($, on)
  const rows: Row[] = [{ id: 'a', text: 'A', age: '1m' }, { id: 'b', text: 'B', age: '2m' }, { id: 'c', text: 'C', age: '3m' }]
  expect(rowKeys(rows, r => r.id, r => r.id === 'b')).toEqual({ keys: ['row:a', 'row:b', 'row:c'], at: 1 })
  expect(rowKeys(rows, r => r.id, () => false).at).toBe(-1)
  expect(rowKeys([], (r: Row) => r.id, () => false)).toEqual({ keys: [], at: -1 })
})

test('a mounted list of 60 rows windows to 32 and shows the edge', async ($, on) => {
  const ui = await mountList($, on, 60, 0)
  const lines = flat(await ui.drawn()).split('\n')
  expect(lines).toContain('↓ 28 more')
  expect(lines.filter(l => l.startsWith('❯ '))).toEqual(['❯ Row number 0'])
  expect(lines.filter(l => l.includes('Row number'))).toHaveLength(32)
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(32)
  expect((await ui.find({ key: 'row:r0' }))?.props.autoFocus).toBe(true)
  expect((await ui.find({ key: 'row:r1' }))?.props.autoFocus).toBeUndefined()
  expect(await ui.find({ key: 'row:r32' })).toBeUndefined()
  // The engine drops the key of a Text, so the edges are the first and last child of the list Box.
  const kids = edgesOf(await ui.drawn())
  expect(kids).toHaveLength(34)
  expect(kids[0]).toMatchObject({ type: 'Text', props: { dimColor: true }, children: [' '] })
  expect(kids[33]).toMatchObject({ type: 'Text', props: { dimColor: true }, children: ['↓ 28 more'] })
  // The plugin keeps its own copy of the module, so roomSeen() here cannot see the mount's window.
  await ui.unmount()
})

test('a selection past the window scrolls it and shows the up edge', async ($, on) => {
  const ui = await mountList($, on, 60, 30)
  const lines = flat(await ui.drawn()).split('\n')
  expect(lines).toContain('↑ 28 more')
  expect(edgesOf(await ui.drawn()).at(-1)).toMatchObject({ type: 'Text', children: [' '] })
  expect(lines.filter(l => l.startsWith('❯ '))).toEqual(['❯ Row number 30'])
  expect((await ui.find({ key: 'row:r30' }))?.props.autoFocus).toBe(true)
  expect(await ui.find({ key: 'row:r27' })).toBeUndefined()
  expect(await ui.find({ key: 'row:r28' })).toBeDefined()
  await ui.unmount()
})

test('a list that fits has no edge Text and no more line', async ($, on) => {
  const ui = await mountList($, on, 10, 3)
  const text = flat(await ui.drawn())
  expect(text).not.toContain('more')
  expect(edgesOf(await ui.drawn()).filter(n => n.type === 'Text')).toHaveLength(0)
  expect(text.split('\n').filter(l => l.startsWith('❯ '))).toEqual(['❯ Row number 3'])
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(10)
  await ui.unmount()
})

test('a pane with no selected row has no pointer and no autoFocus', async ($, on) => {
  const ui = await mountList($, on, 5, 9)
  expect(flat(await ui.drawn())).not.toContain('❯')
  for (const b of await ui.findAll({ type: 'Button' })) expect(b.props.autoFocus).toBeUndefined()
  await ui.unmount()
})

type Drawn = { type?: string; props?: { [k: string]: unknown }; children?: unknown[] }
// The children of the list Box, as the engine drew them.
function edgesOf(node: unknown): Drawn[] {
  return ((node as Drawn).children ?? []) as Drawn[]
}
// A plain element table for direct calls of listRows: each element is its description.
const kidsOf = (v: unknown): unknown[] => (Array.isArray(v) ? v.flatMap(kidsOf) : v === '' || v === null || v === undefined || v === false ? [] : [v])
const E = new Proxy({}, { get: (_t, type: string) => (p: { children?: unknown } & { [k: string]: unknown }) => { const { children, ...props } = p; return { type, props, children: kidsOf(children) } } }) as unknown as Ui

test('listRows gives each row its width, pointer, side column and handler', async ($, on) => {
  const base = await ctxFor($, on, 40)
  const widths: number[] = []
  const pressed: string[] = []
  const rows: Row[] = [{ id: 'a', text: 'Alpha', age: '1m' }, { id: 'b', text: 'Beta', age: '2m' }]
  const draw = (c: Cx, pointer?: string) => listRows(c, rows, {
    idOf: r => r.id, isSel: r => r.id === 'a', fixedRows: 4, pointer,
    row: (r, sel, width) => { widths.push(width); return { body: `${r.text}${sel ? '*' : ''}`, side: `|${r.age}`, onPress: () => { pressed.push(r.id) } } },
  })
  const c = { ...base, E }
  const out = draw(c)
  expect(widths).toEqual([c.cols - 2, c.cols - 2])
  expect(flat(out).split('\n')).toEqual(['❯ Alpha*|1m', '  Beta|2m'])
  expect(flat(draw(c, '>')).split('\n')[0]).toBe('> Alpha*|1m')
  expect((out as unknown as Drawn).props?.marginTop).toBe(1)
  expect(pressed).toEqual([])
})

test('listRows draws no autoFocus while a confirmation or an input holds the focus', async ($, on) => {
  const base = await ctxFor($, on, 40)
  const rows: Row[] = [{ id: 'a', text: 'Alpha', age: '1m' }]
  const draw = (c: Cx) => listRows(c, rows, { idOf: r => r.id, isSel: () => true, fixedRows: 4, row: r => ({ body: r.text, onPress: () => undefined }) })
  const focus = (c: Cx) => {
    const root = draw({ ...c, E }) as unknown as Drawn
    const button = ((root.children?.[0] as Drawn).children?.[0]) as Drawn
    expect(button.type).toBe('Button')
    return button.props?.autoFocus
  }
  expect(focus(base)).toBe(true)
  expect(focus({ ...base, u: { ...base.u, confirm: { kind: 'del', id: 'a' } } })).toBeUndefined()
  expect(focus({ ...base, u: { ...base.u, inputFocused: true } })).toBeUndefined()
})
