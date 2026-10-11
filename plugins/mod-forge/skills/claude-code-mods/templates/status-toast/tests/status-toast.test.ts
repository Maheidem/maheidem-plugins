// The tests of the observer. Every text comes from ../hooks/domain and ../hooks/fixtures: no literal of the domain lives here.
// The lines and blocks that carry the proto tag run the command with a scenario: mods.py build removes them.
// A part has its tests in its own block: mods.py new keeps the blocks of the parts that the domain holds.
import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import { KEEP, say } from '../hooks/domain'
import { announce, remember } from '../hooks/watch'
import type { Handles } from '../hooks/watch'
import type { Row } from '../types'
import { TEXT } from '../hooks/domain' // @part-guard
import { inside, probe, proof } from '../hooks/rules' // @part-guard
import { ROLE, SCENARIOS, history } from '../hooks/domain' // @proto
import { fixtureRows } from '../hooks/fixtures' // @proto

// The handles with a record: what the mod said, and what it kept. These tests hold for the prototype and for the real mod.
function fake() {
  const said: string[] = []
  let rows: Row[] = []
  const k: Handles = {
    seen: { get: async () => ({ rows }), set: async f => { rows = f({ rows }).rows ?? rows } },
    toast: t => { said.push(`toast ${t}`) }, log: t => { said.push(`log ${t}`) }, status: () => undefined,
  }
  return { k, said, kept: () => rows }
}

// A row with only its id: these tests check where a row goes, not its fields, so they hold for every domain.
const row = (i: number): Row => ({ id: `r${i}` }) as Row

test('announce says the row in the log and in the toast', () => {
  const { k, said } = fake()
  announce(k, row(0))
  expect(said).toEqual([`log ${say(row(0))}`, `toast ${say(row(0))}`])
})

test('remember keeps the last rows, oldest first', async () => {
  const { k, kept } = fake()
  for (let i = 0; i < KEEP + 2; i += 1) await remember(k, row(i))
  expect(kept().map(r => r.id)).toEqual(Array.from({ length: KEEP }, (_, i) => `r${i + 2}`))
})

// @proto:begin
// $.command.run in a test needs origin and presentation (references/api.md 12a).
const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 150 } } as const

// The stubs for the engine beneath the plugin. They record what the mod shows ('log <text>', 'toast <text>', 'status <text>')
// and each command that reaches the Bash tool.
function stubs(on: Parameters<TestBody>[1]) {
  const calls: string[] = []
  const ran: string[] = []
  on('ui.status', (_$, e) => { calls.push(`status ${e.text ?? ''}`); return { value: undefined } })
  on('ui.log', (_$, e) => { calls.push(`log ${e.text}`); return { value: undefined } })
  on('ui.toast', (_$, e) => { calls.push(`toast ${e.text}`); return { value: undefined } })
  on('session.root', () => ({ value: '/work' }))
  on('tool.call', { tool: 'Bash' }, (_$, e) => { ran.push(e.command); return { result: 'ok' } })
  return { calls, ran }
}

// A test for each scenario that has rows: each row reaches the log and the toast, and the reply names the scenario.
for (const scn of SCENARIOS.filter(s => fixtureRows(s).length > 0)) {
  test(`${scn}: each row reaches the log and the toast, and the reply names the scenario`, async ($, on) => {
    const { calls } = stubs(on)
    const r = await $.command.run({ ...RUN, command: 'status-toast', args: `A ${scn}` })
    expect(r.text).toMatch(new RegExp(`^Scenario A ${scn}`))
    for (const row of fixtureRows(scn)) {
      expect(calls).toContain(`log ${say(row)}`)
      expect(calls).toContain(`toast ${say(row)}`)
    }
  })
}

// @part-command:begin
// A test for each scenario that is not a probe: the reply holds the history of the rows.
for (const scn of SCENARIOS.filter(s => ROLE[s] !== 'deny')) {
  test(`${scn}: the reply holds the history`, async ($, on) => {
    stubs(on)
    const r = await $.command.run({ ...RUN, command: 'status-toast', args: `A ${scn}` })
    expect(r.text).toBe([`Scenario A ${scn}`, ...history(fixtureRows(scn))].join('\n'))
  })
}
// @part-command:end

// @part-guard:begin
// A scenario with the role deny runs the probe through the guard.
for (const scn of SCENARIOS.filter(s => ROLE[s] === 'deny')) {
  test(`${scn}: the probe is refused and runs no tool`, async ($, on) => {
    const { ran } = stubs(on)
    const r = await $.command.run({ ...RUN, command: 'status-toast', args: `A ${scn}` })
    expect(r.text).toMatch(new RegExp(`^✓ ${TEXT.refused}: recursive rm is refused here`))
    expect(r.text).not.toContain('status-toast')
    expect(ran).toEqual([])
  })
}
// @part-guard:end

test('a bad argument gets the usage line and runs nothing', async ($, on) => {
  const { calls } = stubs(on)
  const r = await $.command.run({ ...RUN, command: 'status-toast', args: 'Z nothing' })
  expect(r.text).toMatch(/^Usage: \/status-toast <A>/)
  expect(calls).toEqual([])
})
// @proto:end

// @part-guard:begin
// The guard holds in the real mod too: it judges each Bash command before the tool runs.
test('the guard refuses the probe before the tool runs, and a clean command passes', async ($, on) => {
  const ran: string[] = []
  on('session.root', () => ({ value: '/work' }))
  on('tool.call', { tool: 'Bash' }, (_$, e) => { ran.push(e.command); return { result: 'ok' } })
  const refused = await $.tool.call({ tool: 'Bash', command: probe() })
  expect(refused.deny).toMatch(/^status-toast: recursive rm is refused here/)
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

test('fail closed: a rule that throws refuses the call', async ($, on) => {
  const ran: string[] = []
  on('session.root', () => ({ value: '/work' }))
  on('tool.call', { tool: 'Bash' }, (_$, e) => { ran.push(e.command); return { result: 'ok' } })
  // A command that is not a string makes judge() throw. Without the .catch the call would go through.
  const r = await $.tool.call({ tool: 'Bash', command: 7 as never })
  expect(r.deny).toMatch(/^status-toast: its rules failed/)
  expect(ran).toEqual([])
})
// @part-guard:end
