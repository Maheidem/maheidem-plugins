// Unit tests of the pure helpers: formatting, rows, events, long text and activity steps.
import { expect, test } from 'claude-code/testing'
import {
  C, STATE, GLYPHS, NARROW_GLYPHS, safeText, jsonLines, openQuestions, age, when, duration, cost, cut,
  rowSummary, rowTail, rowAge, groupAgents, listOrder, peekLine, eventSentence, splitMarkdown, resultBlocks,
  omittedNote, buildSteps, stepRow, stripCd, answerText, wrapLines, argWords,
} from '../hooks/agents-format'
import type { Agent, Step } from '../hooks/agents-format'
import { dataPathFor, installedIdentity, loadedInline, projectSlug, settingValue } from '../hooks/shared.mjs'
import { shellQuote } from '../hooks/source'
import { local } from './agents-fixture'

const NOW = Date.parse(local(19, 0))
const agent = (meta: any, events: any[] = []): Agent => ({ name: meta.name, dir: `/c/${meta.name}`, meta, events, questions: openQuestions(events, meta), lastActivity: 0 })
const tool = (s: Step | undefined): Step & { kind: 'tool' } => {
  if (!s || s.kind !== 'tool') throw new Error('not a tool step')
  return s
}

test('journal parsing, question closing and sanitising', () => {
  const meta = { gen: 2, turn: 3 }
  const events = [
    { type: 'question', gen: 2, turn: 2, data: { toolCallId: 'old' } },
    { type: 'question', gen: 2, turn: 3, data: { toolCallId: 'closed' } },
    { type: 'answered', gen: 2, turn: 3, data: { toolCallId: 'closed' } },
    { type: 'question', gen: 2, turn: 3, data: { toolCallId: 'live' } },
  ]
  expect(jsonLines('{"seq":1}\n{"partial"')).toEqual([{ seq: 1 }])
  expect(openQuestions(events, meta).map(e => e.data?.toolCallId)).toEqual(['live'])
  expect(safeText('\x1b[2Jhello\x00 \x1b]0;title\x07ok')).toBe('hello ok')
  expect(safeText('api_key=sk-abc123 and token: xyz')).toBe('api_key=…redacted and token: …redacted')
})

test('times, durations, costs and ages are minute-granular and dated when not today', () => {
  expect(age(local(18, 58), NOW)).toBe('2m')
  expect(age(local(3, 0), NOW)).toBe('16h')
  expect(age(local(19, 0, 1), Date.parse(local(19, 0, 3)))).toBe('2d')
  expect(age('not a time', NOW)).toBe('')
  expect(when(local(18, 52), NOW)).toBe('18:52')
  expect(when(local(18, 52, 1), Date.parse(local(9, 0, 2)))).toBe('Oct 1 18:52')
  expect(duration(3100)).toBe('3.1s')
  expect(duration(400000)).toBe('6m 40s')
  expect(duration(3780000)).toBe('1h 03m')
  expect(cost(0.6139)).toBe('$0.61')
  expect(cost(0.001)).toBe('<$0.01')
  expect(cost(0)).toBe('')
})

