// The detail of one agent: header, facts, answer cards or the composer, the tabs and their bodies.
// Every list body is a kit list window (hooks/kit/list.tsx); every other body is cut to the rows left,
// so the footer always shows.
import type { RenderElement, RenderNode, ThemeKey } from 'claude-code'
import { GLYPHS as KG, HINTS, KEYS } from './kit/defaults'
import { confirmStrip, cancelConfirm } from './kit/confirm'
import { cells, cut } from './kit/format'
import { footer, footerRows } from './kit/footer'
import { rule } from './kit/header'
import { draftInput } from './kit/input'
import { listRows, listWindow } from './kit/list'
import type { ListRow } from './kit/list'
import { noticeNodes, noticeRows } from './kit/notice'
import type { KeySpec } from './kit/types'
import {
  C as COLOR, GLYPHS, STATE, age, canStop, contextLabel, cost, duration, editDiff, eventSentence, failureLine, firstLine,
  hhmm, kChars, languageOf, modelLabel, oneLine, questionId, resultBlocks, omittedNote, rowAge, safeText, stateKey, stepRow,
  stripCd, when, wrapLines, argWords, headLines,
} from './agents-format'
import type { Agent, Ev, Step } from './agents-format'
import { D, resultOf, sessionOf } from './source'
import { NAV, TABS, TITLE, composerOf, logItems, noteDrawn, stepItems } from './model'
import type { EvItem, StepItem } from './model'
import type { C } from './model'
import { askStop, compose, focusAnswer, openSettings, openTab, retryLast, runAgentAction, showTurn } from './actions'

const go = (p: Promise<unknown>): void => void p.catch(() => undefined)

// A line of plain text, drawn as one screen row.
export type Line = { text: string; dim?: true; bold?: true; color?: ThemeKey; italic?: true }

function lineNode(c: C, l: Line, key: string): RenderElement {
  const { Text } = c.E
  return <Text key={key} wrap="truncate-end" dimColor={l.dim} bold={l.bold} color={l.color} italic={l.italic}>{l.text === '' ? ' ' : l.text}</Text>
}

// Lines that fit the room draw as text. More lines draw as a kit list window: ↑/↓ then scroll a line at a time.
// Returns the nodes and whether the arrows scroll.
export function reader(c: C, owner: string, lines: readonly Line[], room: number, live: boolean): { nodes: RenderNode[]; scrolls: boolean } {
  if (lines.length <= room || !live) {
    if (live) noteDrawn(owner, [])
    const shown = lines.slice(0, Math.max(1, room))
    const more = lines.length - shown.length
    const nodes = shown.map((l, i) => lineNode(c, l, `l:${i}`))
    if (more > 0 && shown.length) nodes[nodes.length - 1] = lineNode(c, { text: `… ${more} more line${more === 1 ? '' : 's'}`, dim: true }, 'l:more')
    return { nodes, scrolls: false }
  }
  const items = lines.map((l, i) => ({ id: `ln:${i}`, l }))
  noteDrawn(owner, items.map(x => KEYS.row + x.id))
  const nodes = windowList(c, items, { idOf: x => x.id, row: (x): ListRow => ({ body: lineNode(c, x.l, 'b'), onPress: () => undefined }) }, room)
  return { nodes, scrolls: true }
}

// A kit list window in `room` rows. When the window has no edge rows (a short pane), one dim line
// under it says how many rows are above and below, so an overflow always has words.
function windowList<R>(c: C, items: readonly R[], o: { idOf: (r: R) => string; row: (r: R, sel: boolean, width: number) => ListRow }, room: number): RenderNode[] {
  const at = items.findIndex(x => o.idOf(x) === c.u.sel)
  const probe = listWindow(c, items.length, at, c.rows - room)
  const note = probe.windowed && !probe.edges && room > 3
  const fixed = c.rows - (note ? room - 1 : room)
  const node = listRows(c, items, { idOf: o.idOf, isSel: x => o.idOf(x) === c.u.sel, fixedRows: fixed, row: o.row })
  if (!note) return [node]
  const win = listWindow(c, items.length, at, fixed)
  const { Text } = c.E
  const parts = [win.top ? `${win.top} above` : '', win.below ? `${win.below} below` : ''].filter(Boolean)
  return [node, <Text key="overflow" dimColor>{parts.join(' · ')}</Text>]
}

// ---- header ------------------------------------------------------------------

