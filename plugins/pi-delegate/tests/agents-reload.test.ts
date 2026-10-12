// A freshly loaded module (a hot reload): the command and the render work without an earlier session.start,
// every detail tab draws, long results stay inside the pane, and the footer always shows.
import { expect, test } from 'claude-code/testing'
import { RUN, agentMeta, local, mount, screen, stubs } from './agents-fixture'
import type { Disk } from './agents-fixture'

const SNAPSHOT = { ok: true, pin: { provider: 'local', model: 'test', source: 'project' }, settings: { questions_per_turn: { value: 5, source: 'default', project: null, user: null } }, definitions: { questions_per_turn: { default: 5, min: 0, max: 100 } }, userPath: '/home/.claude/pi-delegate.json', warnings: [], testMode: false }
const LONG = Array.from({ length: 5 }, (_, i) => `## part ${i}\n\n` + `word${i} `.repeat(1800)).join('\n\n')

function disk(): Disk {
  const session = [
    { type: 'message', timestamp: '2026-10-01T17:00:00Z', message: { role: 'assistant', content: [{ type: 'text', text: 'transcript restored' }, { type: 'toolCall', id: 'a', name: 'read', arguments: { path: 'README.md' } }] } },
    { type: 'message', message: { role: 'toolResult', toolCallId: 'a', isError: false, content: [{ type: 'text', text: 'line\nline' }] } },
  ].map(x => JSON.stringify(x)).join('\n') + '\n'
  return {
    metas: { scout: agentMeta('scout', 'idle', { turn: 2, ownerClaudeSession: 'A', sessionFile: '/session.jsonl', description: 'Scout', lastTurn: { gen: 1, turn: 2, ok: true, endedAt: '2026-10-01T18:00:00Z' } }) },
    events: { scout: [{ seq: 1, ts: '2026-10-01T17:00:00Z', type: 'spawned', gen: 1, turn: 0, data: { model: 'gpt-6.1-sol' } }] },
    files: { '/session.jsonl': session, '/data/projects/--project--/children/scout/results/1-2.md': LONG, '/data/projects/--project--/children/scout/results/1-1.md': 'first turn result' },
    run: argv => (argv[2] === 'snapshot' ? { exitCode: 0, stdout: JSON.stringify(SNAPSHOT) } : { exitCode: 0, stdout: '' }),
  }
}

test('reload, then the command: list, every detail tab, turn keys and settings work', async ($, on) => {
  const { clock } = stubs(on, disk())
  // A freshly evaluated module and no session.start.
  await $.command.run(RUN)
  await clock.settle()
  const ui = await $.ui.mount(mount())
  expect(await ui.find({ key: 'row:scout' })).toBeDefined()
  await ui.press({ key: 'row:scout' })
  await clock.settle()
  let text = await screen(ui)
  expect(text).toContain('Result of turn 2')
  // A result longer than the pane: lines in a window, the arrows scroll, the footer still shows.
  expect(text).toContain('↑/↓ to scroll')
  expect(text).toContain('Esc to back')
  expect(text.split('\n').length).toBeLessThanOrEqual(40)
  await ui.press({ key: 'act:p' })
  await clock.settle()
  expect(await ui.find({ type: 'Markdown', text: 'first turn result' })).toBeDefined()
  // Bug 24: a short result does not claim that the arrows scroll.
  expect(await screen(ui)).not.toContain('↑/↓ to scroll')
  await ui.press({ key: 'tab:activity' })
  await clock.settle()
  expect(await ui.find({ key: 'row:step:1' })).toBeDefined()
  text = await screen(ui)
  expect(text).toContain('2 lines')
  expect(text).not.toMatch(/toolResult|[{}]/)
  await ui.press({ key: 'row:step:1' })
  await clock.settle()
  expect(await ui.find({ type: 'Code' })).toBeDefined()
  await ui.press({ key: 'tab:log' })
  await clock.settle()
  expect(await screen(ui)).toContain('Started · gpt-6.1-sol')
  await ui.press({ key: 'tab:questions' })
  await clock.settle()
  expect(await screen(ui)).toContain('scout has not asked anything.')
  await ui.press({ key: 'act:s' })
  await clock.settle()
  expect(await screen(ui)).toContain('test · from the project pin')
  await $.command.run(RUN)
  await clock.settle()
  expect(await ui.find({ key: 'row:scout' })).toBeDefined()
  await ui.unmount()
})