test('list rows: summary, tail, age, grouping, list order and the line under the list', () => {
  const question = { seq: 3, type: 'question', gen: 1, turn: 2, ts: local(18, 58), data: { toolCallId: 't', question_id: 'q', topic: 'approval', text: 'Run the e2e pane test against live Claude?\nIt spends tokens.' } }
  const pitui = agent({ name: 'pitui', state: 'waiting', gen: 1, turn: 2, updatedAt: local(18, 58), description: 'TUI' }, [question])
  const fixer = agent({ name: 'fixer', state: 'running', gen: 1, turn: 1, updatedAt: local(18, 59), description: 'Fix parser' }, [{ type: 'note', ts: local(18, 59), data: { topic: 'progress', text: 'reading hooks/agents.js' } }])
  const docs = agent({ name: 'docs', state: 'idle', gen: 1, turn: 1, updatedAt: local(18, 48), description: 'Rewrite agents-viewer.md', lastTurn: { gen: 1, turn: 1, ok: true, endedAt: local(18, 48) } })
  const parked = agent({ name: 'piconfig', state: 'parked', gen: 1, turn: 1, updatedAt: local(18, 40), description: 'Configurable per-turn question budget', lastTurn: { gen: 1, turn: 1, ok: true, endedAt: local(18, 25), usage: { cost: 0.6139 } } },
    [{ seq: 9, type: 'parked', ts: local(18, 40), data: { reason: 'ttl' } }])
  const oldjob = agent({ name: 'oldjob', state: 'failed', gen: 1, turn: 2, updatedAt: local(18, 0), lastTurn: { gen: 1, turn: 2, ok: false, errorMessage: 'pi exited with code 1\nstack' } })
  const stopped = agent({ name: 'stopper', state: 'stopped', gen: 1, turn: 1, updatedAt: local(18, 30) })
  expect(rowSummary(pitui, NOW)).toBe('Run the e2e pane test against live Claude?')
  expect(rowAge(pitui, NOW)).toBe('2m')
  expect(rowSummary(fixer, NOW)).toBe('reading hooks/agents.js')
  expect(rowSummary(oldjob, NOW)).toBe('Failed · pi exited with code 1')
  // No task text: an empty summary, never a dash. The row draws "no task text".
  expect(rowSummary(stopped, NOW)).toBe('')
  expect([rowTail(docs), rowTail(parked), rowTail(stopped), rowTail(pitui)]).toEqual(['done', 'parked', 'stopped', ''])
  const stale = { ...fixer, lastActivity: NOW - 3 * 3600000 }
  expect(rowSummary(stale, NOW, 60)).toBe('last activity 3h ago · may not be running')
  const groups = groupAgents([docs, oldjob, parked, fixer, stopped, pitui])
  expect(groups.map(g => g.name)).toEqual(['Needs input', 'Working', 'Idle', 'Ended'])
  expect(groups[2]?.rows.map(a => a.name)).toEqual(['docs', 'piconfig'])
  expect(groups[3]?.rows.map(a => a.name)).toEqual(['oldjob', 'stopper'])
  expect(listOrder([docs, oldjob, parked, fixer, stopped, pitui]).map(a => a.name)).toEqual(['pitui', 'fixer', 'docs', 'piconfig', 'oldjob', 'stopper'])
  expect(peekLine(parked, NOW)).toBe('turn 1 finished 18:25 · $0.61 · parked after 15 min idle')
  // A stopped agent: plain words, not the bare state.
  expect(peekLine(stopped, NOW)).toBe('stopped 18:30 · no turn finished · a message wakes it')
  expect(cut('a-thirty-character-agent-name!', 12)).toBe('a-thirty-ch…')
})

test('mid-turn, the cost of the previous turn is labelled with its turn', () => {
  const meta = { name: 'busy', state: 'running', gen: 1, turn: 3, lastTurn: { gen: 1, turn: 2, ok: true, endedAt: '2026-10-01T18:00:00Z', usage: { cost: 0.73 } } }
  expect(peekLine(agent(meta), Date.parse('2026-10-01T18:10:00Z'))).toBe('working on turn 3 · turn 2 cost $0.73')
})

