// The settings screen: the rows, the source chain, a save with read-back, the reset question,
// and the pointer that follows the ring (bug 8). Esc while editing (bug 17) is in agents-keys.test.ts.
import { expect, test } from 'claude-code/testing'
import { settingOf } from '../hooks/model'
import { RUN, arrowTo, inputKey, mount, pointed, screen, stubs } from './agents-fixture'
import type { Disk } from './agents-fixture'

const snapshot = {
  ok: true, projectPath: '/scratch/.claude/pi-delegate.local.md', userPath: '/home/.claude/pi-delegate.json',
  warnings: ['Invalid user max_live_children; ignoring it'], testMode: true, overrides: { PI_MCP_TTL_MS: 1000 },
  pin: { provider: 'local', model: 'model', source: 'project' },
  definitions: { questions_per_turn: { default: 5, min: 0, max: 100, special: ['unlimited'] }, turn_timeout_minutes: { default: 60, min: 1, max: 1440, special: ['unlimited'] }, default_thinking: { default: 'pi-default', special: ['off', 'low', 'medium', 'high', 'pi-default'] } },
  settings: {
    questions_per_turn: { value: 2, source: 'project', project: 2, user: 9 },
    turn_timeout_minutes: { value: 60, source: 'default', project: null, user: null },
    default_thinking: { value: 'pi-default', source: 'default', project: null, user: null },
  },
}

function disk(validations: string[][]): Disk {
  return {
    metas: {}, events: {}, files: {},
    run: argv => {
      if (argv[2] === 'snapshot') {
        expect(argv[3]).toBe('/project') // the session folder, not the viewer's data override
        return { exitCode: 0, stdout: JSON.stringify(snapshot) }
      }
      if (argv[2] === 'validate') {
        validations.push([...argv])
        const value = argv[4]
        return value === 'five' ? { exitCode: 1, stdout: JSON.stringify({ ok: false, errorMessage: 'Invalid questions_per_turn: "five"' }) } : { exitCode: 0, stdout: JSON.stringify({ ok: true, value }) }
      }
      return { exitCode: 0, stdout: '' }
    },
  }
}

for (const scope of ['project', 'user'] as const) {
  test(`settings: rows, source chain, ${scope} save with read-back, reset question`, async ($, on) => {
    const validations: string[][] = []
    const { clock, host } = stubs(on, disk(validations), { env: { PI_DELEGATE_VIEW_PROJECT: '/real-read-only' } })
    await $.command.run(RUN)
    await clock.settle()
    const ui = await $.ui.mount(mount())
    expect(await ui.find({ key: 'tab:result' })).toBeUndefined()
    await ui.press({ key: 'act:s' })
    await clock.settle()
    const text = await screen(ui)
    expect((await ui.find({ key: 'set:questions_per_turn' }))?.props.autoFocus).toBe(true)
    expect(text).toContain('this project: 2 · your settings: 9 · default: 5')
    expect(text).toContain('Saves to .claude/pi-delegate.local.md in this project.')
    expect(text).toContain('Test mode: environment overrides are active')
    expect(text).not.toContain('PI_MCP_TTL_MS') // no internal names
    expect(text).toContain('Invalid user max_live_children')
    expect(text).toContain('model · from the project pin')
    expect(text).toContain('This project ▾')
    if (scope === 'user') {
      await ui.press({ key: 'set:scope' })
      await clock.settle()
      await ui.select({ key: 'pick:scope', value: 'user' })
      await clock.settle()
      expect(await screen(ui)).toContain('Your user settings ▾')
      expect(await screen(ui)).toContain('Saves to ~/.claude/pi-delegate.json')
      await $.ui.focus(arrowTo('set:questions_per_turn'))
    }
    await ui.press({ key: 'set:questions_per_turn' })
    await clock.settle()
    const field = await inputKey(ui, 'in:set:questions_per_turn#')
    expect((await ui.find({ key: field }))?.props.submitLabel).toBe('save')
    expect(await screen(ui)).toContain('    0–100 or unlimited · now 2 (project)')
    expect((await screen(ui)).split('\n').filter(l => /Enter to save/.test(l)).length).toBe(1)
    await ui.input({ key: field, text: 'five' })
    await clock.settle()
    expect(host.calls.length).toBe(0)
    // Bug 12: plain words, no internal key and no JSON in the error.
    expect(await screen(ui)).toContain('✕ Must be a whole number from 0 to 100, or unlimited. You typed "five".')
    expect(await screen(ui)).not.toContain('Invalid questions_per_turn')
    await ui.input({ key: await inputKey(ui, 'in:set:questions_per_turn#'), text: 'unlimited' })
    await clock.settle()
    expect(String(host.calls[0]?.command)).toContain(`write-config --scope ${scope} --questions-per-turn 'unlimited' --json`)
    expect(String(host.calls[0]?.command)).toContain("CLAUDE_PROJECT_DIR='/project'")
    expect(await screen(ui)).toMatch(/✓ Saved · Questions per turn is now/)
    // Reset asks first with cancel focused; cancel does nothing.
    await ui.press({ key: 'act:r' })
    await clock.settle()
    expect(await ui.find({ key: 'confirm:no' })).toBeDefined()
    expect(await screen(ui)).toContain('Reset Questions per turn')
    await ui.press({ key: 'confirm:no' })
    await clock.settle()
    expect(host.calls.length).toBe(1)
    await ui.press({ key: 'act:r' })
    await clock.settle()
    await ui.press({ key: 'confirm:yes' })
    await clock.settle()
    expect(String(host.calls[1]?.command)).toContain(`--scope ${scope} --questions-per-turn 'inherit' --json`)
    expect(validations.map(v => v[4])).toEqual(['five', 'unlimited', 'inherit'])
    // The command lands on the list again.
    await $.command.run(RUN)
    await clock.settle()
    expect(await screen(ui)).toContain('No pi agents in this project.')
    await ui.unmount()
  })
}

