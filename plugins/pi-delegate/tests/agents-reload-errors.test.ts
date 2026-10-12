// Errors in plain words: an unreadable agents folder, an unreadable agent record, and an error that clears.
import { expect, test } from 'claude-code/testing'
import { RUN, agentMeta, mount, screen, stubs } from './agents-fixture'
import type { Disk } from './agents-fixture'

test('an unreadable agents folder shows the error view with retry, and retry recovers', async ($, on) => {
  const disk: Disk = { metas: { scout: agentMeta('scout', 'idle') }, events: {}, files: {}, listError: () => 'EACCES: permission denied' }
  const { clock } = stubs(on, disk)
  await $.command.run(RUN)
  await clock.settle()
  const ui = await $.ui.mount(mount())
  const text = await screen(ui)
  expect(text).toContain("Can't read agents")
  expect(text).toMatch(/✕ The agents of this project could not be read\./)
  expect(text).toContain('r: retry')
  disk.listError = undefined
  await ui.press({ key: 'act:r' })
  await clock.settle()
  expect(await ui.find({ key: 'row:scout' })).toBeDefined()
  await ui.unmount()
})

test('bug 4: the error clears by itself on the next good read', async ($, on) => {
  let broken = true
  const disk: Disk = { metas: { scout: agentMeta('scout', 'idle') }, events: {}, files: {}, listError: () => (broken ? 'EACCES: permission denied' : '') }
  const { clock } = stubs(on, disk)
  await $.command.run(RUN)
  await clock.settle()
  const ui = await $.ui.mount(mount())
  expect(await screen(ui)).toContain("Can't read agents")
  broken = false
  await clock.advance(2000)
  await clock.settle()
  expect(await screen(ui)).not.toContain("Can't read agents")
  expect(await ui.find({ key: 'row:scout' })).toBeDefined()
  await ui.unmount()
})

test('an unreadable agent record lists as "can\'t read" while the rest still list', async ($, on) => {
  const disk: Disk = { metas: { good: agentMeta('good', 'idle'), broken: '{not json' }, events: {}, files: {} }
  const { clock } = stubs(on, disk)
  await $.command.run(RUN)
  await clock.settle()
  const ui = await $.ui.mount(mount())
  expect(await ui.find({ key: 'row:good' })).toBeDefined()
  expect(await ui.find({ key: 'row:broken' })).toBeDefined()
  expect(await screen(ui)).toContain("Couldn't read this agent's record")
  await ui.unmount()
})
