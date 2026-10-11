import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { Args, Next } from 'claude-code'
import { focusHook, focusNow, focusPatch, focusSoon } from '../hooks/kit/focus'
import { listWindow } from '../hooks/kit/list'
import type { Ctx, FocusExtra, ListKeys, Nav, Ui, UiState, World } from '../hooks/kit/types'
import { fakeHandles } from './kit/fake'

type V = 'list' | 'detail'
type R = { id: string }
type S = 'normal'

const UI0: UiState<V> = { view: 'list', cameFrom: 'list', sel: 'r9', confirm: null, notice: null, focusKey: '', inputFocused: false, editing: false, picking: '', expandedKey: '' }
const WORLD0: World<R, S> = { variant: 'C', scenario: 'normal', run: 1, loaded: true, rows: [], error: '', banner: '', busy: null, lastAction: null, epoch: 0, failsLeft: 0 }
const IDS = Array.from({ length: 60 }, (_, n) => `r${n}`)
const NAV: Nav<V, R, S> = { back: () => null, home: () => 'row:r0' }
const FIXED = 5

// Every test starts the same way (decisions.md A1): the mock clock and the six ui.* stubs.
// The stubs are idle in a unit test, but a generated mod test needs them for a mount.
function setup(on: Parameters<TestBody>[1], sel = 'r9', focusDeny = '') {
  const clock = mock.clock(on, { now: 1000 })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  const f = fakeHandles<V, R, S>(clock, { ...UI0, sel }, WORLD0, focusDeny)
  return { clock, f }
}

// A minimal Ctx that gives listWindow a window of 10 rows: rows = 10 + fixed rows + 3.
// setRoom10 measures it as a draw does: with the selected row of the cells.
function ctxFor(f: ReturnType<typeof setup>['f']): Ctx<V, R, S> {
  return { E: {} as Ui, k: f.k, title: 'Rows', now: 1000, cols: 60, rows: 10 + FIXED + 3, u: f.ui(), w: f.world(), drafts: {} }
}
function setRoom10(f: ReturnType<typeof setup>['f']): void {
  expect(listWindow(ctxFor(f), 60, IDS.indexOf(f.ui().sel), FIXED).room).toBe(10)
}

// The drawn row keys of the list and the index of the selected row.
const keysOf = (u: UiState<V>): ListKeys => ({ keys: IDS.map(id => `row:${id}`), at: IDS.indexOf(u.sel) })

const ev = (element: string | undefined, origin: Args<'ui.focus'>['origin'] = { kind: 'person' }): Args<'ui.focus'> => ({ component: 'Pane', requestId: 'kit-test', element, origin })
// A fake next: it records the element it gets and answers with `answer`.
function fakeNext(landed: string[], answer: { deny?: string } = {}): Next<'ui.focus'> {
  return (async (e: Args<'ui.focus'>) => { landed.push(e.element ?? ''); return answer }) as unknown as Next<'ui.focus'>
}

test('focusHook: a person on an act key gets {} and no next', async (_$, on) => {
  const { f } = setup(on)
  const landed: string[] = []
  const r = await focusHook(f.k, ev('act:a'), fakeNext(landed), { keys: keysOf, nav: NAV })
  expect(r).toEqual({})
  expect(landed).toEqual([])
})

test('focusHook: a plugin on an act key calls next', async (_$, on) => {
  const { f } = setup(on)
  const landed: string[] = []
  await focusHook(f.k, ev('act:a', { kind: 'plugin', name: 'x' }), fakeNext(landed), { keys: keysOf, nav: NAV })
  expect(landed).toEqual(['act:a'])
})

test('focusHook: no element goes to next and writes nothing', async (_$, on) => {
  const { f } = setup(on)
  const landed: string[] = []
  await focusHook(f.k, ev(undefined), fakeNext(landed), { keys: keysOf, nav: NAV })
  expect(landed).toEqual([''])
  expect(f.ui().sel).toBe('r9')
})

