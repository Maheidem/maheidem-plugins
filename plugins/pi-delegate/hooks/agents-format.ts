// Pure formatting for the agents pane: no `$`, no I/O, so every rule here is unit-tested.
import type { ThemeKey } from 'claude-code'
import { cells, cut as kitCut } from './kit/format'

// Every colour the pane uses: ThemeKeys only. Each colour also has a glyph or a word.
export const C = { warn: 'warning', err: 'error', ok: 'success', off: 'inactive', add: 'diffAddedWord', del: 'diffRemovedWord' } as const satisfies Record<string, ThemeKey>

// The data of one agent, as the MCP server writes it. Disk data is untrusted: every field is optional.
export type Usage = { cost?: number; contextTokens?: number }
export type LastTurn = { gen?: number; turn?: number; ok?: boolean; endedAt?: string; errorMessage?: string; reason?: string; usage?: Usage }
export type Meta = {
  name?: string; state?: string; gen?: number; turn?: number; instance?: string; description?: string; model?: string; provider?: string
  updatedAt?: string; createdAt?: string; sessionFile?: unknown; reason?: string; lastTurn?: LastTurn; launch?: { turnTimeoutMs?: number }
}
export type EvData = { [key: string]: any }
export type Ev = { seq?: number; ts?: string; type?: string; gen?: number; turn?: number; data?: EvData }
export type Agent = { name: string; dir: string; broken?: true; meta: Meta; events: Ev[]; questions: Ev[]; lastActivity: number }

// Glyphs drawn in aligned columns. All are East-Asian-Width N or Na (one cell).
export type StateKey = 'waiting' | 'working' | 'done' | 'parked' | 'stopped' | 'failed' | 'broken'
export const STATE: { readonly [K in StateKey]: { glyph: string; word: string; color?: ThemeKey; bold?: true } } = {
  waiting: { glyph: '?', word: 'asking', color: C.warn, bold: true },
  working: { glyph: '✻', word: 'working', bold: true },
  done: { glyph: '✓', word: 'done', color: C.ok },
  parked: { glyph: '∙', word: 'parked', color: C.off },
  stopped: { glyph: '◦', word: 'stopped', color: C.off },
  failed: { glyph: '✕', word: 'failed', color: C.err },
  broken: { glyph: '!', word: "can't read", color: C.warn },
}
export const GLYPHS = { ok: '✓', err: '✕', flight: '◷', thinking: '~', started: '▸', asked: '?', answered: '↩', expired: '◌', note: '▪', stopped: '◦', parked: '∙', you: '›', pointer: '❯', other: '-' } as const
// Width-safe set checked with python3 unicodedata.east_asian_width.
export const NARROW_GLYPHS = ['?', '✻', '✓', '∙', '◦', '✕', '❯', '◌', '◷', '▪', '↩', '▸', '⏎', '▾', '›', '~', '-', '!']

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad2 = (n: number): string => String(n).padStart(2, '0')

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]/g
const SECRET = /(api[_-]?key|token|secret|authorization|password)(\s*[:=]\s*)\S+/gi

// Disk text is untrusted: strip escapes and control characters (tab and
// newline survive), and redact obvious credentials before any element sees it.
export function safeText(value: unknown): string {
  return String(value ?? '').replace(ANSI, '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').replace(SECRET, '$1$2…redacted')
}
export function oneLine(value: unknown): string {
  return safeText(value).replace(/\s+/g, ' ').trim()
}
export function firstLine(value: unknown): string {
  return safeText(value).split('\n').map(l => l.trim()).find(Boolean) ?? ''
}
// Cut ahead of time (Buttons cannot truncate), measured in terminal cells.
export function cut(value: unknown, width: number): string {
  return kitCut(value, width)
}
export function kChars(n: number): string {
  return n < 1000 ? String(n) : `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
}

const parse = (ts: unknown): number => (typeof ts === 'number' ? ts : Date.parse(String(ts ?? '')))
export function sameDay(a: unknown, b: unknown): boolean {
  const x = new Date(parse(a))
  const y = new Date(parse(b))
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate()
}
export function hhmm(ts: unknown): string {
  const d = new Date(parse(ts))
  return Number.isNaN(d.getTime()) ? '--:--' : `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}
