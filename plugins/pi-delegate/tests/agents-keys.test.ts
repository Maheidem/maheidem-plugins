// Key presses through the hooks: the Esc ladder, the arrows, the error view keys, the input epoch,
// the Select behind its Button and the windowed lists of the detail.
import { expect, mock, test } from 'claude-code/testing'
import type { Args, Next } from 'claude-code'
import { escape } from '../hooks/actions'
import { RUN, agentMeta, arrowTo, fakeK, inputKey, local, mount, pointed, screen, stubs } from './agents-fixture'
import type { Disk } from './agents-fixture'

const SNAPSHOT = {
  ok: true, pin: { provider: 'local', model: 'test', source: 'project' }, warnings: [], testMode: false, userPath: '/home/.claude/pi-delegate.json',
  settings: { questions_per_turn: { value: 5, source: 'default', project: null, user: null }, default_thinking: { value: 'pi-default', source: 'default', project: null, user: null } },
  definitions: { questions_per_turn: { default: 5, min: 0, max: 100, special: ['unlimited'] }, default_thinking: { default: 'pi-default', special: ['off', 'low', 'high', 'pi-default'] } },
}
const one = (state = 'idle', extra: Record<string, unknown> = {}): Disk => ({
  metas: { scout: agentMeta('scout', state, { description: 'Scout the repo', lastTurn: { gen: 1, turn: 1, ok: true, endedAt: local(18, 0) }, ...extra }) },
  events: {}, files: {},
  run: argv => (argv[2] === 'snapshot' ? { exitCode: 0, stdout: JSON.stringify(SNAPSHOT) } : argv[2] === 'validate' ? { exitCode: 0, stdout: JSON.stringify({ ok: true, value: argv[4] }) } : { exitCode: 0, stdout: '' }),
})

// A person's Esc as the engine raises it, and a next() that counts the closes.
const person = { id: 'pi-agents', origin: { kind: 'person' } } as unknown as Args<'ui.close'>
function closer() {
  const seen = { closes: 0 }
  const next = (async () => { seen.closes++; return undefined }) as unknown as Next<'ui.close'>
  return { seen, next }
}

for (const placement of ['dock', 'inline'] as const) {
  test(`bug 1 (${placement}): the hints say what Esc does on each screen; no b: back key`, async ($, on) => {
    const { clock } = stubs(on, one())
    await $.command.run(RUN)
    await clock.settle()
    const ui = await $.ui.mount(mount({ placement }))
    expect(await screen(ui)).toContain('Esc to close')
    await ui.press({ key: 'act:x' })
    await clock.settle()
    expect(await screen(ui)).toContain('y to stop · Esc to cancel')
    await ui.press({ key: 'confirm:no' })
    await clock.settle()
    await ui.press({ key: 'row:scout' })
    await clock.settle()
    const detail = await screen(ui)
    expect(detail).toContain('Esc to back')
    expect(detail).not.toContain('Esc to close')
    expect(detail).not.toMatch(/\bb: back\b/)
    expect(await ui.find({ key: 'act:b' })).toBeUndefined()
    await ui.unmount()
  })
}

test('bug 1: Esc steps back one level from a confirm, the composer and the detail; only the list closes', async (_$, on) => {
  const clock = mock.clock(on, { now: 1000 })
  // The stop question in the list: Esc cancels it, the ring goes home, the pane stays.
  let t = await fakeK(clock, one(), { view: 'list', sel: 'scout', confirm: { kind: 'stop', id: 'scout' } })
  let c = closer()
  expect(await escape(t.k, person, c.next)).toEqual({ deny: 'back one level' })
  await clock.settle()
  expect(t.f.ui().confirm).toBeNull()
  expect(t.f.calls).toContain('focus row:scout')
  expect(c.seen.closes).toBe(0)
  // The composer in the detail: Esc closes the field, the ring goes to the tab.
  t = await fakeK(clock, one(), { view: 'detail', editing: true, inputFocused: true }, { agent: 'scout', tab: 'result' })
  c = closer()
  expect(await escape(t.k, person, c.next)).toEqual({ deny: 'back one level' })
  await clock.settle()
  expect(t.f.ui().editing).toBe(false)
  expect(t.f.calls).toContain('focus tab:result')
  // The detail: Esc goes back to the list, on the agent's row.
  t = await fakeK(clock, one(), { view: 'detail', sel: 'step:3' }, { agent: 'scout', tab: 'activity' })
  c = closer()
  expect(await escape(t.k, person, c.next)).toEqual({ deny: 'back one level' })
  await clock.advance(100) // the ring moves once the new view is drawn
  expect(t.f.ui().view).toBe('list')
  expect(t.f.calls).toContain('focus row:scout')
  // The list is the top level: Esc closes the pane.
  t = await fakeK(clock, one(), { view: 'list', sel: 'scout' })
  c = closer()
  await escape(t.k, person, c.next)
  expect(c.seen.closes).toBe(1)
})