test('focusHook: the ring lands on the screen slot, the selection is the picked row', async (_$, on) => {
  const { f } = setup(on, 'r9')
  setRoom10(f)
  const landed: string[] = []
  await focusHook(f.k, ev('row:r10'), fakeNext(landed), { keys: keysOf, nav: NAV })
  expect(landed).toEqual(['row:r9'])
  expect(f.ui().sel).toBe('r10')
})

test('focusHook: the landing follows the drawn window, not a newer selection in the cells', async (_$, on) => {
  // The engine draws r9 selected (window 8-17, the ring on slot 1). A faster hook already wrote r12.
  const { f } = setup(on, 'r9')
  setRoom10(f)
  await f.k.ui.set(() => ({ sel: 'r12' }))
  const landed: string[] = []
  await focusHook(f.k, ev('row:r10'), fakeNext(landed), { keys: keysOf, nav: NAV })
  // The key drawn now at slot 1 is r9: the ring stays on slot 1, where the next draw puts r10.
  expect(landed).toEqual(['row:r9'])
  expect(f.ui().sel).toBe('r10')
})

test('focusHook: in a window of 2 rows the next row is a step, not a wrap', async (_$, on) => {
  // A very short pane: rows = 2 + fixed rows, so the window has 2 rows and no gap or edge rows.
  const { f } = setup(on, 'r0')
  const c = { E: {} as Ui, k: f.k, title: 'Rows', now: 1000, cols: 60, rows: 2 + FIXED, u: f.ui(), w: f.world(), drafts: {} }
  expect(listWindow(c, 60, 0, FIXED).room).toBe(2)
  const landed: string[] = []
  await focusHook(f.k, ev('row:r1'), fakeNext(landed), { keys: keysOf, nav: NAV })
  expect(landed).toEqual(['row:r1'])
  expect(f.ui().sel).toBe('r1')
})

test('focusHook: a wrap at the end of a windowed list gives {} and no next', async (_$, on) => {
  const { f } = setup(on, 'r59')
  setRoom10(f)
  const landed: string[] = []
  const r = await focusHook(f.k, ev('row:r50'), fakeNext(landed), { keys: keysOf, nav: NAV })
  expect(r).toEqual({})
  expect(landed).toEqual([])
  expect(f.ui().sel).toBe('r59')
})

test('focusHook: a wrap at the top of a windowed list gives {} and no next', async (_$, on) => {
  const { f } = setup(on, 'r0')
  setRoom10(f)
  const landed: string[] = []
  const r = await focusHook(f.k, ev('row:r9'), fakeNext(landed), { keys: keysOf, nav: NAV })
  expect(r).toEqual({})
  expect(landed).toEqual([])
  expect(f.ui().sel).toBe('r0')
})

test('focusHook: a deny from next keeps the selection', async (_$, on) => {
  const { f } = setup(on, 'r9')
  setRoom10(f)
  const landed: string[] = []
  const r = await focusHook(f.k, ev('row:r10'), fakeNext(landed, { deny: 'x' }), { keys: keysOf, nav: NAV })
  expect(r).toEqual({ deny: 'x' })
  expect(landed).toEqual(['row:r9'])
  expect(f.ui().sel).toBe('r9')
})

test('focusHook: a deny from next keeps the selection in a short list too', async (_$, on) => {
  const { f } = setup(on, 'r9')
  const landed: string[] = []
  await focusHook(f.k, ev('step:2'), fakeNext(landed, { deny: 'x' }), { keys: () => null, nav: NAV })
  expect(f.ui().focusKey).toBe('')
})

test('focusHook: a list that fits the window passes the element as it is', async (_$, on) => {
  const { f } = setup(on, 'r0')
  listWindow(ctxFor(f), 5, 0, FIXED)
  const landed: string[] = []
  await focusHook(f.k, ev('row:r3'), fakeNext(landed), { keys: u => ({ keys: IDS.slice(0, 5).map(id => `row:${id}`), at: IDS.indexOf(u.sel) }), nav: NAV })
  expect(landed).toEqual(['row:r3'])
  expect(f.ui().sel).toBe('r3')
})

