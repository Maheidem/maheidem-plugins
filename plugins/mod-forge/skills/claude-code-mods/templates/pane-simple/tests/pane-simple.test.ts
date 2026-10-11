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
import { COUNT, OVERFLOW, fixture } from '../hooks/fixtures' // @proto

// Pane props for a mount: an inline pane, 80 columns, 12 body rows.
const PROPS = { title: TEXT.title, isFocused: true, bodyColumns: 80, placement: 'inline', scroll: { offset: 0, bodyRows: 12 }, view: {} } as const
const MOUNT = { plugin: 'pane-simple', surface: 'terminal', component: 'Pane', requestId: 'pane-simple', props: PROPS } as const
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
const OVER = SCENARIOS.find(s => ROLE[s] === 'overflow') // the overflow test runs only when the domain has one

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
      await $.command.run({ ...RUN, command: 'pane-simple', args: `${v} ${scn}` })
      const ui = await $.ui.mount(MOUNT)
      expect(flat(await ui.drawn())).toContain(startText(ROLE[scn]))
      await ui.unmount()
    }
  })
}

if (OVER) {
  test('the newest row is the last one, and the oldest row is not drawn when the list overflows', async ($, on) => {
    stubs(on)
    await $.command.run({ ...RUN, command: 'pane-simple', args: `C ${OVER}` })
    const ui = await $.ui.mount(MOUNT)
    const text = flat(await ui.drawn())
    expect(text).toMatch(/↑ \d+ more/)
    expect(text).toContain(titleOf(fixture(COUNT)[0]!))
    // The hidden rows are the oldest. Titles can repeat in a domain, so the test counts the "more" line and never looks for one title.
    const more = Number(/↑ (\d+) more/.exec(text)?.[1])
    expect(more).toBeGreaterThan(0)
    expect(more).toBeLessThan(OVERFLOW)
    await ui.unmount()
  })
}

// @action-refresh:begin
if (ACTIONS.refresh) {
  test('the refresh key shows on the list and reads the rows again', async ($, on) => {
    const clock = stubs(on)
    await $.command.run({ ...RUN, command: 'pane-simple', args: `C ${NORMAL}` })
    const ui = await $.ui.mount(MOUNT)
    expect(flat(await ui.drawn())).toContain(`${ACTIONS.refresh?.key}: ${ACTIONS.refresh?.verb}`)
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
    await $.command.run({ ...RUN, command: 'pane-simple', args: `C ${NORMAL}` })
    const ui = await $.ui.mount(MOUNT)
    await ui.press({ key: key('clear') })
    await clock.advance(ACTION_MS)
    await clock.settle()
    expect(flat(await ui.drawn())).toContain(TEXT.empty)
    await ui.unmount()
  })
}
// @action-clear:end

test('a bad argument gives the usage line', async ($, on) => {
  stubs(on)
  const out = await $.command.run({ ...RUN, command: 'pane-simple', args: 'Z nothing' })
  expect(JSON.stringify(out)).toContain('Usage: /pane-simple')
})
// @proto:end