export function dayLabel(ts: unknown, now: number): string {
  const d = new Date(parse(ts))
  if (Number.isNaN(d.getTime())) return 'Unknown day'
  return sameDay(ts, now) ? 'Today' : `${MONTHS[d.getMonth()] ?? ''} ${d.getDate()}`
}
// `18:52` today, `Oct 1 18:52` otherwise.
export function when(ts: unknown, now: number): string {
  const d = new Date(parse(ts))
  if (Number.isNaN(d.getTime())) return ''
  return sameDay(ts, now) ? hhmm(ts) : `${MONTHS[d.getMonth()] ?? ''} ${d.getDate()} ${hhmm(ts)}`
}
// Minute-granular ages: <1m 12m 16h 2d. An unknown time gives ''.
export function age(ts: unknown, now: number): string {
  const ms = now - parse(ts)
  if (!Number.isFinite(ms)) return ''
  const m = Math.floor(Math.max(0, ms) / 60000)
  return m < 1 ? '<1m' : m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`
}
export function duration(ms: unknown): string {
  const n = Number(ms)
  if (ms === undefined || ms === null || !Number.isFinite(n) || n < 0) return ''
  if (n < 60000) return `${(n / 1000).toFixed(1)}s`
  const s = Math.round(n / 1000)
  if (s < 3600) return `${Math.floor(s / 60)}m ${pad2(s % 60)}s`
  return `${Math.floor(s / 3600)}h ${pad2(Math.floor((s % 3600) / 60))}m`
}
export function cost(value: unknown): string {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return ''
  return n < 0.01 ? '<$0.01' : `$${n.toFixed(2)}`
}
export function contextLabel(tokens: unknown): string {
  const n = Number(tokens)
  return Number.isFinite(n) && n > 0 ? `${Math.round(n / 1000)}k context` : ''
}
export function modelLabel(model: unknown): string {
  return String(model ?? '').split('/').pop() ?? ''
}

export function jsonLines(raw: string): any[] {
  return String(raw).split('\n').flatMap(line => {
    try { return line.trim() ? [JSON.parse(line)] : [] } catch { return [] }
  })
}
export function openQuestions(events: readonly Ev[], meta: Meta): Ev[] {
  const closed = new Set(events.filter(e => e.type === 'answered' || e.type === 'question_expired').map(e => e.data?.toolCallId))
  return events.filter(e => e.type === 'question' && e.gen === meta.gen && e.turn === meta.turn && !closed.has(e.data?.toolCallId))
}
// The id the server knows an open question by.
export function questionId(q: Ev | undefined): string {
  return String(q?.data?.question_id || q?.data?.toolCallId || '')
}

// ---- agent rows ---------------------------------------------------------

export const GROUPS = ['Needs input', 'Working', 'Idle', 'Ended'] as const
export type Group = (typeof GROUPS)[number]

export function stateKey(agent: Agent): StateKey {
  if (agent.broken) return 'broken'
  const s = agent.meta.state
  if (s === 'waiting') return 'waiting'
  if (s === 'spawning' || s === 'running') return 'working'
  if (s === 'parked') return 'parked'
  if (s === 'stopped') return 'stopped'
  if (s === 'failed') return 'failed'
  if (s === 'idle' && agent.meta.lastTurn && agent.meta.lastTurn.ok === false) return 'failed'
  return 'done'
}
export function groupOf(agent: Agent): Group {
  if (agent.broken) return 'Ended'
  const s = agent.meta.state
  return s === 'waiting' ? 'Needs input' : s === 'spawning' || s === 'running' ? 'Working'
    : s === 'idle' || s === 'parked' ? 'Idle' : 'Ended'
}
export function updatedAt(agent: Agent): number {
  return Date.parse(agent.meta?.updatedAt || agent.meta?.createdAt || '') || 0
}
export function isLive(agent: Agent): boolean {
  return !agent.broken && ['spawning', 'running', 'waiting'].includes(agent.meta.state ?? '')
}
export function canStop(agent: Agent): boolean {
  return !agent.broken && ['spawning', 'running', 'waiting', 'idle'].includes(agent.meta.state ?? '')
}
// Needs input -> Working -> Idle -> Ended; inside a group, newest first;
// failed sorts before stopped inside Ended.
export function groupAgents(agents: readonly Agent[]): { name: Group; rows: Agent[] }[] {
  const rank = (a: Agent): number => (a.meta?.state === 'failed' ? 0 : 1)
  return GROUPS.map(name => ({
    name,
    rows: agents.filter(a => groupOf(a) === name).sort((a, b) => (name === 'Ended' ? rank(a) - rank(b) : 0) || updatedAt(b) - updatedAt(a) || a.name.localeCompare(b.name)),
  })).filter(g => g.rows.length)
}
// The list order: the groups in order, each row once.
export function listOrder(agents: readonly Agent[]): Agent[] {
  return groupAgents(agents).flatMap(g => g.rows)
}

function lastEvent(agent: Agent, types: readonly string[]): Ev | undefined {
  for (let i = agent.events.length - 1; i >= 0; i--) {
    const e = agent.events[i]
    if (e && types.includes(e.type ?? '')) return e
  }
  return undefined
}
export function failureLine(agent: Agent): string {
  const ev = lastEvent(agent, ['failed', 'spawn_failed'])
  const lt = agent.meta.lastTurn
  return firstLine(ev?.data?.errorMessage || ev?.data?.error || lt?.errorMessage || ev?.data?.reason || lt?.reason || agent.meta.reason || 'no reason was recorded')
}
// The one-line summary column of a list row. '' means no task text.
export function rowSummary(agent: Agent, now: number, staleMinutes?: number): string {
  if (agent.broken) return "Couldn't read this agent's record"
  const m = agent.meta
  const key = stateKey(agent)
  if (key === 'waiting') return firstLine(agent.questions[0]?.data?.text) || oneLine(m.description) || 'waiting for an answer'
  if (key === 'working') {
    if (staleMinutes && agent.lastActivity && now - agent.lastActivity > staleMinutes * 60000) {
      return `last activity ${age(agent.lastActivity, now)} ago · may not be running`
    }
    const note = lastEvent(agent, ['note'])
    return firstLine(note && parse(note.ts) >= parse(m.updatedAt || 0) - 3600000 ? note.data?.text : '') || oneLine(m.description) || 'working'
  }
  if (m.state === 'failed') return `Failed · ${failureLine(agent)}`
  return oneLine(m.description)
}
export function rowTail(agent: Agent): string {
  if (agent.broken) return ''
  const key = stateKey(agent)
  if (key === 'done') return 'done'
  if (key === 'parked') return 'parked'
  if (key === 'stopped') return 'stopped'
  if (key === 'failed' && agent.meta.state !== 'failed') return 'failed'
  return ''
}
export function rowAge(agent: Agent, now: number): string {
  if (agent.broken) return ''
  if (agent.meta.state === 'waiting' && agent.questions[0]?.ts) return age(agent.questions[0].ts, now)
  const ended = ['stopped', 'failed', 'parked', 'idle'].includes(agent.meta.state ?? '') && agent.meta.lastTurn?.endedAt
  return age(agent.meta.updatedAt || ended || agent.meta.createdAt, now)
}
// The dim line under the list for the selected (non-waiting) agent: plain words.
export function peekLine(agent: Agent, now: number): string {
  if (agent.broken) return "This agent's record could not be read. It shows again when the file is valid."
  const m = agent.meta
  const lt = m.lastTurn
  const parts: string[] = []
  const working = m.state === 'running' || m.state === 'spawning'
  if (working) parts.push(`working on turn ${m.turn || 1}`)
  else if (lt) parts.push(`turn ${lt.turn} ${lt.ok === false ? 'failed' : 'finished'} ${when(lt.endedAt, now)}`.trim())
  // Mid-turn, the last cost is the previous turn's: label it as such.
  if (lt?.usage?.cost) parts.push(working && (lt.turn ?? 0) < (m.turn ?? 0) ? `turn ${lt.turn} cost ${cost(lt.usage.cost)}` : cost(lt.usage.cost))
  if (m.state === 'parked') {
    const parked = lastEvent(agent, ['parked'])
    const idle = parked && lt?.endedAt ? Math.round((parse(parked.ts) - parse(lt.endedAt)) / 60000) : NaN
    parts.push(parked?.data?.reason === 'ttl' && Number.isFinite(idle) && idle > 0 ? `parked after ${idle} min idle` : 'parked')
  }
  if (m.state === 'stopped') {
    const stopped = lastEvent(agent, ['stopped'])
    const at = when(stopped?.ts || m.updatedAt, now)
    parts.push(at ? `stopped ${at}` : 'stopped')
    if (!lt) parts.push('no turn finished')
    parts.push('a message wakes it')
  }
  if (m.state === 'failed') parts.push(`failed: ${failureLine(agent)}`)
  return parts.filter(Boolean).join(' · ')
}

// ---- log events -----------------------------------------------------------

const EXPIRED: Record<string, string> = { budget: "this turn's question limit was used", orphaned: "the agent's process went away" }
function answeredBy(value: unknown): string {
  return /user/i.test(String(value ?? '')) ? 'You' : 'Claude'
}
export function words(type: unknown): string {
  const t = String(type || 'event').replace(/[_-]+/g, ' ')
  return t.charAt(0).toUpperCase() + t.slice(1)
}
export type Sentence = { glyph: string; color?: ThemeKey; dim?: true; topic?: string; text: string }
// One event -> a one-line sentence in plain words. An unknown event shows its type in words only.
export function eventSentence(e: Ev, opts: { idleMinutes?: number; waitMinutes?: number } = {}): Sentence {
  const d = e.data ?? {}
  switch (e.type) {
    case 'spawned': return { glyph: GLYPHS.started, text: `Started · ${modelLabel(d.model)}${(d.gen || e.gen || 0) > 1 ? ` · run ${d.gen || e.gen}` : ''}` }
    case 'started': return { glyph: GLYPHS.started, text: `Turn ${e.turn} started` }
    case 'question': return { glyph: GLYPHS.asked, color: C.warn, text: `Asked${d.topic ? ` (${oneLine(d.topic)})` : ''}: ${firstLine(d.text)}` }
    case 'answered': return { glyph: GLYPHS.answered, dim: true, text: `${answeredBy(d.answeredBy)} answered` }
    case 'question_expired': {
      const why = EXPIRED[String(d.reason)] || (d.reason === 'timeout' ? (opts.waitMinutes ? `no answer within ${opts.waitMinutes} min` : 'no answer in time') : oneLine(d.reason) || 'no answer')
      return { glyph: GLYPHS.expired, color: C.warn, text: `Question expired · ${why}` }
    }
    case 'note': return { glyph: GLYPHS.note, topic: oneLine(d.topic), text: firstLine(d.text) }
    case 'done': return { glyph: GLYPHS.ok, color: C.ok, text: [`Turn ${e.turn} finished`, duration(d.durationMs), cost(d.usage?.cost)].filter(Boolean).join(' · ') }
    case 'failed': return { glyph: GLYPHS.err, color: C.err, text: `Turn ${e.turn} failed: ${firstLine(d.errorMessage || d.reason || 'no reason was recorded')}` }
    case 'spawn_failed': return { glyph: GLYPHS.err, color: C.err, text: `Couldn't start: ${firstLine(d.error || d.reason || 'no reason was recorded')}` }
    case 'parked': return { glyph: GLYPHS.parked, color: C.off, text: d.reason === 'ttl' ? (opts.idleMinutes !== undefined ? `Parked after ${opts.idleMinutes} min idle. Wakes on your next message.` : 'Parked while idle. Wakes on your next message.') : 'Parked' }
    case 'stopped': return { glyph: GLYPHS.stopped, color: C.off, text: d.reason === 'takeover' ? 'Stopped · replaced by a new run' : d.reason === 'stopped mid-turn' ? 'Stopped mid-turn' : 'Stopped' }
    case 'interrupted': return { glyph: GLYPHS.stopped, color: C.off, text: `Turn ${e.turn} interrupted` }
    case 'orphan_killed': return { glyph: GLYPHS.stopped, color: C.off, text: 'Cleaned up a leftover process' }
    default: return { glyph: GLYPHS.other, text: words(e.type) }
  }
}