test('bug 2: Esc while the prompt has the keys (the pane was drawn without them) closes the pane from any view', async (_$, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const t = await fakeK(clock, one(), { view: 'detail' }, { agent: 'scout' })
  const c = closer()
  await escape(t.k, person, c.next, false)
  expect(c.seen.closes).toBe(1)
  expect(t.f.ui().view).toBe('detail')
})

test('bug 17: the first Esc while editing a setting closes the field; the next goes back', async (_$, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const t = await fakeK(clock, one(), { view: 'settings', cameFrom: 'list', editing: true, inputFocused: true, focusKey: 'set:questions_per_turn' })
  let c = closer()
  expect(await escape(t.k, person, c.next)).toEqual({ deny: 'back one level' })
  await clock.settle()
  expect(t.f.ui().editing).toBe(false)
  expect(t.f.ui().view).toBe('settings')
  expect(t.f.calls).toContain('focus set:questions_per_turn')
  c = closer()
  await escape(t.k, person, c.next)
  await clock.advance(100)
  expect(t.f.ui().view).toBe('list')
  expect(c.seen.closes).toBe(0)
})

test('bug 3: s in the error view opens the settings', async ($, on) => {
  const disk = one()
  disk.listError = () => 'EACCES: permission denied'
  const { clock } = stubs(on, disk)
  await $.command.run(RUN)
  await clock.settle()
  const ui = await $.ui.mount(mount())
  const text = await screen(ui)
  expect(text).toContain("Can't read agents")
  expect(text).toContain('The agents of this project could not be read.')
  expect(text).not.toContain('EACCES')
  await ui.press({ key: 'act:s' })
  await clock.settle()
  expect(await screen(ui)).toContain('pi agents › Settings')
  expect(await screen(ui)).toContain('Questions per turn')
  // The command lands on the error view again; the retry key reads again.
  await $.command.run(RUN)
  await clock.settle()
  expect(await screen(ui)).toContain("Can't read agents")
  disk.listError = undefined
  await ui.press({ key: 'act:r' })
  await clock.settle()
  expect(await ui.find({ key: 'row:scout' })).toBeDefined()
  await ui.unmount()
})

test('bug 5: after a declined send the field mounts again with the kept text, so the notice is true', async ($, on) => {
  const disk = one()
  disk.reply = () => ({ text: 'The user declined the permission prompt', deny: 'declined by the user' })
  const { clock } = stubs(on, disk)
  await $.command.run(RUN)
  await clock.settle()
  const ui = await $.ui.mount(mount())
  await ui.press({ key: 'act:m' })
  await clock.settle()
  const first = await inputKey(ui, 'in:msg:scout#')
  await ui.input({ key: first, text: 'keep me', kind: 'change' })
  await clock.advance(400)
  await ui.input({ key: first, text: 'keep me' })
  await clock.settle()
  const second = await inputKey(ui, 'in:msg:scout#')
  expect(second).not.toBe(first)
  expect((await ui.find({ key: second }))?.props.value).toBe('keep me')
  expect(await screen(ui)).toContain('Not sent. You declined the permission prompt.')
  expect(await screen(ui)).toContain('Your message is still in the box.')
  await ui.unmount()
})

