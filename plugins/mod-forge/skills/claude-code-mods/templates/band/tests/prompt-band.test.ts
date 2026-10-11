// The tests of the band and of its pane. Every text comes from ../hooks/domain and ../hooks/fixtures: no literal of the domain lives here.
// The lines and blocks that carry the proto tag run the command with a variant and a scenario: mods.py build removes them.
// A block that starts with if (ACTIONS.<kind>) keeps this file green when the domain has no such action.
import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import { mobileNote } from '../hooks/kit/states'
import { flat } from './kit/flat'
import { TEXT } from '../hooks/domain'
import { ACTIONS, ROLE, SCENARIOS, VARIANTS, bandSegs, marked, titleOf } from '../hooks/domain' // @proto
import type { ActionKind } from '../hooks/domain' // @proto
import { ACTION_MS } from '../hooks/kit/defaults' // @proto
import { worldFor } from '../hooks/fixtures' // @proto

// Pane props for a mount: an inline pane, 80 columns, 12 body rows.
const PROPS = { title: TEXT.title, isFocused: true, bodyColumns: 80, placement: 'inline', scroll: { offset: 0, bodyRows: 12 }, view: {} } as const
const PANE = { plugin: 'prompt-band', surface: 'terminal', component: 'Pane', requestId: 'prompt-band', props: PROPS } as const
// The band mounts with its own props: a survey flag, a turn flag and the room it has.
const BAND = { plugin: 'prompt-band', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 100, scroll: { offset: 0, bodyRows: 6 }, view: {} } } as const
const BASE = 'This pane needs the terminal' // the text of the stub below: the band yielded
const NOW = new Date(2026, 9, 9, 18, 47).getTime()

// The clock and the stubs for the engine beneath the plugin. Register them before the first $ call.
// `opens` counts the ui.open calls. What ui.panes answers is a parameter: [] = the pane is closed.
function stubs(on: Parameters<TestBody>[1], panes: readonly { id: string; title: string; isShown: true; isFocused: true; isPlaced: true }[] = []) {
  const clock = mock.clock(on, { now: NOW })
  const opens = { n: 0 }
  on('ui.open', () => { opens.n += 1; return { value: { isPlaced: true } } })
  on('ui.close', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: panes }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  // What the engine draws when the band hook yields. Any element serves; this one has a fixed text (BASE).
  on('ui.render', { component: 'AbovePrompt' }, (h, e) => mobileNote(h.ui.resolve(e)))
  return { clock, opens }
}

// Before any read the band yields. This holds for the prototype and for the real mod.
test('the band stays quiet before any scenario ran', async ($, on) => {
  stubs(on)
  const band = await $.ui.mount(BAND)
  expect(flat(await band.drawn())).toContain(BASE)
  await band.unmount()
})

// @proto:begin
// $.command.run in a test needs origin and presentation (references/api.md 12a).
const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 150 } } as const
const key = (kind: ActionKind): string => `act:${ACTIONS[kind]?.key ?? ''}`
const NORMAL = (SCENARIOS.find(s => ROLE[s] === 'normal') ?? SCENARIOS[0])! // the first scenario with the role normal
const OPEN_PANE = { id: 'prompt-band', title: TEXT.title, isShown: true, isFocused: true, isPlaced: true } as const
const parts = (s: (typeof SCENARIOS)[number]): string[] => bandSegs(worldFor(s, 0)).map(p => p.text)

// A test for each scenario, every variant: the band draws its parts, or yields (no part, no turn).
for (const scn of SCENARIOS) {
  test(`${scn}: every variant draws the band line`, async ($, on) => {
    stubs(on)
    for (const v of VARIANTS) {
      await $.command.run({ ...RUN, command: 'prompt-band', args: `${v} ${scn} closed` })
      const band = await $.ui.mount(BAND)
      const drawn = flat(await band.drawn())
      if (parts(scn).length === 0 || ROLE[scn] === 'idle' || ROLE[scn] === 'loading') expect(drawn).toContain(BASE)
      else {
        for (const text of parts(scn)) expect(drawn).toContain(text)
        expect(drawn).toContain('ctrl+x tab to open')
      }
      await band.unmount()
    }
  })
}

test('the band yields to a survey', async ($, on) => {
  stubs(on)
  await $.command.run({ ...RUN, command: 'prompt-band', args: `C ${NORMAL} closed` })
  const band = await $.ui.mount({ ...BAND, props: { ...BAND.props, hasSurvey: true } })
  expect(flat(await band.drawn())).toContain(BASE)
  await band.unmount()
})

test('the band stays quiet while the pane is open', async ($, on) => {
  stubs(on, [OPEN_PANE])
  await $.command.run({ ...RUN, command: 'prompt-band', args: `C ${NORMAL}` })
  const band = await $.ui.mount(BAND)
  expect(flat(await band.drawn())).toContain(BASE)
  await band.unmount()
})

test('Open selects the first row and opens the pane twice', async ($, on) => {
  const { clock, opens } = stubs(on)
  await $.command.run({ ...RUN, command: 'prompt-band', args: `C ${NORMAL} closed` })
  const before = opens.n
  const band = await $.ui.mount(BAND)
  await band.press({ key: 'band:open' })
  await clock.advance(150)
  await clock.settle()
  expect(opens.n - before).toBe(2) // proven on 2.1.296 (SB:458-465); the reason is unknown
  const pane = await $.ui.mount(PANE)
  const selected = flat(await pane.drawn()).split('\n').find(line => line.includes('❯'))
  expect(selected).toContain(titleOf(worldFor(NORMAL, 0).rows[0]!))
  await pane.unmount()
  await band.unmount()
})

// @action-mark:begin
if (ACTIONS.mark) {
  test('the mark key marks the row and the band counts it', async ($, on) => {
    const { clock } = stubs(on)
    await $.command.run({ ...RUN, command: 'prompt-band', args: `C ${NORMAL}` })
    const pane = await $.ui.mount(PANE)
    await pane.press({ key: key('mark') })
    await clock.advance(ACTION_MS)
    await clock.settle()
    expect(flat(await pane.drawn())).toContain(TEXT.doneMark)
    await pane.unmount()
    const w = worldFor(NORMAL, 0)
    const after = bandSegs({ ...w, rows: w.rows.map((r, i) => (i === 0 ? marked(r) : r)) }).map(p => p.text)
    const band = await $.ui.mount(BAND)
    const drawn = flat(await band.drawn())
    for (const text of after) expect(drawn).toContain(text)
    await band.unmount()
  })
}
// @action-mark:end

// @action-refresh:begin
if (ACTIONS.refresh) {
  test('the refresh key of the band reads the rows again', async ($, on) => {
    const { clock } = stubs(on)
    await $.command.run({ ...RUN, command: 'prompt-band', args: `C ${NORMAL} closed` })
    const band = await $.ui.mount(BAND)
    expect(flat(await band.drawn())).toContain(`${ACTIONS.refresh?.key}: ${ACTIONS.refresh?.verb}`)
    await band.press({ key: `band:${ACTIONS.refresh?.key}` })
    await clock.advance(ACTION_MS)
    await clock.settle()
    const pane = await $.ui.mount(PANE)
    expect(flat(await pane.drawn())).toContain(TEXT.doneRefresh)
    await pane.unmount()
    await band.unmount()
  })
}
// @action-refresh:end

test('a bad argument gives the usage line', async ($, on) => {
  stubs(on)
  const out = await $.command.run({ ...RUN, command: 'prompt-band', args: 'Z nothing' })
  expect(JSON.stringify(out)).toContain('Usage: /prompt-band')
})
// @proto:end
