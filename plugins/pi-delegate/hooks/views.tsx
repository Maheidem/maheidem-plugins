// The screens of the agents pane: the list, the split dock, settings, and the band above the prompt.
// Every screen is built from kit calls (hooks/kit/): header, footer, listRows, confirmStrip, draftInput,
// noticeNodes and the loading, empty and error views. detail.tsx holds the detail of one agent.
import type { ElementTable, RenderElement, RenderNode } from 'claude-code'
import { GLYPHS as KG, HINTS, KEYS, POINTER } from './kit/defaults'
import { bandQuiet, bandRow, openFromBand } from './kit/band'
import { cancelConfirm, confirmStrip } from './kit/confirm'
import { cells, cut, pad } from './kit/format'
import { footer, footerRows } from './kit/footer'
import { header, rule } from './kit/header'
import { draftInput } from './kit/input'
import { listRows, listWindow, rowKeys } from './kit/list'
import type { ListRow } from './kit/list'
import { noticeNodes, noticeRows } from './kit/notice'
import { emptyView, errorView, loadingView } from './kit/states'
import type { KeySpec } from './kit/types'
import { C as COLOR, STATE, failureLine, firstLine, groupAgents, modelLabel, peekLine, questionId, rowAge, rowSummary, rowTail, stateKey, updatedAt, wrapLines } from './agents-format'
import type { Agent } from './agents-format'
import { D, rangeShort } from './source'
import { SETTING_LABELS, settingLabel, settingValue, sourceWord } from './shared.mjs'
import { NAV, SETTING_KEYS, TITLE, agents, detailAgent, isSplit, listSel, noteDrawn, noteSplit, settingOf } from './model'
import type { C, K } from './model'
import { agentKeys, answerCard, confirmRows, detailView, stopNodes } from './detail'
import { askReset, bandTarget, load, openDetail, openSettings, picked, retryLast, retryLoad, saveSettingValue, startEdit, startPick } from './actions'

const go = (p: Promise<unknown>): void => void p.catch(() => undefined)

const DESCRIPTIONS: { readonly [key: string]: string } = {
  questions_per_turn: 'How many questions one turn may ask before more asks expire.',
  turn_timeout_minutes: 'The time budget for one turn, not counting the time a question waits.',
  question_wait_minutes: 'How long a question waits for an answer from you or Claude.',
  max_live_children: 'How many pi agents may run at once in this Claude session.',
  idle_park_minutes: 'Idle agents are parked after this long. A message wakes them.',
  default_thinking: 'The thinking level that Claude uses when it starts a new agent.',
  scope: 'Where the next change is saved.',
}

// ---- list rows -------------------------------------------------------------------

function staleMinutes(agent: Agent): number {
  const ms = Number(agent.meta?.launch?.turnTimeoutMs)
  return Math.max(Number.isFinite(ms) && ms > 0 ? ms / 60000 : 60, 10)
}

// One screen line for each agent: <pointer> <glyph> <name> <summary>, then the tail word and the age at the right.
function agentRow(c: C, a: Agent, width: number, nameWidth: number, compact: boolean): ListRow {
  const { Box, Text } = c.E
  const st = STATE[stateKey(a)]
  const quiet = a.meta?.state === 'parked' || a.meta?.state === 'stopped' ? true : undefined
  const tail = compact ? '' : rowTail(a)
  const side = [tail, rowAge(a, c.now)].filter(Boolean).join('  ')
  const room = width - 2 - nameWidth - cells(side) - 2
  let summary: RenderNode = ''
  if (!compact && room >= 8) {
    const text = rowSummary(a, c.now, staleMinutes(a))
    const stale = stateKey(a) === 'working' && a.lastActivity > 0 && c.now - a.lastActivity > staleMinutes(a) * 60000
    if (a.meta?.state === 'failed') summary = <Text><Text color={COLOR.err}>Failed</Text><Text dimColor>{cut(` · ${failureLine(a)}`, room - 6)}</Text></Text>
    else if (!text) summary = <Text dimColor italic>no task text</Text>
    else summary = <Text color={stale ? COLOR.warn : undefined} dimColor={stale ? undefined : true}>{cut(text, room)}</Text>
  }
  return {
    body: <Text wrap="truncate-end"><Text color={st.color} bold={st.bold}>{`${st.glyph} `}</Text><Text dimColor={quiet}>{pad(cut(a.name, nameWidth - 1), nameWidth)}</Text>{summary}</Text>,
    side: side ? <Box flexGrow={1} justifyContent="flex-end"><Text dimColor>{side}</Text></Box> : undefined,
    onPress: () => go(openDetail(c.k, a.name)),
  }
}

