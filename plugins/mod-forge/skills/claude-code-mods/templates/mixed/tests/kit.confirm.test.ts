// Kit tests for confirm.tsx. The first three tests use fake handles (no mount).
// The next two mount a pane that a test hook draws with confirmStrip, so no mod code is needed.
// The last two call the handlers of the drawn Buttons.
// Arrows and Esc are not testable here (ui.key feeds a Client only).
import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { askConfirm, cancelConfirm, confirmStrip } from '../hooks/kit/confirm'
import { ctx } from '../hooks/kit/ctx'
import type { Nav, Ui, UiState, World } from '../hooks/kit/types'
import { fakeHandles } from './kit/fake'
import { flat } from './kit/flat'

type V = 'list' | 'detail'
type Row = { id: string }
type S = 'normal'
const NOW = new Date(2026, 9, 9, 18, 47).getTime()
const UI0: UiState<V> = { view: 'list', cameFrom: 'list', sel: 'a', confirm: null, notice: null, focusKey: '', inputFocused: false, editing: false, picking: '', expandedKey: '' }
const WORLD0: World<Row, S> = { variant: 'A', scenario: 'normal', run: 1, loaded: true, rows: [{ id: 'a' }], error: '', banner: '', busy: null, lastAction: null, epoch: 0, failsLeft: 0 }
const NAV: Nav<V, Row, S> = { back: () => null, home: u => `row:${u.sel}` }
const PROPS = { title: 'Rows', isFocused: true, bodyColumns: 63, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as const

// The clock and the six ui.* stubs that every test needs (decisions A1).
// The test hook draws confirmStrip from a second set of fake handles (`pane`). `start` sets its cells:
// 'ask' shows the question, 'busy' shows it while an action runs. A press logs 'yes' or 'no' in `calls`.
function setup($: Parameters<TestBody>[0], on: Parameters<TestBody>[1]) {
  const clock = mock.clock(on, { now: NOW })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  const shown = fakeHandles<V, Row, S>(clock, UI0, WORLD0)
  on('ui.render', { component: 'Pane', requestId: 'kit-test' }, async (h, e) => {
    if (e.surface === 'mobile' || e.surface === 'vscode') throw new Error('kit test draws on the terminal only')
    const c = await ctx(shown.k, h.ui.resolve(e), e.props)
    return c.E.Box({
      flexDirection: 'column',
      children: confirmStrip(c, {
        question: 'Delete note a? This cannot be undone.', verb: 'delete', yesLabel: 'Delete a note with a long name',
        onYes: () => shown.k.log('yes'), onNo: () => { shown.k.log('no'); void cancelConfirm(shown.k, NAV).catch(() => undefined) },
      }),
    })
  })
  const start = async (mode: 'ask' | 'busy') => {
    await shown.k.ui.set(() => ({ confirm: { kind: 'delete', id: 'a' } }))
    if (mode === 'busy') await shown.k.world.set(() => ({ busy: { kind: 'delete', id: 'a', text: '' } }))
  }
  const pane = () => $.ui.mount({ plugin: 'kit-test', surface: 'terminal', component: 'Pane', requestId: 'kit-test', props: PROPS })
  return { clock, calls: shown.calls, start, pane }
}

test('askConfirm while an action runs changes nothing', async ($, on) => {
  const s = setup($, on)
  const f = fakeHandles<V, Row, S>(s.clock, UI0, { ...WORLD0, busy: { kind: 'delete', id: 'a', text: '' } })
  await askConfirm(f.k, { kind: 'delete', id: 'a' })
  await s.clock.advance(200)
  expect(f.ui().confirm).toBeNull()
  expect(f.calls).toEqual([])
})

test('askConfirm sets the question and moves the ring to confirm:no after 80 ms', async ($, on) => {
  const s = setup($, on)
  const f = fakeHandles<V, Row, S>(s.clock, UI0, WORLD0)
  await askConfirm(f.k, { kind: 'delete', id: 'a' })
  expect(f.ui().confirm).toEqual({ kind: 'delete', id: 'a' })
  await s.clock.advance(79)
  expect(f.calls).toEqual([])
  await s.clock.advance(1)
  expect(f.calls).toEqual(['focus confirm:no'])
})

test('cancelConfirm clears the question and focuses home after 80 ms', async ($, on) => {
  const s = setup($, on)
  const f = fakeHandles<V, Row, S>(s.clock, { ...UI0, confirm: { kind: 'delete', id: 'a' } }, WORLD0)
  await cancelConfirm(f.k, NAV)
  expect(f.ui().confirm).toBeNull()
  await s.clock.advance(79)
  expect(f.calls).toEqual([])
  await s.clock.advance(1)
  expect(f.calls).toEqual(['focus row:a'])
})

test('confirmStrip draws the two buttons, the safe focus and the hint', async ($, on) => {
  const s = setup($, on)
  await s.start('ask')
  const ui = await s.pane()
  const keys = (await ui.findAll({ type: 'Button' })).map(b => b.key)
  expect(keys).toEqual(['confirm:yes', 'confirm:no'])
  expect((await ui.find({ key: 'confirm:no' }))?.props.autoFocus).toBe(true)
  expect((await ui.find({ key: 'confirm:yes' }))?.props.autoFocus).toBeUndefined()
  expect((await ui.find({ key: 'confirm:yes' }))?.props.label).toBe('Delete a note with …')
  expect((await ui.find({ key: 'confirm:no' }))?.props.label).toBe('cancel') // lower case, as 'a: add' and 'd: delete'
  const text = flat(await ui.drawn())
  expect(text).toContain('Delete note a? This cannot be undone.')
  expect(text).toContain('y to delete · Esc to cancel')
  await ui.unmount()
})

test('confirmStrip while an action runs shows the question and no button', async ($, on) => {
  const s = setup($, on)
  await s.start('busy')
  const ui = await s.pane()
  expect(await ui.findAll({ type: 'Button' })).toEqual([])
  const text = flat(await ui.drawn())
  expect(text).toContain('Delete note a? This cannot be undone.')
  expect(text).not.toContain('Esc to cancel')
  await ui.unmount()
})

// A plain element table for direct calls of confirmStrip: each element is its description.
// A test hook cannot press a Button that it drew (the engine presses the Buttons of a plugin),
// so the press tests call the onPress handler of the drawn Button.
type Drawn = { type?: string; props?: { [k: string]: unknown }; children?: unknown[] }
const kidsOf = (v: unknown): unknown[] => (Array.isArray(v) ? v.flatMap(kidsOf) : v === '' || v === null || v === undefined || v === false ? [] : [v])
const E = new Proxy({}, { get: (_t, type: string) => (p: { children?: unknown } & { [k: string]: unknown }) => { const { children, ...props } = p; return { type, props, children: kidsOf(children) } } }) as unknown as Ui
const buttonOf = (nodes: unknown, key: string): Drawn | undefined => {
  const n = nodes as Drawn
  if (Array.isArray(nodes)) return nodes.map(x => buttonOf(x, key)).find(x => x !== undefined)
  if (n?.type === 'Button' && n.props?.key === key) return n
  return (n?.children ?? []).map(x => buttonOf(x, key)).find(x => x !== undefined)
}

async function strip($: Parameters<TestBody>[0], on: Parameters<TestBody>[1]) {
  const s = setup($, on)
  const f = fakeHandles<V, Row, S>(s.clock, { ...UI0, confirm: { kind: 'delete', id: 'a' } }, WORLD0)
  const c = await ctx(f.k, E, PROPS)
  const nodes = confirmStrip(c, { question: 'Delete note a?', verb: 'delete', yesLabel: 'Delete', onYes: () => f.k.log('yes'), onNo: () => { f.k.log('no'); void cancelConfirm(f.k, NAV).catch(() => undefined) } })
  return { s, f, nodes }
}

test('pressing confirm:no runs onNo, closes the question and focuses home', async ($, on) => {
  const { s, f, nodes } = await strip($, on)
  const no = buttonOf(nodes, 'confirm:no')
  expect(no).toBeDefined()
  ;(no?.props?.onPress as () => void)()
  await s.clock.advance(100)
  expect(f.calls).toEqual(['log no', 'focus row:a'])
  expect(f.ui().confirm).toBeNull()
})

test('pressing confirm:yes runs onYes and keeps the question', async ($, on) => {
  const { s, f, nodes } = await strip($, on)
  ;(buttonOf(nodes, 'confirm:yes')?.props?.onPress as () => void)()
  await s.clock.advance(100)
  expect(f.calls).toEqual(['log yes'])
  expect(f.ui().confirm).toEqual({ kind: 'delete', id: 'a' })
})
