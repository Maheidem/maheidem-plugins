import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import { mobileNote } from '../hooks/kit/states'
import { flat } from './kit/flat'

// Pane props for a mount: an inline pane, 80 columns, 12 body rows.
const PROPS = { title: 'Items', isFocused: true, bodyColumns: 80, placement: 'inline', scroll: { offset: 0, bodyRows: 12 }, view: {} } as const
// $.command.run in a test needs origin and presentation (references/api.md 12a).
const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 150 } } as const
const PANE = { plugin: 'mixed', surface: 'terminal', component: 'Pane', requestId: 'mixed', props: PROPS } as const
// The band mounts with its own props: a survey flag and the room it has.
const BAND = { plugin: 'mixed', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 100, scroll: { offset: 0, bodyRows: 6 }, view: {} } } as const
const SURVEY = { ...BAND, props: { ...BAND.props, hasSurvey: true } } as const
const BASE = 'This pane needs the terminal' // the text of the stub below: the hook yielded
const NOW = new Date(2026, 9, 9, 18, 47).getTime()
const OPEN_PANE = { id: 'mixed', title: 'Items', isShown: true, isFocused: true, isPlaced: true } as const

// The clock and the stubs for the engine beneath the plugin. Register them before the first $ call.
// `panes` is what ui.panes answers: [] = the pane is closed. `opens` counts the ui.open calls.
// `shown` records what the mod shows outside the pane: 'log <text>' and 'toast <text>'.
function stubs(on: Parameters<TestBody>[1], panes: readonly (typeof OPEN_PANE)[] = []) {
  const clock = mock.clock(on, { now: NOW })
  const opens = { n: 0 }
  const shown: string[] = []
  on('ui.open', () => { opens.n += 1; return { value: { isPlaced: true } } })
  on('ui.close', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: panes }))
  on('ui.toast', (_$, e) => { shown.push(`toast ${e.text}`); return { value: undefined } })
  on('ui.log', (_$, e) => { shown.push(`log ${e.text}`); return { value: undefined } })
  on('ui.invalidate', () => ({ value: undefined }))
  // What the engine draws when the band hook or the output hook yields. Any element serves; this one has a fixed text (BASE).
  on('ui.render', { component: 'AbovePrompt' }, (h, e) => mobileNote(h.ui.resolve(e)))
  on('ui.render', { component: 'CommandOutput' }, (h, e) => mobileNote(h.ui.resolve(e)))
  return { clock, opens, shown }
}

// ---- the pane ----------------------------------------------------------------------

// One line per list scenario: the text that only that scenario's start screen shows.
const START: Array<[string, RegExp]> = [
  ['normal', /4 items/],
  ['empty', /No items yet|no items/],
  ['loading', /Loading items/],
  ['error', /could not be read/],
  ['overflow', /60 items/],
  ['save-fails', /4 items/],
  ['guarded', /4 items/],
]

// A test for each list scenario: every variant draws the start screen of that scenario.
for (const [scn, text] of START) {
  test(`${scn}: every variant draws the start screen`, async ($, on) => {
    stubs(on)
    for (const v of ['A', 'B', 'C', 'D']) {
      await $.command.run({ ...RUN, command: 'mixed', args: `${v} ${scn}` })
      const ui = await $.ui.mount(PANE)
      expect(flat(await ui.drawn())).toMatch(text)
      await ui.unmount()
    }
  })
}

test('d asks to delete, n keeps the row', async ($, on) => {
  const { clock } = stubs(on)
  await $.command.run({ ...RUN, command: 'mixed', args: 'C normal' })
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'act:d' })
  await clock.settle()
  expect(flat(await ui.drawn())).toContain('Delete this item?')
  await ui.press({ key: 'confirm:no' })
  await clock.settle()
  expect(flat(await ui.drawn())).not.toContain('Delete this item?')
  await ui.unmount()
})

// ---- the band ----------------------------------------------------------------------

// One line per band scenario: the text that only that scenario's band shows. "quiet" has no band.
const BANDS: Array<[string, RegExp | null]> = [
  ['one-waiting', /Rename the staging bucket/],
  ['many', /3 items need input|Needs input: 3 items/],
  ['failed', /build host/],
  ['working', /2 items working|Working: 2 items/],
  ['quiet', null],
]

// A test for each band scenario, every variant: the band draws its line, or yields (quiet).
for (const [scn, text] of BANDS) {
  test(`${scn}: every variant draws the band line`, async ($, on) => {
    stubs(on)
    for (const v of ['A', 'B', 'C', 'D']) {
      await $.command.run({ ...RUN, command: 'mixed', args: `${v} ${scn} closed` })
      const band = await $.ui.mount(BAND)
      const drawn = flat(await band.drawn())
      if (text) {
        expect(drawn).toMatch(text)
        expect(drawn).toContain('ctrl+x tab to open')
      } else expect(drawn).toContain(BASE)
      await band.unmount()
    }
  })
}

