import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { UiState, World } from '../hooks/kit/types'
import { announce } from '../hooks/kit/toast'
import { fakeHandles } from './kit/fake'

type V = 'list'
type R = { id: string }
type S = 'normal'

const NOW = 1_000_000
const UI0: UiState<V> = { view: 'list', cameFrom: 'list', sel: '', confirm: null, notice: null, focusKey: '', inputFocused: false, editing: false, picking: '', expandedKey: '' }
const WORLD0: World<R, S> = { variant: 'A', scenario: 'normal', run: 1, loaded: true, rows: [], error: '', banner: '', busy: null, lastAction: null, epoch: 0, failsLeft: 0 }

// The clock and the six engine stubs that every kit test registers (decisions A1).
function setup($: Parameters<TestBody>[0], on: Parameters<TestBody>[1]) {
  const clock = mock.clock(on, { now: NOW })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  return fakeHandles<V, R, S>(clock, UI0, WORLD0)
}

test('announce logs and toasts while the pane is closed', async ($, on) => {
  const f = setup($, on)
  await announce(f.k, 'x')
  expect(f.calls).toEqual(['log x', 'toast x'])
})

test('announce only logs while the pane is open', async ($, on) => {
  const f = setup($, on)
  f.setOpen(true)
  await announce(f.k, 'x')
  expect(f.calls).toEqual(['log x'])
})

test('announce toasts again after the pane closes', async ($, on) => {
  const f = setup($, on)
  f.setOpen(true)
  await announce(f.k, 'one')
  f.setOpen(false)
  await announce(f.k, 'two')
  expect(f.calls).toEqual(['log one', 'log two', 'toast two'])
})
