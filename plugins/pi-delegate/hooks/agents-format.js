// Pure formatting for the agents pane: no `$`, no I/O, so every rule here is unit-tested.

// Every colour the pane uses. Swapping a refused theme key is a one-line change
// here (warn -> 'yellow', err -> 'red'); 'warning' and 'error' were checked live
// on 2.1.288 and render without a validation refusal.
export const C = { warn: 'warning', err: 'error', ok: 'success', off: 'inactive', add: 'diffAddedWord', del: 'diffRemovedWord' }

// Glyphs drawn in aligned columns. All are East-Asian-Width N or Na (one cell);
// ambiguous-width ones (… · ─ • ∴ ◇) never appear in a glyph column.
export const STATE = {
  waiting: { glyph: '?', word: 'asking', color: C.warn, bold: true },
  working: { glyph: '✻', word: 'working', bold: true },
  done: { glyph: '✓', word: 'done', color: C.ok },
  parked: { glyph: '∙', word: 'parked', color: C.off },
  stopped: { glyph: '◦', word: 'stopped', color: C.off },
  failed: { glyph: '✕', word: 'failed', color: C.err },
  broken: { glyph: '!', word: "can't read", color: C.warn },
}
export const GLYPHS = { ok: '✓', err: '✕', flight: '◷', thinking: '~', started: '▸', asked: '?', answered: '↩', expired: '◌', note: '▪', stopped: '◦', parked: '∙', you: '›', pointer: '❯', other: '-' }
// Width-safe set checked with python3 unicodedata.east_asian_width (spec §1).
export const NARROW_GLYPHS = ['?', '✻', '✓', '∙', '◦', '✕', '❯', '◌', '◷', '▪', '↩', '▸', '⏎', '▾', '›', '~', '-', '!']

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad2 = n => String(n).padStart(2, '0')

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]/g
const SECRET = /(api[_-]?key|token|secret|authorization|password)(\s*[:=]\s*)\S+/gi

