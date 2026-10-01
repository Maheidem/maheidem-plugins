import { expect, mock, test } from 'claude-code/testing'
import { shellQuote, pluginDataPath } from '../hooks/agents.js'
const PANE = {
  plugin: 'pi-delegate', component: 'Pane', requestId: 'pi-delegate-agents',
  viewport: { columns: 160, rows: 48 },
  props: { title: 'Pi agents', isFocused: true, bodyColumns: 70, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const
const snapshot = {
  ok: true, projectPath: '/scratch/.claude/pi-delegate.local.md', userPath: '/config/pi-delegate.json',
  warnings: ['Invalid user max_live_children; ignoring it'], testMode: true, overrides: { PI_MCP_TTL_MS: 1000 },
  pin: { provider: 'local', model: 'model', source: 'project' },
  definitions: { questions_per_turn: { default: 5, min: 0, max: 100, special: ['unlimited'] } },
  settings: { questions_per_turn: { value: 2, source: 'project', project: 2, user: 9 } },
}

test('shell values are single-quoted and native plugin data paths use the proper store', () => {
  expect(shellQuote("a'b;$(x)")).toBe("'a'\\''b;$(x)'")
  expect(pluginDataPath('/source/pi-delegate', '/config')).toBe('/config/plugins/data/pi-delegate-inline')
  expect(pluginDataPath('/home/.claude/plugins/cache/maheidem-plugins/pi-delegate/0.11.1', '/config')).toBe('/config/plugins/data/pi-delegate-maheidem-plugins')
})

for (const scope of ['project', 'user']) {
  test(`settings show provenance/notices; ${scope} save and inherit use supported write-config`, async ($, on) => {
    mock.clock(on)
    mock.env(on, { CLAUDE_PLUGIN_ROOT: '/plugin with spaces', CLAUDE_PLUGIN_DATA: '/data', PI_DELEGATE_VIEW_PROJECT: '/real-read-only' })
    const commands: string[] = []
    const validations: string[][] = []
    on('session.id', () => ({ value: 'own' }))
    on('session.start', () => ({ cwd: '/scratch' }))
    on('fs.list', () => ({ value: [] }))
    on('ui.open', () => ({ value: undefined }))
    on('process.run', ($, e) => {
      const argv = e.argv
      if (argv[2] === 'snapshot') {
        expect(argv[3]).toBe('/scratch') // Not the viewer live-data override!
        return { value: { exitCode: 0, stdout: JSON.stringify(snapshot), stderr: '' } }
      }
      validations.push(argv)
      const value = argv[4]
      return { value: { exitCode: value === 'bad' ? 1 : 0, stdout: JSON.stringify(value === 'bad' ? { ok: false, errorMessage: 'shared validation rejected' } : { ok: true, value }), stderr: '' } }
    })
    on('tool.call', ($, e) => { commands.push(e.command); return { result: '{"ok":true}', text: '{"ok":true}' } })
    await $.session.start({ cwd: '/scratch', surface: 'terminal', isInteractive: true })
    await $.command.run({ command: 'pi-delegate:agents', args: '' })
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: 'settings' })
    expect(await ui.find({ type: 'Text', text: /2 \(project\).*project: 2.*user: 9/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /TEST MODE ACTIVE/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Invalid user max_live_children/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Model pin.*local\/model.*project/ })).toBeDefined()
    await ui.press({ key: `scope-${scope}` })
    await ui.input({ key: 'setting-questions_per_turn', text: 'bad' })
    for (let i = 0; i < 40; i++) await Promise.resolve()
    expect(commands.length).toBe(0)
    expect(await ui.find({ type: 'Text', text: /shared validation rejected/ })).toBeDefined()
    await ui.input({ key: 'setting-questions_per_turn', text: 'unlimited' })
    for (let i = 0; i < 40; i++) await Promise.resolve()
    expect(commands[0]).toContain(`write-config --scope ${scope} --questions-per-turn 'unlimited' --json`)
    expect(commands[0]).toContain("CLAUDE_PROJECT_DIR='/scratch'")
    expect(commands[0]).toContain("'/plugin with spaces/scripts/pi-companion.mjs'")
    await ui.press({ key: 'inherit-questions_per_turn' })
    for (let i = 0; i < 40; i++) await Promise.resolve()
    expect(commands[1]).toContain(`--scope ${scope} --questions-per-turn 'inherit' --json`)
    expect(validations.map(v => v[4])).toEqual(['bad', 'unlimited', 'inherit'])
    await ui.unmount()
  })
}
