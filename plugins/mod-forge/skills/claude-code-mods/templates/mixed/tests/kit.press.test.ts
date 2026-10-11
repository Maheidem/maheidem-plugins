// Tests of kit/press.ts on fake handles. `next` answers `{ element }`, as the engine does beneath the hooks.
import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { Args, Next } from 'claude-code'

import { pressHook } from '../hooks/kit/press'
import type { Notice, UiState, World } from '../hooks/kit/types'
import { fakeHandles } from './kit/fake'

type Row = { id: string }
const NOW = new Date(2026, 9, 9, 18, 47).getTime()
const UI0: UiState<'list'> = { view: 'list', cameFrom: 'list', sel: '', confirm: null, notice: null, focusKey: '', inputFocused: false, editing: false, picking: '', expandedKey: '' }
const WORLD0: World<Row, 'normal'> = { variant: 'A', scenario: 'normal', run: 0, loaded: true, rows: [], error: '', banner: '', busy: null, lastAction: null, epoch: 0, failsLeft: 0 }
const ERR: Notice = { id: 1, tone: 'err', text: '✕ Failed' }

// The clock and the six host stubs under the plugin (decision A1).
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
const press = (element: string, requestId = 'kit-test') => ({ requestId, element, surface: 'terminal' }) as unknown as Args<'ui.press'>
function chain() {
  const landed: string[] = []
  const next = (async (e: Args<'ui.press'>) => { landed.push(e.element); return { element: e.element } }) as unknown as Next<'ui.press'>
  return { landed, next }
}

test('a press of another pane keeps the notice and calls next', async ($, on) => {
  const f = fakeHandles<'list', Row, 'normal'>(stubs(on), { ...UI0, notice: ERR }, WORLD0)
  const { landed, next } = chain()
  const r = await pressHook(f.k, press('row:a', 'other-pane'), next)
  expect(f.ui().notice).toEqual(ERR)
  expect(landed).toEqual(['row:a'])
  expect(r).toEqual({ element: 'row:a' })
})

test('a press clears a notice without a timer, then calls next', async ($, on) => {
  const f = fakeHandles<'list', Row, 'normal'>(stubs(on), { ...UI0, notice: ERR }, WORLD0)
  const { landed, next } = chain()
  const r = await pressHook(f.k, press('row:a'), next)
  expect(f.ui().notice).toBeNull()
  expect(landed).toEqual(['row:a'])
  expect(r).toEqual({ element: 'row:a' })
})

test('the retry key keeps the notice', async ($, on) => {
  const f = fakeHandles<'list', Row, 'normal'>(stubs(on), { ...UI0, notice: { ...ERR, retry: true } }, WORLD0)
  const { landed, next } = chain()
  await pressHook(f.k, press('act:retry'), next)
  await pressHook(f.k, press('act:r'), next)
  expect(f.ui().notice).toMatchObject({ tone: 'err', retry: true })
  expect(landed).toEqual(['act:retry', 'act:r'])
})

test('a timed notice and a warn notice stay', async ($, on) => {
  const f = fakeHandles<'list', Row, 'normal'>(stubs(on), { ...UI0, notice: { id: 1, tone: 'ok', text: '✓ Saved', clear: true } }, WORLD0)
  const { next } = chain()
  await pressHook(f.k, press('row:a'), next)
  expect(f.ui().notice).toMatchObject({ tone: 'ok', clear: true })
  await f.k.ui.set(() => ({ notice: { id: 2, tone: 'warn', text: '! Heads up' } }))
  await pressHook(f.k, press('row:a'), next)
  expect(f.ui().notice).toMatchObject({ tone: 'warn' })
})

test('a press while an action runs keeps the notice', async ($, on) => {
  const f = fakeHandles<'list', Row, 'normal'>(stubs(on), { ...UI0, notice: ERR }, { ...WORLD0, busy: { kind: 'save', id: 'a', text: 'Saving' } })
  const { landed, next } = chain()
  await pressHook(f.k, press('row:a'), next)
  expect(f.ui().notice).toEqual(ERR)
  expect(landed).toEqual(['row:a'])
})

test('a press with no notice changes nothing', async ($, on) => {
  const f = fakeHandles<'list', Row, 'normal'>(stubs(on), UI0, WORLD0)
  const { landed, next } = chain()
  await pressHook(f.k, press('row:a'), next)
  expect(f.ui()).toEqual(UI0)
  expect(landed).toEqual(['row:a'])
})
