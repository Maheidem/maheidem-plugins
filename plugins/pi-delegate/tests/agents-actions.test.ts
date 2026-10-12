// The agent actions: stop, send and answer through the session's own MCP tools, the ownership refusal,
// a retry, the busy mark of each agent and the ring after a result.
import { expect, mock, test } from 'claude-code/testing'
import { runAgentAction } from '../hooks/actions'
import { RUN, agentMeta, arrowTo, fakeK, inputKey, local, mount, screen, stubs } from './agents-fixture'
import type { Disk } from './agents-fixture'

const TOOL = { stop: 'pi_stop', send: 'pi_send_message', answer: 'pi_answer' } as const
const question = { seq: 1, ts: '2026-10-01T18:00:00Z', type: 'question', gen: 1, turn: 1, data: { toolCallId: 'call', question_id: 'q_call', topic: 'approval', text: 'Choose?' } }

// Spec 8.1: the MCP server stamps owner A while the pane's transcript id is B after a resume. The pane must not gate on that.
function disk(action: keyof typeof TOOL, reply: { text: string; isError?: boolean } = { text: 'ok' }): Disk {
  return {
    metas: { scout: agentMeta('scout', action === 'answer' ? 'waiting' : 'idle', { instance: 'x', ownerClaudeSession: 'A', description: 'Scout the repo', lastTurn: { gen: 1, turn: 1, ok: true, endedAt: local(18, 0) } }) },
    events: action === 'answer' ? { scout: [question] } : {},
    files: {},
    reply: () => reply,
  }
}

async function act(ui: any, clock: any, action: keyof typeof TOOL, text = 'hello pi'): Promise<void> {
  if (action === 'stop') {
    await ui.press({ key: 'act:x' })
    await clock.settle()
    expect((await ui.find({ key: 'confirm:no' }))?.props.hotkey).toBe('n')
    expect((await ui.find({ key: 'confirm:yes' }))?.props.label).toBe('stop')
    await ui.press({ key: 'confirm:yes' })
  } else if (action === 'send') {
    await ui.press({ key: 'act:m' })
    await clock.settle()
    await ui.input({ key: await inputKey(ui, 'in:msg:scout#'), text })
  } else await ui.input({ key: await inputKey(ui, 'in:answer:scout:q_call#'), text })
  await clock.settle()
}

for (const action of ['stop', 'send', 'answer'] as const) {
  test(`${action}: the call goes to the session's tool, the result shows, the ring goes home`, async ($, on) => {
    const { clock, host } = stubs(on, disk(action))
    await $.command.run(RUN)
    await clock.settle()
    const ui = await $.ui.mount(mount())
    await act(ui, clock, action)
    expect(host.calls.length).toBe(1)
    expect(host.calls[0].tool).toBe(`mcp__plugin_pi-delegate_pi-delegate__${TOOL[action]}`)
    // The pane never holds the wake: the next event stays queued for Claude.
    expect(host.calls[0].hold).toBe(false)
    if (action === 'answer') expect(host.calls[0]).toMatchObject({ answer: 'hello pi', question_id: 'q_call', relay_user: true })
    else if (action === 'send') expect(host.calls[0].message).toBe('hello pi')
    else expect(host.calls[0].name).toBe('scout')
    expect(await screen(ui)).toMatch(/✓ (Stopped scout|Message sent|Answer sent)/)
    await ui.unmount()
  })
}

test('a refusal of ownership shows plain words, keeps the draft and tags the facts line', async ($, on) => {
  const { clock, host } = stubs(on, disk('send', { text: 'pi:scout is owned by another Claude session (server pid 4242)', isError: true }))
  await $.command.run(RUN)
  await clock.settle()
  const ui = await $.ui.mount(mount())
  await act(ui, clock, 'send', 'keep me')
  expect(host.calls.length).toBe(1)
  const text = await screen(ui)
  expect(text).toContain("✕ Couldn't message scout. It belongs to another Claude session.")
  expect(text).toContain('Open that session to steer it')
  expect(text).toMatch(/· other session/)
  expect((await ui.find({ key: await inputKey(ui, 'in:msg:scout#') }))?.props.value).toBe('keep me')
  await ui.unmount()
})

test('a failed call shows r: retry, and the retry repeats the call', async ($, on) => {
  const { clock, host } = stubs(on, disk('stop', { text: 'the call timed out', isError: true }))
  await $.command.run(RUN)
  await clock.settle()
  const ui = await $.ui.mount(mount())
  await act(ui, clock, 'stop')
  const text = await screen(ui)
  expect(text).toContain("✕ Couldn't stop scout: the call timed out")
  // Bug 15: the retry row says what Esc does here.
  expect(text).toContain('r: retry · Esc to dismiss')
  expect(text).not.toContain('Esc to back')
  await ui.press({ key: 'act:retry' })
  await clock.settle()
  expect(host.calls.length).toBe(2)
  await ui.unmount()
})

test('bug 6: a busy agent ignores a second action with a dim notice; another agent still acts', async ($, on) => {
  let release = (): void => undefined
  const held = new Promise<void>(r => { release = r })
  const d: Disk = {
    metas: {
      alpha: agentMeta('alpha', 'idle', { description: 'A' }),
      beta: agentMeta('beta', 'idle', { description: 'B', updatedAt: local(17, 0) }),
    },
    events: {}, files: {},
    // The stop of alpha waits: a permission prompt that is still open.
    gate: e => (e.name === 'alpha' ? held : undefined),
  }
  const { clock, host } = stubs(on, d)
  await $.command.run(RUN)
  await clock.settle()
  const ui = await $.ui.mount(mount())
  await ui.press({ key: 'act:x' })
  await clock.settle()
  const pending = ui.press({ key: 'confirm:yes' })
  await clock.advance(50)
  expect(await screen(ui)).toContain('Stopping alpha…')
  // Another agent acts while alpha waits.
  await $.ui.focus(arrowTo('row:beta'))
  await ui.press({ key: 'act:x' })
  await ui.press({ key: 'confirm:yes' })
  await clock.advance(50)
  expect(host.calls.filter(c => c.name === 'beta').length).toBe(1)
  // A second stop of alpha is ignored with a dim notice.
  await $.ui.focus(arrowTo('row:alpha'))
  await ui.press({ key: 'act:x' })
  await clock.advance(50)
  expect(await screen(ui)).toContain('alpha is still busy with your last action.')
  release()
  await pending
  await clock.settle()
  expect(host.calls.filter(c => c.name === 'alpha').length).toBe(1)
  await ui.unmount()
})

test('bug 7: after a stop, a declined send or an error, the ring goes back to a known key', async (_$, on) => {
  const clock = mock.clock(on, { now: 1000 })
  for (const reply of [{ text: 'ok' }, { text: 'no', deny: 'declined by the user' }, { text: 'the call timed out', isError: true }]) {
    const t = await fakeK(clock, { ...disk('stop'), reply: () => reply }, { view: 'list', sel: 'scout', confirm: { kind: 'stop', id: 'scout' } })
    await runAgentAction(t.k, 'scout', 'stop')
    await clock.advance(100)
    expect(t.tools.length).toBe(1)
    expect(t.f.ui().confirm).toBeNull()
    expect(t.f.calls.filter(x => x.startsWith('focus ')).at(-1)).toBe('focus row:scout')
  }
})