test('focusHook: keys null (not the list view) records the other key', async (_$, on) => {
  const { f } = setup(on)
  const landed: string[] = []
  await focusHook(f.k, ev('step:2'), fakeNext(landed), { keys: () => null, nav: NAV })
  expect(landed).toEqual(['step:2'])
  expect(f.ui().focusKey).toBe('step:2')
})

test('focusPatch row 1: inputFocused follows the in: prefix', async (_$, on) => {
  setup(on)
  expect(focusPatch(UI0, 'in:name#0')).toEqual({ inputFocused: true, focusKey: 'in:name#0' })
  expect(focusPatch({ ...UI0, inputFocused: true, focusKey: 'act:a' }, 'act:a')).toEqual({ inputFocused: false })
  expect(focusPatch({ ...UI0, inputFocused: true, focusKey: 'in:name#0' }, 'in:name#0')).toEqual({})
})

test('focusPatch row 2: a landing outside pick: clears picking', async (_$, on) => {
  setup(on)
  const u = { ...UI0, picking: 'variant', focusKey: 'act:a' }
  expect(focusPatch(u, 'act:a')).toEqual({ picking: '' })
  expect(focusPatch(u, 'pick:variant')).toEqual({})
})

test('focusPatch row 3: a new row selects it and resets expandedKey and focusKey', async (_$, on) => {
  setup(on)
  expect(focusPatch({ ...UI0, expandedKey: 'step:1', focusKey: 'step:1' }, 'row:r3')).toEqual({ sel: 'r3', expandedKey: '', focusKey: '' })
})

test('focusPatch row 4: the selected row gives no patch', async (_$, on) => {
  setup(on)
  expect(focusPatch({ ...UI0, expandedKey: 'step:1', focusKey: 'step:1' }, 'row:r9')).toEqual({})
})

test('focusPatch row 5: act:, confirm: and pick: keys store nothing', async (_$, on) => {
  setup(on)
  expect(focusPatch(UI0, 'act:a')).toEqual({})
  expect(focusPatch(UI0, 'act:retry')).toEqual({})
  expect(focusPatch(UI0, 'confirm:yes')).toEqual({})
  expect(focusPatch(UI0, 'pick:variant')).toEqual({})
})

test('focusPatch row 6: any other key sets focusKey when it differs', async (_$, on) => {
  setup(on)
  expect(focusPatch(UI0, 'step:2')).toEqual({ focusKey: 'step:2' })
  expect(focusPatch({ ...UI0, focusKey: 'step:2' }, 'step:2')).toEqual({})
})

test('focusPatch row 7: onFocus has the last word', async (_$, on) => {
  setup(on)
  const nav: FocusExtra<V> = { onFocus: (key, u) => (key === 'step:2' ? { view: 'detail', focusKey: `${u.focusKey}!` } : {}) }
  expect(focusPatch(UI0, 'step:2', nav)).toEqual({ focusKey: '!', view: 'detail' })
  expect(focusPatch(UI0, 'row:r3', nav)).toEqual({ sel: 'r3', expandedKey: '', focusKey: '' })
})

test('focusNow: a landed focus writes the patch', async (_$, on) => {
  const { f } = setup(on)
  await focusNow(f.k, 'row:r3')
  expect(f.calls).toEqual(['focus row:r3'])
  expect(f.ui().sel).toBe('r3')
})

test('focusNow: a denied focus writes nothing', async (_$, on) => {
  const { f } = setup(on, 'r9', 'moved')
  await focusNow(f.k, 'row:r3')
  expect(f.calls).toEqual(['focus row:r3'])
  expect(f.ui().sel).toBe('r9')
})

test('focusSoon: the move waits 80 ms on the clock', async (_$, on) => {
  const { clock, f } = setup(on)
  focusSoon(f.k, 'row:a')
  await clock.advance(79)
  await clock.settle()
  expect(f.calls.filter(c => c === 'focus row:a').length).toBe(0)
  await clock.advance(1)
  await clock.settle()
  expect(f.calls.filter(c => c === 'focus row:a').length).toBe(1)
})
