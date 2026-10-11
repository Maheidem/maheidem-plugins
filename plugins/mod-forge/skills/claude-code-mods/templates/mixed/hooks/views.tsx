// The screens of the combined starter: the list pane, the band above the prompt, and the output row
// of the command. Every pane screen comes from a kit call: header, footer, listRows, confirmStrip,
// draftInput, noticeNodes and the loading, empty and error views (hooks/kit/).
// This file holds what is yours: the STYLE rows (one row per persona sketch, ux-design.md 2),
// the texts, the keys, the band line, the actions and the navigation. Change them. Do not edit hooks/kit/.
import type { ElementTable, RenderElement, RenderNode, ThemeKey } from 'claude-code'
import type { Row, Scenario, State, UiState, Variant, View, World } from '../types'
import { FOCUS_SOON_MS, GLYPHS, HINTS, KEYS, SEP, TONE_COLOR } from './kit/defaults'
import { isBusy } from './kit/ctx'
import { askConfirm, cancelConfirm, confirmStrip } from './kit/confirm'
import { setDraft } from './kit/drafts'
import { focusSoon } from './kit/focus'
import { cells, cut } from './kit/format'
import { footer, footerRows } from './kit/footer'
import { header, rule } from './kit/header'
import { draftInput } from './kit/input'
import { listRows, rowKeys } from './kit/list'
import type { ListRow } from './kit/list'
import { noticeNodes, noticeRows, notify } from './kit/notice'
import { later, runAction } from './kit/scenario'
import type { Outcome } from './kit/scenario'
import { emptyView, errorView, loadingView } from './kit/states'
import { announce } from './kit/toast'
import type { Action, Ctx, Handles, KeySpec, ListKeys, Nav, Tone, Ui } from './kit/types'
import { worldFor } from './fixtures'

type C = Ctx<View, Row, Scenario>
type K = Handles<View, Row, Scenario>
type Needs = Exclude<State, 'idle'> // the states that need a person: the band names them

export const VARIANTS: readonly Variant[] = ['A', 'B', 'C', 'D']
export const SCENARIOS: readonly Scenario[] = [
  'normal', 'empty', 'loading', 'error', 'overflow', 'save-fails',
  'one-waiting', 'many', 'failed', 'working', 'quiet',
  'guarded',
]

// One row per persona sketch (ux-design.md 2): A UX, B Visual, C native, D Accessibility.
// err and warn are words before the message. D adds words, so a colour never stands alone.
// words: the band and the rows say the state as a word. lead: what the band names first.
type Style = {
  readonly pointer: string; numbered: boolean; ageLeft: boolean; ageWords: boolean; sub: string; add: string; err: string; warn: string
  words: boolean; lead: 'text' | 'note'
}
const STYLE: Record<Variant, Style> = {
  A: { pointer: '❯', numbered: false, ageLeft: false, ageWords: false, sub: 'newest first', add: 'add', err: '', warn: '', words: false, lead: 'text' },
  B: { pointer: '❯', numbered: false, ageLeft: true, ageWords: false, sub: '', add: 'add', err: '', warn: '', words: false, lead: 'note' },
  C: { pointer: '❯', numbered: false, ageLeft: false, ageWords: false, sub: 'newest first', add: 'add', err: '', warn: '', words: false, lead: 'text' },
  D: { pointer: '>', numbered: true, ageLeft: false, ageWords: true, sub: 'in this list, newest first', add: 'add an item', err: 'Error: ', warn: 'Warning: ', words: true, lead: 'text' },
}

// How each state that needs a person looks. Colour never stands alone: every state has a glyph and a word.
type Look = { glyph: string; word: string; lead: string; verb: string; many: string; color: ThemeKey | undefined }
const LOOK: Record<Needs, Look> = {
  waiting: { glyph: '?', word: 'needs input', lead: 'Needs input', verb: 'needs input', many: 'need input', color: 'warning' },
  failed: { glyph: GLYPHS.err, word: 'failed', lead: 'Failed', verb: 'failed', many: 'failed', color: 'error' },
  working: { glyph: '✻', word: 'working', lead: 'Working', verb: 'working', many: 'working', color: undefined },
}
const lookOf = (r: Row): Look | undefined => (r.state === 'idle' ? undefined : LOOK[r.state])

