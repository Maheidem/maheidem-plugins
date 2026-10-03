import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'pi-delegate', component: 'Pane', requestId: 'pi-agents',
  viewport: { columns: 160, rows: 48 },
  props: { title: 'pi agents', isFocused: true, bodyColumns: 80, placement: 'inline', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const
const TOOL = { stop: 'pi_stop', send: 'pi_send_message', answer: 'pi_answer' } as const

// Spec §8.1: the MCP server stamps owner A (its CLAUDE_CODE_SESSION_ID) while
// the pane's transcript id is B after a resume. The pane must not gate on that.
function stub(on: any, action: keyof typeof TOOL, reply: { text: string, isError?: boolean }, calls: any[]) {
  mock.env(on, { CLAUDE_PLUGIN_DATA: '/data' })
  const meta = { name: 'scout', instance: 'x', state: action === 'answer' ? 'waiting' : 'idle', ownerClaudeSession: 'A', gen: 1, turn: 1, description: 'Scout the repo', lastTurn: { gen: 1, turn: 1, ok: true, endedAt: '2026-10-01T18:00:00Z' } }
  const question = { seq: 1, ts: '2026-10-01T18:00:00Z', type: 'question', gen: 1, turn: 1, data: { toolCallId: 'call', question_id: 'q_call', topic: 'approval', text: 'Choose?' } }
  on('session.id', () => ({ value: 'B' }))
  on('session.root', () => ({ value: '/project' }))
  on('session.start', () => ({ cwd: '/project' }))
  on('fs.list', ($: any, e: any) => ({ value: e.path.endsWith('/children') ? [{ name: 'scout', kind: 'directory', isLink: false }] : [] }))
  on('fs.read', ($: any, e: any) => ({ value: e.path.endsWith('meta.json') ? JSON.stringify(meta) : e.path.endsWith('events.jsonl') && action === 'answer' ? JSON.stringify(question) : '' }))
  on('ui.open', () => ({ value: undefined }))
  on('tool.list', () => ({ value: [{ name: `mcp__plugin_pi-delegate_pi-delegate__${TOOL[action]}` }] }))
  on('tool.call', ($: any, e: any) => { calls.push(e); return { result: reply.text, text: reply.text, isError: !!reply.isError } })
}

async function act(ui: any, action: keyof typeof TOOL, calls: any[]) {
  if (action === 'stop') {
    await ui.press({ key: 'key:x' })
    expect(calls).toEqual([])
    expect((await ui.find({ key: 'confirm:no' }))?.props.hotkey).toBe('n')
    expect((await ui.find({ key: 'confirm:yes' }))?.props.label).toBe('Stop scout')
    await ui.press({ key: 'confirm:yes' })
  } else if (action === 'send') {
    await ui.press({ key: 'row:scout' })
    expect(await ui.find({ key: 'compose' })).toBeDefined()
    await ui.input({ key: 'compose', text: 'hello pi' })
  } else await ui.input({ key: 'answer:scout:q_call', text: 'hello pi' })
}

for (const action of ['stop', 'send', 'answer'] as const) {
  test(`${action}: diverging owner/transcript ids still render controls and the call goes through`, async ($, on) => {
    const clock = mock.clock(on)
    const calls: any[] = []
    stub(on, action, { text: 'ok' }, calls)
    await $.session.start({ cwd: '/project', surface: 'terminal', isInteractive: true })
    await $.command.run({ command: 'pi-delegate:agents', args: '' })
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: /Read-only|another Claude session/ })).toBeUndefined()
    await act(ui, action, calls)
    await clock.settle()
    expect(calls.length).toBe(1)
    expect(calls[0].tool).toBe(`mcp__plugin_pi-delegate_pi-delegate__${TOOL[action]}`)
    if (action === 'answer') expect(calls[0]).toMatchObject({ answer: 'hello pi', question_id: 'q_call', relay_user: true })
    else if (action === 'send') expect(calls[0].message).toBe('hello pi')
    else expect(calls[0].name).toBe('scout')
    expect(await ui.find({ type: 'Text', text: /^✓ / })).toBeDefined()
    await ui.unmount()
  })
}

test('a server ownership refusal renders A3, keeps the draft and tags the facts line', async ($, on) => {
  const clock = mock.clock(on)
  const calls: any[] = []
  stub(on, 'send', { text: 'pi:scout is owned by another Claude session (server pid 4242)', isError: true }, calls)
  await $.command.run({ command: 'pi-delegate:agents', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'row:scout' })
  await ui.input({ key: 'compose', text: 'keep me', kind: 'change' })
  await ui.input({ key: 'compose', text: 'keep me' })
  await clock.settle()
  expect(calls.length).toBe(1)
  expect(await ui.find({ type: 'Text', text: "✕ Couldn't message scout. It belongs to another Claude session." })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Open that session to steer it/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /· other session$/ })).toBeDefined()
  expect((await ui.find({ key: 'compose' }))?.props.value).toBe('keep me')
  await ui.unmount()
})

test('a generic tool failure renders A4 with a retry that repeats the call', async ($, on) => {
  const clock = mock.clock(on)
  const calls: any[] = []
  stub(on, 'stop', { text: 'the call timed out', isError: true }, calls)
  await $.command.run({ command: 'pi-delegate:agents', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await act(ui, 'stop', calls)
  await clock.settle()
  expect(await ui.find({ type: 'Text', text: "✕ Couldn't stop scout: the call timed out" })).toBeDefined()
  expect((await ui.find({ key: 'retry' }))?.props.hotkey).toBe('r')
  await ui.press({ key: 'retry' })
  await clock.settle()
  expect(calls.length).toBe(2)
  await ui.unmount()
})