// ---- long text ------------------------------------------------------------

export type Block = { kind: 'md' | 'code'; text: string; language?: string; cut?: number }
const FENCE = /^\s{0,3}(```|~~~)/
// Split markdown into blocks under `cap` characters: at blank lines outside
// fences, never inside one. A fence longer than the cap becomes a Code block;
// an unbroken paragraph longer than the cap is cut at a line boundary.
export function splitMarkdown(text: string, cap = 9500): Block[] {
  const lines = String(text).split('\n')
  const segments: { text: string; fence: boolean }[] = []
  let current: string[] = []
  let fenced = false
  let fenceBlock = false
  const flush = (): void => { if (current.length) segments.push({ text: current.join('\n'), fence: fenceBlock }); current = []; fenceBlock = false }
  for (const line of lines) {
    if (FENCE.test(line)) {
      if (!fenced) { flush(); fenced = true; fenceBlock = true; current.push(line); continue }
      current.push(line); fenced = false; flush(); continue
    }
    if (!fenced && line.trim() === '') { flush(); continue }
    current.push(line)
  }
  flush()
  const blocks: Block[] = []
  let buffer = ''
  const push = (): void => { if (buffer) blocks.push({ kind: 'md', text: buffer }); buffer = '' }
  for (const seg of segments) {
    if (seg.text.length > cap) {
      push()
      if (seg.fence) {
        const body = seg.text.split('\n')
        const language = (body[0] ?? '').replace(FENCE, '').trim()
        blocks.push({ kind: 'code', language, text: body.slice(1, FENCE.test(body.at(-1) ?? '') ? -1 : undefined).join('\n') })
      } else {
        let rest = seg.text
        while (rest.length > cap) {
          let at = rest.lastIndexOf('\n', cap)
          if (at <= 0) at = cap
          blocks.push({ kind: 'md', text: rest.slice(0, at) })
          rest = rest.slice(at).replace(/^\n/, '')
        }
        if (rest) blocks.push({ kind: 'md', text: rest })
      }
      continue
    }
    const joined = buffer ? `${buffer}\n\n${seg.text}` : seg.text
    if (joined.length > cap) { push(); buffer = seg.text } else buffer = joined
  }
  push()
  return blocks
}
// At most `max` blocks; returns the kept blocks and how many characters were left out.
export function resultBlocks(text: string, { cap = 9500, max = 3, codeCap = 9000 } = {}): { blocks: Block[]; omitted: number } {
  const blocks = splitMarkdown(safeText(text), cap)
  const kept = blocks.slice(0, max).map(b => (b.kind === 'code' && b.text.length > codeCap ? { ...b, text: b.text.slice(0, codeCap), cut: b.text.length - codeCap } : b))
  const omitted = blocks.slice(max).reduce((n, b) => n + b.text.length, 0) + kept.reduce((n, b) => n + (b.cut || 0), 0)
  return { blocks: kept, omitted }
}
export function omittedNote(chars: number, name: string): string {
  return `… ${kChars(chars)} more characters not shown. Ask Claude for ${name}'s full result.`
}
// Head of `text` within `cap` characters; returns the text and the cut count.
export function head(text: unknown, cap: number): { text: string; cut: number } {
  const s = String(text ?? '')
  return s.length <= cap ? { text: s, cut: 0 } : { text: s.slice(0, cap), cut: s.length - cap }
}
// First `n` lines, with how many were left out.
export function headLines(text: unknown, n: number): { text: string; total: number; more: number } {
  const lines = String(text ?? '').split('\n')
  return { text: lines.slice(0, n).join('\n'), total: lines.length, more: Math.max(0, lines.length - n) }
}
// Wrap a text to screen lines of `width` cells: at spaces where it can, hard
// cuts for long words. Tabs become spaces. Each result line is one screen row.
export function wrapLines(text: unknown, width: number): string[] {
  const w = Math.max(4, width)
  const out: string[] = []
  for (const raw of safeText(text).replace(/\t/g, '  ').split('\n')) {
    let line = raw.replace(/\s+$/, '')
    if (line === '') { out.push(''); continue }
    while (cells(line) > w) {
      let used = 0
      let at = 0
      let space = -1
      for (const ch of line) {
        const cw = cells(ch)
        if (used + cw > w) break
        used += cw
        at += ch.length
        if (ch === ' ') space = at
      }
      const end = line[at] === ' ' ? at : space > w / 3 ? space : Math.max(1, at)
      out.push(line.slice(0, end).replace(/\s+$/, ''))
      line = line.slice(end).replace(/^\s+/, '')
    }
    out.push(line)
  }
  return out
}

