// The tests of the guard. They run in the prototype and in the real mod: the guard and its proof command stay.
// The texts of a refusal come from the rules (rules.ts) and from ../hooks/domain. Add one test for each rule that you write.
import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import { PROBE, TEXT } from '../hooks/domain'
import { RULES, inside, judge, probe, proof } from '../hooks/rules'

// $.command.run in a test needs origin and presentation (references/api.md 12a).
const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 150 } } as const

// The stubs for the engine beneath the plugin. The tool stub records each command that reaches the tool,
// so a refused call leaves the record empty.
function stubs(on: Parameters<TestBody>[1]) {
  const ran: string[] = []
  on('session.root', () => ({ value: '/work' }))
  on('tool.call', { tool: 'Bash' }, (_$, e) => { ran.push(e.command); return { result: 'ok' } })
  return ran
}

test('recursive rm is refused before the tool runs', async ($, on) => {
  const ran = stubs(on)
  for (const command of ['rm -rf build', 'rm -fr build', 'rm -r -f build', 'sudo rm -Rf build', 'rm --recursive build', 'ls && rm -rf build']) {
    const r = await $.tool.call({ tool: 'Bash', command })
    expect(r.deny, command).toMatch(/^guard-starter: recursive rm is refused here/)
  }
  expect(ran).toEqual([])
})

test('a forced push is refused, a lease push passes', async ($, on) => {
  const ran = stubs(on)
  for (const command of ['git push --force', 'git push origin main -f']) {
    const r = await $.tool.call({ tool: 'Bash', command })
    expect(r.deny, command).toMatch(/^guard-starter: a forced push is refused here/)
  }
  const ok = await $.tool.call({ tool: 'Bash', command: 'git push --force-with-lease' })
  expect(ok.deny).toBeUndefined()
  expect(ran).toEqual(['git push --force-with-lease'])
})

test('a clean command reaches the tool unchanged', async ($, on) => {
  const ran = stubs(on)
  for (const command of ['ls -la', 'rm old.log', 'echo "rm -rf x"', 'grep -r rm src', 'git push origin main']) {
    const r = await $.tool.call({ tool: 'Bash', command })
    expect(r.deny, command).toBeUndefined()
  }
  expect(ran).toEqual(['ls -la', 'rm old.log', 'echo "rm -rf x"', 'grep -r rm src', 'git push origin main'])
})

test('fail closed: a rule that throws refuses the call', async ($, on) => {
  const ran = stubs(on)
  // A command that is not a string makes judge() throw. Without the .catch the call would go through.
  const r = await $.tool.call({ tool: 'Bash', command: 7 as never })
  expect(r.deny).toMatch(/^guard-starter: its rules failed/)
  expect(ran).toEqual([])
})

test('the probe holds the folder that must stay, outside every session folder, and a rule refuses it', () => {
  expect(PROBE).toContain('{dir}')
  expect(probe()).not.toContain('{dir}')
  expect(probe()).toContain(' /mod-fixture-missing-dir')
  expect(judge(probe(), '/work')?.id).toBeDefined()
  expect(RULES.length).toBeGreaterThan(0)
})

test('the probe folder lies outside the session folder, for any root', () => {
  for (const root of ['/work', '/a/b', '/a/b/c']) {
    const dir = probe(root).replace(/^.* /, '')
    expect(inside(dir, root), root).toBe(false)
    expect(dir.endsWith('/mod-fixture-missing-dir'), root).toBe(true)
  }
  expect(probe('/a/b')).toContain(' /a/mod-fixture-missing-dir')
  expect(judge(probe('/a/b'), '/a/b')?.id).toBeDefined()
})

test('the proof command reports a refusal and runs no tool', async ($, on) => {
  const ran = stubs(on)
  const r = await $.command.run({ ...RUN, command: 'guard-starter', args: '' })
  expect(r.text).toMatch(new RegExp(`^✓ ${TEXT.refused}: recursive rm is refused here`))
  expect(r.text).not.toContain('guard-starter')
  expect(ran).toEqual([])
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
