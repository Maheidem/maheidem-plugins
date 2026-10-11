// Tests for kit/band.tsx. bandQuiet and openFromBand run on fake handles.
// bandRow runs through a mount: the test hook draws the AbovePrompt band itself, so no mod code is needed.
import { expect, mock, test } from 'claude-code/testing'
import { bandQuiet, bandRow, openFromBand } from '../hooks/kit/band'
import type { UiState, World } from '../hooks/kit/types'
import { fakeHandles } from './kit/fake'
import { flat } from './kit/flat'

type V = 'list' | 'detail'
type Row = { id: string }
type S = 'normal'
const NOW = new Date(2026, 9, 9, 18, 47).getTime()
const UI0: UiState<V> = { view: 'list', cameFrom: 'list', sel: 'a', confirm: null, notice: null, focusKey: '', inputFocused: false, editing: false, picking: '', expandedKey: '' }
const WORLD0: World<Row, S> = { variant: 'A', scenario: 'normal', run: 1, loaded: true, rows: [], error: '', banner: '', busy: null, lastAction: null, epoch: 0, failsLeft: 0 }
const QUIET = { hasSurvey: false } as const

test('bandQuiet is true for a survey, an unloaded world, run 0 and an open pane', async (_$, on) => {
  const clock = mock.clock(on, { now: NOW })
  const f = fakeHandles<V, Row, S>(clock, { ...UI0 }, { ...WORLD0 })
  expect(await bandQuiet(f.k, QUIET, f.world())).toBe(false)
  expect(await bandQuiet(f.k, { hasSurvey: true }, f.world())).toBe(true)
  expect(await bandQuiet(f.k, QUIET, { ...WORLD0, loaded: false })).toBe(true)
  expect(await bandQuiet(f.k, QUIET, { ...WORLD0, run: 0 })).toBe(true)
  f.setOpen(true)
  expect(await bandQuiet(f.k, QUIET, f.world())).toBe(true)
  f.setOpen(false)
  expect(await bandQuiet(f.k, QUIET, f.world())).toBe(false)
})

test('openFromBand opens twice, 150 ms apart, then focuses the key', async (_$, on) => {
  const clock = mock.clock(on, { now: NOW })
  const f = fakeHandles<V, Row, S>(clock, { ...UI0, confirm: { kind: 'del', id: 'a' }, editing: true, inputFocused: true }, { ...WORLD0 })
  const done = openFromBand(f.k, { view: 'list', sel: 'b' }, 'row:b')
  await clock.settle()
  expect(f.calls).toEqual(['open', 'invalidate'])
  expect(f.ui()).toMatchObject({ view: 'list', sel: 'b', confirm: null, editing: false, inputFocused: false })
  await clock.advance(149)
  expect(f.calls).toEqual(['open', 'invalidate'])
  await clock.advance(1)
  await done
  expect(f.calls).toEqual(['open', 'invalidate', 'open', 'focus row:b'])
})

test('openFromBand with an empty focus key does not focus', async (_$, on) => {
  const clock = mock.clock(on, { now: NOW })
  const f = fakeHandles<V, Row, S>(clock, { ...UI0 }, { ...WORLD0 })
  const done = openFromBand(f.k, { view: 'detail' }, '')
  await clock.advance(150)
  await done
  expect(f.calls).toEqual(['open', 'invalidate', 'open'])
  expect(f.ui().view).toBe('detail')
})

test('the band draws the open Button with no hotkey', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.render', { component: 'AbovePrompt' }, (h, e) => bandRow(h.ui.resolve(e), 'Four notes waiting', () => undefined))
  const band = await $.ui.mount({ plugin: 'kit-test', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false } } as never)
  const button = await band.find({ key: 'band:open' })
  expect(button?.props?.hotkey).toBeUndefined()
  expect(flat(await band.drawn())).toContain('Four notes waiting')
  expect(flat(await band.drawn())).toContain('ctrl+x tab to open')
  await band.unmount()
  expect(clock.now()).toBe(NOW)
})

test('bandQuiet with idle yield is quiet while no model turn runs', async (_$, on) => {
  const clock = mock.clock(on, { now: NOW })
  const f = fakeHandles<V, Row, S>(clock, { ...UI0 }, { ...WORLD0 })
  expect(await bandQuiet(f.k, QUIET, f.world(), { idle: 'yield', working: false })).toBe(true)
  expect(await bandQuiet(f.k, { hasSurvey: false, isWorking: false }, f.world(), { idle: 'yield' })).toBe(true)
  expect(await bandQuiet(f.k, QUIET, f.world(), { idle: 'show' })).toBe(false)
  expect(await bandQuiet(f.k, QUIET, f.world())).toBe(false)
})

test('bandQuiet with idle yield is not quiet while a model turn runs', async (_$, on) => {
  const clock = mock.clock(on, { now: NOW })
  const f = fakeHandles<V, Row, S>(clock, { ...UI0 }, { ...WORLD0 })
  expect(await bandQuiet(f.k, QUIET, f.world(), { idle: 'yield', working: true })).toBe(false)
  expect(await bandQuiet(f.k, { hasSurvey: false, isWorking: true }, f.world(), { idle: 'yield' })).toBe(false)
  expect(await bandQuiet(f.k, { hasSurvey: false, isWorking: true }, f.world(), { idle: 'yield', working: false })).toBe(true)
  f.setOpen(true)
  expect(await bandQuiet(f.k, QUIET, f.world(), { idle: 'yield', working: true })).toBe(true)
})

test('bandRow with one key draws open before the key', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.render', { component: 'AbovePrompt' }, (h, e) => bandRow(h.ui.resolve(e), 'Four notes waiting', () => undefined, [{ hotkey: 'r', label: 'refresh', onPress: () => undefined }]))
  const band = await $.ui.mount({ plugin: 'kit-test', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false } } as never)
  const text = flat(await band.drawn())
  expect(text).toContain('ctrl+x tab to open')
  expect(text).toContain('r: refresh')
  expect(text.indexOf('open')).toBeLessThan(text.indexOf('r: refresh'))
  expect((await band.find({ key: 'band:open' }))?.props?.hotkey).toBeUndefined()
  expect((await band.find({ key: 'band:r' }))?.props?.hotkey).toBe('r')
  await band.unmount()
  expect(clock.now()).toBe(NOW)
})