// The agent list. When every row fits, the group names draw above their rows. A list that needs a window
// draws flat (group headers in a window move while it scrolls), in group order, with the kit window.
function agentList(c: C, sel: Agent | undefined, fixed: number, o: { live: boolean; compact: boolean }): RenderElement {
  const { Box, Text, Button } = c.E
  const rows = agents()
  const nameWidth = Math.min(Math.max(4, ...rows.map(a => cells(a.name))) + 2, o.compact ? 14 : 16)
  const width = c.cols - 2
  const isSel = (a: Agent): boolean => a.name === sel?.name
  const L = rowKeys(rows, a => a.name, isSel)
  if (o.live) noteDrawn('list', L.keys)
  const groups = groupAgents(D.agents)
  const heads = groups.length > 1 || (groups[0]?.rows.length ?? 0) > 1 ? groups.length : 0
  const space = c.rows - fixed
  if (!o.live) {
    // The passive list of the split detail: rows as text, the pointer on the agent shown.
    const win = listWindow(c, rows.length, L.at, fixed)
    return (
      <Box flexDirection="column" marginTop={win.gap}>
        {rows.slice(win.top, win.top + win.count).map(a => {
          const r = agentRow(c, a, width, nameWidth, o.compact)
          return <Box key={`p:${a.name}`} flexDirection="row"><Text>{isSel(a) ? `${POINTER} ` : '  '}</Text>{r.body}{r.side ?? ''}</Box>
        })}
      </Box>
    )
  }
  if (heads && rows.length + heads <= space - 1) {
    listWindow(c, rows.length, L.at, fixed + heads) // the window buffer of the kit: every row shows
    return (
      <Box flexDirection="column" marginTop={1}>
        {groups.map(g => (
          <Box key={`g:${g.name}`} flexDirection="column">
            <Text dimColor bold>{g.name}</Text>
            {g.rows.map(a => {
              const r = agentRow(c, a, width, nameWidth, o.compact)
              const on = isSel(a)
              return (
                <Box key={`r:${a.name}`} flexDirection="row">
                  <Button key={KEYS.row + a.name} plain autoFocus={on && !c.u.confirm && !c.u.inputFocused ? true : undefined} onPress={r.onPress}>
                    {on ? `${POINTER} ` : '  '}
                    {r.body}
                  </Button>
                  {r.side ?? ''}
                </Box>
              )
            })}
          </Box>
        ))}
      </Box>
    )
  }
  return listRows(c, rows, { idOf: a => a.name, isSel, fixedRows: fixed, row: (a, _on, w) => agentRow(c, a, w, nameWidth, o.compact) })
}

function countHeader(c: C): RenderElement {
  const total = D.agents.length
  const waiting = D.agents.filter(a => !a.broken && a.meta.state === 'waiting').length
  return header(c, `${total} agent${total === 1 ? '' : 's'}`, waiting ? { tail: { text: `${waiting} need${waiting === 1 ? 's' : ''} input`, tone: 'warn' } } : undefined)
}

// What shows under the list for the selected agent: the stop question, the answer card, or one dim line.
function belowList(c: C, sel: Agent | undefined, minList: number, keys: readonly KeySpec[], hints: readonly string[]): { nodes: RenderNode[]; rows: number; asking: boolean } {
  const { Text } = c.E
  if (!sel) return { nodes: [], rows: 0, asking: false }
  if (c.u.confirm?.kind === 'stop' && c.u.confirm.id === sel.name) {
    const q = `${KG.warn} Stop ${sel.name}? Its session is kept, and a message wakes it.`
    return { nodes: stopNodes(c, sel), rows: confirmRows(c, q), asking: true }
  }
  const q = !sel.broken && sel.meta.state === 'waiting' ? sel.questions[0] : undefined
  if (q) {
    const budget = c.rows - 2 - noticeRows(c) - footerRows(c, keys, hints) - minList - 4
    const card = answerCard(c, sel, q, { index: 0, total: 1, withName: true, qRows: Math.max(1, Math.min(3, budget)) })
    return { nodes: [card.node], rows: card.rows, asking: false }
  }
  return { nodes: [<Text key="peek" dimColor wrap="truncate-end">{peekLine(sel, c.now) || ' '}</Text>], rows: 1, asking: false }
}

