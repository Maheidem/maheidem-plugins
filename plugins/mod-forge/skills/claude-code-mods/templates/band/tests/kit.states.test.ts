// Kit tests for states.tsx: the loading, empty and error views and the mobile note.
// Copy target: tests/kit.states.test.ts, next to tests/kit/fake.ts and tests/kit/flat.ts.
import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { RenderElement } from 'claude-code'

import { ctx } from '../hooks/kit/ctx'
import { emptyView, errorView, loadingView, mobileNote } from '../hooks/kit/states'
import type { Ctx, KeySpec, UiState, World } from '../hooks/kit/types'
import { fakeHandles } from './kit/fake'
import { flat } from './kit/flat'

type V = 'list' | 'detail'
type Row = { id: string }
type Sc = 'normal'
type C = Ctx<V, Row, Sc>

const NOW = new Date(2026, 9, 9, 18, 47).getTime()
const UI0: UiState<V> = { view: 'list', cameFrom: 'list', sel: '', confirm: null, notice: null, focusKey: '', inputFocused: false, editing: false, picking: '', expandedKey: '' }
const W0: World<Row, Sc> = { variant: 'A', scenario: 'normal', run: 0, loaded: true, rows: [], error: '', banner: '', busy: null, lastAction: null, epoch: 0, failsLeft: 0 }
// The docked pane at 150 x 45: about 63 body columns, so the kit's `cols` is 62.
const PROPS = { title: 'Rows', isFocused: true, bodyColumns: 63, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as const
const MOBILE_LINE = 'This pane needs the terminal or the desktop app.'
const ADD: KeySpec = { hotkey: 'a', label: 'add', onPress: () => undefined }
const RETRY: KeySpec = { hotkey: 'r', label: 'retry', onPress: () => undefined }

type Opts = { surface?: 'terminal' | 'mobile' | 'vscode'; ui?: Partial<UiState<V>>; world?: Partial<World<Row, Sc>> }

// Mount one view: the test draws the pane itself, so no mod code is needed.
// The handler returns the mobile note on `mobile` and `vscode`, as a mod does (hard rule 27).
async function mountView($: Parameters<TestBody>[0], on: Parameters<TestBody>[1], make: (c: C) => RenderElement, o: Opts = {}) {
  const clock = mock.clock(on, { now: NOW })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  const fake = fakeHandles<V, Row, Sc>(clock, { ...UI0, ...o.ui }, { ...W0, ...o.world })
  on('ui.render', { component: 'Pane', requestId: 'kit-test' }, async (h, e) => {
    if (e.surface === 'mobile' || e.surface === 'vscode') return mobileNote(h.ui.resolve(e))
    return make(await ctx(fake.k, h.ui.resolve(e), e.props))
  })
  return $.ui.mount({ plugin: 'kit-test', surface: o.surface ?? 'terminal', component: 'Pane', requestId: 'kit-test', props: PROPS })
}

test('loadingView: header, what loads and the close hint', async ($, on) => {
  const ui = await mountView($, on, c => loadingView(c, 'notes'))
  const text = flat(await ui.drawn())
  expect(text).toContain('Loading…')
  expect(text).toContain('Loading notes…')
  expect(text).toContain('Esc to close')
  expect(text).toBe('Rows · Loading…\nLoading notes…\nEsc to close')
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
  await ui.unmount()
})

test('loadingView: the header subject is the only bold span and the body is dim', async ($, on) => {
  const ui = await mountView($, on, c => loadingView(c, 'notes'))
  const bold = (await ui.findAll({ type: 'Text' })).filter(t => t.props.bold === true)
  expect(bold.map(t => t.text)).toEqual(['Loading…'])
  const body = (await ui.findAll({ type: 'Text' })).find(t => t.text === 'Loading notes…')
  expect(body?.props.dimColor).toBe(true)
  await ui.unmount()
})

test('every view is a column the width of the pane', async ($, on) => {
  const ui = await mountView($, on, c => loadingView(c, 'notes'))
  const root = await ui.find({ type: 'Box' }) // the outermost Box first
  expect(root?.props.flexDirection).toBe('column')
  expect(root?.props.width).toBe(62)
  await ui.unmount()
})

test('emptyView: subject, each line and the action row', async ($, on) => {
  const ui = await mountView($, on, c => emptyView(c, { subject: 'No notes yet', lines: ['You have no notes.', 'Add one to start.'], keys: [ADD] }))
  const text = flat(await ui.drawn())
  expect(text).toContain('No notes yet')
  expect(text).toContain('You have no notes.')
  expect(text).toContain('Add one to start.')
  expect(text).toContain('a: add')
  expect(text).toContain('Esc to close')
  expect(text).toBe('Rows · No notes yet\nYou have no notes.\nAdd one to start.\na: add\nEsc to close')
  const add = await ui.find({ key: 'act:a' })
  expect(add?.type).toBe('Button')
  await ui.unmount()
})

test('emptyView: no keys draws only the hint row, and each line is dim', async ($, on) => {
  const ui = await mountView($, on, c => emptyView(c, { subject: 'No notes yet', lines: ['One.', 'Two.'] }))
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
  const texts = await ui.findAll({ type: 'Text' })
  expect(texts.find(t => t.text === 'One.')?.props.dimColor).toBe(true)
  expect(texts.find(t => t.text === 'Two.')?.props.dimColor).toBe(true)
  await ui.unmount()
})

test('emptyView: a notice sits between the lines and the footer', async ($, on) => {
  const ui = await mountView($, on, c => emptyView(c, { subject: 'No notes yet', lines: ['You have no notes.'], keys: [ADD] }), {
    ui: { notice: { id: 1, tone: 'err', text: "✕ Couldn't save" } },
  })
  const text = flat(await ui.drawn())
  expect(text).toBe('Rows · No notes yet\nYou have no notes.\n✕ Couldn\'t save\n  Esc to dismiss\na: add')
  // The notice row takes Esc, so the footer drops its Esc hint.
  expect(text).not.toContain('Esc to close')
  await ui.unmount()
})

test('errorView: glyph and message, hint, retry key', async ($, on) => {
  const ui = await mountView($, on, c => errorView(c, { subject: "Can't read notes", message: 'The data folder is missing.', hint: 'Press r to try again.', keys: [RETRY] }))
  const text = flat(await ui.drawn())
  expect(text).toContain('✕ The data folder is missing.')
  expect(text).toContain('Press r to try again.')
  expect(text).toContain('r: retry')
  expect(text).toBe("Rows · Can't read notes\n✕ The data folder is missing.\n  Press r to try again.\nr: retry\nEsc to close")
  await ui.unmount()
})

test('errorView: warn header, error colour and a dim hint', async ($, on) => {
  const ui = await mountView($, on, c => errorView(c, { subject: "Can't read notes", message: 'It failed.', hint: 'Try again.' }))
  const texts = await ui.findAll({ type: 'Text' })
  const subject = texts.find(t => t.text === "Can't read notes")
  expect(subject?.props.bold).toBe(true)
  expect(subject?.props.color).toBe('warning')
  const message = texts.find(t => t.text === '✕ It failed.')
  expect(message?.props.color).toBe('error')
  expect(message?.props.wrap).toBe('wrap')
  const hint = texts.find(t => t.text === '  Try again.')
  expect(hint?.props.dimColor).toBe(true)
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
  await ui.unmount()
})

test('errorView: the action row hides while an action runs', async ($, on) => {
  const ui = await mountView($, on, c => errorView(c, { subject: "Can't read notes", message: 'It failed.', hint: 'Try again.', keys: [RETRY] }), {
    world: { busy: { kind: 'save', id: 'a', text: 'Saving' } },
  })
  const text = flat(await ui.drawn())
  expect(text).not.toContain('r: retry')
  expect(text).toContain('Waiting for the result…')
  await ui.unmount()
})

test('mobileNote: mobile surface draws the one line', async ($, on) => {
  const ui = await mountView($, on, c => loadingView(c, 'notes'), { surface: 'mobile' })
  expect(flat(await ui.drawn())).toContain(MOBILE_LINE)
  expect(flat(await ui.drawn())).toBe(MOBILE_LINE)
  await ui.unmount()
})

test('mobileNote: vscode surface draws the one line', async ($, on) => {
  const ui = await mountView($, on, c => loadingView(c, 'notes'), { surface: 'vscode' })
  expect(flat(await ui.drawn())).toContain(MOBILE_LINE)
  const line = await ui.find({ type: 'Text' })
  expect(line?.props.dimColor).toBe(true)
  await ui.unmount()
})