export const UI0: UiState = {
  view: 'list', cameFrom: 'list', sel: '', confirm: null, notice: null, focusKey: '', inputFocused: false, editing: false, picking: '', expandedKey: '',
}
// Before any scenario runs: nothing is loaded and run is 0. The band stays quiet.
export const WORLD0: World = worldFor('loading', 0)

const DRAFT = 'add:text' // the key of the draft of the add field
const GO_BACK = 'Esc to go back'
const SAVE = 'Enter to save'
const WAKE_MS = 8000 // the working scenario: the first item asks a question after this time
const ASK = 'Keep the old test data?'

const errText = (st: Style, text: string): string => `${GLYPHS.err} ${st.err}${text}`
const warnText = (st: Style, text: string): string => `${GLYPHS.warn} ${st.warn}${text}`
const count = (n: number): string => (n === 1 ? '1 item' : `${n} items`)
const byState = (rows: readonly Row[], state: State): Row[] => rows.filter(r => r.state === state)

// ---- the band ---------------------------------------------------------------------

// The row the band talks about, and the row that Open selects: a waiting item, else a failed one, else a working one.
export function bandTarget(w: World): Row | undefined {
  return byState(w.rows, 'waiting')[0] ?? byState(w.rows, 'failed')[0] ?? byState(w.rows, 'working')[0]
}

type Seg = { text: string; bold?: boolean; color?: ThemeKey; dim?: boolean }

// The segments of the band line: one line, cut at the right edge (wrap="truncate-end").
function bandSegs(w: World): Seg[] {
  const st = STYLE[w.variant]
  const state: Needs = byState(w.rows, 'waiting').length ? 'waiting' : byState(w.rows, 'failed').length ? 'failed' : 'working'
  const list = byState(w.rows, state)
  const first = list[0]
  if (first === undefined) return []
  const look = LOOK[state]
  const head: Seg = { text: st.words ? `${look.lead}: ` : `${look.glyph} `, bold: true, color: look.color, dim: look.color === undefined }
  if (state === 'working') {
    const one = list.length === 1 ? `${SEP}${first.text}` : ''
    return [head, { text: `${st.words ? count(list.length) : `${count(list.length)} working`}${one}`, dim: true }]
  }
  if (list.length === 1) {
    if (st.lead === 'note' && first.note !== '') return [head, { text: first.note, bold: true }, { text: `${SEP}${first.text}`, dim: true }]
    return [head, { text: first.text, bold: true }, { text: st.words ? '' : ` ${look.verb}`, color: look.color }, { text: first.note !== '' ? `${SEP}${first.note}` : '', dim: true }]
  }
  const many = st.words ? count(list.length) : `${count(list.length)} ${look.many}`
  return [head, { text: many, color: st.words ? undefined : look.color }, { text: `${SEP}${list.map(r => r.text).join(', ')}`, dim: true }]
}

export function bandLine(E: Pick<ElementTable, 'Text'>, w: World): RenderNode {
  const { Text } = E
  return (
    <Text wrap="truncate-end">
      {bandSegs(w).filter(s => s.text !== '').map((s, i) => <Text key={`seg:${i}`} bold={s.bold} color={s.color} dimColor={s.dim}>{s.text}</Text>)}
    </Text>
  )
}

// ---- the pane ---------------------------------------------------------------------

// The selected row: the row of u.sel, else the first row, else none.
function selOf(u: UiState, w: World): Row | undefined {
  return w.rows.find(r => r.id === u.sel) ?? w.rows[0]
}
// The ring order of the list: the kit's focus hook reads it.
export function keysOf(u: UiState, w: World): ListKeys | null {
  const sel = selOf(u, w)
  return u.view === 'list' && sel ? rowKeys(w.rows, r => r.id, r => r.id === sel.id) : null
}