test('a list scenario has no band: no item needs you', async ($, on) => {
  stubs(on)
  await $.command.run({ ...RUN, command: 'mixed', args: 'C normal closed' })
  const band = await $.ui.mount(BAND)
  expect(flat(await band.drawn())).toContain(BASE)
  await band.unmount()
})

test('the band yields to a survey', async ($, on) => {
  stubs(on)
  await $.command.run({ ...RUN, command: 'mixed', args: 'C one-waiting closed' })
  const band = await $.ui.mount(SURVEY)
  expect(flat(await band.drawn())).toContain(BASE)
  await band.unmount()
})

test('the band stays quiet while the pane is open', async ($, on) => {
  stubs(on, [OPEN_PANE])
  await $.command.run({ ...RUN, command: 'mixed', args: 'C one-waiting' })
  const band = await $.ui.mount(BAND)
  expect(flat(await band.drawn())).toContain(BASE)
  await band.unmount()
})

test('the band stays quiet before any scenario ran', async ($, on) => {
  stubs(on)
  const band = await $.ui.mount(BAND)
  expect(flat(await band.drawn())).toContain(BASE)
  await band.unmount()
})

// Delete the selected item through the pane: d asks, y confirms, the fixture action runs 1.5 s.
async function deleteSelected(ui: { press: (p: { key: string }) => Promise<unknown> }, clock: ReturnType<typeof mock.clock>): Promise<void> {
  await ui.press({ key: 'act:d' })
  await clock.settle()
  await ui.press({ key: 'confirm:yes' })
  await clock.advance(1500)
  await clock.settle()
}

test('Open selects the item the band names and opens the pane twice', async ($, on) => {
  const { clock, opens } = stubs(on)
  await $.command.run({ ...RUN, command: 'mixed', args: 'C many' })
  // Delete the first item: the band now names the second one, and the selection still sits on the first row.
  const first = await $.ui.mount(PANE)
  await deleteSelected(first, clock)
  await first.unmount()
  const before = opens.n
  const band = await $.ui.mount(BAND)
  expect(flat(await band.drawn())).toContain('Book the team room')
  await band.press({ key: 'band:open' })
  await clock.advance(150)
  await clock.settle()
  expect(opens.n - before).toBe(2) // proven on 2.1.296 (SB:458-465); the reason is unknown
  const pane = await $.ui.mount(PANE)
  expect(flat(await pane.drawn())).toContain('❯ ? Book the team room')
  await pane.unmount()
  await band.unmount()
})

test('a delete takes the item out and the band names the next one', async ($, on) => {
  const { clock } = stubs(on)
  await $.command.run({ ...RUN, command: 'mixed', args: 'C one-waiting' })
  const pane = await $.ui.mount(PANE)
  await deleteSelected(pane, clock)
  expect(flat(await pane.drawn())).toContain('Deleted: Rename the staging bucket')
  await pane.unmount()
  const band = await $.ui.mount(BAND)
  expect(flat(await band.drawn())).toMatch(/1 item working/)
  await band.unmount()
})

// ---- the toast ---------------------------------------------------------------------

test('the working scenario: the first item asks after 8 s, with a log line and a toast while the pane is closed', async ($, on) => {
  const { clock, shown } = stubs(on)
  await $.command.run({ ...RUN, command: 'mixed', args: 'C working closed' })
  const band = await $.ui.mount(BAND)
  expect(flat(await band.drawn())).toContain('2 items working')
  expect(shown).toEqual([])
  await clock.advance(8000)
  await clock.settle()
  expect(flat(await band.drawn())).toContain('Fix the flaky login test needs input')
  expect(shown).toEqual(['log ! Fix the flaky login test asks: Keep the old test data?', 'toast ! Fix the flaky login test asks: Keep the old test data?'])
  await band.unmount()
})

test('the working scenario: an open pane shows the news itself, so no toast', async ($, on) => {
  const { clock, shown } = stubs(on, [OPEN_PANE])
  await $.command.run({ ...RUN, command: 'mixed', args: 'C working' })
  await clock.advance(8000)
  await clock.settle()
  expect(shown).toEqual(['log ! Fix the flaky login test asks: Keep the old test data?'])
})

test('a new scenario stops the timer of the old one', async ($, on) => {
  const { clock, shown } = stubs(on)
  await $.command.run({ ...RUN, command: 'mixed', args: 'C working closed' })
  await $.command.run({ ...RUN, command: 'mixed', args: 'C quiet closed' })
  await clock.advance(8000)
  await clock.settle()
  expect(shown).toEqual([])
})

// ---- the guard ---------------------------------------------------------------------

// The stub for the tool beneath the plugin. It records each command that reaches the tool,
// so a refused call leaves the record empty.
function tool(on: Parameters<TestBody>[1]) {
  const ran: string[] = []
  on('tool.call', { tool: 'Bash' }, (_$, e) => { ran.push(e.command); return { result: 'ok' } })
  return ran
}