function facts(c: C, agent: Agent): string {
  const m = agent.meta
  const lt = m.lastTurn
  const parts = [modelLabel(m.model) || 'model not recorded']
  const pin = D.settings.data?.pin?.model
  if (pin && m.model && pin !== m.model) parts[0] += ' (not the pinned model)'
  if ((m.gen ?? 1) > 1) parts.push(`run ${m.gen}`)
  const midTurn = ['running', 'spawning', 'waiting'].includes(m.state ?? '') && (!lt || (lt.turn ?? 0) < (m.turn ?? 0))
  if (m.state === 'waiting') {
    parts.push(`turn ${m.turn}`)
    const q = agent.questions[0]?.data
    if (q?.n) parts.push(q.max ? `question ${q.n} of ${q.max} this turn` : `question ${q.n} this turn`)
  } else if (m.state === 'running' || m.state === 'spawning') parts.push(`turn ${m.turn} running`)
  else if (lt) {
    const done = agent.events.filter(e => e.type === 'done' && e.turn === lt.turn && e.gen === lt.gen).at(-1)
    parts.push(lt.ok === false ? `turn ${lt.turn} · ${firstLine(lt.errorMessage || lt.reason || 'failed')}` : `turn ${lt.turn} done ${when(lt.endedAt, c.now)}`)
    if (done?.data?.durationMs) parts.push(duration(done.data.durationMs))
  }
  // Mid-turn, the last cost belongs to the previous turn: say so.
  if (lt?.usage?.cost) parts.push(midTurn ? `turn ${lt.turn} cost ${cost(lt.usage.cost)}` : cost(lt.usage.cost))
  if (lt?.usage?.contextTokens && !midTurn) parts.push(contextLabel(lt.usage.contextTokens))
  if (c.w.foreign[agent.name]) parts.push('other session')
  return parts.filter(Boolean).join(' · ')
}

function headerRow(c: C, agent: Agent, split: boolean): RenderElement {
  const { Box, Text } = c.E
  const st = STATE[stateKey(agent)]
  const desc = oneLine(agent.meta.description)
  const crumb = split || c.cols < 60 ? '' : `${TITLE} ${KG.crumbIn} `
  return (
    <Box flexDirection="row">
      <Box flexShrink={0}><Text dimColor>{crumb}</Text><Text bold>{cut(agent.name, 24)}</Text></Box>
      <Box flexShrink={0}><Text color={st.color}>{`  ${st.glyph} ${st.word}`}</Text></Box>
      <Box flexGrow={1} flexShrink={1}><Text dimColor wrap="truncate-end">{desc ? `  · ${desc}` : ' '}</Text></Box>
      <Box flexShrink={0}><Text dimColor>{`  ${rowAge(agent, c.now)}`}</Text></Box>
    </Box>
  )
}

// ---- answer cards and the composer ---------------------------------------------------

// One question with its answer field, cut to `qRows` rows of text.
export function answerCard(c: C, agent: Agent, q: Ev, o: { index: number; total: number; withName: boolean; qRows: number }): { node: RenderElement; rows: number } {
  const { Box, Text } = c.E
  const qid = questionId(q)
  const topic = oneLine(q.data?.topic)
  const title = [o.total > 1 ? `${o.index + 1} of ${o.total}` : '', o.withName ? `${agent.name} asks` : '', topic].filter(Boolean).join(' · ') || 'Question'
  const lines = wrapLines(q.data?.text ?? '', c.cols - 4)
  const shown = lines.slice(0, Math.max(1, o.qRows))
  const more = lines.length - shown.length
  const sending = c.w.agentBusy[agent.name] === 'answer'
  const node = (
    <Box key={`card:${qid}`} flexDirection="column" borderStyle="round" borderColor={o.index === 0 ? COLOR.warn : undefined} borderDimColor={o.index === 0 ? undefined : true} paddingX={1}>
      <Box flexDirection="row">
        <Box flexGrow={1} flexShrink={1}><Text bold wrap="truncate-end">{title}</Text></Box>
        <Box flexShrink={0}><Text dimColor>{`  waiting ${age(q.ts, c.now)}`}</Text></Box>
      </Box>
      {shown.map((l, i) => <Text key={`q:${i}`} wrap="truncate-end">{l === '' ? ' ' : l}</Text>)}
      {more > 0 ? <Text dimColor italic>{`… ${more} more line${more === 1 ? '' : 's'} · the full question is in 4: Questions`}</Text> : ''}
      {sending
        ? <Text color={COLOR.warn} wrap="truncate-end">Sending your answer… approve the prompt if one opened.</Text>
        : draftInput(c, {
          name: `answer:${agent.name}:${qid}`, draftKey: `answer:${agent.name}:${qid}`, placeholder: 'Type your answer, then press Enter', submitLabel: 'send',
          onSubmit: v => go(runAgentAction(c.k, agent.name, 'answer', v, qid)),
        })}
    </Box>
  )
  return { node, rows: 4 + shown.length + (more > 0 ? 1 : 0) }
}

