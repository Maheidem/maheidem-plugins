// Kit tests for hooks/kit/drafts.ts: the typing buffer, the saved drafts, the submit guard.
// The handles are the in-memory fakes of ./kit/fake. The waits sit on the mock clock.
import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { clearTyping, draftValue, onSubmitted, onType, setDraft } from '../hooks/kit/drafts'
import { ctx } from '../hooks/kit/ctx'
import type { Ui, UiState, World } from '../hooks/kit/types'
import { fakeHandles } from './kit/fake'

type View = 'list' | 'add'
type Row = { id: string }
type Scenario = 'normal'

const NOW = new Date(2026, 9, 9, 18, 47).getTime()
const PROPS = { title: 'Rows', bodyColumns: 63, scroll: { bodyRows: 40 } } as const
const UI0: UiState<View> = { view: 'list', cameFrom: 'list', sel: '', confirm: null, notice: null, focusKey: '', inputFocused: false, editing: false, picking: '', expandedKey: '' }
const WORLD0: World<Row, Scenario> = { variant: 'A', scenario: 'normal', run: 0, loaded: true, rows: [], error: '', banner: '', busy: null, lastAction: null, epoch: 0, failsLeft: 0 }

// The clock is REQUIRED: the kit reads time through it. The six ui.* hooks are stubbed
// so that no call reaches the engine.
function setup($: Parameters<TestBody>[0], on: Parameters<TestBody>[1]) {
  const clock = mock.clock(on, { now: NOW })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }) as never)
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  clearTyping()
  return { clock, f: fakeHandles<View, Row, Scenario>(clock, UI0, WORLD0) }
}

test('onType writes the draft 300 ms after the last key', async ($, on) => {
  const { clock, f } = setup($, on)
  onType(f.k, 'a:msg', 'hi')
  await clock.advance(299)
  expect(f.drafts()).toEqual({})
  await clock.advance(1)
  expect(f.drafts()).toEqual({ 'a:msg': 'hi' })
})

test('two fast values write only the last one', async ($, on) => {
  const { clock, f } = setup($, on)
  onType(f.k, 'a:msg', 'h')
  await clock.advance(100)
  onType(f.k, 'a:msg', 'hi')
  await clock.advance(200)
  expect(f.drafts()).toEqual({})
  await clock.advance(100)
  expect(f.drafts()).toEqual({ 'a:msg': 'hi' })
})

test('an empty value after a submit keeps the draft', async ($, on) => {
  const { clock, f } = setup($, on)
  await setDraft(f.k, 'a:msg', 'hello')
  onSubmitted('a:msg')
  onType(f.k, 'a:msg', '')
  await clock.advance(300)
  expect(f.drafts()).toEqual({ 'a:msg': 'hello' })
  // The guard works once. The next empty value is a real edit.
  onType(f.k, 'a:msg', '')
  await clock.advance(300)
  expect(f.drafts()).toEqual({ 'a:msg': '' })
})

test('setDraft with null removes the key and the typing buffer', async ($, on) => {
  const { clock, f } = setup($, on)
  await setDraft(f.k, 'a:msg', 'hello')
  await setDraft(f.k, 'b:msg', 'keep')
  expect(f.drafts()).toEqual({ 'a:msg': 'hello', 'b:msg': 'keep' })
  onType(f.k, 'a:msg', 'typed')
  await setDraft(f.k, 'a:msg', null)
  expect(f.drafts()).toEqual({ 'b:msg': 'keep' })
  await clock.advance(300)
  // The buffer is gone, so the timer writes nothing back.
  expect(f.drafts()).toEqual({ 'b:msg': 'keep' })
  const c = await ctx(f.k, {} as Ui, PROPS)
  expect(draftValue(c, 'a:msg')).toBe('')
})

test('draftValue reads the buffer, then the draft, then the fallback', async ($, on) => {
  const { clock, f } = setup($, on)
  let c = await ctx(f.k, {} as Ui, PROPS)
  expect(draftValue(c, 'a:msg')).toBe('')
  expect(draftValue(c, 'a:msg', 'start')).toBe('start')
  await setDraft(f.k, 'a:msg', 'saved')
  c = await ctx(f.k, {} as Ui, PROPS)
  expect(draftValue(c, 'a:msg', 'start')).toBe('saved')
  onType(f.k, 'a:msg', 'typing')
  expect(draftValue(c, 'a:msg', 'start')).toBe('typing')
  await clock.advance(300)
})

test('clearTyping drops the buffer and the submit marks', async ($, on) => {
  const { clock, f } = setup($, on)
  onType(f.k, 'a:msg', 'typing')
  onSubmitted('b:msg')
  clearTyping()
  const c = await ctx(f.k, {} as Ui, PROPS)
  expect(draftValue(c, 'a:msg')).toBe('')
  // The submit mark is gone: an empty value is a real edit now.
  await setDraft(f.k, 'b:msg', 'x')
  onType(f.k, 'b:msg', '')
  await clock.advance(300)
  expect(f.drafts()['b:msg']).toBe('')
})