test('log events become one-line sentences in plain words; an unknown event shows no field names', () => {
  const s = (e: any, o?: any) => eventSentence({ gen: 1, turn: 5, ts: local(18, 0), ...e }, o)
  expect(s({ type: 'spawned', data: { model: 'gpt-6.1-sol', gen: 2 } }).text).toBe('Started · gpt-6.1-sol · run 2')
  expect(s({ type: 'question', data: { topic: 'approval', text: 'Run it?\nmore' } })).toEqual({ glyph: '?', color: C.warn, text: 'Asked (approval): Run it?' })
  expect(s({ type: 'answered', data: { answeredBy: 'model (relaying user)' } }).text).toBe('You answered')
  expect(s({ type: 'answered', data: { answeredBy: 'model' } }).text).toBe('Claude answered')
  expect(s({ type: 'question_expired', data: { reason: 'budget' } })).toEqual({ glyph: '◌', color: C.warn, text: "Question expired · this turn's question limit was used" })
  expect(s({ type: 'question_expired', data: { reason: 'timeout' } }).text).toBe('Question expired · no answer in time')
  expect(s({ type: 'done', data: { durationMs: 760000, usage: { cost: 1.02 } } }).text).toBe('Turn 5 finished · 12m 40s · $1.02')
  expect(s({ type: 'failed', data: { errorMessage: 'provider returned 429\ntrace' } }).text).toBe('Turn 5 failed: provider returned 429')
  expect(s({ type: 'parked', data: { reason: 'ttl' } }, { idleMinutes: 15 }).text).toBe('Parked after 15 min idle. Wakes on your next message.')
  expect(s({ type: 'parked', data: { reason: 'ttl' } }).text).toBe('Parked while idle. Wakes on your next message.')
  expect(s({ type: 'note', data: { topic: 'risk', text: 'REAL navigation\nx' } })).toEqual({ glyph: '▪', topic: 'risk', text: 'REAL navigation' })
  expect(s({ type: 'weird_thing', data: { count: 3, toolCallId: 'hidden', nested: { a: 1 } } }).text).toBe('Weird thing')
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
  const fenced = splitMarkdown('```text\n' + 'x\n'.repeat(6000) + '```', 9500)
  expect(fenced.length).toBe(1)
  expect(fenced[0]).toMatchObject({ kind: 'code', language: 'text' })
  const long = Array.from({ length: 5 }, (_, i) => `${i}`.repeat(9000)).join('\n\n')
  const r = resultBlocks(long)
  expect(r.blocks.length).toBe(3)
  expect(r.omitted).toBe(18000)
  expect(omittedNote(r.omitted, 'pitui')).toBe("… 18k more characters not shown. Ask Claude for pitui's full result.")
})

test('wrapLines cuts at spaces and never makes a line wider than the width', () => {
  const lines = wrapLines('alpha beta gamma delta epsilon zeta eta theta\n\nshort', 16)
  expect(lines).toEqual(['alpha beta gamma', 'delta epsilon', 'zeta eta theta', '', 'short'])
  for (const l of wrapLines('x'.repeat(50), 16)) expect(l.length <= 16).toBe(true)
})

test('every glyph in an aligned column is one cell wide', () => {
  const used = [...Object.values(STATE).map(s => s.glyph), ...Object.values(GLYPHS)]
  for (const g of used) expect(NARROW_GLYPHS).toContain(g)
  for (const ambiguous of ['…', '·', '─', '•', '∴', '◇', '⌛']) expect(used).not.toContain(ambiguous)
})

test('activity pairs tool calls with results into one-line steps; tool input shows values, not field names', () => {
  const entries = [
    { type: 'message', timestamp: local(18, 0), message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'x' }, { type: 'thinking', thinking: 'y' }, { type: 'text', text: "I'll read the pane module." },
      { type: 'toolCall', id: 'a', name: 'bash', arguments: { command: 'node --test tests/parser.test.ts\necho' } },
      { type: 'toolCall', id: 'b', name: 'edit', arguments: { path: 'src/parser.ts', edits: [{ oldText: 'a\nb', newText: 'c\nd\ne' }] } },
      { type: 'toolCall', id: 'c', name: 'read', arguments: { path: 'hooks/agents.js' } }] } },
    { type: 'message', message: { role: 'toolResult', toolCallId: 'a', isError: true, timestamp: Date.parse(local(18, 0)) + 2000, content: [{ type: 'text', text: 'fail\nCommand exited with code 1' }] } },
    { type: 'message', message: { role: 'toolResult', toolCallId: 'c', isError: false, timestamp: Date.parse(local(18, 0)) + 10, content: [{ type: 'text', text: 'l1\nl2\nl3' }] } },
  ]
  const { steps } = buildSteps(entries)
  expect(steps.map(s => s.kind)).toEqual(['thinking', 'prose', 'tool', 'tool', 'tool'])
  expect(stepRow(tool(steps[2]))).toMatchObject({ glyph: '✕', color: C.err, name: 'bash', arg: 'node --test tests/parser.test.ts', tail: 'exit 1 · 2.0s', tailColor: C.err })
  expect(stepRow(tool(steps[3]))).toMatchObject({ glyph: '◷', name: 'edit', add: 3, del: 2 })
  expect(stepRow(tool(steps[4]))).toMatchObject({ glyph: '✓', name: 'read', tail: '3 lines' })
  expect(argWords({ pattern: 'TODO', path: 'src', limit: 3, nested: { a: 1 } })).toBe('TODO\nsrc\n3')
})