function composerNodes(c: C, agent: Agent): { nodes: RenderNode[]; rows: number } {
  const spec = composerOf(agent)
  if (!spec || !c.u.editing) return { nodes: [], rows: 0 }
  const { Box, Text } = c.E
  const sending = c.w.agentBusy[agent.name] === 'send'
  const hint = agent.meta.state === 'failed' ? `${spec.hint} The last run failed: ${failureLine(agent)}` : spec.hint
  return {
    nodes: [
      <Box key="compose" flexDirection="row" columnGap={1}>
        <Box flexShrink={0}><Text bold>{`${spec.prompt} ›`}</Text></Box>
        {sending
          ? <Text color={COLOR.warn}>Sending… approve the prompt if one opened.</Text>
          : draftInput(c, {
            name: `msg:${agent.name}`, draftKey: `msg:${agent.name}`, placeholder: `Message ${agent.name}`, submitLabel: 'send', autoFocus: true,
            onSubmit: v => go(runAgentAction(c.k, agent.name, 'send', v)),
          })}
      </Box>,
      <Text key="compose:hint" dimColor wrap="truncate-end">{`  ${hint}`}</Text>,
    ],
    rows: 2,
  }
}

// ---- the keys of an agent ----------------------------------------------------------

// The footer keys for one agent: a or m, then x, then s. At most three.
export function agentKeys(c: C, agent: Agent | undefined): KeySpec[] {
  const keys: KeySpec[] = []
  if (agent && !agent.broken) {
    const spec = composerOf(agent)
    if (agent.questions.length) keys.push({ hotkey: 'a', label: 'answer', onPress: () => go(focusAnswer(c.k, agent)) })
    else if (spec) keys.push({ hotkey: spec.key, label: spec.label, onPress: () => go(compose(c.k, agent)) })
    if (canStop(agent)) keys.push({ hotkey: 'x', label: 'stop', onPress: () => go(askStop(c.k, agent)) })
  }
  keys.push({ hotkey: 's', label: 'settings', onPress: () => go(openSettings(c.k)) })
  return keys
}

export function stopNodes(c: C, agent: Agent): RenderNode[] {
  return confirmStrip(c, {
    question: `${KG.warn} Stop ${agent.name}? Its session is kept, and a message wakes it.`, verb: 'stop', yesLabel: 'stop',
    onYes: () => go(runAgentAction(c.k, agent.name, 'stop')),
    onNo: () => go(cancelConfirm(c.k, NAV)),
  })
}
export function confirmRows(c: C, question: string): number {
  return Math.ceil(Math.max(1, cells(question)) / Math.max(20, c.cols)) + (c.w.busy !== null ? 0 : 2)
}

// ---- tabs ------------------------------------------------------------------------

function tabRow(c: C, agent: Agent): RenderElement {
  const { Box, Text, Button } = c.E
  const pending = agent.questions.length
  return (
    <Box flexDirection="row" columnGap={2}>
      {TABS.map(([id, label], i) => {
        const active = c.w.tab === id
        return (
          <Box key={`t:${id}`} flexDirection="row">
            <Text bold color={active ? undefined : undefined}>{active ? '▸ ' : '  '}</Text>
            <Button key={`${KEYS.tab}${id}`} plain hotkey={c.u.confirm ? undefined : String(i + 1)} label={label} dimColor={active ? undefined : true}
              autoFocus={active && c.u.sel === '' && !c.u.confirm && !c.u.inputFocused && !c.u.editing ? true : undefined}
              onPress={() => go(openTab(c.k, id))} />
            {id === 'questions' && pending ? <Text color={COLOR.warn}>{` ${pending}`}</Text> : ''}
          </Box>
        )
      })}
    </Box>
  )
}

// ---- bodies ----------------------------------------------------------------------

type Body = { nodes: RenderNode[]; hints: string[] }