function listView(c: C): RenderElement {
  const { Box } = c.E
  const rows = agents()
  const sel = listSel(c.u, c.w)
  const keys = c.u.confirm ? [] : agentKeys(c, sel)
  const hints = c.u.inputFocused ? ['Enter to send', HINTS.leaveField] : rows.length > 1 ? [HINTS.select, HINTS.view, HINTS.close] : [HINTS.view, HINTS.close]
  const below = belowList(c, sel, Math.min(rows.length, 3) + 1, keys, hints)
  const fixed = 2 + below.rows + noticeRows(c) + (below.asking ? 0 : footerRows(c, keys, hints))
  return (
    <Box flexDirection="column" width={c.cols}>
      {countHeader(c)}
      {agentList(c, sel, fixed, { live: true, compact: false })}
      {rule(c)}
      {below.nodes}
      {noticeNodes(c, { onRetry: () => go(retryLast(c.k)) })}
      {below.asking ? '' : footer(c, keys, hints)}
    </Box>
  )
}

// A wide dock: the list at the left, the selected agent at the right.
// The list has the keys until Enter; then the detail at the right has them, and Esc gives them back.
function splitView(c: C): RenderElement {
  const { Box } = c.E
  const detailMode = c.u.view === 'detail'
  const sel = detailMode ? detailAgent(c.u, c.w) : listSel(c.u, c.w)
  const keys = detailMode || c.u.confirm ? [] : agentKeys(c, sel)
  const hints = c.u.inputFocused ? ['Enter to send', HINTS.leaveField] : [HINTS.select, 'Enter to open', HINTS.close]
  const below = detailMode || c.u.confirm ? 0 : noticeRows(c) + footerRows(c, keys, hints)
  const rowsLeft = Math.max(8, c.rows - below)
  const leftW = Math.min(36, Math.max(28, Math.floor(c.cols * 0.3)))
  const left: C = { ...c, cols: leftW - 1, rows: rowsLeft }
  const right: C = { ...c, cols: c.cols - leftW - 6, rows: rowsLeft - 2 }
  return (
    <Box flexDirection="column" width={c.cols}>
      <Box flexDirection="row" columnGap={1}>
        <Box width={leftW} flexShrink={0} flexDirection="column">
          {countHeader(left)}
          {agentList(left, sel, 2, { live: !detailMode, compact: true })}
          {rule(left)}
        </Box>
        <Box flexGrow={1} flexShrink={1} flexDirection="column" borderStyle="single" borderDimColor paddingX={1}>
          {detailView(right, sel, { split: true, live: detailMode, owner: `split:${c.w.tab}` })}
        </Box>
      </Box>
      {below ? noticeNodes(c, { onRetry: () => go(retryLast(c.k)) }) : ''}
      {below ? footer(c, keys, hints) : ''}
    </Box>
  )
}

// ---- settings -------------------------------------------------------------------