// ---- activity steps -------------------------------------------------------

export type ToolResult = { isError: boolean; text: string; lines: number; chars: number; ts: unknown; diff: string }
export type Step =
  | { kind: 'user'; text: string; ts: unknown }
  | { kind: 'thinking'; count: number; ts: unknown }
  | { kind: 'prose'; text: string; more: number; ts: unknown }
  | { kind: 'ask'; id: string; ask: 'note' | 'question'; topic: string; text: string; ts: unknown; result?: ToolResult; answer?: string }
  | { kind: 'tool'; id: string; name: string; args: { [key: string]: any }; ts: unknown; result?: ToolResult }
export type Steps = { steps: Step[]; byId: { [id: string]: Step & { kind: 'ask' | 'tool' } } }

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  return (Array.isArray(content) ? content : []).filter(c => c?.type === 'text').map(c => String(c.text ?? '')).join('\n')
}
// pi session `message` entries -> steps. A toolCall is paired with its
// toolResult by id; consecutive thinking blocks fold into one step.
export function buildSteps(entries: readonly any[], previous: Steps = { steps: [], byId: {} }): Steps {
  const steps = previous.steps
  const byId = previous.byId
  for (const entry of entries) {
    if (entry?.type !== 'message') continue
    const m = entry.message ?? {}
    const ts = entry.timestamp ?? m.timestamp
    if (m.role === 'user') {
      const text = oneLine(textOf(m.content))
      if (text) steps.push({ kind: 'user', text: text.slice(0, 400), ts })
    } else if (m.role === 'assistant') {
      for (const c of Array.isArray(m.content) ? m.content : []) {
        if (c?.type === 'thinking') {
          const last = steps.at(-1)
          if (last?.kind === 'thinking') last.count++
          else steps.push({ kind: 'thinking', count: 1, ts })
        } else if (c?.type === 'text' && String(c.text ?? '').trim()) {
          steps.push({ kind: 'prose', text: safeText(c.text).slice(0, 3000), more: Math.max(0, String(c.text).length - 3000), ts })
        } else if (c?.type === 'toolCall' && c.name === 'ask_parent') {
          const a = c.arguments ?? {}
          const step: Step & { kind: 'ask' } = { kind: 'ask', id: String(c.id ?? ''), ask: a.kind === 'note' ? 'note' : 'question', topic: oneLine(a.topic), text: safeText(a.text).slice(0, 3000), ts }
          steps.push(step)
          if (c.id) byId[c.id] = step
        } else if (c?.type === 'toolCall') {
          const step: Step & { kind: 'tool' } = { kind: 'tool', id: String(c.id ?? ''), name: String(c.name || 'tool'), args: c.arguments && typeof c.arguments === 'object' ? c.arguments : {}, ts }
          steps.push(step)
          if (c.id) byId[c.id] = step
        }
      }
    } else if (m.role === 'toolResult') {
      const step = byId[m.toolCallId]
      if (!step) continue
      const out = safeText(textOf(m.content))
      const lines = out ? out.split('\n').length : 0
      step.result = { isError: !!m.isError, text: out.slice(0, 6000), lines, chars: out.length, ts: m.timestamp ?? ts, diff: typeof m.details?.diff === 'string' ? m.details.diff : '' }
      if (step.kind === 'ask') step.answer = answerText(out)
    }
  }
  return { steps, byId }
}
// ask_parent's tool result: "[parent answered · by …]" then the answer itself.
export function answerText(result: unknown): string {
  const text = String(result ?? '')
  if (!/^\[parent answered/.test(text)) return ''
  return text.slice(text.indexOf('\n') + 1).trim()
}
// `cd <dir> && real command` -> `real command`.
export function stripCd(command: unknown): string {
  let s = String(command ?? '')
  const CD = /^\s*cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*(?:&&|;)\s*/
  while (CD.test(s)) s = s.replace(CD, '')
  return s
}
function argPath(args: { [key: string]: any }): string {
  return String(args.path || args.file_path || args.file || '')
}
export function editCounts(args: { [key: string]: any }): { add: number; del: number } | null {
  const edits: any[] = Array.isArray(args.edits) ? args.edits : args.oldText !== undefined || args.newText !== undefined ? [args] : []
  if (edits.length) {
    let add = 0
    let del = 0
    for (const e of edits) {
      del += String(e.oldText ?? e.old_string ?? '').split('\n').length
      add += String(e.newText ?? e.new_string ?? '').split('\n').length
    }
    return { add, del }
  }
  if (typeof args.content === 'string') return { add: args.content.split('\n').length, del: 0 }
  return null
}
// A unified diff Code can parse, built from the edit's own arguments.
export function editDiff(args: { [key: string]: any }): string {
  const edits: any[] = Array.isArray(args.edits) ? args.edits : [args]
  const hunks: string[] = []
  for (const e of edits) {
    const oldLines = String(e.oldText ?? e.old_string ?? '').split('\n')
    const newLines = String(e.newText ?? e.new_string ?? args.content ?? '').split('\n')
    const old = e.oldText === undefined && e.old_string === undefined ? [] : oldLines
    hunks.push(`@@ -1,${old.length} +1,${newLines.length} @@`, ...old.map(l => `-${l}`), ...newLines.map(l => `+${l}`))
  }
  return safeText(hunks.join('\n'))
}
// The input of a tool call in words: its text values, one on each line. No field names, no JSON.
export function argWords(args: { [key: string]: any }): string {
  const values: string[] = []
  for (const v of Object.values(args)) {
    if (typeof v === 'string' && v.trim()) values.push(safeText(v))
    else if (typeof v === 'number' || typeof v === 'boolean') values.push(String(v))
    else if (Array.isArray(v) && v.every(x => typeof x === 'string')) values.push(v.join(', '))
  }
  return values.join('\n')
}
export type StepRow = { glyph: string; color?: ThemeKey; name: string; arg: string; argWrap: 'truncate-end' | 'truncate-start'; tail: string; tailColor?: ThemeKey; add?: number; del?: number }
// One collapsed tool step -> one row of words.
export function stepRow(step: Step & { kind: 'tool' }): StepRow {
  const r = step.result
  const name = step.name.toLowerCase()
  const glyph = !r ? GLYPHS.flight : r.isError ? GLYPHS.err : GLYPHS.ok
  const color: ThemeKey | undefined = !r ? undefined : r.isError ? C.err : C.ok
  const exit = r?.text.match(/(?:exited with code|exit code:?|exit status)\s*(-?\d+)/i)
  const secs = r && step.ts && r.ts ? parse(r.ts) - parse(step.ts) : NaN
  const row: StepRow = { glyph, color, name: cut(name, 6), arg: '', argWrap: 'truncate-end', tail: '' }
  if (name === 'read') { row.arg = argPath(step.args); row.argWrap = 'truncate-start'; row.tail = r ? `${r.lines} lines` : '' }
  else if (name === 'bash') {
    row.arg = firstLine(stripCd(step.args.command))
    const code = exit ? Number(exit[1]) : r ? (r.isError ? 1 : 0) : null
    row.tail = !r ? 'running' : [`exit ${code}`, Number.isFinite(secs) && secs >= 0 ? duration(secs) : ''].filter(Boolean).join(' · ')
    if (r && code) row.tailColor = C.err
  } else if (name === 'edit' || name === 'write') {
    row.arg = argPath(step.args); row.argWrap = 'truncate-start'
    const counts = editCounts(step.args)
    if (counts) { row.add = counts.add; row.del = counts.del }
  } else if (name === 'grep') {
    row.arg = String(step.args.pattern ?? '')
    row.tail = r ? `${r.text.trim() ? r.lines : 0} matches` : ''
  } else {
    const first = Object.values(step.args).find(v => typeof v === 'string')
    row.arg = firstLine(first ?? '')
  }
  if (!r && name !== 'bash') row.tail = 'running'
  row.arg = oneLine(row.arg)
  return row
}
const LANG: Record<string, string> = { js: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'typescript', tsx: 'tsx', jsx: 'jsx', py: 'python', sh: 'bash', md: 'markdown', json: 'json', yml: 'yaml', yaml: 'yaml', rs: 'rust', go: 'go' }
export function languageOf(path: unknown): string {
  const ext = (String(path ?? '').split('.').pop() ?? '').toLowerCase()
  return LANG[ext] ?? 'text'
}