function resultBody(c: C, agent: Agent, room: number, live: boolean, owner: string): Body {
  const { Box, Text, Button, Markdown, Code } = c.E
  const m = agent.meta
  const lt = m.lastTurn
  const last = Number.isInteger(lt?.turn) ? Number(lt?.turn) : 0
  const gen = Number.isInteger(lt?.gen) ? Number(lt?.gen) : Number(m.gen ?? 1)
  if (['running', 'spawning', 'waiting'].includes(m.state ?? '') && (!lt || last < (m.turn ?? 0))) {
    const started = [...agent.events].reverse().find(e => e.turn === m.turn && e.gen === m.gen)
    const lines: Line[] = [
      { text: `Working on turn ${m.turn || 1}${started ? ` for ${age(started.ts, c.now)}` : ''}. The result shows here when the turn ends.`, dim: true },
      { text: 'Watch the steps in 2: Activity.', dim: true, italic: true },
    ]
    const prev = last ? resultOf(agent, gen, last) : undefined
    if (prev) {
      lines.push({ text: `── turn ${last} · finished ${age(lt?.endedAt, c.now)} ago ──`, dim: true })
      for (const l of wrapLines(prev, c.cols - 2)) lines.push({ text: l, dim: true })
    }
    const r = reader(c, owner, lines, room, live)
    return { nodes: r.nodes, hints: r.scrolls ? ['↑/↓ to scroll'] : [] }
  }
  if (lt && lt.ok === false && !c.w.resultTurn) {
    const failed = agent.events.filter(e => e.type === 'failed' && e.turn === lt.turn).at(-1)
    const tail = String(failed?.data?.stderrTail || failed?.data?.errorMessage || lt.errorMessage || lt.reason || '').split('\n').filter(Boolean)
    const codeRows = Math.max(0, room - 2)
    const shown = tail.slice(-codeRows)
    return {
      nodes: [
        <Text key="f:h" color={COLOR.err}>{`${GLYPHS.err} Turn ${lt.turn} failed${failed?.data?.durationMs ? ` after ${duration(failed.data.durationMs)}` : ''}`}</Text>,
        shown.length ? <Code key="f:c" source={safeText(shown.join('\n')).slice(0, 4000)} language="text" wrap="truncate-end" /> : '',
        <Text key="f:t" dimColor wrap="truncate-end">Message it to try again, or ask Claude what went wrong.</Text>,
      ],
      hints: [],
    }
  }
  if (!last) {
    if (live) noteDrawn(owner, [])
    return { nodes: [<Text key="none" dimColor>No finished turn yet. Watch the steps in 2: Activity.</Text>], hints: [] }
  }
  const turn = c.w.resultTurn && c.w.resultTurn <= last ? c.w.resultTurn : last
  const nodes: RenderNode[] = []
  let used = 0
  if (last > 1 && !c.u.confirm) {
    nodes.push(
      <Box key="turns" flexDirection="row" columnGap={2}>
        <Text dimColor>{`Result of turn ${turn}`}</Text>
        {turn > 1 ? <Button key={`${KEYS.act}p`} plain hotkey="p" label="previous turn" onPress={() => go(showTurn(c.k, turn - 1))} /> : ''}
        {turn < last ? <Button key={`${KEYS.act}n`} plain hotkey="n" label="next turn" onPress={() => go(showTurn(c.k, turn + 1 === last ? 0 : turn + 1))} /> : ''}
      </Box>,
    )
    used = 1
  }
  const text = resultOf(agent, gen, turn)
  if (text === undefined) {
    if (live) noteDrawn(owner, [])
    return { nodes: [...nodes, <Text key="loading" dimColor>Loading the result…</Text>], hints: [] }
  }
  if (!text) {
    if (live) noteDrawn(owner, [])
    return { nodes: [...nodes, <Text key="empty" dimColor>{`No result was saved for turn ${turn}.`}</Text>], hints: [] }
  }
  const left = room - used
  const wrapped = wrapLines(text, c.cols - 2)
  // Markdown draws a little taller than its source: keep a margin. A longer result scrolls as lines.
  if (Math.ceil(wrapped.length * 1.15) + 1 <= left) {
    if (live) noteDrawn(owner, [])
    const { blocks, omitted } = resultBlocks(text)
    for (const [i, b] of blocks.entries()) {
      nodes.push(b.kind === 'code'
        ? <Code key={`rc:${i}`} source={b.text || ' '} language={b.language || undefined} wrap="truncate-end" />
        : <Markdown key={`result-${i}`} text={b.text} />)
    }
    if (omitted) nodes.push(<Text key="omit" dimColor italic wrap="wrap">{omittedNote(omitted, agent.name)}</Text>)
    return { nodes, hints: [] }
  }
  const lines: Line[] = wrapped.map(l => (/^\s{0,3}#/.test(l) ? { text: l, bold: true } : /^\s{0,3}(```|~~~)/.test(l) ? { text: l, dim: true } : { text: l }))
  const r = reader(c, owner, lines, left, live)
  return { nodes: [...nodes, ...r.nodes], hints: r.scrolls ? ['↑/↓ to scroll'] : [] }
}

function stepRowOf(c: C, x: StepItem, width: number, nameWidth: number): ListRow {
  const { Box, Text } = c.E
  const s = x.step
  const glyph = (text: string, color?: ThemeKey, dim?: true): RenderElement => <Text color={color} dimColor={dim}>{`${text} `}</Text>
  if (s.kind === 'user') return { body: <Text wrap="truncate-end">{glyph(GLYPHS.you, undefined, true)}<Text dimColor>{cut(`you: ${s.text}`, width - 2)}</Text></Text>, onPress: () => go(toggle(c, x.id)) }
  if (s.kind === 'prose') return { body: <Text wrap="truncate-end">{glyph(GLYPHS.you, undefined, true)}<Text dimColor>{cut(oneLine(s.text), width - 2)}</Text></Text>, onPress: () => go(toggle(c, x.id)) }
  if (s.kind === 'ask') {
    const note = s.ask === 'note'
    const tail = note ? '' : s.result ? (s.answer ? 'answered' : 'closed') : 'waiting'
    const text = [s.topic, firstLine(s.text)].filter(Boolean).join(': ')
    return {
      body: <Text wrap="truncate-end">{glyph(note ? GLYPHS.note : GLYPHS.asked, note ? undefined : COLOR.warn)}{(note ? 'note' : 'asked').padEnd(nameWidth)}<Text dimColor>{cut(text, width - 2 - nameWidth - cells(tail) - 2)}</Text></Text>,
      side: tail ? <Box flexGrow={1} justifyContent="flex-end"><Text dimColor>{tail}</Text></Box> : undefined,
      onPress: () => go(toggle(c, x.id)),
    }
  }
  const r = stepRow(s)
  const tailText = r.add !== undefined ? `+${r.add} −${r.del}` : r.tail
  const room = width - 2 - nameWidth - cells(tailText) - 2
  const arg = r.argWrap === 'truncate-start' && cells(r.arg) > room ? `…${r.arg.slice(-(Math.max(2, room) - 1))}` : cut(r.arg, room)
  const side = r.add !== undefined
    ? <Box flexGrow={1} justifyContent="flex-end"><Text color={COLOR.add}>{`+${r.add}`}</Text><Text> </Text><Text color={COLOR.del}>{`−${r.del}`}</Text></Box>
    : r.tail ? <Box flexGrow={1} justifyContent="flex-end"><Text color={r.tailColor} dimColor={r.tailColor ? undefined : true}>{r.tail}</Text></Box> : undefined
  return {
    body: <Text wrap="truncate-end">{glyph(r.glyph, r.color, r.color ? undefined : true)}{cut(r.name, nameWidth - 1).padEnd(nameWidth)}<Text dimColor>{arg}</Text></Text>,
    side, onPress: () => go(toggle(c, x.id)),
  }
}

async function toggle(c: C, id: string): Promise<void> {
  const u = await c.k.ui.get()
  await c.k.ui.set(() => ({ expandedKey: u.expandedKey === id ? '' : id, sel: id }))
}

// The card under the list for the expanded step: what the step did, cut to `rows` rows.
function stepCard(c: C, s: StepItem['step'], rows: number): RenderElement {
  const { Box, Text, Code } = c.E
  const inner = Math.max(2, rows - 2)
  const width = c.cols - 6
  const kids: RenderNode[] = []
  const textRows = (text: string, n: number, key: string, dim?: true): void => {
    const lines = wrapLines(text, width)
    const shown = lines.slice(0, n)
    shown.forEach((l, i) => kids.push(<Text key={`${key}:${i}`} dimColor={dim} wrap="truncate-end">{l || ' '}</Text>))
    if (lines.length > shown.length && shown.length) kids[kids.length - 1] = <Text key={`${key}:more`} dimColor>{`… ${lines.length - shown.length + 1} more lines`}</Text>
  }
  if (s.kind === 'user' || s.kind === 'prose') textRows(s.text + (s.kind === 'prose' && s.more ? `\n… ${kChars(s.more)} more characters` : ''), inner, 'p')
  else if (s.kind === 'ask') {
    const half = s.answer ? Math.max(1, Math.floor((inner - 1) / 2)) : inner
    textRows(s.text, half, 'q')
    if (s.answer) { kids.push(<Text key="a:h" dimColor>─ answer ─</Text>); textRows(s.answer, inner - half - 1, 'a') }
  } else {
    const isEdit = s.name === 'edit' || s.name === 'write'
    const input = s.name === 'bash' ? stripCd(String(s.args.command ?? '')) : isEdit ? editDiff(s.args) : argWords(s.args)
    const inRows = Math.max(1, Math.min(4, Math.floor(inner / 2) - 1))
    const inp = headLines(input, inRows)
    kids.push(<Text key="i:h" dimColor>input</Text>)
    kids.push(isEdit && inp.text
      ? <Code key="i:c" source={inp.text} format="diff" wrap="truncate-end" />
      : <Code key="i:c" source={inp.text || ' '} language={s.name === 'bash' ? 'bash' : 'text'} wrap="truncate-end" />)
    const outRows = Math.max(1, inner - 2 - inp.text.split('\n').length - (inp.more ? 1 : 0))
    if (inp.more) kids.push(<Text key="i:m" dimColor>{`… ${inp.more} more line${inp.more === 1 ? '' : 's'}`}</Text>)
    if (s.result) {
      const out = headLines(s.result.text, outRows)
      kids.push(<Text key="o:h" dimColor wrap="truncate-end">{`─ output · ${out.more ? `first ${outRows} of ${out.total} lines` : `${out.total} line${out.total === 1 ? '' : 's'}`} ─`}</Text>)
      if (out.text) kids.push(<Code key="o:c" source={out.text.slice(0, 4000)} language={s.name === 'read' ? languageOf(s.args.path) : 'text'} wrap="truncate-end" />)
    } else kids.push(<Text key="o:none" dimColor>no output yet</Text>)
  }
  return <Box key="card" flexDirection="column" borderStyle="round" borderDimColor paddingX={1} marginLeft={2}>{kids}</Box>
}
// The rows a step card takes: its border and its lines.
function cardRows(room: number): number {
  return Math.max(4, Math.min(14, Math.floor(room / 2)))
}

function activityBody(c: C, agent: Agent, room: number, live: boolean, owner: string): Body {
  const { Text } = c.E
  const file = agent.meta.sessionFile
  const s = sessionOf(agent)
  const none = (text: string): Body => {
    if (live) noteDrawn(owner, [])
    return { nodes: [<Text key="none" dimColor wrap="wrap">{text}</Text>], hints: [] }
  }
  if (typeof file !== 'string') return none('No session is recorded for this agent yet.')
  if (!s) return none('Loading the steps…')
  if (s.error) return none(s.error)
  const { items, thinking } = stepItems(agent)
  if (!items.length) return none(thinking ? `Only thinking so far (${thinking} block${thinking === 1 ? '' : 's'}).` : 'No steps yet.')
  const nameWidth = Math.min(10, Math.max(6, ...items.map(x => (x.step.kind === 'tool' ? x.step.name.length : 5)))) + 1
  const thinkRows = thinking ? 1 : 0
  const open = live ? items.find(x => x.id === c.u.expandedKey) : undefined
  const card = open ? cardRows(room) : 0
  const listRoom = room - thinkRows - card
  const nodes: RenderNode[] = []
  if (!live) {
    // The split preview: the newest steps, no keys.
    const shown = items.slice(-Math.max(1, listRoom))
    for (const x of shown) nodes.push(<Text key={x.id} wrap="truncate-end">{'  '}{stepRowOf(c, x, c.cols - 2, nameWidth).body}</Text>)
  } else {
    noteDrawn(owner, items.map(x => KEYS.row + x.id))
    nodes.push(...windowList(c, items, { idOf: x => x.id, row: (x, _sel, width) => stepRowOf(c, x, width, nameWidth) }, listRoom))
    if (open) nodes.push(stepCard(c, open.step, card))
  }
  if (thinking) nodes.push(<Text key="think" dimColor>{`${thinking} thinking block${thinking === 1 ? '' : 's'} hidden`}</Text>)
  return { nodes, hints: open ? ['↑/↓ to select', 'Enter to collapse'] : ['↑/↓ to select', 'Enter to expand'] }
}

function logBody(c: C, agent: Agent, room: number, live: boolean, owner: string): Body {
  const { Box, Text } = c.E
  const items = logItems(agent)
  if (!items.length) {
    if (live) noteDrawn(owner, [])
    return { nodes: [<Text key="none" dimColor>Nothing is logged yet.</Text>], hints: [] }
  }
  const timeOf = (e: Ev): string => (when(e.ts, c.now) || hhmm(e.ts))
  const timeWidth = Math.max(5, ...items.map(x => cells(timeOf(x.e)))) + 1
  const rowOf = (x: EvItem, width: number): ListRow => {
    const s = eventSentence(x.e, { idleMinutes: x.idle })
    const text = s.topic ? `${s.topic}  ${s.text}` : s.text
    return {
      body: <Text wrap="truncate-end"><Text dimColor>{timeOf(x.e).padEnd(timeWidth)}</Text><Text color={s.color} dimColor={s.dim}>{`${s.glyph} `}</Text><Text dimColor={s.dim}>{cut(text, width - timeWidth - 2)}</Text></Text>,
      onPress: () => go(toggle(c, x.id)),
    }
  }
  const open = live ? items.find(x => x.id === c.u.expandedKey) : undefined
  const card = open ? cardRows(room) : 0
  const listRoom = room - card
  const nodes: RenderNode[] = []
  if (!live) {
    for (const x of items.slice(-Math.max(1, listRoom))) nodes.push(<Text key={x.id} wrap="truncate-end">{'  '}{rowOf(x, c.cols - 2).body}</Text>)
    return { nodes, hints: [] }
  }
  noteDrawn(owner, items.map(x => KEYS.row + x.id))
  nodes.push(...windowList(c, items, { idOf: x => x.id, row: (x, _sel, width) => rowOf(x, width) }, listRoom))
  if (open) {
    const d = new Date(Date.parse(open.e.ts ?? ''))
    const stamp = Number.isNaN(d.getTime()) ? 'Time not recorded' : `${when(open.e.ts, 0)}:${String(d.getSeconds()).padStart(2, '0')}`
    const s = eventSentence(open.e, { idleMinutes: open.idle })
    const full = open.e.type === 'note' || open.e.type === 'question' ? safeText(open.e.data?.text ?? '') : s.text
    const inner = Math.max(1, card - 3)
    const lines = wrapLines(full, c.cols - 6)
    const shown = lines.slice(0, inner)
    nodes.push(
      <Box key="card" flexDirection="column" borderStyle="round" borderDimColor paddingX={1} marginLeft={2}>
        <Text dimColor>{stamp}</Text>
        {shown.map((l, i) => <Text key={`c:${i}`} wrap="truncate-end">{l || ' '}</Text>)}
        {lines.length > shown.length ? <Text dimColor>{`… ${lines.length - shown.length} more line${lines.length - shown.length === 1 ? '' : 's'}`}</Text> : ''}
      </Box>,
    )
  }
  return { nodes, hints: open ? ['↑/↓ to select', 'Enter to collapse'] : ['↑/↓ to select', 'Enter to expand'] }
}

function questionsBody(c: C, agent: Agent, room: number, live: boolean, owner: string): Body {
  const asked = agent.events.filter(e => e.type === 'question')
  const lines: Line[] = []
  const openIds = new Set(agent.questions.map(q => q.data?.toolCallId))
  for (const q of agent.questions) {
    lines.push({ text: `Open · ${oneLine(q.data?.topic) || 'question'} · waiting ${age(q.ts, c.now)}`, bold: true })
    for (const l of wrapLines(q.data?.text ?? '', c.cols - 4)) lines.push({ text: `  ${l}` })
  }
  if (!asked.length) {
    lines.push({ text: `${agent.name} has not asked anything.`, dim: true })
    lines.push({ text: 'When an agent needs a decision, it shows here and above your prompt.', dim: true })
    lines.push({ text: 'The agent waits for an answer from you or Claude.', dim: true })
  } else {
    const closing: { [id: string]: Ev } = {}
    for (const e of agent.events) if ((e.type === 'answered' || e.type === 'question_expired') && e.data?.toolCallId) closing[e.data.toolCallId] = e
    // The answer text itself lives in the pi session (ask_parent's tool result).
    const byId = sessionOf(agent)?.parsed.byId ?? {}
    const history = asked.filter(q => !openIds.has(q.data?.toolCallId))
    if (!history.length && !agent.questions.length) lines.push({ text: 'Nothing is answered yet.', dim: true })
    const m = agent.meta
    const groups: [string, Ev[]][] = [['Earlier this turn', history.filter(q => q.gen === m.gen && q.turn === m.turn)], ['Earlier turns', history.filter(q => !(q.gen === m.gen && q.turn === m.turn))]]
    for (const [label, items] of groups) {
      if (!items.length) continue
      lines.push({ text: label, dim: true, bold: true })
      for (const q of items.slice(-30).reverse()) {
        const end = closing[q.data?.toolCallId]
        const expired = end?.type === 'question_expired'
        lines.push({ text: `  ${expired ? GLYPHS.expired : GLYPHS.ok} ${firstLine(q.data?.text)}`, color: expired ? COLOR.warn : undefined })
        if (expired && end) { lines.push({ text: `    → expired · ${eventSentence(end).text.replace(/^Question expired · /, '')}`, dim: true }); continue }
        if (!end) { lines.push({ text: '    → closed', dim: true }); continue }
        const who = eventSentence(end).text.startsWith('You') ? 'you' : 'Claude'
        const step = byId[q.data?.toolCallId]
        const answer = firstLine(step?.kind === 'ask' ? step.answer ?? '' : '')
        const tail = ` · by ${who} · ${when(end.ts, c.now)}`
        lines.push({ text: answer ? `    → ${cut(answer, Math.max(10, c.cols - 6 - cells(tail)))}${tail}` : `    → answered${tail}`, dim: true })
      }
    }
  }
  const r = reader(c, owner, lines, room, live)
  return { nodes: r.nodes, hints: r.scrolls ? ['↑/↓ to scroll'] : [] }
}

// ---- the detail screen ---------------------------------------------------------------

// The detail of one agent. `live` false draws the split preview: no list keys and no footer.
export function detailView(c: C, agent: Agent | undefined, o: { split: boolean; live: boolean; owner: string }): RenderElement {
  const { Box, Text } = c.E
  const back = o.split ? HINTS.back : HINTS.back
  if (!agent) {
    if (o.live) noteDrawn(o.owner, [])
    return (
      <Box flexDirection="column" width={c.cols}>
        <Text dimColor>That agent is gone.</Text>
        {o.live ? footer(c, [{ hotkey: 's', label: 'settings', onPress: () => go(openSettings(c.k)) }], [back]) : ''}
      </Box>
    )
  }
  if (agent.broken) {
    if (o.live) noteDrawn(o.owner, [])
    return (
      <Box flexDirection="column" width={c.cols}>
        {headerRow(c, agent, o.split)}
        <Box marginTop={1} flexDirection="column">
          <Text color={COLOR.warn}>{`${KG.warn} This agent's record could not be read.`}</Text>
          <Text dimColor wrap="wrap">It shows again when its file is valid. Ask Claude to check it if this stays.</Text>
        </Box>
        {o.live ? footer(c, [{ hotkey: 's', label: 'settings', onPress: () => go(openSettings(c.k)) }], [back]) : ''}
      </Box>
    )
  }
  const keys = o.live && !c.u.confirm ? agentKeys(c, agent) : []
  const asking = c.u.confirm?.kind === 'stop' && c.u.confirm.id === agent.name
  const stopQ = `${KG.warn} Stop ${agent.name}? Its session is kept, and a message wakes it.`
  const top: RenderNode[] = [headerRow(c, agent, o.split), <Text key="facts" dimColor wrap="truncate-end">{facts(c, agent)}</Text>]
  let used = 2
  // The rows that the tab row, the rule, the notice and the footer take.
  const tail = (hints: string[]): number => 2 + noticeRows(c) + (asking ? confirmRows(c, stopQ) : o.live ? footerRows(c, keys, [...hints, back]) : 0)
  const reserve = tail(['↑/↓ to select', 'Enter to expand'])
  if (agent.questions.length) {
    const n = agent.questions.length
    const budget = Math.max(5, c.rows - used - reserve - 3)
    const qRows = Math.max(1, Math.min(8, Math.floor((budget - 5 * n) / n)))
    let shown = 0
    for (const [i, q] of agent.questions.entries()) {
      const card = answerCard(c, agent, q, { index: i, total: n, withName: false, qRows })
      if (shown > 0 && used + card.rows > c.rows - reserve - 3) break
      top.push(card.node)
      used += card.rows
      shown++
    }
    if (shown < n) { top.push(<Text key="more-q" dimColor>{`${n - shown} more question${n - shown === 1 ? '' : 's'} in 4: Questions`}</Text>); used++ }
    else if (used + 1 <= c.rows - reserve - 4) { top.push(<Text key="also" dimColor wrap="truncate-end">Claude also sees this question and may answer it first.</Text>); used++ }
  } else if (!asking) {
    const comp = composerNodes(c, agent)
    top.push(...comp.nodes)
    used += comp.rows
  }
  const room = Math.max(3, c.rows - used - reserve)
  const tab = c.w.tab
  const body = tab === 'activity' ? activityBody(c, agent, room, o.live, o.owner)
    : tab === 'log' ? logBody(c, agent, room, o.live, o.owner)
      : tab === 'questions' ? questionsBody(c, agent, room, o.live, o.owner)
        : resultBody(c, agent, room, o.live, o.owner)
  const hints = c.u.editing ? ['Enter to send', HINTS.cancel] : c.u.inputFocused ? ['Enter to send', HINTS.leaveField] : c.u.expandedKey ? [...body.hints, 'Esc to collapse'] : [...body.hints, back]
  return (
    <Box flexDirection="column" width={c.cols}>
      {top}
      {asking ? stopNodes(c, agent) : ''}
      {noticeNodes(c, { onRetry: () => go(retryLast(c.k)) })}
      {tabRow(c, agent)}
      {rule(c)}
      {body.nodes}
      {o.live && !asking ? footer(c, keys, hints) : ''}
    </Box>
  )
}