test('recursive rm is refused before the tool runs', async ($, on) => {
  const ran = tool(on)
  for (const command of ['rm -rf build', 'rm -fr build', 'rm -r -f build', 'sudo rm -Rf build', 'rm --recursive build', 'ls && rm -rf build']) {
    const r = await $.tool.call({ tool: 'Bash', command })
    expect(r.deny, command).toMatch(/^mixed: recursive rm is refused here/)
  }
  expect(ran).toEqual([])
})

test('a forced push is refused, a lease push passes', async ($, on) => {
  const ran = tool(on)
  for (const command of ['git push --force', 'git push origin main -f']) {
    const r = await $.tool.call({ tool: 'Bash', command })
    expect(r.deny, command).toMatch(/^mixed: a forced push is refused here/)
  }
  const ok = await $.tool.call({ tool: 'Bash', command: 'git push --force-with-lease' })
  expect(ok.deny).toBeUndefined()
  expect(ran).toEqual(['git push --force-with-lease'])
})

test('a clean command reaches the tool unchanged', async ($, on) => {
  const ran = tool(on)
  for (const command of ['ls -la', 'rm old.log', 'echo "rm -rf x"', 'grep -r rm src', 'git push origin main']) {
    const r = await $.tool.call({ tool: 'Bash', command })
    expect(r.deny, command).toBeUndefined()
  }
  expect(ran).toEqual(['ls -la', 'rm old.log', 'echo "rm -rf x"', 'grep -r rm src', 'git push origin main'])
})

test('fail closed: a rule that throws refuses the call', async ($, on) => {
  const ran = tool(on)
  // A command that is not a string makes judge() throw. Without the .catch the call would go through.
  const r = await $.tool.call({ tool: 'Bash', command: 7 as never })
  expect(r.deny).toMatch(/^mixed: its rules failed/)
  expect(ran).toEqual([])
})

// ---- the command -------------------------------------------------------------------

test('guarded: the reply holds the refusal and no tool runs', async ($, on) => {
  stubs(on)
  const ran = tool(on)
  const r = await $.command.run({ ...RUN, command: 'mixed', args: 'C guarded' })
  expect(r.text).toMatch(/^Scenario C guarded\n✓ Refused: mixed: recursive rm is refused here/)
  expect(ran).toEqual([])
})

test('the reply names the scenario, a plain reopen keeps it', async ($, on) => {
  stubs(on)
  expect(await $.command.run({ ...RUN, command: 'mixed', args: 'C normal' })).toEqual({ text: 'Scenario C normal' })
  expect(await $.command.run({ ...RUN, command: 'mixed', args: '' })).toEqual({ text: 'Scenario kept' })
})

// The output row as the engine mounts it: the command, its arguments and the text the command answered.
function row(args: string, text: string, isErrored = false) {
  return { plugin: 'mixed', surface: 'terminal', component: 'CommandOutput', props: { command: 'mixed', args, text, isErrored } } as const
}

test('the output row draws the reply: a dim first line, a green ok line, a red err line', async ($, on) => {
  stubs(on)
  const text = 'Scenario C guarded\n✓ Refused: mixed: recursive rm is refused here\n✕ A line that failed'
  const ui = await $.ui.mount(row('C guarded', text))
  expect(flat(await ui.drawn())).toBe(text)
  const texts = await ui.findAll({ type: 'Text' })
  expect(texts.find(t => t.text === 'Scenario C guarded')?.props.dimColor).toBe(true)
  expect(texts.find(t => t.text?.startsWith('✓ Refused'))?.props.color).toBe('success')
  expect(texts.find(t => t.text === '✕ A line that failed')?.props.color).toBe('error')
  await ui.unmount()
})

test('the row of an error and the row of another command stay the engine row', async ($, on) => {
  stubs(on)
  const bad = await $.ui.mount(row('C normal', 'boom', true))
  expect(flat(await bad.drawn())).toContain(BASE)
  await bad.unmount()
  const other = await $.ui.mount({ ...row('', 'text'), props: { command: 'other', args: '', text: 'text', isErrored: false } })
  expect(flat(await other.drawn())).toContain(BASE)
  await other.unmount()
})

test('a bad argument gives the usage line and changes nothing', async ($, on) => {
  stubs(on)
  await $.command.run({ ...RUN, command: 'mixed', args: 'C one-waiting closed' })
  for (const args of ['Z nothing', 'C nothing', 'C normal extra']) {
    const out = await $.command.run({ ...RUN, command: 'mixed', args })
    expect(JSON.stringify(out)).toContain('Usage: /mixed <A|B|C|D> [normal|')
  }
  const band = await $.ui.mount(BAND)
  expect(flat(await band.drawn())).toContain('Rename the staging bucket') // the world of the good run is still there
  await band.unmount()
})
