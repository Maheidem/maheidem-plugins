import { expect, mock, test } from 'claude-code/testing'
import type { Args, Next, On } from 'claude-code'
import { closeHook } from '../hooks/kit/close'
import type { Nav, UiState, World } from '../hooks/kit/types'
import { fakeHandles } from './kit/fake'

// Tests for the Esc ladder (kit/close.ts). The hook runs on the fake handles:
// the cells merge, the host calls go to `calls`, the waits sit on the mock clock.
type V = 'list' | 'detail'
type Row = { id: string }
type Scn = 'normal'

const UI0: UiState<V> = { view: 'list', cameFrom: 'list', sel: 'a', confirm: null, notice: null, focusKey: '', inputFocused: false, editing: false, picking: '', expandedKey: '' }
const WORLD0: World<Row, Scn> = { variant: 'C', scenario: 'normal', run: 1, loaded: true, rows: [], error: '', banner: '', busy: null, lastAction: null, epoch: 0, failsLeft: 0 }
// The detail view goes back to the list. The list is the top level.
const NAV: Nav<V, Row, Scn> = { back: u => (u.view === 'detail' ? 'list' : null), home: u => (u.view === 'detail' ? 'tab:info' : `row:${u.sel}`) }

// Stubs for the engine beneath the plugin (the six ui.* hooks and the clock).
const setup = (on: On) => {
  on('ui.close', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  return mock.clock(on, { now: 1000 })
}

const press = (kind: 'person' | 'plugin') => ({ id: 'kit-test', origin: { kind } }) as unknown as Args<'ui.close'>
// A fake next: it counts its calls and returns `result`.
function fakeNext(result: { value: undefined } | { deny: string } = { value: undefined }) {
  const seen = { count: 0 }
  const next = (async () => { seen.count += 1; return result }) as unknown as Next<'ui.close'>
  return { seen, next }
}

test('an origin other than a person calls next', async (_$, on) => {
  const clock = setup(on)
  const f = fakeHandles<V, Row, Scn>(clock, { ...UI0, picking: 'sel:x' }, WORLD0)
  const n = fakeNext()
  const r = await closeHook(f.k, press('plugin'), n.next, NAV)
  expect(r).toEqual({ value: undefined })
  expect(n.seen.count).toBe(1)
  expect(f.ui().picking).toBe('sel:x')
  expect(f.calls).toEqual([])
})

test('a running action gives a deny and no next', async (_$, on) => {
  const clock = setup(on)
  const f = fakeHandles<V, Row, Scn>(clock, UI0, { ...WORLD0, busy: { kind: 'del', id: 'a', text: 'Delete a' } })
  const n = fakeNext()
  const r = await closeHook(f.k, press('person'), n.next, NAV)
  expect(r).toEqual({ deny: 'an action runs' })
  expect(n.seen.count).toBe(0)
  expect(f.calls).toEqual([])
})

test('an err notice is dismissed, then the pane opens and the ring goes home', async (_$, on) => {
  const clock = setup(on)
  const f = fakeHandles<V, Row, Scn>(clock, { ...UI0, notice: { id: 1, tone: 'err', text: '✕ Failed' } }, WORLD0)
  const n = fakeNext()
  const r = await closeHook(f.k, press('person'), n.next, NAV)
  expect(r).toEqual({ deny: 'notice dismissed' })
  expect(f.ui().notice).toBe(null)
  expect(n.seen.count).toBe(0)
  expect(f.calls).toEqual([])
  await clock.advance(79)
  expect(f.calls).toEqual([])
  await clock.advance(1)
  expect(f.calls).toEqual(['open', 'focus row:a'])
})

test('a dismissed notice does not move the ring while a field has it', async (_$, on) => {
  const clock = setup(on)
  for (const field of [{ inputFocused: true }, { editing: true }]) {
    const f = fakeHandles<V, Row, Scn>(clock, { ...UI0, ...field, notice: { id: 1, tone: 'muted', text: 'Saved' } }, WORLD0)
    const r = await closeHook(f.k, press('person'), fakeNext().next, NAV)
    expect(r).toEqual({ deny: 'notice dismissed' })
    await clock.advance(80)
    expect(f.calls).toEqual(['open'])
  }
})

test('a warn notice and a timed notice are not dismissed by Esc', async (_$, on) => {
  const clock = setup(on)
  const warn = fakeHandles<V, Row, Scn>(clock, { ...UI0, confirm: { kind: 'del', id: 'a' }, notice: { id: 1, tone: 'warn', text: '! Careful' } }, WORLD0)
  const r1 = await closeHook(warn.k, press('person'), fakeNext().next, NAV)
  expect(r1).toEqual({ deny: 'back one level' })
  expect(warn.ui().confirm).toBe(null)
  expect(warn.ui().notice?.tone).toBe('warn')
  const timed = fakeHandles<V, Row, Scn>(clock, { ...UI0, notice: { id: 2, tone: 'ok', text: '✓ Saved', clear: true } }, WORLD0)
  const n = fakeNext()
  await closeHook(timed.k, press('person'), n.next, NAV)
  expect(n.seen.count).toBe(1)
  expect(timed.ui().notice?.id).toBe(2)
})

test('the ladder closes one layer at a time: picking, then confirm', async (_$, on) => {
  const clock = setup(on)
  const f = fakeHandles<V, Row, Scn>(clock, { ...UI0, picking: 'sel:x', confirm: { kind: 'del', id: 'a' } }, WORLD0)
  const n = fakeNext()
  const r1 = await closeHook(f.k, press('person'), n.next, NAV)
  expect(r1).toEqual({ deny: 'back one level' })
  expect(f.ui().picking).toBe('')
  expect(f.ui().confirm).not.toBe(null)
  await clock.settle()
  expect(f.calls).toEqual(['open', 'focus sel:x'])
  const r2 = await closeHook(f.k, press('person'), n.next, NAV)
  expect(r2).toEqual({ deny: 'back one level' })
  expect(f.ui().confirm).toBe(null)
  await clock.settle()
  expect(f.calls).toEqual(['open', 'focus sel:x', 'open', 'focus row:a'])
  expect(n.seen.count).toBe(0)
})

test('editing clears both flags before the input flag', async (_$, on) => {
  const clock = setup(on)
  const f = fakeHandles<V, Row, Scn>(clock, { ...UI0, editing: true, inputFocused: true }, WORLD0)
  const r = await closeHook(f.k, press('person'), fakeNext().next, NAV)
  expect(r).toEqual({ deny: 'back one level' })
  expect(f.ui().editing).toBe(false)
  expect(f.ui().inputFocused).toBe(false)
  await clock.settle()
  expect(f.calls).toEqual(['open', 'focus row:a'])
})

test('a focused field gives the ring back to home', async (_$, on) => {
  const clock = setup(on)
  const f = fakeHandles<V, Row, Scn>(clock, { ...UI0, inputFocused: true }, WORLD0)
  const r = await closeHook(f.k, press('person'), fakeNext().next, NAV)
  expect(r).toEqual({ deny: 'back one level' })
  expect(f.ui().inputFocused).toBe(false)
  await clock.settle()
  expect(f.calls).toEqual(['open', 'focus row:a'])
})

test('an expanded row closes and the ring goes to the focus key, else home', async (_$, on) => {
  const clock = setup(on)
  const keep = fakeHandles<V, Row, Scn>(clock, { ...UI0, expandedKey: 'row:a', focusKey: 'act:d' }, WORLD0)
  const r = await closeHook(keep.k, press('person'), fakeNext().next, NAV)
  expect(r).toEqual({ deny: 'back one level' })
  expect(keep.ui().expandedKey).toBe('')
  await clock.settle()
  expect(keep.calls).toEqual(['open', 'focus act:d'])
  const none = fakeHandles<V, Row, Scn>(clock, { ...UI0, expandedKey: 'row:a' }, WORLD0)
  await closeHook(none.k, press('person'), fakeNext().next, NAV)
  await clock.settle()
  expect(none.calls).toEqual(['open', 'focus row:a'])
})

test('a view goes back one level and the ring goes to the new home', async (_$, on) => {
  const clock = setup(on)
  const f = fakeHandles<V, Row, Scn>(clock, { ...UI0, view: 'detail', cameFrom: 'list', sel: 'b' }, WORLD0)
  const n = fakeNext()
  const r = await closeHook(f.k, press('person'), n.next, NAV)
  expect(r).toEqual({ deny: 'back one level' })
  expect(f.ui().view).toBe('list')
  expect(f.ui().confirm).toBe(null)
  expect(f.ui().expandedKey).toBe('')
  expect(f.ui().editing).toBe(false)
  expect(f.ui().picking).toBe('')
  expect(f.ui().inputFocused).toBe(false)
  expect(n.seen.count).toBe(0)
  expect(f.calls).toEqual(['open'])
  await clock.advance(79)
  expect(f.calls).toEqual(['open'])
  await clock.advance(1)
  expect(f.calls).toEqual(['open', 'focus row:b'])
})

test('the top level closes the pane: next runs once and the pane redraws', async (_$, on) => {
  const clock = setup(on)
  const f = fakeHandles<V, Row, Scn>(clock, UI0, WORLD0)
  const n = fakeNext()
  const r = await closeHook(f.k, press('person'), n.next, NAV)
  expect(r).toEqual({ value: undefined })
  expect(n.seen.count).toBe(1)
  expect(f.calls).toEqual(['invalidate'])
  expect(f.ui().inputFocused).toBe(false)
})

test('the top level returns the result of next, a deny too', async (_$, on) => {
  const clock = setup(on)
  const f = fakeHandles<V, Row, Scn>(clock, UI0, WORLD0)
  const n = fakeNext({ deny: 'another hook says no' })
  const r = await closeHook(f.k, press('person'), n.next, NAV)
  expect(r).toEqual({ deny: 'another hook says no' })
  expect(f.calls).toEqual(['invalidate'])
})
