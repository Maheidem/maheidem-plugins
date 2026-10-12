// The list screen, the band and the start-up: grouped rows, the first selection, a stable Ended group,
// the line under the list and the answer card.
import { expect, test } from 'claude-code/testing'
import { RUN, agentMeta, arrowTo, local, mount, pointed, screen, stubs } from './agents-fixture'
import type { Disk } from './agents-fixture'

const question = { seq: 1, type: 'question', gen: 1, turn: 2, ts: local(18, 58), data: { toolCallId: 't', question_id: 'q_1', topic: 'approval', text: 'Run the e2e pane test?' } }

function fleet(): Disk {
  return {
    metas: {
      pitui: agentMeta('pitui', 'waiting', { turn: 2, updatedAt: local(18, 58), description: 'TUI' }),
      fixer: agentMeta('fixer', 'running', { updatedAt: local(18, 59), description: 'Fix parser' }),
      ...Object.fromEntries(['e1', 'e2', 'e3', 'e4', 'e5'].map((n, i) => [n, agentMeta(n, 'stopped', { updatedAt: local(10 + i, 0), description: `old ${n}` })])),
    },
    events: { pitui: [question] },
    files: {},
  }
}

test('list: grouped rows, the count header, the answer card and the a, x and s keys', async ($, on) => {
  const { clock } = stubs(on, fleet())
  await $.command.run(RUN)
  await clock.settle()
  const ui = await $.ui.mount(mount())
  const text = await screen(ui)
  expect(text).toContain('pi agents · 7 agents · 1 needs input')
  const heads = text.split('\n').filter(l => ['Needs input', 'Working', 'Idle', 'Ended'].includes(l))
  expect(heads).toEqual(['Needs input', 'Working', 'Ended'])
  expect(await ui.find({ key: 'in:answer:pitui:q_1#0' })).toBeDefined()
  expect(text).toContain('pitui asks · approval')
  expect(text).toContain('a: answer')
  expect(text).toContain('x: stop')
  expect(text).toContain('s: settings')
  expect(text).toContain('Esc to close')
  // No raw codes and no pipe tables.
  expect(text).not.toMatch(/g1\/t1|Q:0|\||undefined|null/)
  await ui.unmount()
})

test('bug 26: the first selection is the first row of the first group, not the newest Ended row', async ($, on) => {
  const disk: Disk = {
    metas: {
      fixer: agentMeta('fixer', 'running', { updatedAt: local(17, 0), description: 'Fix parser' }),
      docs: agentMeta('docs', 'idle', { updatedAt: local(18, 0), description: 'Docs', lastTurn: { gen: 1, turn: 1, ok: true, endedAt: local(18, 0) } }),
      oldjob: agentMeta('oldjob', 'stopped', { updatedAt: local(18, 59), description: 'Newest, but ended' }),
    },
    events: {},
    files: {},
  }
  const { clock } = stubs(on, disk)
  await $.command.run(RUN)
  await clock.settle()
  const ui = await $.ui.mount(mount())
  expect(await pointed(ui)).toContain('fixer')
  expect((await ui.find({ key: 'row:fixer' }))?.props.autoFocus).toBe(true)
  await ui.unmount()
})

test('bug 27: the Ended group stays whole when the selection moves; no "more ended" row', async ($, on) => {
  const { clock } = stubs(on, fleet())
  await $.command.run(RUN)
  await clock.settle()
  const ui = await $.ui.mount(mount())
  const before = (await screen(ui)).split('\n').filter(l => /\be[1-5]\b/.test(l)).length
  expect(before).toBe(5)
  await $.ui.focus(arrowTo('row:e1'))
  await clock.settle()
  expect(await pointed(ui)).toContain('e1')
  await $.ui.focus(arrowTo('row:fixer'))
  await clock.settle()
  const text = await screen(ui)
  expect(text.split('\n').filter(l => /\be[1-5]\b/.test(l)).length).toBe(5)
  expect(text).not.toContain('more ended')
  expect(await pointed(ui)).toContain('fixer')
  await ui.unmount()
})

test('bug 28: a stopped agent shows a line in plain words, and a row with no task says so', async ($, on) => {
  const disk: Disk = { metas: { stopper: agentMeta('stopper', 'stopped', { updatedAt: local(18, 30) }) }, events: {}, files: {} }
  const { clock } = stubs(on, disk)
  await $.command.run(RUN)
  await clock.settle()
  const ui = await $.ui.mount(mount())
  const text = await screen(ui)
  expect(text).toContain('stopped 18:30 · no turn finished · a message wakes it')
  expect(text).toContain('no task text')
  expect(text).not.toContain('—')
  // One agent in one group: no group header.
  expect(text.split('\n')).not.toContain('Ended')
  expect(text).toContain('m: wake and send')
  await ui.unmount()
})

test('band: one warning line for a waiting agent, open without a digit hotkey, the rows below kept, hidden while the pane is open', async ($, on) => {
  const { clock, host } = stubs(on, { metas: { pitui: agentMeta('pitui', 'waiting', { turn: 2 }) }, events: { pitui: [question] }, files: {} })
  // What the engine draws beneath the band: another mod's row.
  on('ui.render', ($, e) => $.ui.resolve(e).Text({ children: ['other band row'] }))
  await $.session.start({ cwd: '/project', surface: 'terminal', isInteractive: true })
  await clock.settle()
  const band = await $.ui.mount({ plugin: 'pi-delegate', surface: 'terminal', component: 'AbovePrompt', viewport: { columns: 120, rows: 40 },
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} } } as any)
  const text = await screen(band)
  expect(text).toContain('pitui needs input · Run the e2e pane test?')
  expect(text).toContain('ctrl+x tab to open')
  expect(text).toContain('other band row') // bug 13: the band draws what is below it
  const button = await band.find({ key: 'band:open' })
  expect(button?.props.hotkey).toBeUndefined()
  await band.press({ key: 'band:open' })
  await clock.settle()
  expect(host.open).toBe(true)
  await band.redraw()
  expect(await band.find({ key: 'band:open' })).toBeUndefined()
  await band.unmount()
})

test('start-up: repeated session.start starts one refresh timer, and a tick finds a new agent', async ($, on) => {
  const disk: Disk = { metas: { one: agentMeta('one', 'idle') }, events: {}, files: {} }
  const { clock, host } = stubs(on, disk)
  for (let i = 0; i < 3; i++) await $.session.start({ cwd: '/project', surface: 'terminal', isInteractive: true })
  await clock.settle()
  await $.command.run(RUN)
  const ui = await $.ui.mount(mount())
  expect(await ui.find({ key: 'row:one' })).toBeDefined()
  disk.metas.two = agentMeta('two', 'running')
  const before = host.lists
  await clock.advance(2000)
  await clock.settle()
  expect(host.lists - before).toBe(1) // one timer, one read per tick
  expect(await ui.find({ key: 'row:two' })).toBeDefined()
  await ui.unmount()
})