test('reload, then a render only: the loading line, then the list once session.start reads', async ($, on) => {
  const { clock } = stubs(on, disk())
  const ui = await $.ui.mount(mount())
  expect(await screen(ui)).toContain('Loading pi agents…')
  await $.session.start({ cwd: '/project', surface: 'terminal', isInteractive: true })
  await clock.settle()
  expect(await ui.find({ key: 'row:scout' })).toBeDefined()
  await ui.unmount()
})

test('bug 29: the footer shows at 100 and 60 columns, inline, in the detail', async ($, on) => {
  const { clock } = stubs(on, disk())
  await $.command.run(RUN)
  await clock.settle()
  for (const cols of [100, 60]) {
    await $.command.run(RUN)
    await clock.settle()
    const ui = await $.ui.mount(mount({ cols, rows: 13 }))
    await ui.press({ key: 'row:scout' })
    await clock.settle()
    const lines = (await screen(ui)).split('\n')
    expect(lines.length).toBeLessThanOrEqual(13)
    expect(lines.at(-1)).toContain('Esc to back')
    expect(lines.join('\n')).toContain('m: message')
    await ui.unmount()
  }
})

test('bug 22: /clear resets the view to the list and reads again', async ($, on) => {
  const { clock } = stubs(on, disk())
  await $.session.start({ cwd: '/project', surface: 'terminal', isInteractive: true })
  await $.command.run(RUN)
  await clock.settle()
  const ui = await $.ui.mount(mount())
  await ui.press({ key: 'row:scout' })
  await clock.settle()
  expect(await ui.find({ key: 'tab:result' })).toBeDefined()
  await $.classic.SessionStart({ source: 'clear' } as any)
  await clock.settle()
  await ui.redraw()
  expect(await ui.find({ key: 'tab:result' })).toBeUndefined()
  expect(await ui.find({ key: 'row:scout' })).toBeDefined()
  await ui.unmount()
})

test('bug 18: a reload drops a wait notice and an open question', async ($, on) => {
  const { clock } = stubs(on, disk())
  await $.command.run(RUN)
  await clock.settle()
  const ui = await $.ui.mount(mount())
  await ui.press({ key: 'act:x' })
  await clock.settle()
  expect(await screen(ui)).toContain('Stop scout?')
  // session.start fires again after a hot reload.
  await $.session.start({ cwd: '/project', surface: 'terminal', isInteractive: true })
  await clock.settle()
  expect(await screen(ui)).not.toContain('Stop scout?')
  await ui.unmount()
})

test('bug 20: an unreadable session file shows plain words and the next look reads again', async ($, on) => {
  const d = disk()
  const good = d.files['/session.jsonl'] ?? ''
  let broken = true
  d.readError = path => (path === '/session.jsonl' && broken ? 'EIO' : undefined)
  const { clock } = stubs(on, d)
  await $.command.run(RUN)
  await clock.settle()
  const ui = await $.ui.mount(mount())
  await ui.press({ key: 'row:scout' })
  await ui.press({ key: 'tab:activity' })
  await clock.settle()
  const text = await screen(ui)
  expect(text).toContain("The agent's session file could not be read.")
  expect(text).not.toContain('too large')
  broken = false
  d.files['/session.jsonl'] = good
  // The next tick (2 s) reads again.
  for (let i = 0; i < 6 && !(await ui.find({ key: 'row:step:1' })); i++) {
    await clock.advance(1000)
    await clock.settle()
  }
  expect(await ui.find({ key: 'row:step:1' })).toBeDefined()
  await ui.unmount()
})
