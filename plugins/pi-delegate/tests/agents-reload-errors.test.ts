import { expect, mock, test } from 'claude-code/testing'
const PANE = {
  plugin: 'pi-delegate', component: 'Pane', requestId: 'pi-agents',
  viewport: { columns: 160, rows: 48 },
  props: { title: 'pi agents', isFocused: true, bodyColumns: 70, placement: 'inline', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

test('an unreadable agents folder shows E1 with retry, and retry recovers', async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, { CLAUDE_PLUGIN_DATA: '/data' })
  let broken = true
  on('session.root', () => ({ value: '/project' }))
  on('ui.open', () => ({ value: undefined }))
  on('fs.list', ($, e) => {
    if (broken) throw new Error('EACCES: permission denied')
    return { value: e.path.endsWith('/children') ? [{ name: 'scout', kind: 'directory', isLink: false }] : [] }
  })
  on('fs.read', ($, e) => ({ value: e.path.endsWith('meta.json') ? '{"name":"scout","state":"idle","gen":1,"turn":1}' : '' }))
  await $.command.run({ command: 'pi-delegate:agents', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: "can't read agents" })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^✕ .+/ })).toBeDefined()
  expect((await ui.find({ key: 'retry' }))?.props.hotkey).toBe('r')
  broken = false
  await ui.press({ key: 'retry' })
  await clock.settle()
  expect(await ui.find({ key: 'row:scout' })).toBeDefined()
  await ui.unmount()
})

test('an unreadable agent record lists as "can\'t read" while the rest still list', async ($, on) => {
  mock.clock(on)
  mock.env(on, { CLAUDE_PLUGIN_DATA: '/data' })
  on('session.root', () => ({ value: '/project' }))
  on('ui.open', () => ({ value: undefined }))
  on('fs.list', ($, e) => ({ value: e.path.endsWith('/children') ? [{ name: 'good', kind: 'directory', isLink: false }, { name: 'broken', kind: 'directory', isLink: false }]
    : [{ name: 'meta.json', kind: 'file', size: 5, mtimeMs: 1, isLink: false }] }))
  on('fs.read', ($, e) => ({ value: e.path.includes('/broken/') ? '{not json' : e.path.endsWith('meta.json') ? '{"name":"good","state":"idle","gen":1,"turn":1}' : '' }))
  await $.command.run({ command: 'pi-delegate:agents', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'row:good' })).toBeDefined()
  expect(await ui.find({ key: 'row:broken' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: "Couldn't read this agent's record" })).toBeDefined()
  await ui.unmount()
})
