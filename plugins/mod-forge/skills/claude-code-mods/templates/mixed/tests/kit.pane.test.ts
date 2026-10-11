import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { UiOpenResult } from 'claude-code'
import type { Handles, UiState, World } from '../hooks/kit/types'
import { closeIfOpen, isOpen, openPane } from '../hooks/kit/pane'
import { fakeHandles } from './kit/fake'

type V = 'list' | 'detail'
type R = { id: string }
type S = 'normal'

const NOW = 1_000_000
const UI0: UiState<V> = { view: 'detail', cameFrom: 'list', sel: 'b', confirm: { kind: 'delete', id: 'b' }, notice: null, focusKey: '', inputFocused: true, editing: true, picking: 'pick:x', expandedKey: '' }
const WORLD0: World<R, S> = { variant: 'A', scenario: 'normal', run: 1, loaded: true, rows: [], error: '', banner: '', busy: null, lastAction: null, epoch: 0, failsLeft: 0 }

// The clock and the six engine stubs that every kit test registers (decisions A1).
function setup($: Parameters<TestBody>[0], on: Parameters<TestBody>[1], ui0: UiState<V> = UI0) {
  const clock = mock.clock(on, { now: NOW })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  return fakeHandles<V, R, S>(clock, ui0, WORLD0)
}

// Count each write to the ui cell, to see when openPane writes and when it does not.
function counted(k: Handles<V, R, S>): { k: Handles<V, R, S>; writes: () => number } {
  let n = 0
  return { k: { ...k, ui: { get: k.ui.get, set: f => { n += 1; return k.ui.set(f) } } }, writes: () => n }
}

test('openPane sets the view, resets the transient fields and opens', async ($, on) => {
  const f = setup($, on)
  const r = await openPane(f.k, { view: 'list' })
  expect(r.isPlaced).toBe(true)
  expect(f.calls).toEqual(['open', 'invalidate'])
  expect(f.ui().view).toBe('list')
  expect(f.ui().confirm).toBe(null)
  expect(f.ui().editing).toBe(false)
  expect(f.ui().inputFocused).toBe(false)
  expect(f.ui().picking).toBe('')
})

test('openPane keeps the selection and the drafts', async ($, on) => {
  const f = setup($, on)
  await f.k.drafts.set(() => ({ 'a:msg': 'hi' }))
  await openPane(f.k, { view: 'list' })
  expect(f.ui().sel).toBe('b')
  expect(f.drafts()).toEqual({ 'a:msg': 'hi' })
})

test('openPane writes only when one field differs', async ($, on) => {
  const quiet: UiState<V> = { ...UI0, view: 'list', confirm: null, editing: false, inputFocused: false, picking: '' }
  const f = setup($, on, quiet)
  const c = counted(f.k)
  await openPane(c.k, { view: 'list' })
  expect(c.writes()).toBe(0)
  expect(f.calls).toEqual(['open', 'invalidate'])
  await openPane(c.k, { view: 'detail' })
  expect(c.writes()).toBe(1)
  expect(f.ui().view).toBe('detail')
})

test('openPane without a patch resets the transient fields only', async ($, on) => {
  const f = setup($, on)
  await openPane(f.k)
  expect(f.ui().view).toBe('detail')
  expect(f.ui().confirm).toBe(null)
  expect(f.ui().picking).toBe('')
})

test('openPane gives back the engine answer when the pane waits', async ($, on) => {
  const f = setup($, on)
  const waits: UiOpenResult = { isPlaced: false, reason: 'terminal too narrow' }
  const r = await openPane({ ...f.k, open: async () => waits }, { view: 'list' })
  expect(r).toEqual(waits)
})

test('isOpen follows the engine pane list', async ($, on) => {
  const f = setup($, on)
  expect(await isOpen(f.k)).toBe(false)
  f.setOpen(true)
  expect(await isOpen(f.k)).toBe(true)
  f.setOpen(false)
  expect(await isOpen(f.k)).toBe(false)
})

test('closeIfOpen closes an open pane and draws again', async ($, on) => {
  const f = setup($, on)
  f.setOpen(true)
  await closeIfOpen(f.k)
  expect(f.calls).toEqual(['close', 'invalidate'])
  expect(await isOpen(f.k)).toBe(false)
})

test('closeIfOpen only draws again when the pane is closed', async ($, on) => {
  const f = setup($, on)
  await closeIfOpen(f.k)
  expect(f.calls).toEqual(['invalidate'])
})