// Where the ring goes after a view changes, and where Esc leads (kit/close.ts, kit/focus.ts).
export const NAV: Nav<View, Row, Scenario> = {
  back: u => (u.view === 'list' ? null : 'list'),
  home: (u, w) => {
    if (u.view === 'detail') return `${KEYS.act}d`
    if (u.view === 'add') return '' // the field has the ring: nothing else to focus
    const sel = selOf(u, w)
    return sel ? KEYS.row + sel.id : `${KEYS.act}a`
  },
  // The add view has one field and nothing else to leave to: Esc cancels at once.
  // So the field never counts as focused (the ladder would only leave the field first).
  onFocus: key => (key.startsWith(KEYS.input) ? { inputFocused: false } : {}),
}

// Scenario timers: only later(k, run, ms, step) calls. The loading scenario never ends:
// the design pass needs the loading screen to stay. The working scenario: the first item asks a question.
// The news goes to the transcript always, and to a toast while the pane is closed (kit/toast.ts).
export function startTimers(k: K, s: Scenario, run: number): void {
  if (s !== 'working') return
  later(k, run, WAKE_MS, async () => {
    await k.world.set(w => ({ rows: w.rows.map(r => (r.id === 'r0' ? { ...r, state: 'waiting' as const, note: ASK } : r)) }))
    const asking = (await k.world.get()).rows.find(r => r.id === 'r0')
    if (asking) await announce(k, `${GLYPHS.warn} ${asking.text} asks: ${ASK}`)
  })
}

// ---- actions: each one ends in .catch, because nobody awaits it -------------------

async function openDetail(k: K, id: string): Promise<void> {
  await k.ui.set(() => ({ view: 'detail', cameFrom: 'list', sel: id }))
  focusSoon(k, `${KEYS.act}d`, FOCUS_SOON_MS, NAV)
}

async function openAdd(k: K): Promise<void> {
  // The view first: an Esc right after 'a' must find the add view, not the list (the list closes the pane).
  await k.ui.set(u => ({ view: 'add', cameFrom: u.view, notice: null }))
  await setDraft(k, DRAFT, null)
  await k.world.set(w => ({ epoch: w.epoch + 1 })) // a new field key mounts the field empty
  // The ring goes to the field by key: autoFocus alone left it on the old row after an Esc (live, 2.1.296).
  focusSoon(k, `${KEYS.input}add#${(await k.world.get()).epoch}`, FOCUS_SOON_MS, NAV)
}

// Ask: open the detail with the question. The safe choice (Cancel) gets the ring.
async function askDelete(k: K, id: string): Promise<void> {
  if ((await k.world.get()).busy !== null) return
  await k.ui.set(() => ({ view: 'detail', sel: id }))
  await askConfirm(k, { kind: 'delete', id }, NAV)
}

const deleted = (_w: World, act: Action): Outcome => ({ ok: true, text: `${GLYPHS.ok} Deleted: ${cut(act.text, 30)}` })
const removed = (w: World, act: Action): Partial<World> => ({ rows: w.rows.filter(r => r.id !== act.id) })

async function deleteRow(k: K, id: string): Promise<void> {
  const row = (await k.world.get()).rows.find(r => r.id === id)
  if (!row) return
  const act: Action = { kind: 'delete', id, text: row.text }
  const first = (w: World): string => (w.rows[0] ? KEYS.row + w.rows[0].id : `${KEYS.act}a`)
  await runAction(k, act, deleted, removed, { pending: { tone: 'warn', text: 'Deleting the item…' }, nav: NAV, focus: (_u, w) => first(w) })
  const w = await k.world.get()
  await k.ui.set(() => ({ view: 'list', sel: w.rows[0]?.id ?? '' }))
}

// The fixture store fails once per failsLeft (the save-fails scenario).
const saved = (w: World, act: Action): Outcome => (w.failsLeft > 0
  ? { ok: false, notice: { tone: 'err', text: errText(STYLE[w.variant], 'The item was not saved. The store write failed. Your text is kept.') } }
  : { ok: true, text: `${GLYPHS.ok} Saved: ${cut(act.text, 30)}` })
const added = (w: World, act: Action, _now: number): Partial<World> => ({ rows: [{ id: act.id, text: act.text, state: 'idle', note: '', age: 'now' }, ...w.rows], banner: '' })