function settingsView(c: C): RenderElement {
  const { Box, Text, Button, Select } = c.E
  const s = D.settings
  const nodes: RenderNode[] = [header(c, 'Settings', { inside: true })]
  const back = [HINTS.back]
  if (s.error) nodes.push(<Text key="err" color="error" wrap="wrap">{`${KG.err} Couldn't read the settings: ${s.error}`}</Text>)
  if (!s.data) {
    if (!s.error) nodes.push(<Box key="loading" marginTop={1}><Text dimColor>Loading the settings…</Text></Box>)
    nodes.push(footer(c, [], back))
    return <Box flexDirection="column" width={c.cols}>{nodes}</Box>
  }
  const data = s.data
  const status = [data.testMode ? 'Test mode: environment overrides are active' : '', ...(data.warnings ?? [])].filter(Boolean).join(' · ')
  if (status) nodes.push(<Text key="status" color={COLOR.warn} wrap="truncate-end">{`${KG.warn} ${status}`}</Text>)
  const focused = settingOf(c.u)
  const scope = c.w.scope
  const pointer = (on: boolean): RenderElement => <Text>{on ? `${POINTER} ` : '  '}</Text>
  const valueCell = (node: RenderNode): RenderElement => <Box width={16} flexShrink={0} justifyContent="flex-end">{node}</Box>
  const sourceCell = (src: string, dim: boolean): RenderElement => <Box width={10} flexShrink={0} paddingLeft={1}><Text dimColor color={dim ? COLOR.off : undefined}>{src}</Text></Box>
  const quiet = !c.u.confirm && !c.u.editing && c.u.picking === '' && c.w.busy === null
  const rows: RenderNode[] = []
  for (const key of SETTING_KEYS) {
    const row = data.settings[key]
    if (!row) continue
    const on = key === focused
    const label = settingLabel(key)
    const shown = settingValue(key, row.value)
    if (c.u.editing && on) {
      rows.push(
        <Box key={`s:${key}`} flexDirection="row" columnGap={1}>
          {pointer(true)}<Text>{label}</Text>
          {draftInput(c, { name: `set:${key}`, draftKey: `set:${key}`, fallback: String(row[scope] ?? row.value ?? ''), submitLabel: 'save', autoFocus: true, onSubmit: v => go(saveSettingValue(c.k, key, v)) })}
        </Box>,
        <Text key={`s:${key}:hint`} dimColor wrap="truncate-end">{`    ${rangeShort(key)} · now ${shown} (${sourceWord(row.source)})`}</Text>,
      )
      continue
    }
    const choose = key === 'default_thinking'
    const current = String(row[scope] ?? row.value)
    const picking = c.u.picking === `set:${key}`
    const options = (data.definitions[key]?.special ?? ['pi-default']).map(v => ({ value: v, label: settingValue(key, v) }))
    rows.push(
      <Box key={`s:${key}`} flexDirection="row">
        {pointer(on)}
        <Button key={`set:${key}`} plain label={label} autoFocus={on && quiet ? true : undefined}
          onPress={() => go(choose ? startPick(c.k, key) : startEdit(c.k, key))} />
        <Box flexGrow={1} />
        {picking
          ? <Box flexShrink={0}><Select key={`${KEYS.pick}${key}`} options={options} value={current} autoFocus onSelect={v => go(picked(c.k, key, v, current))} /></Box>
          : valueCell(<Text bold={row.source !== 'default' ? true : undefined}>{choose ? `${shown} ▾` : shown}</Text>)}
        {sourceCell(sourceWord(row.source), row.source === 'default')}
      </Box>,
    )
  }
  const pin = data.pin ?? {}
  const pinRow = (
    <Box key="s:pin" flexDirection="row">
      {pointer(false)}<Text dimColor>pi model</Text><Box flexGrow={1} />
      <Text dimColor wrap="truncate-end">{pin.source === 'none' || !pin.model ? 'not pinned' : `${modelLabel(pin.model)} · from the project pin`}</Text>
      <Box width={10} flexShrink={0} />
    </Box>
  )
  const scopeWords = scope === 'user' ? 'Your user settings' : 'This project'
  const scopeOptions = [{ value: 'project', label: 'This project' }, { value: 'user', label: 'Your user settings' }]
  rows.push(
    <Box key="s:scope" flexDirection="row">
      {pointer(focused === 'scope')}
      <Button key="set:scope" plain label="Save to" autoFocus={focused === 'scope' && quiet ? true : undefined} onPress={() => go(startPick(c.k, 'scope'))} />
      <Box flexGrow={1} />
      {c.u.picking === 'set:scope'
        ? <Box flexShrink={0}><Select key={`${KEYS.pick}scope`} options={scopeOptions} value={scope} autoFocus onSelect={v => go(picked(c.k, 'scope', v, scope))} /></Box>
        : <Box flexShrink={0}><Text>{`${scopeWords} ▾`}</Text></Box>}
      <Box width={10} flexShrink={0} />
    </Box>,
  )
  noteDrawn('settings', [])

  // The bottom of the screen: the reset question, the notice and the footer. They always show.
  const resetting = c.u.confirm?.kind === 'reset' ? c.u.confirm.id : ''
  const bottom: RenderNode[] = []
  let bottomRows = noticeRows(c)
  if (resetting) {
    const row = data.settings[resetting]
    const fallback = scope === 'project' ? (row?.user ?? null) : (row?.project ?? null)
    const falls = fallback !== null ? `${settingValue(resetting, fallback)} (${scope === 'project' ? 'your settings' : 'this project'})` : `${settingValue(resetting, data.definitions[resetting]?.default)} (default)`
    const question = `${KG.warn} Reset ${settingLabel(resetting)} ${scope === 'project' ? 'here' : 'in your settings'}? It falls back to ${falls}.`
    bottom.push(...confirmStrip(c, { question, verb: 'reset', yesLabel: 'reset', onYes: () => go(saveSettingValue(c.k, resetting, 'inherit')), onNo: () => go(cancelConfirm(c.k, NAV)) }))
    bottomRows += confirmRows(c, question)
  }
  bottom.push(...noticeNodes(c))
  if (!resetting) {
    const canReset = quiet && focused !== 'scope'
    const keys: KeySpec[] = canReset ? [{ hotkey: 'r', label: 'reset', onPress: () => go(askReset(c.k, focused)) }] : []
    const hints = c.u.editing ? ['Enter to save', HINTS.cancel] : c.u.picking ? ['↑/↓ to choose', 'Enter to pick', HINTS.cancel] : [HINTS.select, 'Enter to change', ...back]
    bottom.push(footer(c, keys, hints))
    bottomRows += footerRows(c, keys, hints)
  }

  // The lines that explain the selected row. They show while they fit; the rows and the bottom come first.
  const info: { node: RenderElement; rows: number }[] = []
  const describe = (text: string): void => { info.push({ node: <Text key="d" wrap="wrap">{text}</Text>, rows: wrapLines(text, c.cols).length }) }
  if (focused === 'scope') describe(DESCRIPTIONS.scope ?? '')
  else {
    const row = data.settings[focused]
    const def = data.definitions[focused] ?? {}
    const v = (x: unknown): string => (x === null || x === undefined ? 'not set' : settingValue(focused, x))
    if (row) {
      describe(DESCRIPTIONS[focused] ?? '')
      info.push({
        rows: 1,
        node: (
          <Text key="chain" dimColor wrap="truncate-end">
            <Text bold={row.source === 'project' ? true : undefined}>{`this project: ${v(row.project)}`}</Text>{' · '}
            <Text bold={row.source === 'user' ? true : undefined}>{`your settings: ${v(row.user)}`}</Text>{' · '}
            <Text bold={row.source === 'default' ? true : undefined}>{`default: ${v(def.default)}`}</Text>
          </Text>
        ),
      })
    }
  }
  info.push({ rows: 1, node: <Text key="where" dimColor wrap="truncate-start">{scope === 'project' ? 'Saves to .claude/pi-delegate.local.md in this project.' : `Saves to ${tilde(data.userPath ?? '')} (every project; project values still win).`}</Text> })

  // An open Select lists its options under its row.
  const picking = c.u.picking === 'set:scope' ? scopeOptions.length : c.u.picking ? (data.definitions[c.u.picking.slice(4)]?.special ?? []).length : 0
  let left = c.rows - nodes.length - rows.length - picking - bottomRows
  const showPin = left >= 1
  if (showPin) left -= 1
  const gap = left >= 2 ? 1 : 0
  left -= gap
  const ruleRow = left >= 2
  if (ruleRow) left -= 1
  const shownInfo: RenderNode[] = []
  for (const x of info) {
    if (x.rows > left) break
    shownInfo.push(x.node)
    left -= x.rows
  }
  const allRows = showPin ? [...rows.slice(0, -1), pinRow, ...rows.slice(-1)] : rows
  return (
    <Box flexDirection="column" width={c.cols}>
      {nodes}
      <Box key="rows" flexDirection="column" marginTop={gap}>{allRows}</Box>
      {ruleRow ? rule(c) : ''}
      {shownInfo}
      {bottom}
    </Box>
  )
}

