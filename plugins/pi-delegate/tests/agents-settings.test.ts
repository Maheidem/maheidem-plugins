import { expect, mock, test } from 'claude-code/testing'
import { shellQuote, pluginDataPath, settingValue } from '../hooks/agents.js'
const PANE = {
  plugin: 'pi-delegate', component: 'Pane', requestId: 'pi-agents',
  viewport: { columns: 160, rows: 48 },
  props: { title: 'pi agents', isFocused: true, bodyColumns: 80, placement: 'inline', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const
const snapshot = {
  ok: true, projectPath: '/scratch/.claude/pi-delegate.local.md', userPath: '/config/pi-delegate.json',
  warnings: ['Invalid user max_live_children; ignoring it'], testMode: true, overrides: { PI_MCP_TTL_MS: 1000 },
  pin: { provider: 'local', model: 'model', source: 'project' },
  definitions: { questions_per_turn: { default: 5, min: 0, max: 100, special: ['unlimited'] }, default_thinking: { default: 'pi-default', special: ['off', 'low', 'medium', 'high', 'pi-default'] } },
  settings: { questions_per_turn: { value: 2, source: 'project', project: 2, user: 9 }, default_thinking: { value: 'pi-default', source: 'default', project: null, user: null } },
}

test('shell values are single-quoted and native plugin data paths use the proper store', () => {
  expect(shellQuote("a'b;$(x)")).toBe("'a'\\''b;$(x)'")
  expect(settingValue('turn_timeout_minutes', 60)).toBe('60 min')
  expect(settingValue('default_thinking', 'pi-default')).toBe('pi default')
  expect(settingValue('turn_timeout_minutes', 'unlimited')).toBe('unlimited')
  expect(settingValue('idle_park_minutes', 'never')).toBe('never')
  expect(pluginDataPath('/source/pi-delegate', '/config')).toBe('/config/plugins/data/pi-delegate-inline')
  const installed = { plugins: { 'pi-delegate@maheidem-plugins': [{ installPath: '/home/.claude/plugins/cache/maheidem-plugins/pi-delegate/0.12.0' }] } }
  expect(pluginDataPath('/home/.claude/plugins/cache/maheidem-plugins/pi-delegate/0.12.0', '/config', installed)).toBe('/config/plugins/data/pi-delegate-maheidem-plugins')
  expect(pluginDataPath('/source/market/plugins/pi-delegate', '/config', installed,
    { 'maheidem-plugins': { source: { source: 'directory', path: '/source/market' } } },
    { 'maheidem-plugins': { plugins: [{ name: 'pi-delegate', source: './plugins/pi-delegate' }] } })).toBe('/config/plugins/data/pi-delegate-maheidem-plugins')
  expect(() => pluginDataPath('/unmapped', '/config', installed)).toThrow(/Cannot resolve/)
})

for (const scope of ['project', 'user'] as const) {
  test(`settings: /config-style rows, source chain, ${scope} save with read-back, reset confirm`, async ($, on) => {
    const clock = mock.clock(on)
    mock.env(on, { CLAUDE_PLUGIN_ROOT: '/plugin with spaces', CLAUDE_PLUGIN_DATA: '/data', PI_DELEGATE_VIEW_PROJECT: '/real-read-only' })
    const commands: string[] = []
    const validations: string[][] = []
    on('session.start', () => ({ cwd: '/scratch/nested' }))
    on('session.root', () => ({ value: '/scratch' }))
    on('fs.list', () => ({ value: [] }))
    on('ui.open', () => ({ value: undefined }))
    on('process.run', ($, e) => {
      const argv = e.argv
      if (argv[2] === 'snapshot') {
        expect(argv[3]).toBe('/scratch') // Not the viewer live-data override!
        return { value: { exitCode: 0, stdout: JSON.stringify(snapshot), stderr: '' } }
      }
      validations.push([...argv])
      const value = argv[4]
      return { value: { exitCode: value === 'five' ? 1 : 0, stdout: JSON.stringify(value === 'five' ? { ok: false, errorMessage: 'shared validation rejected' } : { ok: true, value }), stderr: '' } }
    })
    on('tool.call', ($, e) => { commands.push(e.command); return { result: '{"ok":true}', text: '{"ok":true}' } })
    await $.session.start({ cwd: '/scratch/nested', surface: 'terminal', isInteractive: true })
    await $.command.run({ command: 'pi-delegate:agents', args: '' })
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await ui.find({ key: 'tab:result' })).toBeUndefined()
    await ui.press({ key: 'key:s' })
    await clock.settle()
    expect((await ui.find({ key: 'set:questions_per_turn' }))?.props.autoFocus).toBe(true)
    expect(await ui.find({ type: 'Select', key: 'sel:default_thinking' })).toBeDefined()
    expect((await ui.find({ type: 'Select', key: 'scope' }))?.props.value).toBe('project')
    expect(await ui.find({ type: 'Text', text: 'this project 2 · your settings 9 · default 5' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Test mode: environment overrides active/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Invalid user max_live_children/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'model · from the project pin' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\/scratch\/\.claude/ })).toBeUndefined()
    if (scope === 'user') await ui.select({ key: 'scope', value: 'user' })
    expect(await ui.find({ key: 'set:questions_per_turn' })).toBeDefined()
    await ui.press({ key: 'set:questions_per_turn' })
    expect((await ui.find({ key: 'edit:questions_per_turn' }))?.props.submitLabel).toBe('Save')
    await ui.input({ key: 'edit:questions_per_turn', text: 'five' })
    await clock.settle()
    expect(commands.length).toBe(0)
    expect(await ui.find({ type: 'Text', text: 'Must be a whole number from 0 to 100, or unlimited. You typed "five".' })).toBeDefined()
    await ui.input({ key: 'edit:questions_per_turn', text: 'unlimited' })
    await clock.settle()
    expect(commands[0]).toContain(`write-config --scope ${scope} --questions-per-turn 'unlimited' --json`)
    expect(commands[0]).toContain("CLAUDE_PROJECT_DIR='/scratch'")
    expect(commands[0]).toContain("'/plugin with spaces/scripts/pi-companion.mjs'")
    expect(await ui.find({ type: 'Text', text: /^✓ Saved · Questions per turn is now/ })).toBeDefined()
    // Reset is two-step with Cancel focused; Cancel does nothing.
    await ui.press({ key: 'reset' })
    expect((await ui.find({ key: 'confirm:no' }))?.props.autoFocus).toBe(true)
    expect(await ui.find({ key: 'key:b' })).toBeUndefined()
    await ui.press({ key: 'confirm:no' })
    expect(commands.length).toBe(1)
    await ui.press({ key: 'reset' })
    await ui.press({ key: 'confirm:yes' })
    await clock.settle()
    expect(commands[1]).toContain(`--scope ${scope} --questions-per-turn 'inherit' --json`)
    await ui.select({ key: 'sel:default_thinking', value: 'high' })
    await clock.settle()
    expect(commands[2]).toContain(`--scope ${scope} --default-thinking 'high' --json`)
    expect(validations.map(v => v[4])).toEqual(['five', 'unlimited', 'inherit', 'high'])
    await ui.press({ key: 'key:b' })
    expect(await ui.find({ type: 'Text', text: 'No pi agents in this project.' })).toBeDefined()
    await ui.unmount()
  })
}