async function saveRow(k: K, value: string): Promise<void> {
  const w0 = await k.world.get()
  if (w0.busy !== null) return // a second Enter while the save runs: the save notice stays
  const st = STYLE[w0.variant]
  if (value.trim() === '') {
    await notify(k, { tone: 'err', text: errText(st, 'The item is empty. Type some text, then press Enter.') })
    return
  }
  const act: Action = { kind: 'add', id: `new${w0.epoch}`, text: value.trim() }
  const landed = (w: World): boolean => w.rows.some(r => r.id === act.id)
  await runAction(k, act, saved, added, {
    pending: { tone: 'warn', text: 'Saving the item…' }, draftKey: DRAFT, nav: NAV,
    focus: (_u, w) => (landed(w) ? KEYS.row + act.id : `${KEYS.input}add#${w.epoch}`),
  })
  const w = await k.world.get()
  if (landed(w)) await k.ui.set(() => ({ view: 'list', sel: act.id }))
  else await k.world.set(() => ({ banner: 'The last item was not saved · the store write failed' }))
}

// ---- screens ---------------------------------------------------------------------

// The footer keys. A plain hotkey Button draws "<key>: <label>", so the label is the verb only.
const addKey = (c: C): KeySpec => ({ hotkey: 'a', label: STYLE[c.w.variant].add, onPress: () => void openAdd(c.k).catch(() => undefined) })
const deleteKey = (c: C, id: string): KeySpec => ({ hotkey: 'd', label: 'delete', onPress: () => void askDelete(c.k, id).catch(() => undefined) })

// What the header says after the count: the states that need a person first, else the variant's sub line.
function summary(w: World): string {
  const n = (s: State): number => byState(w.rows, s).length
  const parts = [n('waiting') ? `${n('waiting')} ${n('waiting') === 1 ? 'needs' : 'need'} input` : '', n('failed') ? `${n('failed')} failed` : '', n('working') ? `${n('working')} working` : '']
  return parts.filter(p => p !== '').join(SEP)
}

// One screen line for each row: the text is cut to the room left of the age (UX 13.1).
// A row that needs a person starts with its glyph. D adds the state word at the right.
function rowOf(c: C, r: Row, width: number): ListRow {
  const { Box, Text } = c.E
  const st = STYLE[c.w.variant]
  const look = lookOf(r)
  const head = `${st.numbered ? `${c.w.rows.indexOf(r) + 1}. ` : ''}${look ? `${look.glyph} ` : ''}`
  const age = st.ageWords ? `(${r.age === 'now' ? 'just now' : `${r.age} ago`})` : r.age
  const side = st.words && look ? `${look.word} ${age}` : age
  const onPress = (): void => void openDetail(c.k, r.id).catch(() => undefined)
  if (st.ageLeft) return { body: <Text><Text dimColor>{age.padStart(3)}</Text>{` ${head}${cut(r.text, width - 4 - cells(head))}`}</Text>, onPress }
  const room = width - cells(head) - cells(side) - 1
  return { body: `${head}${cut(r.text, room)}`, side: <Box flexGrow={1} justifyContent="flex-end"><Text dimColor>{side}</Text></Box>, onPress }
}

function listView(c: C, sel: Row): RenderElement {
  const { Box, Text } = c.E
  const st = STYLE[c.w.variant]
  const keys = [addKey(c), deleteKey(c, sel.id)]
  // One row has nothing to select: no arrow hint (the storyboard gate wants an edge for each shown key).
  const hints = c.w.rows.length > 1 ? [HINTS.select, HINTS.view, HINTS.close] : [HINTS.view, HINTS.close]
  const tail = summary(c.w) || st.sub
  // Every other row of the screen: the header, the banner, the rule, the notice and the footer.
  const fixed = 1 + (c.w.banner !== '' ? 1 : 0) + 1 + noticeRows(c) + footerRows(c, keys, hints)
  return (
    <Box flexDirection="column" width={c.cols}>
      {header(c, count(c.w.rows.length), tail !== '' ? { tail: { text: tail } } : undefined)}
      {c.w.banner !== '' ? <Text color="error" wrap="truncate-end">{errText(st, c.w.banner)}</Text> : ''}
      {listRows(c, c.w.rows, { idOf: r => r.id, isSel: r => r.id === sel.id, row: (r, _on, width) => rowOf(c, r, width), fixedRows: fixed, pointer: st.pointer })}
      {rule(c)}
      {noticeNodes(c)}
      {footer(c, keys, hints)}
    </Box>
  )
}