test('bug 9: a Select stays behind its Button: no Select until the press, and an arrow onto the row opens nothing', async ($, on) => {
  const { clock, host } = stubs(on, one())
  await $.command.run(RUN)
  await clock.settle()
  const ui = await $.ui.mount(mount())
  await ui.press({ key: 'act:s' })
  await clock.settle()
  expect(await ui.find({ type: 'Select' })).toBeUndefined()
  expect(await screen(ui)).toContain("pi's own ▾")
  await $.ui.focus(arrowTo('set:default_thinking'))
  await clock.settle()
  expect(await ui.find({ type: 'Select' })).toBeUndefined()
  expect(await pointed(ui)).toContain('Default thinking')
  await ui.press({ key: 'set:default_thinking' })
  await clock.settle()
  expect((await ui.find({ type: 'Select' }))?.key).toBe('pick:default_thinking')
  // The shown value commits nothing; Esc closes the Select and keeps the settings.
  await ui.select({ key: 'pick:default_thinking', value: 'pi-default' })
  await clock.settle()
  expect(host.calls.length).toBe(0)
  await ui.press({ key: 'set:default_thinking' })
  await clock.settle()
  await ui.select({ key: 'pick:default_thinking', value: 'high' })
  await clock.settle()
  expect(String(host.calls[0]?.command)).toContain("--default-thinking 'high' --json")
  await ui.unmount()
})

test('bug 10: an arrow onto a footer key is refused; the hotkey still presses it', async ($, on) => {
  const { clock, host } = stubs(on, one())
  await $.command.run(RUN)
  await clock.settle()
  const ui = await $.ui.mount(mount())
  const calls = host.focusCalls.length
  const r = await $.ui.focus(arrowTo('act:s'))
  expect(r).toEqual({})
  expect(host.focusCalls.length).toBe(calls) // the hook answered: the engine beneath was not asked
  expect(await pointed(ui)).toContain('scout')
  await ui.press({ key: 'act:s' })
  await clock.settle()
  expect(await screen(ui)).toContain('Settings')
  await ui.unmount()
})

test('bug 11: Activity and Log are kit list windows: edges are dim text, an arrow moves one row', async ($, on) => {
  const steps = Array.from({ length: 30 }, (_, i) => ({ type: 'message', timestamp: local(17, i), message: { role: 'assistant', content: [{ type: 'toolCall', id: `c${i}`, name: 'read', arguments: { path: `src/file${i}.ts` } }] } }))
  const session = steps.map(x => JSON.stringify(x)).join('\n') + '\n'
  const disk = one('idle', { sessionFile: '/s.jsonl' })
  disk.files['/s.jsonl'] = session
  disk.events.scout = Array.from({ length: 30 }, (_, i) => ({ seq: i + 1, ts: local(17, i), gen: 1, turn: 1, type: 'note', data: { text: `note ${i}` } }))
  const { clock } = stubs(on, disk)
  await $.command.run(RUN)
  await clock.settle()
  const ui = await $.ui.mount(mount({ rows: 20 }))
  await ui.press({ key: 'row:scout' })
  await clock.settle()
  await ui.press({ key: 'tab:activity' })
  await clock.settle()
  // The newest step is selected; the older steps are counted by a dim edge row.
  expect(await pointed(ui)).toContain('src/file29.ts')
  expect(await screen(ui)).toMatch(/↑ \d+ more/)
  for (const b of await ui.findAll({ type: 'Button' })) expect(String(b.key)).not.toMatch(/^(win:|edge:)/)
  // Up moves one row, and the ring lands on a drawn row.
  await $.ui.focus(arrowTo('row:step:28'))
  await clock.settle()
  expect(await pointed(ui)).toContain('src/file28.ts')
  // Enter expands the step under the list; Esc collapses it, then goes back.
  await ui.press({ key: 'row:step:28' })
  await clock.settle()
  expect(await screen(ui)).toContain('Esc to collapse')
  await ui.press({ key: 'row:step:28' })
  await clock.settle()
  expect(await screen(ui)).not.toContain('Esc to collapse')
  expect(await ui.find({ key: 'tab:activity' })).toBeDefined()
  // Log: the same window, newest first selected, plain words only.
  await ui.press({ key: 'tab:log' })
  await clock.settle()
  expect(await pointed(ui)).toContain('note 29')
  await ui.press({ key: 'row:ev:30' })
  await clock.settle()
  const text = await screen(ui)
  expect(text).not.toMatch(/[{}"]|event 30|Enter to show raw/)
  await ui.unmount()
})
