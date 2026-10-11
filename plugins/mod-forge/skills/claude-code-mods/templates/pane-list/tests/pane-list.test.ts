// The tests of the screens. Every text comes from ../hooks/domain and ../hooks/fixtures: no literal of the domain lives here.
// The lines and blocks that carry the proto tag run the command with a variant and a scenario: mods.py build removes them.
// A block that starts with if (ACTIONS.<kind>) keeps this file green when the domain has no such action.
import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import { flat } from './kit/flat'
import { TEXT } from '../hooks/domain'
import { ACTIONS, ROLE, SCENARIOS, VARIANTS, count, titleOf } from '../hooks/domain' // @proto
import type { ActionKind } from '../hooks/domain' // @proto
import { ACTION_MS } from '../hooks/kit/defaults' // @proto
import { cut } from '../hooks/kit/format' // @proto
import { COUNT, OVERFLOW, fixture } from '../hooks/fixtures' // @proto

// Pane props for a mount: an inline pane, 80 columns, 12 body rows.
const PROPS = { title: TEXT.title, isFocused: true, bodyColumns: 80, placement: 'inline', scroll: { offset: 0, bodyRows: 12 }, view: {} } as const
const MOUNT = { plugin: 'pane-list', surface: 'terminal', component: 'Pane', requestId: 'pane-list', props: PROPS } as const
const NOW = new Date(2026, 9, 9, 18, 47).getTime()

// The clock and the stubs for the engine beneath the plugin. The render needs the clock
// (the kit reads $.clock.now). Register them before the first $ call.
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

// Before any read the pane draws the loading screen. This holds for the prototype and for the real mod.
test('before any read the pane draws the loading screen', async ($, on) => {
  stubs(on)
  const ui = await $.ui.mount(MOUNT)
  expect(flat(await ui.drawn())).toContain(`Loading ${TEXT.loadingWhat}`)
  await ui.unmount()
})

// @proto:begin
// $.command.run in a test needs origin and presentation (references/api.md 12a).
const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 150 } } as const
const key = (kind: ActionKind): string => `act:${ACTIONS[kind]?.key ?? ''}`
const NORMAL = (SCENARIOS.find(s => ROLE[s] === 'normal') ?? SCENARIOS[0])! // the first scenario with the role normal

// The text that only the start screen of a role shows.
function startText(role: (typeof ROLE)[keyof typeof ROLE]): string {
  switch (role) {
    case 'empty': return TEXT.empty
    case 'loading': return `Loading ${TEXT.loadingWhat}`
    case 'error': return TEXT.error
    case 'overflow': return count(OVERFLOW)
    default: return count(COUNT)
  }
}

// A test for each scenario: every variant draws the start screen of that scenario.
for (const scn of SCENARIOS) {
  test(`${scn}: every variant draws the start screen`, async ($, on) => {
    stubs(on)
    for (const v of VARIANTS) {
      await $.command.run({ ...RUN, command: 'pane-list', args: `${v} ${scn}` })
      const ui = await $.ui.mount(MOUNT)
      expect(flat(await ui.drawn())).toContain(startText(ROLE[scn]))
      await ui.unmount()
    }
  })
}

test('the first row of a normal world is drawn with the pointer and its title', async ($, on) => {
  stubs(on)
  await $.command.run({ ...RUN, command: 'pane-list', args: `C ${NORMAL}` })
  const ui = await $.ui.mount(MOUNT)
  // The pointer line holds the title. A mark or a tag can stand between them.
  const pointed = flat(await ui.drawn()).split('\n').find(line => line.startsWith('❯ '))
  expect(pointed).toContain(titleOf(fixture(COUNT)[0]!))
  await ui.unmount()
})

// @action-delete:begin
if (ACTIONS.delete) {
  test('the delete key asks, cancel keeps the row', async ($, on) => {
    const clock = stubs(on)
    await $.command.run({ ...RUN, command: 'pane-list', args: `C ${NORMAL}` })
    const ui = await $.ui.mount(MOUNT)
    await ui.press({ key: key('delete') })
    await clock.settle()
    expect(flat(await ui.drawn())).toContain(TEXT.askDelete)
    await ui.press({ key: 'confirm:no' })
    await clock.settle()
    expect(flat(await ui.drawn())).not.toContain(TEXT.askDelete)
    await ui.unmount()
  })

  test('yes deletes the row and the notice says so', async ($, on) => {
    const clock = stubs(on)
    await $.command.run({ ...RUN, command: 'pane-list', args: `C ${NORMAL}` })
    const ui = await $.ui.mount(MOUNT)
    await ui.press({ key: key('delete') })
    await clock.settle()
    await ui.press({ key: 'confirm:yes' })
    await clock.advance(ACTION_MS)
    await clock.settle()
    expect(flat(await ui.drawn())).toContain(`${TEXT.doneDelete}: ${cut(titleOf(fixture(COUNT)[0]!), 30)}`)
    await ui.unmount()
  })
}
// @action-delete:end

// @action-add:begin
if (ACTIONS.add) {
  test('the add key opens the add view', async ($, on) => {
    const clock = stubs(on)
    await $.command.run({ ...RUN, command: 'pane-list', args: `C ${NORMAL}` })
    const ui = await $.ui.mount(MOUNT)
    await ui.press({ key: key('add') })
    await clock.settle()
    const text = flat(await ui.drawn())
    expect(text).toContain(TEXT.addTitle)
    expect(text).toContain(TEXT.addPlaceholder)
    await ui.unmount()
  })
}
// @action-add:end

// @action-refresh:begin
if (ACTIONS.refresh) {
  test('the refresh key reads the rows again and the notice says so', async ($, on) => {
    const clock = stubs(on)
    await $.command.run({ ...RUN, command: 'pane-list', args: `C ${NORMAL}` })
    const ui = await $.ui.mount(MOUNT)
    await ui.press({ key: key('refresh') })
    await clock.advance(ACTION_MS)
    await clock.settle()
    expect(flat(await ui.drawn())).toContain(TEXT.doneRefresh)
    await ui.unmount()
  })
}
// @action-refresh:end

// @action-clear:begin
if (ACTIONS.clear) {
  test('the clear key removes the rows', async ($, on) => {
    const clock = stubs(on)
    await $.command.run({ ...RUN, command: 'pane-list', args: `C ${NORMAL}` })
    const ui = await $.ui.mount(MOUNT)
    await ui.press({ key: key('clear') })
    await clock.advance(ACTION_MS)
    await clock.settle()
    expect(flat(await ui.drawn())).toContain(TEXT.empty)
    await ui.unmount()
  })
}
// @action-clear:end

// @action-mark:begin
if (ACTIONS.mark) {
  test('the mark key marks the selected row', async ($, on) => {
    const clock = stubs(on)
    await $.command.run({ ...RUN, command: 'pane-list', args: `C ${NORMAL}` })
    const ui = await $.ui.mount(MOUNT)
    await ui.press({ key: key('mark') })
    await clock.advance(ACTION_MS)
    await clock.settle()
    expect(flat(await ui.drawn())).toContain(TEXT.doneMark)
    await ui.unmount()
  })
}
// @action-mark:end

test('a bad argument gives the usage line', async ($, on) => {
  stubs(on)
  const out = await $.command.run({ ...RUN, command: 'pane-list', args: 'Z nothing' })
  expect(JSON.stringify(out)).toContain('Usage: /pane-list')
})
// @proto:end