let home = ''
// The home folder, for `~/` paths. The render reads it; init sets it.
export function setHome(path: string): void {
  home = path
}
function tilde(path: string): string {
  return home && path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
}

// ---- the screen order -------------------------------------------------------------

// Settings first (it opens from the error view too), then the error, the loading line, and the agents.
export function draw(c: C): RenderElement {
  const split = isSplit(c)
  noteSplit(split)
  if (c.u.view === 'settings') return settingsView(c)
  const settingsKey: KeySpec = { hotkey: 's', label: 'settings', onPress: () => go(openSettings(c.k)) }
  if (c.w.error) {
    noteDrawn('list', [])
    return errorView(c, {
      subject: "Can't read agents", message: c.w.error, hint: 'Press r to try again. If it stays, run /pi-delegate:setup.',
      keys: [{ hotkey: 'r', label: 'retry', onPress: () => go(retryLoad(c.k)) }, settingsKey],
    })
  }
  if (!c.w.loaded || !D.hydrated) return loadingView(c, TITLE)
  if (!D.agents.length) {
    noteDrawn('list', [])
    return emptyView(c, {
      subject: 'no agents yet',
      lines: ['No pi agents in this project.', 'Ask Claude to hand off a task, for example', '"have pi fix the failing test in parser.ts".'],
      keys: [settingsKey],
    })
  }
  if (split) return splitView(c)
  if (c.u.view === 'detail') return detailView(c, detailAgent(c.u, c.w), { split: false, live: true, owner: `detail:${c.w.tab}` })
  return listView(c)
}