test('bug 8: the pointer follows the ring, survives a reopen, and r resets the row that has it', async ($, on) => {
  const { clock } = stubs(on, disk([]))
  await $.command.run(RUN)
  await clock.settle()
  const ui = await $.ui.mount(mount())
  await ui.press({ key: 'act:s' })
  await clock.settle()
  await $.ui.focus(arrowTo('set:turn_timeout_minutes'))
  await clock.settle()
  expect(await pointed(ui)).toContain('Turn time limit')
  expect(await screen(ui)).toContain('The time budget for one turn')
  await $.command.run(RUN) // the command lands on the list
  await clock.settle()
  await ui.press({ key: 'act:s' }) // open the settings again
  await clock.settle()
  expect(await pointed(ui)).toContain('Turn time limit')
  expect((await ui.find({ key: 'set:turn_timeout_minutes' }))?.props.autoFocus).toBe(true)
  await ui.press({ key: 'act:r' })
  await clock.settle()
  expect(await screen(ui)).toContain('Reset Turn time limit')
  await ui.press({ key: 'confirm:no' })
  await clock.settle()
  // Enter edits the row that has the pointer; the field keeps the pointer on that row.
  await ui.press({ key: 'set:turn_timeout_minutes' })
  await clock.settle()
  expect(await inputKey(ui, 'in:set:turn_timeout_minutes#')).not.toBe('')
  await $.ui.focus(arrowTo(await inputKey(ui, 'in:set:turn_timeout_minutes#')))
  expect(await screen(ui)).toContain('1–1440 or unlimited · now 60 min (default)')
  expect(settingOf({ focusKey: 'in:set:turn_timeout_minutes#4' } as any)).toBe('turn_timeout_minutes')
  await ui.unmount()
})

test('a bad settings reader shape shows an error line in plain words instead of a blank pane', async ($, on) => {
  const { clock } = stubs(on, { metas: {}, events: {}, files: {}, run: argv => (argv[2] === 'snapshot' ? { exitCode: 0, stdout: '{"ok":true,"pin":null}' } : { exitCode: 0, stdout: '' }) })
  await $.command.run(RUN)
  await clock.settle()
  const ui = await $.ui.mount(mount())
  expect(await screen(ui)).toContain('No pi agents in this project.')
  await ui.press({ key: 'act:s' })
  await clock.settle()
  expect(await screen(ui)).toContain("Couldn't read the settings: The settings reader gave data in a form the pane does not know.")
  await ui.unmount()
})
