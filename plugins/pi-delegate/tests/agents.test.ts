import { expect, mock, test } from 'claude-code/testing'
import {
  C, STATE, GLYPHS, NARROW_GLYPHS, safeText, jsonLines, openQuestions, age, when, duration, cost, cut,
  rowSummary, rowTail, rowAge, groupAgents, peekLine, eventSentence, rawEvent, splitMarkdown, resultBlocks,
  omittedNote, buildSteps, stepRow,
} from '../hooks/agents-format.js'

const PANE = {
  plugin: 'pi-delegate', component: 'Pane', requestId: 'pi-agents',
  viewport: { columns: 160, rows: 48 },
  props: { title: 'pi agents', isFocused: true, bodyColumns: 70, placement: 'inline', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const
const local = (h: number, m: number, day = 1) => new Date(2026, 9, day, h, m).toISOString()
const NOW = Date.parse(local(19, 0))
const agent = (meta: any, events: any[] = []) => ({ name: meta.name, dir: `/c/${meta.name}`, meta, events, questions: openQuestions(events, meta), lastActivity: 0 })

test('journal parsing, question closing and sanitising', () => {
  const meta = { gen: 2, turn: 3 }
  const events = [
    { type: 'question', gen: 2, turn: 2, data: { toolCallId: 'old' } },
    { type: 'question', gen: 2, turn: 3, data: { toolCallId: 'closed' } },
    { type: 'answered', gen: 2, turn: 3, data: { toolCallId: 'closed' } },
    { type: 'question', gen: 2, turn: 3, data: { toolCallId: 'live' } },
  ]
  expect(jsonLines('{"seq":1}\n{"partial"')).toEqual([{ seq: 1 }])
  expect(openQuestions(events, meta).map((e: any) => e.data.toolCallId)).toEqual(['live'])
  expect(safeText('\x1b[2Jhello\x00 \x1b]0;title\x07ok')).toBe('hello ok')
  expect(safeText('api_key=sk-abc123 and token: xyz')).toBe('api_key=…redacted and token: …redacted')
})

test('times, durations, costs and ages are minute-granular and dated when not today', () => {
  expect(age(local(18, 58), NOW)).toBe('2m')
  expect(age(local(18, 59, 1), NOW + 20000)).toBe('1m')
  expect(age(local(18, 59, 1), Date.parse(local(18, 59, 1)) + 30000)).toBe('<1m')
  expect(age(local(3, 0), NOW)).toBe('16h')
  expect(age(local(19, 0, 1), Date.parse(local(19, 0, 3)))).toBe('2d')
  expect(when(local(18, 52), NOW)).toBe('18:52')
  expect(when(local(18, 52, 1), Date.parse(local(9, 0, 2)))).toBe('Oct 1 18:52')
  expect(duration(3100)).toBe('3.1s')
  expect(duration(400000)).toBe('6m 40s')
  expect(duration(3780000)).toBe('1h 03m')
  expect(cost(0.6139)).toBe('$0.61')
  expect(cost(0.001)).toBe('<$0.01')
  expect(cost(0)).toBe('')
})

test('list rows: summary, tail, age, grouping and peek line', () => {
  const question = { seq: 3, type: 'question', gen: 1, turn: 2, ts: local(18, 58), data: { toolCallId: 't', question_id: 'q', topic: 'approval', text: 'Run the e2e pane test against live Claude?\nIt spends tokens.' } }
  const pitui = agent({ name: 'pitui', state: 'waiting', gen: 1, turn: 2, updatedAt: local(18, 58), description: 'TUI' }, [question])
  const fixer = agent({ name: 'fixer', state: 'running', gen: 1, turn: 1, updatedAt: local(18, 59), description: 'Fix parser' }, [{ type: 'note', ts: local(18, 59), data: { topic: 'progress', text: 'reading hooks/agents.js' } }])
  const docs = agent({ name: 'docs', state: 'idle', gen: 1, turn: 1, updatedAt: local(18, 48), description: 'Rewrite agents-viewer.md', lastTurn: { gen: 1, turn: 1, ok: true, endedAt: local(18, 48) } })
  const parked = agent({ name: 'piconfig', state: 'parked', gen: 1, turn: 1, updatedAt: local(18, 40), description: 'Configurable per-turn question budget', lastTurn: { gen: 1, turn: 1, ok: true, endedAt: local(18, 25), usage: { cost: 0.6139 } } },
    [{ seq: 9, type: 'parked', ts: local(18, 40), data: { reason: 'ttl' } }])
  const oldjob = agent({ name: 'oldjob', state: 'failed', gen: 1, turn: 2, updatedAt: local(18, 0), lastTurn: { gen: 1, turn: 2, ok: false, errorMessage: 'pi exited with code 1\nstack' } })
  const stopped = agent({ name: 'stopper', state: 'stopped', gen: 1, turn: 1, updatedAt: local(18, 30), description: 'Old task' })
  expect(rowSummary(pitui, NOW)).toBe('Run the e2e pane test against live Claude?')
  expect(rowAge(pitui, NOW)).toBe('2m')
  expect(rowSummary(fixer, NOW)).toBe('reading hooks/agents.js')
  expect(rowSummary(oldjob, NOW)).toBe('Failed · pi exited with code 1')
  expect([rowTail(docs), rowTail(parked), rowTail(stopped), rowTail(pitui)]).toEqual(['done', 'parked', 'stopped', ''])
  const stale = { ...fixer, lastActivity: NOW - 3 * 3600000 }
  expect(rowSummary(stale, NOW, 60)).toBe('last activity 3h ago · may not be running')
  const groups = groupAgents([docs, oldjob, parked, fixer, stopped, pitui])
  expect(groups.map(g => g.name)).toEqual(['Needs input', 'Working', 'Idle', 'Ended'])
  expect(groups[2].rows.map(a => a.name)).toEqual(['docs', 'piconfig'])
  expect(groups[3].rows.map(a => a.name)).toEqual(['oldjob', 'stopper'])
  expect(peekLine(parked, NOW)).toBe('turn 1 finished 18:25 · $0.61 · parked after 15 min idle')
  expect(cut('a-thirty-character-agent-name!', 12)).toBe('a-thirty-ch…')
})

test('log events become one-line sentences with their glyphs', () => {
  const s = (e: any, o?: any) => eventSentence({ gen: 1, turn: 5, ts: local(18, 0), ...e }, o)
  expect(s({ type: 'spawned', data: { model: 'gpt-6.1-sol', gen: 2 } }).text).toBe('Started · gpt-6.1-sol · run 2')
  expect(s({ type: 'question', data: { topic: 'approval', text: 'Run it?\nmore' } })).toEqual({ glyph: '?', color: C.warn, text: 'Asked (approval): Run it?' })
  expect(s({ type: 'answered', data: { answeredBy: 'model (relaying user)' } }).text).toBe('You answered')
  expect(s({ type: 'answered', data: { answeredBy: 'model' } }).text).toBe('Claude answered')
  expect(s({ type: 'question_expired', data: { reason: 'budget' } })).toEqual({ glyph: '◌', color: C.warn, text: "Question expired · this turn's question limit was used" })
  expect(s({ type: 'done', data: { durationMs: 760000, usage: { cost: 1.02 } } }).text).toBe('Turn 5 finished · 12m 40s · $1.02')
  expect(s({ type: 'failed', data: { errorMessage: 'provider returned 429\ntrace' } }).text).toBe('Turn 5 failed: provider returned 429')
  expect(s({ type: 'parked', data: { reason: 'ttl' } }, { idleMinutes: 15 }).text).toBe('Parked after 15 min idle. Wakes on your next message.')
  expect(s({ type: 'note', data: { topic: 'risk', text: 'REAL navigation\nx' } })).toEqual({ glyph: '▪', topic: 'risk', text: 'REAL navigation' })
  expect(s({ type: 'weird_thing', data: { count: 3, toolCallId: 'hidden', nested: { a: 1 } } }).text).toBe('Weird thing · count: 3')
  expect(rawEvent({ type: 'answered', gen: 1, turn: 1, data: { toolCallId: 'x', path: '/askdir/x.json', answeredBy: 'model' } })).not.toMatch(/toolCallId|askdir/)
})

test('markdown is split under the cap at blank lines, never inside a fence; cuts are announced', () => {
  const para = (n: number) => `para ${n} `.repeat(8).trim()
  const fence = '```js\nconst a = 1\n\nconst b = 2\n\nconst c = 3\n```'
  const text = [para(1), para(2), fence, para(3), para(4)].join('\n\n')
  const blocks = splitMarkdown(text, 120)
  for (const b of blocks) {
    expect(b.text.length <= 120 || b.kind === 'code').toBe(true)
    expect(((b.text.match(/```/g) || []).length) % 2).toBe(0)
  }
  expect(blocks.map(b => b.text).join('\n\n')).toBe(text)
  const huge = '```text\n' + 'x\n'.repeat(6000) + '```'
  const fenced = splitMarkdown(huge, 9500)
  expect(fenced.length).toBe(1)
  expect(fenced[0]).toMatchObject({ kind: 'code', language: 'text' })
  expect(fenced[0].text.split('\n').length).toBe(6000)
  const long = Array.from({ length: 5 }, (_, i) => `${i}`.repeat(9000)).join('\n\n')
  const r = resultBlocks(long)
  expect(r.blocks.length).toBe(3)
  expect(r.blocks.every(b => b.text.length <= 9500)).toBe(true)
  expect(r.omitted).toBe(18000)
  expect(omittedNote(r.omitted, 'pitui')).toBe("… 18k more characters not shown. Ask Claude for pitui's full result.")
})

test('every glyph in an aligned column is one cell wide', () => {
  const used = [...Object.values(STATE).map(s => s.glyph), ...Object.values(GLYPHS)]
  for (const g of used) expect(NARROW_GLYPHS).toContain(g)
  for (const ambiguous of ['…', '·', '─', '•', '∴', '◇', '⌛']) expect(used).not.toContain(ambiguous)
})

test('activity pairs tool calls with results into one-line steps', () => {
  const entries = [
    { type: 'message', timestamp: local(18, 0), message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'x' }, { type: 'thinking', thinking: 'y' }, { type: 'text', text: "I'll read the pane module." },
      { type: 'toolCall', id: 'a', name: 'bash', arguments: { command: 'node --test tests/parser.test.ts\necho' } },
      { type: 'toolCall', id: 'b', name: 'edit', arguments: { path: 'src/parser.ts', edits: [{ oldText: 'a\nb', newText: 'c\nd\ne' }] } },
      { type: 'toolCall', id: 'c', name: 'read', arguments: { path: 'hooks/agents.js' } }] } },
    { type: 'message', message: { role: 'toolResult', toolCallId: 'a', isError: true, timestamp: Date.parse(local(18, 0)) + 2000, content: [{ type: 'text', text: 'fail\nCommand exited with code 1' }] } },
    { type: 'message', message: { role: 'toolResult', toolCallId: 'c', isError: false, timestamp: Date.parse(local(18, 0)) + 10, content: [{ type: 'text', text: 'l1\nl2\nl3' }] } },
  ]
  const { steps } = buildSteps(entries)
  expect(steps.map((s: any) => s.kind)).toEqual(['thinking', 'prose', 'tool', 'tool', 'tool'])
  expect(steps[0].count).toBe(2)
  expect(stepRow(steps[2])).toMatchObject({ glyph: '✕', color: C.err, name: 'bash', arg: 'node --test tests/parser.test.ts', tail: 'exit 1 · 2.0s', tailColor: C.err })
  expect(stepRow(steps[3])).toMatchObject({ glyph: '◷', name: 'edit', add: 3, del: 2 })
  expect(stepRow(steps[4])).toMatchObject({ glyph: '✓', name: 'read', tail: '3 lines' })
})

test('list renders grouped rows with no ownership gate, an answer card, and collapsed Ended', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.env(on, { CLAUDE_PLUGIN_DATA: '/data' })
  const metas: Record<string, any> = {
    pitui: { name: 'pitui', state: 'waiting', gen: 1, turn: 2, updatedAt: local(18, 58), ownerClaudeSession: 'A', description: 'TUI' },
    fixer: { name: 'fixer', state: 'running', gen: 1, turn: 1, updatedAt: local(18, 59), ownerClaudeSession: 'A' },
    ...Object.fromEntries(['e1', 'e2', 'e3', 'e4', 'e5'].map((n, i) => [n, { name: n, state: 'stopped', gen: 1, turn: 1, updatedAt: local(10 + i, 0), ownerClaudeSession: 'A', description: `old ${n}` }])),
  }
  const question = { seq: 1, type: 'question', gen: 1, turn: 2, ts: local(18, 58), data: { toolCallId: 't', question_id: 'q_1', topic: 'approval', text: 'Run the e2e pane test?' } }
  on('session.id', () => ({ value: 'B' }))
  on('session.root', () => ({ value: '/project' }))
  on('fs.list', ($, e) => ({ value: e.path.endsWith('/children') ? Object.keys(metas).map(name => ({ name, kind: 'directory', isLink: false })) : [] }))
  on('fs.read', ($, e) => {
    const name = e.path.split('/').at(-2)!
    return { value: e.path.endsWith('meta.json') ? JSON.stringify(metas[name]) : e.path.endsWith('events.jsonl') && name === 'pitui' ? JSON.stringify(question) : '' }
  })
  on('ui.open', () => ({ value: undefined }))
  await $.command.run({ command: 'pi-delegate:agents', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Read-only/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '1 needs input' })).toBeDefined()
  const headers = (await ui.findAll({ type: 'Text' })).map(t => t.text).filter(t => ['Needs input', 'Working', 'Ended', 'Idle'].includes(t))
  expect(headers).toEqual(['Needs input', 'Working', 'Ended'])
  expect((await ui.find({ key: 'row:pitui' }))?.props.autoFocus).toBe(true)
  expect(await ui.find({ key: 'answer:pitui:q_1' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /pitui asks · approval/ })).toBeDefined()
  expect((await ui.find({ key: 'more-ended' }))?.props.label).toBe('  … 2 more ended · show')
  expect((await ui.find({ key: 'key:a' }))?.props.hotkey).toBe('a')
  expect((await ui.find({ key: 'key:x' }))?.props.hotkey).toBe('x')
  await ui.press({ key: 'more-ended' })
  expect(await ui.find({ key: 'row:e1' })).toBeDefined()
  await ui.unmount()
})

test('one agent in one group draws no group header; peek line uses words, not codes', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.env(on, { CLAUDE_PLUGIN_DATA: '/data' })
  const meta = { name: 'piconfig', state: 'parked', gen: 1, turn: 1, updatedAt: local(18, 40), description: 'Configurable per-turn question budget', ownerClaudeSession: 'A', lastTurn: { gen: 1, turn: 1, ok: true, endedAt: local(18, 25), usage: { cost: 0.61 } } }
  on('session.root', () => ({ value: '/project' }))
  on('fs.list', ($, e) => ({ value: e.path.endsWith('/children') ? [{ name: 'piconfig', kind: 'directory', isLink: false }] : [] }))
  on('fs.read', ($, e) => ({ value: e.path.endsWith('meta.json') ? JSON.stringify(meta) : e.path.endsWith('events.jsonl') ? JSON.stringify({ seq: 2, type: 'parked', ts: local(18, 40), data: { reason: 'ttl' } }) : '' }))
  on('ui.open', () => ({ value: undefined }))
  await $.command.run({ command: 'pi-delegate:agents', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'Idle' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'turn 1 finished 18:25 · $0.61 · parked after 15 min idle' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /g1\/t1|Q:0|disk snapshot/ })).toBeUndefined()
  expect(await ui.find({ key: 'key:m' })).toBeDefined()
  await ui.unmount()
})

test('band: one warning line for a waiting agent, Open button without a digit hotkey, hidden while the pane is open', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  // What the engine draws when the band passes (nothing to show).
  on('ui.render', ($, e) => $.ui.resolve(e).Box({}))
  mock.env(on, { CLAUDE_PLUGIN_DATA: '/data' })
  let open = false
  const meta = { name: 'pitui', state: 'waiting', gen: 1, turn: 2, updatedAt: local(18, 58) }
  const question = { seq: 1, type: 'question', gen: 1, turn: 2, ts: local(18, 58), data: { toolCallId: 't', question_id: 'q_1', text: 'Run the e2e pane test?' } }
  on('session.root', () => ({ value: '/project' }))
  on('fs.list', ($, e) => ({ value: e.path.endsWith('/children') ? [{ name: 'pitui', kind: 'directory', isLink: false }] : [] }))
  on('fs.read', ($, e) => ({ value: e.path.endsWith('meta.json') ? JSON.stringify(meta) : e.path.endsWith('events.jsonl') ? JSON.stringify(question) : '' }))
  on('session.start', () => ({ cwd: '/project' }))
  on('ui.panes', () => ({ value: open ? [{ id: 'pi-agents', title: 'pi agents', isShown: true, isFocused: true, isPlaced: true }] : [] }))
  on('ui.open', () => { open = true; return { value: { isPlaced: true } } })
  await $.session.start({ cwd: '/project', surface: 'terminal', isInteractive: true })
  await clock.advance(2000) // the module-scope refresh tick reads the agents
  const band = await $.ui.mount({ plugin: 'pi-delegate', surface: 'terminal', component: 'AbovePrompt', viewport: { columns: 120, rows: 40 },
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} } } as any)
  expect(await band.find({ type: 'Text', text: ' needs input' })).toBeDefined()
  const button = await band.find({ key: 'band:open' })
  expect(button?.props.label).toBe('Open')
  expect(button?.props.hotkey).toBeUndefined()
  await band.press({ key: 'band:open' })
  expect(open).toBe(true)
  await band.redraw()
  expect(await band.find({ key: 'band:open' })).toBeUndefined()
  await band.unmount()
})