// ---- the band ----------------------------------------------------------------------

// One line above the prompt while an agent asks, failed in the last minute, or works.
// It yields to a survey, before the first read and while the pane is open, and draws what is below it.
export async function band(k: K, E: Pick<ElementTable, 'Box' | 'Text' | 'Button'>, props: { readonly hasSurvey: boolean; readonly isWorking?: boolean }, rest: () => Promise<RenderElement>): Promise<RenderElement> {
  const w = await k.world.get()
  if (!D.hydrated || (await bandQuiet(k, props, w))) return rest()
  const now = await k.now()
  const live = D.agents.filter(a => !a.broken)
  const waiting = live.filter(a => a.meta.state === 'waiting' && a.questions.length)
  const failed = live.filter(a => a.meta.state === 'failed' && now - updatedAt(a) < 60000)
  const working = live.filter(a => a.meta.state === 'running' || a.meta.state === 'spawning')
  if (!waiting.length && !failed.length && !working.length) return rest()
  const { Box, Text } = E
  let line: RenderElement
  const first = waiting[0]
  const broke = failed[0]
  if (first && waiting.length === 1) line = <Text wrap="truncate-end"><Text color={COLOR.warn} bold>? </Text><Text bold>{first.name}</Text><Text color={COLOR.warn}> needs input</Text><Text dimColor>{` · ${firstLine(first.questions[0]?.data?.text)}`}</Text></Text>
  else if (waiting.length > 1) line = <Text wrap="truncate-end"><Text color={COLOR.warn} bold>? </Text><Text color={COLOR.warn}>{`${waiting.length} pi agents need input`}</Text><Text dimColor>{` · ${waiting.map(a => a.name).join(', ')}`}</Text></Text>
  else if (broke) line = <Text wrap="truncate-end"><Text color={COLOR.err}>{`${KG.err} `}</Text><Text bold>{broke.name}</Text><Text color={COLOR.err}> failed</Text><Text dimColor>{` · ${failureLine(broke)}`}</Text></Text>
  else line = <Text dimColor wrap="truncate-end">{`✻ ${working.length} pi agent${working.length === 1 ? '' : 's'} working${working.length === 1 ? ` · ${working[0]?.name ?? ''}` : ''}`}</Text>
  const onOpen = (): void => go(openBand(k))
  return (
    <Box flexDirection="column">
      {bandRow(E, line, onOpen)}
      {await rest()}
    </Box>
  )
}

// The band's open: the list with the agent selected; a question puts the ring in its answer field.
async function openBand(k: K): Promise<void> {
  const target = bandTarget()
  const u = await k.ui.get()
  const notice = u.notice && u.notice.tone !== 'warn' ? u.notice : null
  const w = await k.world.get()
  const q = target?.answer ? target.agent.questions[0] : undefined
  const focusKey = q ? `${KEYS.input}answer:${target?.agent.name}:${questionId(q)}#${w.epoch}` : target ? KEYS.row + target.agent.name : ''
  await openFromBand(k, { view: 'list', sel: target?.agent.name ?? u.sel, notice, picking: '', expandedKey: '' }, focusKey, NAV)
  await load(k)
}

export { SETTING_LABELS }