// Disk text is untrusted: strip escapes and control characters (tab and
// newline survive), and redact obvious credentials before any element sees it.
export function safeText(value) {
  return String(value ?? '').replace(ANSI, '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').replace(SECRET, '$1$2…redacted')
}
export function oneLine(value) {
  return safeText(value).replace(/\s+/g, ' ').trim()
}
export function firstLine(value) {
  return safeText(value).split('\n').map(l => l.trim()).find(Boolean) || ''
}
// Cut ahead of time (Buttons cannot truncate): keep the head, end with an ellipsis.
export function cut(value, width) {
  const text = String(value ?? '')
  if (width <= 0) return ''
  return text.length <= width ? text : text.slice(0, Math.max(0, width - 1)) + '…'
}
export function kChars(n) {
  return n < 1000 ? String(n) : `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
}

export function sameDay(a, b) {
  const x = new Date(a), y = new Date(b)
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate()
}
export function hhmm(ts) {
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? '--:--' : `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}
export function dayLabel(ts, now) {
  const d = new Date(ts)
  return sameDay(ts, now) ? 'Today' : `${MONTHS[d.getMonth()]} ${d.getDate()}`
}
// `18:52` today, `Oct 1 18:52` otherwise.
export function when(ts, now) {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  return sameDay(ts, now) ? hhmm(ts) : `${MONTHS[d.getMonth()]} ${d.getDate()} ${hhmm(ts)}`
}
// Minute-granular ages: <1m 12m 16h 2d.
export function age(ts, now) {
  const ms = now - (typeof ts === 'number' ? ts : Date.parse(ts))
  if (!Number.isFinite(ms)) return '—'
  const m = Math.floor(Math.max(0, ms) / 60000)
  return m < 1 ? '<1m' : m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`
}
export function duration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return ''
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  const s = Math.round(ms / 1000)
  if (s < 3600) return `${Math.floor(s / 60)}m ${pad2(s % 60)}s`
  return `${Math.floor(s / 3600)}h ${pad2(Math.floor((s % 3600) / 60))}m`
}
export function cost(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return ''
  return n < 0.01 ? '<$0.01' : `$${n.toFixed(2)}`
}
export function contextLabel(tokens) {
  const n = Number(tokens)
  return Number.isFinite(n) && n > 0 ? `${Math.round(n / 1000)}k context` : ''
}
export function modelLabel(model) {
  return String(model || '').split('/').pop()
}

export function jsonLines(raw) {
  return String(raw).split('\n').flatMap(line => {
    try { return line.trim() ? [JSON.parse(line)] : [] } catch { return [] }
  })
}
export function openQuestions(events, meta) {
  const closed = new Set(events.filter(e => ['answered', 'question_expired'].includes(e.type)).map(e => e.data?.toolCallId))
  return events.filter(e => e.type === 'question' && e.gen === meta.gen && e.turn === meta.turn && !closed.has(e.data?.toolCallId))
}

// ---- agent rows ---------------------------------------------------------

export const GROUPS = ['Needs input', 'Working', 'Idle', 'Ended']

export function stateKey(agent) {
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
export function groupOf(agent) {
  if (agent.broken) return 'Ended'
  const s = agent.meta.state
  return s === 'waiting' ? 'Needs input' : s === 'spawning' || s === 'running' ? 'Working'
    : s === 'idle' || s === 'parked' ? 'Idle' : 'Ended'
}
export function updatedAt(agent) {
  return Date.parse(agent.meta?.updatedAt || agent.meta?.createdAt || 0) || 0
}
export function isLive(agent) {
  return !agent.broken && ['spawning', 'running', 'waiting'].includes(agent.meta.state)
}
export function canStop(agent) {
  return !agent.broken && ['spawning', 'running', 'waiting', 'idle'].includes(agent.meta.state)
}
// Needs input -> Working -> Idle -> Ended; inside a group, newest first;
// failed sorts before stopped inside Ended.
export function groupAgents(agents) {
  const rank = a => (a.meta?.state === 'failed' ? 0 : 1)
  return GROUPS.map(name => ({
    name,
    rows: agents.filter(a => groupOf(a) === name).sort((a, b) => (name === 'Ended' ? rank(a) - rank(b) : 0) || updatedAt(b) - updatedAt(a)),
  })).filter(g => g.rows.length)
}

function lastEvent(agent, types) {
  for (let i = agent.events.length - 1; i >= 0; i--) if (types.includes(agent.events[i].type)) return agent.events[i]
  return undefined
}
export function failureLine(agent) {
  const ev = lastEvent(agent, ['failed', 'spawn_failed'])
  const lt = agent.meta.lastTurn
  return firstLine(ev?.data?.errorMessage || ev?.data?.error || lt?.errorMessage || ev?.data?.reason || lt?.reason || agent.meta.reason || 'unknown error')
}
// The one-line summary column of a list row.
export function rowSummary(agent, now, staleMinutes) {
  if (agent.broken) return "Couldn't read this agent's record"
  const m = agent.meta
  const key = stateKey(agent)
  if (key === 'waiting') return firstLine(agent.questions[0]?.data?.text) || m.description || 'waiting for an answer'
  if (key === 'working') {
    if (staleMinutes && agent.lastActivity && now - agent.lastActivity > staleMinutes * 60000) {
      return `last activity ${age(agent.lastActivity, now)} ago · may not be running`
    }
    const note = lastEvent(agent, ['note'])
    return firstLine(note && Date.parse(note.ts) >= Date.parse(m.updatedAt || 0) - 3600000 ? note.data?.text : '') || oneLine(m.description) || 'working'
  }
  if (m.state === 'failed') return `Failed · ${failureLine(agent)}`
  return oneLine(m.description) || '—'
}
export function rowTail(agent) {
  if (agent.broken) return ''
  const key = stateKey(agent)
  if (key === 'done') return 'done'
  if (key === 'parked') return 'parked'
  if (key === 'stopped') return 'stopped'
  if (key === 'failed' && agent.meta.state !== 'failed') return 'failed'
  return ''
}
export function rowAge(agent, now) {
  if (agent.broken) return '—'
  if (agent.meta.state === 'waiting' && agent.questions[0]?.ts) return age(agent.questions[0].ts, now)
  const ended = ['stopped', 'failed', 'parked', 'idle'].includes(agent.meta.state) && agent.meta.lastTurn?.endedAt
  return age(agent.meta.updatedAt || ended || agent.meta.createdAt, now)
}
// The dim peek line under the list for the selected (non-waiting) agent.
export function peekLine(agent, now) {
  if (agent.broken) return agent.dir ? `${agent.dir}/meta.json` : ''
  const m = agent.meta
  const lt = m.lastTurn
  const parts = []
  if (m.state === 'running' || m.state === 'spawning') parts.push(`working on turn ${m.turn || 1}`)
  else if (lt) parts.push(`turn ${lt.turn} ${lt.ok === false ? 'failed' : 'finished'} ${when(lt.endedAt, now)}`.trim())
  if (lt?.usage?.cost) parts.push(cost(lt.usage.cost))
  if (m.state === 'parked') {
    const parked = lastEvent(agent, ['parked'])
    const idle = parked && lt?.endedAt ? Math.round((Date.parse(parked.ts) - Date.parse(lt.endedAt)) / 60000) : NaN
    parts.push(parked?.data?.reason === 'ttl' && Number.isFinite(idle) && idle > 0 ? `parked after ${idle} min idle` : 'parked')
  }
  if (m.state === 'stopped') parts.push('stopped')
  if (m.state === 'failed') parts.push(`failed: ${failureLine(agent)}`)
  return parts.filter(Boolean).join(' · ')
}

// ---- log events -----------------------------------------------------------

const EXPIRED = { budget: "this turn's question limit was used", orphaned: "the agent's process went away" }
function answeredBy(value) {
  return /user/i.test(String(value || '')) ? 'You' : 'Claude'
}
export function words(type) {
  const t = String(type || 'event').replace(/[_-]+/g, ' ')
  return t.charAt(0).toUpperCase() + t.slice(1)
}
// One event -> { glyph, color, topic?, text }: a one-line sentence.
export function eventSentence(e, opts = {}) {
  const d = e.data || {}
  switch (e.type) {
    case 'spawned': return { glyph: GLYPHS.started, text: `Started · ${modelLabel(d.model)}${(d.gen || e.gen) > 1 ? ` · run ${d.gen || e.gen}` : ''}` }
    case 'started': return { glyph: GLYPHS.started, text: `Turn ${e.turn} started` }
    case 'question': return { glyph: GLYPHS.asked, color: C.warn, text: `Asked${d.topic ? ` (${oneLine(d.topic)})` : ''}: ${firstLine(d.text)}` }
    case 'answered': return { glyph: GLYPHS.answered, dim: true, text: `${answeredBy(d.answeredBy)} answered` }
    case 'question_expired': {
      const why = EXPIRED[d.reason] || (d.reason === 'timeout' ? `no answer within ${opts.waitMinutes || '?'} min` : oneLine(d.reason) || 'no answer')
      return { glyph: GLYPHS.expired, color: C.warn, text: `Question expired · ${why}` }
    }
    case 'note': return { glyph: GLYPHS.note, topic: oneLine(d.topic), text: firstLine(d.text) }
    case 'done': return { glyph: GLYPHS.ok, color: C.ok, text: [`Turn ${e.turn} finished`, duration(d.durationMs), cost(d.usage?.cost)].filter(Boolean).join(' · ') }
    case 'failed': return { glyph: GLYPHS.err, color: C.err, text: `Turn ${e.turn} failed: ${firstLine(d.errorMessage || d.reason || 'unknown error')}` }
    case 'spawn_failed': return { glyph: GLYPHS.err, color: C.err, text: `Couldn't start: ${firstLine(d.error || d.reason || 'unknown error')}` }
    case 'parked': return { glyph: GLYPHS.parked, color: C.off, text: d.reason === 'ttl' ? `Parked after ${opts.idleMinutes ?? '?'} min idle. Wakes on your next message.` : 'Parked' }
    case 'stopped': return { glyph: GLYPHS.stopped, color: C.off, text: d.reason === 'takeover' ? 'Stopped · replaced by a new run' : d.reason === 'stopped mid-turn' ? 'Stopped mid-turn' : 'Stopped' }
    case 'interrupted': return { glyph: GLYPHS.stopped, color: C.off, text: `Turn ${e.turn} interrupted` }
    case 'orphan_killed': return { glyph: GLYPHS.stopped, color: C.off, text: 'Cleaned up a leftover process' }
    default: {
      const scalars = Object.entries(d).filter(([k, v]) => !HIDDEN_FIELDS.has(k) && v !== null && ['string', 'number', 'boolean'].includes(typeof v))
      return { glyph: GLYPHS.other, text: [words(e.type), scalars.map(([k, v]) => `${k}: ${oneLine(v).slice(0, 40)}`).join(', ')].filter(Boolean).join(' · ') }
    }
  }
}
const HIDDEN_FIELDS = new Set(['toolCallId', 'askDir', 'path', 'resultFile', 'sessionFile', 'stderrTail', 'turnId', 'question_id'])
// Raw JSON for an expanded event, without ids and paths.
export function rawEvent(e) {
  const strip = value => {
    if (Array.isArray(value)) return value.map(strip)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([k]) => !HIDDEN_FIELDS.has(k) && k !== 'pid').map(([k, v]) => [k, strip(v)]))
    return value
  }
  return safeText(JSON.stringify(strip({ type: e.type, gen: e.gen, turn: e.turn, data: e.data }), null, 2))
}