test('bash rows drop a leading cd; ask_parent becomes note and asked steps with the answer text', () => {
  expect(stripCd('cd plugin-development/maheidem-plugins && bash tests/run_all.sh')).toBe('bash tests/run_all.sh')
  expect(stripCd("cd 'a b'; cd c && git status")).toBe('git status')
  expect(stripCd('cdx foo')).toBe('cdx foo')
  expect(answerText('[parent answered · by model (relaying user)]\nyes, use haiku\nmore')).toBe('yes, use haiku\nmore')
  expect(answerText('Note delivered to the parent (topic: x).')).toBe('')
  const { steps, byId } = buildSteps([
    { type: 'message', message: { role: 'assistant', content: [
      { type: 'toolCall', id: 'n', name: 'ask_parent', arguments: { kind: 'note', topic: 'risk', text: 'careful' } },
      { type: 'toolCall', id: 'q', name: 'ask_parent', arguments: { kind: 'question', topic: 'approval', text: 'Proceed?' } },
      { type: 'toolCall', id: 'b', name: 'bash', arguments: { command: 'cd repo && npm test' } }] } },
    { type: 'message', message: { role: 'toolResult', toolCallId: 'q', content: [{ type: 'text', text: '[parent answered · by model]\nGo ahead.' }] } },
  ])
  expect(steps.map(s => [s.kind, s.kind === 'ask' ? s.ask : undefined])).toEqual([['ask', 'note'], ['ask', 'question'], ['tool', undefined]])
  const q = byId.q
  expect(q?.kind === 'ask' ? q.answer : '').toBe('Go ahead.')
  expect(stepRow(tool(steps[2])).arg).toBe('npm test')
})

test('settings words and shell quoting', () => {
  expect(shellQuote("a'b;$(x)")).toBe("'a'\\''b;$(x)'")
  expect(settingValue('turn_timeout_minutes', 60)).toBe('60 min')
  expect(settingValue('default_thinking', 'pi-default')).toBe("pi's own")
  expect(settingValue('idle_park_minutes', 'never')).toBe('never')
})

test('the data folder follows the rule of Claude Code: install gives <name>-<marketplace>, --plugin-dir gives inline', () => {
  const installed = { plugins: { 'pi-delegate@maheidem-plugins': [{ installPath: '/home/.claude/plugins/cache/maheidem-plugins/pi-delegate/0.12.0' }] } }
  const markets = { 'maheidem-plugins': { source: { source: 'directory', path: '/source/market' } } }
  const manifests = { 'maheidem-plugins': { plugins: [{ name: 'pi-delegate', source: './plugins/pi-delegate' }] } }
  expect(installedIdentity('/home/.claude/plugins/cache/maheidem-plugins/pi-delegate/0.12.0', installed)).toBe('pi-delegate@maheidem-plugins')
  expect(installedIdentity('/source/market/plugins/pi-delegate', installed, markets, manifests)).toBe('pi-delegate@maheidem-plugins')
  // A folder no record names (a --plugin-dir copy) is not an error: it is the inline load.
  expect(installedIdentity('/tmp/copy/pi-delegate', installed, markets, manifests)).toBe('')
  expect(dataPathFor('/cfg', '')).toBe('/cfg/plugins/data/pi-delegate-inline')
  expect(dataPathFor('/cfg', 'pi-delegate@maheidem-plugins')).toBe('/cfg/plugins/data/pi-delegate-maheidem-plugins')
  expect(loadedInline('/source/market/plugins/pi-delegate', 'claude --plugin-dir /source/market/plugins/pi-delegate', '', '/x')).toBe(true)
  expect(loadedInline('/source/market/plugins/pi-delegate', 'claude --plugin-dir ../market/plugins/pi-delegate', '', '/source/x')).toBe(true)
  expect(loadedInline('/source/market/plugins/pi-delegate', 'claude', '/a:/source/market/plugins/pi-delegate', '/x')).toBe(true)
  expect(loadedInline('/source/market/plugins/pi-delegate', 'claude --plugin-dir /other', '', '/x')).toBe(false)
  expect(projectSlug('/Users/me/proj')).toBe('--Users-me-proj--')
})
