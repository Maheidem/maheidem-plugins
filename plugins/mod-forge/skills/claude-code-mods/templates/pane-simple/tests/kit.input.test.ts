// Kit tests for hooks/kit/input.tsx: the key, the draft, the submit and the blank guard.
// Two ways to draw. A mount through a test hook proves the tree, the key and the props
// against the engine. A test hook cannot receive engine input (the engine gives ui.input
// to the hooks of a plugin). So the handler tests draw with a stub Input that keeps its
// props, and call onInput and onSubmit as the engine does.
import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { clearTyping } from '../hooks/kit/drafts'
import { ctx } from '../hooks/kit/ctx'
import { draftInput } from '../hooks/kit/input'
import type { DraftInputOpts } from '../hooks/kit/input'
import type { Ui, UiState, World } from '../hooks/kit/types'
import { fakeHandles } from './kit/fake'

type View = 'list' | 'add'
type Row = { id: string }
type Scenario = 'normal'
type Seen = { props: { key: string; value: string; placeholder?: string; submitLabel?: string; autoFocus?: true; onInput: (v: string) => void; onSubmit: (v: string) => void } }

const NOW = new Date(2026, 9, 9, 18, 47).getTime()
const PANE = 'kit-input-test'
const PROPS = { title: 'Rows', isFocused: true, bodyColumns: 63, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as const
const UI0: UiState<View> = { view: 'add', cameFrom: 'list', sel: '', confirm: null, notice: null, focusKey: '', inputFocused: false, editing: false, picking: '', expandedKey: '' }
const WORLD0: World<Row, Scenario> = { variant: 'A', scenario: 'normal', run: 0, loaded: true, rows: [], error: '', banner: '', busy: null, lastAction: null, epoch: 0, failsLeft: 0 }

// The clock is REQUIRED: the kit reads time through it. The six ui.* hooks are stubbed
// so that no call reaches the engine.
async function setup($: Parameters<TestBody>[0], on: Parameters<TestBody>[1], opts?: Partial<DraftInputOpts>) {
  const clock = mock.clock(on, { now: NOW })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }) as never)
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  clearTyping()
  const f = fakeHandles<View, Row, Scenario>(clock, UI0, WORLD0)
  const sent: string[] = []
  const all: DraftInputOpts = { name: 'compose', draftKey: 'compose', placeholder: 'Write a note', submitLabel: 'Send', onSubmit: v => { sent.push(v) }, ...opts }
  // Draw with the stub Input and return what it received.
  const stub = { Input: (p: unknown) => ({ type: 'Input', props: p, children: [] }) } as unknown as Ui
  const draw = async (): Promise<Seen> => draftInput(await ctx(f.k, stub, PROPS), all) as unknown as Seen
  // Draw with the engine's elements through a test hook, and mount it.
  on('ui.render', { component: 'Pane', requestId: PANE }, async (h, e) => draftInput(await ctx(f.k, h.ui.resolve(e as never) as never, e.props), all))
  const mount = () => $.ui.mount({ plugin: 'kit-test', surface: 'terminal', component: 'Pane', requestId: PANE, props: PROPS })
  return { clock, f, sent, draw, mount }
}

test('mount: the Input key is in:compose#0 with the placeholder and the submit label', async ($, on) => {
  const { mount } = await setup($, on)
  const ui = await mount()
  const input = await ui.find({ type: 'Input' })
  expect(input?.key).toBe('in:compose#0')
  expect(input?.props.placeholder).toBe('Write a note')
  expect(input?.props.submitLabel).toBe('Send')
  expect(input?.props.autoFocus).toBeUndefined()
  expect(input?.props.value).toBe('')
  await ui.unmount()
})

test('mount: the saved draft, the fallback and autoFocus show', async ($, on) => {
  const { f, mount } = await setup($, on, { autoFocus: true, fallback: 'start' })
  const ui = await mount()
  expect((await ui.find({ type: 'Input' }))?.props.value).toBe('start')
  expect((await ui.find({ type: 'Input' }))?.props.autoFocus).toBe(true)
  await f.k.drafts.set(() => ({ compose: 'saved' }))
  await ui.redraw()
  expect((await ui.find({ type: 'Input' }))?.props.value).toBe('saved')
  await ui.unmount()
})

test('typing then 300 ms shows the draft in the field', async ($, on) => {
  const { clock, f, draw } = await setup($, on)
  const el = await draw()
  expect(el.props.key).toBe('in:compose#0')
  el.props.onInput('abc')
  await clock.advance(300)
  expect(f.drafts()).toEqual({ compose: 'abc' })
  expect((await draw()).props.value).toBe('abc')
})

test('a submit calls onSubmit and keeps the draft', async ($, on) => {
  const { clock, f, sent, draw } = await setup($, on)
  const el = await draw()
  el.props.onSubmit('hello')
  await clock.settle()
  expect(sent).toEqual(['hello'])
  expect(f.drafts()).toEqual({ compose: 'hello' })
  // The engine empties the field after Enter and reports a change. The draft stays.
  el.props.onInput('')
  await clock.advance(300)
  expect(f.drafts()).toEqual({ compose: 'hello' })
  expect((await draw()).props.value).toBe('hello')
})

test('a blank submit calls nothing', async ($, on) => {
  const { clock, f, sent, draw } = await setup($, on)
  const el = await draw()
  el.props.onSubmit('   ')
  await clock.settle()
  expect(sent).toEqual([])
  expect(f.drafts()).toEqual({})
})

test('a blank submit passes through when the mod asks for it', async ($, on) => {
  const { clock, sent, draw } = await setup($, on, { blank: 'submit' })
  const el = await draw()
  el.props.onSubmit('')
  await clock.settle()
  expect(sent).toEqual([''])
})

test('a new epoch gives a new key, and the kept draft shows', async ($, on) => {
  const { clock, f, draw } = await setup($, on)
  const el = await draw()
  el.props.onSubmit('kept')
  await clock.settle()
  await f.k.world.set(() => ({ epoch: 1 }))
  const next = await draw()
  expect(next.props.key).toBe('in:compose#1')
  expect(next.props.value).toBe('kept')
})

test('while an action runs, typing and a submit change nothing', async ($, on) => {
  const { clock, f, sent, draw } = await setup($, on, { blank: 'submit' })
  await f.k.drafts.set(() => ({ compose: 'foxtrot six' }))
  await f.k.world.set(() => ({ busy: { kind: 'add', id: 'a', text: 'foxtrot six' } }))
  const el = await draw()
  // The engine empties the field after Enter, then the person types two keys.
  el.props.onInput('')
  el.props.onInput('ZZ')
  el.props.onSubmit('')
  await clock.advance(300)
  expect(f.drafts()).toEqual({ compose: 'foxtrot six' })
  expect(sent).toEqual([])
  // The save failed: the new epoch mounts the field again with the kept text.
  await f.k.world.set(() => ({ busy: null, epoch: 1 }))
  const next = await draw()
  expect(next.props.key).toBe('in:compose#1')
  expect(next.props.value).toBe('foxtrot six')
})
