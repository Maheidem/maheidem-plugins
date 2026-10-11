// The tests of the command. Every text comes from ../hooks/domain and ../hooks/fixtures: no literal of the domain lives here.
// The lines and blocks that carry the proto tag run the command with a scenario: mods.py build removes them.
// The guard part has its tests in its own block: mods.py new keeps it when the domain holds the part.
import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import { mobileNote } from '../hooks/kit/states'
import { flat } from './kit/flat'
import { TEXT } from '../hooks/domain' // @part-guard
import { inside, probe, proof } from '../hooks/rules' // @part-guard
import { ROLE, SCENARIOS, history } from '../hooks/domain' // @proto
import { fixtureRows } from '../hooks/fixtures' // @proto

const BASE = 'This pane needs the terminal or the desktop app.' // the text of the stub below: the hook yielded

// What the engine draws for the row when the hook yields. Any element serves; this one has a fixed text (BASE).
function stubs(on: Parameters<TestBody>[1]) {
  on('ui.render', { component: 'CommandOutput' }, (h, e) => mobileNote(h.ui.resolve(e)))
}

// The output row as the engine mounts it: the command, its arguments and the text the command answered.
function row(args: string, text: string, isErrored = false) {
  return { plugin: 'command-demo', surface: 'terminal', component: 'CommandOutput', props: { command: 'command-demo', args, text, isErrored } } as const
}

// A text with a head, an ok line, an err line and a plain line. The glyphs are the kit's tones.
const TEXT_OF_ROW = 'Head line\n✓ An ok line\n✕ An error line\n1. A plain line'

test('the row colours: a dim first line, a green ok line, a red err line, a plain rest', async ($, on) => {
  stubs(on)
  const ui = await $.ui.mount(row('', TEXT_OF_ROW))
  const texts = await ui.findAll({ type: 'Text' })
  expect(texts.find(t => t.text === 'Head line')?.props.dimColor).toBe(true)
  expect(texts.find(t => t.text === '✓ An ok line')?.props.color).toBe('success')
  expect(texts.find(t => t.text === '✕ An error line')?.props.color).toBe('error')
  expect(texts.find(t => t.text === '1. A plain line')?.props.color).toBeUndefined()
  expect(flat(await ui.drawn())).toBe(TEXT_OF_ROW)
  await ui.unmount()
})

test('the row draws on the desktop surface too', async ($, on) => {
  stubs(on)
  const ui = await $.ui.mount({ ...row('', TEXT_OF_ROW), surface: 'desktop' })
  expect(flat(await ui.drawn())).toBe(TEXT_OF_ROW)
  await ui.unmount()
})

test('the row of an error stays the engine row', async ($, on) => {
  stubs(on)
  const ui = await $.ui.mount(row('', 'boom', true))
  expect(flat(await ui.drawn())).toBe(BASE)
  await ui.unmount()
})

test('the row of another command stays the engine row', async ($, on) => {
  stubs(on)
  const ui = await $.ui.mount({ ...row('', 'text'), props: { command: 'other', args: '', text: 'text', isErrored: false } })
  expect(flat(await ui.drawn())).toBe(BASE)
  await ui.unmount()
})

// @proto:begin
// $.command.run in a test needs origin and presentation (references/api.md 12a).
const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 150 } } as const

// A test for each scenario that is not a probe: the command answers the head and the history, and the row draws the same lines.
for (const scn of SCENARIOS.filter(s => ROLE[s] !== 'deny')) {
  test(`${scn}: the command answers the history and the row draws it`, async ($, on) => {
    stubs(on)
    const text = [`Scenario A ${scn}`, ...history(fixtureRows(scn))].join('\n')
    const r = await $.command.run({ ...RUN, command: 'command-demo', args: `A ${scn}` })
    expect(r).toEqual({ text })
    const ui = await $.ui.mount(row(`A ${scn}`, text))
    expect(flat(await ui.drawn())).toBe(text)
    await ui.unmount()
  })
}

// @part-guard:begin
// A scenario with the role deny runs the probe through the guard.
for (const scn of SCENARIOS.filter(s => ROLE[s] === 'deny')) {
  test(`${scn}: the probe is refused and runs no tool`, async ($, on) => {
    stubs(on)
    const ran: string[] = []
    on('session.root', () => ({ value: '/work' }))
    on('tool.call', { tool: 'Bash' }, (_$, e) => { ran.push(e.command); return { result: 'ok' } })
    const r = await $.command.run({ ...RUN, command: 'command-demo', args: `A ${scn}` })
    expect(r.text).toMatch(new RegExp(`^✓ ${TEXT.refused}: recursive rm is refused here`))
    expect(r.text).not.toContain('command-demo')
    expect(ran).toEqual([])
  })
}
// @part-guard:end

test('a second run starts again from the fixture: the history does not grow', async ($, on) => {
  stubs(on)
  const args = `A ${SCENARIOS[0] ?? 'normal'}`
  const first = await $.command.run({ ...RUN, command: 'command-demo', args })
  const second = await $.command.run({ ...RUN, command: 'command-demo', args })
  expect(second).toEqual(first)
})

test('a bad scenario word, a bad variant and no argument get the usage line', async ($, on) => {
  stubs(on)
  for (const args of ['A nothing', 'Z normal', '', 'A normal extra']) {
    const r = await $.command.run({ ...RUN, command: 'command-demo', args })
    expect(r.text).toMatch(/^Usage: \/command-demo <A>/)
  }
})
// @proto:end

// @part-guard:begin
// The guard holds in the real mod too: it judges each Bash command before the tool runs.
test('the guard refuses the probe before the tool runs, and a clean command passes', async ($, on) => {
  const ran: string[] = []
  on('session.root', () => ({ value: '/work' }))
  on('tool.call', { tool: 'Bash' }, (_$, e) => { ran.push(e.command); return { result: 'ok' } })
  const refused = await $.tool.call({ tool: 'Bash', command: probe() })
  expect(refused.deny).toMatch(/^command-demo: recursive rm is refused here/)
  expect(ran).toEqual([])
  const clean = await $.tool.call({ tool: 'Bash', command: 'ls -la' })
  expect(clean.deny).toBeUndefined()
  expect(ran).toEqual(['ls -la'])
})

test('inside(): a path in the session folder is inside, the rest is outside', () => {
  for (const p of ['src/a.ts', './build', '/work/build', '/work', '"build/x"', 'a/../b']) expect(inside(p, '/work'), p).toBe(true)
  for (const p of ['/workshop', '/etc/hosts', '../x', 'src/../../x', '~/x', '$HOME/x', '`pwd`/x', '/mod-fixture-missing-dir']) expect(inside(p, '/work'), p).toBe(false)
})

test('proof(): the reply shows the plugin name once', async () => {
  expect(await proof(async () => ({ deny: 'my-mod: x' }))).toBe(`✓ ${TEXT.refused}: x`)
  expect(await proof(async () => ({ deny: 'y' }))).toBe(`✓ ${TEXT.refused}: y`)
  expect(await proof(async () => ({}))).toMatch(/^✕ The probe was NOT refused: /)
})
// @part-guard:end
