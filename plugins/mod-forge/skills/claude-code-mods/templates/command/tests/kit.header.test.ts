// Kit tests for header.tsx: the header line and the rule.
// Copy target: tests/kit.header.test.ts, next to tests/kit/fake.ts and tests/kit/flat.ts.
import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { RenderElement } from 'claude-code'

import { ctx } from '../hooks/kit/ctx'
import { header, rule } from '../hooks/kit/header'
import type { Ctx, UiState, World } from '../hooks/kit/types'
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

// Mount one piece: the test draws the pane itself, so no mod code is needed.
async function mountPiece($: Parameters<TestBody>[0], on: Parameters<TestBody>[1], make: (c: C) => RenderElement) {
  const clock = mock.clock(on, { now: NOW })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  const fake = fakeHandles<V, Row, Sc>(clock, UI0, W0)
  on('ui.render', { component: 'Pane', requestId: 'kit-test' }, async (h, e) => {
    if (e.surface === 'mobile' || e.surface === 'vscode') throw new Error('kit test draws on the terminal only')
    return make(await ctx(fake.k, h.ui.resolve(e), e.props))
  })
  return $.ui.mount({ plugin: 'kit-test', surface: 'terminal', component: 'Pane', requestId: 'kit-test', props: PROPS })
}

test('header: top level reads title, dot, subject', async ($, on) => {
  const ui = await mountPiece($, on, c => header(c, '4 notes'))
  expect(flat(await ui.drawn())).toBe('Rows · 4 notes')
  await ui.unmount()
})

test('header: a screen inside the pane uses the arrow', async ($, on) => {
  const ui = await mountPiece($, on, c => header(c, 'Call the vendor', { inside: true }))
  const text = flat(await ui.drawn())
  expect(text).toContain('Rows › ')
  expect(text).toBe('Rows › Call the vendor')
  await ui.unmount()
})

test('header: one Text is bold, and it is the subject', async ($, on) => {
  const ui = await mountPiece($, on, c => header(c, '4 notes', {
    inside: true, tone: 'warn', glyph: { text: '!', tone: 'warn' }, tail: { text: 'needs input', tone: 'warn' },
  }))
  const bold = (await ui.findAll({ type: 'Text' })).filter(t => t.props.bold === true)
  expect(bold).toHaveLength(1)
  expect(bold[0]?.text).toBe('4 notes')
  await ui.unmount()
})

test('header: the line truncates and the title is dim', async ($, on) => {
  const ui = await mountPiece($, on, c => header(c, 'x'))
  const texts = await ui.findAll({ type: 'Text' })
  expect(texts[0]?.props.wrap).toBe('truncate-end')
  const title = texts.find(t => t.text === 'Rows · ')
  expect(title?.props.dimColor).toBe(true)
  await ui.unmount()
})

test('header: glyph and tail follow the subject order', async ($, on) => {
  const ui = await mountPiece($, on, c => header(c, 'worker', {
    inside: true, glyph: { text: '✓', tone: 'ok' }, tail: { text: 'done', tone: 'ok' },
  }))
  expect(flat(await ui.drawn())).toBe('Rows › ✓ worker · done')
  const texts = await ui.findAll({ type: 'Text' })
  const glyph = texts.find(t => t.text === '✓ ')
  expect(glyph?.props.color).toBe('success')
  expect(glyph?.props.bold).toBeUndefined()
  const tail = texts.find(t => t.text === 'done')
  expect(tail?.props.color).toBe('success')
  expect(texts.find(t => t.text === ' · ')?.props.dimColor).toBe(true)
  await ui.unmount()
})

test('header: the tone colours the subject; a tail without tone is dim', async ($, on) => {
  const ui = await mountPiece($, on, c => header(c, "Can't read rows", { tone: 'warn', tail: { text: '3 failed' } }))
  const texts = await ui.findAll({ type: 'Text' })
  const subject = texts.find(t => t.text === "Can't read rows")
  expect(subject?.props.color).toBe('warning')
  expect(subject?.props.bold).toBe(true)
  const tail = texts.find(t => t.text === '3 failed')
  expect(tail?.props.color).toBeUndefined()
  expect(tail?.props.dimColor).toBe(true)
  await ui.unmount()
})

test('header: a muted tone draws dim, not a colour', async ($, on) => {
  const ui = await mountPiece($, on, c => header(c, 'Ended', { tone: 'muted', glyph: { text: '·', tone: 'muted' }, tail: { text: 'old', tone: 'muted' } }))
  const texts = await ui.findAll({ type: 'Text' })
  for (const t of ['Ended', '· ', 'old']) {
    const el = texts.find(x => x.text === t)
    expect(el?.props.color).toBeUndefined()
    expect(el?.props.dimColor).toBe(true)
  }
  await ui.unmount()
})

test('header: no tail and no glyph draw no extra text', async ($, on) => {
  const ui = await mountPiece($, on, c => header(c, 'Rows list'))
  // The line, the dim title and the subject: nothing else.
  expect(await ui.findAll({ type: 'Text' })).toHaveLength(3)
  expect(flat(await ui.drawn())).toBe('Rows · Rows list')
  await ui.unmount()
})

test('rule: the line is the pane width wide', async ($, on) => {
  const ui = await mountPiece($, on, c => rule(c))
  expect(flat(await ui.drawn())).toBe('─'.repeat(62))
  const line = await ui.find({ type: 'Text' })
  expect(line?.props.dimColor).toBe(true)
  expect(line?.props.wrap).toBe('truncate-end')
  await ui.unmount()
})

test('rule: a given width wins', async ($, on) => {
  const ui = await mountPiece($, on, c => rule(c, 10))
  expect(flat(await ui.drawn())).toBe('─'.repeat(10))
  await ui.unmount()
})

test('rule: a width of zero still draws one dash', async ($, on) => {
  const ui = await mountPiece($, on, c => rule(c, 0))
  expect(flat(await ui.drawn())).toBe('─')
  await ui.unmount()
})

test('rule: it follows a redraw at a new width', async ($, on) => {
  const ui = await mountPiece($, on, c => rule(c))
  await ui.redraw({ ...PROPS, bodyColumns: 41 })
  expect(flat(await ui.drawn())).toBe('─'.repeat(40))
  await ui.unmount()
})
