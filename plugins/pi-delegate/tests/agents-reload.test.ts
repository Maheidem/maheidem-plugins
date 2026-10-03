import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'pi-delegate', component: 'Pane', requestId: 'pi-agents',
  viewport: { columns: 160, rows: 48 },
  props: { title: 'pi agents', isFocused: true, bodyColumns: 80, placement: 'inline', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const
const SNAPSHOT = { ok: true, pin: { provider: 'local', model: 'test', source: 'project' }, settings: { questions_per_turn: { value: 5, source: 'default', project: null, user: null } }, definitions: { questions_per_turn: { default: 5, min: 0, max: 100 } }, projectPath: '/project/.claude/pi-delegate.local.md', userPath: '/profile/pi-delegate.json', warnings: [], testMode: false }
const LONG = Array.from({ length: 5 }, (_, i) => `## part ${i}\n\n` + `word${i} `.repeat(1800)).join('\n\n')

function stubAgent(on: any, session: string) {
  on('session.root', () => ({ value: '/project' }))
  on('ui.open', () => ({ value: undefined }))
  on('fs.list', ($: any, e: any) => ({ value: e.path.endsWith('/children') ? [{ name: 'scout', kind: 'directory', isLink: false }] : [] }))
  on('fs.stat', () => ({ value: { kind: 'file', size: session.length, mtimeMs: 1, isLink: false } }))
  on('fs.read', ($: any, e: any) => ({ value:
    e.path.endsWith('meta.json') ? JSON.stringify({ name: 'scout', state: 'idle', gen: 1, turn: 2, ownerClaudeSession: 'A', sessionFile: '/session.jsonl', description: 'Scout', lastTurn: { gen: 1, turn: 2, ok: true, endedAt: '2026-10-01T18:00:00Z' } })
      : e.path === '/session.jsonl' ? session
        : e.path.endsWith('events.jsonl') ? JSON.stringify({ seq: 1, ts: '2026-10-01T17:00:00Z', type: 'spawned', gen: 1, turn: 0, data: { model: 'gpt-6.1-sol' } })
          : e.path.endsWith('2-2.md') || e.path.endsWith('1-2.md') ? LONG : e.path.endsWith('1-1.md') ? 'first turn result' : '' }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify(SNAPSHOT), stderr: '' } }))
}

for (const entry of ['command', 'render']) {
  test(`reload without session.start (${entry}): list, detail tabs, turn nav and settings work`, async ($, on) => {
    mock.clock(on)
    mock.env(on, { CLAUDE_PLUGIN_ROOT: '/plugin', CLAUDE_PLUGIN_DATA: '/data' })
    const session = [
      { type: 'message', timestamp: '2026-10-01T17:00:00Z', message: { role: 'assistant', content: [{ type: 'text', text: 'transcript restored' }, { type: 'toolCall', id: 'a', name: 'read', arguments: { path: 'README.md' } }] } },
      { type: 'message', message: { role: 'toolResult', toolCallId: 'a', isError: false, content: [{ type: 'text', text: 'line\nline' }] } },
    ].map(x => JSON.stringify(x)).join('\n') + '\n'
    stubAgent(on, session)
    // Each test starts with a freshly evaluated module; deliberately NEVER raise session.start.
    if (entry === 'command') await $.command.run({ command: 'pi-delegate:agents', args: '' })
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await ui.find({ key: 'row:scout' })).toBeDefined()
    await ui.press({ key: 'row:scout' })
    expect(await ui.find({ type: 'Text', text: 'Result of turn 2' })).toBeDefined()
    // 5 x ~10k of markdown: 3 blocks under the cap, the rest announced.
    const blocks = await ui.findAll({ type: 'Markdown' })
    expect(blocks.length).toBe(3)
    expect(blocks.every(b => String(b.props.text).length <= 9500)).toBe(true)
    expect(await ui.find({ type: 'Text', text: /more characters not shown\. Ask Claude for scout's full result\./ })).toBeDefined()
    await ui.press({ key: 'key:p' })
    expect(await ui.find({ type: 'Markdown', text: 'first turn result' })).toBeDefined()
    await ui.press({ key: 'tab:activity' })
    expect(await ui.find({ key: 'step:1' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '2 lines' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /toolResult:/ })).toBeUndefined()
    await ui.press({ key: 'step:1' })
    expect(await ui.find({ type: 'Code' })).toBeDefined()
    await ui.press({ key: 'tab:log' })
    expect(await ui.find({ key: 'ev:1' })).toBeDefined()
    expect((await ui.find({ key: 'ev:1' }))?.props.label).toBe('Started · gpt-6.1-sol')
    await ui.press({ key: 'tab:questions' })
    expect(await ui.find({ type: 'Text', text: "scout hasn't asked anything." })).toBeDefined()
    await ui.press({ key: 'key:s' })
    expect(await ui.find({ type: 'Text', text: /test · from the project pin/ })).toBeDefined()
    expect((await ui.find({ key: 'set:questions_per_turn' }))?.props.autoFocus).toBe(true)
    await ui.press({ key: 'key:b' })
    expect(await ui.find({ key: 'tab:questions' })).toBeDefined()
    await ui.press({ key: 'key:b' })
    expect(await ui.find({ key: 'row:scout' })).toBeDefined()
    await ui.unmount()
  })
}

test('a bad settings reader shape shows an inline error instead of a blank pane', async ($, on) => {
  mock.clock(on)
  mock.env(on, { CLAUDE_PLUGIN_ROOT: '/plugin', CLAUDE_PLUGIN_DATA: '/data' })
  on('session.root', () => ({ value: '/project' }))
  on('fs.list', () => ({ value: [] }))
  on('ui.open', () => ({ value: undefined }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '{"ok":true,"pin":null}', stderr: '' } }))
  await $.command.run({ command: 'pi-delegate:agents', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'No pi agents in this project.' })).toBeDefined()
  await ui.press({ key: 'key:s' })
  expect(await ui.find({ type: 'Text', text: /Couldn't read settings: Settings reader returned an unexpected shape/ })).toBeDefined()
  await ui.unmount()
})
