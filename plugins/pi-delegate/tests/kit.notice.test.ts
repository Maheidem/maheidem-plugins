// Tests of kit/notice.tsx. Pure parts run on fake handles. The drawing runs through a mount:
// a test hook draws `noticeNodes(c, { onRetry })`, so no mod code is needed.
import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { ctx } from '../hooks/kit/ctx'
import { dismissable, noticeNodes, noticeRows, notify } from '../hooks/kit/notice'
import type { Ctx, Notice, Ui, UiState, World } from '../hooks/kit/types'
import { fakeHandles } from './kit/fake'

type Row = { id: string }
const NOW = new Date(2026, 9, 9, 18, 47).getTime()
const PROPS = { title: 'Rows', isFocused: true, bodyColumns: 63, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as const
const MOUNT = { plugin: 'kit-test', surface: 'terminal', component: 'Pane', requestId: 'kit-test', props: PROPS } as const
const UI0: UiState<'list'> = { view: 'list', cameFrom: 'list', sel: '', confirm: null, notice: null, focusKey: '', inputFocused: false, editing: false, picking: '', expandedKey: '' }
const WORLD0: World<Row, 'normal'> = { variant: 'A', scenario: 'normal', run: 0, loaded: true, rows: [], error: '', banner: '', busy: null, lastAction: null, epoch: 0, failsLeft: 0 }

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
const mkNotice = (n: Partial<Notice> & { tone: Notice['tone'] }): Notice => ({ id: 1, text: 'text', ...n })

// A Text drawn by the engine carries no `key`, so the tests find the notice Texts by their text.
// The test hook draws the notice rows. `seed` sets the cells of the fake handles; `retry: false`
// draws the notice with no onRetry. Call `cells(on, clock)` once, before the first $ call.
function cells(on: Parameters<TestBody>[1], clock: ReturnType<typeof stubs>) {
  const f = fakeHandles<'list', Row, 'normal'>(clock, UI0, WORLD0)
  let withRetry = true
  on('ui.render', { component: 'Pane', requestId: 'kit-test' }, async (h, e) => {
    if (e.surface === 'mobile' || e.surface === 'vscode') throw new Error('kit test draws on the terminal only')
    const c = await ctx(f.k, h.ui.resolve(e), e.props)
    return c.E.Box({ flexDirection: 'column', children: noticeNodes(c, withRetry ? { onRetry: () => undefined } : undefined) })
  })
  return async (u: Partial<UiState<'list'>>, w: Partial<World<Row, 'normal'>> = {}, retry = true): Promise<void> => {
    withRetry = retry
    await f.k.ui.set(() => ({ ...UI0, ...u }))
    await f.k.world.set(() => ({ ...WORLD0, ...w }))
  }
}

test('dismissable: only a notice without a timer and without the warn tone', async ($, on) => {
  stubs(on)
  expect(dismissable(null)).toBe(false)
  expect(dismissable(mkNotice({ tone: 'warn' }))).toBe(false)
  expect(dismissable(mkNotice({ tone: 'ok', clear: true }))).toBe(false)
  expect(dismissable(mkNotice({ tone: 'err' }))).toBe(true)
  expect(dismissable(mkNotice({ tone: 'muted' }))).toBe(true)
})

test('notify: a timed notice goes after 5 s, a plain notice stays', async ($, on) => {
  const clock = stubs(on)
  const f = fakeHandles<'list', Row, 'normal'>(clock, UI0, WORLD0)
  await notify(f.k, { tone: 'ok', text: '✓ Saved', clear: true })
  expect(f.ui().notice).toMatchObject({ tone: 'ok', text: '✓ Saved', id: NOW })
  await clock.advance(4999)
  expect(f.ui().notice).not.toBeNull()
  await clock.advance(1)
  expect(f.ui().notice).toBeNull()
  await notify(f.k, { tone: 'err', text: '✕ Failed' })
  await clock.advance(20000)
  expect(f.ui().notice).toMatchObject({ tone: 'err', text: '✕ Failed' })
  await notify(f.k, null)
  expect(f.ui().notice).toBeNull()
})

test('notify: a newer notice survives the timer of an older one', async ($, on) => {
  const clock = stubs(on)
  const f = fakeHandles<'list', Row, 'normal'>(clock, UI0, WORLD0)
  await notify(f.k, { tone: 'ok', text: 'first', clear: true })
  await clock.advance(2000)
  await notify(f.k, { tone: 'err', text: 'second' })
  await clock.advance(3000)
  expect(f.ui().notice).toMatchObject({ text: 'second', id: NOW + 2000 })
})

test('noticeRows: text, detail and the key row at 40 columns', async ($, on) => {
  const clock = stubs(on)
  const f = fakeHandles<'list', Row, 'normal'>(clock, UI0, WORLD0)
  const rows = (notice: Notice | null): number => {
    const c: Ctx<'list', Row, 'normal'> = { E: {} as Ui, k: f.k, title: 'Rows', now: NOW, cols: 40, rows: 40, u: { ...UI0, notice }, w: WORLD0, drafts: {} }
    return noticeRows(c)
  }
  expect(rows(null)).toBe(0)
  expect(rows(mkNotice({ tone: 'warn', text: 'a'.repeat(30) }))).toBe(1)
  expect(rows(mkNotice({ tone: 'warn', text: 'a'.repeat(30), detail: 'b'.repeat(50) }))).toBe(3)
  expect(rows(mkNotice({ tone: 'err', text: 'a'.repeat(30) }))).toBe(2)
  expect(rows(mkNotice({ tone: 'err', text: 'a'.repeat(30), detail: 'b'.repeat(50) }))).toBe(4)
  expect(rows(mkNotice({ tone: 'warn', text: 'a'.repeat(41) }))).toBe(2)
})

test('mount: tone colour, muted style, dismiss hint', async ($, on) => {
  const seed = cells(on, stubs(on))
  await seed({ notice: mkNotice({ tone: 'err', text: '✕ Could not save', detail: 'The disk is full.' }) })
  let ui = await $.ui.mount(MOUNT)
  expect((await ui.find({ type: 'Text', text: /Could not save/ }))?.props.color).toBe('error')
  expect((await ui.find({ type: 'Text', text: /disk is full/ }))?.text).toBe('  The disk is full.')
  expect(await ui.find({ text: /Esc to dismiss/ })).toBeDefined()
  await ui.unmount()
  await seed({ notice: mkNotice({ tone: 'muted', text: 'Nothing to show' }) })
  ui = await $.ui.mount(MOUNT)
  expect((await ui.find({ type: 'Text', text: /Nothing to show/ }))?.props).toMatchObject({ dimColor: true, italic: true })
  await ui.unmount()
  await seed({ notice: mkNotice({ tone: 'warn', text: '! Heads up' }) })
  ui = await $.ui.mount(MOUNT)
  expect((await ui.find({ type: 'Text', text: /Heads up/ }))?.props.color).toBe('warning')
  expect(await ui.find({ text: /Esc to dismiss/ })).toBeUndefined()
  expect(await ui.find({ key: 'n:keys' })).toBeUndefined()
  await ui.unmount()
})

test('mount: the retry key shows with retry, not without onRetry, while busy or confirming', async ($, on) => {
  const seed = cells(on, stubs(on))
  await seed({ notice: mkNotice({ tone: 'err', text: '✕ Failed', retry: true }) })
  let ui = await $.ui.mount(MOUNT)
  expect(await ui.find({ key: 'act:retry' })).toBeDefined()
  expect((await ui.find({ key: 'n:keys' }))?.text).toContain('retry')
  expect((await ui.find({ key: 'n:keys' }))?.text).toContain('Esc to dismiss')
  await ui.unmount()
  await seed({ notice: mkNotice({ tone: 'err', text: '✕ Failed' }) })
  ui = await $.ui.mount(MOUNT)
  expect(await ui.find({ key: 'act:retry' })).toBeUndefined()
  await ui.unmount()
  await seed({ notice: mkNotice({ tone: 'err', text: '✕ Failed', retry: true }) }, {}, false)
  ui = await $.ui.mount(MOUNT)
  expect(await ui.find({ key: 'act:retry' })).toBeUndefined()
  await ui.unmount()
  await seed({ notice: mkNotice({ tone: 'err', text: '✕ Failed', retry: true }) }, { busy: { kind: 'save', id: 'a', text: 'Saving' } })
  ui = await $.ui.mount(MOUNT)
  expect(await ui.find({ key: 'act:retry' })).toBeUndefined()
  await ui.unmount()
  await seed({ notice: mkNotice({ tone: 'err', text: '✕ Failed', retry: true }), confirm: { kind: 'del', id: 'a' } })
  ui = await $.ui.mount(MOUNT)
  expect(await ui.find({ key: 'act:retry' })).toBeUndefined()
  await ui.unmount()
})
