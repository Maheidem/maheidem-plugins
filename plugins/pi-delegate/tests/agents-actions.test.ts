import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'pi-delegate', component: 'Pane', requestId: 'pi-delegate-agents',
  viewport: { columns: 160, rows: 48 },
  props: { title: 'Pi agents', isFocused: true, bodyColumns: 70, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

for (const action of ['stop', 'send', 'answer']) {
  test(`${action} routes through existing tool; stop confirms and answers relay user`, async ($, on) => {
    mock.clock(on)
    mock.env(on, { CLAUDE_PLUGIN_DATA: '/data' })
    const meta = { name: 'scout', instance: 'x', state: action === 'answer' ? 'waiting' : 'idle', ownerClaudeSession: 'own', gen: 1, turn: 1 }
    const question = { type: 'question', gen: 1, turn: 1, data: { toolCallId: 'call', question_id: 'q_call', text: 'Choose?' } }
    const tool = `mcp__plugin_pi-delegate_pi-delegate__${action === 'send' ? 'pi_send_message' : action === 'answer' ? 'pi_answer' : 'pi_stop'}`
    const calls: any[] = []
    let complete: () => void
    const done = new Promise<void>(resolve => { complete = resolve })
    on('session.id', () => ({ value: 'own' }))
    on('session.start', () => ({ cwd: '/project' }))
    on('fs.list', () => ({ value: [{ name: 'scout', kind: 'directory', isLink: false }] }))
    on('fs.read', ($, e) => ({ value: e.path.endsWith('meta.json') ? JSON.stringify(meta) : e.path.endsWith('events.jsonl') && action === 'answer' ? JSON.stringify(question) : '' }))
    on('ui.open', () => ({ value: undefined }))
    on('tool.list', () => ({ value: [{ name: tool }] }))
    on('tool.call', ($, e) => {
      calls.push(e)
      complete()
      return { result: 'owned by another Claude session', text: 'owned by another Claude session', isError: true }
    })
    await $.session.start({ cwd: '/project', surface: 'terminal', isInteractive: true })
    await $.command.run({ command: 'pi-delegate:agents', args: '' })
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    if (action === 'stop') {
      await ui.press({ key: 'stop' })
      expect(calls).toEqual([])
      expect((await ui.find({ key: 'stop' }))?.props.label).toBe('Confirm STOP scout')
      await ui.press({ key: 'stop' })
    } else await ui.input({ key: action === 'answer' ? 'answer-q_call' : 'send', text: 'hello pi' })
    await done
    expect(calls[0].tool).toBe(tool)
    if (action === 'answer') {
      expect(calls[0].answer).toBe('hello pi')
      expect(calls[0].question_id).toBe('q_call')
      expect(calls[0].relay_user).toBe(true)
    } else if (action === 'send') expect(calls[0].message).toBe('hello pi')
    else expect(calls[0].name).toBe('scout')
    // Flush the detached callback's finally block without a real timer.
    for (let i = 0; i < 30; i++) await Promise.resolve()
    expect(await ui.find({ type: 'Text', text: /owned by another Claude session/ })).toBeDefined()
    await ui.unmount()
  })
}
