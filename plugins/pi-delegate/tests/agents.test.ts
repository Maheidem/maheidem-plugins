import { expect, mock, test } from 'claude-code/testing'
import { actionReason, ageLabel, jsonLines, openQuestions, safeText } from '../hooks/agents.js'

const PANE = {
  plugin: 'pi-delegate', component: 'Pane', requestId: 'pi-delegate-agents',
  viewport: { columns: 160, rows: 48 },
  props: { title: 'Pi agents', isFocused: true, bodyColumns: 70, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const
const meta = { name: 'scout', state: 'waiting', gen: 2, turn: 3, instance: 'test', model: 'local-model', provider: 'local', ownerClaudeSession: 'foreign', createdAt: '2026-01-01T00:00:00Z' }
const events = [
  { type: 'question', gen: 2, turn: 2, data: { toolCallId: 'old' } },
  { type: 'question', gen: 2, turn: 3, data: { toolCallId: 'closed' } },
  { type: 'answered', gen: 2, turn: 3, data: { toolCallId: 'closed' } },
  { type: 'question', gen: 2, turn: 3, data: { toolCallId: 'live', question_id: 'q_live', text: 'Choose?' } },
]

test('parsing ignores partial journal lines; questions close correctly; controls are sanitized', () => {
  expect(jsonLines('{"seq":1}\n{"partial"')).toEqual([{ seq: 1 }])
  expect(openQuestions(events, meta).map(e => e.data.toolCallId)).toEqual(['live'])
  expect(safeText('\x1b[2Jhello\x00')).toBe('[2Jhello')
  expect(ageLabel('2026-01-01T00:00:00Z', Date.parse('2026-01-01T00:02:30Z'))).toBe('2m')
  expect(actionReason(meta, 'own')).toBe('Read-only: owned by another Claude session.')
  expect(actionReason(meta, 'foreign')).toBe('')
  expect(actionReason({}, 'own')).toMatch(/ownership is not recorded/)
})

test('namespaced command opens pane, reads disk only, shows foreign children read-only', async ($, on) => {
  mock.clock(on)
  mock.env(on, { CLAUDE_PLUGIN_DATA: '/data' })
  on('session.id', () => ({ value: 'own' }))
  on('session.start', () => ({ cwd: '/project' }))
  on('fs.list', () => ({ value: [{ name: 'scout', kind: 'directory', isLink: false }] }))
  on('fs.read', ($, e) => ({ value: e.path.endsWith('meta.json') ? JSON.stringify(meta) : e.path.endsWith('events.jsonl') ? events.map(e => JSON.stringify(e)).join('\n') : '' }))
  on('ui.open', () => ({ value: undefined }))
  // No tool, process, write, or model stubs: any accidental call fails the test.
  await $.session.start({ cwd: '/project', surface: 'terminal', isInteractive: true })
  const result = await $.command.run({ command: 'pi-delegate:agents', args: '' })
  expect(result).toEqual({})
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'scout' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /owned by another Claude session/ })).toBeDefined()
  expect(await ui.find({ key: 'stop' })).toBeUndefined()
  expect(await ui.find({ key: 'send' })).toBeUndefined()
  await ui.press({ key: 'questions' })
  expect(await ui.find({ type: 'Text', text: /Choose\?/ })).toBeDefined()
  await ui.unmount()
})