// ---- long text ------------------------------------------------------------

const FENCE = /^\s{0,3}(```|~~~)/
// Split markdown into blocks under `cap` characters: at blank lines outside
// fences, never inside one. A fence longer than the cap becomes a Code block;
// an unbroken paragraph longer than the cap is cut at a line boundary.
export function splitMarkdown(text, cap = 9500) {
  const lines = String(text).split('\n')
  const segments = []
  let current = [], fenced = false, fenceBlock = false
  const flush = () => { if (current.length) segments.push({ text: current.join('\n'), fence: fenceBlock }); current = []; fenceBlock = false }
  for (const line of lines) {
    if (FENCE.test(line)) {
      if (!fenced) { flush(); fenced = true; fenceBlock = true; current.push(line); continue }
      current.push(line); fenced = false; flush(); continue
    }
    if (!fenced && line.trim() === '') { flush(); continue }
    current.push(line)
  }
  flush()
  const blocks = []
  let buffer = ''
  const push = () => { if (buffer) blocks.push({ kind: 'md', text: buffer }); buffer = '' }
  for (const seg of segments) {
    if (seg.text.length > cap) {
      push()
      if (seg.fence) {
        const body = seg.text.split('\n')
        const language = body[0].replace(FENCE, '').trim()
        blocks.push({ kind: 'code', language, text: body.slice(1, FENCE.test(body.at(-1)) ? -1 : undefined).join('\n') })
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
export function resultBlocks(text, { cap = 9500, max = 3, codeCap = 9000 } = {}) {
  const blocks = splitMarkdown(safeText(text), cap)
  const kept = blocks.slice(0, max).map(b => (b.kind === 'code' && b.text.length > codeCap ? { ...b, text: b.text.slice(0, codeCap), cut: b.text.length - codeCap } : b))
  const omitted = blocks.slice(max).reduce((n, b) => n + b.text.length, 0) + kept.reduce((n, b) => n + (b.cut || 0), 0)
  return { blocks: kept, omitted }
}
export function omittedNote(chars, name) {
  return `… ${kChars(chars)} more characters not shown. Ask Claude for ${name}'s full result.`
}
// Head of `text` within `cap` characters; returns the text and the cut count.
export function head(text, cap) {
  const s = String(text ?? '')
  return s.length <= cap ? { text: s, cut: 0 } : { text: s.slice(0, cap), cut: s.length - cap }
}
// First `n` lines, with how many were left out.
export function headLines(text, n) {
  const lines = String(text ?? '').split('\n')
  return { text: lines.slice(0, n).join('\n'), total: lines.length, more: Math.max(0, lines.length - n) }
}