function detailView(c: C, row: Row): RenderElement {
  const { Box, Text } = c.E
  const st = STYLE[c.w.variant]
  const look = lookOf(row)
  const asking = c.u.confirm !== null
  const keys = [deleteKey(c, row.id)]
  const subject = st.numbered ? `Item ${c.w.rows.indexOf(row) + 1} of ${c.w.rows.length}` : 'Item'
  // The question has its own hint row. A running action shows only the wait line.
  const strip = confirmStrip(c, {
    question: warnText(st, 'Delete this item?'), verb: 'delete', yesLabel: 'delete',
    onYes: () => void deleteRow(c.k, row.id).catch(() => undefined),
    onNo: () => void cancelConfirm(c.k, NAV).catch(() => undefined),
  })
  return (
    <Box flexDirection="column" width={c.cols}>
      {header(c, subject, { inside: true })}
      <Box marginTop={1} marginBottom={1} flexDirection="column">
        <Text wrap="wrap">{row.text}</Text>
        {look ? <Text color={look.color} dimColor={look.color === undefined ? true : undefined}>{st.words ? look.lead : `${look.glyph} ${look.word}`}</Text> : ''}
        {row.note !== '' ? <Text wrap="wrap">{`${row.state === 'failed' ? st.err : ''}${row.note}`}</Text> : ''}
        <Text dimColor>{row.age === 'now' ? 'Added just now' : `Added ${row.age} ago`}</Text>
      </Box>
      {asking ? strip : ''}
      {noticeNodes(c)}
      {asking ? (isBusy(c) ? footer(c, [], []) : '') : footer(c, keys, [GO_BACK])}
    </Box>
  )
}

function addView(c: C): RenderElement {
  const { Box } = c.E
  return (
    <Box flexDirection="column" width={c.cols}>
      {header(c, 'New item', { inside: true })}
      <Box marginTop={1}>
        {draftInput(c, {
          name: 'add', draftKey: DRAFT, placeholder: 'Type an item', submitLabel: 'save', autoFocus: true, blank: 'submit',
          onSubmit: v => void saveRow(c.k, v).catch(() => undefined),
        })}
      </Box>
      <Box marginTop={1} flexDirection="column">
        {noticeNodes(c)}
        {footer(c, [], [SAVE, HINTS.cancel])}
      </Box>
    </Box>
  )
}

// The screen order: an error first, then loading, then the add field, then no rows, then the view.
export function draw(c: C): RenderElement {
  const st = STYLE[c.w.variant]
  const sel = selOf(c.u, c.w)
  if (c.w.error !== '') return errorView(c, { subject: 'Read failed', message: `${st.err}${c.w.error}`, hint: 'No items show until a read works.' })
  if (!c.w.loaded) return loadingView(c, 'items')
  if (c.u.view === 'add') return addView(c)
  if (sel === undefined) return emptyView(c, { subject: count(0), lines: [st.numbered ? 'There are no items in this list.' : 'No items yet'], keys: [addKey(c)] })
  return c.u.view === 'detail' ? detailView(c, sel) : listView(c, sel)
}

// ---- the command output row -------------------------------------------------------
// The row is a transcript row, not a pane: it draws at the width of the transcript, so it needs no width and no scroll.
// The text stays plain: the model reads the same text. This tree only adds colour.

// A line that starts with a glyph takes the tone of the glyph. Any other line is plain.
function toneOf(line: string): Tone | undefined {
  if (line.startsWith(GLYPHS.ok)) return 'ok'
  if (line.startsWith(GLYPHS.err)) return 'err'
  return undefined
}

// The first line is the reply of the prototype ("Scenario C normal"): dim. The others follow their glyph.
export function outputView(E: Pick<Ui, 'Box' | 'Text'>, text: string): RenderElement {
  const { Box, Text } = E
  const [head = '', ...body] = text.split('\n')
  return (
    <Box flexDirection="column">
      <Text dimColor wrap="truncate-end">{head}</Text>
      {body.map((line, i) => <Text key={`line:${i}`} color={TONE_COLOR[toneOf(line) ?? 'muted']} wrap="wrap">{line}</Text>)}
    </Box>
  )
}