// ---- activity steps -------------------------------------------------------

function textOf(content) {
  if (typeof content === 'string') return content
  return (Array.isArray(content) ? content : []).filter(c => c?.type === 'text').map(c => c.text || '').join('\n')
}
// pi session `message` entries -> steps. A toolCall is paired with its
// toolResult by id; consecutive thinking blocks fold into one step.
export function buildSteps(entries, previous = { steps: [], byId: {} }) {
  const steps = previous.steps
  const byId = previous.byId
  for (const entry of entries) {
    if (entry?.type !== 'message') continue
    const m = entry.message || {}
    const ts = entry.timestamp || m.timestamp
    if (m.role === 'user') {
      const text = oneLine(textOf(m.content))
      if (text) steps.push({ kind: 'user', text: text.slice(0, 400), ts })
    } else if (m.role === 'assistant') {
      for (const c of Array.isArray(m.content) ? m.content : []) {
        if (c?.type === 'thinking') {
          const last = steps.at(-1)
          if (last?.kind === 'thinking') last.count++
          else steps.push({ kind: 'thinking', count: 1, ts })
        } else if (c?.type === 'text' && String(c.text || '').trim()) {
          steps.push({ kind: 'prose', text: safeText(c.text).slice(0, 3000), more: Math.max(0, String(c.text).length - 3000), ts })
        } else if (c?.type === 'toolCall') {
          const step = { kind: 'tool', id: c.id, name: String(c.name || 'tool'), args: c.arguments || {}, ts }
          steps.push(step)
          if (c.id) byId[c.id] = step
        }
      }
    } else if (m.role === 'toolResult') {
      const step = byId[m.toolCallId]
      if (!step) continue
      const out = safeText(textOf(m.content))
      const lines = out ? out.split('\n').length : 0
      step.result = { isError: !!m.isError, text: out.slice(0, 6000), lines, chars: out.length, ts: m.timestamp || ts, diff: typeof m.details?.diff === 'string' ? m.details.diff : '' }
    }
  }
  return { steps, byId }
}
function argPath(args) {
  return String(args.path || args.file_path || args.file || '')
}
export function editCounts(args) {
  const edits = Array.isArray(args.edits) ? args.edits : args.oldText !== undefined || args.newText !== undefined ? [args] : []
  if (edits.length) {
    let add = 0, del = 0
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
export function editDiff(args) {
  const edits = Array.isArray(args.edits) ? args.edits : [args]
  const hunks = []
  for (const e of edits) {
    const oldLines = String(e.oldText ?? e.old_string ?? '').split('\n')
    const newLines = String(e.newText ?? e.new_string ?? args.content ?? '').split('\n')
    const old = e.oldText === undefined && e.old_string === undefined ? [] : oldLines
    hunks.push(`@@ -1,${old.length} +1,${newLines.length} @@`, ...old.map(l => `-${l}`), ...newLines.map(l => `+${l}`))
  }
  return safeText(hunks.join('\n'))
}
// One collapsed tool step -> { glyph, color, name, arg, argWrap, tail, tailColor, add, del }.
export function stepRow(step) {
  const r = step.result
  const name = step.name.toLowerCase()
  const glyph = !r ? GLYPHS.flight : r.isError ? GLYPHS.err : GLYPHS.ok
  const color = !r ? undefined : r.isError ? C.err : C.ok
  const exit = r?.text.match(/(?:exited with code|exit code:?|exit status)\s*(-?\d+)/i)
  const at = v => (typeof v === 'number' ? v : Date.parse(v))
  const secs = r && step.ts && r.ts ? at(r.ts) - at(step.ts) : NaN
  const row = { glyph, color, name: cut(name, 6), arg: '', argWrap: 'truncate-end', tail: '' }
  if (name === 'read') { row.arg = argPath(step.args); row.argWrap = 'truncate-start'; row.tail = r ? `${r.lines} lines` : '' }
  else if (name === 'bash') {
    row.arg = firstLine(step.args.command)
    const code = exit ? Number(exit[1]) : r ? (r.isError ? 1 : 0) : null
    row.tail = !r ? 'running' : [`exit ${code}`, Number.isFinite(secs) && secs >= 0 ? duration(secs) : ''].filter(Boolean).join(' · ')
    if (r && code) row.tailColor = C.err
  } else if (name === 'edit' || name === 'write') {
    row.arg = argPath(step.args); row.argWrap = 'truncate-start'
    const counts = editCounts(step.args)
    if (counts) { row.add = counts.add; row.del = counts.del }
  } else if (name === 'grep') {
    row.arg = String(step.args.pattern || '')
    row.tail = r ? `${r.text.trim() ? r.lines : 0} matches` : ''
  } else {
    const first = Object.values(step.args).find(v => typeof v === 'string')
    row.arg = firstLine(first || '')
  }
  if (!r && name !== 'bash') row.tail = 'running'
  row.arg = oneLine(row.arg)
  return row
}
const LANG = { js: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'typescript', tsx: 'tsx', jsx: 'jsx', py: 'python', sh: 'bash', md: 'markdown', json: 'json', yml: 'yaml', yaml: 'yaml', rs: 'rust', go: 'go' }
export function languageOf(path) {
  const ext = String(path || '').split('.').pop().toLowerCase()
  return LANG[ext] || 'text'
}
